import crypto from "node:crypto";

// Environment refresh marker: 2026-09-20

const SUPABASE_URL = "https://lrgllzvwgvqagcpiyvfd.supabase.co";
const SUPABASE_KEY = "sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function webhookSecret() {
  return process.env.MUX_WEBHOOK_SECRET || process.env.MUX_WEBHOOK_SIGNING_SECRET || "";
}

function safeHexEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

function verifyMuxSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return { ok: false, reason: "missing signature configuration" };

  const parts = String(signatureHeader)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter(Boolean);

  if (!timestamp || !signatures.length || !/^\d+$/.test(timestamp)) {
    return { ok: false, reason: "malformed mux-signature" };
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (age > 300) return { ok: false, reason: "stale webhook timestamp" };

  const digest = crypto
    .createHmac("sha256", secret)
    .update(timestamp + "." + rawBody, "utf8")
    .digest("hex");

  return signatures.some((sig) => safeHexEqual(digest, sig))
    ? { ok: true, timestamp: Number(timestamp) }
    : { ok: false, reason: "signature mismatch" };
}

async function processEvent(event) {
  const internalSecret = process.env.MUX_TOKEN_SECRET;
  if (!internalSecret) throw new Error("Mux server credential is unavailable");

  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/process_mux_webhook_event", {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      p_internal_secret: internalSecret,
      p_event: event,
    }),
  });

  const bodyText = await response.text();
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = bodyText; }

  if (!response.ok) {
    const message = body?.message || body?.hint || body?.error || "Supabase webhook processing failed";
    throw new Error(message);
  }
  return body;
}

export async function GET() {
  return json({
    endpoint: "mux-webhook",
    configured: Boolean(webhookSecret()),
    databaseProcessorConfigured: Boolean(process.env.MUX_TOKEN_SECRET),
  });
}

export async function POST(request) {
  const secret = webhookSecret();
  if (!secret) return json({ error: "Mux webhook signing secret is not configured" }, 503);

  const rawBody = await request.text();
  const signature = request.headers.get("mux-signature") || "";
  const verified = verifyMuxSignature(rawBody, signature, secret);

  if (!verified.ok) {
    return json({ error: "Invalid Mux webhook signature", detail: verified.reason }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  if (!event?.id || !event?.type || !event?.data) {
    return json({ error: "Incomplete Mux event payload" }, 400);
  }

  try {
    const result = await processEvent(event);
    return json({ received: true, result });
  } catch (error) {
    console.error("Mux webhook processing failed", event?.id, event?.type, error?.message);
    return json({ error: "Webhook processing failed" }, 500);
  }
}
