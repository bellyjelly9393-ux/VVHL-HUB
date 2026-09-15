const ALLOWED_HOSTS = new Set([
  "leaguegaming.com",
  "www.leaguegaming.com",
  "tv.leaguegaming.com",
]);

function decodeEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function text(value = "") {
  return decodeEntities(
    String(value)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function safeLeagueGamingUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    throw new Error("Enter a valid LeagueGaming URL.");
  }
  if (url.protocol !== "https:") throw new Error("LeagueGaming URL must use HTTPS.");
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) throw new Error("Only public leaguegaming.com URLs are allowed.");
  if (url.username || url.password || url.port) throw new Error("Unsupported LeagueGaming URL.");
  if (!url.pathname.startsWith("/forums/")) throw new Error("Use a public LeagueGaming forums/stat page URL.");
  return url;
}

async function fetchPublicPage(startUrl) {
  let current = startUrl;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.8",
          "User-Agent": "Wildman-Hockey-Esports/1.0 public-tournament-stats",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return response;
      current = safeLeagueGamingUrl(new URL(location, current).toString());
      continue;
    }
    return response;
  }
  throw new Error("Too many LeagueGaming redirects.");
}

function parseTables(html) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  let index = 0;
  while ((tableMatch = tableRe.exec(html)) && index < 40) {
    const body = tableMatch[1];
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(body)) && rows.length < 250) {
      const cells = [];
      const cellRe = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1]))) cells.push(text(cellMatch[2]));
      if (cells.some(Boolean)) rows.push(cells);
    }
    if (rows.length) {
      const first = rows[0] || [];
      const joined = first.join(" ").toLowerCase();
      const statScore = ["gp", "games", "goals", "assists", "points", "pts", "+/-", "save", "gaa", "shots", "wins", "losses"]
        .reduce((sum, key) => sum + (joined.includes(key) ? 1 : 0), 0);
      tables.push({ index, statScore, rows });
      index += 1;
    }
  }
  return tables.sort((a, b) => b.statScore - a.statScore || a.index - b.index);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawUrl = String(req.query.url || "");
  if (!rawUrl || rawUrl.length > 1200) return res.status(400).json({ error: "A public LeagueGaming URL is required." });

  let url;
  try {
    url = safeLeagueGamingUrl(rawUrl);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  try {
    const upstream = await fetchPublicPage(url);
    const contentType = upstream.headers.get("content-type") || "";
    const body = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "LeagueGaming public page request failed",
        status: upstream.status,
        blocked: upstream.status === 401 || upstream.status === 403 || upstream.status === 429,
      });
    }

    if (!contentType.includes("text/html") && !body.trim().startsWith("<")) {
      return res.status(422).json({ error: "LeagueGaming returned an unsupported response type." });
    }

    const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? text(titleMatch[1]) : "LeagueGaming public stats";
    const tables = parseTables(body);
    const pageText = text(body).slice(0, 1600);
    const challenge = /captcha|cloudflare|access denied|verify you are human|security check/i.test(`${title} ${pageText}`);

    if (challenge && !tables.length) {
      return res.status(409).json({
        error: "LeagueGaming returned a browser/security challenge instead of public stats.",
        blocked: true,
        title,
      });
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=180");
    return res.status(200).json({
      source: "leaguegaming-public",
      url: url.toString(),
      title,
      tableCount: tables.length,
      tables,
      pageText,
      note: "Public-page parser only. No login, cookies, private endpoints, or anti-bot bypass are used.",
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return res.status(502).json({
      error: timedOut ? "LeagueGaming public page timed out." : "Unable to fetch LeagueGaming public page.",
      detail: error?.message || "Unknown error",
    });
  }
}
