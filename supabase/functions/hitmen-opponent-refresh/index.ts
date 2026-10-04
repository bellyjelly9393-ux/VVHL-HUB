import { createClient } from 'npm:@supabase/supabase-js@2';
import { TEAM, SEASON, ROSTER_URL, LG_STATS_URL, parseRosters, matchLeaguePlayers, eaMembers } from '../../../lib/opponent-refresh.mjs';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false}});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
async function checked(q: any) { const {data, error} = await q; if (error) throw new Error(error.message); return data; }
const UA = 'Wildman-Hockey-Esports/1.0 (opponent scouting; scheduled twice weekly)';
async function lgRoster() {
  const res = await fetch(ROSTER_URL, {headers: {'User-Agent': UA, Accept: 'text/html'}, signal: AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error('LG roster returned HTTP ' + res.status + '; previous roster retained');
  const html = await res.text();
  const players = parseRosters(html);
  return {status: 'complete', as_of: new Date().toISOString(), players, detail: {source: ROSTER_URL}};
}

async function league(task: any) {
  const run = await checked(db.from('hitmen_opponent_refresh_runs').select('requested_at').eq('id', task.run_id).single());
  const jobs = await checked(db.from('lg_sync_jobs').select('player_kind,status,finished_at,last_error').eq('lg_league_id',39).eq('season',SEASON).eq('season_type','regular'));
  const waiting = jobs.some((j: any) => ['pending','running'].includes(j.status));
  const age = Date.now() - Date.parse(run.requested_at);
  const rosterTask = await checked(db.from('hitmen_opponent_refresh_tasks').select('status').eq('run_id',task.run_id).eq('source','lg_roster').single());
  if (age < 20 * 60000 && (waiting || ['pending','running'].includes(rosterTask.status))) return {status: 'defer', detail: {message: 'Waiting for current LG import and roster refresh; saved evidence retained'}};
  const roster = await checked(db.from('hitmen_opponent_roster_players').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',task.opponent_name).eq('active',true));
  if (!roster.length) throw new Error('No verified opponent roster; cannot attribute player stats');
  const ids = roster.map((r: any) => r.source_player_uid).filter((id: any) => id != null);
  const names = roster.filter((r: any) => r.source_player_uid == null).map((r: any) => r.gamertag);
  const query = () => db.from('lg_player_season_stats').select('*').eq('lg_league_id',39).eq('season',SEASON).eq('season_type','regular');
  const stats = [...(ids.length ? await checked(query().in('lg_user_id',ids)) : []), ...(names.length ? await checked(query().in('gamertag',names)) : [])];
  const {rows, unmatched} = matchLeaguePlayers(roster,stats);
  if (!rows.length) throw new Error('No unambiguous LG player stat matches; saved stats retained');
  const asOf = rows.map((r: any) => r.source_updated_at).sort()[0];
  const fresh = jobs.length === 2 && jobs.every((j: any) => j.status === 'done' && Date.parse(j.finished_at) >= Date.parse(run.requested_at)) && rows.every((r: any) => Date.parse(r.source_updated_at) >= Date.parse(run.requested_at));
  const rosterFresh = ['complete','partial'].includes(rosterTask.status) && roster.every((r: any) => Date.parse(r.source_updated_at) >= Date.parse(run.requested_at));
  const detail = {matched: rows.length, roster_players: roster.length, unmatched, stats_fresh: fresh, roster_fresh: rosterFresh,
    warnings: [...(!fresh ? ['LG refresh incomplete; last successful player stats preserved with original dates'] : []), ...(!rosterFresh ? ['Roster refresh incomplete; identities use the last saved roster'] : [])],
    scope: 'LGCHL Season 55 regular-season totals; current roster attribution, not team-only production'};
  return {status: fresh && rosterFresh && !unmatched.length ? 'complete' : 'partial', as_of: asOf, players: rows, detail,
    label: 'LGCHL Season 55 regular-season player statistics', url: LG_STATS_URL, payload: {players: rows, roster_as_of: roster.map((r: any) => r.source_updated_at).sort()[0]}};
}

async function ea(task: any) {
  const opponent = await checked(db.from('hitmen_opponents').select('ea_club_id,ea_platform').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',task.opponent_name).single());
  if (!/^\d+$/.test(opponent.ea_club_id || '')) throw new Error('No verified EA club link');
  const club = String(opponent.ea_club_id), platform = opponent.ea_platform || 'common-gen5';
  if (platform !== 'common-gen5') throw new Error('Unsupported EA platform');
  const calls = [
    ['club','/clubs/info',{clubIds: club}], ['members','/members/stats',{clubId: club}], ['season','/clubs/seasonalStats',{clubIds: club}],
    ['privateMatches','/clubs/matches',{clubIds: club,matchType: 'club_private',maxResultCount: '60'}],
    ['regularMatches','/clubs/matches',{clubIds: club,matchType: 'gameType5',maxResultCount: '60'}],
    ['playoffMatches','/clubs/matches',{clubIds: club,matchType: 'gameType10',maxResultCount: '40'}],
  ] as const;
  const results = await Promise.allSettled(calls.map(async ([key,path,params]) => {
    const url = new URL('https://proclubs.ea.com/api/nhl' + path);
    Object.entries({platform,...params}).forEach(([k,v]) => url.searchParams.set(k,String(v)));
    const res = await fetch(url,{headers:{Accept:'application/json',Referer:'https://www.ea.com/',Origin:'https://www.ea.com','User-Agent':UA},signal:AbortSignal.timeout(12000)});
    if (!res.ok) throw new Error(key + ': HTTP ' + res.status);
    const data = await res.json();
    if (data == null || data.error) throw new Error(key + ': invalid EA response');
    return [key,data];
  }));
  const payload: any = {}, warnings: string[] = [];
  results.forEach((r,i) => {if (r.status === 'fulfilled') payload[r.value[0]] = r.value[1]; else warnings.push(calls[i][0] + ': ' + String(r.reason?.message || 'unavailable'));});
  if (!Object.keys(payload).length) throw new Error('EA source unavailable: ' + warnings.join('; '));
  const players = eaMembers(payload.members), asOf = new Date().toISOString();
  if (!players.length) warnings.push('No parsed EA member stat lines; raw source retained');
  return {status: warnings.length ? 'partial' : 'complete', as_of: asOf, players, payload: {...payload,club_id:club,platform,scope:'EA club games; not confirmed LG league matches'},
    label:'EA NHL 27 club stats and recent game logs (all club play)',url:'https://www.ea.com/games/nhl/nhl-27/pro-clubs',detail:{players:players.length,warnings}};
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({error:'POST only'},405);
  // Custom cron authentication, identical to the established LG worker. Never return the secret.
  const supplied = req.headers.get('x-sync-token');
  if (!supplied) return json({error:'Unauthorized'},401);
  const {data:setting,error} = await db.from('lg_sync_settings').select('value').eq('key','sync_token').single();
  if (error || !setting?.value || supplied !== setting.value) return json({error:'Unauthorized'},401);
  const started = Date.now(), summary: any[] = [];
  try {
    for (let batch = 0; batch < 4 && Date.now()-started < 55000; batch++) {
      const tasks = await checked(db.rpc('hitmen_claim_opponent_refresh'));
      if (!tasks.length) break;
      const results = await Promise.all(tasks.map(async (task: any) => {
        let result;
        try { result = await (task.source === 'lg_roster' ? lgRoster() : task.source === 'lg_chl' ? league(task) : ea(task)); }
        catch (e) {result = {status:'failed',detail:{error:String(e instanceof Error ? e.message : e).slice(0,1500),previous_evidence_retained:true}};}
        await checked(db.rpc('hitmen_finish_opponent_refresh',{p_id:task.id,p_lease:task.lease,p_result:result}));
        return {opponent:task.opponent_name,source:task.source,status:result.status};
      }));
      summary.push(...results);
    }
    return json({tasks:summary});
  } catch (e) {return json({error:String(e instanceof Error ? e.message : e),tasks:summary},500);}
});
