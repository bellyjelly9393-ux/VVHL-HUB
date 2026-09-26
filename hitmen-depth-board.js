(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const member=()=> (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false);
const canView=()=>Boolean(ST().user&&(String(ST().profile?.role||'').toLowerCase()==='admin'||['owner','gm','agm','scout'].includes(String(member()?.role||'').toLowerCase())));
const order=['LW','C','RW','LD','RD','G'];
const groupName=p=>['LW','C','RW'].includes(p)?'FORWARDS':['LD','RD'].includes(p)?'DEFENSE':'GOALTENDERS';
function agg(reports){const t={gp:reports.length,g:0,a:0,p:0,pm:0};reports.forEach(r=>{const s=r.stats||{};t.g+=Number(s.goals||0);t.a+=Number(s.assists||0);t.pm+=Number(s.plus_minus||0)});t.p=t.g+t.a;return t}
function money(v){return v==null?'—':Number(v)===0?'MGMT':'$'+(Number(v)/1000000).toFixed(Number(v)%1000000?2:0)+'M'}
async function load(){
 if(!canView()||!DB()||!E('hitmenDepthBoard'))return;
 const [roster,lockers,reports]=await Promise.all([
   DB().from('hitmen_roster_snapshot').select('id,gamertag,position,salary,management_role,active,lg_slot').eq('team_id',TEAM).eq('season',SEASON).eq('active',true).order('lg_slot'),
   DB().from('team_player_lockers').select('id,roster_snapshot_id,gamertag,position,salary,management_role,jersey_number,jersey_name,depth_line,depth_role,depth_rank,availability_status').eq('team_id',TEAM).eq('season',SEASON),
   DB().from('team_player_game_reports').select('locker_id,stats').eq('team_id',TEAM).eq('season',SEASON)
 ]);
 const err=roster.error||lockers.error||reports.error;if(err){E('hitmenDepthBoard').innerHTML='<div class="hm-depth-card-empty">'+esc(err.message)+'</div>';return}
 const byRoster=new Map((lockers.data||[]).map(l=>[l.roster_snapshot_id,l])),byLocker=new Map();
 (reports.data||[]).forEach(r=>{if(!byLocker.has(r.locker_id))byLocker.set(r.locker_id,[]);byLocker.get(r.locker_id).push(r)});
 const rows=(roster.data||[]).map(r=>({...r,locker:byRoster.get(r.id)})).filter(x=>x.locker);
 if(E('hitmenDepthCount'))E('hitmenDepthCount').textContent=rows.length;
 const groups={FORWARDS:[],DEFENSE:[],GOALTENDERS:[]};rows.sort((a,b)=>order.indexOf(a.position)-order.indexOf(b.position)||a.lg_slot-b.lg_slot).forEach(r=>groups[groupName(r.position)].push(r));
 E('hitmenDepthBoard').innerHTML=Object.entries(groups).filter(([,v])=>v.length).map(([group,list])=>'<section class="hm-depth-position-group"><h3 class="hm-depth-position-title">'+group+'</h3><div class="hm-depth-card-grid">'+list.map(r=>card(r,agg(byLocker.get(r.locker.id)||[]))).join('')+'</div></section>').join('');
}
function card(r,t){const l=r.locker,name=(l.jersey_name||r.gamertag).toUpperCase(),rank=l.depth_rank?'#'+l.depth_rank:'DEPTH —',line=l.depth_line||'Unassigned',role=l.depth_role||r.management_role||'Role pending';return '<a class="hm-depth-card" href="hitmen-player-depth.html?player='+encodeURIComponent(l.id)+'"><div class="hm-depth-card-top"><span class="hm-depth-card-position">'+esc(r.position||'—')+'</span><span class="hm-depth-card-rank">'+esc(rank)+'</span></div><h3>'+esc(name)+'</h3><div class="hm-depth-card-meta">'+esc(line)+' · '+esc(role)+' · '+esc(money(r.salary))+'</div><div class="hm-depth-card-kpis"><div><b>'+t.gp+'</b><small>GP</small></div><div><b>'+t.g+'</b><small>G</small></div><div><b>'+t.a+'</b><small>A</small></div><div><b>'+t.p+'</b><small>PTS</small></div></div><div class="hm-depth-card-foot"><span>'+esc(String(l.availability_status||'unknown').replaceAll('_',' ').toUpperCase())+'</span><b>OPEN DEPTH CARD →</b></div></a>'}
window.addEventListener('vvhl-auth-change',load);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();