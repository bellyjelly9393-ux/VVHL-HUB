(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const S={pool:[],reports:[],externalReports:[],preScout:[],autoReports:[],bids:[],intel:[],history:[],invites:[],selected:null,role:null,loading:false,page:1,pageSize:100,scope:'focus',sort:'price_high',realtime:null,reloadTimer:null,poller:null};
  const db=()=>window.VVHLBackend?.db;
  const state=()=>window.VVHLBackend?.state||{};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const val=id=>$(id)?.value??'';
  const n=v=>v===''||v==null?null:Number(v);
  const money=v=>v==null?'—':'$'+Number(v).toLocaleString();
  const role=()=>{
    if(String(state().profile?.role||'').toLowerCase()==='admin')return'admin';
    return (state().memberships||[]).find(m=>m.team_id===TEAM_ID&&m.active!==false&&['owner','gm','agm','scout'].includes(String(m.role||'').toLowerCase()))?.role||null;
  };
  function allowed(){S.role=role();return !!S.role;}
  function canBidWrite(){return ['admin','owner','gm','agm'].includes(String(S.role||role()||'').toLowerCase());}
  function msg(id,text){if($(id))$(id).textContent=text||'';}
  function activate(name){document.querySelectorAll('[data-hs-tab]').forEach(x=>x.classList.toggle('active',x.dataset.hsTab===name));document.querySelectorAll('[data-hs-pane]').forEach(x=>x.classList.toggle('active',x.dataset.hsPane===name));}
  function scheduleSharedReload(){
    clearTimeout(S.reloadTimer);
    S.reloadTimer=setTimeout(()=>{if(state().user&&!S.loading)load();},350);
  }
  function ensureRealtime(){
    if(!S.realtime&&db()?.channel){
      S.realtime=db().channel('hitmen-shared-management-'+TEAM_ID)
        .on('postgres_changes',{event:'*',schema:'public',table:'team_bid_board',filter:`team_id=eq.${TEAM_ID}`},scheduleSharedReload)
        .on('postgres_changes',{event:'*',schema:'public',table:'team_scouting_pool',filter:`team_id=eq.${TEAM_ID}`},scheduleSharedReload)
        .subscribe();
    }
    if(!S.poller)S.poller=setInterval(()=>{if(document.visibilityState==='visible'&&state().user&&!S.loading)load();},30000);
  }

  async function claimInvite(){if(!state().user)return;try{await db().rpc('claim_my_team_invite');}catch(e){console.warn(e);}}

  async function fetchFullPool(){
    const all=[]; const batch=1000;
    for(let from=0;;from+=batch){
      const r=await db().from('team_scouting_pool')
        .select('id,scouting_player_id,status,priority,fit_grade,projected_role,target_bid,max_bid,management_note,market_status,market_league,market_team,market_price,market_source,market_updated_at,is_biddable,market_focus,market_details,market_import_batch,market_scope,updated_at,scouting_players(id,gamertag,platform,primary_position)')
        .eq('team_id',TEAM_ID)
        .range(from,from+batch-1);
      if(r.error)return r;
      all.push(...(r.data||[]));
      if((r.data||[]).length<batch)break;
    }
    return {data:all,error:null};
  }

  async function fetchFullPreScout(){
    const all=[]; const batch=1000;
    for(let from=0;;from+=batch){
      const r=await db().from('team_pre_scout_reports')
        .select('id,scouting_player_id,data_status,confidence,archetype,summary,career_snapshot,market_snapshot,generated_at,updated_at')
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
        db().from('team_external_scouting_reports').select('id,scouting_player_id,source,source_report_id,report_type,author_label,report_title,summary,strengths,concerns,recommendation,grades,tags,raw_payload,imported_at').eq('team_id',TEAM_ID).order('imported_at',{ascending:false}),
        fetchFullPreScout(),
        db().from('scouting_auto_reports').select('id,scouting_player_id,season,report_version,archetype,strengths,risks,development_focus,summary,stats_snapshot,generated_at').order('generated_at',{ascending:false}),
        db().from('team_player_league_history').select('id,scouting_player_id,source_player_uid,season,league,league_id,team_name,position,phase,stats,imported_at').eq('team_id',TEAM_ID).in('season',[53,54]).in('league',['CHL','NCAA','ECHL']).order('season',{ascending:false})
      ];
      if(S.role==='admin')queries.push(db().from('team_access_invites').select('id,email,role,display_name,active,claimed_by,claimed_at,created_at').eq('team_id',TEAM_ID).order('created_at',{ascending:false}));
      const r=await Promise.all(queries);const err=r.find(x=>x.error)?.error;if(err)throw err;
      S.pool=r[0].data||[];S.reports=r[1].data||[];S.bids=r[2].data||[];S.intel=r[3].data||[];S.externalReports=r[4].data||[];S.preScout=r[5].data||[];S.autoReports=r[6].data||[];S.history=r[7].data||[];S.invites=r[8]?.data||[];
      if(hasFocusMarket())S.scope='focus';
      else if(hasLiveMarket()&&S.scope==='focus')S.scope='bidable';
      else if(S.scope==='focus')S.scope='experienced';
      render();
      ensureRealtime();
    }catch(e){console.error(e);msg('hsStatus',e.message||'Could not load scouting desk.');}
    finally{S.loading=false;}
  }

  function render(){
    if($('hsRole'))$('hsRole').textContent=S.role==='admin'?'WILDMAN ADMIN':`HITMEN ${String(S.role).toUpperCase()}`;
    if($('hsScouted'))$('hsScouted').textContent=(hasFocusMarket()?S.pool.filter(x=>x.market_focus===true).length:S.pool.length).toLocaleString();
    if($('hsPriority'))$('hsPriority').textContent=S.pool.filter(x=>x.status==='priority'||x.priority===1).length;
    if($('hsBids'))$('hsBids').textContent=new Set([...S.pool.filter(x=>x.status==='bid_target').map(x=>x.scouting_player_id),...S.bids.filter(x=>['target','active_bid'].includes(x.status)).map(x=>x.scouting_player_id)]).size;
    const totalReports=S.reports.length+S.externalReports.length+S.preScout.length+S.autoReports.length;
    if($('hsReports'))$('hsReports').textContent=totalReports;
    if($('hitmenReportCount'))$('hitmenReportCount').textContent=totalReports;
    renderTargets();renderPool();renderReportSelect();renderReports();renderBids();renderInvites();
    if($('hsBidAddForm')){
      const writable=canBidWrite();
      $('hsBidAddForm').querySelectorAll('input,select,button').forEach(el=>el.disabled=!writable);
      if(!writable)msg('hsBidAddMsg','Bidding changes are read-only for this role.');
    }
  }

  function targetRows(){
    return S.pool.filter(r=>['watch','priority','bid_target'].includes(r.status)||Number(r.priority||9)<=2)
      .sort((a,b)=>{
        const rank=x=>x.status==='bid_target'?0:x.status==='priority'?1:x.status==='watch'?2:3;
        return rank(a)-rank(b)||(Number(a.priority||9)-Number(b.priority||9))||String(a.scouting_players?.gamertag||'').localeCompare(String(b.scouting_players?.gamertag||''));
      });
  }

  function renderTargets(){
    const rows=targetRows();
    const lanes={
      bid:rows.filter(r=>r.status==='bid_target'),
      priority:rows.filter(r=>r.status!=='bid_target'&&(r.status==='priority'||Number(r.priority||9)<=2)),
      watch:rows.filter(r=>r.status==='watch'&&Number(r.priority||9)>2)
    };
    const used=new Set([...lanes.bid,...lanes.priority,...lanes.watch].map(r=>r.id));
    rows.filter(r=>!used.has(r.id)).forEach(r=>lanes.watch.push(r));
    if($('hsTargetEmpty'))$('hsTargetEmpty').hidden=rows.length!==0;
    const card=r=>{
      const p=r.scouting_players||{};
      const intel=S.intel.find(x=>x.scouting_player_id===r.scouting_player_id);
      const reportCount=S.reports.filter(x=>x.scouting_player_id===r.scouting_player_id).length+S.externalReports.filter(x=>x.scouting_player_id===r.scouting_player_id).length+S.autoReports.filter(x=>x.scouting_player_id===r.scouting_player_id).length;
      const badge=r.status==='bid_target'?'BID':r.status==='priority'?'PRIORITY':'WATCH';
      return `<button type="button" class="hs-target-card" data-hs-target="${r.id}">
        <span class="hs-target-copy"><strong>${esc(p.gamertag||'Unknown')}</strong><small>${esc(p.primary_position||'—')} · ${esc(p.platform||'Platform unconfirmed')}</small><span><b>${esc(badge)}</b> · Fit ${r.fit_grade??'—'} · P${r.priority??'—'} · ${reportCount} report${reportCount===1?'':'s'}</span></span>
        <span class="hs-target-meta"><b>${intel?mval(intel.fair_value_m):money(r.target_bid)}</b><small>${intel?'Fair value':'Target'}</small></span>
      </button>`;
    };
    [['hsTargetBidLane','hsTargetBidCount','bid'],['hsTargetPriorityLane','hsTargetPriorityCount','priority'],['hsTargetWatchLane','hsTargetWatchCount','watch']].forEach(([boxId,countId,key])=>{
      const box=$(boxId);if(!box)return;
      box.innerHTML=lanes[key].map(card).join('')||'<div class="hs-lane-empty">None</div>';
      if($(countId))$(countId).textContent=lanes[key].length;
      box.querySelectorAll('[data-hs-target]').forEach(b=>b.onclick=()=>{activate('pool');select(b.dataset.hsTarget);setTimeout(()=>$('hsEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),50);});
    });
  }

  function intelFor(r){return S.intel.find(x=>x.scouting_player_id===r.scouting_player_id)||null;}
  function preScoutFor(r){return S.preScout.find(x=>x.scouting_player_id===r.scouting_player_id)||null;}
  function externalFor(r){return S.externalReports.find(x=>x.scouting_player_id===r.scouting_player_id)||null;}
  function pickNum(...vals){for(const v of vals){const z=Number(v);if(v!==''&&v!=null&&Number.isFinite(z))return z;}return null;}
  function latestCareer(x){
    const rows=Array.isArray(x?.career)?x.career:[];
    return rows.slice().sort((a,b)=>Number(b.season||0)-Number(a.season||0))[0]||{};
  }
  function careerFor(r){
    const x=intelFor(r),ps=preScoutFor(r),ext=externalFor(r),raw=ext?.raw_payload||{};
    const rows=Array.isArray(x?.career)&&x.career.length?x.career:
      Array.isArray(ps?.career_snapshot?.league_history)&&ps.career_snapshot.league_history.length?ps.career_snapshot.league_history:
      Array.isArray(raw?.career)&&raw.career.length?raw.career:
      recentHistoryFor(r).map(h=>({season:h.season,league:h.league,team:h.team_name,pos:h.position,...(h.stats||{})}));
    return rows.slice().sort((a,b)=>Number(b.season||0)-Number(a.season||0))[0]||{};
  }
  function marketData(r){
    const x=intelFor(r),ps=preScoutFor(r),ext=externalFor(r),pm=ps?.market_snapshot||{},raw=ext?.raw_payload||{},md=r.market_details||{};
    const fair=pickNum(x?.fair_value_m,md.model_value!=null?Number(md.model_value)/1e6:null,pm.fair_value_m,pm.fair_value,raw.fair_value_m,raw.fair_value);
    const likely=pickNum(x?.likely_price_m,md.display_price!=null?Number(md.display_price)/1e6:null,r.market_price!=null?Number(r.market_price)/1e6:null,pm.likely_price_m,pm.expected_market_m,raw.likely_price_m,raw.expected_market_m,r.target_bid!=null?Number(r.target_bid)/1e6:null);
    const walk=pickNum(x?.walk_above_m,pm.walk_above_m,pm.walk_m,raw.walk_above_m,raw.walk_m,r.max_bid!=null?Number(r.max_bid)/1e6:null);
    return {x,ps,ext,fair,likely,walk};
  }
  function marketTier(fair,likely,walk){
    if(likely==null&&fair==null)return {key:'unknown',label:'NO PRICE'};
    const v=likely??fair,base=fair??v;
    const ratio=base>0?v/base:1;
    if(ratio<=.75)return {key:'steal',label:'STEAL'};
    if(ratio<=.90)return {key:'strong',label:'STRONG'};
    if(ratio<=1.03)return {key:'good',label:'GOOD'};
    if(ratio<=1.15)return {key:'fair',label:'FAIR'};
    if(walk!=null&&v>=walk)return {key:'walk',label:'WALK'};
    if(ratio<=1.35)return {key:'premium',label:'PREM'};
    return {key:'over',label:'OVER'};
  }
  function marketPin(fair,likely,walk){
    const v=likely??fair;
    if(v==null)return 50;
    const ceiling=Math.max(walk||0,(fair||v)*1.55,v*1.12,3);
    return Math.max(3,Math.min(97,(v/ceiling)*100));
  }
  function reportCountFor(r){
    return S.reports.filter(x=>x.scouting_player_id===r.scouting_player_id).length+
      S.externalReports.filter(x=>x.scouting_player_id===r.scouting_player_id).length+
      S.preScout.filter(x=>x.scouting_player_id===r.scouting_player_id).length+
      S.autoReports.filter(x=>x.scouting_player_id===r.scouting_player_id).length;
  }
  function isBargain(r){
    const {fair,likely}=marketData(r);
    return fair!=null&&likely!=null&&likely<=fair*.95;
  }
  function isSnake(r){
    return ['bid_target','priority','watch'].includes(r.status)||Number(r.priority||9)<=2;
  }
  function recentHistoryFor(r){
    return S.history.filter(h=>h.scouting_player_id===r.scouting_player_id&&[53,54].includes(Number(h.season))&&['CHL','NCAA','ECHL'].includes(String(h.league||'').toUpperCase()));
  }
  function hasRecentExperience(r){return recentHistoryFor(r).length>0;}
  function experienceLabel(r){
    return recentHistoryFor(r).slice(0,3).map(h=>`S${h.season} ${h.league}${h.team_name?` · ${h.team_name}`:''}${h.position?` (${h.position})`:''}`).join(' · ');
  }
  function hasFocusMarket(){return S.pool.some(r=>r.market_focus===true);}
  function hasLiveMarket(){return S.pool.some(r=>r.is_biddable!==null&&r.is_biddable!==undefined);}
  function scopeMatch(r,scope){
    if(scope==='archive')return r.market_focus!==true;
    if(scope==='focus')return r.market_focus===true;
    if(scope==='experienced')return hasRecentExperience(r);
    if(scope==='bargains')return isBargain(r);
    if(scope==='snake')return isSnake(r);
    if(scope==='bidable'&&hasLiveMarket())return r.is_biddable===true;
    return !['signed','lost','pass'].includes(r.status);
  }
  function positionMatch(playerPos,filter){
    const p=String(playerPos||'').toUpperCase();
    if(!filter)return true;
    if(filter==='F')return ['LW','C','RW'].includes(p);
    if(filter==='D')return ['LD','RD'].includes(p);
    return p===filter;
  }
  function marketSortValue(r){
    const {fair,likely}=marketData(r);
    return likely??fair??(r.target_bid!=null?Number(r.target_bid)/1e6:-1);
  }

  function renderPool(){
    const box=$('hsPoolBody');if(!box)return;
    const q=val('hsSearch').trim().toLowerCase();
    const pos=val('hsPositionFilter');
    const status=val('hsStatusFilter');

    const everybody=S.pool;
    const focus=everybody.filter(r=>r.market_focus===true);
    const archive=everybody.filter(r=>r.market_focus!==true);
    const experienced=everybody.filter(hasRecentExperience);
    const bidable=everybody.filter(r=>scopeMatch(r,'bidable'));
    const bargains=everybody.filter(isBargain);
    const snake=everybody.filter(isSnake);
    if($('hsScopeFocus'))$('hsScopeFocus').textContent=focus.length.toLocaleString();
    if($('hsScopeExperienced'))$('hsScopeExperienced').textContent=experienced.length.toLocaleString();
    if($('hsScopeBidable'))$('hsScopeBidable').textContent=bidable.length.toLocaleString();
    if($('hsScopeArchive'))$('hsScopeArchive').textContent=archive.length.toLocaleString();
    if($('hsScopeBargains'))$('hsScopeBargains').textContent=bargains.length.toLocaleString();
    if($('hsScopeSnake'))$('hsScopeSnake').textContent=snake.length.toLocaleString();

    let rows=S.pool.filter(r=>{
      const p=r.scouting_players||{};
      const x=intelFor(r);
      const historyText=experienceLabel(r);
      const md=r.market_details||{};
      const matchesText=!q||[p.gamertag,p.primary_position,p.platform,r.status,r.projected_role,x?.player_name,x?.role_chip,x?.role_band,x?.projected_rank,historyText,md.server,md.role,md.market_tier,md.projection,md.aka].some(v=>String(v||'').toLowerCase().includes(q));
      const matchesPos=positionMatch(p.primary_position,pos);
      const matchesStatus=!status||r.status===status;
      return matchesText&&matchesPos&&matchesStatus&&scopeMatch(r,S.scope);
    });

    rows.sort((a,b)=>{
      if(S.sort==='name')return String(a.scouting_players?.gamertag||'').localeCompare(String(b.scouting_players?.gamertag||''),undefined,{sensitivity:'base'});
      if(S.sort==='priority')return Number(a.priority||99)-Number(b.priority||99)||String(a.scouting_players?.gamertag||'').localeCompare(String(b.scouting_players?.gamertag||''));
      if(S.sort==='fit')return Number(b.fit_grade||-1)-Number(a.fit_grade||-1)||marketSortValue(b)-marketSortValue(a);
      if(S.sort==='price_low')return marketSortValue(a)-marketSortValue(b);
      return marketSortValue(b)-marketSortValue(a);
    });

    const pages=Math.max(1,Math.ceil(rows.length/S.pageSize));
    if(S.page>pages)S.page=pages;
    const from=(S.page-1)*S.pageSize;
    const shown=rows.slice(from,from+S.pageSize);

    box.innerHTML=shown.map(r=>{
      const p=r.scouting_players||{},current=r.status||'unscouted';
      const {x,ps,ext,fair,likely,walk}=marketData(r);
      const md=r.market_details||{};
      const computedTier=marketTier(fair,likely,walk);
      const importedTier=String(md.market_tier||'').toLowerCase();
      const tier=importedTier?{key:importedTier==='league_min'?'good':importedTier,label:importedTier.replaceAll('_',' ')}:computedTier;
      const career=careerFor(r);
      const reports=reportCountFor(r);
      const rank=x?.pool_rank!=null?(x.pool_n!=null?`#${x.pool_rank} / ${x.pool_n}`:`#${x.pool_rank}`):(md.rank!=null?`#${md.rank} / ${md.rank_pool||'—'} ${md.rank_group||''}`:(x?.projected_rank||(ps?.market_snapshot?.impact_rank!=null?`#${ps.market_snapshot.impact_rank} / ${ps.market_snapshot.impact_pool||'—'}`:'—')));
      const role=x?.role_chip||x?.role_band||md.role||ps?.market_snapshot?.role||ps?.archetype||r.projected_role||'Role unconfirmed';
      const price=likely!=null?`${likely.toFixed(likely<10?2:1).replace(/\\.00$/,'')}M`:(r.target_bid!=null?`${(Number(r.target_bid)/1e6).toFixed(2)}M`:'—');
      const fairLabel=fair!=null?`${fair.toFixed(fair<10?2:1).replace(/\\.00$/,'')}M fair`:'No fair value';
      const gp=career.gp??md.gp??'—',pts=career.pts??career.points??'—',ppg=career.ppg??md.ppg??'—';
      const qb=(s,label)=>`<button type="button" class="hs-quick-btn ${current===s?'active':''}" data-hs-row-quick="${s}" data-hs-row-id="${r.id}">${label}</button>`;
      const focusTag=r.market_focus===true?('<span class="hs-tag">CHELSCOUT FOCUS'+(md.reach_pct!=null?' · '+esc(md.reach_pct)+'% REACH':'')+'</span>'):'';
      const liveMarket=r.is_biddable===true?'<span class="hs-tag">CONFIRMED BIDABLE</span>':'';
      return `<article class="hs-player-card tier-${tier.key}" data-hs-player="${r.id}">
        <div class="hs-player-card-head">
          <button class="hs-player-name" type="button">${esc(p.gamertag||'Unknown')}</button>
          <span class="hs-position-badge">${esc(p.primary_position||'—')}</span>
          <span class="hs-player-role">${esc(role)}</span>
          <span class="hs-player-price"><b>$${esc(price)}</b><small>${esc(fairLabel)}</small></span>
        </div>
        <div class="hs-player-subline">
          <span>${esc(gp)} GP</span><span>${esc(pts)} PTS</span><span>${esc(ppg)} PPG</span>
          <span>${esc(x?.confidence||x?.reliability||md.confidence||ps?.confidence||'SCOUTING OPEN')}</span>
          ${md.server?'<span>'+esc(md.server)+' server</span>':''}
          ${md.projection?'<span>↑ '+esc(md.projection)+'</span>':''}
        </div>
        ${hasRecentExperience(r)?`<div class="hs-player-history"><b>RECENT EXPERIENCE</b><span>${esc(experienceLabel(r))}</span></div>`:''}
        <div class="hs-player-rankline"><b>CHL · S55</b><span>${esc(rank)}</span><span>${reports} report${reports===1?'':'s'}</span><span>Fit ${r.fit_grade??'—'}</span></div>
        <div class="hs-card-market">
          <div class="hs-market-labels"><span>STEAL</span><span>STRONG</span><span>GOOD</span><span>FAIR</span><span>PREM</span><span>OVER</span><span>WALK</span></div>
          <div class="hs-card-market-bar"><i style="left:${marketPin(fair,likely,walk)}%"></i></div>
          <div class="hs-card-market-foot"><strong>${tier.label}</strong><span>${walk!=null?`walk ${walk.toFixed(walk<10?2:1)}M`:'Calgary plan'}</span></div>
        </div>
        <div class="hs-player-actions"><span class="hs-tag">${esc(current.replaceAll('_',' '))}</span>${focusTag}${liveMarket}<div class="hs-quick-actions">${qb('bid_target','Target')}${qb('watch','Watch')}${qb('pass','Pass')}</div></div>
      </article>`;
    }).join('');

    if($('hsPoolEmpty'))$('hsPoolEmpty').hidden=rows.length!==0;
    if($('hsPoolMeta'))$('hsPoolMeta').textContent=rows.length?`Showing ${from+1}-${Math.min(from+shown.length,rows.length)} of ${rows.length.toLocaleString()} players · Page ${S.page}/${pages}`:'No matching players';
    if($('hsPrevPage'))$('hsPrevPage').disabled=S.page<=1;
    if($('hsNextPage'))$('hsNextPage').disabled=S.page>=pages;

    document.querySelectorAll('[data-hs-player]').forEach(card=>card.onclick=()=>select(card.dataset.hsPlayer));
    document.querySelectorAll('[data-hs-row-quick]').forEach(btn=>btn.onclick=e=>{
      e.preventDefault();e.stopPropagation();
      quickTargetRow(btn.dataset.hsRowId,btn.dataset.hsRowQuick);
    });
  }

  async function quickTargetRow(id,status){
    const r=S.pool.find(x=>x.id===id);if(!r)return;
    const data={status,updated_by:state().user.id,updated_at:new Date().toISOString()};
    if(status==='bid_target'&&r.priority==null)data.priority=1;
    const q=await db().from('team_scouting_pool').update(data).eq('id',r.id);
    if(q.error){msg('hsStatus',q.error.message);return;}
    r.status=status;if(data.priority!=null)r.priority=data.priority;
    const existing=S.bids.find(x=>x.scouting_player_id===r.scouting_player_id);
    if(status==='bid_target')await syncBid(r.scouting_player_id,{...r,...data});
    else if(existing){
      await db().from('team_bid_board').update({status:status==='pass'?'pass':'watch',updated_by:state().user.id,updated_at:new Date().toISOString()}).eq('id',existing.id);
      existing.status=status==='pass'?'pass':'watch';
    }
    render();
    msg('hsStatus',`${r.scouting_players?.gamertag||'Player'} marked ${status.replaceAll('_',' ')} ✓`);
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
    const external=S.externalReports.filter(x=>x.scouting_player_id===pid);
    const autos=S.autoReports.filter(x=>x.scouting_player_id===pid);
    const total=external.length+autos.length;
    if($('hsExternalReportEmpty'))$('hsExternalReportEmpty').hidden=total!==0;
    if($('hsExternalReportMeta'))$('hsExternalReportMeta').textContent=total?(`${total} pre-scout / imported report${total===1?'':'s'}`):'';
    const autoHtml=autos.map(r=>{
      const strengths=Array.isArray(r.strengths)?r.strengths:[];
      const risks=Array.isArray(r.risks)?r.risks:[];
      const focus=Array.isArray(r.development_focus)?r.development_focus:[];
      return `<article class="hs-report external"><div class="hs-card-head"><div><b>${esc(r.archetype||'Historical pre-scout')}</b><br><small>${esc(r.season||'Historical sample')} · generated ${new Date(r.generated_at).toLocaleString()}</small></div><span class="hs-tag">PRE-SCOUT</span></div>
        ${r.summary?`<p>${esc(r.summary)}</p>`:''}
        ${strengths.length?`<p><b>Signals:</b> ${strengths.map(esc).join(' · ')}</p>`:''}
        ${risks.length?`<p><b>Risks:</b> ${risks.map(esc).join(' · ')}</p>`:''}
        ${focus.length?`<p><b>Verify:</b> ${focus.map(esc).join(' · ')}</p>`:''}
      </article>`;
    }).join('');
    const externalHtml=external.map(r=>`<article class="hs-report external"><div class="hs-card-head"><div><b>${esc(r.report_title||r.report_type||'ChelScout report')}</b><br><small>${esc(r.author_label||'ChelScout')} · ${new Date(r.imported_at).toLocaleString()}</small></div><span class="hs-tag">CHELSCOUT</span></div>
      ${r.recommendation?`<p><b>Recommendation:</b> ${esc(r.recommendation)}</p>`:''}
      ${r.summary?`<p>${esc(r.summary)}</p>`:''}
      ${r.strengths?`<p><b>Strengths:</b> ${esc(r.strengths)}</p>`:''}
      ${r.concerns?`<p><b>Concerns:</b> ${esc(r.concerns)}</p>`:''}
    </article>`).join('');
    box.innerHTML=autoHtml+externalHtml;
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

  async function addBidPlayer(e){
    e.preventDefault();
    if(!canBidWrite()){msg('hsBidAddMsg','Owner, GM or AGM access is required to change the bidding board.');return;}
    const tag=val('hsBidGamertag').trim();if(!tag)return;
    const uid=state().user?.id;if(!uid)return;
    const position=val('hsBidPosition')||null,priority=n(val('hsBidPriority')),target=n(val('hsBidTarget')),max=n(val('hsBidMax')),plan=val('hsBidPlan').trim()||null;
    msg('hsBidAddMsg','Adding to shared board…');
    try{
      let q=await db().from('scouting_players').select('id,gamertag,platform,primary_position').ilike('gamertag',tag).limit(1);
      if(q.error)throw q.error;
      let player=q.data?.[0];
      if(!player){
        q=await db().from('scouting_players').insert({gamertag:tag,primary_position:position,is_returning_player:false,scouting_status:'scouted'}).select('id,gamertag,platform,primary_position').single();
        if(q.error)throw q.error;player=q.data;
      }else if(position&&!player.primary_position){
        const posUpdate=await db().from('scouting_players').update({primary_position:position}).eq('id',player.id);
        if(posUpdate.error)throw posUpdate.error;
      }

      let pool=S.pool.find(x=>x.scouting_player_id===player.id);
      const poolPayload={status:'bid_target',priority,target_bid:target,max_bid:max,projected_role:plan,updated_by:uid,updated_at:new Date().toISOString()};
      if(pool){
        q=await db().from('team_scouting_pool').update(poolPayload).eq('id',pool.id);
      }else{
        q=await db().from('team_scouting_pool').insert({...poolPayload,team_id:TEAM_ID,scouting_player_id:player.id,added_by:uid});
      }
      if(q.error)throw q.error;

      const existingBid=S.bids.find(x=>x.scouting_player_id===player.id);
      const bidPayload={target_price:target,max_price:max,priority,status:'target',plan,note:null,updated_by:uid,updated_at:new Date().toISOString()};
      q=existingBid
        ?await db().from('team_bid_board').update(bidPayload).eq('id',existingBid.id)
        :await db().from('team_bid_board').insert({...bidPayload,team_id:TEAM_ID,scouting_player_id:player.id});
      if(q.error)throw q.error;

      e.target.reset();
      if($('hsBidPriority'))$('hsBidPriority').value='2';
      msg('hsBidAddMsg',`${player.gamertag||tag} added to the shared bidding board ✓`);
      await load();
      activate('bids');
    }catch(err){
      console.error(err);
      msg('hsBidAddMsg',err.message||'Could not add this player to the bidding board.');
    }
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
  function renderBids(){
    if(!$('hsBidBody'))return;
    const map=new Map(S.bids.map(b=>[b.scouting_player_id,b]));
    const rows=S.pool.filter(p=>p.status==='bid_target'||p.target_bid!=null||p.max_bid!=null||map.has(p.scouting_player_id))
      .sort((a,b)=>(Number(map.get(a.scouting_player_id)?.priority??a.priority??9)-Number(map.get(b.scouting_player_id)?.priority??b.priority??9))||String(a.scouting_players?.gamertag||'').localeCompare(String(b.scouting_players?.gamertag||'')));
    const targetTotal=rows.reduce((sum,p)=>sum+Number(map.get(p.scouting_player_id)?.target_price??p.target_bid??0),0);
    const maxTotal=rows.reduce((sum,p)=>sum+Number(map.get(p.scouting_player_id)?.max_price??p.max_bid??0),0);
    if($('hsBidBoardCount'))$('hsBidBoardCount').textContent=rows.length;
    if($('hsBidTargetTotal'))$('hsBidTargetTotal').textContent=money(targetTotal);
    if($('hsBidMaxTotal'))$('hsBidMaxTotal').textContent=money(maxTotal);
    $('hsBidBody').innerHTML=rows.map(p=>{
      const b=map.get(p.scouting_player_id)||{},sp=p.scouting_players||{};
      const status=(b.status||p.status||'watch').replaceAll('_',' ');
      return `<article class="hs-bid-card">
        <div class="hs-bid-card-top">
          <div><strong>${esc(sp.gamertag||'Unknown')}</strong><small>${esc(sp.primary_position||'—')} · Priority ${b.priority??p.priority??'—'}</small></div>
          <span class="hs-tag">${esc(status)}</span>
        </div>
        <div class="hs-bid-money">
          <div><small>Target</small><b>${money(b.target_price??p.target_bid)}</b></div>
          <div><small>Max</small><b>${money(b.max_price??p.max_bid)}</b></div>
        </div>
        <div class="hs-bid-plan"><small>ROLE / PLAN</small><span>${esc(b.plan||p.projected_role||'No role set')}</span></div>
        <div class="hs-bid-actions">
          <button type="button" class="hs-btn" data-hs-open-player="${p.id}">Open Player</button>
          <button type="button" class="hs-btn hs-remove-bid" data-hs-remove-bid="${p.scouting_player_id}">Remove</button>
        </div>
      </article>`;
    }).join('');
    if($('hsBidEmpty'))$('hsBidEmpty').hidden=rows.length!==0;
    document.querySelectorAll('[data-hs-remove-bid]').forEach(btn=>btn.onclick=()=>removeFromBidBoard(btn.dataset.hsRemoveBid));
    document.querySelectorAll('[data-hs-open-player]').forEach(btn=>btn.onclick=()=>{activate('pool');select(btn.dataset.hsOpenPlayer);setTimeout(()=>$('hsEditor')?.scrollIntoView({behavior:'smooth',block:'start'}),50);});
  }

  async function removeFromBidBoard(pid){
    const p=S.pool.find(x=>x.scouting_player_id===pid);if(!p)return;
    const name=p.scouting_players?.gamertag||'this player';
    if(!confirm(`Remove ${name} from the Calgary bidding board? They will stay in scouting as Watch.`))return;
    const bid=S.bids.find(x=>x.scouting_player_id===pid);
    if(bid){
      const del=await db().from('team_bid_board').delete().eq('id',bid.id);
      if(del.error){msg('hsStatus',del.error.message);return;}
    }
    const upd=await db().from('team_scouting_pool').update({
      status:'watch',priority:null,target_bid:null,max_bid:null,updated_by:state().user.id,updated_at:new Date().toISOString()
    }).eq('id',p.id);
    if(upd.error){msg('hsStatus',upd.error.message);return;}
    S.bids=S.bids.filter(x=>x.scouting_player_id!==pid);
    p.status='watch';p.priority=null;p.target_bid=null;p.max_bid=null;
    render();
    msg('hsStatus',`${name} removed from bidding board ✓`);
  }

  async function saveInvite(e){
    e.preventDefault();if(S.role!=='admin')return;msg('hsInviteMsg','Saving…');const email=val('hsInviteEmail').trim().toLowerCase();if(!email)return;
    const data={team_id:TEAM_ID,email,role:val('hsInviteRole'),display_name:val('hsInviteName').trim()||null,active:true,created_by:state().user.id};
    const existing=S.invites.find(x=>String(x.email).toLowerCase()===email);const r=existing?await db().from('team_access_invites').update(data).eq('id',existing.id):await db().from('team_access_invites').insert(data);if(r.error){msg('hsInviteMsg',r.error.message);return;}msg('hsInviteMsg','Access invite saved ✓');e.target.reset();await load();
  }
  function renderInvites(){const box=$('hsAdminAccess');if(!box)return;box.hidden=S.role!=='admin';if(S.role!=='admin')return;$('hsInviteList').innerHTML=S.invites.map(i=>`<div class="hs-invite-row"><span><b>${esc(i.display_name||i.email)}</b><br><small>${esc(i.email)}</small></span><span class="hs-tag">${esc(i.role)}</span><small>${i.claimed_by?'CLAIMED':'WAITING'}</small></div>`).join('')||'<div class="hs-empty">No Hitmen email invites saved yet.</div>';}

  function bind(){
    document.querySelectorAll('[data-hs-tab]').forEach(b=>b.onclick=()=>activate(b.dataset.hsTab));
    const resetPool=()=>{S.page=1;renderPool();};
    $('hsSearch')?.addEventListener('input',resetPool);
    $('hsPositionFilter')?.addEventListener('change',resetPool);
    $('hsStatusFilter')?.addEventListener('change',resetPool);
    $('hsSort')?.addEventListener('change',()=>{S.sort=val('hsSort')||'price_high';resetPool();});
    document.querySelectorAll('[data-hs-position]').forEach(b=>b.addEventListener('click',()=>{
      const value=b.dataset.hsPosition||'';
      if($('hsPositionFilter'))$('hsPositionFilter').value=value;
      document.querySelectorAll('[data-hs-position]').forEach(x=>x.classList.toggle('active',x===b));
      resetPool();
    }));
    document.querySelectorAll('[data-hs-scope]').forEach(b=>b.addEventListener('click',()=>{
      S.scope=b.dataset.hsScope||'focus';
      document.querySelectorAll('[data-hs-scope]').forEach(x=>x.classList.toggle('active',x===b));
      resetPool();
    }));
    $('hsPrevPage')?.addEventListener('click',()=>{if(S.page>1){S.page--;renderPool();}});
    $('hsNextPage')?.addEventListener('click',()=>{S.page++;renderPool();});
    $('hsAddForm')?.addEventListener('submit',addPlayer);$('hsEditForm')?.addEventListener('submit',savePlayer);$('hsRemove')?.addEventListener('click',removePlayer);$('hsChelScoutImport')?.addEventListener('click',importChelScout);$('hsChelScoutReportsImport')?.addEventListener('click',importChelScoutReports);document.querySelectorAll('[data-hs-quick]').forEach(b=>b.addEventListener('click',()=>quickTarget(b.dataset.hsQuick)));$('hsReportForm')?.addEventListener('submit',saveReport);$('hsInviteForm')?.addEventListener('submit',saveInvite);$('hsBidAddForm')?.addEventListener('submit',addBidPlayer);
  }
  bind();
  const requestedTab=new URLSearchParams(location.search).get('tab');
  const initialTab=['pool','targets','reports','bids'].includes(requestedTab)?requestedTab:'pool';
  activate(initialTab);
  if(location.hash==='#hitmen-scouting')setTimeout(()=>document.getElementById('hitmen-scouting')?.scrollIntoView({block:'start'}),250);
  window.addEventListener('vvhl-auth-change',()=>setTimeout(load,0));if(state().user)setTimeout(load,200);
})();