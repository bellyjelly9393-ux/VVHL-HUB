(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const S={pool:[],reports:[],externalReports:[],bids:[],intel:[],invites:[],selected:null,role:null,loading:false,page:1,pageSize:100};
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

  async function fetchFullPool(){
    const all=[]; const batch=1000;
    for(let from=0;;from+=batch){
      const r=await db().from('team_scouting_pool')
        .select('id,scouting_player_id,status,priority,fit_grade,projected_role,target_bid,max_bid,management_note,updated_at,scouting_players(id,gamertag,platform,primary_position)')
        .eq('team_id',TEAM_ID)
        .range(from,from+batch-1);
      if(r.error)return r;
      all.push(...(r.data||[]));
      if((r.data||[]).length<batch)break;
    }
    return {data:all,error:null};
  }

  async function load(){
    if(S.loading||!state().user)return;S.loading=true;
    try{
      await claimInvite();
      if(!allowed()){document.querySelectorAll('[data-hitmen-scouting]').forEach(x=>x.hidden=true);return;}
      document.querySelectorAll('[data-hitmen-scouting]').forEach(x=>x.hidden=false);
      const queries=[
        fetchFullPool(),
        db().from('team_scouting_reports').select('id,scouting_player_id,author_id,overall_grade,offense_grade,defense_grade,hockey_iq_grade,puck_movement_grade,positioning_grade,communication_grade,consistency_grade,strengths,concerns,projected_role,recommendation,notes,created_at,scouting_players(gamertag,primary_position)').eq('team_id',TEAM_ID).order('created_at',{ascending:false}),
        db().from('team_bid_board').select('id,scouting_player_id,target_price,max_price,priority,status,plan,note,updated_at,scouting_players(gamertag,primary_position)').eq('team_id',TEAM_ID).order('priority',{ascending:true,nullsFirst:false}).order('updated_at',{ascending:false}),
        db().from('team_chelscout_intel').select('id,scouting_player_id,chelscout_uid,league_id,season,player_name,signed_position,played_position,role_chip,role_band,projected_rank,pool_rank,pool_n,fair_value_m,likely_price_m,likely_band_m,walk_above_m,availability_label,availability_reaches,reliability,confidence,onice_impact,onice_read,risks,notes,dna,career,comparables,projections,imported_at').eq('team_id',TEAM_ID).order('imported_at',{ascending:false}),
        db().from('team_external_scouting_reports').select('id,scouting_player_id,source,source_report_id,report_type,author_label,report_title,summary,strengths,concerns,recommendation,grades,tags,raw_payload,imported_at').eq('team_id',TEAM_ID).order('imported_at',{ascending:false})
      ];
      if(S.role==='admin')queries.push(db().from('team_access_invites').select('id,email,role,display_name,active,claimed_by,claimed_at,created_at').eq('team_id',TEAM_ID).order('created_at',{ascending:false}));
      const r=await Promise.all(queries);const err=r.find(x=>x.error)?.error;if(err)throw err;
      S.pool=r[0].data||[];S.reports=r[1].data||[];S.bids=r[2].data||[];S.intel=r[3].data||[];S.externalReports=r[4].data||[];S.invites=r[5]?.data||[];render();
    }catch(e){console.error(e);msg('hsStatus',e.message||'Could not load scouting desk.');}
    finally{S.loading=false;}
  }

  function render(){
    if($('hsRole'))$('hsRole').textContent=S.role==='admin'?'WILDMAN ADMIN':`HITMEN ${String(S.role).toUpperCase()}`;
    if($('hsScouted'))$('hsScouted').textContent=S.pool.length;
    if($('hsPriority'))$('hsPriority').textContent=S.pool.filter(x=>x.status==='priority'||x.priority===1).length;
    if($('hsBids'))$('hsBids').textContent=S.pool.filter(x=>x.status==='bid_target').length+S.bids.filter(x=>['target','active_bid'].includes(x.status)).length;
    const totalReports=S.reports.length+S.externalReports.length;
    if($('hsReports'))$('hsReports').textContent=totalReports;
    if($('hitmenReportCount'))$('hitmenReportCount').textContent=totalReports;
    renderTargets();renderPool();renderReportSelect();renderReports();renderBids();renderInvites();
  }

  function targetRows(){
    return S.pool.filter(r=>['watch','priority','bid_target'].includes(r.status)||Number(r.priority||9)<=2)
      .sort((a,b)=>{
        const rank=x=>x.status==='bid_target'?0:x.status==='priority'?1:x.status==='watch'?2:3;
        return rank(a)-rank(b)||(Number(a.priority||9)-Number(b.priority||9))||String(a.scouting_players?.gamertag||'').localeCompare(String(b.scouting_players?.gamertag||''));
      });
  }

  function renderTargets(){
    const box=$('hsTargetBoard');if(!box)return;
    const rows=targetRows();
    if($('hsTargetEmpty'))$('hsTargetEmpty').hidden=rows.length!==0;
    box.innerHTML=rows.map(r=>{
      const p=r.scouting_players||{};
      const intel=S.intel.find(x=>x.scouting_player_id===r.scouting_player_id);
      const reportCount=S.reports.filter(x=>x.scouting_player_id===r.scouting_player_id).length+S.externalReports.filter(x=>x.scouting_player_id===r.scouting_player_id).length;
      const badge=r.status==='bid_target'?'BID TARGET':r.status==='priority'?'PRIORITY':'WATCH';
      return `<button type="button" class="hs-target-card" data-hs-target="${r.id}">
        <span class="hs-target-jersey">🏒</span>
        <span class="hs-target-copy"><strong>${esc(p.gamertag||'Unknown')}</strong><small>${esc(p.primary_position||'—')} · ${esc(p.platform||'Platform unconfirmed')}</small><span><b>${esc(badge)}</b> · Fit ${r.fit_grade??'—'} · Priority ${r.priority??'—'}</span></span>
        <span class="hs-target-meta"><small>${reportCount} reports</small><b>${intel?mval(intel.fair_value_m):money(r.target_bid)}</b><small>${intel?'ChelScout FV':'Target'}</small></span>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-hs-target]').forEach(b=>b.onclick=()=>{activate('pool');select(b.dataset.hsTarget);setTimeout(()=>$('hsEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),50);});
  }

  function renderPool(){
    if(!$('hsPoolBody'))return;
    const q=val('hsSearch').trim().toLowerCase();
    const pos=val('hsPositionFilter');
    const status=val('hsStatusFilter');
    let rows=S.pool.filter(r=>{
      const p=r.scouting_players||{};
      const matchesText=!q||[p.gamertag,p.primary_position,p.platform,r.status,r.projected_role].some(v=>String(v||'').toLowerCase().includes(q));
      const matchesPos=!pos||String(p.primary_position||'').toUpperCase()===pos;
      const matchesStatus=!status||r.status===status;
      return matchesText&&matchesPos&&matchesStatus;
    });
    rows.sort((a,b)=>String(a.scouting_players?.gamertag||'').localeCompare(String(b.scouting_players?.gamertag||''),undefined,{sensitivity:'base'}));
    const pages=Math.max(1,Math.ceil(rows.length/S.pageSize));
    if(S.page>pages)S.page=pages;
    const from=(S.page-1)*S.pageSize;
    const shown=rows.slice(from,from+S.pageSize);
    $('hsPoolBody').innerHTML=shown.map(r=>{const p=r.scouting_players||{};return `<tr data-hs-player="${r.id}"><td><b>${esc(p.gamertag||'Unknown')}</b><br><small>${esc(p.platform||'')}</small></td><td>${esc(p.primary_position||'—')}</td><td><span class="hs-tag">${esc((r.status||'unscouted').replaceAll('_',' '))}</span></td><td>${r.priority??'—'}</td><td>${r.fit_grade??'—'}</td><td>${money(r.target_bid)}</td><td>${money(r.max_bid)}</td></tr>`}).join('');
    if($('hsPoolEmpty'))$('hsPoolEmpty').hidden=rows.length!==0;
    if($('hsPoolMeta'))$('hsPoolMeta').textContent=rows.length?`Showing ${from+1}-${Math.min(from+shown.length,rows.length)} of ${rows.length.toLocaleString()} players · Page ${S.page}/${pages}`:'No matching players';
    if($('hsPrevPage'))$('hsPrevPage').disabled=S.page<=1;
    if($('hsNextPage'))$('hsNextPage').disabled=S.page>=pages;
    document.querySelectorAll('[data-hs-player]').forEach(tr=>tr.onclick=()=>select(tr.dataset.hsPlayer));
  }

  function select(id){
    S.selected=id;const r=S.pool.find(x=>x.id===id);if(!r)return;const p=r.scouting_players||{};
    $('hsEditor').hidden=false;$('hsSelectedName').textContent=p.gamertag||'Player';$('hsSelectedMeta').textContent=[p.primary_position,p.platform].filter(Boolean).join(' · ');
    $('hsStatusEdit').value=r.status||'scouted';$('hsPriorityEdit').value=r.priority??'';$('hsFitEdit').value=r.fit_grade??'';$('hsRoleEdit').value=r.projected_role||'';$('hsTargetBid').value=r.target_bid??'';$('hsMaxBid').value=r.max_bid??'';$('hsMgmtNote').value=r.management_note||'';
    if($('hsReportPlayer'))$('hsReportPlayer').value=r.scouting_player_id;
    renderIntel(r.scouting_player_id);
    renderExternalReports(r.scouting_player_id);
  }

  const mval=v=>v==null?'—':`${Number(v).toFixed(2)}M`;
  function renderIntel(pid){
    const box=$('hsIntelView');if(!box)return;
    const x=S.intel.find(i=>i.scouting_player_id===pid);
    if(!x){box.className='hs-empty';box.innerHTML='No ChelScout intelligence imported for this player yet.';if($('hsIntelMeta'))$('hsIntelMeta').textContent='';return;}
    box.className='';
    if($('hsIntelMeta'))$('hsIntelMeta').textContent=`UID ${x.chelscout_uid} · S${x.season||'—'} · imported ${new Date(x.imported_at).toLocaleString()}`;
    const risks=Array.isArray(x.risks)?x.risks:[];
    const notes=Array.isArray(x.notes)?x.notes:[];
    const career=Array.isArray(x.career)?x.career:[];
    const spokes=Array.isArray(x.dna?.spokes)?x.dna.spokes:[];
    box.innerHTML=`<div class="hs-report"><div class="hs-grades"><div class="hs-grade"><small>Role</small><b>${esc(x.role_chip||x.role_band||'—')}</b></div><div class="hs-grade"><small>Fair Value</small><b>${mval(x.fair_value_m)}</b></div><div class="hs-grade"><small>Likely Bid</small><b>${mval(x.likely_price_m)}</b></div><div class="hs-grade"><small>Walk Above</small><b>${mval(x.walk_above_m)}</b></div></div>
      <p><b>Availability:</b> ${esc(x.availability_label||'—')}${x.availability_reaches!=null?` · ${Math.round(Number(x.availability_reaches)*100)}% reaches CHL`:''}</p>
      <p><b>Confidence:</b> ${esc(x.confidence||x.reliability||'—')} · <b>Projected rank:</b> ${esc(x.projected_rank||'—')} · <b>On-ice:</b> ${esc(x.onice_read||'—')}${x.onice_impact!=null?` (${Number(x.onice_impact).toFixed(3)})`:''}</p>
      ${risks.length?`<p><b>Risks:</b> ${risks.map(esc).join(' · ')}</p>`:''}${notes.length?`<p><b>Profile:</b> ${notes.map(esc).join(' · ')}</p>`:''}
      ${spokes.length?`<p><b>DNA:</b> ${spokes.map(s=>`${esc(s.label)} ${Math.round(Number(s.fill||0)*100)}`).join(' · ')}</p>`:''}
      ${career.length?`<p><b>Career:</b> ${career.slice(0,4).map(s=>`S${esc(s.season)} ${esc(s.league)} ${esc(s.pos)} · ${esc(s.gp)} GP · ${esc(s.pts)} PTS · ${esc(s.ppg)} PPG`).join('<br>')}</p>`:''}</div>`;
  }

  async function importChelScout(){
    const r=S.pool.find(x=>x.id===S.selected);if(!r){msg('hsChelScoutMsg','Select a player first.');return;}
    const raw=val('hsChelScoutJson').trim();if(!raw){msg('hsChelScoutMsg','Paste the ChelScout JSON response first.');return;}
    let j;try{j=JSON.parse(raw);}catch(e){msg('hsChelScoutMsg','That is not valid JSON.');return;}
    const uid=Number(j.uid);if(!uid){msg('hsChelScoutMsg','ChelScout UID is missing from this payload.');return;}
    const target=j.fv_by_league_x?.['39']||j.fv_by_league?.['39']||{};
    const names=Array.isArray(j.name_history)?j.name_history:[];
    const pname=j.current_name||names[names.length-1]?.name||r.scouting_players?.gamertag||null;
    const payload={team_id:TEAM_ID,scouting_player_id:r.scouting_player_id,chelscout_uid:uid,league_id:39,season:target.season||55,player_name:pname,signed_position:j.role?.group||j.dna?.signed_group||null,played_position:j.onice?.position||j.expect?.pos||null,role_chip:j.role?.chip||null,role_band:j.role?.band||null,projected_rank:j.role?.proj||target?.projected_rank||null,pool_rank:j.role?.pool_rank??null,pool_n:j.role?.pool_n??null,fair_value_m:target.fair_value_M??null,likely_price_m:j.price?.likely_M??null,likely_band_m:j.price?.likely_band_M||[],walk_above_m:target.zones?.walk_above_M??null,availability_label:j.availability?.label||null,availability_reaches:j.availability?.reaches_you??null,reliability:j.crisk?.level||null,confidence:target.confidence||j.crisk?.confidence||null,onice_impact:j.onice?.impact??null,onice_read:j.onice?.read||null,risks:j.plain?.risks||[],notes:j.plain?.notes||[],dna:j.dna_by_league?.['39']||j.dna||{},career:j.career||[],comparables:j.comparables||[],projections:j.expect?.projected?.by_league||{},raw_payload:j,imported_by:state().user.id,updated_at:new Date().toISOString()};
    msg('hsChelScoutMsg','Importing…');
    const q=await db().from('team_chelscout_intel').upsert(payload,{onConflict:'team_id,chelscout_uid,season'}).select('id').single();
    if(q.error){msg('hsChelScoutMsg',q.error.message);return;}
    msg('hsChelScoutMsg','ChelScout intelligence imported ✓');$('hsChelScoutJson').value='';await load();select(r.id);
  }

  function textish(v){
    if(v==null)return null;
    if(Array.isArray(v))return v.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' · ');
    if(typeof v==='object')return JSON.stringify(v);
    return String(v);
  }

  function reportListFromPayload(j){
    if(Array.isArray(j))return j;
    if(Array.isArray(j?.reports))return j.reports;
    if(Array.isArray(j?.data))return j.data;
    return j&&typeof j==='object'?[j]:[];
  }

  function renderExternalReports(pid){
    const box=$('hsExternalReports');if(!box)return;
    const rows=S.externalReports.filter(x=>x.scouting_player_id===pid);
    if($('hsExternalReportEmpty'))$('hsExternalReportEmpty').hidden=rows.length!==0;
    if($('hsExternalReportMeta'))$('hsExternalReportMeta').textContent=rows.length?`${rows.length} imported ChelScout report${rows.length===1?'':'s'}`:'';
    box.innerHTML=rows.map(r=>`<article class="hs-report external"><div class="hs-card-head"><div><b>${esc(r.report_title||r.report_type||'ChelScout report')}</b><br><small>${esc(r.author_label||'ChelScout')} · ${new Date(r.imported_at).toLocaleString()}</small></div><span class="hs-tag">CHELSCOUT</span></div>
      ${r.recommendation?`<p><b>Recommendation:</b> ${esc(r.recommendation)}</p>`:''}
      ${r.summary?`<p>${esc(r.summary)}</p>`:''}
      ${r.strengths?`<p><b>Strengths:</b> ${esc(r.strengths)}</p>`:''}
      ${r.concerns?`<p><b>Concerns:</b> ${esc(r.concerns)}</p>`:''}
    </article>`).join('');
  }

  async function importChelScoutReports(){
    const pool=S.pool.find(x=>x.id===S.selected);if(!pool){msg('hsChelScoutReportsMsg','Select a player first.');return;}
    const raw=val('hsChelScoutReportsJson').trim();if(!raw){msg('hsChelScoutReportsMsg','Paste the ChelScout report JSON first.');return;}
    let payload;try{payload=JSON.parse(raw);}catch{msg('hsChelScoutReportsMsg','That is not valid JSON.');return;}
    const reports=reportListFromPayload(payload);if(!reports.length){msg('hsChelScoutReportsMsg','No report records were found in that payload.');return;}
    msg('hsChelScoutReportsMsg',`Importing ${reports.length} report${reports.length===1?'':'s'}…`);
    let imported=0;
    for(const row of reports.slice(0,200)){
      const reportId=row.id??row.report_id??row.reportId??row.uuid??null;
      const data={
        team_id:TEAM_ID,scouting_player_id:pool.scouting_player_id,source:'chelscout',
        source_report_id:reportId!=null?String(reportId):null,
        report_type:textish(row.type??row.report_type??row.category),
        author_label:textish(row.author_name??row.author??row.scout??row.created_by),
        report_title:textish(row.title??row.report_title??row.heading) || 'ChelScout scouting report',
        summary:textish(row.summary??row.report??row.scouting_report??row.text??row.notes),
        strengths:textish(row.strengths??row.pros??row.positives),
        concerns:textish(row.concerns??row.cons??row.weaknesses??row.risks),
        recommendation:textish(row.recommendation??row.verdict??row.status),
        grades:(row.grades&&typeof row.grades==='object')?row.grades:((row.ratings&&typeof row.ratings==='object')?row.ratings:{}),
        tags:Array.isArray(row.tags)?row.tags:[],
        raw_payload:row,
        imported_by:state().user.id,
        imported_at:new Date().toISOString(),updated_at:new Date().toISOString()
      };
      let q;
      if(data.source_report_id) q=await db().from('team_external_scouting_reports').upsert(data,{onConflict:'team_id,source,source_report_id'});
      else q=await db().from('team_external_scouting_reports').insert(data);
      if(q.error){msg('hsChelScoutReportsMsg',q.error.message);return;}
      imported++;
    }
    $('hsChelScoutReportsJson').value='';
    msg('hsChelScoutReportsMsg',`Imported ${imported} ChelScout report${imported===1?'':'s'} ✓`);
    await load();select(pool.id);
  }

  async function quickTarget(status){
    const r=S.pool.find(x=>x.id===S.selected);if(!r)return;
    const data={status,updated_by:state().user.id,updated_at:new Date().toISOString()};
    if(status==='priority'&&r.priority==null)data.priority=1;
    const q=await db().from('team_scouting_pool').update(data).eq('id',r.id);
    if(q.error){msg('hsEditMsg',q.error.message);return;}
    if(status==='bid_target')await syncBid(r.scouting_player_id,{...r,...data});
    msg('hsEditMsg',status==='pass'?'Marked pass.':'Target list updated ✓');
    await load();select(r.id);
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
    const resetPool=()=>{S.page=1;renderPool();};
    $('hsSearch')?.addEventListener('input',resetPool);$('hsPositionFilter')?.addEventListener('change',resetPool);$('hsStatusFilter')?.addEventListener('change',resetPool);
    $('hsPrevPage')?.addEventListener('click',()=>{if(S.page>1){S.page--;renderPool();}});$('hsNextPage')?.addEventListener('click',()=>{S.page++;renderPool();});
    $('hsAddForm')?.addEventListener('submit',addPlayer);$('hsEditForm')?.addEventListener('submit',savePlayer);$('hsRemove')?.addEventListener('click',removePlayer);$('hsChelScoutImport')?.addEventListener('click',importChelScout);$('hsChelScoutReportsImport')?.addEventListener('click',importChelScoutReports);document.querySelectorAll('[data-hs-quick]').forEach(b=>b.addEventListener('click',()=>quickTarget(b.dataset.hsQuick)));$('hsReportForm')?.addEventListener('submit',saveReport);$('hsInviteForm')?.addEventListener('submit',saveInvite);
  }
  bind();window.addEventListener('vvhl-auth-change',()=>setTimeout(load,0));if(state().user)setTimeout(load,200);
})();