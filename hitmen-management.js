const HITMEN_TEAM_ID = 'b0bcbdda-da9d-419d-8f61-b34937966d49';
const hm = { pool: [], reports: [], bids: [], players: new Map(), selectedPoolId: null, user: null, role: null };
const $ = (id) => document.getElementById(id);
const safe = (v='') => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numOrNull = (v) => v === '' || v == null ? null : Number(v);
const money = (v) => v == null ? '—' : '$' + Number(v).toLocaleString();

function activateTab(name){
  document.querySelectorAll('.hitmen-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.hitmen-tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===name));
}
document.querySelectorAll('.hitmen-tab').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tab)));

function membershipForHitmen(state){
  if (state.profile?.role === 'admin') return { role:'admin' };
  return (state.memberships || []).find(m=>m.team_id===HITMEN_TEAM_ID && m.active && ['owner','gm','agm'].includes(m.role));
}

async function onAuthState(){
  const { db, state } = window.VVHLBackend;
  hm.user = state.user || null;
  $('hitmenWorkspace').hidden = true;
  $('accessGate').hidden = true;
  if (!state.user) return;

  await db.rpc('claim_my_team_invite');
  if (window.VVHLBackend.state.user && !membershipForHitmen(window.VVHLBackend.state)) {
    await window.VVHLBackend.refresh();
    return;
  }
  const membership = membershipForHitmen(window.VVHLBackend.state);
  if (!membership) {
    $('accessGate').hidden = false;
    return;
  }
  hm.role = membership.role;
  $('roleBadge').textContent = membership.role === 'admin' ? 'Wildman Admin' : `Hitmen ${membership.role.toUpperCase()}`;
  $('hitmenWorkspace').hidden = false;
  await loadAll();
}

async function loadAll(){
  const { db } = window.VVHLBackend;
  const [poolRes, reportRes, bidRes] = await Promise.all([
    db.from('team_scouting_pool').select('id,team_id,scouting_player_id,status,priority,fit_grade,projected_role,target_bid,max_bid,management_note,created_at,updated_at,scouting_players(id,gamertag,platform,primary_position)').eq('team_id',HITMEN_TEAM_ID).order('priority',{ascending:true,nullsFirst:false}).order('updated_at',{ascending:false}),
    db.from('team_scouting_reports').select('id,scouting_player_id,author_id,overall_grade,offense_grade,defense_grade,hockey_iq_grade,puck_movement_grade,positioning_grade,communication_grade,consistency_grade,strengths,concerns,projected_role,recommendation,notes,created_at,scouting_players(gamertag,primary_position)').eq('team_id',HITMEN_TEAM_ID).order('created_at',{ascending:false}),
    db.from('team_bid_board').select('id,scouting_player_id,target_price,max_price,priority,status,plan,note,updated_at,scouting_players(gamertag,primary_position)').eq('team_id',HITMEN_TEAM_ID).order('priority',{ascending:true,nullsFirst:false}).order('updated_at',{ascending:false})
  ]);
  const err = poolRes.error || reportRes.error || bidRes.error;
  if (err) { console.warn('Hitmen load',err); return; }
  hm.pool = poolRes.data || [];
  hm.reports = reportRes.data || [];
  hm.bids = bidRes.data || [];
  hm.players.clear();
  hm.pool.forEach(r=>{ if(r.scouting_players) hm.players.set(r.scouting_player_id,r.scouting_players); });
  renderAll();
}

function renderAll(){
  $('statScouted').textContent = hm.pool.length;
  $('statPriority').textContent = hm.pool.filter(x=>x.status==='priority'||x.priority===1).length;
  $('statBids').textContent = hm.pool.filter(x=>x.status==='bid_target').length + hm.bids.filter(x=>['target','active_bid'].includes(x.status)).length;
  $('statReports').textContent = hm.reports.length;
  renderPool(); renderReportSelect(); renderReports(); renderBids();
}

function renderPool(){
  const q = ($('poolSearch')?.value || '').trim().toLowerCase();
  const rows = hm.pool.filter(r=>{
    const p=r.scouting_players||{};
    return !q || [p.gamertag,p.primary_position,p.platform,r.status,r.projected_role].some(v=>String(v||'').toLowerCase().includes(q));
  });
  $('poolBody').innerHTML = rows.map(r=>{
    const p=r.scouting_players||{};
    return `<tr data-pool-id="${r.id}"><td><b>${safe(p.gamertag||'Unknown')}</b><br><small>${safe(p.platform||'')}</small></td><td>${safe(p.primary_position||'—')}</td><td><span class="tag">${safe(r.status.replaceAll('_',' '))}</span></td><td>${r.priority??'—'}</td><td>${r.fit_grade??'—'}</td><td>${money(r.target_bid)}</td><td>${money(r.max_bid)}</td></tr>`;
  }).join('');
  $('poolEmpty').hidden = hm.pool.length !== 0;
  document.querySelectorAll('[data-pool-id]').forEach(tr=>tr.addEventListener('click',()=>selectPool(tr.dataset.poolId)));
}
$('poolSearch')?.addEventListener('input',renderPool);

