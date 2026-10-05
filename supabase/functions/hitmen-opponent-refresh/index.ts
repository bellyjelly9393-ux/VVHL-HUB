import { createClient } from 'npm:@supabase/supabase-js@2';
import { TEAM, SEASON, ROSTER_URL, LG_STATS_URL, parseRosters, matchLeaguePlayers, eaMembers } from '../../../lib/opponent-refresh.mjs';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth: {persistSession: false}});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
async function checked(q: any) { const {data, error} = await q; if (error) throw new Error(error.message); return data; }
const UA = 'Wildman-Hockey-Esports/1.0 (opponent scouting; scheduled twice weekly)';
async function authenticatedRoster() {
  const snap = await checked(db.from('lg_auth_snapshots').select('captured_at,source_url').eq('capture_type','roster').eq('parse_status','parsed').eq('league','LGCHL').eq('season',SEASON).order('captured_at',{ascending:false}).limit(1).maybeSingle());
  if (!snap?.captured_at) return null;
  const rows: any[] = [];
  for (let start = 0; start < 2500; start += 1000) {
    const page = await checked(db.from('lg_roster_players').select('lg_user_id,gamertag,team_name,position,salary,management_role,roster_role,source_updated_at').eq('season',SEASON).eq('league','LGCHL').eq('active',true).not('lg_user_id','is',null).range(start,start+999));
    rows.push(...page);
    if (page.length < 1000) break;
  }
  if (rows.length < 50) return null;
  const teams = new Set(rows.map((r:any)=>r.team_name));
  if (teams.size < 20) return null;
  const ageMs = Date.now() - Date.parse(snap.captured_at);
  const players = rows.map((r:any)=>({
    uid:Number(r.lg_user_id),name:r.gamertag,team:r.team_name,position:r.position,
    salary:r.salary,management_role:r.management_role,roster_role:r.roster_role||'Active'
  }));
  return {
    status: ageMs <= 48*60*60*1000 ? 'complete' : 'partial',
    as_of:snap.captured_at,
    players,
    detail:{source:'authenticated-browser-capture',source_url:snap.source_url,players:players.length,teams:teams.size,
      warnings:ageMs <= 48*60*60*1000 ? [] : ['Authenticated LG roster snapshot is older than 48 hours; retained instead of risking an unverified overwrite']}
  };
}

