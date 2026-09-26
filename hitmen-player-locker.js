(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let locker=null,reports=[],weekly=[],lineReports=[],signedImage=null;
const isAdmin=()=>String(ST().profile?.role||'').toLowerCase()==='admin';
const member=()=> (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false);
const canAccess=()=>Boolean(ST().user&&(isAdmin()||member()));
const canManage=()=>isAdmin()||['owner','gm','agm'].includes(String(member()?.role||'').toLowerCase());
const canEdit=()=>Boolean(locker&&(canManage()||locker.user_id===ST().user?.id));
const money=v=>v==null?'—':v===0?'MANAGEMENT':'$'+(Number(v)/1000000).toFixed(Number(v)%1000000?2:0)+'M';
function gate(){const ok=canAccess(),c=document.querySelector('[data-locker-content]'),l=E('lockerLockedMessage');if(c)c.hidden=!ok;if(l)l.hidden=ok;if(ok)load();}
async function chooseLocker(){
 const wanted=new URLSearchParams(location.search).get('player');
 let q=DB().from('team_player_lockers').select('*').eq('team_id',TEAM).eq('season',SEASON);
 if(wanted)q=q.eq('id',wanted);
 else if(ST().user)q=q.eq('user_id',ST().user.id);
 let r=await q.limit(1).maybeSingle();
 if(r.error)throw r.error;
 if(!r.data&&canManage()){r=await DB().from('team_player_lockers').select('*').eq('team_id',TEAM).eq('season',SEASON).order('gamertag').limit(1).maybeSingle();if(r.error)throw r.error;}
 return r.data;
}
function add(o,k){return Number(o?.[k]||0)}
function aggregate(){
 const total={games:reports.length,goals:0,assists:0,points:0,plus_minus:0,shots:0,hits:0,takeaways:0,giveaways:0,pim:0,blocks:0,faceoff_pct:0,passing_pct:0,foN:0,passN:0};
 reports.forEach(r=>{const s=r.stats||{};['goals','assists','plus_minus','shots','hits','takeaways','giveaways','pim','blocks'].forEach(k=>total[k]+=add(s,k));if(s.faceoff_pct!=null){total.faceoff_pct+=Number(s.faceoff_pct);total.foN++}if(s.passing_pct!=null){total.passing_pct+=Number(s.passing_pct);total.passN++}});
 total.points=total.goals+total.assists;if(total.foN)total.faceoff_pct/=total.foN;if(total.passN)total.passing_pct/=total.passN;return total;
}
function metric(label,value){return '<div class="metric-row"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>'}
async function imageUrl(path){if(!path)return null;const r=await DB().storage.from('hitmen-player-images').createSignedUrl(path,3600);return r.error?null:r.data?.signedUrl||null}
async function render(){
 if(!locker)return;
 E('playerSideName').textContent=locker.gamertag;E('playerSidePos').textContent=locker.position||'—';E('playerTitle').textContent=locker.gamertag;E('playerMeta').textContent='Season 55 · '+(locker.management_role||'Calgary Hitmen roster');E('playerPositionBadge').textContent=locker.position||'—';E('playerRoleBadge').textContent=locker.management_role||'ROSTER';E('playerSalaryBadge').textContent=money(locker.salary);E('playerClaimStatus').textContent=locker.user_id?'PLAYER ACCESS LINKED':'STALL NOT YET CLAIMED';
 E('jerseyNameInput').value=locker.jersey_name||locker.gamertag;E('jerseyNumberInput').value=locker.jersey_number||'';E('jerseyNameLive').textContent=(locker.jersey_name||locker.gamertag).toUpperCase();E('jerseyNumberLive').textContent=locker.jersey_number||'';
 E('editLockerBox').hidden=!canEdit();E('uploadChelImage').disabled=!canEdit();E('chelImageInput').disabled=!canEdit();
 signedImage=await imageUrl(locker.chel_player_image_path);
 const photo=signedImage?'<img src="'+esc(signedImage)+'" alt="">':'<span>CHEL</span>';E('playerMiniImage').innerHTML=photo;E('uploadPreview').innerHTML=signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player upload">':'<span>NO IMAGE YET</span>';E('chelPlayerDisplay').innerHTML=signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player">':'<div class="chel-placeholder"><b>YOUR CHEL PLAYER</b><small>Upload a screenshot or render for future team media.</small></div>';
 const t=aggregate();E('performanceSample').textContent=t.games+' GAME'+(t.games===1?'':'S');[['psGoals',t.goals],['psAssists',t.assists],['psPoints',t.points],['psPlusMinus',t.plus_minus],['psShots',t.shots],['psHits',t.hits],['psTakeaways',t.takeaways],['psGiveaways',t.giveaways]].forEach(([id,v])=>E(id).textContent=v);
 E('offenseMetrics').innerHTML=metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots);
 E('defenseMetrics').innerHTML=metric('+ / -',t.plus_minus)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Turnover Diff',t.takeaways-t.giveaways)+metric('Blocks',t.blocks);
 E('teamMetrics').innerHTML=metric('PIM',t.pim)+metric('Faceoff %',t.foN?t.faceoff_pct.toFixed(1)+'%':'—')+metric('Passing %',t.passN?t.passing_pct.toFixed(1)+'%':'—')+metric('Position',locker.position||'—');
 renderReports();renderWeekly();renderLineReports();
}
function renderReports(){
 const box=E('playerGameReports');if(!reports.length){box.innerHTML='<div class="locker-empty">No game reports yet. Your individual breakdowns will appear here after games are reviewed.</div>';return}
 box.innerHTML=reports.map(r=>'<article class="player-report"><div class="player-report-head"><div><small>'+esc(r.game_date?new Date(r.game_date).toLocaleDateString():'GAME REPORT')+'</small><h3>'+esc(r.opponent_name||'Opponent')+(r.result?' · '+esc(r.result):'')+'</h3></div><small>'+esc(r.position_played||locker.position||'')+(r.line_label?' · '+esc(r.line_label):'')+'</small></div><div class="player-report-grid"><div class="report-note"><small>WHAT WORKED</small><p>'+esc(r.strengths||'Pending review.')+'</p></div><div class="report-note"><small>NEXT IMPROVEMENT</small><p>'+esc(r.improvements||'Pending review.')+'</p></div><div class="report-note"><small>TACTICAL NOTES</small><p>'+esc(r.tactical_notes||'No tactical notes yet.')+'</p></div><div class="report-note"><small>COACH SUMMARY</small><p>'+esc(r.coach_summary||'Report is still being built.')+'</p></div></div></article>').join('');
}
function renderWeekly(){
 const box=E('playerWeeklyReport'),r=weekly[0];if(!r){box.innerHTML='<div class="locker-empty">Your first weekly development report will appear after Week 1 games are reviewed.</div>';return}
 E('weeklyLabel').textContent='WEEK '+r.week;box.innerHTML='<div class="weekly-card"><div><h4>WEEK SUMMARY</h4><p>'+esc(r.summary||'—')+'</p></div><div><h4>STRENGTHS</h4><p>'+esc(r.strengths||'—')+'</p></div><div><h4>NEXT WEEK FOCUS</h4><p>'+esc(r.focus_next_week||'—')+'</p></div></div>';
}
function renderLineReports(){
 const box=E('playerLineReports');if(!lineReports.length){box.innerHTML='<div class="locker-empty">Your unit’s weekly chemistry report will appear once line reports are created.</div>';return}
 box.innerHTML=lineReports.slice(0,4).map(r=>'<article class="player-report"><div class="player-report-head"><div><small>WEEK '+r.week+'</small><h3>'+esc(r.line_label)+'</h3></div><small>'+esc(r.record||'')+'</small></div><div class="player-report-grid"><div class="report-note"><small>UNIT SUMMARY</small><p>'+esc(r.summary||'—')+'</p></div><div class="report-note"><small>NEXT ADJUSTMENTS</small><p>'+esc(r.next_adjustments||'—')+'</p></div></div></article>').join('');
}
async function load(){
 if(!canAccess()||!DB())return;
 try{
  locker=await chooseLocker();if(!locker){E('playerTitle').textContent='NO STALL LINKED';return}
  const [gr,wr,lr]=await Promise.all([
   DB().from('team_player_game_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('game_date',{ascending:false}),
   DB().from('team_player_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('week',{ascending:false}),
   DB().from('team_line_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('week',{ascending:false})
  ]);
  if(gr.error)throw gr.error;if(wr.error)throw wr.error;if(lr.error)throw lr.error;
  reports=gr.data||[];weekly=wr.data||[];lineReports=(lr.data||[]).filter(r=>(r.player_locker_ids||[]).includes(locker.id));await render();
 }catch(e){console.error(e);E('playerTitle').textContent='LOCKER UNAVAILABLE';}
}
E('jerseyNameInput')?.addEventListener('input',e=>E('jerseyNameLive').textContent=e.target.value.toUpperCase());
E('jerseyNumberInput')?.addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,2);E('jerseyNumberLive').textContent=e.target.value});
E('saveJersey')?.addEventListener('click',async()=>{if(!canEdit())return;const name=E('jerseyNameInput').value.trim().slice(0,18),num=E('jerseyNumberInput').value.trim();E('jerseySaveStatus').textContent='Saving…';const r=await DB().from('team_player_lockers').update({jersey_name:name||locker.gamertag,jersey_number:num||null,updated_at:new Date().toISOString()}).eq('id',locker.id);E('jerseySaveStatus').textContent=r.error?r.error.message:'Saved ✓';if(!r.error){locker.jersey_name=name||locker.gamertag;locker.jersey_number=num||null;}});
E('uploadChelImage')?.addEventListener('click',async()=>{if(!canEdit())return;const f=E('chelImageInput').files?.[0];if(!f){E('uploadStatus').textContent='Choose an image first.';return}if(f.size>8*1024*1024){E('uploadStatus').textContent='Keep the image under 8 MB.';return}E('uploadStatus').textContent='Uploading…';const ownerFolder=locker.user_id||ST().user.id,path=TEAM+'/'+ownerFolder+'/'+locker.id+'-'+Date.now()+'.'+(f.name.split('.').pop()||'jpg').toLowerCase();const up=await DB().storage.from('hitmen-player-images').upload(path,f,{upsert:false,contentType:f.type});if(up.error){E('uploadStatus').textContent=up.error.message;return}const save=await DB().from('team_player_lockers').update({chel_player_image_path:path,chel_player_image_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',locker.id);if(save.error){E('uploadStatus').textContent=save.error.message;return}locker.chel_player_image_path=path;E('uploadStatus').textContent='Uploaded ✓';await render();});
window.addEventListener('vvhl-auth-change',gate);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();