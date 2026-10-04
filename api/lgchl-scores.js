// GET /api/lgchl-scores?view=ticker|season|standings
// League-wide LGCHL (S55) schedule, scores and standings read from Supabase (public read-only
// tables filled by the lgchl-league-sync Edge Function). No LeagueGaming traffic from Vercel.
//   ticker    (default) last night's finals + today's slate (+ next night when today is empty)
//             scope=featured (default: all WHL + OHL/QMJHL big games) | all | whl | big
//             hitmen=1 to include Calgary games (excluded by default; the Hitmen block has them)
//   season    every game + standings + teams (War Room landing / race panel)
//   standings standings + teams
import { view } from './_lgchl.js';

const VIEWS = new Set(['ticker', 'season', 'standings']);
const SCOPES = new Set(['featured', 'all', 'whl', 'big']);

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  const name = String(req.query?.view || 'ticker');
  const scope = String(req.query?.scope || 'featured');
  if (!VIEWS.has(name) || !SCOPES.has(scope)) return res.status(400).json({ ok: false, error: 'bad_request' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const body = await view(name, { scope, includeHitmen: req.query?.hitmen === '1' });
    if (!body.counts.teams) throw Object.assign(new Error('empty'), { status: 503 });
    res.setHeader('Cache-Control', name === 'ticker'
      ? 'public, max-age=60, s-maxage=120, stale-while-revalidate=600'
      : 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json(body);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(error.status || 502).json({ ok: false, error: 'league_feed_unavailable' });
  }
}