async function lgRoster() {
  const captured = await authenticatedRoster();
  if (captured) return captured;
  const res = await fetch(ROSTER_URL, {headers: {'User-Agent': UA, Accept: 'text/html'}, signal: AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error('LG roster returned HTTP ' + res.status + '; use Wildman Auth Sync, previous roster retained');
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

const CALGARY_EA_CLUB='9495';

async function reconcileOfficialGames(task: any, club: string, platform: string, privateMatches: any[], asOf: string) {
  const [teams, links] = await Promise.all([
    checked(db.from('lgchl_teams').select('lg_team_id,name').eq('season',SEASON)),
    checked(db.from('hitmen_opponents').select('opponent_name,ea_club_id').eq('team_id',TEAM).eq('season',SEASON))
  ]);
  const target = teams.find((t:any)=>t.name===task.opponent_name);
  if (!target) return {official_games:0,matched:0,unmatched:[],warning:'LG team mapping missing'};
  const games = await checked(db.from('lgchl_games')
    .select('lg_game_id,game_at,home_lg_team_id,away_lg_team_id,home_score,away_score,status,source_url')
    .eq('season',SEASON).eq('status','final')
    .or('home_lg_team_id.eq.'+target.lg_team_id+',away_lg_team_id.eq.'+target.lg_team_id)
    .order('game_at'));
  const nameByLg = new Map(teams.map((t:any)=>[String(t.lg_team_id),t.name]));
  const clubByName = new Map(links.filter((x:any)=>/^\\d+$/.test(String(x.ea_club_id||''))).map((x:any)=>[x.opponent_name,String(x.ea_club_id)]));
  clubByName.set('Calgary Hitmen',CALGARY_EA_CLUB);
  const matches = Array.isArray(privateMatches) ? privateMatches : [];
  const used = new Set<string>(), rows:any[] = [], unmatched:any[] = [];

  for (const g of games) {
    const home = String(g.home_lg_team_id)===String(target.lg_team_id);
    const otherLg = home ? g.away_lg_team_id : g.home_lg_team_id;
    const otherName = nameByLg.get(String(otherLg)) || '';
    const otherClub = clubByName.get(otherName);
    const gf = Number(home ? g.home_score : g.away_score);
    const ga = Number(home ? g.away_score : g.home_score);
    if (!otherClub) { unmatched.push({lg_game_id:g.lg_game_id,opponent:otherName,reason:'EA club link missing'}); continue; }

    const scheduled = Date.parse(g.game_at||'');
    const candidates = matches.map((m:any)=>{
      const tc=m?.clubs?.[club], oc=m?.clubs?.[otherClub];
      const ts=Number(m?.timestamp||0)*1000;
      const diff=Number.isFinite(scheduled)&&ts ? Math.abs(ts-scheduled) : Number.MAX_SAFE_INTEGER;
      return {m,tc,oc,diff};
    }).filter((x:any)=>x.tc&&x.oc&&Number(x.tc.score)===gf&&Number(x.oc.score)===ga&&!used.has(String(x.m.matchId))&&x.diff<=24*60*60*1000)
      .sort((a:any,b:any)=>a.diff-b.diff);

    if (!candidates.length) {
      unmatched.push({lg_game_id:g.lg_game_id,opponent:otherName,score:gf+'-'+ga,reason:'No exact EA club/score match within 24h'});
      continue;
    }
    const pick=candidates[0], m=pick.m;
    used.add(String(m.matchId));
    const playedAt=new Date(Number(m.timestamp)*1000).toISOString();
    const confidence=pick.diff<=4*60*60*1000?1:0.98;
    rows.push({
      team_id:TEAM,season:SEASON,opponent_name:task.opponent_name,source_game_id:String(m.matchId),
      ea_club_id:club,opponent_club_id:otherClub,played_at:playedAt,
      result:gf>ga?'W':gf<ga?'L':'T',goals_for:gf,goals_against:ga,
      team_stats:pick.tc||{},opponent_stats:pick.oc||{},
      player_stats:{team:m?.players?.[club]||{},opponent:m?.players?.[otherClub]||{}},
      raw_payload:{...m,reconciliation:{official_lg_game:true,lg_game_id:g.lg_game_id,lg_game_at:g.game_at,lg_source_url:g.source_url,other_team:otherName,time_difference_seconds:Math.round(pick.diff/1000)}},
      source_updated_at:asOf,updated_at:asOf,
      lg_game_id:g.lg_game_id,verified_official:true,verification_confidence:confidence,
      verification_basis:'Exact EA club IDs + exact final score + nearest timestamp to official LGCHL game'
    });
  }
  if (rows.length) await checked(db.from('hitmen_opponent_ea_games').upsert(rows,{onConflict:'team_id,season,opponent_name,source_game_id'}));
  return {official_games:games.length,matched:rows.length,unmatched,club_id:club,platform};
}

async function ea(task: any) {
  const opponent = await checked(db.from('hitmen_opponents').select('ea_club_id,ea_platform').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',task.opponent_name).single());
  if (!/^\\d+$/.test(opponent.ea_club_id || '')) throw new Error('No verified EA club link');
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
  let reconciliation:any={official_games:0,matched:0,unmatched:[]};
  if (Array.isArray(payload.privateMatches)) {
    try { reconciliation=await reconcileOfficialGames(task,club,platform,payload.privateMatches,asOf); }
    catch (e) { warnings.push('Official LG/EA reconciliation: '+String(e instanceof Error?e.message:e)); }
  } else warnings.push('Private EA match history unavailable; official game reconciliation skipped');
  return {status: warnings.length ? 'partial' : 'complete', as_of: asOf, players,
    payload: {...payload,club_id:club,platform,scope:'EA club feed plus LG-verified official game reconciliation',official_reconciliation:reconciliation},
    label:'EA NHL 27 club stats + LG-verified Season 55 game logs',url:'https://www.ea.com/games/nhl/nhl-27/pro-clubs',
    detail:{players:players.length,warnings,official_games:reconciliation.official_games,official_matches_saved:reconciliation.matched,official_unmatched:reconciliation.unmatched}};
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
