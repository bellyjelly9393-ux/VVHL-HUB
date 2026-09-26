(() => {
const TEAM='b0bcbdda-da9d-419d-8f61-b34937966d49',SEASON=55;
const FRONT='https://d2ol7oe51mr4n9.cloudfront.net/user_3Ic50OgPEnsF6yLkPdMjvCnPfo2/8dab25da-ccf3-4f5b-b244-7a264e17f5fd.png';
const BACK='https://d2ol7oe51mr4n9.cloudfront.net/user_3Ic50OgPEnsF6yLkPdMjvCnPfo2/266b0358-f8bd-447c-a3c9-a69961817449.png';
const E=id=>document.getElementById(id),DB=()=>window.VVHLBackend?.db,ST=()=>window.VVHLBackend?.state||{};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let locker=null,reports=[],weekly=[],signedImage=null;
const member=()=> (ST().memberships||[]).find(m=>m.team_id===TEAM&&m.active!==false);
const isAdmin=()=>String(ST().profile?.role||'').toLowerCase()==='admin';
const canManage=()=>Boolean(ST().user&&(isAdmin()||['owner','gm','agm','scout'].includes(String(member()?.role||'').toLowerCase())));
const canEdit=()=>Boolean(ST().user&&(isAdmin()||['owner','gm','agm'].includes(String(member()?.role||'').toLowerCase())));
const money=v=>v==null?'—':Number(v)===0?'MANAGEMENT':'$'+(Number(v)/1000000).toFixed(Number(v)%1000000?2:0)+'M';
const val=(o,k)=>Number(o?.[k]||0);
async function imageUrl(path){if(!path)return null;const r=await DB().storage.from('hitmen-player-images').createSignedUrl(path,3600);return r.error?null:r.data?.signedUrl||null}
function aggregate(){
 const t={games:reports.length,goals:0,assists:0,points:0,plus_minus:0,shots:0,hits:0,takeaways:0,giveaways:0,pim:0,blocks:0,faceoff_pct:0,passing_pct:0,foN:0,passN:0};
 reports.forEach(r=>{const s=r.stats||{};['goals','assists','plus_minus','shots','hits','takeaways','giveaways','pim','blocks'].forEach(k=>t[k]+=val(s,k));if(s.faceoff_pct!=null){t.faceoff_pct+=Number(s.faceoff_pct);t.foN++}if(s.passing_pct!=null){t.passing_pct+=Number(s.passing_pct);t.passN++}});
 t.points=t.goals+t.assists; if(t.foN)t.faceoff_pct/=t.foN;if(t.passN)t.passing_pct/=t.passN; return t;
}
function gate(){
 const ok=canManage(),content=document.querySelector('[data-management-content]'),locked=E('managementLockedMessage');
 if(content)content.hidden=!ok;if(locked)locked.hidden=ok;
 if(E('depthAccess'))E('depthAccess').textContent=ok?'AUTHORIZED · '+String(member()?.role||'ADMIN').toUpperCase():'PRIVATE';
 if(ok)load();
}
async function choose(){
 const id=new URLSearchParams(location.search).get('player');
 let q=DB().from('team_player_lockers').select('*').eq('team_id',TEAM).eq('season',SEASON);
 if(id)q=q.eq('id',id);
 const r=await q.order('gamertag').limit(1).maybeSingle();if(r.error)throw r.error;return r.data;
}
function setText(id,v){if(E(id))E(id).textContent=v??'—'}
function note(id,v,fallback){setText(id,v||fallback)}
function metric(label,value){return '<div class="hm-depth-metric"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>'}
async function render(){
 if(!locker)return;
 const name=(locker.jersey_name||locker.gamertag||'PLAYER').toUpperCase(),num=locker.jersey_number||'';
 ['depthPlateName','depthJerseyName'].forEach(id=>setText(id,name));['depthPlateNumL','depthPlateNumR','depthJerseyNum','depthSleeveL','depthSleeveR'].forEach(id=>setText(id,num));
 setText('depthPlayerName',locker.gamertag);setText('depthRailName',locker.gamertag);setText('depthRailMeta','Season 55 · '+(locker.management_role||locker.position||'Roster'));
 setText('depthPositionTop',locker.position||'—');setText('depthPosition',locker.position||'—');setText('depthBioPosition',locker.position||'—');setText('depthGamertag',locker.gamertag);
 setText('depthSalary',money(locker.salary));setText('depthManagementRole',locker.management_role||'ROSTER');setText('depthAvailability',String(locker.availability_status||'unknown').toUpperCase());setText('depthBioAvailability',String(locker.availability_status||'unknown').toUpperCase());
 setText('depthHandedness',locker.handedness||'—');setText('depthPlayerType',locker.player_type||'—');setText('depthLine',locker.depth_line||'Unassigned');setText('depthRole',locker.depth_role||'Pending');setText('depthSpecialTeams',locker.special_teams_role||'—');setText('depthQuickLine',locker.depth_line||'UNASSIGNED');setText('depthQuickRole',locker.depth_role||'Role pending');setText('depthEquipmentStatus',String(locker.equipment_sync_status||'not_connected').replaceAll('_',' ').toUpperCase());
 note('depthSummaryText',locker.scouting_summary,'No management summary yet.');note('depthStrengthsText',locker.scouting_strengths,'No strengths logged yet.');note('depthConcernsText',locker.scouting_concerns,'No concerns logged yet.');note('depthTendenciesText',locker.scouting_tendencies,'No tendencies logged yet.');note('depthChemistryText',locker.chemistry_notes,'No chemistry notes yet.');note('depthDevelopmentText',locker.development_focus,'No development focus yet.');
 const t=aggregate();[['depthGP',t.games],['depthG',t.goals],['depthA',t.assists],['depthP',t.points],['depthPM',t.plus_minus]].forEach(([id,v])=>setText(id,v));setText('depthGameCount',t.games+' GAME'+(t.games===1?'':'S'));
 E('depthStatProfile').innerHTML=metric('Goals / Game',t.games?(t.goals/t.games).toFixed(2):'0.00')+metric('Points / Game',t.games?(t.points/t.games).toFixed(2):'0.00')+metric('Shots',t.shots)+metric('Hits',t.hits)+metric('Takeaways',t.takeaways)+metric('Giveaways',t.giveaways)+metric('Turnover Diff',t.takeaways-t.giveaways)+metric('Blocks',t.blocks)+metric('PIM',t.pim)+metric('Faceoff %',t.foN?t.faceoff_pct.toFixed(1)+'%':'—')+metric('Passing %',t.passN?t.passing_pct.toFixed(1)+'%':'—');
 signedImage=await imageUrl(locker.chel_player_image_path);if(signedImage){E('depthMiniImage').innerHTML='<img src="'+esc(signedImage)+'" alt="">';E('depthChelFigure').innerHTML='<img src="'+esc(signedImage)+'" alt="CHEL player">';}
 renderGames();renderWeekly();fillEditor();
}
function renderGames(){
 const recent=reports.slice(0,6);const box=E('depthRecentGames'),stack=E('depthGameReports');
 if(!recent.length){box.innerHTML='<div class="hm-depth-empty">No games have been reviewed yet.</div>';stack.innerHTML='<div class="hm-depth-empty">Individual coaching reports will populate after game review.</div>';return}
 box.innerHTML=recent.map(r=>'<div class="hm-depth-game"><span><strong>'+esc(r.opponent_name||'Opponent')+'</strong><small>'+esc(r.position_played||locker.position||'')+(r.line_label?' · '+esc(r.line_label):'')+'</small></span><b class="'+(String(r.result||'').startsWith('W')?'hm-depth-result-w':String(r.result||'').startsWith('L')?'hm-depth-result-l':'')+'">'+esc(r.result||'—')+'</b><small>'+esc(r.game_date?new Date(r.game_date).toLocaleDateString():'')+'</small></div>').join('');
 stack.innerHTML=recent.map(r=>'<article class="hm-depth-report"><small>'+esc(r.game_date?new Date(r.game_date).toLocaleDateString():'GAME REPORT')+' · '+esc(r.opponent_name||'Opponent')+'</small><h4>'+esc(r.coach_summary||r.strengths||'Review complete')+'</h4><p>'+esc(r.improvements||r.tactical_notes||'No additional coaching note.')+'</p></article>').join('');
}
function renderWeekly(){
 const r=weekly[0],box=E('depthWeeklyReport');if(!r){box.innerHTML='<div class="hm-depth-empty">First weekly report will appear after Week 1 is reviewed.</div>';return}
 setText('depthWeekLabel','WEEK '+r.week);box.innerHTML='<div class="hm-depth-note-grid"><div><small>SUMMARY</small><p>'+esc(r.summary||'—')+'</p></div><div><small>STRENGTHS</small><p>'+esc(r.strengths||'—')+'</p></div><div><small>NEXT FOCUS</small><p>'+esc(r.focus_next_week||'—')+'</p></div></div>';
}
function fillEditor(){
 if(!canEdit()){E('management').hidden=true;return}
 const pairs=[['editDepthLine','depth_line'],['editDepthRank','depth_rank'],['editDepthRole','depth_role'],['editSpecialTeams','special_teams_role'],['editHandedness','handedness'],['editPlayerType','player_type'],['editAvailability','availability_status'],['editEquipmentStatus','equipment_sync_status'],['editSummary','scouting_summary'],['editStrengths','scouting_strengths'],['editConcerns','scouting_concerns'],['editTendencies','scouting_tendencies'],['editChemistry','chemistry_notes'],['editDevelopment','development_focus']];
 pairs.forEach(([id,k])=>{if(E(id))E(id).value=locker[k]??''});
}
async function load(){
 if(!canManage()||!DB())return;
 try{
  locker=await choose();if(!locker)throw new Error('Player locker not found.');
  const [gr,wr]=await Promise.all([
    DB().from('team_player_game_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('game_date',{ascending:false}),
    DB().from('team_player_weekly_reports').select('*').eq('team_id',TEAM).eq('season',SEASON).eq('locker_id',locker.id).order('week',{ascending:false})
  ]);
  if(gr.error)throw gr.error;if(wr.error)throw wr.error;reports=gr.data||[];weekly=wr.data||[];await render();
 }catch(e){console.error(e);setText('depthPlayerName','DEPTH CARD UNAVAILABLE');}
}
E('depthJerseyFlip')?.addEventListener('click',()=>{const el=E('depthJerseyFlip');el.classList.toggle('flipped');const back=el.classList.contains('flipped');setText('depthFlipHint',back?'BACK · TAP TO VIEW FRONT':'FRONT · TAP TO VIEW BACK')});
E('depthJerseyFlip')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();E('depthJerseyFlip').click()}});
E('saveDepthCard')?.addEventListener('click',async()=>{
 if(!canEdit()||!locker)return;setText('depthSaveStatus','SAVING…');
 const rank=E('editDepthRank').value.trim();
 const patch={depth_line:E('editDepthLine').value.trim()||null,depth_rank:rank?Number(rank):null,depth_role:E('editDepthRole').value.trim()||null,special_teams_role:E('editSpecialTeams').value.trim()||null,handedness:E('editHandedness').value||null,player_type:E('editPlayerType').value.trim()||null,availability_status:E('editAvailability').value||'unknown',equipment_sync_status:E('editEquipmentStatus').value||'not_connected',scouting_summary:E('editSummary').value.trim()||null,scouting_strengths:E('editStrengths').value.trim()||null,scouting_concerns:E('editConcerns').value.trim()||null,scouting_tendencies:E('editTendencies').value.trim()||null,chemistry_notes:E('editChemistry').value.trim()||null,development_focus:E('editDevelopment').value.trim()||null,updated_at:new Date().toISOString()};
 const r=await DB().from('team_player_lockers').update(patch).eq('id',locker.id);setText('depthSaveStatus',r.error?r.error.message:'SAVED ✓');if(!r.error){locker={...locker,...patch};await render();}
});
window.addEventListener('vvhl-auth-change',gate);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',gate);else gate();
})();