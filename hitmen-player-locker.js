(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
let locker=null,reports=[],weekly=[],lineReports=[],historical=[],signedImage=null;
const profileRole=()=>String(ST().profile?.role||'').toLowerCase();
const member=()=> (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false);
const memberRole=()=>String(member()?.role||'').toLowerCase();
const canAccess=()=>Boolean(ST().user&&(['admin','commissioner'].includes(profileRole())||['owner','gm','agm','scout'].includes(memberRole())));
const canManage=()=>['admin','commissioner'].includes(profileRole())||['owner','gm','agm'].includes(memberRole());
const canEdit=()=>Boolean(locker&&canManage());
const money=v=>v==null?'—':v===0?'MANAGEMENT':'$'+(Number(v)/1000000).toFixed(Number(v)%1000000?2:0)+'M';
const rosterLabel=()=>locker?.roster_class==='tc'?'TC':'ACTIVE ROSTER';
function gate(){
 const ok=canAccess(),content=document.querySelector('[data-management-content]'),locked=E('managementLockedMessage');
 if(content)content.hidden=!ok;if(locked)locked.hidden=ok;if(ok)load();
}
async function chooseLocker(){
 const wanted=new URLSearchParams(location.search).get('player');
 let q=DB().from('team_player_lockers').select('*').eq('team_id',TEAM).eq('season',SEASON);
 if(wanted)q=q.eq('id',wanted);
 else q=q.order('management_role',{ascending:false,nullsFirst:false}).order('gamertag');
 const r=await q.limit(1).maybeSingle();
 if(r.error)throw r.error;
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
function val(id,text){const el=E(id);if(el)el.textContent=text}
function input(id,value){const el=E(id);if(el)el.value=value??''}

async function render(){
 if(!locker)return;
 val('playerSideName',locker.gamertag);val('playerSidePos',locker.position||'—');val('playerTitle',locker.gamertag);
 val('playerMeta','Season 55 · '+(locker.management_role||rosterLabel()));
 val('playerPositionBadge',locker.position||'—');val('playerRoleBadge',locker.management_role||'PLAYER');
 val('playerRosterClassBadge',rosterLabel());val('playerAvailabilityBadge',String(locker.availability_status||'unknown').toUpperCase());
 val('playerSalaryBadge',money(locker.salary));val('playerClaimStatus',locker.user_id?'DISCORD / ACCOUNT LINKED':'STALL NOT YET CLAIMED');
 const displayName=(locker.jersey_name||locker.gamertag).toUpperCase(),displayNum=locker.jersey_number||'';
 input('jerseyNameInput',locker.jersey_name||locker.gamertag);input('jerseyNumberInput',displayNum);
 val('jerseyNameLive',displayName);val('jerseyNumberLive',displayNum);val('jerseyFrontNumLeft',displayNum);val('jerseyFrontNumRight',displayNum);
 val('lockerPlateName',displayName);val('lockerPlateNumLeft',displayNum);val('lockerPlateNumRight',displayNum);
 E('editLockerBox').hidden=!canEdit();E('uploadChelImage').disabled=!canEdit();E('chelImageInput').disabled=!canEdit();

 val('dossierSummary',locker.scouting_summary||'No management summary saved yet.');
 val('dossierStrengths',locker.scouting_strengths||'No verified strengths saved yet.');
 val('dossierConcerns',locker.scouting_concerns||'No verified concerns saved yet.');
 val('dossierTendencies',locker.scouting_tendencies||'No repeatable tendencies saved yet.');
 val('dossierChemistry',locker.chemistry_notes||'No chemistry notes saved yet.');
 val('dossierDevelopment',locker.development_focus||'No development focus saved yet.');
 input('dossierRosterClass',locker.roster_class||'active_roster');input('dossierAvailability',locker.availability_status||'unknown');
 input('dossierHandedness',locker.handedness||'');input('dossierSummaryInput',locker.scouting_summary||'');
 input('dossierStrengthsInput',locker.scouting_strengths||'');input('dossierConcernsInput',locker.scouting_concerns||'');
 input('dossierTendenciesInput',locker.scouting_tendencies||'');input('dossierChemistryInput',locker.chemistry_notes||'');
 input('dossierDevelopmentInput',locker.development_focus||'');
 E('dossierEdit').hidden=!canEdit();
 val('dossierStatus',(locker.roster_class==='tc'?'TC PLAYER':'ACTIVE ROSTER')+' · '+(locker.handedness?locker.handedness.toUpperCase()+' SHOT':'HANDEDNESS UNKNOWN'));

 signedImage=await imageUrl(locker.chel_player_image_path);
 const photo=signedImage?'<img src="'+esc(signedImage)+'" alt="">':'<span>CHEL</span>';
 E('playerMiniImage').innerHTML=photo;
 E('uploadPreview').innerHTML=signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player upload">':'<span>NO IMAGE YET</span>';
 E('chelPlayerDisplay').innerHTML=signedImage?'<img src="'+esc(signedImage)+'" alt="CHEL player">':'<div class="chel-placeholder"><b>CHEL PLAYER</b><small>Add a verified screenshot or render when available.</small></div>';

 const t=aggregate();val('performanceSample',t.games+' GAME'+(t.games===1?'':'S'));
 [['psGoals',t.goals],['psAssists',t.assists],['psPoints',t.points],['psPlusMinus',t.plus_minus],['psShots',t.shots],['psHits',t.hits],['psTakeaways',t.takeaways],['psGiveaways',t.giveaways]].forEach(([id,v])=>val(id,v));
 E('offenseMetrics').innerHTML=metric('Games',t.games)+metric('Goals',t.goals)+metric('Assists',t.assists)+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots);
 E('defenseMetrics').innerHTML=metric('+ / -',t.plus_minus)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Turnover Diff',t.takeaways-t.giveaways)+metric('Blocks',t.blocks);
 E('teamMetrics').innerHTML=metric('PIM',t.pim)+metric('Faceoff %',t.foN?t.faceoff_pct.toFixed(1)+'%':'—')+metric('Passing %',t.passN?t.passing_pct.toFixed(1)+'%':'—')+metric('Position',locker.position||'—')+metric('Roster',rosterLabel());
 renderHistorical();renderReports();renderWeekly();renderLineReports();
}
function renderHistorical(){
 const box=E('historicalScoutingReports');if(!box)return;
 if(!historical.length){box.innerHTML='<div class="locker-empty">No saved scouting/VOD report is linked to this player yet. The dossier above remains the current management read.</div>';return}
 box.innerHTML=historical.map(r=>'<article class="player-report"><div class="player-report-head"><div><small>'+esc(new Date(r.created_at).toLocaleDateString())+(r.review_id?' · VOD EVIDENCE':'')+'</small><h3>SCOUTING REPORT</h3></div><small>'+esc(locker.position||'')+'</small></div><div class="player-report-grid"><div class="report-note wide"><small>SUMMARY</small><p>'+esc(r.summary||'—')+'</p></div><div class="report-note"><small>STRENGTHS</small><p>'+esc(r.strengths||'—')+'</p></div><div class="report-note"><small>CONCERNS</small><p>'+esc(r.concerns||'—')+'</p></div></div></article>').join('');
}
function renderReports(){
 const box=E('playerGameReports');if(!reports.length){box.innerHTML='<div class="locker-empty">No game-by-game report yet. This will populate as Season 55 games are reviewed.</div>';return}
 box.innerHTML=reports.map(r=>'<article class="player-report"><div class="player-report-head"><div><small>'+esc(r.game_date?new Date(r.game_date).toLocaleDateString():'GAME REPORT')+'</small><h3>'+esc(r.opponent_name||'Opponent')+(r.result?' · '+esc(r.result):'')+'</h3></div><small>'+esc(r.position_played||locker.position||'')+(r.line_label?' · '+esc(r.line_label):'')+'</small></div><div class="player-report-grid"><div class="report-note"><small>WHAT WORKED</small><p>'+esc(r.strengths||'Pending review.')+'</p></div><div class="report-note"><small>NEXT IMPROVEMENT</small><p>'+esc(r.improvements||'Pending review.')+'</p></div><div class="report-note"><small>TACTICAL NOTES</small><p>'+esc(r.tactical_notes||'No tactical notes yet.')+'</p></div><div class="report-note"><small>COACH SUMMARY</small><p>'+esc(r.coach_summary||'Report is still being built.')+'</p></div></div></article>').join('');
}
function renderWeekly(){
 const box=E('playerWeeklyReport'),r=weekly[0];if(!r){box.innerHTML='<div class="locker-empty">The first weekly development report will appear after games are reviewed.</div>';return}
 val('weeklyLabel','WEEK '+r.week);box.innerHTML='<div class="weekly-card"><div><h4>WEEK SUMMARY</h4><p>'+esc(r.summary||'—')+'</p></div><div><h4>STRENGTHS</h4><p>'+esc(r.strengths||'—')+'</p></div><div><h4>NEXT WEEK FOCUS</h4><p>'+esc(r.focus_next_week||'—')+'</p></div></div>';
}
function renderLineReports(){
 const box=E('playerLineReports');if(!lineReports.length){box.innerHTML='<div class="locker-empty">Unit chemistry reports will appear once saved lines accumulate game evidence.</div>';return}
 box.innerHTML=lineReports.slice(0,4).map(r=>'<article class="player-report"><div class="player-report-head"><div><small>WEEK '+r.week+'</small><h3>'+esc(r.line_label)+'</h3></div><small>'+esc(r.record||'')+'</small></div><div class="player-report-grid"><div class="report-note"><small>UNIT SUMMARY</small><p>'+esc(r.summary||'—')+'</p></div><div class="report-note"><small>NEXT ADJUSTMENTS</small><p>'+esc(r.next_adjustments||'—')+'</p></div></div></article>').join('');
}
async function load(){
 if(!canAccess()||!DB())return;
 try{
  locker=await chooseLocker();if(!locker){val('playerTitle','NO STALL FOUND');return}
  const [gr,wr,lr,hr]=await Promise.all([
   DB().from('team_player_game_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('game_date',{ascending:false}),
   DB().from('team_player_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('week',{ascending:false}),
   DB().from('team_line_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('week',{ascending:false}),
   DB().from('hitmen_player_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).order('created_at',{ascending:false})
  ]);
  const err=[gr,wr,lr,hr].find(x=>x.error)?.error;if(err)throw err;
  reports=gr.data||[];weekly=wr.data||[];lineReports=(lr.data||[]).filter(r=>(r.player_locker_ids||[]).includes(locker.id));
  historical=(hr.data||[]).filter(r=>norm(r.player_key)===norm(locker.gamertag));
  await render();
 }catch(e){console.error(e);val('playerTitle','LOCKER UNAVAILABLE');}
}
async function saveDossier(){
 if(!canEdit()||!locker)return;
 const payload={
  roster_class:E('dossierRosterClass').value,
  availability_status:E('dossierAvailability').value,
  handedness:E('dossierHandedness').value||null,
  scouting_summary:E('dossierSummaryInput').value.trim()||null,
  scouting_strengths:E('dossierStrengthsInput').value.trim()||null,
  scouting_concerns:E('dossierConcernsInput').value.trim()||null,
  scouting_tendencies:E('dossierTendenciesInput').value.trim()||null,
  chemistry_notes:E('dossierChemistryInput').value.trim()||null,
  development_focus:E('dossierDevelopmentInput').value.trim()||null,
  updated_at:new Date().toISOString()
 };
 val('dossierSaveStatus','Saving…');
 const r=await DB().from('team_player_lockers').update(payload).eq('id',locker.id).eq('team_id',TEAM).select('*').single();
 if(r.error){val('dossierSaveStatus',r.error.message);return}
 locker=r.data;val('dossierSaveStatus','Saved ✓');await render();
}
E('saveDossier')?.addEventListener('click',saveDossier);
E('jerseyNameInput')?.addEventListener('input',e=>{const v=e.target.value.toUpperCase();val('jerseyNameLive',v);val('lockerPlateName',v)});
E('jerseyNumberInput')?.addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,2);const v=e.target.value;val('jerseyNumberLive',v);val('jerseyFrontNumLeft',v);val('jerseyFrontNumRight',v);val('lockerPlateNumLeft',v);val('lockerPlateNumRight',v)});
E('saveJersey')?.addEventListener('click',async()=>{if(!canEdit())return;const name=E('jerseyNameInput').value.trim().slice(0,18),num=E('jerseyNumberInput').value.trim();val('jerseySaveStatus','Saving…');const r=await DB().from('team_player_lockers').update({jersey_name:name||locker.gamertag,jersey_number:num||null,updated_at:new Date().toISOString()}).eq('id',locker.id);val('jerseySaveStatus',r.error?r.error.message:'Saved ✓');if(!r.error){locker.jersey_name=name||locker.gamertag;locker.jersey_number=num||null;}});
E('uploadChelImage')?.addEventListener('click',async()=>{if(!canEdit())return;const f=E('chelImageInput').files?.[0];if(!f){val('uploadStatus','Choose an image first.');return}if(f.size>8*1024*1024){val('uploadStatus','Keep the image under 8 MB.');return}val('uploadStatus','Uploading…');const ownerFolder=locker.user_id||ST().user.id,path=TEAM+'/'+ownerFolder+'/'+locker.id+'-'+Date.now()+'.'+(f.name.split('.').pop()||'jpg').toLowerCase();const up=await DB().storage.from('hitmen-player-images').upload(path,f,{upsert:false,contentType:f.type});if(up.error){val('uploadStatus',up.error.message);return}const save=await DB().from('team_player_lockers').update({chel_player_image_path:path,chel_player_image_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',locker.id);if(save.error){val('uploadStatus',save.error.message);return}locker.chel_player_image_path=path;val('uploadStatus','Uploaded ✓');await render();});
function flipBigJersey(e){const el=E('bigJerseyFlip');if(!el)return;if(e){e.preventDefault();e.stopPropagation()}el.classList.toggle('is-flipped');const back=el.classList.contains('is-flipped');el.setAttribute('aria-label',back?'Flip jersey back to front':'Flip jersey front to back');val('jerseyFlipHint',back?'TAP JERSEY TO VIEW FRONT':'TAP JERSEY TO VIEW BACK')}
E('bigJerseyFlip')?.addEventListener('click',flipBigJersey);E('bigJerseyFlip')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')flipBigJersey(e)});
window.addEventListener('vvhl-auth-change',gate);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();