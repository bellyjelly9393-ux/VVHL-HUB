(() => {
  const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
  const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
  const pct=(a,b)=>b?((a/b)*100).toFixed(1)+'%':'—';
  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'').trim();
  let breakdown=null,lockers=[];

  function member(){return (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false)}
  function allow(){return Boolean(ST().user&&(String(ST().profile?.role||'').toLowerCase()==='admin'||member()||ST().hitmenLockerClaim?.matched===true))}
  function canManage(){
    const pr=String(ST().profile?.role||'').toLowerCase();
    return pr==='admin'||['owner','gm','agm'].includes(String(member()?.role||'').toLowerCase());
  }
  async function token(){
    const {data,error}=await DB().auth.getSession();if(error)throw error;
    if(!data.session?.access_token)throw new Error('Sign in again.');
    return data.session.access_token;
  }
  function gameId(){return new URLSearchParams(location.search).get('game')||''}
  function setStatus(t,bad=false){const el=E('hgrStatus');if(el){el.textContent=t||'';el.style.color=bad?'#ff9ca9':'#9ff4bc'}}
  function sourceStatus(t,bad=false){const el=E('hgrSourceStatus');if(el){el.textContent=t||'';el.style.color=bad?'#ff9ca9':'#9ff4bc'}}

  function metric(label,value){return '<div class="hgr-metric"><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>'}
  function stat(s,key){return n(s?.[key])}
  function points(p){return stat(p.stats,'points')||stat(p.stats,'goals')+stat(p.stats,'assists')}
  function playerImpact(p){
    const s=p.stats||{};
    if(String(p.position).toUpperCase()==='G')return stat(s,'saves')+(n(s.save_pct_derived)||0)/10;
    return points(p)*20+stat(s,'goals')*5+stat(s,'takeaways')*2+stat(s,'interceptions')-stat(s,'giveaways')*.25+stat(s,'plus_minus')*2;
  }

  function analystText(g,players){
    const s=g.team_stats||{},opp=g.opponent_stats||{};
    const win=n(g.calgary_score)>n(g.opponent_score),margin=Math.abs(n(g.calgary_score)-n(g.opponent_score));
    const shots=stat(s,'shots'),goals=n(g.calgary_score),shootPct=shots?goals/shots*100:0;
    const passC=stat(s,'pass_completions'),passA=stat(s,'pass_attempts');
    const tk=stat(s,'takeaways'),gv=stat(s,'giveaways');
    const foW=stat(s,'faceoff_wins'),foL=stat(s,'faceoff_losses');
    const saves=stat(s,'saves'),faced=stat(s,'shots_faced');
    const oppShots=stat(opp,'shots')||faced;
    const leaders=[...players].sort((a,b)=>playerImpact(b)-playerImpact(a)).slice(0,3);

    const parts=[];
    parts.push('Calgary '+(win?'earned':'dropped')+' a '+g.calgary_score+'-'+g.opponent_score+(g.overtime?' overtime':'')+' decision against '+g.opponent_name+'. '+(margin===1?'The one-goal margin made puck management and single-possession execution matter more than raw volume.':win?'The scoreboard margin gave Calgary some room, but the underlying numbers still show where the game was clean and where it was expensive.':'The final margin was manageable enough that the correction list is more useful than treating the game like a structural disaster.'));

    if(shots){
      if(shootPct>=25)parts.push('Offensively, Calgary finished at '+shootPct.toFixed(1)+'% on '+shots+' shots. That is high-end conversion, so the scoring result was driven more by finishing quality than by overwhelming shot volume.');
      else if(shootPct>=15)parts.push('Calgary produced '+shots+' shots and converted '+shootPct.toFixed(1)+'%. The offense created enough finishing to stay dangerous without needing a massive shot count.');
      else parts.push('Calgary generated '+shots+' shots but converted only '+shootPct.toFixed(1)+'%. The next offensive step is turning possession into cleaner looks rather than simply adding low-value attempts.');
    }
    if(passA)parts.push('The passing line was '+passC+' completions on '+passA+' attempts ('+pct(passC,passA)+'). '+(passC/passA>=.78?'That supports a fairly controlled puck-movement night.':'That leaves room to simplify exits and middle-lane decisions when pressure closes.'));
    if(gv||tk)parts.push('The biggest caution in the Calgary stat line is possession security: '+gv+' giveaways against '+tk+' takeaways. Those totals are not a tactical diagnosis by themselves, but the gap is large enough to flag puck decisions as the first film-check item.');
    if(foW+foL)parts.push('At center, Calgary went '+foW+'-'+foL+' on draws ('+pct(foW,foW+foL)+'). '+(foW>foL?'That helped create more controlled first touches.':'That meant more shifts began with recovery work instead of immediate possession.'));
    if(faced)parts.push('In goal, Calgary stopped '+saves+' of '+faced+' shots ('+pct(saves,faced)+'). '+(saves/faced>=.85?'That was a stabilizing layer behind the team.':'That number says the group cannot rely on the goalie to erase every breakdown, so shot quality against matters in the film review.'));
    if(oppShots&&shots)parts.push('The tracked shot picture was Calgary '+shots+' to opponent '+oppShots+'. This is a stats-based read, not a claim about territory or chance quality until the VOD confirms it.');
    if(leaders.length)parts.push('The strongest individual stat impacts came from '+leaders.map(p=>p.gamertag+' ('+(String(p.position).toUpperCase()==='G'?stat(p.stats,'saves')+' saves':points(p)+' pts')+')').join(', ')+'.');

    return parts;
  }

  function notesHtml(g){
    const items=[
      ['What worked',g.what_worked],
      ['What failed',g.what_failed],
      ['Opponent takeaways',g.opponent_takeaways],
      ['Matchup / VOD notes',g.matchup_notes]
    ].filter(([,v])=>v);
    return items.length?'<div class="hgr-notes">'+items.map(([k,v])=>'<div class="hgr-note"><small>'+esc(k)+'</small><p>'+esc(v)+'</p></div>').join('')+'</div>':'<div class="gc-empty">No coaching notes have been attached yet. The analyst section above is generated only from verified game stats.</div>';
  }

  function render(){
    if(!breakdown)return;
    const g=breakdown.game,p=breakdown.players||[];
    const win=n(g.calgary_score)>n(g.opponent_score);
    const dt=g.scheduled_at?new Date(g.scheduled_at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Season 55';
    E('hgrHero').innerHTML='<div><div class="hgr-kicker">LGCHL SEASON 55 · WEEK '+esc(g.week||'—')+'</div><h1 class="hgr-title">CALGARY <em>vs '+esc(g.opponent_name)+'</em></h1><div class="hgr-meta"><span>'+esc(dt)+'</span><span>'+esc(g.source_label||'Verified team stat import')+'</span></div></div><div class="hgr-scorebox"><small>FINAL</small><strong>'+esc(g.calgary_score)+'-'+esc(g.opponent_score)+'</strong><span class="'+(win?'win':'loss')+'">'+(win?'WIN':'LOSS')+(g.overtime?' · OT':'')+'</span></div>';

    const s=g.team_stats||{};
    const passC=stat(s,'pass_completions'),passA=stat(s,'pass_attempts'),foW=stat(s,'faceoff_wins'),foL=stat(s,'faceoff_losses'),saves=stat(s,'saves'),faced=stat(s,'shots_faced');
    const narrative=analystText(g,p);
    E('hgrAnalyst').innerHTML='<article class="hgr-card"><div class="gc-card-head"><div><small>HOCKEY OPS</small><h2>ANALYST BREAKDOWN</h2></div><span>STATS-BASED</span></div><div class="hgr-analyst-copy">'+narrative.map(x=>'<p>'+esc(x)+'</p>').join('')+'</div></article><article class="hgr-card"><div class="gc-card-head"><div><small>BY THE NUMBERS</small><h2>CALGARY PROFILE</h2></div></div><div class="hgr-metrics">'+metric('Shots',stat(s,'shots'))+metric('Shooting',stat(s,'shots')?((n(g.calgary_score)/stat(s,'shots'))*100).toFixed(1)+'%':'—')+metric('Pass %',pct(passC,passA))+metric('FO %',pct(foW,foW+foL))+metric('Takeaway / Giveaway',stat(s,'takeaways')+' / '+stat(s,'giveaways'))+metric('Goalie SV%',pct(saves,faced))+'</div></article><article class="hgr-card" style="grid-column:1/-1"><div class="gc-card-head"><div><small>COACHING LAYER</small><h2>GAME NOTES</h2></div></div>'+notesHtml(g)+'</article>';

    const order={LW:1,C:2,RW:3,LD:4,RD:5,G:6};
    p.sort((a,b)=>(order[a.position]||9)-(order[b.position]||9));
    E('hgrPlayers').innerHTML=p.length?'<table class="hgr-table"><thead><tr><th>Player</th><th>Pos</th><th>G</th><th>A</th><th>PTS</th><th>+/-</th><th>SH</th><th>HIT</th><th>TK</th><th>GV</th><th>INT</th><th>PASS%</th><th>FO%</th><th>SV</th><th>SV%</th></tr></thead><tbody>'+p.map(x=>{const s=x.stats||{},gpos=String(x.position).toUpperCase()==='G';return '<tr><td>'+esc(x.gamertag)+'</td><td>'+esc(x.position||'—')+'</td><td class="'+(stat(s,'goals')?'hot':'')+'">'+stat(s,'goals')+'</td><td>'+stat(s,'assists')+'</td><td class="'+(points(x)>=3?'hot':'')+'">'+points(x)+'</td><td>'+esc(s.plus_minus??'—')+'</td><td>'+esc(s.shots??'—')+'</td><td>'+esc(s.hits??'—')+'</td><td>'+esc(s.takeaways??'—')+'</td><td>'+esc(s.giveaways??'—')+'</td><td>'+esc(s.interceptions??'—')+'</td><td>'+esc(s.passing_pct!=null?Number(s.passing_pct).toFixed(1)+'%':'—')+'</td><td>'+esc(s.faceoff_pct!=null?Number(s.faceoff_pct).toFixed(1)+'%':'—')+'</td><td>'+esc(gpos?(s.saves??'—'):'—')+'</td><td>'+esc(gpos?(s.save_pct_derived!=null?Number(s.save_pct_derived).toFixed(1)+'%':pct(stat(s,'saves'),stat(s,'shots_faced'))):'—')+'</td></tr>'}).join('')+'</tbody></table>':'<div class="gc-empty">No player box score has been linked to this result yet.</div>';

    E('hgrSourceBadge').textContent=(g.source_label||'STATS').toUpperCase();
    if(E('hgrSourceUrl'))E('hgrSourceUrl').value=g.source_url||'';
    E('hgrSourcePanel').hidden=!canManage();
    setStatus('Game breakdown loaded · '+p.length+' Calgary player stat lines.');
  }

  async function load(){
    const ok=allow();
    E('gameReportApp').hidden=!ok;E('gameReportLocked').hidden=ok;
    document.querySelector('.gc-access-shell').hidden=ok;
    if(!ok||!DB())return;
    const id=gameId();if(!id)return setStatus('No game was selected.',true);
    const r=await DB().rpc('get_hitmen_team_game_breakdown',{p_game_id:id});
    if(r.error){console.error(r.error);return setStatus(r.error.message||'Could not load this game.',true)}
    breakdown=r.data;
    render();
  }

  function headerKey(v){
    const raw=String(v||'').toLowerCase().trim(),compact=raw.replace(/[^a-z0-9%+/-]/g,'');
    const aliases={player:['player','gamertag','gt','username','user','name'],position:['pos','position'],goals:['g','goals'],assists:['a','assists'],points:['p','pts','points'],plus_minus:['+/-','plusminus'],shots:['sh','shots','sog'],hits:['hits','hit'],takeaways:['ta','takeaways'],giveaways:['gv','gva','giveaways'],interceptions:['int','interceptions'],pim:['pim','pims'],faceoff_wins:['fow','faceoffwins'],faceoff_losses:['fol','faceofflosses'],passing_pct:['pass%','passing%','passpct'],goalie_saves:['sv','saves'],goalie_shots:['sa','shotsagainst'],save_pct:['sv%','save%','savepct']};
    for(const [k,list] of Object.entries(aliases))if(list.some(x=>compact===x.replace(/[^a-z0-9%+/-]/g,'')))return k;
    return null;
  }
  function detectLg(data){
    let best=null;
    for(const table of data?.tables||[])for(let i=0;i<Math.min(table.rows.length,8);i++){
      const map={};table.rows[i].forEach((cell,idx)=>{const k=headerKey(cell);if(k&&map[k]===undefined)map[k]=idx});
      const score=Object.keys(map).length+(map.player!==undefined?6:0);
      if(!best||score>best.score)best={table,headerRow:i,map,score};
    }
    return best&&best.score>=7?best:null;
  }
  async function loadLockers(){
    if(lockers.length)return lockers;
    const r=await DB().from('team_player_lockers').select('id,gamertag,position').eq('team_id',TEAM).eq('season',SEASON);
    if(r.error)throw r.error;lockers=r.data||[];return lockers;
  }
  function matchLocker(name){const key=norm(name);return lockers.find(l=>{const g=norm(l.gamertag);return g&&(g===key||g.includes(key)||key.includes(g))})||null}
  async function savePlayerStats(rows,sourceLabel,url){
    const g=breakdown.game,user=ST().user;
    for(const row of rows){
      const existing=await DB().from('team_player_game_reports').select('id').eq('schedule_game_id',g.id).eq('locker_id',row.locker_id).maybeSingle();
      if(existing.error)throw existing.error;
      const payload={team_id:TEAM,season:SEASON,locker_id:row.locker_id,schedule_game_id:g.id,week:g.week,game_date:g.scheduled_at,opponent_name:g.opponent_name,position_played:row.position,result:(n(g.calgary_score)>n(g.opponent_score)?'W ':'L ')+g.calgary_score+'-'+g.opponent_score,stats:row.stats,evidence:{source:sourceLabel,source_url:url},visibility:'player',updated_at:new Date().toISOString()};
      const saved=existing.data?.id?await DB().from('team_player_game_reports').update(payload).eq('id',existing.data.id):await DB().from('team_player_game_reports').insert({...payload,created_by:user.id});
      if(saved.error)throw saved.error;
    }
    const aggregate=rows.reduce((a,r)=>{const s=r.stats||{};for(const k of ['goals','assists','shots','hits','takeaways','giveaways','interceptions','blocked_shots','pim','pass_completions','pass_attempts','faceoff_wins','faceoff_losses','saves','shots_faced','goals_against'])a[k]=(a[k]||0)+stat(s,k);return a},{});
    const up=await DB().from('hitmen_schedule_games').update({team_stats:aggregate,source_url:url,source_label:sourceLabel,updated_by:user.id,updated_at:new Date().toISOString()}).eq('id',g.id);
    if(up.error)throw up.error;
  }

  async function importLg(url){
    const response=await fetch('/api/lg-public-stats?url='+encodeURIComponent(url),{cache:'no-store'});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'LeagueGaming pull failed.');
    const d=detectLg(data);if(!d)throw new Error('A player-stat table could not be detected on that public LG page.');
    await loadLockers();
    const rows=[];
    for(const cells of d.table.rows.slice(d.headerRow+1)){
      const locker=matchLocker(cells[d.map.player]);if(!locker)continue;
      const get=k=>d.map[k]===undefined?null:cells[d.map[k]];
      const num=k=>{const x=Number(String(get(k)??'0').replace(/[^0-9.-]/g,''));return Number.isFinite(x)?x:0};
      rows.push({locker_id:locker.id,position:locker.position,stats:{goals:num('goals'),assists:num('assists'),points:d.map.points===undefined?num('goals')+num('assists'):num('points'),plus_minus:d.map.plus_minus===undefined?null:num('plus_minus'),shots:d.map.shots===undefined?null:num('shots'),hits:d.map.hits===undefined?null:num('hits'),takeaways:d.map.takeaways===undefined?null:num('takeaways'),giveaways:d.map.giveaways===undefined?null:num('giveaways'),interceptions:d.map.interceptions===undefined?null:num('interceptions'),pim:d.map.pim===undefined?null:num('pim'),faceoff_wins:d.map.faceoff_wins===undefined?null:num('faceoff_wins'),faceoff_losses:d.map.faceoff_losses===undefined?null:num('faceoff_losses'),passing_pct:d.map.passing_pct===undefined?null:num('passing_pct'),saves:d.map.goalie_saves===undefined?null:num('goalie_saves'),shots_faced:d.map.goalie_shots===undefined?null:num('goalie_shots'),save_pct_derived:d.map.save_pct===undefined?null:num('save_pct')}});
    }
    if(!rows.length)throw new Error('The LG page loaded, but none of its player names matched the Hitmen roster.');
    await savePlayerStats(rows,'LeagueGaming public game page',url);
  }

  function eaPlayerStats(raw){
    const goals=n(raw.skgoals),assists=n(raw.skassists);
    return {goals,assists,points:goals+assists,plus_minus:n(raw.skplusmin),shots:n(raw.skshots),shot_attempts:n(raw.skshotattempts),hits:n(raw.skhits),takeaways:n(raw.sktakeaways),giveaways:n(raw.skgiveaways),interceptions:n(raw.skinterceptions),blocked_shots:n(raw.skbs),pim:n(raw.skpim),faceoff_wins:n(raw.skfow),faceoff_losses:n(raw.skfol),faceoff_pct:n(raw.skfopct),pass_completions:n(raw.skpasses),pass_attempts:n(raw.skpassattempts),passing_pct:n(raw.skpasspct),puckpos:n(raw.skpossession),saves:n(raw.glsaves),shots_faced:n(raw.glshots),goals_against:n(raw.glga),save_pct_derived:n(raw.glsavepct)*100,ea_rating_offense:n(raw.ratingOffense),ea_rating_defense:n(raw.ratingDefense),ea_rating_teamplay:n(raw.ratingTeamplay)};
  }
  async function importEa(url){
    const t=await token();
    const response=await fetch('/api/hitmen-game-source',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({url})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'EA/ChelStats pull failed.');
    await loadLockers();
    const clubEntries=Object.entries(data.game?.players||{});
    let best=null;
    for(const [clubId,players] of clubEntries){
      const list=Object.values(players||{});const matched=list.filter(p=>matchLocker(p.playername)).length;
      if(!best||matched>best.matched)best={clubId,players:list,matched};
    }
    if(!best||!best.matched)throw new Error('The public EA game loaded, but its players do not match the current Hitmen roster.');
    const rows=best.players.map(raw=>{const locker=matchLocker(raw.playername);return locker?{locker_id:locker.id,position:locker.position,stats:eaPlayerStats(raw)}:null}).filter(Boolean);
    await savePlayerStats(rows,'EA / ChelStats public game feed',url);
    const clubs=data.game?.clubs||{},cal=clubs[best.clubId]||{},other=Object.entries(clubs).find(([id])=>id!==best.clubId)?.[1]||{};
    const up=await DB().from('hitmen_schedule_games').update({
      calgary_score:n(cal.score||breakdown.game.calgary_score),opponent_score:n(cal.opponentScore||other.score||breakdown.game.opponent_score),
      team_stats:{...(breakdown.game.team_stats||{}),shots:n(cal.shots),pass_completions:n(cal.passc),pass_attempts:n(cal.passa),toa:n(cal.toa),pp_goals:n(cal.ppg),pp_opportunities:n(cal.ppo)},
      opponent_stats:{shots:n(other.shots),pass_completions:n(other.passc),pass_attempts:n(other.passa),toa:n(other.toa),pp_goals:n(other.ppg),pp_opportunities:n(other.ppo)},
      source_url:url,source_label:'EA / ChelStats public game feed',updated_by:ST().user.id,updated_at:new Date().toISOString()
    }).eq('id',breakdown.game.id);
    if(up.error)throw up.error;
  }

  async function pullSource(){
    if(!canManage())return;
    const url=String(E('hgrSourceUrl')?.value||'').trim();if(!url)return sourceStatus('Paste a public game source URL first.',true);
    E('hgrPullSource').disabled=true;sourceStatus('Pulling public stats and matching Hitmen gamertags…');
    try{
      const host=new URL(url).hostname.toLowerCase();
      if(host.endsWith('leaguegaming.com'))await importLg(url);
      else if(host==='chelstats.app'||host==='proclubs.ea.com')await importEa(url);
      else throw new Error('Use a public LeagueGaming, ChelStats, or EA Pro Clubs game source.');
      sourceStatus('Stats imported. Rebuilding the game breakdown…');
      await load();
    }catch(e){console.error(e);sourceStatus(e.message||'Public stat import failed.',true)}
    finally{E('hgrPullSource').disabled=false}
  }

  E('hgrPullSource')?.addEventListener('click',pullSource);
  window.addEventListener('vvhl-auth-change',load);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();