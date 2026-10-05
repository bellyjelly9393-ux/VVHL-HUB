// lgchl-league-sync: LeagueGaming LGCHL (league 39, S55) league-wide schedule, scores and standings
// -> lgchl_teams / lgchl_games / lgchl_standings_snapshots. Shared by the site live ticker and War Room.
// Called by pg_cron through private.lgchl_kick_sync() with the same x-sync-token as lg-stats-sync.
// Polite by design, same fetch approach as lg-stats-sync: plain GET, identified User-Agent,
// one request at a time with a pause. If LG answers with a Cloudflare challenge we stop and record it.
//   full  : standings + all 62 team schedule pages (resumes across calls; ~2 calls)
//   delta : only the fewest team pages covering games that should be over but have no score
//   continue : resume the running refresh
import { createClient } from 'npm:@supabase/supabase-js@2';
import { TEAM_META, standingsUrl, scheduleUrl, parseStandings, parseTeamSchedule, teamRows, snapshotRows, changedSnapshots, coverTeams, isChallenge } from './lib.ts';

const UA = 'Wildman-Hockey-Esports/1.0 (league schedule sync; one request at a time)';
const PAUSE_MS = 1500;
const GAME_LEN_MS = 35 * 60e3;
const GIVE_UP_MS = 8 * 3600e3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function sb() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}
class Challenge extends Error {}

async function getHtml(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  const html = await res.text();
  if (isChallenge(res.status, html, res.headers)) throw new Challenge(`LG returned a Cloudflare challenge (${res.status})`);
  if (!res.ok) throw new Error(`LG returned ${res.status}`);
  return html;
}
async function checked<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await p; if (error) throw new Error(error.message); return data;
}

async function syncStandings(db: ReturnType<typeof sb>) {
  const rows = parseStandings(await getHtml(standingsUrl()));
  if (rows.length < 40) throw new Error(`Standings parse found only ${rows.length} teams`);
  await checked(db.from('lgchl_teams').upsert(teamRows(rows).map((t) => ({ ...t, updated_at: new Date().toISOString() })), { onConflict: 'lg_team_id' }));
  const current = await checked(db.from('lgchl_standings_current').select('lg_team_id,gp,w,l,otw,otl,pts,gf,ga,gd,streak,last10,home,away,division_rank'));
  const changed = changedSnapshots(snapshotRows(rows), current as never[]);
  if (changed.length) await checked(db.from('lgchl_standings_snapshots').insert(changed));
  return { teams: rows.length, snapshots: changed.length, finals: rows.reduce((a, r) => a + (r.gp || 0), 0) / 2 };
}

async function finalsCount(db: ReturnType<typeof sb>) {
  const { count } = await db.from('lgchl_games').select('lg_game_id', { count: 'exact', head: true }).eq('status', 'final');
  return count ?? 0;
}

async function startRun(db: ReturnType<typeof sb>, mode: string) {
  const known = await checked(db.from('lgchl_teams').select('lg_team_id'));
  let teamIds: number[];
  if (mode === 'full') {
    teamIds = (known as { lg_team_id: number }[]).map((t) => t.lg_team_id);
    if (!teamIds.length) teamIds = Object.keys(TEAM_META).map(Number);
  } else {
    const now = Date.now();
    const pending = await checked(db.from('lgchl_games').select('lg_game_id,away_lg_team_id,home_lg_team_id')
      .eq('status', 'scheduled').lt('game_at', new Date(now - GAME_LEN_MS).toISOString()).gt('game_at', new Date(now - GIVE_UP_MS).toISOString()));
    teamIds = coverTeams(pending as never[]);
    if (!teamIds.length) return null;
  }
  const finals = await finalsCount(db);
  const [run] = await checked(db.from('lgchl_sync_runs').insert({ kind: mode, team_ids: teamIds, finals_before: finals }).select('*')) as never[];
  return run as Run;
}
type Run = { id: number; kind: string; team_ids: number[]; next_index: number; requests: number; pages_failed: number; games_upserted: number; error: string | null };

