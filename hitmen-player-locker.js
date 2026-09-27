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
const money=v=>v==null?'—':v===0?'MANAGEMENT':'\{const ok=canAccess(),c=document.querySelector('[data-locker-content]'),l=E('lockerLockedMessage');if(c)c.hidden=!ok;if(l)l.hidden=ok;if(ok)load();}
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
 const displayName=(locker.jersey_name||locker.gamertag).toUpperCase(),displayNum=locker.jersey_number||'';
 T('playerSideName',locker.gamertag);T('playerSidePos',locker.position||'—');T('playerTitle',locker.gamertag);
 T('playerClaimStatus',locker.user_id?'PLAYER ACCESS LINKED':'STALL NOT YET CLAIMED');
 const nameInput=E('jerseyNameInput'),numInput=E('jerseyNumberInput');if(nameInput)nameInput.value=locker.jersey_name||locker.gamertag;if(numInput)numInput.value=displayNum;
 paintStall(displayName,displayNum);

 const can=canEdit();if(E('editLockerBox'))E('editLockerBox').hidden=!can;if(E('uploadChelImage'))E('uploadChelImage').disabled=!can;if(E('chelImageInput'))E('chelImageInput').disabled=!can;

 signedImage=await imageUrl(locker.chel_player_image_path);
 const photo=signedImage?'<img src="'+esc(signedImage)+'" alt="">':'<span>CHEL</span>';
 H('playerMiniImage',photo);
 H('uploadPreview',signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player upload">':'<span>NO IMAGE YET</span>');
 H('profileChelSilhouette',signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player">':'<span>CHEL</span>');

 const t=aggregate();
 T('performanceSample',t.games+' GAME'+(t.games===1?'':'S'));
 [['psGoals',t.goals],['psAssists',t.assists],['psPoints',t.points],['psPlusMinus',t.plus_minus],['psShots',t.shots],['psHits',t.hits],['psTakeaways',t.takeaways],['psGiveaways',t.giveaways],
  ['profileGP',t.games],['profileGoals',t.goals],['profileAssists',t.assists],['profilePoints',t.points],['profilePlusMinus',t.plus_minus]].forEach(([id,v])=>T(id,v));

 T('profileGamertag',locker.gamertag);
 T('profileBioPosition',locker.position||'—');
 T('profileBioHandedness',locker.handedness||'—');
 T('profilePlayerType',locker.player_type||'—');
 T('profileDepthRole',locker.depth_role||locker.management_role||'Roster');
 T('profileDepthLine',locker.depth_line||'Unassigned');
 T('profileStatusText',String(locker.availability_status||'active roster').replaceAll('_',' '));
 T('profileAvailability',String(locker.availability_status||'ACTIVE').replaceAll('_',' ').toUpperCase());
 T('profileNumberPos',(displayNum?'#'+displayNum:'#—')+' · '+(locker.position||'—'));
 T('profilePositionLong',positionLong(locker.position));
 T('profileHandedness',locker.handedness?locker.handedness+' handed':'Handedness —');
 T('profileSalary',money(locker.salary));
 T('equipmentSyncLabel',String(locker.equipment_sync_status||'not_connected').replaceAll('_',' '));

 E('offenseMetrics').innerHTML=metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots);
 E('defenseMetrics').innerHTML=metric('+ / -',t.plus_minus)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Turnover Diff',t.takeaways-t.giveaways)+metric('Blocks',t.blocks);
 E('teamMetrics').innerHTML=metric('PIM',t.pim)+metric('Faceoff %',t.foN?t.faceoff_pct.toFixed(1)+'%':'—')+metric('Passing %',t.passN?t.passing_pct.toFixed(1)+'%':'—')+metric('Position',locker.position||'—');

 H('profileStatsTab',metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points',t.points)+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Blocks',t.blocks)+metric('PIM',t.pim));
 H('profileScoutingTab',scoutingSummaryHtml());
 renderDashboardScouting();
 renderWeeklyPerformance();
 renderReports();renderWeekly();renderLineReports();
 syncFlipButtons();
}
function positionLong(p){return ({LW:'Left Wing',C:'Center',RW:'Right Wing',LD:'Left Defense',RD:'Right Defense',G:'Goaltender'})[String(p||'').toUpperCase()]||p||'—'}
function scoutingSummaryHtml(){
 const items=[
  ['Strengths',locker?.scouting_strengths],
  ['Development',locker?.development_focus],
  ['Tendencies',locker?.scouting_tendencies],
  ['Chemistry',locker?.chemistry_notes]
 ].filter(([,v])=>v);
 return items.length?items.map(([k,v])=>'<div class="profile-scout-line"><small>'+esc(k.toUpperCase())+'</small><p>'+esc(v)+'</p></div>').join(''):'<div class="locker-empty">Scouting and development notes will populate as the season is reviewed.</div>';
}
function renderDashboardScouting(){
 const box=E('stallScoutingNotes');if(!box)return;
 const notes=[
  {tone:'good',title:'Strengths',text:locker?.scouting_strengths||weekly[0]?.strengths},
  {tone:'focus',title:'Development Focus',text:locker?.development_focus||weekly[0]?.focus_next_week},
  {tone:'neutral',title:'Line / Chemistry',text:locker?.chemistry_notes||lineReports[0]?.summary}
 ].filter(x=>x.text);
 box.innerHTML=notes.length?notes.map(x=>'<div class="stall-note '+x.tone+'"><i></i><div><b>'+esc(x.title)+'</b><p>'+esc(x.text)+'</p></div></div>').join(''):'<div class="locker-empty">Player notes will populate after coaching and game review.</div>';
}
function renderWeeklyPerformance(){
 const box=E('weeklyPerformanceChart');if(!box)return;
 const games=reports.slice(0,5).reverse();
 if(!games.length){box.innerHTML='<div class="weekly-chart-empty">GAME DATA WILL POPULATE HERE</div>';return}
 const vals=games.map(r=>{const s=r.stats||{};return {p:Number(s.goals||0)+Number(s.assists||0),opp:r.opponent_name||'OPP',res:r.result||''}});
 const max=Math.max(1,...vals.map(x=>x.p));
 box.innerHTML='<div class="weekly-bars">'+vals.map(x=>'<div class="weekly-bar-item"><div class="weekly-bar-track"><i style="height:'+Math.max(8,Math.round((x.p/max)*100))+'%"></i></div><b>'+x.p+' PT'+(x.p===1?'':'S')+'</b><small>'+esc(x.res||'GAME')+' · '+esc(shortTeam(x.opp))+'</small></div>').join('')+'</div>';
}
function shortTeam(v){const parts=String(v||'').trim().split(/\s+/);return parts.length>1?parts.map(x=>x[0]).join('').slice(0,4).toUpperCase():String(v||'OPP').slice(0,4).toUpperCase()}
function setStallView(back){
 const stall=E('stallScene')?.querySelector('.hs-stall');if(!stall||!window.HitmenStall)return;
 HitmenStall.setBack(stall,Boolean(back));syncFlipButtons();
}
function syncFlipButtons(){
 const back=E('stallScene')?.querySelector('.hs-stall')?.classList.contains('is-back');
 E('jerseyFrontBtn')?.classList.toggle('active',!back);
 E('jerseyBackBtn')?.classList.toggle('active',!!back);
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
  locker=await chooseLocker();if(!locker){T('playerTitle','NO STALL LINKED');return}
  const [gr,wr,lr]=await Promise.all([
   DB().from('team_player_game_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('game_date',{ascending:false}),
   DB().from('team_player_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('week',{ascending:false}),
   DB().from('team_line_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('week',{ascending:false})
  ]);
  if(gr.error)throw gr.error;if(wr.error)throw wr.error;if(lr.error)throw lr.error;
  reports=gr.data||[];weekly=wr.data||[];lineReports=(lr.data||[]).filter(r=>(r.player_locker_ids||[]).includes(locker.id));await render();
 }catch(e){console.error(e);T('playerTitle','LOCKER UNAVAILABLE');}
}
function paintStall(name,num){const host=E('stallScene');if(!host||!window.HitmenStall)return;const empty=!String(num||'').trim();if(!host.firstChild)HitmenStall.mount(host,{name,number:num,empty});else HitmenStall.update(host,{name,number:num,empty});}
const liveStall=()=>paintStall(E('jerseyNameInput').value.trim()||locker?.gamertag||'',E('jerseyNumberInput').value);
E('jerseyNameInput')?.addEventListener('input',liveStall);
E('jerseyNumberInput')?.addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,2);liveStall()});
E('saveJersey')?.addEventListener('click',async()=>{if(!canEdit())return;const name=E('jerseyNameInput').value.trim().slice(0,18),num=E('jerseyNumberInput').value.trim();E('jerseySaveStatus').textContent='Saving…';const r=await DB().from('team_player_lockers').update({jersey_name:name||locker.gamertag,jersey_number:num||null,updated_at:new Date().toISOString()}).eq('id',locker.id);E('jerseySaveStatus').textContent=r.error?r.error.message:'Saved ✓';if(!r.error){locker.jersey_name=name||locker.gamertag;locker.jersey_number=num||null;}});
E('uploadChelImage')?.addEventListener('click',async()=>{if(!canEdit())return;const f=E('chelImageInput').files?.[0];if(!f){E('uploadStatus').textContent='Choose an image first.';return}if(f.size>8*1024*1024){E('uploadStatus').textContent='Keep the image under 8 MB.';return}E('uploadStatus').textContent='Uploading…';const ownerFolder=locker.user_id||ST().user.id,path=TEAM+'/'+ownerFolder+'/'+locker.id+'-'+Date.now()+'.'+(f.name.split('.').pop()||'jpg').toLowerCase();const up=await DB().storage.from('hitmen-player-images').upload(path,f,{upsert:false,contentType:f.type});if(up.error){E('uploadStatus').textContent=up.error.message;return}const save=await DB().from('team_player_lockers').update({chel_player_image_path:path,chel_player_image_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',locker.id);if(save.error){E('uploadStatus').textContent=save.error.message;return}locker.chel_player_image_path=path;E('uploadStatus').textContent='Uploaded ✓';await render();});
E('jerseyFrontBtn')?.addEventListener('click',()=>setStallView(false));
E('jerseyBackBtn')?.addEventListener('click',()=>setStallView(true));
document.querySelectorAll('[data-stall-tab]').forEach(btn=>btn.addEventListener('click',()=>{
 const tab=btn.dataset.stallTab;
 document.querySelectorAll('[data-stall-tab]').forEach(b=>b.classList.toggle('active',b===btn));
 document.querySelectorAll('[data-stall-panel]').forEach(p=>p.classList.toggle('active',p.dataset.stallPanel===tab));
}));
document.querySelectorAll('[data-tool-target]').forEach(btn=>btn.addEventListener('click',()=>{
 const target=btn.dataset.toolTarget;
 if(target==='profile'){E('profile')?.scrollIntoView({behavior:'smooth',block:'start'});return}
 if(target==='settings'||target==='equipment'){
  const b=document.querySelector('[data-stall-tab="settings"]');b?.click();
  document.querySelector('.stall-player-profile')?.scrollIntoView({behavior:'smooth',block:'start'});
 }
}));
if(window.MutationObserver){
 const host=E('stallScene');if(host)new MutationObserver(()=>syncFlipButtons()).observe(host,{subtree:true,attributes:true,attributeFilter:['class']});
}
paintStall('','');
window.addEventListener('vvhl-auth-change',gate);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();+(Number(v)/1000000).toFixed(Number(v)%1000000?2:0)+'M';
const T=(id,v)=>{const el=E(id);if(el)el.textContent=v??'—';};
const H=(id,v)=>{const el=E(id);if(el)el.innerHTML=v??'';};
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
 const displayName=(locker.jersey_name||locker.gamertag).toUpperCase(),displayNum=locker.jersey_number||'';E('jerseyNameInput').value=locker.jersey_name||locker.gamertag;E('jerseyNumberInput').value=displayNum;paintStall(displayName,displayNum);
 E('editLockerBox').hidden=!canEdit();E('uploadChelImage').disabled=!canEdit();E('chelImageInput').disabled=!canEdit();
 signedImage=await imageUrl(locker.chel_player_image_path);
 const photo=signedImage?'<img src="'+esc(signedImage)+'" alt="">':'<span>CHEL</span>';E('playerMiniImage').innerHTML=photo;E('uploadPreview').innerHTML=signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player upload">':'<span>NO IMAGE YET</span>';
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
function paintStall(name,num){const host=E('stallScene');if(!host||!window.HitmenStall)return;const empty=!String(num||'').trim();if(!host.firstChild)HitmenStall.mount(host,{name,number:num,empty});else HitmenStall.update(host,{name,number:num,empty});}
const liveStall=()=>paintStall(E('jerseyNameInput').value.trim()||locker?.gamertag||'',E('jerseyNumberInput').value);
E('jerseyNameInput')?.addEventListener('input',liveStall);
E('jerseyNumberInput')?.addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,2);liveStall()});
E('saveJersey')?.addEventListener('click',async()=>{if(!canEdit())return;const name=E('jerseyNameInput').value.trim().slice(0,18),num=E('jerseyNumberInput').value.trim();E('jerseySaveStatus').textContent='Saving…';const r=await DB().from('team_player_lockers').update({jersey_name:name||locker.gamertag,jersey_number:num||null,updated_at:new Date().toISOString()}).eq('id',locker.id);E('jerseySaveStatus').textContent=r.error?r.error.message:'Saved ✓';if(!r.error){locker.jersey_name=name||locker.gamertag;locker.jersey_number=num||null;}});
E('uploadChelImage')?.addEventListener('click',async()=>{if(!canEdit())return;const f=E('chelImageInput').files?.[0];if(!f){E('uploadStatus').textContent='Choose an image first.';return}if(f.size>8*1024*1024){E('uploadStatus').textContent='Keep the image under 8 MB.';return}E('uploadStatus').textContent='Uploading…';const ownerFolder=locker.user_id||ST().user.id,path=TEAM+'/'+ownerFolder+'/'+locker.id+'-'+Date.now()+'.'+(f.name.split('.').pop()||'jpg').toLowerCase();const up=await DB().storage.from('hitmen-player-images').upload(path,f,{upsert:false,contentType:f.type});if(up.error){E('uploadStatus').textContent=up.error.message;return}const save=await DB().from('team_player_lockers').update({chel_player_image_path:path,chel_player_image_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',locker.id);if(save.error){E('uploadStatus').textContent=save.error.message;return}locker.chel_player_image_path=path;E('uploadStatus').textContent='Uploaded ✓';await render();});
paintStall('','');
window.addEventListener('vvhl-auth-change',gate);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();+(Number(v)/1000000).toFixed(Number(v)%1000000?2:0)+'M';
const T=(id,v)=>{const el=E(id);if(el)el.textContent=v??'—';};
const H=(id,v)=>{const el=E(id);if(el)el.innerHTML=v??'';};
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
 const displayName=(locker.jersey_name||locker.gamertag).toUpperCase(),displayNum=locker.jersey_number||'';
 T('playerSideName',locker.gamertag);T('playerSidePos',locker.position||'—');T('playerTitle',locker.gamertag);
 T('playerClaimStatus',locker.user_id?'PLAYER ACCESS LINKED':'STALL NOT YET CLAIMED');
 const nameInput=E('jerseyNameInput'),numInput=E('jerseyNumberInput');if(nameInput)nameInput.value=locker.jersey_name||locker.gamertag;if(numInput)numInput.value=displayNum;
 paintStall(displayName,displayNum);

 const can=canEdit();if(E('editLockerBox'))E('editLockerBox').hidden=!can;if(E('uploadChelImage'))E('uploadChelImage').disabled=!can;if(E('chelImageInput'))E('chelImageInput').disabled=!can;

 signedImage=await imageUrl(locker.chel_player_image_path);
 const photo=signedImage?'<img src="'+esc(signedImage)+'" alt="">':'<span>CHEL</span>';
 H('playerMiniImage',photo);
 H('uploadPreview',signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player upload">':'<span>NO IMAGE YET</span>');
 H('profileChelSilhouette',signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player">':'<span>CHEL</span>');

 const t=aggregate();
 T('performanceSample',t.games+' GAME'+(t.games===1?'':'S'));
 [['psGoals',t.goals],['psAssists',t.assists],['psPoints',t.points],['psPlusMinus',t.plus_minus],['psShots',t.shots],['psHits',t.hits],['psTakeaways',t.takeaways],['psGiveaways',t.giveaways],
  ['profileGP',t.games],['profileGoals',t.goals],['profileAssists',t.assists],['profilePoints',t.points],['profilePlusMinus',t.plus_minus]].forEach(([id,v])=>T(id,v));

 T('profileGamertag',locker.gamertag);
 T('profileBioPosition',locker.position||'—');
 T('profileBioHandedness',locker.handedness||'—');
 T('profilePlayerType',locker.player_type||'—');
 T('profileDepthRole',locker.depth_role||locker.management_role||'Roster');
 T('profileDepthLine',locker.depth_line||'Unassigned');
 T('profileStatusText',String(locker.availability_status||'active roster').replaceAll('_',' '));
 T('profileAvailability',String(locker.availability_status||'ACTIVE').replaceAll('_',' ').toUpperCase());
 T('profileNumberPos',(displayNum?'#'+displayNum:'#—')+' · '+(locker.position||'—'));
 T('profilePositionLong',positionLong(locker.position));
 T('profileHandedness',locker.handedness?locker.handedness+' handed':'Handedness —');
 T('profileSalary',money(locker.salary));
 T('equipmentSyncLabel',String(locker.equipment_sync_status||'not_connected').replaceAll('_',' '));

 E('offenseMetrics').innerHTML=metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots);
 E('defenseMetrics').innerHTML=metric('+ / -',t.plus_minus)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Turnover Diff',t.takeaways-t.giveaways)+metric('Blocks',t.blocks);
 E('teamMetrics').innerHTML=metric('PIM',t.pim)+metric('Faceoff %',t.foN?t.faceoff_pct.toFixed(1)+'%':'—')+metric('Passing %',t.passN?t.passing_pct.toFixed(1)+'%':'—')+metric('Position',locker.position||'—');

 H('profileStatsTab',metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points',t.points)+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Blocks',t.blocks)+metric('PIM',t.pim));
 H('profileScoutingTab',scoutingSummaryHtml());
 renderDashboardScouting();
 renderWeeklyPerformance();
 renderReports();renderWeekly();renderLineReports();
 syncFlipButtons();
}
function positionLong(p){return ({LW:'Left Wing',C:'Center',RW:'Right Wing',LD:'Left Defense',RD:'Right Defense',G:'Goaltender'})[String(p||'').toUpperCase()]||p||'—'}
function scoutingSummaryHtml(){
 const items=[
  ['Strengths',locker?.scouting_strengths],
  ['Development',locker?.development_focus],
  ['Tendencies',locker?.scouting_tendencies],
  ['Chemistry',locker?.chemistry_notes]
 ].filter(([,v])=>v);
 return items.length?items.map(([k,v])=>'<div class="profile-scout-line"><small>'+esc(k.toUpperCase())+'</small><p>'+esc(v)+'</p></div>').join(''):'<div class="locker-empty">Scouting and development notes will populate as the season is reviewed.</div>';
}
function renderDashboardScouting(){
 const box=E('stallScoutingNotes');if(!box)return;
 const notes=[
  {tone:'good',title:'Strengths',text:locker?.scouting_strengths||weekly[0]?.strengths},
  {tone:'focus',title:'Development Focus',text:locker?.development_focus||weekly[0]?.focus_next_week},
  {tone:'neutral',title:'Line / Chemistry',text:locker?.chemistry_notes||lineReports[0]?.summary}
 ].filter(x=>x.text);
 box.innerHTML=notes.length?notes.map(x=>'<div class="stall-note '+x.tone+'"><i></i><div><b>'+esc(x.title)+'</b><p>'+esc(x.text)+'</p></div></div>').join(''):'<div class="locker-empty">Player notes will populate after coaching and game review.</div>';
}
function renderWeeklyPerformance(){
 const box=E('weeklyPerformanceChart');if(!box)return;
 const games=reports.slice(0,5).reverse();
 if(!games.length){box.innerHTML='<div class="weekly-chart-empty">GAME DATA WILL POPULATE HERE</div>';return}
 const vals=games.map(r=>{const s=r.stats||{};return {p:Number(s.goals||0)+Number(s.assists||0),opp:r.opponent_name||'OPP',res:r.result||''}});
 const max=Math.max(1,...vals.map(x=>x.p));
 box.innerHTML='<div class="weekly-bars">'+vals.map(x=>'<div class="weekly-bar-item"><div class="weekly-bar-track"><i style="height:'+Math.max(8,Math.round((x.p/max)*100))+'%"></i></div><b>'+x.p+' PT'+(x.p===1?'':'S')+'</b><small>'+esc(x.res||'GAME')+' · '+esc(shortTeam(x.opp))+'</small></div>').join('')+'</div>';
}
function shortTeam(v){const parts=String(v||'').trim().split(/\s+/);return parts.length>1?parts.map(x=>x[0]).join('').slice(0,4).toUpperCase():String(v||'OPP').slice(0,4).toUpperCase()}
function setStallView(back){
 const stall=E('stallScene')?.querySelector('.hs-stall');if(!stall||!window.HitmenStall)return;
 HitmenStall.setBack(stall,Boolean(back));syncFlipButtons();
}
function syncFlipButtons(){
 const back=E('stallScene')?.querySelector('.hs-stall')?.classList.contains('is-back');
 E('jerseyFrontBtn')?.classList.toggle('active',!back);
 E('jerseyBackBtn')?.classList.toggle('active',!!back);
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
  locker=await chooseLocker();if(!locker){T('playerTitle','NO STALL LINKED');return}
  const [gr,wr,lr]=await Promise.all([
   DB().from('team_player_game_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('game_date',{ascending:false}),
   DB().from('team_player_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('week',{ascending:false}),
   DB().from('team_line_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('week',{ascending:false})
  ]);
  if(gr.error)throw gr.error;if(wr.error)throw wr.error;if(lr.error)throw lr.error;
  reports=gr.data||[];weekly=wr.data||[];lineReports=(lr.data||[]).filter(r=>(r.player_locker_ids||[]).includes(locker.id));await render();
 }catch(e){console.error(e);T('playerTitle','LOCKER UNAVAILABLE');}
}
function paintStall(name,num){const host=E('stallScene');if(!host||!window.HitmenStall)return;const empty=!String(num||'').trim();if(!host.firstChild)HitmenStall.mount(host,{name,number:num,empty});else HitmenStall.update(host,{name,number:num,empty});}
const liveStall=()=>paintStall(E('jerseyNameInput').value.trim()||locker?.gamertag||'',E('jerseyNumberInput').value);
E('jerseyNameInput')?.addEventListener('input',liveStall);
E('jerseyNumberInput')?.addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,2);liveStall()});
E('saveJersey')?.addEventListener('click',async()=>{if(!canEdit())return;const name=E('jerseyNameInput').value.trim().slice(0,18),num=E('jerseyNumberInput').value.trim();E('jerseySaveStatus').textContent='Saving…';const r=await DB().from('team_player_lockers').update({jersey_name:name||locker.gamertag,jersey_number:num||null,updated_at:new Date().toISOString()}).eq('id',locker.id);E('jerseySaveStatus').textContent=r.error?r.error.message:'Saved ✓';if(!r.error){locker.jersey_name=name||locker.gamertag;locker.jersey_number=num||null;}});
E('uploadChelImage')?.addEventListener('click',async()=>{if(!canEdit())return;const f=E('chelImageInput').files?.[0];if(!f){E('uploadStatus').textContent='Choose an image first.';return}if(f.size>8*1024*1024){E('uploadStatus').textContent='Keep the image under 8 MB.';return}E('uploadStatus').textContent='Uploading…';const ownerFolder=locker.user_id||ST().user.id,path=TEAM+'/'+ownerFolder+'/'+locker.id+'-'+Date.now()+'.'+(f.name.split('.').pop()||'jpg').toLowerCase();const up=await DB().storage.from('hitmen-player-images').upload(path,f,{upsert:false,contentType:f.type});if(up.error){E('uploadStatus').textContent=up.error.message;return}const save=await DB().from('team_player_lockers').update({chel_player_image_path:path,chel_player_image_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',locker.id);if(save.error){E('uploadStatus').textContent=save.error.message;return}locker.chel_player_image_path=path;E('uploadStatus').textContent='Uploaded ✓';await render();});
E('jerseyFrontBtn')?.addEventListener('click',()=>setStallView(false));
E('jerseyBackBtn')?.addEventListener('click',()=>setStallView(true));
document.querySelectorAll('[data-stall-tab]').forEach(btn=>btn.addEventListener('click',()=>{
 const tab=btn.dataset.stallTab;
 document.querySelectorAll('[data-stall-tab]').forEach(b=>b.classList.toggle('active',b===btn));
 document.querySelectorAll('[data-stall-panel]').forEach(p=>p.classList.toggle('active',p.dataset.stallPanel===tab));
}));
document.querySelectorAll('[data-tool-target]').forEach(btn=>btn.addEventListener('click',()=>{
 const target=btn.dataset.toolTarget;
 if(target==='profile'){E('profile')?.scrollIntoView({behavior:'smooth',block:'start'});return}
 if(target==='settings'||target==='equipment'){
  const b=document.querySelector('[data-stall-tab="settings"]');b?.click();
  document.querySelector('.stall-player-profile')?.scrollIntoView({behavior:'smooth',block:'start'});
 }
}));
if(window.MutationObserver){
 const host=E('stallScene');if(host)new MutationObserver(()=>syncFlipButtons()).observe(host,{subtree:true,attributes:true,attributeFilter:['class']});
}
paintStall('','');
window.addEventListener('vvhl-auth-change',gate);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();+(Number(v)/1000000).toFixed(Number(v)%1000000?2:0)+'M';
const T=(id,v)=>{const el=E(id);if(el)el.textContent=v??'—';};
const H=(id,v)=>{const el=E(id);if(el)el.innerHTML=v??'';};
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
 const displayName=(locker.jersey_name||locker.gamertag).toUpperCase(),displayNum=locker.jersey_number||'';E('jerseyNameInput').value=locker.jersey_name||locker.gamertag;E('jerseyNumberInput').value=displayNum;paintStall(displayName,displayNum);
 E('editLockerBox').hidden=!canEdit();E('uploadChelImage').disabled=!canEdit();E('chelImageInput').disabled=!canEdit();
 signedImage=await imageUrl(locker.chel_player_image_path);
 const photo=signedImage?'<img src="'+esc(signedImage)+'" alt="">':'<span>CHEL</span>';E('playerMiniImage').innerHTML=photo;E('uploadPreview').innerHTML=signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player upload">':'<span>NO IMAGE YET</span>';
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
function paintStall(name,num){const host=E('stallScene');if(!host||!window.HitmenStall)return;const empty=!String(num||'').trim();if(!host.firstChild)HitmenStall.mount(host,{name,number:num,empty});else HitmenStall.update(host,{name,number:num,empty});}
const liveStall=()=>paintStall(E('jerseyNameInput').value.trim()||locker?.gamertag||'',E('jerseyNumberInput').value);
E('jerseyNameInput')?.addEventListener('input',liveStall);
E('jerseyNumberInput')?.addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,2);liveStall()});
E('saveJersey')?.addEventListener('click',async()=>{if(!canEdit())return;const name=E('jerseyNameInput').value.trim().slice(0,18),num=E('jerseyNumberInput').value.trim();E('jerseySaveStatus').textContent='Saving…';const r=await DB().from('team_player_lockers').update({jersey_name:name||locker.gamertag,jersey_number:num||null,updated_at:new Date().toISOString()}).eq('id',locker.id);E('jerseySaveStatus').textContent=r.error?r.error.message:'Saved ✓';if(!r.error){locker.jersey_name=name||locker.gamertag;locker.jersey_number=num||null;}});
E('uploadChelImage')?.addEventListener('click',async()=>{if(!canEdit())return;const f=E('chelImageInput').files?.[0];if(!f){E('uploadStatus').textContent='Choose an image first.';return}if(f.size>8*1024*1024){E('uploadStatus').textContent='Keep the image under 8 MB.';return}E('uploadStatus').textContent='Uploading…';const ownerFolder=locker.user_id||ST().user.id,path=TEAM+'/'+ownerFolder+'/'+locker.id+'-'+Date.now()+'.'+(f.name.split('.').pop()||'jpg').toLowerCase();const up=await DB().storage.from('hitmen-player-images').upload(path,f,{upsert:false,contentType:f.type});if(up.error){E('uploadStatus').textContent=up.error.message;return}const save=await DB().from('team_player_lockers').update({chel_player_image_path:path,chel_player_image_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',locker.id);if(save.error){E('uploadStatus').textContent=save.error.message;return}locker.chel_player_image_path=path;E('uploadStatus').textContent='Uploaded ✓';await render();});
paintStall('','');
window.addEventListener('vvhl-auth-change',gate);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();