const SUPABASE_URL = "https://lrgllzvwgvqagcpiyvfd.supabase.co";
const SUPABASE_KEY = "sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP";
const MUX_API = "https://api.mux.com";

export function muxAuth() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) return null;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function bearer(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value : "";
}

export async function supabaseRest(req, path, options = {}) {
  const auth = bearer(req);
  if (!auth) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: auth,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const error = new Error(body?.message || body?.error_description || "Database request failed");
    error.status = res.status;
    throw error;
  }
  return body;
}

export async function getReview(req, reviewId) {
  const id = encodeURIComponent(reviewId);
  const rows = await supabaseRest(
    req,
    `/rest/v1/vod_review_sessions?id=eq.${id}&select=id,title,team_id,intake_mode,mux_upload_id,mux_asset_id,mux_playback_id,mux_playback_policy,mux_status`
  );
  const review = Array.isArray(rows) ? rows[0] : null;
  if (!review) {
    const error = new Error("VOD review not found or not authorized");
    error.status = 404;
    throw error;
  }
  return review;
}

export async function patchReview(req, reviewId, patch) {
  const id = encodeURIComponent(reviewId);
  return supabaseRest(req, `/rest/v1/vod_review_sessions?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
}

export async function muxFetch(path, options = {}) {
  const auth = muxAuth();
  if (!auth) {
    const error = new Error("Mux credentials are not configured");
    error.status = 503;
    throw error;
  }
  const res = await fetch(`${MUX_API}${path}`, {
    ...options,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(body?.error?.messages?.[0] || body?.error?.message || `Mux returned HTTP ${res.status}`);
    error.status = 502;
    throw error;
  }
  return body?.data ?? body;
}
