const DEFAULT_CLUB_ID = "12521";
const DEFAULT_PLATFORM = "common-gen5";
const VALID_MATCH_TYPES = new Set(["gameType5", "gameType10", "club_private"]);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const clubId = String(req.query.clubId || DEFAULT_CLUB_ID).replace(/\D/g, "").slice(0, 12);
  const platform = String(req.query.platform || DEFAULT_PLATFORM).slice(0, 32);
  const matchType = String(req.query.matchType || "gameType5");

  if (!clubId) return res.status(400).json({ error: "clubId is required" });
  if (!VALID_MATCH_TYPES.has(matchType)) {
    return res.status(400).json({ error: "Unsupported matchType" });
  }

  const url = new URL("https://proclubs.ea.com/api/nhl/clubs/matches");
  url.searchParams.set("clubIds", clubId);
  url.searchParams.set("platform", platform);
  url.searchParams.set("matchType", matchType);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.ea.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"
      },
      redirect: "follow",
      cache: "no-store"
    });

    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    res.setHeader("Cache-Control", "no-store");
    return res.status(response.ok ? 200 : 502).json({
      source: "ea-proclubs",
      upstreamStatus: response.status,
      clubId,
      platform,
      matchType,
      count: Array.isArray(data) ? data.length : null,
      data: data ?? null,
      textPreview: data == null ? text.slice(0, 1000) : null
    });
  } catch (error) {
    return res.status(502).json({
      source: "ea-proclubs",
      clubId,
      platform,
      matchType,
      error: error?.message || "EA request failed"
    });
  }
}
