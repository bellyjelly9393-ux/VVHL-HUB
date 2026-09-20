const MUX_SYSTEM = "https://api.mux.com/system/v1/webhooks";

function muxAuth() {
  const id = process.env.MUX_TOKEN_ID;
  const secret = process.env.MUX_TOKEN_SECRET;
  if (!id || !secret) return null;
  return "Basic " + Buffer.from(id + ":" + secret).toString("base64");
}

async function muxRequest(url, options = {}) {
  const auth = muxAuth();
  if (!auth) {
    const error = new Error("Mux credentials are not configured");
    error.status = 503;
    throw error;
  }
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.messages?.[0] || body?.error?.message || "Mux webhook API request failed");
    error.status = response.status;
    throw error;
  }
  return body?.data ?? body;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rows = await muxRequest(MUX_SYSTEM + "?limit=25");
    const webhooks = Array.isArray(rows) ? rows : [];
    return res.status(200).json({
      systemAccess: true,
      webhooks: webhooks.map((row) => ({
        id: row.id,
        address: row.address,
        enabled: row.enabled,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      systemAccess: false,
      error: error.message || "Unable to list Mux webhooks",
    });
  }
}
