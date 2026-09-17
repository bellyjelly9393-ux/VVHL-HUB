(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const S={pool:[],reports:[],bids:[],invites:[],selected:null,role:null,loading:false};
  const db=()=>window.VVHLBackend?.db;
  const state=()=>window.VVHLBackend?.state||{};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const val=id=>$(id)?.value??'';
  const n=v=>v===''||v==null?null:Number(v);
  const money=v=>v==null?'—':'$'+Number(v).toLocaleString();
  const role=()=>{
    if(String(state().profile?.role||'').toLowerCase()==='admin')return'admin';
    return (state().memberships||[]).find(m=>m.team_id===TEAM_ID&&m.active!==false&&['owner','gm','agm'].includes(String(m.role||'').toLowerCase()))?.role||null;
  };
  function allowed(){S.role=role();return !!S.role;}
  function msg(id,text){if($(id))$(id).textContent=text||'';}
  function activate(name){document.querySelectorAll('[data-hs-tab]').forEach(x=>x.classList.toggle('active',x.dataset.hsTab===name));document.querySelectorAll('[data-hs-pane]').forEach(x=>x.classList.toggle('active',x.dataset.hsPane===name));}

  async function claimInvite(){if(!state().user)return;try{await db().rpc('claim_my_team_invite');}catch(e){console.warn(e);}}

  async function load(){
    if(S.loading||!state().user)return;S.loading=true;
    try{
      await claimInvite();
      if(!allowed()){document.querySelectorAll('[data-hitmen-scouting]').forEach(x=>x.hidden=true);return;}
      document.querySelectorAll('[data-hitmen-scouting]').forEach(x=>x.hidden=false);
      const queries=[
        db().from('team_scouting_pool').select('id,scouting_player_id,status,priority,fit_grade,projected_role,target_bid,max_bid,management_note,updated_at,scouting_players(id,gamertag,platform,primary_position)').eq('team_id',TEAM_ID).order('priority',{ascending:true,nullsFirst:false}).order('updated_at',{ascending:false}),
        db().from('team_scouting_reports').select('id,scouting_player_id,author_id,overall_grade,offense_grade,defense_grade,hockey_iq_grade,puck_movement_grade,positioning_grade,communication_grade,consistency_grade,strengths,concerns,projected_role,recommendation,notes,created_at,scouting_players(gamertag,primary_position)').eq('team_id',TEAM_ID).order('created_at',{ascending:false}),
        db().from('team_bid_board').select('id,scouting_player_id,target_price,max_price,priority,status,plan,note,updated_at,scouting_players(gamertag,primary_position)').eq('team_id',TEAM_ID).order('priority',{ascending:true,nullsFirst:false}).order('updated_at',{ascending:false})
      ];
      if(S.role==='admin')queries.push(db().from('team_access_invites').select('id,email,role,display_name,active,claimed_by,claimed_at,created_at').eq('team_id',TEAM_ID).order('created_at',{ascending:false}));
      const r=await Promise.all(queries);const err=r.find(x=>x.error)?.error;if(err)throw err;
      S.pool=r[0].data||[];S.reports=r[1].data||[];S.bids=r[2].data||[];S.invites=r[3]?.data||[];render();
    }catch(e){console.error(e);msg('hsStatus',e.message||'Could not load scouting desk.');}
    finally{S.loading=false;}
  }

  function render(){
    if($('hsRole'))$('hsRole').textContent=S.role==='admin'?'WILDMAN ADMIN':`HITMEN ${String(S.role).toUpperCase()}`;
    if($('hsScouted'))$('hsScouted').textContent=S.pool.length;
    if($('hsPriority'))$('hsPriority').textContent=S.pool.filter(x=>x.status==='priority'||x.priority===1).length;
    if($('hsBids'))$('hsBids').textContent=S.pool.filter(x=>x.status==='bid_target').length+S.bids.filter(x=>['target','active_bid'].includes(x.status)).length;
    if($('hsReports'))$('hsReports').textContent=S.reports.length;
    if($('hitmenReportCount'))$('hitmenReportCount').textContent=S.reports.length;
    renderPool();renderReportSelect();renderReports();renderBids();renderInvites();
  }

  function renderPool(){
    if(!$('hsPoolBody'))return;const q=val('hsSearch').trim().toLowerCase();
    const rows=S.pool.filter(r=>{const p=r.scouting_players||{};return !q||[p.gamertag,p.primary_position,p.platform,r.status,r.projected_role].some(v=>String(v||'').toLowerCase().includes(q));});
    $('hsPoolBody').innerHTML=rows.map(r=>{const p=r.scouting_players||{};return `<tr data-hs-player="${r.id}"><td><b>${esc(p.gamertag||'Unknown')}</b><br><small>${esc(p.platform||'')}</small></td><td>${esc(p.primary_position||'—')}</td><td><span class="hs-tag">${esc((r.status||'scouted').replaceAll('_',' '))}</span></td><td>${r.priority??'—'}</td><td>${r.fit_grade??'—'}</td><td>${money(r.target_bid)}</td><td>${money(r.max_bid)}</td></tr>`}).join('');
    if($('hsPoolEmpty'))$('hsPoolEmpty').hidden=S.pool.length!==0;
    document.querySelectorAll('[data-hs-player]').forEach(tr=>tr.onclick=()=>select(tr.dataset.hsPlayer));
  }

  function select(id){
    S.selected=id;const r=S.pool.find(x=>x.id===id);if(!r)return;const p=r.scouting_players||{};
    $('hsEditor').hidden=false;$('hsSelectedName').textContent=p.gamertag||'Player';$('hsSelectedMeta').textContent=[p.primary_position,p.platform].filter(Boolean).join(' · ');
    $('hsStatusEdit').value=r.status||'scouted';$('hsPriorityEdit').value=r.priority??'';$('hsFitEdit').value=r.fit_grade??'';$('hsRoleEdit').value=r.projected_role||'';$('hsTargetBid').value=r.target_bid??'';$('hsMaxBid').value=r.max_bid??'';$('hsMgmtNote').value=r.management_note||'';
    if($('hsReportPlayer'))$('hsReportPlayer').value=r.scouting_player_id;
  }

  async function addPlayer(e){
    e.preventDefault();const tag=val('hsNewGamertag').trim();if(!tag)return;msg('hsAddMsg','Saving…');
    let q=await db().from('scouting_players').select('id,gamertag,platform,primary_position').ilike('gamertag',tag).limit(1);if(q.error){msg('hsAddMsg',q.error.message);return;}let p=q.data?.[0];
    if(!p){q=await db().from('scouting_players').insert({gamertag:tag,platform:val('hsNewPlatform')||null,primary_position:val('hsNewPosition')||null,is_returning_player:false,scouting_status:'scouted'}).select('id,gamertag,platform,primary_position').single();if(q.error){msg('hsAddMsg',q.error.message);return;}p=q.data;}
    const existing=S.pool.find(x=>x.scouting_player_id===p.id);if(existing){msg('hsAddMsg','Already in Calgary pool.');select(existing.id);return;}
    const u=state().user.id;const ins=await db().from('team_scouting_pool').insert({team_id:TEAM_ID,scouting_player_id:p.id,status:val('hsNewStatus')||'scouted',added_by:u,updated_by:u}).select('id').single();if(ins.error){msg('hsAddMsg',ins.error.message);return;}
    msg('hsAddMsg','Added ✓');e.target.reset();await load();select(ins.data.id);
  }

  async function savePlayer(e){
    e.preventDefault();const r=S.pool.find(x=>x.id===S.selected);if(!r)return;msg('hsEditMsg','Saving…');const u=state().user.id;
    const payload={status:val('hsStatusEdit'),priority:n(val('hsPriorityEdit')),fit_grade:n(val('hsFitEdit')),projected_role:val('hsRoleEdit').trim()||null,target_bid:n(val('hsTargetBid')),max_bid:n(val('hsMaxBid')),management_note:val('hsMgmtNote').trim()||null,updated_by:u,updated_at:new Date().toISOString()};
    const save=await db().from('team_scouting_pool').update(payload).eq('id',r.id);if(save.error){msg('hsEditMsg',save.error.message);return;}
    if(payload.status==='bid_target'||payload.target_bid!=null||payload.max_bid!=null)await syncBid(r.scouting_player_id,payload);
    msg('hsEditMsg','Saved ✓');await load();
  }

  async function syncBid(pid,p){
    const existing=S.bids.find(x=>x.scouting_player_id===pid);const data={target_price:p.target_bid,max_price:p.max_bid,priority:p.priority,status:p.status==='bid_target'?'target':(existing?.status||'watch'),plan:p.projected_role,note:p.management_note,updated_by:state().user.id,updated_at:new Date().toISOString()};
    return existing?db().from('team_bid_board').update(data).eq('id',existing.id):db().from('team_bid_board').insert({...data,team_id:TEAM_ID,scouting_player_id:pid});
  }

  async function removePlayer(){
    if(!S.selected||!confirm('Remove this player from the Calgary scouting pool?'))return;const r=S.pool.find(x=>x.id===S.selected);const del=await db().from('team_scouting_pool').delete().eq('id',S.selected);if(del.error){msg('hsEditMsg',del.error.message);return;}const b=S.bids.find(x=>x.scouting_player_id===r.scouting_player_id);if(b)await db().from('team_bid_board').delete().eq('id',b.id);S.selected=null;$('hsEditor').hidden=true;await load();
  }

  function renderReportSelect(){if(!$('hsReportPlayer'))return;$('hsReportPlayer').innerHTML='<option value="">Choose player…</option>'+S.pool.map(r=>`<option value="${r.scouting_player_id}">${esc(r.scouting_players?.gamertag||'Unknown')}</option>`).join('');}
  async function saveReport(e){
    e.preventDefault();const pid=val('hsReportPlayer');if(!pid){msg('hsReportMsg','Choose a player.');return;}msg('hsReportMsg','Saving…');
    const data={team_id:TEAM_ID,scouting_player_id:pid,author_id:state().user.id,overall_grade:n(val('hsGradeOverall')),offense_grade:n(val('hsGradeOffense')),defense_grade:n(val('hsGradeDefense')),hockey_iq_grade:n(val('hsGradeIQ')),puck_movement_grade:n(val('hsGradePuck')),positioning_grade:n(val('hsGradePositioning')),communication_grade:n(val('hsGradeComms')),consistency_grade:n(val('hsGradeConsistency')),strengths:val('hsStrengths').trim()||null,concerns:val('hsConcerns').trim()||null,projected_role:val('hsReportRole').trim()||null,recommendation:val('hsRecommendation')||'target',notes:val('hsReportNotes').trim()||null};
    const r=await db().from('team_scouting_reports').insert(data);if(r.error){msg('hsReportMsg',r.error.message);return;}msg('hsReportMsg','Report saved ✓');e.target.reset();await load();
  }
  function renderReports(){if(!$('hsReportList'))return;$('hsReportList').innerHTML=S.reports.map(r=>`<div class="hs-report"><b>${esc(r.scouting_players?.gamertag||'Unknown')}</b> <span class="hs-tag">${esc((r.recommendation||'report').replaceAll('_',' '))}</span><br><small>${new Date(r.created_at).toLocaleString()}</small><div class="hs-grades"><div class="hs-grade"><small>Overall</small><b>${r.overall_grade??'—'}</b></div><div class="hs-grade"><small>Offense</small><b>${r.offense_grade??'—'}</b></div><div class="hs-grade"><small>Defense</small><b>${r.defense_grade??'—'}</b></div><div class="hs-grade"><small>IQ</small><b>${r.hockey_iq_grade??'—'}</b></div></div>${r.strengths?`<p><b>Strengths:</b> ${esc(r.strengths)}</p>`:''}${r.concerns?`<p><b>Concerns:</b> ${esc(r.concerns)}</p>`:''}${r.notes?`<p>${esc(r.notes)}</p>`:''}</div>`).join('');if($('hsReportEmpty'))$('hsReportEmpty').hidden=S.reports.length!==0;}
  function renderBids(){if(!$('hsBidBody'))return;const map=new Map(S.bids.map(b=>[b.scouting_player_id,b]));const rows=S.pool.filter(p=>p.status==='bid_target'||p.target_bid!=null||p.max_bid!=null||map.has(p.scouting_player_id));$('hsBidBody').innerHTML=rows.map(p=>{const b=map.get(p.scouting_player_id)||{},sp=p.scouting_players||{};return `<tr><td><b>${esc(sp.gamertag||'Unknown')}</b></td><td>${esc(sp.primary_position||'—')}</td><td>${b.priority??p.priority??'—'}</td><td><span class="hs-tag">${esc((b.status||p.status||'watch').replaceAll('_',' '))}</span></td><td>${money(b.target_price??p.target_bid)}</td><td>${money(b.max_price??p.max_bid)}</td><td>${esc(b.plan||p.projected_role||'—')}</td></tr>`}).join('');if($('hsBidEmpty'))$('hsBidEmpty').hidden=rows.length!==0;}

  async function saveInvite(e){
    e.preventDefault();if(S.role!=='admin')return;msg('hsInviteMsg','Saving…');const email=val('hsInviteEmail').trim().toLowerCase();if(!email)return;
    const data={team_id:TEAM_ID,email,role:val('hsInviteRole'),display_name:val('hsInviteName').trim()||null,active:true,created_by:state().user.id};
    const existing=S.invites.find(x=>String(x.email).toLowerCase()===email);const r=existing?await db().from('team_access_invites').update(data).eq('id',existing.id):await db().from('team_access_invites').insert(data);if(r.error){msg('hsInviteMsg',r.error.message);return;}msg('hsInviteMsg','Access invite saved ✓');e.target.reset();await load();
  }
  function renderInvites(){const box=$('hsAdminAccess');if(!box)return;box.hidden=S.role!=='admin';if(S.role!=='admin')return;$('hsInviteList').innerHTML=S.invites.map(i=>`<div class="hs-invite-row"><span><b>${esc(i.display_name||i.email)}</b><br><small>${esc(i.email)}</small></span><span class="hs-tag">${esc(i.role)}</span><small>${i.claimed_by?'CLAIMED':'WAITING'}</small></div>`).join('')||'<div class="hs-empty">No Hitmen email invites saved yet.</div>';}

  function bind(){
    document.querySelectorAll('[data-hs-tab]').forEach(b=>b.onclick=()=>activate(b.dataset.hsTab));
    $('hsSearch')?.addEventListener('input',renderPool);$('hsAddForm')?.addEventListener('submit',addPlayer);$('hsEditForm')?.addEventListener('submit',savePlayer);$('hsRemove')?.addEventListener('click',removePlayer);$('hsReportForm')?.addEventListener('submit',saveReport);$('hsInviteForm')?.addEventListener('submit',saveInvite);
  }
  bind();window.addEventListener('vvhl-auth-change',()=>setTimeout(load,0));if(state().user)setTimeout(load,200);
})();