/* War Room: Tonight's Six, per-game jobs, "Across from us" scouting, landing layout, locker TVs and player stall.
   Read-only. Every query is a SELECT the current RLS already allows; nothing here writes.
   - hitmen_schedule_games: tonight's games, home/away kit (calgary_side 'right' = home), results
   - hitmen_opponent_pregame_reports: posted six (evidence_summary.lineups), jobs / threats / plan (report text)
   - team_player_lockers: names + numbers on the jerseys (named columns only; never salary)
   - lgchl_standings_current: public LG standings
   Players only get jobs, lineups and scouting from reports management has approved
   (evidence_summary.approved = true). Drafts are filtered out in the query, not just hidden.
   Mount points: #wrTonight (hitmen-workspace.html), #wrLockerTVs (hitmen-team-locker.html),
   #wrStallTonight (hitmen-player-locker.html).                                                   */
(()=>{
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55,ET='America/New_York',CGY=412;
const POS=['LW','C','RW','LD','RD','G'];
const POS_LONG={LW:'Left wing',C:'Centre',RW:'Right wing',LD:'Left defence',RD:'Right defence',G:'Goalie'};
const DB=()=>window.VVHLBackend?.db, ST=()=>window.VVHLBackend?.state||{};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const crest=(id,size,alt)=>id?`<img class="wr-crest" src="assets/lgchl/s55/team${id}.png?v=20261004-broadcast" width="${size}" height="${size}" alt="${esc(alt||'')}" decoding="async" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'wr-crest wr-crest-x',textContent:this.alt.slice(0,3)}))">`:`<span class="wr-crest wr-crest-x" style="width:${size}px;height:${size}px">${esc(String(alt||'').slice(0,3))}</span>`;
const ord=n=>n+(['th','st','nd','rd'][(n%100-20)%10]||['th','st','nd','rd'][n%100]||'th');

/* ---------- viewer ---------- */
function viewer(){
  const s=ST(),pr=String(s.profile?.role||'').toLowerCase();
  const m=(s.memberships||[]).find(x=>x.team_id===TEAM&&x.active!==false);
  const role=pr==='admin'?'admin':String(m?.role||'').toLowerCase();
  return {user:s.user||null,role,mgmt:role==='admin'||['owner','gm','agm','scout'].includes(role),
          manage:role==='admin'||['owner','gm','agm'].includes(role)};
}

/* ---------- time (all game times are shown in Eastern, like the schedule) ---------- */
const fmt=(o)=>new Intl.DateTimeFormat('en-US',Object.assign({timeZone:ET},o));
const etKey=d=>new Intl.DateTimeFormat('en-CA',{timeZone:ET,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const etTime=d=>fmt({hour:'numeric',minute:'2-digit'}).format(d);
const etDay=d=>fmt({weekday:'short',month:'short',day:'numeric'}).format(d).replace(',','').toUpperCase();
function countdown(ts){
  const ms=ts-Date.now(); if(ms<=0) return ms>-3*3600e3?'LIVE':'FINAL';
  const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;
  return h>=48?`${Math.round(h/24)} DAYS`:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`;
}
setInterval(()=>document.querySelectorAll('[data-wr-cd]').forEach(el=>{el.textContent=countdown(+el.dataset.wrCd)}),1000);

/* ---------- report text -> sections (no new claims; citation markers stripped) ---------- */
const clean=s=>String(s||'').replace(/\s*\[E\d+\]/g,'').replace(/\*\*/g,'').replace(/\s+/g,' ').trim();
const sentences=s=>clean(s).split(/(?<=[.!?])(?<!\b[ap]\.m\.)(?<!\bvs\.)\s+(?=\S)/).map(x=>x.trim()).filter(Boolean);
function sections(text){
  const out=[];let cur=null;
  String(text||'').split('\n').forEach(line=>{const m=line.match(/^##\s+(.*)/);
    if(m){cur={h:m[1].trim(),lines:[]};out.push(cur)}else if(cur&&line.trim()&&!/^\*\*[^*]+:\*\*\s*$/.test(line.trim()))cur.lines.push(line.trim())});
  return out;
}
function parseReport(row){
  const ev=row.evidence_summary||{},secs=sections(row.report),find=re=>secs.find(s=>re.test(s.h));
  const jobsSec=find(/individual jobs/i),jobs={};
  (jobsSec?.lines||[]).forEach(l=>{const m=l.match(/^[-*]\s*(.+?)\s+[—–]\s+(.+)$/);if(m){const ss=sentences(m[2]);let out=ss[0]||'';for(const x of ss.slice(1)){if((out+' '+x).length>240)break;out+=' '+x}jobs[norm(m[1])]=out}});
  // one point per paragraph (first sentence); short sections contribute every sentence. Max 4.
  const points=sec=>{const ls=(sec?.lines||[]).map(l=>l.replace(/^[-*]\s*/,''));return ls.flatMap(l=>ls.length>=3?sentences(l).slice(0,1):sentences(l)).filter(Boolean).slice(0,4)};
  const threatSec=find(/hurt us|what matters|changes|threat/i)||secs[1];
  const planSec=find(/plan to win/i)||find(/carries over|how to test|adjust/i);
  const lu=ev.lineups||{};
  const opp=lu.opponent?POS.filter(p=>lu.opponent[p]).map(p=>{const raw=String(lu.opponent[p]);const m=raw.match(/^(.*?)\s*\((.+)\)\s*$/);return {pos:p,name:m?m[1]:raw,note:m?m[2]:''}}):[];
  return {id:row.id,created:row.created_at?new Date(row.created_at):null,approved:ev.approved===true,
    six:lu.calgary||null,opp,jobs,hasJobs:!!jobsSec,
    threats:points(threatSec),plan:points(planSec)};
}

/* ---------- data ---------- */
let cache=null,inflight=null;
async function load(){
  const db=DB(),v=viewer();
  if(!db||!v.user) return null;
  const errors=[];
  const [sr,lr,str]=await Promise.all([
    db.from('hitmen_schedule_games').select('id,week,scheduled_at,opponent_name,calgary_side,status,calgary_score,opponent_score,overtime').eq('team_id',TEAM).order('scheduled_at',{ascending:true}),
    db.from('team_player_lockers').select('id,user_id,gamertag,jersey_number,jersey_name,position,roster_class,management_role,handedness').eq('team_id',TEAM).eq('season',SEASON),
    db.from('lgchl_standings_current').select('lg_team_id,name,abbr,nickname,division,gp,w,l,otl,pts,gf,ga,gd,streak,division_rank,standings_at')
  ]);
  [sr,lr,str].forEach(r=>r.error&&errors.push(r.error.message||String(r.error)));
  const schedule=(sr.data||[]).filter(r=>r.scheduled_at),lockers=lr.data||[],standings=str.data||[];
  const byName=new Map(standings.map(t=>[norm(t.name),t]));
  const teamFor=name=>byName.get(norm(name))||null;
  // game day: the ET date of (now - 6h) if Calgary plays then, else the next date with a game
  const ref=etKey(new Date(Date.now()-6*3600e3));
  const keyOf=r=>etKey(new Date(r.scheduled_at));
  let day=schedule.some(r=>keyOf(r)===ref)?ref:(schedule.find(r=>keyOf(r)>ref)?keyOf(schedule.find(r=>keyOf(r)>ref)):null);
  const rows=day?schedule.filter(r=>keyOf(r)===day):[];
  const games=rows.map((r,i)=>{const t=teamFor(r.opponent_name),at=new Date(r.scheduled_at),home=r.calgary_side==='right';
    const nick=t?.nickname||'',short=t&&nick&&t.name.endsWith(nick)?t.name.slice(0,-nick.length).trim():(r.opponent_name||'Opponent');
    return {gm:i+1,id:r.id,row:r,at,time:etTime(at),home,kit:home?'home':'away',name:r.opponent_name||'Opponent',short,
      abbr:t?.abbr||String(r.opponent_name||'OPP').split(/\s+/).map(w=>w[0]).join('').slice(0,3).toUpperCase(),lg:t?.lg_team_id||null,team:t,report:null}});
  if(games.length){
    let q=db.from('hitmen_opponent_pregame_reports').select('id,scheduled_game_id,created_at,report,evidence_summary').eq('team_id',TEAM).in('scheduled_game_id',games.map(g=>g.id));
    if(!v.mgmt) q=q.eq('evidence_summary->>approved','true');   // players: approved reports only
    const rr=await q.order('created_at',{ascending:false}).limit(60);
    if(rr.error) errors.push(rr.error.message||String(rr.error));
    const reps=(rr.data||[]).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    games.forEach(g=>{const mine=reps.filter(r=>r.scheduled_game_id===g.id&&(v.mgmt||r.evidence_summary?.approved===true));
      const pick=mine.find(r=>r.evidence_summary?.lineups?.calgary)||mine[0];g.report=pick?parseReport(pick):null});
  }
  const current=lockers.filter(l=>l.roster_class!=='historical'); // archived past players never feed a jersey or TV
  const lockerFor=name=>current.find(l=>norm(l.gamertag)===norm(name))||null;
  const cgy=standings.find(t=>t.lg_team_id===CGY)||null;
  return {v,schedule,lockers,standings,games,day,today:day===ref,cgy,teamFor,lockerFor,errors};
}
function data(){ if(cache) return Promise.resolve(cache); if(!inflight) inflight=load().then(d=>{inflight=null;if(d)cache=d;return d}).catch(e=>{inflight=null;console.error('[war-room-tonight]',e);return null}); return inflight; }

/* six for one game: report lineup + locker names/numbers */
function sixFor(D,g){
  const six=g?.report?.six; if(!six) return [];
  return POS.filter(p=>six[p]).map(p=>{const l=D.lockerFor(six[p]);const tag=l?.management_role?String(l.management_role).toUpperCase():'';
    return {pos:p,name:(l?.jersey_name||l?.gamertag||six[p]),tag:l?.gamertag||six[p],no:l?.jersey_number||null,me:!!(l&&D.v.user&&l.user_id===D.v.user.id),role:tag,locker:l}})
    .map(p=>Object.assign(p,{tag:p.me?'':p.role}));
}
const statusChip=r=>r?(r.approved?'<span class="wr-chip">Approved</span>':'<span class="wr-chip">Draft · not approved</span>'):'';
const reportLine=(g,r)=>r?`Pregame report ${esc(r.id.slice(0,8))}${r.created?' · '+esc(fmt({month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(r.created))+' ET':''} · ${r.approved?'Approved':'Draft · not approved'}`:'';
const emptyMsg=(D,what)=>D.v.mgmt?`No pregame report with a posted ${what} for this game yet.`:`${what==='lineup'?'Lineup':'Matchup notes'} post${what==='lineup'?'s':''} here once management approves tonight's report.`;
function lastMeeting(D,g){
  const prev=D.schedule.filter(r=>r.status==='final'&&r.calgary_score!=null&&norm(r.opponent_name)===norm(g.name)&&new Date(r.scheduled_at)<g.at).pop();
  if(!prev) return 'First meeting';
  const w=+prev.calgary_score>+prev.opponent_score;
  return `Last: ${w?'W':(prev.overtime?'OTL':'L')} ${prev.calgary_score}–${prev.opponent_score}`;
}
const dayLabel=D=>D.day?etDay(new Date(D.games[0].at)):'';
const tabsGames=D=>D.games.map(g=>({gm:g.gm,abbr:g.abbr,time:g.time,home:g.home,kit:g.kit,g}));
const initialGm=D=>{const q=+new URLSearchParams(location.search).get('gm');return D.games.some(g=>g.gm===q)?q:1};

/* ---------- War Room (landing f + lineup c) ---------- */
function mountWarRoom(host,D){
  if(!D.games.length){host.innerHTML=`<div class="wr-panel wr-empty"><span class="wr-k">Tonight</span><h3>No games on the schedule</h3><p>Tonight's Six, jobs and scouting appear here on the next game day.</p></div>${raceHTML(D)}`;return}
  const n=D.games.length;
  host.innerHTML=`<div class="wr-tn-grid">
   <div class="wr-tn-main">
    <h3 class="wr-sec">${D.today?'Tonight':'Next game day'} · ${n} game${n>1?'s':''} <span>${esc(dayLabel(D))}</span></h3>
    <div class="wr-games n${Math.min(n,4)}">${D.games.map(g=>gameCard(D,g)).join('')}</div>
    <section class="wr-panel wr-six" aria-label="Tonight's six">
      <div class="wr-six-hd"><div><span class="wr-k">Posted lineup · ${esc(dayLabel(D))}</span><h3>Tonight's Six</h3></div><div class="wr-six-st" id="wrSixStatus"></div></div>
      ${D.v.mgmt?'<nav class="wr-links" aria-label="Lineup tools"><a href="hitmen-locker-room.html">Set lines in the Lineup Room →</a><a href="hitmen-battle-plan.html">Battle Plan →</a></nav>':''}
      <div id="wrTabs"></div>
      <div class="wr-six-bd"><div class="wr-rink-host"><div id="wrRink"></div></div><ol class="wr-roll" id="wrRoll"></ol></div>
      <div class="wr-jobs-hd" id="wrJobsHd"></div>
      <div class="wr-jobs" id="wrJobs"></div>
      <p class="wr-note">Pick a game to switch the kit, the six, every job and the scouting panel. Kit: home black, away white (from <code>hitmen_schedule_games</code>). Lineup and jobs from that game's pregame report; names and numbers from <code>team_player_lockers</code>. Players see jobs only after management approves the report.</p>
    </section>
    <section class="wr-panel wr-reel" aria-label="Highlight reel (coming soon)">
      <div class="wr-reel-hd"><div><span class="wr-k">Coming soon · reserved slot</span><h3>Highlight Reel</h3></div><span class="wr-chip">Player-safe only</span></div>
      <p>Great plays, big hits and big saves, flagged by management from game film and published here as short clips once approved.</p>
      <div class="wr-frames"><div><b>Goal of the week</b><small>clip slot</small></div><div><b>Big hit</b><small>clip slot</small></div><div><b>Big save</b><small>clip slot</small></div><div><b>Play of the night</b><small>clip slot</small></div></div>
    </section>
   </div>
   <aside class="wr-tn-side">
    <section class="wr-panel wr-across" id="wrAcross" aria-live="polite"></section>
    ${raceHTML(D)}
   </aside></div>`;
  WRRink.tabs($('wrTabs'),$('wrRink'),{games:tabsGames(D),active:initialGm(D),size:'sm',rink:{scale:3.85,jersey:72,small:true},
    playersFor:t=>sixFor(D,t.g),empty:(el,t)=>{el.removeAttribute('style');el.removeAttribute('data-w');el.className='wr-rink-empty';el.parentElement.style.height='';el.innerHTML=`<div><b>Lineup posts before puck drop</b><span>${esc(emptyMsg(D,'lineup'))}</span></div>`},
    onChange:t=>{const g=t.g,r=g.report,ps=sixFor(D,g);
      $('wrSixStatus').innerHTML=statusChip(r);
      $('wrRoll').innerHTML=ps.length?ps.map(p=>`<li class="${p.me?'me':''}"><span>${p.pos}</span><b>${esc(p.locker?.gamertag||p.name)}</b><i>${esc(p.no||'–')}</i></li>`).join(''):'';
      $('wrJobsHd').innerHTML=`<b>GM ${g.gm} jobs · ${g.home?'vs':'@'} ${esc(g.short)} · ${esc(g.time)} ET</b><span>${reportLine(g,r)}</span>`;
      $('wrJobs').innerHTML=jobsHTML(D,g,ps);
      $('wrAcross').innerHTML=acrossHTML(D,g);
    }});
}
function gameCard(D,g){
  const t=g.team,r=g.report,blurb=r&&r.threats[0]?r.threats[0]:(D.v.mgmt?'No pregame report for this game yet.':'Matchup notes post once management approves the report.');
  return `<article class="wr-g"><div class="row">${crest(g.lg,44,g.abbr)}<div><span class="wr-k">${esc(g.time)} ET · ${g.home?'Home':'Away'} · GM ${g.gm}</span><h4>${esc(g.short)}</h4></div></div>
   <div class="meta">${t?`<span class="wr-chip">${t.w}-${t.l}-${t.otl}${t.division_rank?' · '+ord(t.division_rank):''}</span>`:''}<span class="wr-chip">${esc(lastMeeting(D,g))}</span></div>
   <p>${esc(blurb)}</p></article>`;
}
function jobsHTML(D,g,ps){
  const r=g.report;
  if(!r||!ps.length) return `<div class="wr-empty-row">${esc(emptyMsg(D,'jobs'))}</div>`;
  return ps.map(p=>{const job=r.jobs[norm(p.locker?.gamertag||'')]||r.jobs[norm(r.six[p.pos])];
    return `<article class="wr-job${p.me?' me':''}"><header><span>${p.pos}${p.me?' · YOU':p.role?' · '+esc(p.role):''}</span><b>${esc(p.locker?.gamertag||r.six[p.pos])}</b><i>${p.no?'#'+esc(p.no):'no #'}</i></header>
      <p>${job?esc(job):`<span class="wr-dim">No job for this player in the GM ${g.gm} report.</span>`}</p></article>`}).join('');
}
const acrossLinks=D=>D.v.mgmt?'<nav class="wr-links" aria-label="Opponent tools"><a href="hitmen-opponents.html">Full opponent file →</a><a href="vod-lab.html?team=calgary-hitmen">Film →</a></nav>':'';
function acrossHTML(D,g){
  const r=g.report;
  const head=`<div class="wr-across-hd">${crest(g.lg,44,g.abbr)}<div><span class="wr-k">Across from us · GM ${g.gm} · ${esc(g.time)} ET</span><h3>${esc(g.short)}</h3></div></div>`;
  if(!r) return head+`<div class="wr-empty-row">${D.v.mgmt?'No scouting report for this game yet.':'Scouting posts here once management approves tonight\'s report.'}</div>`+acrossLinks(D);
  return head+
   (r.opp.length?`<span class="wr-k wr-sub">Projected six</span><dl class="wr-opp">${r.opp.map(o=>`<div><dt>${o.pos}</dt><dd>${esc(o.name)}${o.note?`<small>${esc(o.note)}</small>`:''}</dd></div>`).join('')}</dl>`:'')+
   (r.threats.length?`<span class="wr-k wr-sub">Key threats</span><ul class="wr-threats">${r.threats.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`:'')+
   (r.plan.length?`<span class="wr-k wr-sub">Game plan</span><ol class="wr-plan">${r.plan.map(t=>`<li>${esc(t)}</li>`).join('')}</ol>`:'')+
   `<p class="wr-note">${r.approved?'Approved':'Draft · not approved'}. Condensed from the report text; nothing added.</p>`+acrossLinks(D);
}
function raceHTML(D){
  const div=D.cgy?.division; const rows=div?D.standings.filter(t=>t.division===div).sort((a,b)=>(a.division_rank||99)-(b.division_rank||99)):[];
  if(!rows.length) return `<section class="wr-panel wr-race"><span class="wr-k">Division race</span><div class="wr-empty-row">Standings aren't available right now.</div></section>`;
  const at=rows[0].standings_at?new Date(rows[0].standings_at):null;
  return `<section class="wr-panel wr-race"><span class="wr-k wr-lu">Division race · ${esc(div)}</span>
   <table class="wr-st"><thead><tr><th>#</th><th>Team</th><th>GP</th><th>W-L-OTL</th><th>PTS</th><th>GD</th><th>STK</th></tr></thead><tbody>
   ${rows.map(t=>`<tr class="${t.lg_team_id===CGY?'cg':''}"><td>${t.division_rank??''}</td><td>${crest(t.lg_team_id,20,t.abbr)}<span>${esc((t.nickname||t.name).toUpperCase())}</span></td><td>${t.gp}</td><td>${t.w}-${t.l}-${t.otl}</td><td>${t.pts}</td><td>${t.gd>0?'+':''}${t.gd}</td><td>${esc(String(t.streak||'').replace('-',''))}</td></tr>`).join('')}
   </tbody></table><p class="wr-note">LG standings${at?' as of '+esc(fmt({month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(at))+' ET':''}.</p></section>`;
}

/* ---------- Team locker: entry + locker room TVs (e1) ---------- */
function mountLockerTVs(host,D){
  const g0=D.games[0],c=D.cgy,n=D.games.length;
  const rec=c?`${c.w}-${c.l}-${c.otl} · ${c.pts} PTS`:'';
  const entry=`<section class="wr-entry wr-panel">
    <div class="wr-entry-l"><span class="wr-k">${n?`Game night · ${esc(dayLabel(D))} · ${n} game${n>1?'s':''}`:'War Room'}</span><h2>Enter the War Room</h2>
     <p>${D.v.mgmt?'Tonight\'s opponents, the posted six, every job and the live league board. Players see jobs and scouting once you approve the pregame report.':'Tonight\'s opponents, the posted six and your job in each matchup. Jobs and scouting post here once management approves the pregame report.'}</p>
     <div class="wr-btns">${D.v.mgmt?'<a class="wr-btn on" href="hitmen-workspace.html">Open War Room →</a>':''}<a class="wr-btn" href="hitmen-player-locker.html">My stall</a></div></div>
    <div class="wr-entry-r">${g0?`<span class="wr-k">Puck drop · ${g0.home?'vs':'@'} ${esc(g0.short)}</span><b class="wr-cd" data-wr-cd="${+g0.at}">${countdown(+g0.at)}</b>`:'<span class="wr-k">Next game</span><b class="wr-cd">TBA</b>'}
     <div class="wr-chips">${rec?`<span class="wr-chip">${esc(rec)}</span>`:''}${c?.division_rank?`<span class="wr-chip">${ord(c.division_rank)} ${esc(String(c.division||'').replace(/^WHL /,'WHL '))}</span>`:''}${c?.streak?`<span class="wr-chip">Streak ${esc(String(c.streak).replace('-','').replace(/^(\d+)([WL])$/,'$2$1'))}</span>`:''}</div></div>
   </section>`;
  const tv=(ch,label,body,l3a,l3b,cls)=>`<article class="wr-tv ${cls||''}"><div class="wr-tv-scr"><div class="wr-tv-hd"><span class="wr-k">${label}</span><span class="wr-tv-ch">${ch}</span></div>${body}</div><div class="wr-tv-l3"><b>${l3a}</b><span>${l3b}</span></div></article>`;
  const then=D.games.slice(1).map(g=>`${esc(g.short)} ${esc(g.time.replace(' PM','').replace(' AM',''))}`).join(' · ');
  const tv1=g0?tv('TV 1 · Next up',`Game 1 of ${n} · ${esc(g0.time)} ET`,
     `<div class="wr-tv-vs"><div>${crest(CGY,64,'CGY')}<b>Hitmen</b><small>${c?`${c.w}-${c.l}-${c.otl}`:''}</small></div><i>${g0.home?'VS':'@'}</i><div>${crest(g0.lg,64,g0.abbr)}<b>${esc(g0.team?.nickname||g0.short)}</b><small>${g0.team?`${g0.team.w}-${g0.team.l}-${g0.team.otl}`:''}</small></div></div><b class="wr-cd" data-wr-cd="${+g0.at}">${countdown(+g0.at)}</b>`,
     'Next opponent',then?`Then ${then}`:esc(lastMeeting(D,g0))):
     tv('TV 1 · Next up','Next game','<div class="wr-tv-empty">No games on the schedule.</div>','Next opponent','TBA');
  const tv2=tv('TV 2 · Lineup','<span id="wrTvSixLbl">Tonight\'s six</span>',n?'<div id="wrTvTabs"></div><div class="wr-rink-host"><div id="wrTvRink"></div></div>':'<div class="wr-tv-empty">Lineup posts before puck drop.</div>','Posted lineup','<span id="wrTvKit"></span>');
  const tv3=tv('TV 3 · Matchup','<span id="wrTvKeysLbl">Keys</span>','<div id="wrTvKeys"></div>','Matchup keys','<span id="wrTvWatch"></span>');
  host.innerHTML=entry+`<section class="wr-tvs" aria-label="Locker room TVs"><div class="wr-tvs-hd"><div><span class="wr-k">Locker room TVs · fed by the War Room</span><h2>On the screens tonight</h2></div><p>Each TV shows the same player-safe data as the War Room.</p></div>
    <div class="wr-tv-row3">${tv1}${tv2}${tv3}</div><div class="wr-tv-row2">${resultsTV(D,tv)}${standingsTV(D,tv)}</div></section>`;
  if(!n){$('wrTvKeys').innerHTML='<div class="wr-tv-empty">Matchup keys post on game day.</div>';return}
  WRRink.tabs($('wrTvTabs'),$('wrTvRink'),{games:tabsGames(D),active:1,size:'xs',rink:{scale:2.2,jersey:44,small:true},
    playersFor:t=>sixFor(D,t.g),empty:(el)=>{el.removeAttribute('style');el.removeAttribute('data-w');el.className='wr-rink-empty sm';el.parentElement.style.height='';el.innerHTML=`<div><b>Lineup posts before puck drop</b><span>${esc(emptyMsg(D,'lineup'))}</span></div>`},
    onChange:t=>{const g=t.g,r=g.report;
      $('wrTvSixLbl').textContent=`Tonight's six · GM ${g.gm} ${g.home?'vs':'@'} ${g.abbr} · ${g.home?'Home':'Away'} kit`;
      $('wrTvKit').textContent=g.home?'Home kit: black':'Away kit: white';
      $('wrTvKeysLbl').textContent=`Keys ${g.home?'vs':'@'} ${g.short}`;
      $('wrTvKeys').innerHTML=r&&r.plan.length?`<ol class="wr-plan">${r.plan.map(x=>`<li>${esc(x)}</li>`).join('')}</ol>${D.v.mgmt&&!r.approved?'<p class="wr-note">Draft · not approved (management view). Players see nothing here yet.</p>':''}`:`<div class="wr-tv-empty">${esc(emptyMsg(D,'keys'))}</div>`;
      $('wrTvWatch').textContent=r&&r.threats[0]?r.threats[0]:'';
    }});
}
function resultsTV(D,tv){
  const finals=D.schedule.filter(r=>r.status==='final'&&r.calgary_score!=null&&r.opponent_score!=null);
  if(!finals.length) return tv('TV 4 · Results','Latest results','<div class="wr-tv-empty">No results yet this season.</div>','Results','From hitmen_schedule_games','wide');
  const wk=finals[finals.length-1].week, rows=finals.filter(r=>r.week===wk);
  const days=[...new Set(rows.map(r=>etKey(new Date(r.scheduled_at))))];
  let w=0,l=0,o=0;rows.forEach(r=>{+r.calgary_score>+r.opponent_score?w++:r.overtime?o++:l++});
  const body=`<div class="wr-res">${days.map(k=>{const dr=rows.filter(r=>etKey(new Date(r.scheduled_at))===k);
    return `<div><span class="wr-k">${esc(etDay(new Date(dr[0].scheduled_at)))}</span>${dr.map(r=>{const t=D.teamFor(r.opponent_name),win=+r.calgary_score>+r.opponent_score;
      return `<div class="wr-res-r${win?' w':''}">${crest(t?.lg_team_id,20,t?.abbr||'')}<b>${esc(t?.nickname||r.opponent_name)}</b><i>${win?'W':r.overtime?'OTL':'L'} ${r.calgary_score}–${r.opponent_score}</i></div>`}).join('')}</div>`}).join('')}</div>`;
  return tv('TV 4 · Results',`Latest results · Week ${esc(wk??'')}`,body,`Week ${esc(wk??'')} · ${w}-${l}-${o}`,'From hitmen_schedule_games','wide');
}
function standingsTV(D,tv){
  const div=D.cgy?.division,rows=div?D.standings.filter(t=>t.division===div).sort((a,b)=>(a.division_rank||99)-(b.division_rank||99)):[];
  const body=rows.length?`<table class="wr-st wr-st-tv"><tbody>${rows.map(t=>`<tr class="${t.lg_team_id===CGY?'cg':''}"><td>${t.division_rank??''}</td><td>${esc(t.nickname||t.name)}</td><td>${t.pts}</td></tr>`).join('')}</tbody></table>`:'<div class="wr-tv-empty">Standings aren\'t available right now.</div>';
  const at=rows[0]?.standings_at?new Date(rows[0].standings_at):null;
  return tv('TV 5 · Standings',esc(div||'Standings'),body,'Standings',at?`LG snapshot ${esc(fmt({month:'short',day:'numeric'}).format(at))}`:'LG standings');
}

/* ---------- Player stall: tonight + kit (e2) ---------- */
function pickLocker(D){
  const wanted=new URLSearchParams(location.search).get('player'),me=D.v.user?.id;
  const mine=D.lockers.find(l=>l.user_id===me)||null;
  if(wanted){const t=D.lockers.find(l=>l.id===wanted);if(t&&(D.v.manage||t.user_id===me))return t}
  return mine;
}
function mountStall(host,D){
  const L=pickLocker(D);
  if(!L){host.innerHTML='';host.hidden=true;return}
  host.hidden=false;
  const inSix=g=>{const s=g.report?.six;return s?POS.find(p=>norm(s[p])===norm(L.gamertag))||null:null};
  const dressed=D.games.filter(inSix);
  const anyLineup=D.games.some(g=>g.report?.six);
  host.innerHTML=`<article class="wr-panel wr-stall-tn"><div class="wr-stall-hd"><span class="wr-k">Tonight in the War Room</span><div id="wrStallTabs"></div></div><div id="wrStallJob"></div></article>
   <article class="wr-panel wr-kit"><span class="wr-k">Gear &amp; jersey</span><h3>Kit</h3>
    <div class="wr-kit-bd"><div class="wr-kit-jy" id="wrKitJy"></div>
     <dl><div><dt>Jersey</dt><dd>${esc((L.jersey_name||L.gamertag||'').toUpperCase())}${L.jersey_number?' · #'+esc(L.jersey_number):' · no number set'}</dd></div>
      <div><dt>Kit</dt><dd><span class="wr-kit-sw" role="group" aria-label="Kit"><button type="button" data-kit="home" class="on">Home black</button><button type="button" data-kit="away">Away white</button></span></dd></div>
      <div><dt>Tonight</dt><dd>${D.games.length?D.games.map(g=>`GM ${g.gm} ${g.home?'home':'away'}`).join(' · '):'No game scheduled'}</dd></div>
      <div><dt>Handedness</dt><dd>${esc(L.handedness?L.handedness[0].toUpperCase()+L.handedness.slice(1):'—')}</dd></div>
      <div><dt>Dressed</dt><dd>${dressed.length?dressed.map(g=>'GM '+g.gm).join(' · '):anyLineup?'Not in tonight\'s posted six':'Lineup not posted yet'}</dd></div></dl></div>
    <p class="wr-note">Name and number from your locker (<code>team_player_lockers</code>). ${L.jersey_number?'':'No number set, so the jersey carries the nameplate only.'}</p></article>`;
  const kitDraw=k=>{$('wrKitJy').innerHTML=WRRink.jersey({name:L.jersey_name||L.gamertag,no:L.jersey_number},220,k);host.querySelectorAll('[data-kit]').forEach(b=>b.classList.toggle('on',b.dataset.kit===k))};
  host.querySelectorAll('[data-kit]').forEach(b=>b.onclick=()=>kitDraw(b.dataset.kit));
  kitDraw(D.games[0]?.kit||'home');
  if(!D.games.length){$('wrStallJob').innerHTML='<div class="wr-empty-row">No game on the schedule tonight.</div>';return}
  WRRink.tabs($('wrStallTabs'),null,{games:tabsGames(D),active:(dressed[0]||D.games[0]).gm,size:'sm',onChange:t=>{
    const g=t.g,r=g.report,pos=inSix(g),job=r&&pos?(r.jobs[norm(L.gamertag)]||''):'';
    const txt=!r?(D.v.mgmt?'No pregame report for this game yet.':'Your job posts here once management approves tonight\'s report.')
      :!r.six?'Lineup not posted in this report yet.':!pos?'Not in the posted six for this game.':job?'':`No job for this player in the GM ${g.gm} report.`;
    $('wrStallJob').innerHTML=`<div class="wr-stall-g">${crest(g.lg,52,g.abbr)}<div><span class="wr-k">${g.home?'vs':'@'} ${esc(g.short)} · ${esc(g.time)} ET${pos?' · '+POS_LONG[pos]:''}</span>
      ${job?`<p><b>Your job:</b> ${esc(job)}</p>`:`<p class="wr-dim">${esc(txt)}</p>`}${r&&!r.approved&&D.v.mgmt?'<p class="wr-note">Draft · not approved (management view). The player sees nothing here yet.</p>':''}</div>
      <div class="wr-stall-cd"><span class="wr-k">Puck drop</span><b class="wr-cd" data-wr-cd="${+g.at}">${countdown(+g.at)}</b>${D.v.mgmt?'<a class="wr-btn" href="hitmen-workspace.html">Open War Room →</a>':''}</div></div>`;
  }});
}

/* ---------- boot ---------- */
const MOUNTS=[['wrTonight',mountWarRoom],['wrLockerTVs',mountLockerTVs],['wrStallTonight',mountStall]];
async function run(){
  const hosts=MOUNTS.filter(([id])=>$(id)); if(!hosts.length||!window.WRRink) return;
  if(!viewer().user) return;
  lastUid=viewer().user.id;
  const D=await data(); if(!D) return;
  hosts.forEach(([id,fn])=>{try{fn($(id),D)}catch(e){console.error('[war-room-tonight]',id,e);$(id).innerHTML='<div class="wr-panel wr-empty-row">This panel could not load.</div>'}});
  if(D.errors.length) console.warn('[war-room-tonight] partial data:',D.errors);
}
let lastUid;
window.addEventListener('vvhl-auth-change',()=>{const uid=viewer().user?.id||null;if(uid!==lastUid){lastUid=uid;cache=null}run()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
window.WRTonight={reload:()=>{cache=null;return run()},parseReport};
})();
