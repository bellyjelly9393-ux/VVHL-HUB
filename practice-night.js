(() => {
  const db = window.VVHLBackend?.db;
  if (!db) return;

  const SANDBOX_SLUG = 'wildman-tournament-sandbox';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => Number(v) || 0;
  const S = {event:null,teams:[],players:[],rosters:[],games:[],gameStats:[],teamStats:[],playerStats:[],selectedGameId:'',timer:null,busy:false,log:[]};

  const team = id => S.teams.find(x => x.id === id);
  const player = id => S.players.find(x => x.id === id);
  const selectedGame = () => S.games.find(x => x.id === S.selectedGameId);
  const rosterFor = teamId => S.rosters.filter(r => r.team_id === teamId && r.active !== false);
  const playerLabel = id => player(id)?.gamertag || 'Player';
  const rand = max => Math.floor(Math.random() * max);
  const pick = arr => arr.length ? arr[rand(arr.length)] : null;
  const fmt = v => v ? new Date(v).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'TBD';

  function message(id, text, bad=false){ const el=$(id); if(el){el.textContent=text;el.style.color=bad?'#ff9a9a':'#9ff4bc';} }
  function log(text){
    S.log.unshift({at:new Date(),text});
    S.log=S.log.slice(0,80);
    renderLog();
  }
  function renderLog(){
    const root=$('practiceLog'); if(!root)return;
    root.innerHTML=S.log.length?S.log.map(x=>`<div class="practice-log-entry"><b>${esc(x.at.toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'}))}</b><span>${esc(x.text)}</span></div>`).join(''):'<div class="empty-state">Waiting for the first practice action.</div>';
  }

  function twitchChannel(raw){try{const u=new URL(raw);return u.pathname.split('/').filter(Boolean).pop()||'';}catch{return '';}}
  function youtubeId(raw){try{const u=new URL(raw);if(u.hostname.includes('youtu.be'))return u.pathname.slice(1);if(u.searchParams.get('v'))return u.searchParams.get('v');const p=u.pathname.split('/').filter(Boolean),i=p.findIndex(x=>x==='embed'||x==='live');return i>=0?p[i+1]||'':'';}catch{return '';}}
  function streamEmbed(g){
    const root=$('practiceStreamStage'); if(!root)return;
    if(!g?.stream_url){root.innerHTML='<div class="featured-placeholder"><div><strong>Stream not attached</strong><p>Paste your stream above when you go live tonight.</p></div></div>';return;}
    const provider=String(g.stream_provider||'').toLowerCase();
    if(provider==='twitch'){
      const ch=twitchChannel(g.stream_url);
      if(ch){root.innerHTML=`<iframe src="https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${encodeURIComponent(location.hostname)}&autoplay=false" allowfullscreen title="Practice Twitch stream"></iframe>`;return;}
    }
    if(provider==='youtube'){
      const id=youtubeId(g.stream_url);
      if(id){root.innerHTML=`<iframe src="https://www.youtube.com/embed/${encodeURIComponent(id)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="Practice YouTube stream"></iframe>`;return;}
    }
    root.innerHTML=`<div class="featured-placeholder"><div><strong>External stream attached</strong><p>This provider opens outside the page.</p><a class="btn btn-primary" href="${esc(g.stream_url)}" target="_blank" rel="noopener">Open Stream</a></div></div>`;
  }

  async function loadData(silent=false){
    const eventRes=await db.from('esports_events').select('*').eq('slug',SANDBOX_SLUG).maybeSingle();
    if(eventRes.error || !eventRes.data){ if(!silent) message('practiceMessage','Sandbox event could not be loaded.',true); return; }
    S.event=eventRes.data;
    const eventId=S.event.id;
    const [teams,players,rosters,games,gameStats,teamStats,playerStats]=await Promise.all([
      db.from('esports_teams').select('*').order('name'),
      db.from('esports_players').select('*').order('gamertag'),
      db.from('esports_event_rosters').select('*').eq('event_id',eventId),
      db.from('esports_games').select('*').eq('event_id',eventId).order('scheduled_at'),
      db.from('esports_game_player_stats').select('*').eq('event_id',eventId),
      db.from('esports_team_event_stats').select('*').eq('event_id',eventId),
      db.from('esports_player_event_stats').select('*').eq('event_id',eventId)
    ]);
    const err=[teams,players,rosters,games,gameStats,teamStats,playerStats].find(x=>x.error)?.error;
    if(err){console.error(err);if(!silent)message('practiceMessage','Practice data refresh failed.',true);return;}
    Object.assign(S,{teams:teams.data||[],players:players.data||[],rosters:rosters.data||[],games:games.data||[],gameStats:gameStats.data||[],teamStats:teamStats.data||[],playerStats:playerStats.data||[]});
    if(!S.selectedGameId || !S.games.some(g=>g.id===S.selectedGameId)) S.selectedGameId=S.games.find(g=>g.status!=='final')?.id||S.games[0]?.id||'';
    render();
  }

  function render(){
    const g=selectedGame();
    $('practiceEvent').textContent=S.event?.name||'Sandbox';
    $('practiceMode').textContent=S.timer?'RUNNING':'READY';
    $('practiceModeSub').textContent=S.timer?'Autopilot advancing':'Autopilot stopped';
    $('practiceGame').textContent=g?`${S.games.indexOf(g)+1}/${S.games.length}`:'—';
    $('practiceGameSub').textContent=g?`${team(g.home_team_id)?.name||'Home'} vs ${team(g.away_team_id)?.name||'Away'}`:'No game selected';

    const sel=$('practiceGameSelect');
    if(sel){const prev=S.selectedGameId;sel.innerHTML=S.games.map((x,i)=>`<option value="${x.id}" ${x.id===prev?'selected':''}>Game ${i+1} · ${esc(team(x.home_team_id)?.name||'Home')} vs ${esc(team(x.away_team_id)?.name||'Away')} · ${esc(x.status.toUpperCase())}</option>`).join('');sel.value=prev;}

    if(g){
      $('practiceHomeName').textContent=team(g.home_team_id)?.name||'HOME'; $('practiceAwayName').textContent=team(g.away_team_id)?.name||'AWAY';
      $('practiceHomeScore').textContent=g.home_score??0; $('practiceAwayScore').textContent=g.away_score??0;
      $('practicePeriod').textContent=g.status==='final'?'FINAL':g.status==='live'?(g.overtime?'OT':`P${g.period||1}`):'PRE';
      $('practiceClock').textContent=g.status==='final'?'0:00':g.clock||'20:00';
      $('practiceRound').textContent=g.round_label||g.stage||'Sandbox';
      $('practiceLiveStatus').textContent=g.status.toUpperCase();
      $('practiceStreamProvider').value=g.stream_provider||'twitch';
      $('practiceStreamUrl').value=g.stream_url||'';
      $('practiceBroadcastTitle').value=g.broadcast_title||'Wildman Practice Night';
      $('openPracticeStream').href=g.stream_url||'#';
      streamEmbed(g);
    }
    renderNextAction(); renderChecklist(); renderStandings(); renderLeaderboard();
  }

  function renderNextAction(){
    const g=selectedGame(); let title='LOAD DATA',sub='Preparing sandbox';
    if(g){
      if(g.status==='scheduled'){title='START GAME';sub='Autopilot will switch this matchup to LIVE.';}
      else if(g.status==='live' && (g.period||1)===1){title='WATCH LIVE';sub='Score, clock and player stats are being simulated.';}
      else if(g.status==='live' && (g.period||1)===2){title='MIDGAME CHECK';sub='Verify stream, scoreboard and leaderboard updates.';}
      else if(g.status==='live' && (g.period||1)>=3){title='PREP FINAL';sub='Next steps test finalization and standings rebuild.';}
      else if(g.status==='final'){
        const next=S.games.find(x=>x.status!=='final');
        title=next?'NEXT GAME':'SERIES COMPLETE';sub=next?'Move into the next sandbox matchup.':'Review standings, leaderboard and postgame handoff.';
      }
    }
    $('nextAction').textContent=title;$('nextActionSub').textContent=sub;
  }

  function renderChecklist(){
    const g=selectedGame(); const statsForGame=S.gameStats.filter(x=>x.game_id===g?.id);
    const checks=[
      ['Stream attached',!!g?.stream_url,'Broadcast source is connected'],
      ['Game switched live',!!g && ['live','final'].includes(g.status),'Scheduled → Live transition'],
      ['Scoreboard changed',!!g && (num(g.home_score)+num(g.away_score)>0),'Score updates reached database'],
      ['Player stats written',statsForGame.length>0,'Game-level stats exist'],
      ['Leaderboard rebuilt',S.playerStats.length>0,'Event player totals exist'],
      ['Standings rebuilt',S.teamStats.some(x=>num(x.games_played)>0),'Final game changed standings'],
      ['Practice series complete',S.games.length>0&&S.games.every(x=>x.status==='final'),'All sandbox games finalized']
    ];
    const done=checks.filter(x=>x[1]).length; $('checklistProgress').textContent=`${done}/${checks.length}`;
    $('practiceChecklist').innerHTML=checks.map(([name,ok,note])=>`<div class="practice-check ${ok?'done':''}"><i>${ok?'✓':'·'}</i><div><strong>${esc(name)}</strong><small>${esc(note)}</small></div></div>`).join('');
  }

  function renderStandings(){
    const root=$('practiceStandings'); if(!root)return;
    const rows=[...S.teamStats].sort((a,b)=>(a.seed??999)-(b.seed??999)||num(b.points)-num(a.points));
    if(!rows.length){root.innerHTML='<div class="empty-state">Standings will populate as sandbox games finish.</div>';return;}
    root.innerHTML=`<div class="practice-table-wrap"><table class="practice-table"><thead><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>GF</th><th>GA</th><th>PTS</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${r.seed??i+1}</td><td><strong>${esc(team(r.team_id)?.name||'Team')}</strong></td><td>${num(r.games_played)}</td><td>${num(r.wins)}</td><td>${num(r.losses)}</td><td>${num(r.ot_losses)}</td><td>${num(r.goals_for)}</td><td>${num(r.goals_against)}</td><td><strong>${num(r.points)}</strong></td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderLeaderboard(){
    const root=$('practiceLeaderboard'); if(!root)return;
    const rows=[...S.playerStats].sort((a,b)=>num(b.points)-num(a.points)||num(b.goals)-num(a.goals)||num(b.shots)-num(a.shots));
    if(!rows.length){root.innerHTML='<div class="empty-state">Player totals will populate as the simulation generates fake game data.</div>';return;}
    root.innerHTML=`<div class="practice-table-wrap"><table class="practice-table"><thead><tr><th>#</th><th>GT</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th><th>Shots</th><th>Hits</th><th>SV%</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(playerLabel(r.player_id))}</strong></td><td>${esc(team(r.team_id)?.name||'—')}</td><td>${num(r.games_played)}</td><td>${num(r.goals)}</td><td>${num(r.assists)}</td><td><strong>${num(r.points)}</strong></td><td>${num(r.plus_minus)}</td><td>${num(r.shots)}</td><td>${num(r.hits)}</td><td>${num(r.goalie_shots)?(100*num(r.goalie_saves)/num(r.goalie_shots)).toFixed(1)+'%':'—'}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function gameStep(g){const m=String(g.commentary_label||'').match(/SANDBOX_STEP:(\d+)/);return m?Number(m[1]):0;}
  function blankStat(game, r){return {game_id:game.id,event_id:game.event_id,team_id:r.team_id,player_id:r.player_id,position:r.position||player(r.player_id)?.primary_position||null,goals:0,assists:0,points:0,plus_minus:0,shots:0,hits:0,takeaways:0,giveaways:0,interceptions:0,blocked_shots:0,pim:0,faceoff_wins:0,faceoff_losses:0,goalie_shots:0,goalie_saves:0,goalie_goals_against:0,save_pct:null,source_provider:'sandbox_sim'};}

  async function generateMoment(game, scoringTeamId=null){
    const roster=[...rosterFor(game.home_team_id),...rosterFor(game.away_team_id)];
    const existing=new Map(S.gameStats.filter(x=>x.game_id===game.id).map(x=>[x.player_id,{...x}]));
    const rows=roster.map(r=>existing.get(r.player_id)||blankStat(game,r));
    const homeSkaters=rosterFor(game.home_team_id).filter(r=>String(r.position||player(r.player_id)?.primary_position||'').toUpperCase()!=='G');
    const awaySkaters=rosterFor(game.away_team_id).filter(r=>String(r.position||player(r.player_id)?.primary_position||'').toUpperCase()!=='G');
    const homeGoalie=rosterFor(game.home_team_id).find(r=>String(r.position||player(r.player_id)?.primary_position||'').toUpperCase()==='G');
    const awayGoalie=rosterFor(game.away_team_id).find(r=>String(r.position||player(r.player_id)?.primary_position||'').toUpperCase()==='G');

    const homeShots=3+rand(5), awayShots=3+rand(5);
    for(const r of homeSkaters){const s=rows.find(x=>x.player_id===r.player_id);s.shots+=rand(3);s.hits+=rand(4);s.takeaways+=rand(2);s.giveaways+=rand(2);if(String(r.position).toUpperCase()==='C'){const f=2+rand(5);s.faceoff_wins+=rand(f+1);s.faceoff_losses+=f-rand(f+1);}}
    for(const r of awaySkaters){const s=rows.find(x=>x.player_id===r.player_id);s.shots+=rand(3);s.hits+=rand(4);s.takeaways+=rand(2);s.giveaways+=rand(2);if(String(r.position).toUpperCase()==='C'){const f=2+rand(5);s.faceoff_wins+=rand(f+1);s.faceoff_losses+=f-rand(f+1);}}

    const scoring=scoringTeamId || (Math.random()<.5?game.home_team_id:game.away_team_id);
    const scoringSkaters=scoring===game.home_team_id?homeSkaters:awaySkaters;
    const defendingSkaters=scoring===game.home_team_id?awaySkaters:homeSkaters;
    const shooter=pick(scoringSkaters), helpers=scoringSkaters.filter(x=>x.player_id!==shooter?.player_id);
    const a1=pick(helpers),a2=Math.random()<.55?pick(helpers.filter(x=>x.player_id!==a1?.player_id)):null;
    if(shooter){const s=rows.find(x=>x.player_id===shooter.player_id);s.goals++;s.points++;s.shots++;s.plus_minus++;}
    if(a1){const s=rows.find(x=>x.player_id===a1.player_id);s.assists++;s.points++;s.plus_minus++;}
    if(a2){const s=rows.find(x=>x.player_id===a2.player_id);s.assists++;s.points++;s.plus_minus++;}
    const minus=pick(defendingSkaters);if(minus){rows.find(x=>x.player_id===minus.player_id).plus_minus--;}

    if(homeGoalie){const s=rows.find(x=>x.player_id===homeGoalie.player_id);const ga=scoring===game.away_team_id?1:0;s.goalie_shots+=awayShots;s.goalie_goals_against+=ga;s.goalie_saves+=Math.max(0,awayShots-ga);s.save_pct=s.goalie_shots?s.goalie_saves/s.goalie_shots:null;}
    if(awayGoalie){const s=rows.find(x=>x.player_id===awayGoalie.player_id);const ga=scoring===game.home_team_id?1:0;s.goalie_shots+=homeShots;s.goalie_goals_against+=ga;s.goalie_saves+=Math.max(0,homeShots-ga);s.save_pct=s.goalie_shots?s.goalie_saves/s.goalie_shots:null;}

    rows.forEach(s=>{s.points=num(s.goals)+num(s.assists);s.updated_at=new Date().toISOString();});
    const statRes=await db.from('esports_game_player_stats').upsert(rows,{onConflict:'game_id,player_id'}); if(statRes.error) throw statRes.error;
    const update=scoring===game.home_team_id?{home_score:num(game.home_score)+1}:{away_score:num(game.away_score)+1};
    const gameRes=await db.from('esports_games').update({...update,updated_at:new Date().toISOString()}).eq('id',game.id); if(gameRes.error) throw gameRes.error;
    log(`Generated sandbox goal: ${team(scoring)?.name||'Team'} · scorer ${shooter?playerLabel(shooter.player_id):'simulated player'}.`);
  }

  async function rebuildEventStats(){
    const eventId=S.event.id;
    const [statsRes,gamesRes,eventTeamsRes]=await Promise.all([
      db.from('esports_game_player_stats').select('*').eq('event_id',eventId),
      db.from('esports_games').select('*').eq('event_id',eventId),
      db.from('esports_event_teams').select('*').eq('event_id',eventId)
    ]);
    if(statsRes.error||gamesRes.error||eventTeamsRes.error) throw statsRes.error||gamesRes.error||eventTeamsRes.error;
    const stats=statsRes.data||[],games=gamesRes.data||[],pMap=new Map();
    for(const s of stats){
      if(!pMap.has(s.player_id))pMap.set(s.player_id,{event_id:eventId,team_id:s.team_id,player_id:s.player_id,games_played:0,wins:0,losses:0,ot_losses:0,goals:0,assists:0,points:0,plus_minus:0,shots:0,hits:0,takeaways:0,giveaways:0,interceptions:0,blocked_shots:0,pim:0,faceoff_wins:0,faceoff_losses:0,goalie_shots:0,goalie_saves:0,goalie_goals_against:0,source_provider:'sandbox_sim',source_updated_at:new Date().toISOString()});
      const a=pMap.get(s.player_id);a.games_played++;['goals','assists','points','plus_minus','shots','hits','takeaways','giveaways','interceptions','blocked_shots','pim','faceoff_wins','faceoff_losses','goalie_shots','goalie_saves','goalie_goals_against'].forEach(f=>a[f]+=num(s[f]));
      const g=games.find(x=>x.id===s.game_id);if(g?.status==='final'&&s.team_id){const home=s.team_id===g.home_team_id,gf=home?num(g.home_score):num(g.away_score),ga=home?num(g.away_score):num(g.home_score);if(gf>ga)a.wins++;else if(gf<ga){if(g.overtime)a.ot_losses++;else a.losses++;}}
    }
    const pRows=[...pMap.values()].map(a=>({...a,shooting_pct:a.shots?100*a.goals/a.shots:null,save_pct:a.goalie_shots?a.goalie_saves/a.goalie_shots:null,updated_at:new Date().toISOString()}));
    await db.from('esports_player_event_stats').delete().eq('event_id',eventId);
    if(pRows.length){const r=await db.from('esports_player_event_stats').insert(pRows);if(r.error)throw r.error;}

    const teamIds=[...new Set((eventTeamsRes.data||[]).map(x=>x.team_id))],tRows=[];
    for(const teamId of teamIds){let gp=0,w=0,l=0,otl=0,gf=0,ga=0;games.filter(g=>g.status==='final'&&(g.home_team_id===teamId||g.away_team_id===teamId)).forEach(g=>{const home=g.home_team_id===teamId,f=home?num(g.home_score):num(g.away_score),a=home?num(g.away_score):num(g.home_score);gp++;gf+=f;ga+=a;if(f>a)w++;else if(f<a){if(g.overtime)otl++;else l++;}});tRows.push({event_id:eventId,team_id:teamId,games_played:gp,wins:w,losses:l,ot_losses:otl,goals_for:gf,goals_against:ga,points:w*2+otl,updated_at:new Date().toISOString()});}
    tRows.sort((a,b)=>b.points-a.points||(b.goals_for-b.goals_against)-(a.goals_for-a.goals_against)||b.goals_for-a.goals_for).forEach((r,i)=>r.seed=i+1);
    await db.from('esports_team_event_stats').delete().eq('event_id',eventId);
    if(tRows.length){const r=await db.from('esports_team_event_stats').insert(tRows);if(r.error)throw r.error;}
  }

  async function advanceOneStep(){
    if(S.busy)return; S.busy=true;
    try{
      let g=selectedGame(); if(!g)throw new Error('No sandbox game selected.');
      if(g.status==='final'){
        const next=S.games.find(x=>x.status!=='final');
        if(next && $('practiceAutoNext').value==='yes'){S.selectedGameId=next.id;g=next;log('Autopilot moved to the next sandbox game.');}
        else{stopAutopilot('Paused at final.');return;}
      }
      const step=gameStep(g);
      if(g.status==='scheduled'){
        const r=await db.from('esports_games').update({status:'live',period:1,clock:'20:00',commentary_status:'live',featured:true,commentary_label:'SANDBOX_STEP:1',updated_at:new Date().toISOString()}).eq('id',g.id);if(r.error)throw r.error;
        log(`${team(g.home_team_id)?.name} vs ${team(g.away_team_id)?.name} switched to LIVE.`);
      } else if(g.status==='live'){
        const plan={1:[1,'11:32'],2:[2,'20:00'],3:[2,'07:41'],4:[3,'20:00'],5:[3,'06:18']};
        if(step<=5){
          await generateMoment(g);
          const [period,clock]=plan[step]||[3,'06:18'];
          const r=await db.from('esports_games').update({period,clock,commentary_label:`SANDBOX_STEP:${step+1}`,updated_at:new Date().toISOString()}).eq('id',g.id);if(r.error)throw r.error;
        } else {
          await loadData(true);g=selectedGame();
          if(num(g.home_score)===num(g.away_score)){const winner=Math.random()<.5?g.home_team_id:g.away_team_id;await generateMoment(g,winner);await loadData(true);g=selectedGame();await db.from('esports_games').update({overtime:true}).eq('id',g.id);log('Tie detected. Sandbox generated an overtime winner.');}
          const r=await db.from('esports_games').update({status:'final',period:3,clock:'0:00',commentary_status:'complete',featured:false,commentary_label:'SANDBOX_STEP:7',updated_at:new Date().toISOString()}).eq('id',g.id);if(r.error)throw r.error;
          await rebuildEventStats();
          log(`Game finalized. Standings and player leaderboard rebuilt automatically.`);
        }
      }
      await rebuildEventStats(); await loadData(true);
      if(S.games.every(x=>x.status==='final')){stopAutopilot('Practice series complete.');log('All sandbox games are FINAL. Review standings, leaderboard and postgame workflow.');}
    } catch(e){console.error(e);message('practiceMessage',e.message||'Practice step failed.',true);stopAutopilot('Automation stopped after an error.');log(`ERROR: ${e.message||'Unknown practice error'}`);} finally {S.busy=false;}
  }

  function startAutopilot(){
    if(S.timer)return; const ms=Number($('practiceSpeed').value)||10000;
    message('practiceMessage',`Autopilot running every ${Math.round(ms/1000)} seconds.`);log(`Autopilot started at ${Math.round(ms/1000)} seconds per step.`);advanceOneStep();S.timer=setInterval(advanceOneStep,ms);render();
  }
  function stopAutopilot(reason='Autopilot paused.'){
    if(S.timer){clearInterval(S.timer);S.timer=null;}message('practiceMessage',reason);render();
  }

  async function resetSandbox(){
    if(!confirm('Reset every fake score, stat and standing in the private sandbox? Your attached stream URL will be kept.'))return;
    stopAutopilot('Resetting sandbox…');
    try{
      const id=S.event.id;
      const a=await db.from('esports_game_player_stats').delete().eq('event_id',id);if(a.error)throw a.error;
      const b=await db.from('esports_player_event_stats').delete().eq('event_id',id);if(b.error)throw b.error;
      const c=await db.from('esports_team_event_stats').delete().eq('event_id',id);if(c.error)throw c.error;
      const d=await db.from('esports_games').update({status:'scheduled',home_score:0,away_score:0,period:null,clock:null,overtime:false,featured:false,commentary_status:'none',commentary_label:null,updated_at:new Date().toISOString()}).eq('event_id',id);if(d.error)throw d.error;
      S.log=[];log('Sandbox reset. Fake scores, stats and standings cleared.');await loadData();message('practiceMessage','Sandbox reset and ready for another rehearsal.');
    }catch(e){console.error(e);message('practiceMessage',e.message||'Reset failed.',true);}
  }

  async function attachStream(){
    const url=$('practiceStreamUrl').value.trim();if(!url){message('practiceStreamMessage','Paste a stream URL first.',true);return;}
    try{new URL(url);}catch{message('practiceStreamMessage','That does not look like a valid URL.',true);return;}
    try{
      const provider=$('practiceStreamProvider').value,title=$('practiceBroadcastTitle').value.trim()||'Wildman Practice Night';
      const r=await db.from('esports_games').update({stream_provider:provider,stream_url:url,broadcast_title:title,updated_at:new Date().toISOString()}).eq('event_id',S.event.id);if(r.error)throw r.error;
      message('practiceStreamMessage','Stream attached to all sandbox games.');log(`Practice stream attached to all sandbox games (${provider}).`);await loadData();
    }catch(e){message('practiceStreamMessage',e.message||'Could not attach stream.',true);}
  }

  function bind(){
    $('practiceGameSelect')?.addEventListener('change',e=>{S.selectedGameId=e.target.value;render();});
    $('startPracticeBtn')?.addEventListener('click',startAutopilot);
    $('stopPracticeBtn')?.addEventListener('click',()=>stopAutopilot());
    $('stepPracticeBtn')?.addEventListener('click',advanceOneStep);
    $('resetPracticeBtn')?.addEventListener('click',resetSandbox);
    $('savePracticeStreamBtn')?.addEventListener('click',attachStream);
    $('clearPracticeLogBtn')?.addEventListener('click',()=>{S.log=[];renderLog();});
    $('practiceSpeed')?.addEventListener('change',()=>{if(S.timer){stopAutopilot('Speed changed. Restart autopilot to use the new interval.');}});
  }

  bind();
  window.addEventListener('vvhl-auth-change',e=>{if(window.VVHLManagementGuard?.hasAccess(e.detail)){loadData();}});
  if(window.VVHLManagementGuard?.hasAccess(window.VVHLBackend?.state))loadData();
})();
