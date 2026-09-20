const MUX_API = "https://api.mux.com";

function authHeader() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) return null;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");
  const auth = authHeader();
  const result = {
    configured: Boolean(auth),
    connected: false,
    webhookSecretConfigured: Boolean(process.env.MUX_WEBHOOK_SECRET || process.env.MUX_WEBHOOK_SIGNING_SECRET),
    environment: process.env.VERCEL_ENV || null,
  };

  if (!auth) return res.status(200).json(result);

  try {
    const upstream = await fetch(`${MUX_API}/video/v1/assets?limit=1`, {
      headers: { Authorization: auth, Accept: "application/json" },
    });
    result.connected = upstream.ok;
    result.muxStatus = upstream.status;
    if (!upstream.ok) {
      const body = await upstream.json().catch(() => null);
      result.error = body?.error?.messages?.[0] || body?.error?.message || "Mux authentication failed";
    }
    return res.status(upstream.ok ? 200 : 502).json(result);
  } catch (error) {
    result.error = "Unable to reach Mux";
    return res.status(502).json(result);
  }
}
