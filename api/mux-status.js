import { getReview, muxFetch, patchReview } from "./_mux.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");
  const reviewId = String(req.query?.reviewId || "").trim();
  if (!reviewId) return res.status(400).json({ error: "reviewId is required" });

  try {
    const review = await getReview(req, reviewId);
    let upload = null;
    let asset = null;

    if (review.mux_asset_id) {
      asset = await muxFetch("/video/v1/assets/" + encodeURIComponent(review.mux_asset_id));
    } else if (review.mux_upload_id) {
      upload = await muxFetch("/video/v1/uploads/" + encodeURIComponent(review.mux_upload_id));
      if (upload.asset_id) {
        asset = await muxFetch("/video/v1/assets/" + encodeURIComponent(upload.asset_id));
      }
    } else {
      return res.status(200).json({ configured: false, status: null });
    }

    const playback = asset?.playback_ids?.[0] || null;
    const patch = {
      mux_status: asset?.status || upload?.status || review.mux_status || null,
      mux_asset_id: asset?.id || upload?.asset_id || review.mux_asset_id || null,
      mux_playback_id: playback?.id || review.mux_playback_id || null,
      mux_playback_policy: playback?.policy || review.mux_playback_policy || "signed",
      mux_asset_data: asset || upload || {},
      mux_updated_at: new Date().toISOString(),
    };

    await patchReview(req, review.id, patch);

    return res.status(200).json({
      configured: true,
      status: patch.mux_status,
      uploadId: review.mux_upload_id || null,
      assetId: patch.mux_asset_id,
      playbackId: patch.mux_playback_id,
      playbackPolicy: patch.mux_playback_policy,
      duration: asset?.duration ?? null,
      aspectRatio: asset?.aspect_ratio ?? null,
      resolutionTier: asset?.resolution_tier ?? null,
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Unable to read Mux status" });
  }
}