Deno.serve(async (req) => {
  const db = sb();
  const { data: cfg } = await db.from('lg_sync_settings').select('value').eq('key', 'sync_token').maybeSingle();
  if (!cfg?.value || req.headers.get('x-sync-token') !== cfg.value) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const mode = ['full', 'delta', 'continue'].includes(String(body.mode)) ? String(body.mode) : 'continue';
  const deadline = Date.now() + Math.min(Number(body.budgetMs || 100000), 130000);

  // Diagnostics: one standings request, nothing saved.
  if (body.action === 'probe') {
    try { const rows = parseStandings(await getHtml(standingsUrl())); return json({ ok: true, teams: rows.length, sample: rows[0] }); }
    catch (e) { return json({ ok: false, error: String((e as Error).message) }, 502); }
  }

  let run = (await checked(db.from('lgchl_sync_runs').select('*').eq('status', 'running').order('id', { ascending: false }).limit(1)) as Run[])[0];
  const log: Record<string, unknown> = { mode };
  try {
    if (!run) {
      if (mode === 'continue') return json({ idle: true });
      // Teams must exist before games (FK); the first ever run loads standings up front.
      const { count } = await db.from('lgchl_teams').select('lg_team_id', { count: 'exact', head: true });
      if (!count) { log.standings = await syncStandings(db); await sleep(PAUSE_MS); }
      run = await startRun(db, mode) as Run;
      if (!run) return json({ idle: true, reason: 'no pending games' });
    }
    const known = new Set(((await checked(db.from('lgchl_teams').select('lg_team_id'))) as { lg_team_id: number }[]).map((t) => t.lg_team_id));
    let i = run.next_index, requests = run.requests, failed = run.pages_failed, upserted = run.games_upserted;
    while (i < run.team_ids.length && Date.now() < deadline - 15000) {
      const teamId = run.team_ids[i];
      try {
        requests++;
        const games = parseTeamSchedule(await getHtml(scheduleUrl(teamId))).filter((g) => known.has(g.away_lg_team_id) && known.has(g.home_lg_team_id));
        if (games.length) {
          const now = new Date().toISOString();
          await checked(db.from('lgchl_games').upsert(games.map((g) => { const { season: _s, ...rest } = g; return { ...rest, fetched_at: now }; }), { onConflict: 'lg_game_id' }));
          upserted += games.length;
        }
      } catch (e) {
        if (e instanceof Challenge) throw e;
        failed++;
        log.lastPageError = `${teamId}: ${String((e as Error).message).slice(0, 200)}`;
      }
      i++;
      await checked(db.from('lgchl_sync_runs').update({ next_index: i, requests, pages_failed: failed, games_upserted: upserted, updated_at: new Date().toISOString() }).eq('id', run.id));
      await sleep(PAUSE_MS);
    }
    if (i >= run.team_ids.length) {
      // Standings last, so its GP/W match the finals we just read from the schedules.
      log.standings = await syncStandings(db); requests++;
      const finals = await finalsCount(db);
      await checked(db.from('lgchl_sync_runs').update({ status: 'done', requests, finals_after: finals, error: failed ? String(log.lastPageError || 'some pages failed') : null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', run.id));
      return json({ ...log, run: run.id, kind: run.kind, done: true, pages: run.team_ids.length, failed, upserted, finals });
    }
    return json({ ...log, run: run.id, kind: run.kind, done: false, next_index: i, of: run.team_ids.length });
  } catch (e) {
    const msg = String((e as Error)?.message || e).slice(0, 500);
    if (run) await db.from('lgchl_sync_runs').update({ status: 'failed', error: msg, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', run.id);
    return json({ ...log, error: msg, challenge: e instanceof Challenge }, 502);
  }
});
