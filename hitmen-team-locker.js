(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isAdmin=()=>String(ST().profile?.role||'').toLowerCase()==='admin';
const membership=()=> (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false);
const allowed=()=>Boolean(ST().user&&(isAdmin()||membership()));
function gate(){
 const ok=allowed(),content=document.querySelector('[data-locker-content]'),locked=E('lockerLockedMessage'),status=E('lockerAccessStatus');
 if(content)content.hidden=!ok;if(locked)locked.hidden=ok;
 if(status)status.textContent=ok?'AUTHORIZED · '+(isAdmin()?'ADMIN':String(membership()?.role||'TEAM').toUpperCase()):(ST().user?'SIGNED IN · NO TEAM ACCESS':'PRIVATE · TEAM ONLY');
 if(ok)load();
}
function jersey(l){
 const name=esc((l.jersey_name||l.gamertag||'HITMEN').toUpperCase()),num=esc(l.jersey_number||'');
 return '<div class="stall-neon"></div><div class="stall-top-shelf">'+
   '<div class="equipment helmet-eq"><span>'+num+'</span></div><div class="equipment glove-eq left"></div><div class="equipment glove-eq right"></div><div class="equipment bag-eq">H</div>'+
 '</div><div class="stall-rail"></div><div class="stall-hook"></div>'+
 '<div class="stall-side-art left"><i></i><b></b></div><div class="stall-side-art right"><i></i><b></b></div>'+
 '<div class="mini-jersey-flip" data-jersey-flip role="button" tabindex="0" aria-label="Flip jersey front to back">'+
   '<div class="mini-jersey-card">'+
     '<div class="mini-jersey-face mini-jersey-front"><div class="mini-jersey-body"></div><div class="mini-jersey-crest">HITMEN</div><div class="mini-jersey-sleeve-num left">'+num+'</div><div class="mini-jersey-sleeve-num right">'+num+'</div></div>'+
     '<div class="mini-jersey-face mini-jersey-back"><div class="mini-jersey-body"></div><div class="mini-jersey-name">'+name+'</div><div class="mini-jersey-number">'+num+'</div></div>'+
   '</div><span class="mini-flip-hint">TAP TO FLIP</span>'+
 '</div><div class="stall-skates"><i></i><i></i></div><div class="stall-gloves"><i></i><i></i></div>'+
 '<div class="stall-bench"><span>HITMEN</span></div><div class="stall-underlight"></div>';
}
async function load(){
 if(!allowed()||!DB())return;
 const [lr,rr]=await Promise.all([
  DB().from('team_player_lockers').select('*').eq('team_id',TEAM).eq('season',SEASON).order('position').order('gamertag'),
  DB().from('team_line_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('week',{ascending:false}).limit(12)
 ]);
 if(lr.error){E('lockerRoster').innerHTML='<div class="locker-empty">'+esc(lr.error.message)+'</div>';return}
 const lockers=lr.data||[],reports=rr.data||[];
 E('lockerRosterCount').textContent=lockers.length;
 E('lockerReportCount').textContent=reports.length;
 const currentWeek=reports[0]?.week||1;E('lockerWeek').textContent=currentWeek;
 const order={LW:1,C:2,RW:3,LD:4,RD:5,G:6};lockers.sort((a,b)=>(order[a.position]||9)-(order[b.position]||9)||a.gamertag.localeCompare(b.gamertag));
 E('lockerRoster').innerHTML=lockers.map(l=>{const displayName=esc((l.jersey_name||l.gamertag).toUpperCase()),displayNum=esc(l.jersey_number||'');return '<a class="locker-stall" href="hitmen-player-locker.html?player='+l.id+'"><div class="stall-nameplate"><span class="stall-logo-chip">H</span><span class="stall-name-num">'+displayNum+'</span><strong>'+displayName+'</strong><span class="stall-name-num">'+displayNum+'</span><span class="stall-logo-chip">H</span></div><div class="stall-position-strip">'+esc(l.position||'—')+(l.management_role?' · '+esc(l.management_role):'')+'</div><div class="stall-interior">'+jersey(l)+'</div><div class="stall-footer"><small>'+(l.user_id?'<span class="stall-claimed">PLAYER ACCESS LINKED</span>':'<span class="stall-unclaimed">STALL UNCLAIMED</span>')+'</small><b>ENTER STALL →</b></div></a>'}).join('');
 E('lockerLineReports').innerHTML=reports.length?reports.slice(0,6).map(r=>'<article class="line-report-card"><div class="eyebrow">WEEK '+esc(r.week)+'</div><h3>'+esc(r.line_label)+'</h3><p>'+esc(r.summary||'Weekly line report will populate after games are reviewed.')+'</p><div class="line-meta"><span>'+esc(r.record||'0-0-0')+'</span><span>GF '+esc(r.goals_for??'—')+'</span><span>GA '+esc(r.goals_against??'—')+'</span></div></article>').join(''):'<div class="locker-empty">Line reports will begin populating once Week 1 games are played and reviewed.</div>';
 bindJerseyFlips();
}
function bindJerseyFlips(){
 document.querySelectorAll('[data-jersey-flip]').forEach(el=>{
   const flip=e=>{e.preventDefault();e.stopPropagation();el.classList.toggle('is-flipped');el.setAttribute('aria-label',el.classList.contains('is-flipped')?'Flip jersey back to front':'Flip jersey front to back');};
   el.addEventListener('click',flip);
   el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){flip(e)}});
 });
}
window.addEventListener('vvhl-auth-change',gate);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();