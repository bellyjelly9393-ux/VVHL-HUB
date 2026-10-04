// GET /api/lgchl-scores?view=ticker|season|standings
// League-wide LGCHL (S55) schedule, scores and standings, crawled from public LeagueGaming pages
// by api/_lgchl.js. Public league data only; no Supabase access and no secrets involved.
//   ticker    (default) last night's finals + today's slate (+ next night when today is empty)
//   season    every game + standings + teams (War Room landing / race panel)
//   standings standings + teams
// CDN caching keeps LG traffic low; the module cache limits re-crawls per warm instance.
import { ensureFresh, view } from './_lgchl.js';

const VIEWS = new Set(['ticker', 'season', 'standings']);

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const name = String(req.query?.view || 'ticker');
  if (!VIEWS.has(name)) return res.status(400).json({ ok: false, error: 'unknown_view' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const mode = await ensureFresh();
    const body = view(name);
    if (!body.counts.games) throw Object.assign(new Error('empty'), { status: 502 });
    body.crawl = mode;
    res.setHeader('Cache-Control', mode === 'stale' ? 'public, max-age=60, s-maxage=60, stale-while-revalidate=600' : name === 'ticker'
      ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=1800'
      : 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json(body);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(error.status || 502).json({ ok: false, error: 'league_source_unavailable' });
  }
}
