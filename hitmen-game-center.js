(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let locker=null,schedule=[],sessions=[],intel=[];
const fmtDate=v=>new Date(v).toLocaleDateString([],{month:'short',day:'numeric'});
const fmtTime=v=>new Date(v).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
function setText(id,v){const el=E(id);if(el)el.textContent=v??'—'}
function membership(){return (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false)}
async function resolveLocker(){
 if(!ST().user||!DB())return null;
 const r=await DB().from('team_player_lockers').select('id,gamertag,position,management_role,jersey_name,jersey_number,chel_player_image_path,availability_status').eq('team_id',TEAM).eq('season',SEASON).eq('user_id',ST().user.id).limit(1).maybeSingle();
 if(r.error)throw r.error;return r.data||null;
}
async function avatar(path){
 if(!path)return null;
 const r=await DB().storage.from('hitmen-player-images').createSignedUrl(path,3600);
 return r.error?null:r.data?.signedUrl||null;
}
function allow(){return Boolean(ST().user&&(locker||membership()||String(ST().profile?.role||'').toLowerCase()==='admin'))}
function setStallLinks(){
 const href=locker?'hitmen-player-locker.html?player='+encodeURIComponent(locker.id):'hitmen-player-locker.html';
 ['gcMyStallSide','gcMyStallTop','gcMyStallHero','gcMyStallTool'].forEach(id=>{if(E(id))E(id).href=href});
}
function record(){
 const finals=schedule.filter(g=>g.status==='final');
 let w=0,l=0,otl=0;
 finals.forEach(g=>{const a=Number(g.calgary_score),b=Number(g.opponent_score);if(a>b)w++;else if(g.overtime)otl++;else l++});
 setText('gcRecord',w+'-'+l+'-'+otl);setText('gcGamesPlayed',finals.length+' game'+(finals.length===1?'':'s')+' played');
}
function nextGame(){
 const now=Date.now(),up=schedule.filter(g=>g.status!=='final'&&new Date(g.scheduled_at).getTime()>=now).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at));
 const g=up[0],box=E('gcNextGame');if(!box)return null;
 if(!g){box.innerHTML='<div class="gc-empty">No upcoming game is currently scheduled.</div>';setText('gcNextWeek','SEASON 55');return null}
 setText('gcNextWeek','WEEK '+g.week);
 box.innerHTML='<div class="gc-next-match"><div><small>'+esc(fmtDate(g.scheduled_at))+'</small><h3>CALGARY vs '+esc(g.opponent_name)+'</h3><p>LGCHL Season 55 · Week '+esc(g.week)+'</p></div><time>'+esc(fmtTime(g.scheduled_at))+'</time></div>';
 return g;
}
function tonight(){
 const box=E('gcTonight');if(!box)return;
 const d=new Date(),key=d.toLocaleDateString();
 const rows=schedule.filter(g=>new Date(g.scheduled_at).toLocaleDateString()===key);
 setText('gcTonightCount',rows.length+' GAME'+(rows.length===1?'':'S'));
 box.innerHTML=rows.length?rows.map(g=>'<div class="gc-list-item"><div><b>vs '+esc(g.opponent_name)+'</b><small>Week '+esc(g.week)+' · '+esc(String(g.status||'scheduled').toUpperCase())+'</small></div><strong>'+esc(fmtTime(g.scheduled_at))+'</strong></div>').join(''):'<div class="gc-empty">No Hitmen games scheduled today.</div>';
}
function upcoming(){
 const now=Date.now(),rows=schedule.filter(g=>g.status!=='final'&&new Date(g.scheduled_at).getTime()>=now).sort((a,b)=>new Date(a.scheduled_at)-new Date(b.scheduled_at)).slice(0,9);
 setText('gcScheduleCount',rows.length+' UPCOMING');
 E('gcSchedule').innerHTML=rows.length?rows.map(g=>'<div class="gc-schedule-row"><time>'+esc(fmtDate(g.scheduled_at))+'<br>'+esc(fmtTime(g.scheduled_at))+'</time><b>Calgary vs '+esc(g.opponent_name)+'</b><span>Week '+esc(g.week)+'</span><a href="hitmen-opponents.html?opponent='+encodeURIComponent(g.opponent_name)+'">SCOUT →</a></div>').join(''):'<div class="gc-empty">No upcoming games found.</div>';
}
function results(){
 const rows=schedule.filter(g=>g.status==='final').sort((a,b)=>new Date(b.scheduled_at)-new Date(a.scheduled_at)).slice(0,6);
 E('gcResults').innerHTML=rows.length?rows.map(g=>{const win=Number(g.calgary_score)>Number(g.opponent_score);return '<a class="gc-list-item" href="hitmen-game-report.html?game='+encodeURIComponent(g.id)+'"><div><b>'+esc(win?'WIN':'LOSS')+' · vs '+esc(g.opponent_name)+'</b><small>'+esc(fmtDate(g.scheduled_at))+(g.overtime?' · OT':'')+' · OPEN BREAKDOWN</small></div><strong>'+esc(g.calgary_score)+'-'+esc(g.opponent_score)+'</strong></a>'}).join(''):'<div class="gc-empty">No final results yet.</div>';
}
function streams(){
 const rows=sessions.filter(s=>s.stream_url).sort((a,b)=>new Date(b.scheduled_at||b.created_at)-new Date(a.scheduled_at||a.created_at)).slice(0,6);
 E('gcStreams').innerHTML=rows.length?rows.map(s=>'<div class="gc-list-item"><div><b>'+esc(s.label||('Calgary vs '+(s.opponent_label||'Opponent')))+'</b><small>'+esc(String(s.status||'scheduled').toUpperCase())+'</small></div><a class="gc-secondary" target="_blank" rel="noopener" href="'+esc(s.stream_url)+'">WATCH</a></div>').join(''):'<div class="gc-empty">No team streams are attached yet.</div>';
}
function opponentIntel(next){
 const box=E('gcIntel');if(!box)return;
 if(!next){box.innerHTML='<div class="gc-empty">No upcoming opponent.</div>';return}
 const o=intel.find(x=>String(x.opponent_name).toLowerCase()===String(next.opponent_name).toLowerCase());
 if(!o){box.innerHTML='<h3>'+esc(next.opponent_name)+'</h3><div class="gc-empty">Scouting report is still being built.</div>';return}
 const parts=[['SCOUTING READ',o.scouting_summary],['STRENGTHS',o.strengths],['WEAKNESSES',o.weaknesses],['DANGER PLAYERS',o.danger_players],['MATCHUP PLAN',o.matchup_plan]].filter(([,v])=>v);
 box.innerHTML='<h3>'+esc(o.opponent_name)+'</h3>'+parts.map(([k,v])=>'<div class="gc-intel-block"><small>'+k+'</small><p>'+esc(v)+'</p></div>').join('');
}
async function player(){
 const box=E('gcPlayerCard');if(!box)return;
 if(!locker){box.innerHTML='<div class="gc-empty">Management access active. No player stall is linked to this account.</div>';return}
 const img=await avatar(locker.chel_player_image_path),name=locker.jersey_name||locker.gamertag||'PLAYER';
 setText('gcTopPlayer',name.toUpperCase());
 E('gcAvatar').innerHTML=img?'<img src="'+esc(img)+'" alt="">':'H';
 box.innerHTML='<div class="gc-player-box"><div class="gc-player-avatar">'+(img?'<img src="'+esc(img)+'" alt="">':'H')+'</div><div><h3>'+esc(name)+'</h3><p>'+esc(locker.position||'—')+(locker.jersey_number?' · #'+esc(locker.jersey_number):'')+(locker.management_role?' · '+esc(locker.management_role):'')+'</p></div><a href="hitmen-player-locker.html?player='+encodeURIComponent(locker.id)+'">OPEN MY STALL →</a></div>';
}
async function load(){
 if(!ST().user||!DB()){E('gcApp').hidden=true;E('gcLocked').hidden=false;return}
 try{
  locker=await resolveLocker();
  const ok=allow();
  E('gcApp').hidden=!ok;E('gcLocked').hidden=ok;document.querySelector('.gc-access-shell').hidden=ok;
  if(!ok)return;
  setStallLinks();
  const [sr,ss,ir]=await Promise.all([
   DB().from('hitmen_schedule_games').select('id,week,scheduled_at,opponent_name,status,calgary_score,opponent_score,overtime').eq('team_id',TEAM).eq('season',SEASON).order('scheduled_at'),
   DB().from('team_competitive_sessions').select('id,label,opponent_label,status,scheduled_at,created_at,stream_url').eq('team_id',TEAM).order('created_at',{ascending:false}).limit(30),
   DB().rpc('hitmen_player_opponent_intel',{p_team_id:TEAM,p_season:SEASON})
  ]);
  if(sr.error)throw sr.error;if(ss.error)throw ss.error;if(ir.error)throw ir.error;
  schedule=sr.data||[];sessions=ss.data||[];intel=ir.data||[];
  record();const next=nextGame();tonight();upcoming();results();streams();opponentIntel(next);await player();
  setText('gcStatus','Hitmen Game Center is up to date.');
 }catch(e){console.error(e);setText('gcStatus','Could not load Game Center: '+(e.message||'Unknown error'))}
}
window.addEventListener('vvhl-auth-change',load);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();