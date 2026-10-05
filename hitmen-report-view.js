(()=>{
'use strict';
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const params=new URLSearchParams(location.search),view=document.body.dataset.view||'report';
let busy=false,lastUser='';
function viewer(){
 const s=ST(),pr=String(s.profile?.role||'').toLowerCase();
 const m=(s.memberships||[]).find(x=>x.team_id===TEAM&&x.active!==false);
 const role=pr==='admin'?'admin':String(m?.role||'').toLowerCase();
 return {user:s.user||null,role,member:pr==='admin'||!!m,mgmt:pr==='admin'||['owner','gm','agm','scout'].includes(role)};
}
function fmt(d){if(!d)return'';try{return new Date(d).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}catch{return String(d)}}
function showGate(title,msg){
 $('hrvContent').hidden=true;$('hrvGate').hidden=false;
 $('hrvGate').innerHTML='<h2>'+esc(title)+'</h2><p>'+esc(msg)+'</p>';
}
function inline(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\[(E\d+)\]/g,'<span class="hrv-cite">[$1]</span>')}
function reportHtml(text){
 return String(text||'').split(/\r?\n/).map(line=>{
  const t=line.trim();if(!t)return'';
  if(/^###\s+/.test(t))return '<h3>'+inline(t.replace(/^###\s+/,''))+'</h3>';
  if(/^##\s+/.test(t))return '<h2>'+inline(t.replace(/^##\s+/,''))+'</h2>';
  if(/^#\s+/.test(t))return '<h2>'+inline(t.replace(/^#\s+/,''))+'</h2>';
  if(/^[-*]\s+/.test(t))return '<div class="bullet"><span>•</span><p>'+inline(t.replace(/^[-*]\s+/,''))+'</p></div>';
  const m=t.match(/^(\d+)[.)]\s+(.+)/);if(m)return '<div class="numbered"><span>'+m[1]+'.</span><p>'+inline(m[2])+'</p></div>';
  return '<p>'+inline(t)+'</p>';
 }).join('');
}
function heatHtml(ev){
 const heat=Array.isArray(ev?.attack_source_heatmap)?ev.attack_source_heatmap:[];
 if(!heat.length)return'';
 return '<section class="hrv-heat"><div class="hrv-heat-head"><div><span class="hrv-k">SCORING SOURCE</span><h3>Heat map</h3></div><span>'+(ev?.data_mode==='stats_only_no_vod'?'STATS ONLY':'EVIDENCE')+'</span></div><div class="hrv-heat-grid">'+heat.map(z=>{
  const g=Number(z.goal_share||0),a=Number(z.assist_share||0),s=Number(z.shot_share||0);
  return '<article class="hrv-heat-cell"><b>'+esc(z.pos||'—')+'</b><div class="hrv-meter"><i style="width:'+Math.max(2,Math.min(100,g))+'%"></i></div><strong>'+esc(g.toFixed(1))+'% goals</strong><small>'+esc(a.toFixed(1))+'% assists · '+esc(s.toFixed(1))+'% shots</small></article>';
 }).join('')+'</div>'+(ev?.spatial_heatmap_note?'<p class="hrv-vod-copy">'+esc(ev.spatial_heatmap_note)+'</p>':'')+'</section>';
}
function scoutHtml(ev){
 const s=ev?.line_scout||{},keys=['forwards','defense','goalie','inference'].filter(k=>s[k]);
 if(!keys.length)return'';
 return '<section class="hrv-scout"><span class="hrv-k">POSTED LINE</span><h3>Deep scout</h3>'+keys.map(k=>'<div class="hrv-scout-row"><b>'+esc(k.toUpperCase())+'</b><p>'+esc(s[k])+'</p></div>').join('')+'</section>';
}
async function getReport(v){
 const reportId=params.get('report'),gameId=params.get('game'),opponent=params.get('opponent');
 let q=DB().from('hitmen_opponent_pregame_reports').select('id,team_id,season,opponent_name,scheduled_game_id,model,report,evidence_summary,created_at').eq('team_id',TEAM).eq('season',SEASON);
 if(reportId)q=q.eq('id',reportId);
 else if(gameId)q=q.eq('scheduled_game_id',gameId);
 else if(opponent)q=q.eq('opponent_name',opponent);
 else return null;
 const r=await q.order('created_at',{ascending:false}).limit(1).maybeSingle();if(r.error)throw r.error;
 if(!r.data)return null;
 if(!v.mgmt&&r.data.evidence_summary?.approved!==true)return null;
 return r.data;
}
async function getGame(report){
 const id=params.get('game')||report?.scheduled_game_id;if(!id)return null;
 const r=await DB().from('hitmen_schedule_games').select('id,opponent_name,scheduled_at,week,status,calgary_score,opponent_score').eq('team_id',TEAM).eq('season',SEASON).eq('id',id).maybeSingle();
 if(r.error)throw r.error;return r.data||null;
}
async function getVods(report,game){
 let q=DB().from('vod_review_sessions').select('id,title,opponent_label,game_date,status,worker_status,tactical_report,full_game_summary,schedule_game_id,created_at,vod_url,source_provider').eq('team_id',TEAM).order('created_at',{ascending:false}).limit(30);
 if(game?.id||report?.scheduled_game_id)q=q.eq('schedule_game_id',game?.id||report.scheduled_game_id);
 else{
  const opp=report?.opponent_name||params.get('opponent');
  if(opp)q=q.ilike('opponent_label',opp);
 }
 const r=await q;if(r.error)throw r.error;
 const opp=norm(report?.opponent_name||game?.opponent_name||params.get('opponent'));
 return (r.data||[]).filter(x=>!opp||x.schedule_game_id||(norm(x.opponent_label)===opp));
}
function setHero(report,game,v){
 const opp=report?.opponent_name||game?.opponent_name||params.get('opponent')||'Opponent';
 $('hrvOpponent').textContent=opp;
 const bits=[];if(game?.week!=null)bits.push('Week '+game.week);if(game?.scheduled_at)bits.push(fmt(game.scheduled_at));bits.push('LGCHL Season 55');
 $('hrvMeta').textContent=bits.join(' · ');
 $('hrvApproval').textContent=report?(report.evidence_summary?.approved===true?'APPROVED REPORT':v.mgmt?'MANAGEMENT DRAFT':'REPORT'):'NO REPORT';
}
function vodSummary(vods,game,report){
 const box=$('hrvVodSummary'),link=$('hrvVodLink');
 if(!vods.length){
  box.innerHTML='<div class="hrv-na"><b>NOT APPLICABLE</b>No VOD evidence is attached to this matchup yet.</div>';
 }else{
  box.innerHTML='<div class="hrv-stat"><span>Attached VOD</span><b>'+vods.length+'</b></div><div class="hrv-stat"><span>Latest</span><b>'+esc(vods[0].title||'Game review')+'</b></div>';
 }
 const qp=game?.id?'game='+encodeURIComponent(game.id):report?.id?'report='+encodeURIComponent(report.id)+'&opponent='+encodeURIComponent(report.opponent_name):'opponent='+encodeURIComponent(report?.opponent_name||game?.opponent_name||'');
 link.href='hitmen-vod-report.html?'+qp;link.textContent=vods.length?'Open VOD reference →':'VOD reference →';
}
function renderReport(report,game,vods,v){
 setHero(report,game,v);
 $('hrvReportTitle').textContent='Full scouting report';
 $('hrvReportMeta').textContent=report?fmt(report.created_at)+' · '+(report.model||'Wildman Hockey Ops')+(report.evidence_summary?.approved===true?' · Approved':' · Management view'):'';
 if(!report){
  $('hrvReportBody').innerHTML='<div class="hrv-na"><b>REPORT NOT AVAILABLE</b>'+(v.mgmt?'No pregame report is attached to this game yet.':'The full scouting report has not been approved for player view yet.')+'</div>';
 }else{
  $('hrvReportBody').innerHTML=reportHtml(report.report)+heatHtml(report.evidence_summary||{})+scoutHtml(report.evidence_summary||{});
 }
 vodSummary(vods,game,report);
 const qp=game?.id?'game='+encodeURIComponent(game.id):report?.id?'report='+encodeURIComponent(report.id)+'&opponent='+encodeURIComponent(report.opponent_name):'opponent='+encodeURIComponent(report?.opponent_name||game?.opponent_name||'');
 $('hrvOtherView').href='hitmen-vod-report.html?'+qp;$('hrvOtherView').textContent='VOD Reference';
}
function renderVod(report,game,vods,v){
 setHero(report,game,v);
 $('hrvReportTitle').textContent='VOD reference';
 $('hrvReportMeta').textContent='View-only film reference. No VOD Lab or management controls are exposed here.';
 if(!vods.length){
  $('hrvReportBody').innerHTML='<div class="hrv-na"><b>NOT APPLICABLE</b>No VOD evidence is attached to this matchup yet. If management adds reviewed film later, it will appear here automatically.</div>';
 }else{
  $('hrvReportBody').innerHTML='<div class="hrv-vod-list">'+vods.map(x=>{
   const status=x.worker_status||x.status||'review';
   const copy=x.tactical_report||x.full_game_summary||'VOD source is attached. No reviewed written summary has been published yet.';
   const url=/^https:\/\//i.test(String(x.vod_url||''))?String(x.vod_url):'';
   return '<article class="hrv-vod-item"><header><div><span class="hrv-k">VIDEO EVIDENCE</span><h3>'+esc(x.title||'Game review')+'</h3></div><small>'+esc(String(status).toUpperCase())+'</small></header><div class="hrv-vod-copy">'+esc(copy)+'</div><div class="hrv-vod-actions">'+(url?'<a class="hrv-action" target="_blank" rel="noopener" href="'+esc(url)+'">Open source VOD →</a>':'')+'</div></article>';
  }).join('')+'</div>';
 }
 const qp=game?.id?'game='+encodeURIComponent(game.id):report?.id?'report='+encodeURIComponent(report.id)+'&opponent='+encodeURIComponent(report.opponent_name):'opponent='+encodeURIComponent(report?.opponent_name||game?.opponent_name||'');
 $('hrvOtherView').href='hitmen-scouting-report.html?'+qp;$('hrvOtherView').textContent='Full Report';
 $('hrvVodSide').hidden=true;
}
async function load(){
 if(busy||!DB())return;const v=viewer();if(!v.user){showGate('Sign in required','Sign in with your Calgary Hitmen account to view the team scouting brief.');return}
 if(!v.member){showGate('Team access only','This page contains Calgary team scouting material and is not available outside the active team.');return}
 busy=true;$('hrvGate').hidden=false;$('hrvGate').innerHTML='<h2>Loading scouting brief…</h2><p>Pulling the approved report and attached film reference.</p>';
 try{
  const report=await getReport(v),game=await getGame(report),vods=await getVods(report,game);
  $('hrvGate').hidden=true;$('hrvContent').hidden=false;
  if(view==='vod')renderVod(report,game,vods,v);else renderReport(report,game,vods,v);
 }catch(e){console.error(e);showGate('Could not load report',e.message||'The scouting brief could not be loaded.')}
 finally{busy=false}
}
$('hrvBack')?.addEventListener('click',()=>history.length>1?history.back():location.assign('hitmen-player-locker.html'));
let timer=null;function kick(){clearTimeout(timer);timer=setTimeout(load,80)}
window.addEventListener('vvhl-auth-change',()=>{const u=ST().user?.id||'';if(u!==lastUser){lastUser=u;kick()}});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kick,{once:true});else kick();
})();