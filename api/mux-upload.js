import { getReview, muxFetch, patchReview } from "./_mux.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");
  const reviewId = String(req.body?.reviewId || "").trim();
  if (!reviewId) return res.status(400).json({ error: "reviewId is required" });

  try {
    const review = await getReview(req, reviewId);

    if (review.mux_asset_id) {
      return res.status(200).json({
        existing: true,
        assetId: review.mux_asset_id,
        playbackId: review.mux_playback_id || null,
        status: review.mux_status || "unknown",
      });
    }

    const origin = String(req.headers.origin || ("https://" + (req.headers.host || "")));
    const corsOrigin = /^https?:\/\//i.test(origin) ? origin : "https://wildmanhockey-esportshub.vercel.app";

    const upload = await muxFetch("/video/v1/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cors_origin: corsOrigin,
        timeout: 3600,
        new_asset_settings: {
          passthrough: review.id,
          playback_policies: ["signed"],
          video_quality: "basic"
        }
      }),
    });

    await patchReview(req, review.id, {
      mux_upload_id: upload.id,
      mux_playback_policy: "signed",
      mux_status: upload.status || "waiting",
      mux_asset_data: { upload_status: upload.status || "waiting" },
      mux_updated_at: new Date().toISOString(),
    });

    return res.status(201).json({
      uploadId: upload.id,
      uploadUrl: upload.url,
      status: upload.status || "waiting",
      playbackPolicy: "signed",
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Unable to create Mux upload" });
  }
}