function selectPool(id){
  hm.selectedPoolId=id;
  const r=hm.pool.find(x=>x.id===id); if(!r)return;
  const p=r.scouting_players||{};
  $('playerEditor').hidden=false;
  $('selectedName').textContent=p.gamertag||'Player';
  $('selectedMeta').textContent=[p.primary_position,p.platform].filter(Boolean).join(' · ');
  $('editStatus').value=r.status||'scouted';
  $('editPriority').value=r.priority??'';
  $('editFit').value=r.fit_grade??'';
  $('editRole').value=r.projected_role||'';
  $('editTargetBid').value=r.target_bid??'';
  $('editMaxBid').value=r.max_bid??'';
  $('editNote').value=r.management_note||'';
  $('reportPlayer').value=r.scouting_player_id;
}

$('addPlayerForm')?.addEventListener('submit', async (e)=>{
  e.preventDefault(); const {db,state}=window.VVHLBackend; const msg=$('addPlayerMessage');
  const gamertag=$('newGamertag').value.trim(); if(!gamertag)return;
  msg.textContent='Saving…';
  let {data:found,error:findErr}=await db.from('scouting_players').select('id,gamertag,platform,primary_position').ilike('gamertag',gamertag).limit(1);
  if(findErr){msg.textContent=findErr.message;return;}
  let player=found?.[0];
  if(!player){
    const ins=await db.from('scouting_players').insert({gamertag,platform:$('newPlatform').value||null,primary_position:$('newPosition').value||null,is_returning_player:false,scouting_status:'scouted'}).select('id,gamertag,platform,primary_position').single();
    if(ins.error){msg.textContent=ins.error.message;return;} player=ins.data;
  }
  const existing=hm.pool.find(x=>x.scouting_player_id===player.id);
  if(existing){msg.textContent='Already in Calgary pool.'; selectPool(existing.id); return;}
  const res=await db.from('team_scouting_pool').insert({team_id:HITMEN_TEAM_ID,scouting_player_id:player.id,status:$('newStatus').value,added_by:state.user.id,updated_by:state.user.id}).select('id').single();
  if(res.error){msg.textContent=res.error.message;return;}
  msg.textContent='Added ✓'; e.target.reset(); await loadAll(); selectPool(res.data.id);
});

$('poolEditForm')?.addEventListener('submit',async(e)=>{
  e.preventDefault(); if(!hm.selectedPoolId)return; const {db,state}=window.VVHLBackend; const msg=$('poolEditMessage'); msg.textContent='Saving…';
  const current=hm.pool.find(x=>x.id===hm.selectedPoolId);
  const payload={status:$('editStatus').value,priority:numOrNull($('editPriority').value),fit_grade:numOrNull($('editFit').value),projected_role:$('editRole').value.trim()||null,target_bid:numOrNull($('editTargetBid').value),max_bid:numOrNull($('editMaxBid').value),management_note:$('editNote').value.trim()||null,updated_by:state.user.id,updated_at:new Date().toISOString()};
  const res=await db.from('team_scouting_pool').update(payload).eq('id',hm.selectedPoolId);
  if(res.error){msg.textContent=res.error.message;return;}
  if(payload.status==='bid_target'||payload.target_bid!=null||payload.max_bid!=null) await saveBidFromPool(current.scouting_player_id,payload);
  msg.textContent='Saved ✓'; await loadAll();
});

async function saveBidFromPool(playerId,payload){
  const {db,state}=window.VVHLBackend;
  const existing=hm.bids.find(x=>x.scouting_player_id===playerId);
  const bid={target_price:payload.target_bid,max_price:payload.max_bid,priority:payload.priority,status:payload.status==='bid_target'?'target':(existing?.status||'watch'),plan:payload.projected_role,note:payload.management_note,updated_by:state.user.id,updated_at:new Date().toISOString()};
  return existing ? db.from('team_bid_board').update(bid).eq('id',existing.id) : db.from('team_bid_board').insert({...bid,team_id:HITMEN_TEAM_ID,scouting_player_id:playerId});
}

