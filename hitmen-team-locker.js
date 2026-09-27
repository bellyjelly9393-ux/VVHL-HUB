(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const role=()=>{
 const s=ST(),pr=String(s.profile?.role||'').toLowerCase();
 if(['admin','commissioner'].includes(pr))return pr;
 return String((s.memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false)?.role||'').toLowerCase();
};
const allowed=()=>Boolean(ST().user&&['admin','commissioner','owner','gm','agm','scout'].includes(role()));
let lockers=[],snapshots=[],lineReports=[],playerReports=[],gameReports=[];

function jersey(l){
 const num=esc(l.jersey_number||''),name=esc((l.jersey_name||l.gamertag||'HITMEN').toUpperCase());
 return '<div class="team-preview-jersey" aria-hidden="true" title="Calgary Hitmen jersey"><div class="team-preview-jersey-art"></div><span class="team-preview-name">'+name+'</span>'+(num?'<span class="team-preview-sleeve left">'+num+'</span><span class="team-preview-sleeve right">'+num+'</span><span class="team-preview-number">'+num+'</span>':'')+'</div>';
}
function snap(l){return snapshots.find(r=>r.id===l.roster_snapshot_id)||{}}
function reportsFor(l){
 const key=String(l.gamertag||'').trim().toLowerCase();
 return playerReports.filter(r=>String(r.player_key||'').trim().toLowerCase()===key).length+
        gameReports.filter(r=>r.locker_id===l.id).length;
}
function stall(l){
 const s=snap(l),tc=l.roster_class==='tc'||String(s.acquisition||'').toLowerCase()==='prospect';
 const displayName=esc((l.jersey_name||l.gamertag).toUpperCase()),displayNum=esc(l.jersey_number||'');
 const roleLabel=l.management_role?esc(l.management_role.toUpperCase()):(tc?'TC':'ROSTER');
 const linked=l.user_id?'<span class="stall-claimed">DISCORD/ACCOUNT LINKED</span>':'<span class="stall-unclaimed">UNCLAIMED</span>';
 const reportCount=reportsFor(l);
 return '<a class="locker-stall locker-preview-v2 '+(tc?'is-tc':'')+'" href="hitmen-player-locker.html?player='+encodeURIComponent(l.id)+'">'+
   '<div class="stall-nameplate stall-nameplate-v2"><span class="stall-name-num">'+displayNum+'</span><strong>'+displayName+'</strong><span class="stall-name-num">'+displayNum+'</span></div>'+
   '<div class="stall-interior stall-preview-scene">'+jersey(l)+'</div>'+
   '<div class="stall-footer stall-footer-v2"><small><span class="stall-position">'+esc(l.position||'—')+'</span> · '+roleLabel+' · '+reportCount+' REPORT'+(reportCount===1?'':'S')+'</small><small>'+linked+'</small><b>OPEN DOSSIER →</b></div>'+
 '</a>';
}
async function load(){
 if(!allowed()||!DB())return;
 const [lr,sr,rr,gr,lines]=await Promise.all([
  DB().from('team_player_lockers').select('*').eq('team_id',TEAM).eq('season',SEASON).order('gamertag'),
  DB().from('hitmen_roster_snapshot').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('active',true).order('lg_slot'),
  DB().from('hitmen_player_reports').select('id,player_key,summary,strengths,concerns,created_at').eq('team_id',TEAM).eq('season',SEASON),
  DB().from('team_player_game_reports').select('id,locker_id').eq('team_id',TEAM).eq('season',SEASON),
  DB().from('team_line_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('week',{ascending:false}).limit(12)
 ]);
 const err=[lr,sr,rr,gr,lines].find(x=>x.error)?.error;
 if(err){console.error(err);E('lockerRoster').innerHTML='<div class="locker-empty">'+esc(err.message||'Could not load locker room.')+'</div>';return}
 lockers=lr.data||[];snapshots=sr.data||[];playerReports=rr.data||[];gameReports=gr.data||[];lineReports=lines.data||[];
 const order={LW:1,C:2,RW:3,LD:4,RD:5,G:6};
 lockers.sort((a,b)=>(a.roster_class==='tc')-(b.roster_class==='tc')||(order[a.position]||9)-(order[b.position]||9)||a.gamertag.localeCompare(b.gamertag));
 const active=lockers.filter(l=>l.roster_class!=='tc'),tc=lockers.filter(l=>l.roster_class==='tc');
 E('lockerRosterCount').textContent=active.length;E('lockerTcCount').textContent=tc.length;
 E('lockerReportCount').textContent=playerReports.length+gameReports.length;
 E('lockerRoster').innerHTML=active.map(stall).join('')||'<div class="locker-empty">No active roster stalls loaded.</div>';
 E('lockerTcRoster').innerHTML=tc.map(stall).join('')||'<div class="locker-empty">No TC stalls loaded.</div>';
 E('lockerLineReports').innerHTML=lineReports.length?lineReports.slice(0,6).map(r=>'<article class="line-report-card"><div class="eyebrow">WEEK '+esc(r.week)+'</div><h3>'+esc(r.line_label)+'</h3><p>'+esc(r.summary||'Weekly line report will populate after games are reviewed.')+'</p><div class="line-meta"><span>'+esc(r.record||'0-0-0')+'</span><span>GF '+esc(r.goals_for??'—')+'</span><span>GA '+esc(r.goals_against??'—')+'</span></div></article>').join(''):'<div class="locker-empty">Line reports will populate once saved units have game evidence.</div>';
}
window.addEventListener('vvhl-auth-change',()=>{if(allowed())load()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{if(allowed())load()});else if(allowed())load();
})();