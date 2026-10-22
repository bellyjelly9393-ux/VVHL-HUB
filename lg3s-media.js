/* Elitechel Media LG3s public league desk. Static roster/editorial snapshot + read-only verified LG results
   from Supabase public views (lg3s_public_*; verified rows only). No writes. Falls back to the static snapshot. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = id => 'assets/lg3s/team' + Number(id) + '.svg';
  const teamUrl = id => 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league_page&page=team_page&teamid=' + Number(id) + '&leagueid=154&seasonid=1';
  const userUrl = id => 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=team_user&userid=' + Number(id) + '&leagueid=154&seasonid=1';
  const gameUrl = id => 'https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=game&gameid=' + Number(id);
  const salary = n => n == null ? 'No contract' : '$' + (n / 1e6).toFixed(2).replace(/0+$/,'').replace(/\.$/,'') + 'M';
  const shortTime = t => ({'20:00':'8:00 PM','20:35':'8:35 PM','21:10':'9:10 PM'})[t] || esc(t);
  const teamMark = (t, size = 48) => '<img src="' + icon(t.id) + '" width="' + size + '" height="' + size + '" loading="lazy" alt="' + esc(t.name) + ' team crest">';
  const LIVE = Object.freeze({ base: 'https://lrgllzvwgvqagcpiyvfd.supabase.co/rest/v1/', key: 'sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP' });
  const live = { ok: false, games: new Map(), standings: [], official: [], skaters: [], goalies: [], lines: [] };
  async function view(name, q) {
    const r = await fetch(LIVE.base + name + '?' + q, { headers: { apikey: LIVE.key, Authorization: 'Bearer ' + LIVE.key }, cache: 'no-store' });
    if (!r.ok) throw Error(name + ' ' + r.status);
    return r.json();
  }
  async function loadLive() {
    const [g, s] = await Promise.all([view('lg3s_public_games', 'select=*&order=scheduled_at'), view('lg3s_public_standings', 'select=*')]);
    const opt = (n, q) => view(n, q).catch(e => { console.warn('LG3s optional view', e); return []; });
    const [o, sk, gl, ln] = await Promise.all([opt('lg3s_public_official_standings', 'select=*'),
      opt('lg3s_public_skater_leaders', 'select=*&order=p.desc,g.desc&limit=250'), opt('lg3s_public_goalie_leaders', 'select=*&order=sv_pct.desc.nullslast&limit=60'),
      opt('lg3s_public_player_lines', 'select=*&order=lg_game_id&limit=5000')]);
    g.forEach(x => live.games.set(Number(x.lg_game_id), x));
    Object.assign(live, { ok: true, standings: s, official: o, skaters: sk, goalies: gl, lines: ln });
  }
  const etTime = iso => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '';
  const playerLink = (id, name) => '<a class="th-player-name" href="#player/' + Number(id) + '">' + esc(name) + '</a>';
  const nationLink = t => '<a class="th-team-link" href="#nation/' + Number(t.id) + '">' + teamMark(t, 32) + esc(t.name) + '</a>';
  const btn = $('menuBtn'), nav = $('nav');
  if (btn && nav) {
    btn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    nav.addEventListener('click', e => { if(e.target.closest('a')) { nav.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }});
    document.addEventListener('keydown', e => { if(e.key === 'Escape'){nav.classList.remove('open');btn.setAttribute('aria-expanded','false');}});
  }
  let data, tm, chosenDay='2026-10-21', boardMode='official', playerLimit=40;
  function team(id){ return tm.get(Number(id)); }

  function renderNations() {
    $('thNations').innerHTML = data.teams.map(t => '<a href="#nation/' + Number(t.id) + '" class="th-nation-chip" title="' + esc(t.name) + ' nation page">' + teamMark(t,34) + '<span>' + esc(t.name) + '</span></a>').join('');
  }
  function gameCard(g){
    const a=team(g.away),h=team(g.home),p=g.pick ? team(g.pick):null;
    const marquee=/MARQUEE|HEADLINER|STAR DUEL|STYLE CLASH/.test(g.tag);
    const classes='th-game th-game-v2' + (marquee?' th-game-feature':'');
    return '<a class="' + classes + '" href="' + gameUrl(g.id) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(a.name) + ' at ' + esc(h.name) + ', ' + shortTime(g.time) + ' Eastern, official game">' +
      '<img class="th-game-wm" src="' + icon(h.id) + '" loading="lazy" alt="" aria-hidden="true">' +
      '<div class="th-game-top"><span class="th-game-day">' + esc(g.tag) + '</span><strong>GAME ' + esc(String(g.id).slice(-3)) + '</strong><span class="th-action">LG GAME CENTRE ↗</span></div>' +
      '<div class="th-teams"><div>' + teamMark(a,68) + '<strong>' + esc(a.name) + '</strong><small>AWAY</small></div><span class="th-vs">AT</span><div>' + teamMark(h,68) + '<strong>' + esc(h.name) + '</strong><small>HOME</small></div></div>' +
      '<div class="th-game-foot"><span>THE MATCHUP</span><p>' + esc(g.preview) + '</p></div>' +
      liveScore(g, a, h) +
      '<div class="th-game-verdict">' + (p ? '<span>ECM PICK · <b>' + esc(p.name) + '</b></span><span class="th-pick-label">EDITORIAL PREDICTION</span>' : '<span>THURSDAY · PREVIEW ONLY</span><span class="th-pick-label">NO PICK POSTED</span>') + '</div>' +
      '</a>';
  }
  function liveScore(g, a, h) {
    const x = live.games.get(Number(g.id));
    if (!live.ok || !x) return '';
    if (!x.is_verified) return '<div class="th-live-score is-pending"><span>' + (x.status === 'pending_verification' ? 'FINAL POSTED · VERIFYING' : 'RESULT PENDING') + '</span><small>Scores appear once LG data passes verification</small></div>';
    const ah = x.away_score > x.home_score;
    return '<div class="th-live-score"><b class="' + (ah ? 'is-win' : '') + '">' + esc(a.name) + ' ' + Number(x.away_score) + '</b><span>FINAL' + (x.decided_in && x.decided_in !== 'REG' ? '/' + esc(x.decided_in) : '') + '</span><b class="' + (ah ? '' : 'is-win') + '">' + Number(x.home_score) + ' ' + esc(h.name) + '</b>' +
      '<small>OFFICIAL LG DATA · VERIFIED ' + esc(etTime(x.verified_at)) + (x.was_corrected ? ' · CORRECTED' : '') + '</small></div>';
  }
  function renderGames(){
    const games=data.games.filter(g => chosenDay==='all'||g.date===chosenDay);
    const blocks=new Map;
    for(const g of games){const key=g.date+'|'+g.time;if(!blocks.has(key))blocks.set(key,[]);blocks.get(key).push(g);}
    $('thGames').innerHTML=[...blocks.entries()].map(([key,arr])=>{
      const [date,time]=key.split('|'),label=date==='2026-10-21'?'WEDNESDAY · OCT 21':'THURSDAY · OCT 22';
      return '<div class="th-wave"><header class="th-wave-header"><span class="th-wave-time">' + shortTime(time) + ' <small>ET</small></span><span>' + label + '</span><span>' + arr.length + ' MATCHUPS</span></header><div class="th-games">' + arr.map(gameCard).join('') + '</div></div>';
    }).join('');
    const all=chosenDay==='all',isWed=chosenDay==='2026-10-21';
    $('thSelectedNight').textContent=all?'FULL OPENING WEEK · OCT 21–22':isWed?'OPENING NIGHT · WEDNESDAY, OCT 21':'NIGHT TWO · THURSDAY, OCT 22';
    $('thNightStat').textContent=(all?'30':isWed?'18':'12')+' VERIFIED FIXTURES · '+(all?'FIVE':isWed?'THREE':'TWO')+' WAVES';
    document.querySelectorAll('.th-switch button[data-date]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.date===chosenDay)));
  }
  function standingsTable(group){
    const teams=data.teams.filter(t=>t.group===group);
    if(boardMode==='forecast'){
      const project=new Map(data.projection.records.map(p=>[p.id,p]));
      teams.sort((a,b)=>project.get(b.id).w-project.get(a.id).w||a.name.localeCompare(b.name));
      return '<div class="th-standing-group"><header class="th-standing-title"><strong>GROUP ' + group + '</strong><span>ECM PREDICTION · AFTER NIGHT ONE</span></header><div class="th-table-scroll"><table class="th-table"><thead><tr><th>TEAM</th><th>W</th><th>L</th><th>PROJECTED RECORD</th></tr></thead><tbody>'+teams.map(t=>{
        const p=project.get(t.id);
        return '<tr><td><a class="th-team-link" href="'+teamUrl(t.id)+'" target="_blank" rel="noopener noreferrer">'+teamMark(t,32)+esc(t.name)+'</a></td><td class="num">'+p.w+'</td><td class="num">'+p.l+'</td><td class="th-record">'+p.w+'–'+p.l+'</td></tr>';
      }).join('')+'</tbody></table></div></div>';
    }
    if(live.ok&&live.standings.length===12){
      const rows=live.standings.filter(r=>r.group_code===group).sort((a,b)=>(b.pts??-1)-(a.pts??-1)||b.gd-a.gd||b.gf-a.gf||a.nation.localeCompare(b.nation));
      return '<div class="th-standing-group"><header class="th-standing-title"><strong>GROUP '+group+'</strong><span>OFFICIAL LG RESULTS · VERIFIED</span></header><div class="th-table-scroll"><table class="th-table"><thead><tr><th>TEAM</th><th>GP</th><th>W</th><th>L</th><th>OTW</th><th>OTL</th><th>PTS</th><th>GF</th><th>GA</th><th>GD</th></tr></thead><tbody>'+rows.map(r=>{const t=team(r.lg_team_id);
        return '<tr><td>'+nationLink(t)+'</td>'+['gp','w','l','otw','otl','pts','gf','ga','gd'].map(k=>'<td class="num">'+(r[k]==null?'—':Number(r[k]))+'</td>').join('')+'</tr>';}).join('')+'</tbody></table></div></div>';
    }
    return '<div class="th-standing-group"><header class="th-standing-title"><strong>GROUP '+group+'</strong><span>OFFICIAL PRESEASON STANDINGS</span></header><div class="th-table-scroll"><table class="th-table"><thead><tr><th>TEAM</th><th>GP</th><th>W</th><th>L</th><th>OTW</th><th>OTL</th><th>PTS</th><th>GF</th><th>GA</th><th>GD</th></tr></thead><tbody>'+teams.map(t=>
    '<tr><td><a class="th-team-link" href="'+teamUrl(t.id)+'" target="_blank" rel="noopener noreferrer">'+teamMark(t,32)+esc(t.name)+'</a></td>'+['gp','w','l','otw','otl','pts','gf','ga','gd'].map(k=>'<td class="num">'+Number(t[k])+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div>';
  }
  function renderStandings(){
    $('thStandings').innerHTML=standingsTable('A')+standingsTable('B');
    $('thStandingsNote').textContent=boardMode==='forecast'?
    'ECM forecast: straight-up predictions for the 18 Wednesday games (three per nation). This is not an official record, a betting market, or a simulation of goal scores. Teams tied on projected wins are not ranked by a fabricated tiebreaker.':
    (live.ok?standingsNote():'Official LeagueGaming Season 1 standings, captured October 21, 2026 before posted opening results. Live results are temporarily unavailable; this snapshot does not update automatically.');
    $('thStandingsAsOf').textContent=boardMode==='forecast'?'EDITORIAL · NOT OFFICIAL':live.ok?'VERIFIED · '+lastVerified():'OFFICIAL SNAPSHOT · OCT 21';
    document.querySelectorAll('.th-board-mode').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.boardMode===boardMode)));
  }
  function lastVerified(){let m=null;live.games.forEach(g=>{if(g.verified_at&&(!m||g.verified_at>m))m=g.verified_at;});return m?etTime(m).toUpperCase():'—';}
  function standingsNote(){
    const n=[...live.games.values()].filter(g=>g.is_verified).length;
    const off=new Map(live.official.map(r=>[r.lg_team_id,r]));
    const diff=live.standings.filter(r=>{const o=off.get(r.lg_team_id);return o&&(o.gp!==r.gp||o.w!==r.w||o.l!==r.l||o.pts!==r.pts||o.gf!==r.gf||o.ga!==r.ga);});
    return 'Built only from '+n+' verified LeagueGaming finals (FINAL status, full box score, scores reconciled, stable across two checks). '+
      (live.official.length?(diff.length?'Note: LG\'s own table currently differs for '+diff.length+' team(s), usually because a newer final is still verifying.':'Matches LeagueGaming\'s official table captured '+etTime(live.official[0].captured_at)+'.'):'')+
      ' Points: 2 per regulation win, as shown on LG; OT/SO values are shown as — until LG confirms them.';
  }
  function renderLeaders(){
    const box=$('thLeaders'); if(!box)return;
    if(!live.ok||!live.skaters.length){box.innerHTML='<p class="th-caption">Verified leaderboards appear after the first verified finals.</p>';return;}
    const sk=live.skaters.slice(0,15).map((p,i)=>{const t=team(p.lg_team_id);return '<tr><td class="th-num-rank">'+(i+1)+'</td><td>'+playerLink(p.lg_user_id,p.gamertag)+'</td><td>'+(t?nationLink(t):'')+'</td>'+['gp','g','a','p','plus_minus'].map(k=>'<td class="num">'+Number(p[k])+'</td>').join('')+'</tr>';}).join('');
    const gl=live.goalies.filter(g=>g.sa>0).slice(0,10).map((g,i)=>'<tr><td class="th-num-rank">'+(i+1)+'</td><td>'+playerLink(g.lg_user_id,g.gamertag)+'</td><td>'+esc((g.nations_played_for||[]).join(' · '))+'</td>'+['gp','sa','ga','sv'].map(k=>'<td class="num">'+Number(g[k])+'</td>').join('')+'<td class="num">'+(g.sv_pct==null?'—':Number(g.sv_pct).toFixed(3).replace(/^0/,''))+'</td></tr>').join('');
    box.innerHTML='<div class="th-standing-group"><header class="th-standing-title"><strong>SKATERS</strong><span>POINTS · VERIFIED GAMES</span></header><div class="th-table-scroll"><table class="th-table"><thead><tr><th>#</th><th>PLAYER</th><th>NATION</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th></tr></thead><tbody>'+sk+'</tbody></table></div></div>'+
      '<div class="th-standing-group"><header class="th-standing-title"><strong>GOALIES</strong><span>SAVE % · CREDITED PER GAME</span></header><div class="th-table-scroll"><table class="th-table"><thead><tr><th>#</th><th>GOALIE</th><th>PLAYED FOR</th><th>GP</th><th>SA</th><th>GA</th><th>SV</th><th>SV%</th></tr></thead><tbody>'+gl+'</tbody></table></div></div>';
  }
  function openDetail(html){const d=$('thDetail');if(!d)return;$('thDetailBody').innerHTML=html;if(!d.open)d.showModal();}
  function nationPage(id){
    const t=team(id);if(!t)return;
    const st=live.standings.find(r=>r.lg_team_id===t.id);
    const games=data.games.filter(g=>g.away===t.id||g.home===t.id).map(g=>{const x=live.games.get(g.id),opp=team(g.away===t.id?g.home:g.away),home=g.home===t.id;
      let res='—';if(x&&x.is_verified){const f=home?x.home_score:x.away_score,a=home?x.away_score:x.home_score;res=(f>a?'W ':'L ')+f+'–'+a;}else if(x&&x.status==='pending_verification')res='Verifying';
      return '<tr><td>'+esc(g.date)+' '+shortTime(g.time)+'</td><td>'+(home?'vs ':'@ ')+esc(opp.name)+'</td><td class="num">'+res+'</td><td><a href="'+gameUrl(g.id)+'" target="_blank" rel="noopener noreferrer">LG ↗</a></td></tr>';}).join('');
    const tot=new Map();live.lines.filter(l=>l.lg_team_id===t.id&&l.player_kind==='skater').forEach(l=>{const p=tot.get(l.lg_user_id)||{id:l.lg_user_id,n:l.gamertag,gp:0,g:0,a:0,p:0};p.gp++;p.g+=l.goals;p.a+=l.assists;p.p+=l.points;tot.set(l.lg_user_id,p);});
    const sk=[...tot.values()].sort((a,b)=>b.p-a.p||b.g-a.g).map(p=>'<tr><td>'+playerLink(p.id,p.n)+'</td><td class="num">'+p.gp+'</td><td class="num">'+p.g+'</td><td class="num">'+p.a+'</td><td class="num">'+p.p+'</td></tr>').join('')||'<tr><td colspan="5">No verified games yet.</td></tr>';
    const roster=data.players.filter(p=>p.t===t.id).map(p=>esc(p.n)).join(' · ');
    openDetail('<header class="th-detail-head">'+teamMark(t,72)+'<div><p class="eyebrow">GROUP '+esc(t.group)+' · NATION PAGE</p><h3>'+esc(t.name).toUpperCase()+'</h3><p>'+(st?st.w+'–'+st.l+(st.otw+st.otl?' ('+st.otw+' OTW, '+st.otl+' OTL)':'')+' · '+(st.pts??'—')+' PTS · GF '+st.gf+' / GA '+st.ga:'No verified results yet')+'</p></div></header>'+
      '<h4>RESULTS & SCHEDULE</h4><div class="th-table-scroll"><table class="th-table"><tbody>'+games+'</tbody></table></div><h4>SKATERS · VERIFIED GAMES</h4><div class="th-table-scroll"><table class="th-table"><thead><tr><th>PLAYER</th><th>GP</th><th>G</th><th>A</th><th>P</th></tr></thead><tbody>'+sk+'</tbody></table></div>'+
      '<h4>ROSTER (OCT 21 SNAPSHOT)</h4><p class="th-caption">'+roster+'</p><p class="th-caption"><a href="'+teamUrl(t.id)+'" target="_blank" rel="noopener noreferrer">Official LG team page ↗</a></p>');
  }
  function playerCard(uid){
    const ls=live.lines.filter(l=>l.lg_user_id===uid);const rp=data.players.find(p=>p.id===uid);
    const name=(ls[ls.length-1]||{}).gamertag||(rp&&rp.n)||('LG user '+uid);
    const sk=ls.filter(l=>l.player_kind==='skater'),gl=ls.filter(l=>l.player_kind==='goalie');
    const sum=(a,k)=>a.reduce((n,x)=>n+(Number(x[k])||0),0);
    const rows=ls.map(l=>{const t=team(l.lg_team_id),g=live.games.get(l.lg_game_id);return '<tr><td>'+esc(String(l.game_night_date).slice(5))+' · '+(t?esc(t.name):'')+'<br><b>'+(l.player_kind==='goalie'?'G · '+l.saves+' SV / '+l.shots_against+' SA':esc(l.position||'')+' · '+l.goals+'G '+l.assists+'A '+l.points+'P')+'</b></td><td class="num"><a href="'+gameUrl(l.lg_game_id)+'" target="_blank" rel="noopener noreferrer">'+(g?Number(g.away_score)+'–'+Number(g.home_score):'LG')+' ↗</a></td></tr>';}).join('')||'<tr><td colspan="2">No verified games yet.</td></tr>';
    const nations=[...new Set(ls.map(l=>l.nation))].join(' · ')||(rp&&team(rp.t)?team(rp.t).name:'');
    openDetail('<header class="th-detail-head"><div><p class="eyebrow">PLAYER CARD · '+esc(nations)+'</p><h3>'+esc(name)+'</h3><p>'+(sk.length?sk.length+' GP · '+sum(sk,'goals')+'G '+sum(sk,'assists')+'A '+sum(sk,'points')+'P':'')+(gl.length?(sk.length?' · ':'')+gl.length+' GP in goal · '+sum(gl,'saves')+' SV / '+sum(gl,'shots_against')+' SA':'')+(rp&&rp.v?' · Bid '+salary(rp.v):'')+'</p></div></header>'+
      '<h4>GAME LOG · VERIFIED</h4><div class="th-table-scroll"><table class="th-table"><tbody>'+rows+'</tbody></table></div><p class="th-caption"><a href="'+userUrl(uid)+'" target="_blank" rel="noopener noreferrer">Official LG profile ↗</a> · Lines are credited to the nation shown in each game\'s LG box score.</p>');
  }
  function route(){const m=/^#(nation|player)\/(\d+)$/.exec(location.hash);if(!m)return;const id=Number(m[2]);m[1]==='nation'?nationPage(id):playerCard(id);}
  function renderPlayers(){
    const search=$('thPlayerSearch').value.trim().toLocaleLowerCase(),tid=$('thPlayerTeam').value,status=$('thPlayerStatus').value,pos=$('thPlayerPosition').value,sort=$('thPlayerSort').value;
    let players=data.players.filter(p=>(status==='all'||p.s===status)&&(tid==='all'||String(p.t)===tid)&&(pos==='all'||p.p===pos)&&(!search||p.n.toLocaleLowerCase().includes(search)||team(p.t).name.toLocaleLowerCase().includes(search)));
    players.sort(sort==='name'?(a,b)=>a.n.localeCompare(b.n):sort==='team'?(a,b)=>team(a.t).name.localeCompare(team(b.t).name)||a.n.localeCompare(b.n):(a,b)=>(b.v??-1)-(a.v??-1)||a.n.localeCompare(b.n));
    const shown=players.slice(0,playerLimit);
    $('thPlayerRows').innerHTML=shown.length?shown.map((p,i)=>{
      const t=team(p.t);
      return '<tr><td class="th-num-rank">'+(i+1)+'</td><td>'+playerLink(p.id,p.n)+' <a href="'+userUrl(p.id)+'" target="_blank" rel="noopener noreferrer" aria-label="LG profile">↗</a>'+(p.r?'<small class="th-role">'+esc(p.r)+'</small>':'')+'</td><td><a class="th-team-link" href="'+teamUrl(t.id)+'" target="_blank" rel="noopener noreferrer">'+teamMark(t,30)+esc(t.name)+'</a></td><td>'+esc(p.p)+'</td><td><span class="th-status '+(p.s==='TC'?'is-tc':'')+'">'+(p.s==='TC'?'Training camp':'Active')+'</span></td><td class="num">'+salary(p.v)+'</td></tr>';
    }).join(''):'<tr><td colspan="6">No roster members match these filters.</td></tr>';
    $('thPlayerCount').textContent='SHOWING '+shown.length+' OF '+players.length+' MATCHING PLAYERS · '+data.players.length+' REGISTERED ACROSS THE LEAGUE · OCT 21 SNAPSHOT';
    $('thPlayersMore').hidden=shown.length>=players.length;
  }
  async function start(){
    const response=await fetch('lg3s-season1-data.json?v=20261021-2',{cache:'no-store'});
    if(!response.ok)throw Error('Snapshot unavailable');
    data=await response.json();
    if(!Array.isArray(data.teams)||data.teams.length!==12||data.games.length!==30||data.players.length<200)throw Error('Incomplete league snapshot');
    tm=new Map(data.teams.map(t=>[t.id,t]));
    try{await loadLive();}catch(e){console.warn('LG3s verified results unavailable; showing static snapshot.',e);}
    renderNations();renderGames();renderStandings();renderLeaders();
    window.addEventListener('hashchange',route);route();
    const dc=$('thDetailClose');if(dc)dc.addEventListener('click',()=>{$('thDetail').close();history.replaceState(null,'',location.pathname+location.search);});
    $('thPlayerTeam').innerHTML='<option value="all">All twelve nations</option>'+data.teams.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(t=>'<option value="'+t.id+'">'+esc(t.name)+'</option>').join('');
    renderPlayers();
    document.querySelectorAll('.th-switch button[data-date]').forEach(b=>b.addEventListener('click',()=>{chosenDay=b.dataset.date;renderGames();}));
    document.querySelectorAll('.th-board-mode').forEach(b=>b.addEventListener('click',()=>{boardMode=b.dataset.boardMode;renderStandings();}));
    ['thPlayerSearch','thPlayerTeam','thPlayerStatus','thPlayerPosition','thPlayerSort'].forEach(id=>$(id).addEventListener(id==='thPlayerSearch'?'input':'change',()=>{playerLimit=40;renderPlayers();}));
    $('thPlayersMore').addEventListener('click',()=>{playerLimit+=40;renderPlayers();});
  }
  start().catch(err=>{
    console.error('LG3s public media snapshot:',err);
    if($('thGames'))$('thGames').innerHTML='<p class="th-caption">The saved fixture board is temporarily unavailable. Check <a href="https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=standing&leagueid=154&seasonid=1" target="_blank" rel="noopener noreferrer">official LeagueGaming</a> for the latest schedule.</p>';
    if($('thStandings'))$('thStandings').innerHTML='<p class="th-caption">Official group snapshot unavailable.</p>';
    if($('thPlayerRows'))$('thPlayerRows').innerHTML='<tr><td colspan="6">Roster snapshot unavailable right now.</td></tr>';
  });
})();