$('removeFromPool')?.addEventListener('click',async()=>{
  if(!hm.selectedPoolId||!confirm('Remove this player from the Calgary scouting pool?'))return;
  const {db}=window.VVHLBackend; const r=hm.pool.find(x=>x.id===hm.selectedPoolId); const res=await db.from('team_scouting_pool').delete().eq('id',hm.selectedPoolId); if(res.error){$('poolEditMessage').textContent=res.error.message;return;}
  const bid=hm.bids.find(x=>x.scouting_player_id===r.scouting_player_id); if(bid) await db.from('team_bid_board').delete().eq('id',bid.id);
  hm.selectedPoolId=null; $('playerEditor').hidden=true; await loadAll();
});

function renderReportSelect(){
  $('reportPlayer').innerHTML='<option value="">Choose player…</option>'+hm.pool.map(r=>`<option value="${r.scouting_player_id}">${safe(r.scouting_players?.gamertag||'Unknown')}</option>`).join('');
}
$('reportForm')?.addEventListener('submit',async(e)=>{
  e.preventDefault(); const {db,state}=window.VVHLBackend; const msg=$('reportMessage'); const pid=$('reportPlayer').value; if(!pid){msg.textContent='Choose a player.';return;} msg.textContent='Saving…';
  const payload={team_id:HITMEN_TEAM_ID,scouting_player_id:pid,author_id:state.user.id,overall_grade:numOrNull($('gradeOverall').value),offense_grade:numOrNull($('gradeOffense').value),defense_grade:numOrNull($('gradeDefense').value),hockey_iq_grade:numOrNull($('gradeIQ').value),puck_movement_grade:numOrNull($('gradePuck').value),positioning_grade:numOrNull($('gradePositioning').value),communication_grade:numOrNull($('gradeComms').value),consistency_grade:numOrNull($('gradeConsistency').value),strengths:$('reportStrengths').value.trim()||null,concerns:$('reportConcerns').value.trim()||null,projected_role:$('reportRole').value.trim()||null,recommendation:$('reportRecommendation').value,notes:$('reportNotes').value.trim()||null};
  const res=await db.from('team_scouting_reports').insert(payload); if(res.error){msg.textContent=res.error.message;return;} msg.textContent='Report saved ✓'; e.target.reset(); await loadAll();
});

function renderReports(){
  $('reportList').innerHTML=hm.reports.map(r=>`<article class="hm-report-card"><b>${safe(r.scouting_players?.gamertag||'Unknown')}</b> <span class="tag">${safe((r.recommendation||'report').replaceAll('_',' '))}</span><br><small>${new Date(r.created_at).toLocaleString()}</small><div class="hm-grade-row"><div class="hm-grade"><small>Overall</small><strong>${r.overall_grade??'—'}</strong></div><div class="hm-grade"><small>Offense</small><strong>${r.offense_grade??'—'}</strong></div><div class="hm-grade"><small>Defense</small><strong>${r.defense_grade??'—'}</strong></div><div class="hm-grade"><small>Hockey IQ</small><strong>${r.hockey_iq_grade??'—'}</strong></div></div>${r.strengths?`<p><b>Strengths:</b> ${safe(r.strengths)}</p>`:''}${r.concerns?`<p><b>Concerns:</b> ${safe(r.concerns)}</p>`:''}${r.notes?`<p>${safe(r.notes)}</p>`:''}</article>`).join('');
  $('reportEmpty').hidden=hm.reports.length!==0;
}

function renderBids(){
  const byPlayer=new Map(hm.bids.map(b=>[b.scouting_player_id,b]));
  const targets=hm.pool.filter(p=>p.status==='bid_target'||p.target_bid!=null||p.max_bid!=null||byPlayer.has(p.scouting_player_id));
  $('bidBody').innerHTML=targets.map(p=>{const b=byPlayer.get(p.scouting_player_id)||{};const sp=p.scouting_players||{};return `<tr><td><b>${safe(sp.gamertag||'Unknown')}</b></td><td>${safe(sp.primary_position||'—')}</td><td>${b.priority??p.priority??'—'}</td><td><span class="tag">${safe((b.status||p.status||'watch').replaceAll('_',' '))}</span></td><td>${money(b.target_price??p.target_bid)}</td><td>${money(b.max_price??p.max_bid)}</td><td>${safe(b.plan||p.projected_role||'—')}</td></tr>`}).join('');
  $('bidEmpty').hidden=targets.length!==0;
}

window.addEventListener('vvhl-auth-change',()=>setTimeout(onAuthState,0));
setTimeout(onAuthState,250);
