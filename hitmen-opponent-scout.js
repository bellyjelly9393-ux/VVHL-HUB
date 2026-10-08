(() => {
  const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
  const E=id=>document.getElementById(id), DB=()=>window.VVHLBackend?.db, ST=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
  const qs=new URLSearchParams(location.search), opponent=qs.get('opponent')||'';
  const POS={LW:1,C:2,RW:3,LD:4,RD:5,G:6};
  const inside=new Set([4,6,7,8,10,11,12,14]);
  let data={roster:[],stats:[],history:[],games:[],eaGames:[],reports:[],scouts:[]},players=[],selected=null,filter='current',metric='shots';

  function canWrite(){
    if(String(ST().profile?.role||'').toLowerCase()==='admin')return true;
    return (ST().memberships||[]).some(m=>m.team_id===TEAM&&m.active!==false&&['owner','gm','agm'].includes(String(m.role||'').toLowerCase()));
  }
  function fmt(v,d=0){const n=num(v);return n==null?'—':n.toFixed(d)}
  function stat(label,value,scope=''){return '<div class="hs-stat"><small>'+esc(label)+'</small><b>'+esc(value==null?'—':value)+'</b>'+(scope?'<em>'+esc(scope)+'</em>':'')+'</div>'}
  function latest(rows,source){
    const m=new Map();
    rows.filter(r=>!source||r.source===source).forEach(r=>{const k=norm(r.gamertag);if(!k)return;const p=m.get(k);if(!p||Date.parse(r.source_updated_at||0)>=Date.parse(p.source_updated_at||0))m.set(k,r)});
    return m;
  }
  function zoneRows(raw={}){
    return Array.from({length:16},(_,i)=>({id:i+1,shots:Number(raw['ShotsLocationOnIce'+(i+1)]||0),goals:Number(raw['GoalsLocationOnIce'+(i+1)]||0)}));
  }
  function zoneRowsFromSnapshot(s){
    return Array.from({length:16},(_,i)=>({id:i+1,shots:Number(s?.zone_shots?.[String(i+1)]||0),goals:Number(s?.zone_goals?.[String(i+1)]||0)}));
  }
  function sumPlayers(list){
    const by=new Map();
    list.forEach(p=>zoneRows(p.ea?.raw_stats||{}).forEach(z=>{const x=by.get(z.id)||{id:z.id,shots:0,goals:0};x.shots+=z.shots;x.goals+=z.goals;by.set(z.id,x)}));
    return [...by.values()];
  }
  function profile(rows){
    const model=window.WildmanShotZones?.sumRows(rows);if(!model)return null;
    const ranked=[...model.zones].filter(z=>z.shots>0).sort((a,b)=>b.shots-a.shots);
    const intShots=model.zones.filter(z=>inside.has(z.id)).reduce((n,z)=>n+z.shots,0);
    const intGoals=model.zones.filter(z=>inside.has(z.id)).reduce((n,z)=>n+z.goals,0);
    return {model,ranked,insideShare:model.totalShots?100*intShots/model.totalShots:0,insideGoals:intGoals};
  }
  function autoPlayerScout(p){
    if(p.position==='G'){
      const lg=p.lg||{},ea=p.ea||{};
      return [
        ['Goalie profile','LG: '+fmt(lg.goalie_save_pct,3)+' SV%, '+fmt(lg.goalie_gaa,2)+' GAA over '+fmt(lg.games_played)+' GP. EA club sample: '+fmt(ea.goalie_save_pct,3)+' SV%, '+fmt(ea.goalie_gaa,2)+' GAA.'],
        ['Evidence scope','League totals are used for LG performance. EA values are broader club totals and should be treated as supporting context, not league-only evidence.']
      ];
    }
    const rows=zoneRows(p.ea?.raw_stats||{}),pr=profile(rows),lg=p.lg||{},ea=p.ea||{},raw=ea.raw_stats||{};
    const out=[];
    if(pr?.model.totalShots){
      const a=pr.ranked[0],b=pr.ranked[1],style=pr.insideShare>=55?'interior-heavy':pr.insideShare<=40?'perimeter-heavy':'balanced';
      out.push(['Shot identity',(a? a.name+' is the primary mapped area at '+a.shotShare.toFixed(1)+'% of EA zone shots':'No dominant area')+(b?' with '+b.name+' second at '+b.shotShare.toFixed(1)+'%. ':'. ')+'Overall profile is '+style+' ('+pr.insideShare.toFixed(1)+'% from interior/slot zones).']);
      const fin=[...pr.model.zones].filter(z=>z.goals>0).sort((x,y)=>y.goals-x.goals)[0];
      if(fin)out.push(['Finishing area',fin.name+' has the most mapped goals ('+fin.goals+') with '+fin.efficiency.toFixed(1)+'% conversion in the current EA club sample.']);
    }
    const gp=Number(lg.games_played||0),g=Number(lg.goals||0),a=Number(lg.assists||0),pts=g+a;
    if(gp)out.push(['LG production',pts+' points in '+gp+' LG games ('+(pts/gp).toFixed(2)+' P/GP). '+(a>g*1.4?'The season production leans playmaking/distribution.':g>a?'The season production leans finishing/scoring.':'Goals and assists are relatively balanced.')]);
    const ga=Number(ea.giveaways||raw.skgiveaways||0),ta=Number(ea.takeaways||raw.sktakeaways||0),pass=ea.passing_pct??raw.skpasspct;
    if(ga||ta||pass!=null)out.push(['Puck-management context','EA club totals: '+fmt(pass,1)+'% passing, '+ta+' takeaways, '+ga+' giveaways. Use this as tendency context, not LG-only performance.']);
    out.push(['Defensive instruction',pr?.ranked?.[0]?'Protect '+pr.ranked[0].name+' first, then force attempts toward lower-volume zones. Match the statistical read against VOD before treating it as a hard tactical tendency.':'No reliable zone volume is available yet; use LG production and film evidence instead.']);
    return out;
  }
  function makePlayers(){
    const lg=latest(data.stats,'lg_chl'),ea=latest(data.stats,'ea_nhl27'),hist=new Map(),roster=new Map(),scouts=new Map();
    data.history.forEach(h=>{const k=norm(h.gamertag);if(!hist.has(k))hist.set(k,[]);hist.get(k).push(h)});
    data.roster.forEach(r=>roster.set(norm(r.gamertag),r));
    data.scouts.forEach(r=>scouts.set(norm(r.gamertag),r));
    const keys=new Set([...lg.keys(),...ea.keys(),...hist.keys(),...roster.keys()]);
    players=[...keys].map(k=>{
      const rr=roster.get(k),L=lg.get(k),A=ea.get(k),H=(hist.get(k)||[]).sort((a,b)=>Date.parse(a.captured_at)-Date.parse(b.captured_at));
      return {key:k,name:rr?.gamertag||L?.gamertag||A?.gamertag||H.at(-1)?.gamertag||k,position:rr?.position||L?.position||A?.position||H.at(-1)?.position||'',current:!!rr?.active,roster:rr,lg:L,ea:A,history:H,scout:scouts.get(k)};
    }).sort((a,b)=>(a.current===b.current?0:a.current?-1:1)||(POS[a.position]||9)-(POS[b.position]||9)||String(a.name).localeCompare(String(b.name)));
  }
  function renderKpis(){
    E('hsOpponent').innerHTML=esc(opponent.toUpperCase())+'<br><span>SCOUTING LAB.</span>';
    E('hsScope').textContent='Persistent Season 55 file: current roster, departed players, EA shooting-zone history, official LG games and Calgary scouting notes.';
    E('hsBack').href='hitmen-opponents.html?opponent='+encodeURIComponent(opponent);
    E('hsCurrentCount').textContent=players.filter(p=>p.current).length;
    E('hsTrackedCount').textContent=players.length;
    E('hsSnapshotCount').textContent=data.history.length;
    E('hsGameCount').textContent=data.games.length;
    E('hsEaGameCount').textContent=data.eaGames.length;
  }
  function renderTeam(){
    const current=players.filter(p=>p.current&&p.position!=='G'&&p.ea),rows=sumPlayers(current),pr=profile(rows);
    E('hsTeamHeat').innerHTML=pr?.model.totalShots?window.WildmanShotZones.renderSvg(rows,{metric:'shots',fill:'#d7192d',palette:'broadcast'}):'<div class="hs-empty">No current EA zone data yet.</div>';
    const topScorers=[...players].filter(p=>p.current&&p.lg).sort((a,b)=>Number(b.lg.points||0)-Number(a.lg.points||0)).slice(0,3);
    const items=[];
    if(pr?.ranked?.length){
      items.push(['Primary shooting areas',pr.ranked.slice(0,3).map(z=>z.name+' '+z.shotShare.toFixed(1)+'%').join(' · ')]);
      items.push(['Team shot shape',pr.insideShare.toFixed(1)+'% of mapped EA zone shots come from interior/slot zones across the current skaters.']);
    }
    if(topScorers.length)items.push(['LG scoring leaders',topScorers.map(p=>p.name+' '+(p.lg.points??(Number(p.lg.goals||0)+Number(p.lg.assists||0)))+' PTS').join(' · ')]);
    items.push(['Scope control','The heat map is based on current EA club totals for the skaters on this LG roster. Official LG game files remain separate, so club games are not mislabeled as league-only evidence.']);
    E('hsTeamScout').innerHTML=items.map(x=>'<div class="hs-scout-item"><b>'+esc(x[0])+'</b><p>'+esc(x[1])+'</p></div>').join('');
  }
  function renderPlayers(){
    const q=norm(E('hsSearch').value),list=players.filter(p=>(filter==='all'||p.current)&&(!q||norm(p.name).includes(q)));
    E('hsPlayers').innerHTML=list.length?list.map(p=>{
      const pts=p.lg?.points??((p.lg?.goals!=null||p.lg?.assists!=null)?Number(p.lg?.goals||0)+Number(p.lg?.assists||0):'—');
      return '<button class="hs-player-button '+(selected?.key===p.key?'active':'')+'" data-player="'+esc(p.key)+'"><span class="pos">'+esc(p.position||'—')+'</span><span><strong>'+esc(p.name)+'</strong><small>'+(p.current?'CURRENT':'HISTORICAL')+' · '+(p.history.length)+' shot snapshots</small></span><span class="pts">'+esc(pts)+'</span></button>';
    }).join(''):'<div class="hs-empty">No matching players.</div>';
    E('hsPlayers').querySelectorAll('[data-player]').forEach(b=>b.addEventListener('click',()=>selectPlayer(b.dataset.player)));
  }
  function renderHeat(p){
    if(p.position==='G'){E('hsPlayerHeat').innerHTML='<div class="hs-empty">Goalies do not use the skater shooting-zone map.</div>';E('hsZoneBreakdown').innerHTML='';return}
    const rows=zoneRows(p.ea?.raw_stats||{}),pr=profile(rows);
    if(!pr?.model.totalShots){E('hsPlayerHeat').innerHTML='<div class="hs-empty">No EA shooting-location totals stored for this player yet.</div>';E('hsZoneBreakdown').innerHTML='';return}
    E('hsPlayerHeat').innerHTML=window.WildmanShotZones.renderSvg(rows,{metric,fill:'#d7192d',palette:'broadcast'});
    const max=Math.max(1,...pr.ranked.map(z=>z.shots));
    E('hsZoneBreakdown').innerHTML=pr.ranked.slice(0,6).map(z=>'<div class="hs-zone-row"><b>'+esc(z.name)+'</b><span>'+z.shots+' shots · '+z.goals+' goals · '+z.efficiency.toFixed(1)+'% · '+z.shotShare.toFixed(1)+'% share</span><div class="hs-zone-bar"><i style="width:'+Math.max(2,100*z.shots/max)+'%"></i></div></div>').join('');
  }
  function renderHistory(p){
    const rows=p.history;
    if(!rows.length){E('hsHistory').innerHTML='<div class="hs-empty">No historical EA shot snapshots yet.</div>';return}
    const show=rows.slice(-10);
    E('hsHistory').innerHTML='<table class="hs-history"><thead><tr><th>Captured</th><th>EA GP</th><th>G</th><th>SOG</th><th>ATT</th><th>Δ SOG</th><th>Δ ATT</th><th>Largest new zone</th></tr></thead><tbody>'+show.map((s,i)=>{
      const globalIndex=rows.indexOf(s),prev=globalIndex>0?rows[globalIndex-1]:null;
      const ds=prev?Number(s.shots_on_net||0)-Number(prev.shots_on_net||0):null,da=prev?Number(s.shot_attempts||0)-Number(prev.shot_attempts||0):null;
      let zone='Baseline';
      if(prev){
        const cur=zoneRowsFromSnapshot(s),old=zoneRowsFromSnapshot(prev);
        const deltas=cur.map(z=>({id:z.id,d:z.shots-(old.find(o=>o.id===z.id)?.shots||0)})).sort((a,b)=>b.d-a.d);
        const best=deltas[0];if(best&&best.d>0)zone=(window.WildmanShotZones.byId[best.id]?.name||('Zone '+best.id))+' +'+best.d;else zone='No new mapped shots';
      }
      return '<tr><td>'+esc(new Date(s.captured_at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+'</td><td>'+esc(s.games_played??'—')+'</td><td>'+esc(s.goals??'—')+'</td><td>'+esc(s.shots_on_net??'—')+'</td><td>'+esc(s.shot_attempts??'—')+'</td><td class="'+(ds>0?'delta-plus':'')+'">'+esc(ds==null?'—':(ds>=0?'+':'')+ds)+'</td><td class="'+(da>0?'delta-plus':'')+'">'+esc(da==null?'—':(da>=0?'+':'')+da)+'</td><td>'+esc(zone)+'</td></tr>'
    }).join('')+'</tbody></table>';
  }
  function reportMentions(p){
    const key=String(p.name||'').toLowerCase(),out=[];
    data.reports.forEach(r=>{
      const text=String(r.report||'');
      text.split(/\n{2,}|\n/).forEach(line=>{if(line.toLowerCase().includes(key)&&line.trim().length>8)out.push({date:r.created_at,text:line.trim()})});
      const scout=r.evidence_summary?.line_scout||{};
      Object.values(scout).forEach(v=>{if(typeof v==='string'&&v.toLowerCase().includes(key))out.push({date:r.created_at,text:v})});
    });
    return out.slice(0,4);
  }
  function fillScout(p){
    const s=p.scout||{};
    E('hsScoutSummary').value=s.summary||'';E('hsScoutStrengths').value=s.strengths||'';E('hsScoutConcerns').value=s.concerns||'';
    E('hsScoutTendencies').value=s.tendencies||'';E('hsScoutPlan').value=s.matchup_plan||'';E('hsScoutConfidence').value=s.confidence||'';
    const writable=canWrite();['hsScoutSummary','hsScoutStrengths','hsScoutConcerns','hsScoutTendencies','hsScoutPlan','hsScoutConfidence','hsSaveScout'].forEach(id=>E(id).disabled=!writable);
    E('hsSaveStatus').textContent=writable?'':'View only';
  }
  function selectPlayer(key){
    selected=players.find(p=>p.key===key);if(!selected)return;
    E('hsEmpty').hidden=true;E('hsPlayerDetail').hidden=false;
    const p=selected,lg=p.lg||{},ea=p.ea||{},raw=ea.raw_stats||{};
    E('hsPlayerStatus').textContent=p.current?'CURRENT ROSTER':'HISTORICAL PLAYER';
    E('hsPlayerName').textContent=p.name;E('hsPlayerPos').textContent=p.position||'—';
    E('hsPlayerMeta').textContent=(p.roster?.management_role||p.roster?.roster_role||'Tracked player')+(p.roster?.salary!=null?' · $'+Number(p.roster.salary).toLocaleString():'')+' · '+p.history.length+' saved EA shot snapshots';
    const lgPts=lg.points??((lg.goals!=null||lg.assists!=null)?Number(lg.goals||0)+Number(lg.assists||0):null);
    E('hsPlayerStats').innerHTML=stat('LG GP',lg.games_played,'league')+stat('LG G',lg.goals,'league')+stat('LG A',lg.assists,'league')+stat('LG PTS',lgPts,'league')+
      (p.position==='G'?stat('LG SV%',fmt(lg.goalie_save_pct,3),'league')+stat('LG GAA',fmt(lg.goalie_gaa,2),'league')+stat('EA SV%',fmt(ea.goalie_save_pct,3),'club'):
      stat('EA SHOTS',ea.shots,'club')+stat('EA ATT',raw.skshotattempts??'—','club')+stat('PASS%',fmt(ea.passing_pct??raw.skpasspct,1),'club'))+
      stat('HITS',lg.hits,'league')+stat('TA',lg.takeaways,'league')+stat('GA',lg.giveaways,'league');
    renderHeat(p);renderHistory(p);
    E('hsAutoScout').innerHTML=autoPlayerScout(p).map(x=>'<div class="hs-scout-item"><b>'+esc(x[0])+'</b><p>'+esc(x[1])+'</p></div>').join('');
    const mentions=reportMentions(p);E('hsReportMentions').innerHTML=mentions.length?'<div class="eyebrow">EXISTING REPORT MENTIONS</div>'+mentions.map(m=>'<div class="hs-mention"><b>'+esc(new Date(m.date).toLocaleDateString())+'</b> · '+esc(m.text)+'</div>').join(''):'';
    fillScout(p);renderPlayers();
  }
  async function saveScout(){
    if(!selected||!canWrite())return;
    const b=E('hsSaveScout');b.disabled=true;E('hsSaveStatus').textContent='Saving…';
    const row={team_id:TEAM,season:SEASON,opponent_name:opponent,gamertag:selected.name,summary:E('hsScoutSummary').value.trim(),strengths:E('hsScoutStrengths').value.trim(),concerns:E('hsScoutConcerns').value.trim(),tendencies:E('hsScoutTendencies').value.trim(),matchup_plan:E('hsScoutPlan').value.trim(),confidence:E('hsScoutConfidence').value?Number(E('hsScoutConfidence').value):null,updated_by:ST().user?.id,updated_at:new Date().toISOString()};
    try{
      let res;
      if(selected.scout?.id)res=await DB().from('hitmen_opponent_player_scout_reports').update(row).eq('id',selected.scout.id).select().single();
      else res=await DB().from('hitmen_opponent_player_scout_reports').insert({...row,created_by:ST().user?.id}).select().single();
      if(res.error)throw res.error;selected.scout=res.data;E('hsSaveStatus').textContent='Saved '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    }catch(e){E('hsSaveStatus').textContent='Save failed: '+(e.message||e)}
    finally{b.disabled=!canWrite()}
  }
  async function load(){
    if(!opponent||!DB()||!ST().user)return;
    try{
      const q=await Promise.all([
        DB().from('hitmen_opponent_roster_players').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',opponent),
        DB().from('hitmen_opponent_player_stats').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',opponent),
        DB().from('hitmen_opponent_player_shot_history').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',opponent).order('captured_at',{ascending:true}),
        DB().from('hitmen_opponent_lg_games').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',opponent).order('played_at',{ascending:true}),
        DB().from('hitmen_opponent_ea_games').select('source_game_id,lg_game_id,played_at,verified_official').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',opponent).eq('verified_official',true),
        DB().from('hitmen_opponent_pregame_reports').select('id,created_at,report,evidence_summary').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',opponent).order('created_at',{ascending:false}).limit(12),
        DB().from('hitmen_opponent_player_scout_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('opponent_name',opponent)
      ]);
      const er=q.find(x=>x.error);if(er)throw er.error;
      [data.roster,data.stats,data.history,data.games,data.eaGames,data.reports,data.scouts]=q.map(x=>x.data||[]);
      makePlayers();renderKpis();renderTeam();renderPlayers();
      const first=players.find(p=>p.current&&p.position!=='G')||players.find(p=>p.current)||players[0];if(first)selectPlayer(first.key);
    }catch(e){console.error(e);E('hsScope').textContent='Could not load scouting data: '+(e.message||e)}
  }
  function bind(){
    E('hsSearch')?.addEventListener('input',renderPlayers);
    document.querySelectorAll('[data-hs-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.hsFilter;document.querySelectorAll('[data-hs-filter]').forEach(x=>x.classList.toggle('active',x===b));renderPlayers()}));
    document.querySelectorAll('[data-hs-metric]').forEach(b=>b.addEventListener('click',()=>{metric=b.dataset.hsMetric;document.querySelectorAll('[data-hs-metric]').forEach(x=>x.classList.toggle('active',x===b));if(selected)renderHeat(selected)}));
    E('hsSaveScout')?.addEventListener('click',saveScout);
    if(!opponent)E('hsScope').textContent='Open this page from an opponent file so the team can be identified.';
  }
  window.addEventListener('vvhl-auth-change',()=>load());
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{bind();setTimeout(load,150)});else{bind();setTimeout(load,150)}
})();