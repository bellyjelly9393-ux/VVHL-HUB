(() => {
  const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
  const E=id=>document.getElementById(id);
  const DB=()=>window.VVHLBackend?.db;
  const ST=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
  let selected=null,loading=false;

  const canWrite=()=>{
    if(String(ST().profile?.role||'').toLowerCase()==='admin')return true;
    return (ST().memberships||[]).some(m=>m.team_id===TEAM&&m.active!==false&&['owner','gm','agm'].includes(String(m.role||'').toLowerCase()));
  };

  async function token(){
    const {data,error}=await DB().auth.getSession();if(error)throw error;
    if(!data.session?.access_token)throw new Error('Sign in again.');
    return data.session.access_token;
  }

  function setStatus(t){if(E('hoiRosterStatus'))E('hoiRosterStatus').textContent=t||'';}
  function money(v){return v==null?'—':'$'+Number(v).toLocaleString();}
  function stat(label,v){return '<div class="hoi-player-stat"><small>'+esc(label)+'</small><b>'+esc(v==null?'—':v)+'</b></div>'}

  async function loadSelected(){
    if(!selected||!DB()||!ST().user||loading)return;
    loading=true;
    try{
      const q=await Promise.all([
        DB().from('hitmen_opponents').select('id,opponent_name,ea_club_id,ea_club_name,ea_platform,lg_roster_updated_at,ea_updated_at').eq('id',selected.id).single(),
        DB().from('hitmen_opponent_roster_players').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',selected.name).eq('active',true).order('position'),
        DB().from('hitmen_opponent_player_stats').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',selected.name).order('source_updated_at',{ascending:false}),
        DB().from('hitmen_opponent_source_snapshots').select('id,source,source_label,fetched_at').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',selected.name).order('fetched_at',{ascending:false}).limit(8),
        DB().from('hitmen_opponent_pregame_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',selected.name).order('created_at',{ascending:false}).limit(5)
      ]);
      const er=q.find(x=>x.error);if(er)throw er.error;
      renderRoster(q[1].data||[],q[2].data||[]);
      renderEa(q[0].data,q[3].data||[]);
      renderReports(q[4].data||[]);
      const lg=q[0].data?.lg_roster_updated_at;
      setStatus((q[1].data||[]).length+' active players'+(lg?' · LG synced '+new Date(lg).toLocaleString():' · LG roster not synced yet'));
    }catch(e){console.error(e);setStatus(e.message||'Opponent intelligence could not load.')}
    finally{loading=false;}
  }

  function latestStatsByName(rows){
    const m=new Map();
    rows.forEach(r=>{const k=norm(r.gamertag);if(k&&!m.has(k))m.set(k,r)});
    return m;
  }

  function renderRoster(rows,statsRows){
    const box=E('hoiRoster');if(!box)return;
    const stats=latestStatsByName(statsRows);
    if(!rows.length){box.innerHTML='<div class="hoi-empty" style="grid-column:1/-1">No current roster imported yet. Use Sync LG Rosters.</div>';return}
    const posOrder={LW:1,C:2,RW:3,LD:4,RD:5,G:6};
    rows.sort((a,b)=>(posOrder[a.position]||9)-(posOrder[b.position]||9)||String(a.gamertag).localeCompare(String(b.gamertag)));
    box.innerHTML=rows.map(r=>{
      const s=stats.get(norm(r.gamertag))||{};
      const pts=s.points??((s.goals!=null||s.assists!=null)?Number(s.goals||0)+Number(s.assists||0):null);
      const extra=s.raw_stats&&Object.keys(s.raw_stats).length?'<details><summary>Raw public stats</summary><pre>'+esc(JSON.stringify(s.raw_stats,null,2))+'</pre></details>':'';
      return '<article class="hoi-player-card"><div class="hoi-player-card-head"><div><strong>'+esc(r.gamertag)+'</strong><div class="hoi-player-sub">'+esc(r.management_role||r.roster_role||'Active')+(r.salary!=null?' · '+money(r.salary):'')+'</div></div><span class="hoi-player-pos">'+esc(r.position||'—')+'</span></div>'+
      '<div class="hoi-player-stats">'+stat('GP',s.games_played)+stat('G',s.goals)+stat('A',s.assists)+stat('PTS',pts)+stat('+/-',s.plus_minus)+stat('FO%',s.faceoff_pct)+stat('HITS',s.hits)+stat('PIM',s.pim)+'</div>'+extra+'</article>';
    }).join('');
  }

  function renderEa(o,snaps){
    const box=E('hoiEaClub');if(!box)return;
    if(!o?.ea_club_id){
      box.innerHTML='<div class="hoi-ea-club-card"><div><strong>EA NHL 27 club not linked yet</strong><small>Find the matching Pro Clubs team once, then Wildman can pull public member stats and recent match logs.</small></div><span class="status">UNLINKED</span></div>';
      return;
    }
    const last=o.ea_updated_at?new Date(o.ea_updated_at).toLocaleString():'never';
    box.innerHTML='<div class="hoi-ea-club-card"><div><strong>'+esc(o.ea_club_name||o.opponent_name)+'</strong><small>EA Club ID '+esc(o.ea_club_id)+' · '+esc(o.ea_platform||'common-gen5')+' · last sync '+esc(last)+' · '+snaps.filter(x=>x.source==='ea_nhl27').length+' saved snapshots</small></div><span class="status">LINKED</span></div>';
  }

  function renderReports(rows){
    const box=E('hoiPregameReport');if(!box)return;
    if(!rows.length){box.innerHTML='<div class="hoi-empty">No generated pregame report yet.</div>';return}
    const r=rows[0];
    const body=String(r.report||'').split(/\r?\n/).map(line=>{
      const t=line.trim();
      const inline=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\[(E\d+)\]/g,'<span class="cite">[$1]</span>');
      if(!t)return '';
      if(/^###\s+/.test(t))return '<h4>'+inline(t.replace(/^###\s+/,''))+'</h4>';
      if(/^##\s+/.test(t))return '<h3>'+inline(t.replace(/^##\s+/,''))+'</h3>';
      if(/^[-*]\s+/.test(t))return '<div class="bullet"><span>•</span><p>'+inline(t.replace(/^[-*]\s+/,''))+'</p></div>';
      return '<p>'+inline(t)+'</p>';
    }).join('');
    box.innerHTML='<div class="hoi-report-head"><div><strong>Latest pregame report</strong><small>'+esc(new Date(r.created_at).toLocaleString())+' · '+esc(r.model||'Claude')+'</small></div></div><div class="hoi-report-body">'+body+'</div>';
  }

  async function syncLg(){
    if(!canWrite())return;
    const b=E('hoiSyncLg');if(b)b.disabled=true;setStatus('Pulling public LGCHL Season 55 rosters…');
    try{
      const r=await fetch('/api/hitmen-opponent-rosters',{cache:'no-store'}),body=await r.json();
      if(!r.ok)throw new Error(body.error||'LG roster sync failed.');
      const rpc=await DB().rpc('apply_hitmen_opponent_roster_snapshot',{p_rows:body.players,p_source_updated_at:body.fetched_at});
      if(rpc.error)throw rpc.error;
      const up=await DB().from('hitmen_opponents').update({lg_roster_updated_at:body.fetched_at,source_updated_at:body.fetched_at}).eq('team_id',TEAM).eq('season',SEASON);
      if(up.error)throw up.error;
      setStatus('LGCHL rosters synced · '+body.team_count+' teams · '+body.player_count+' players.');
      await loadSelected();
    }catch(e){setStatus('LG roster sync failed. '+e.message)}
    finally{if(b)b.disabled=false;}
  }

  function clubCandidates(body){
    const out=[],seen=new Set();
    const walk=x=>{
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x)){x.forEach(walk);return;}
      const id=x.clubId??x.clubID??x.id;
      const name=x.name??x.clubName??x.clubname;
      if(id!=null&&name&&typeof name==='string'){
        const key=String(id);
        if(!seen.has(key)){seen.add(key);out.push({id:key,name:String(name),region:x.regionId??x.region??'',raw:x});}
      }
      Object.values(x).forEach(v=>{if(v&&typeof v==='object')walk(v)});
    };
    walk(body);return out;
  }

  async function findEa(){
    if(!selected||!canWrite())return;
    const b=E('hoiFindEa');if(b)b.disabled=true;setStatus('Searching EA NHL 27 Pro Clubs for '+selected.name+'…');
    try{
      const t=await token();
      const r=await fetch('/api/hitmen-ea-intel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({action:'search',clubName:selected.name,platform:'common-gen5'})});
      const body=await r.json();if(!r.ok)throw new Error(body.error||'EA club search failed.');
      const c=clubCandidates(body.body);
      if(!c.length)throw new Error('EA returned no matching clubs for this team name.');
      const exact=c.filter(x=>norm(x.name)===norm(selected.name));
      if(exact.length===1){await saveEaClub(exact[0]);return;}
      E('hoiEaClub').innerHTML='<div class="hoi-ea-picker"><select id="hoiEaPick">'+c.slice(0,20).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+' · ID '+esc(x.id)+'</option>').join('')+'</select><button id="hoiEaUse" class="hm-save" type="button">Use This EA Club</button></div>';
      E('hoiEaUse').onclick=()=>{const id=E('hoiEaPick').value,club=c.find(x=>x.id===id);if(club)saveEaClub(club)};
      setStatus('EA returned '+c.length+' possible clubs. Confirm the correct one once.');
    }catch(e){setStatus('EA club search failed. '+e.message)}
    finally{if(b)b.disabled=false;}
  }

  async function saveEaClub(club){
    const r=await DB().from('hitmen_opponents').update({ea_club_id:club.id,ea_club_name:club.name,ea_platform:'common-gen5',updated_by:ST().user.id,updated_at:new Date().toISOString()}).eq('id',selected.id);
    if(r.error)throw r.error;
    setStatus('EA club linked: '+club.name+' · '+club.id+'.');
    await loadSelected();
  }

  function pick(o,keys){
    if(!o||typeof o!=='object')return null;
    for(const k of keys)if(o[k]!=null&&o[k]!=='')return o[k];
    return null;
  }
  function collectMemberStats(root){
    const out=[],seen=new Set();
    const walk=x=>{
      if(!x||typeof x!=='object')return;
      if(Array.isArray(x)){x.forEach(walk);return;}
      const name=pick(x,['name','playerName','playername','personaName','persona','gamertag']);
      const hasStats=['gamesPlayed','gamesplayed','goals','assists','points','hits','pim','plusMinus','plusminus','faceoffPct','faceoffpercent'].some(k=>x[k]!=null);
      if(typeof name==='string'&&hasStats){
        const k=norm(name);if(k&&!seen.has(k)){seen.add(k);out.push(x);}
      }
      Object.values(x).forEach(v=>{if(v&&typeof v==='object')walk(v)});
    };
    walk(root);return out;
  }
  function parseMember(m){
    const name=String(pick(m,['name','playerName','playername','personaName','persona','gamertag'])||'').trim();
    const goals=num(pick(m,['goals','goalsScored']));
    const assists=num(pick(m,['assists']));
    return {
      gamertag:name,
      position:String(pick(m,['position','pos','positionName'])||'')||null,
      games_played:num(pick(m,['gamesPlayed','gamesplayed','games'])),
      wins:num(pick(m,['wins'])),losses:num(pick(m,['losses'])),
      goals,assists,points:num(pick(m,['points','pts']))??(goals!=null||assists!=null?Number(goals||0)+Number(assists||0):null),
      plus_minus:num(pick(m,['plusMinus','plusminus','plus_minus'])),
      shots:num(pick(m,['shots','shotsFor'])),hits:num(pick(m,['hits'])),pim:num(pick(m,['pim','penaltyMinutes'])),
      takeaways:num(pick(m,['takeaways'])),giveaways:num(pick(m,['giveaways'])),
      faceoff_pct:num(pick(m,['faceoffPct','faceoffpercent','faceoffPercentage'])),
      passing_pct:num(pick(m,['passingPct','passingpercent','passingPercentage'])),
      goalie_save_pct:num(pick(m,['savePct','savePercentage','svPct'])),
      goalie_gaa:num(pick(m,['gaa','goalsAgainstAverage'])),
      raw_stats:m
    };
  }

  async function syncEa(){
    if(!selected||!canWrite())return;
    const op=await DB().from('hitmen_opponents').select('ea_club_id,ea_club_name,ea_platform').eq('id',selected.id).single();
    if(op.error){setStatus(op.error.message);return}
    if(!op.data?.ea_club_id){setStatus('Link the EA club first.');return}
    const b=E('hoiSyncEa');if(b)b.disabled=true;setStatus('Pulling EA NHL 27 member stats and match logs…');
    try{
      const t=await token();
      const r=await fetch('/api/hitmen-ea-intel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({action:'snapshot',clubId:op.data.ea_club_id,platform:op.data.ea_platform||'common-gen5'})});
      const body=await r.json();if(!r.ok)throw new Error(body.error||'EA snapshot failed.');
      const now=body.fetched_at||new Date().toISOString();
      const snap=await DB().from('hitmen_opponent_source_snapshots').insert({team_id:TEAM,season:SEASON,opponent_name:selected.name,source:'ea_nhl27',source_label:'EA NHL 27 Pro Clubs public feed',source_url:'https://www.ea.com/games/nhl/nhl-27/pro-clubs',payload:body.data||{},fetched_at:now,created_by:ST().user.id});
      if(snap.error)throw snap.error;
      const members=collectMemberStats(body.data?.members||body.data).map(parseMember).filter(x=>x.gamertag);
      for(const m of members){
        const save=await DB().from('hitmen_opponent_player_stats').upsert({...m,team_id:TEAM,season:SEASON,opponent_name:selected.name,source:'ea_nhl27',source_key:'current',source_updated_at:now,updated_at:now},{onConflict:'team_id,season,opponent_name,gamertag,source,source_key'});
        if(save.error)throw save.error;
      }
      const up=await DB().from('hitmen_opponents').update({ea_updated_at:now,updated_by:ST().user.id,updated_at:now}).eq('id',selected.id);if(up.error)throw up.error;
      setStatus('EA NHL 27 synced · '+members.length+' player stat lines · public match payload saved'+(body.warnings?.length?' · '+body.warnings.length+' source warnings':'')+'.');
      await loadSelected();
    }catch(e){setStatus('EA sync failed. '+e.message)}
    finally{if(b)b.disabled=false;}
  }

  async function generateReport(){
    if(!selected||!canWrite())return;
    const b=E('hoiGenerateReport');if(b)b.disabled=true;setStatus('Building pregame scouting report with Wildman Hockey Ops…');
    try{
      const t=await token();
      const question='Prepare a complete regular-season pregame scouting report for '+selected.name+'. Use the current opponent roster, individual player stats, public league information, EA NHL 27 game logs, Calgary head-to-head history, and VOD evidence if available. Identify personnel threats, team strengths and weaknesses, likely tactical tendencies that are actually supported by evidence, Calgary matchup priorities, likely counter-adjustments, uncertainty, and the single most valuable film check before game time.';
      const r=await fetch('/api/chelscout-deepthink',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({question,scenario:'Regular-season pregame preparation for '+selected.name+'. Rosters are finalized. Do not use old draft-pool status as current team strength.',lens:'opponent',mode:'auto'}),signal:AbortSignal.timeout(115000)});
      const body=await r.json();if(!r.ok)throw new Error(body.error||'Pregame report failed.');
      const next=await DB().from('hitmen_schedule_games').select('id,scheduled_at').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',selected.name).eq('status','scheduled').gte('scheduled_at',new Date().toISOString()).order('scheduled_at').limit(1).maybeSingle();
      const save=await DB().from('hitmen_opponent_pregame_reports').insert({team_id:TEAM,season:SEASON,opponent_name:selected.name,scheduled_game_id:next.data?.id||null,model:body.model||null,report:body.answer,evidence_summary:{lens:body.lens,depthMode:body.depthMode,depthReason:body.depthReason,coverage:body.coverage,evidenceIds:(body.sources||[]).map(x=>x.id)},created_by:ST().user.id});
      if(save.error)throw save.error;
      setStatus('Pregame report generated · '+String(body.depthMode||'auto').toUpperCase()+' analysis.');
      await loadSelected();
    }catch(e){setStatus('Pregame report failed. '+e.message)}
    finally{if(b)b.disabled=false;}
  }

  function bind(){
    if(E('hoiSyncLg'))E('hoiSyncLg').onclick=syncLg;
    if(E('hoiFindEa'))E('hoiFindEa').onclick=findEa;
    if(E('hoiSyncEa'))E('hoiSyncEa').onclick=syncEa;
    if(E('hoiGenerateReport'))E('hoiGenerateReport').onclick=generateReport;
    document.querySelectorAll('[data-write-only]').forEach(x=>x.disabled=!canWrite());
  }

  window.addEventListener('hitmen-opponent-selected',e=>{selected=e.detail;loadSelected()});
  window.addEventListener('vvhl-auth-change',()=>{bind();if(selected)loadSelected()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();