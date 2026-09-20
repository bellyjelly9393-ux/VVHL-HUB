const BASE = "https://www.chelstats.app/api";

function safeInt(v, fallback, min, max) {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

async function getJson(url) {
  const r = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "VVHL-HUB Calgary GM AI/1.0",
    },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`ChelStats ${r.status}: ${url.pathname}`);
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const clubId = String(req.query.clubId || "9495").replace(/\D/g, "").slice(0, 12);
  const matchType = String(req.query.matchType || "gameType5").slice(0, 30);
  const consoleName = String(req.query.console || "common-gen5").slice(0, 40);
  const limit = safeInt(req.query.limit, 25, 1, 100);
  const now = new Date();
  const year = safeInt(req.query.year, now.getUTCFullYear(), 2020, 2100);
  const month = safeInt(req.query.month, now.getUTCMonth() + 1, 1, 12);

  if (!clubId) return res.status(400).json({ error: "clubId is required" });

  try {
    const gamesUrl = new URL(`${BASE}/clubs/${clubId}/games`);
    gamesUrl.searchParams.set("matchType", matchType);
    gamesUrl.searchParams.set("limit", String(limit));
    gamesUrl.searchParams.set("year", String(year));
    gamesUrl.searchParams.set("month", String(month));

    const infoUrl = new URL(`${BASE}/club/${clubId}/info`);
    const periodUrl = new URL(`${BASE}/clubs/${clubId}/period-stats`);
    periodUrl.searchParams.set("console", consoleName);
    periodUrl.searchParams.set("excludeMatchType", "club_private");

    const [gamesResult, infoResult, periodResult] = await Promise.allSettled([
      getJson(gamesUrl),
      getJson(infoUrl),
      getJson(periodUrl),
    ]);

    if (gamesResult.status !== "fulfilled") throw gamesResult.reason;

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=180");
    return res.status(200).json({
      source: "chelstats",
      clubId,
      matchType,
      console: consoleName,
      year,
      month,
      games: gamesResult.value?.games || gamesResult.value || [],
      clubInfo: infoResult.status === "fulfilled" ? infoResult.value : null,
      periodStats: periodResult.status === "fulfilled" ? periodResult.value : null,
      warnings: [
        ...(infoResult.status === "rejected" ? ["club info unavailable"] : []),
        ...(periodResult.status === "rejected" ? ["period stats unavailable"] : []),
      ],
    });
  } catch (error) {
    return res.status(502).json({
      error: "Unable to load ChelStats club data",
      detail: error?.message || "Unknown error",
    });
  }
}
