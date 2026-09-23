(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>v==null?'—':'$'+Number(v).toLocaleString();
  const M={rows:[],events:[],meta:null,filter:'eligible',position:'',sort:'score',search:'',page:1,pageSize:100,busy:false,timer:null,dbTimer:null};

  function role(){
    if(String(auth().profile?.role||'').toLowerCase()==='admin')return'admin';
    return (auth().memberships||[]).find(m=>m.team_id===TEAM_ID&&m.active!==false&&['owner','gm','agm','scout'].includes(String(m.role||'').toLowerCase()))?.role||null;
  }
  const canWrite=()=>['admin','owner','gm','agm'].includes(String(role()||'').toLowerCase());

  function addCss(){
    if(document.querySelector('link[data-hitmen-live-market-css]'))return;
    const l=document.createElement('link');l.rel='stylesheet';l.href='hitmen-live-market.css';l.dataset.hitmenLiveMarketCss='1';document.head.appendChild(l);
  }

  function inject(){
    addCss();
    if($('hsLiveMarket'))return true;
    const pane=document.querySelector('[data-hs-pane="live"]');
    if(!pane)return false;
    const section=document.createElement('section');
    section.id='hsLiveMarket';
    section.className='hs-card hlm-shell';
    section.innerHTML=`
      <div class="hlm-head">
        <div><div class="eyebrow">FULL LIVE PLAYER MARKET</div><h3>Live Bidding Board</h3><p class="hs-msg">Search every player still eligible to be bid on, watch live ECHL movement, and add any player directly to Calgary's shared bidding board.</p></div>
        <div class="hlm-sync"><span id="hlmBadge" class="hs-tag">LOADING</span><button id="hlmSync" class="hs-btn primary" type="button">Refresh Live Market</button></div>
      </div>
      <div class="hlm-meta"><span id="hlmUpdated">No snapshot yet</span><span id="hlmRev"></span><span>Auto-check: 2 min while open</span></div>
      <div class="hlm-kpis">
        <button type="button" data-hlm-filter="eligible"><small>ELIGIBLE PLAYERS</small><strong id="hlmEligible">0</strong></button>
        <button type="button" data-hlm-filter="echl_live"><small>ECHL LIVE BIDS</small><strong id="hlmEchlLive">0</strong></button>
        <button type="button" data-hlm-filter="just_fell"><small>JUST FELL TO CHL</small><strong id="hlmJustFell">0</strong></button>
        <button type="button" data-hlm-filter="chl_live"><small>CHL LIVE BIDS</small><strong id="hlmChlLive">0</strong></button>
      </div>
      <div class="hlm-controls">
        <input id="hlmSearch" class="hs-input" type="search" placeholder="Search every eligible player by gamertag">
        <select id="hlmSort" class="hs-select" aria-label="Sort live market">
          <option value="score">Best market score</option>
          <option value="price_high">Projected price: high to low</option>
          <option value="price_low">Projected price: low to high</option>
          <option value="name">Player name</option>
        </select>
        <div class="hlm-filters">
          <button class="active" data-hlm-filter="eligible" type="button">All Eligible</button>
          <button data-hlm-filter="fall" type="button">Fall Watch</button>
          <button data-hlm-filter="echl_live" type="button">ECHL Live</button>
          <button data-hlm-filter="just_fell" type="button">Just Fell</button>
          <button data-hlm-filter="chl_live" type="button">CHL Live</button>
          <button data-hlm-filter="signed" type="button">Signed / Unavailable</button>
          <button data-hlm-filter="all" type="button">All Source Rows</button>
        </div>
      </div>
      <div class="hlm-position-filters" aria-label="Live market positions">
        <button class="active" type="button" data-hlm-position="">ALL</button>
        <button type="button" data-hlm-position="F">F</button>
        <button type="button" data-hlm-position="D">D</button>
        <button type="button" data-hlm-position="LW">LW</button>
        <button type="button" data-hlm-position="C">C</button>
        <button type="button" data-hlm-position="RW">RW</button>
        <button type="button" data-hlm-position="LD">LD</button>
        <button type="button" data-hlm-position="RD">RD</button>
        <button type="button" data-hlm-position="G">G</button>
      </div>
      <div id="hlmStatus" class="hs-msg"></div>
      <div id="hlmRows" class="hlm-grid"></div>
      <div id="hlmEmpty" class="hs-empty" hidden>No players match this market lane.</div>
      <div class="hlm-paging"><span id="hlmPageMeta">Page 1</span><div><button id="hlmPrev" class="hs-btn" type="button">Previous</button><button id="hlmNext" class="hs-btn" type="button">Next</button></div></div>
      <details class="hlm-feed">
        <summary><span><b>Market Change Feed</b><small>ECHL bid movement, fall-throughs and CHL bid changes</small></span><strong id="hlmEventCount">0</strong></summary>
        <div id="hlmEvents"></div>
      </details>
    `;
    pane.insertBefore(section,pane.firstChild);
    $('hlmSync').onclick=()=>sync(true);
    $('hlmSearch').oninput=e=>{M.search=e.target.value.trim().toLowerCase();M.page=1;renderRows();};
    $('hlmSort').onchange=e=>{M.sort=e.target.value||'score';M.page=1;renderRows();};
    section.querySelectorAll('[data-hlm-filter]').forEach(b=>b.onclick=()=>{M.filter=b.dataset.hlmFilter;M.page=1;section.querySelectorAll('.hlm-filters [data-hlm-filter]').forEach(x=>x.classList.toggle('active',x.dataset.hlmFilter===M.filter));renderRows();});
    section.querySelectorAll('[data-hlm-position]').forEach(b=>b.onclick=()=>{M.position=b.dataset.hlmPosition||'';M.page=1;section.querySelectorAll('[data-hlm-position]').forEach(x=>x.classList.toggle('active',x===b));renderRows();});
    $('hlmPrev').onclick=()=>{if(M.page>1){M.page--;renderRows();}};
    $('hlmNext').onclick=()=>{M.page++;renderRows();};
    return true;
  }

  function statusLabel(s){
    return ({
      echl_live_bid:'ECHL LIVE BID',
      possible_chl_fall:'POSSIBLE CHL FALL',
      echl_history_unsigned:'ECHL HISTORY · UNSIGNED',
      just_fell_to_chl:'JUST FELL TO CHL',
      chl_live_bid:'CHL LIVE BID',
      echl_signed:'WON IN ECHL',
      chl_signed:'SIGNED IN CHL',
      signed_other:'SIGNED / UNAVAILABLE',
      off_auction:'OFF AUCTION',
      available:'AVAILABLE',
      watch:'AVAILABLE'
    })[s]||String(s||'WATCH').replaceAll('_',' ').toUpperCase();
  }
  function statusClass(s){
    if(s==='just_fell_to_chl')return'fall';
    if(s==='echl_live_bid'||s==='chl_live_bid')return'live';
    if(['echl_signed','chl_signed','signed_other','off_auction'].includes(s))return'signed';
    if(s==='possible_chl_fall'||s==='echl_history_unsigned')return'possible';
    return'';
  }
  function roleText(r){
    const role=r.details?.role;
    return role?.view?.chip||role?.chip||role?.band||'Role not set';
  }
  function currentMoney(r){
    if(r.market_status==='echl_live_bid')return {label:'ECHL BID',value:r.bid_amount};
    if(r.market_status==='chl_live_bid')return {label:'CHL BID',value:r.live_chl_bid||r.bid_amount};
    if(r.market_status==='echl_signed'||r.market_status==='chl_signed')return {label:'SIGNED',value:r.contracted_amount};
    return {label:'CHL MODEL',value:r.likely_price};
  }
  function isEligible(r){
    return !['echl_signed','chl_signed'].includes(r.market_status)
      && r.details?.off_auction!==true
      && !Number(r.contracted_league_id||0);
  }
  function matchPosition(r){
    const p=String(r.position||'').toUpperCase();
    if(!M.position)return true;
    if(M.position==='F')return ['LW','C','RW','F'].includes(p);
    if(M.position==='D')return ['LD','RD','D'].includes(p);
    return p===M.position;
  }
  function matchFilter(r){
    if(!matchPosition(r))return false;
    if(M.search&&!String(r.player_name||'').toLowerCase().includes(M.search))return false;
    if(M.filter==='all')return true;
    if(M.filter==='eligible')return isEligible(r);
    if(M.filter==='echl_live')return r.market_status==='echl_live_bid';
    if(M.filter==='just_fell')return r.market_status==='just_fell_to_chl'||M.events.some(e=>e.source_uid===r.source_uid&&e.event_type==='fell_to_chl');
    if(M.filter==='chl_live')return r.market_status==='chl_live_bid';
    if(M.filter==='signed')return !isEligible(r);
    return ['echl_live_bid','possible_chl_fall','echl_history_unsigned','just_fell_to_chl'].includes(r.market_status);
  }

  function render(){
    if(!$('hsLiveMarket'))return;
    const eligible=M.rows.filter(isEligible).length;
    const echl=M.rows.filter(r=>r.market_status==='echl_live_bid').length;
    const just=new Set(M.events.filter(e=>e.event_type==='fell_to_chl').map(e=>e.source_uid)).size;
    const chl=M.rows.filter(r=>r.market_status==='chl_live_bid').length;
    $('hlmEligible').textContent=eligible.toLocaleString();
    $('hlmEchlLive').textContent=echl;
    $('hlmJustFell').textContent=just;
    $('hlmChlLive').textContent=chl;
    $('hlmBadge').textContent=M.meta?.auction_ran?'CHL AUCTION LIVE':'PRE-CHL WATCH';
    $('hlmUpdated').textContent=M.meta?.source_updated_at?'Source '+new Date(M.meta.source_updated_at).toLocaleString():'No source snapshot yet';
    $('hlmRev').textContent=M.meta?.board_rev?'Rev '+M.meta.board_rev:'';
    $('hlmEventCount').textContent=M.events.length;
    $('hlmSync').hidden=!canWrite();
    renderRows();
    renderEvents();
  }

  function renderRows(){
    const box=$('hlmRows');if(!box)return;
    let rows=M.rows.filter(matchFilter);
    rows.sort((a,b)=>{
      if(M.sort==='name')return String(a.player_name).localeCompare(String(b.player_name));
      if(M.sort==='price_high')return Number(b.likely_price||b.bid_amount||0)-Number(a.likely_price||a.bid_amount||0)||String(a.player_name).localeCompare(String(b.player_name));
      if(M.sort==='price_low')return Number(a.likely_price||a.bid_amount||Number.MAX_SAFE_INTEGER)-Number(b.likely_price||b.bid_amount||Number.MAX_SAFE_INTEGER)||String(a.player_name).localeCompare(String(b.player_name));
      const rank=s=>s==='just_fell_to_chl'?0:s==='echl_live_bid'?1:s==='chl_live_bid'?2:s==='possible_chl_fall'?3:s==='echl_history_unsigned'?4:5;
      return rank(a.market_status)-rank(b.market_status)||Number(b.score||0)-Number(a.score||0)||String(a.player_name).localeCompare(String(b.player_name));
    });
    const pages=Math.max(1,Math.ceil(rows.length/M.pageSize));
    if(M.page>pages)M.page=pages;
    const start=(M.page-1)*M.pageSize;
    const shown=rows.slice(start,start+M.pageSize);
    box.innerHTML=shown.map(r=>{
      const cash=currentMoney(r);
      const evt=M.events.find(e=>e.source_uid===r.source_uid&&e.event_type==='fell_to_chl');
      const echlBid=r.bid_league_id===84?r.bid_amount:null;
      return `<article class="hlm-card ${statusClass(r.market_status)}">
        <div class="hlm-card-head">
          <div><strong>${esc(r.player_name)}</strong><small>${esc(r.position||'—')} · ${esc(r.server||'Server ?')} · ${esc(r.console||'Platform ?')}</small></div>
          <span class="hlm-state">${esc(statusLabel(r.market_status))}</span>
        </div>
        <div class="hlm-price-row">
          <div><small>${esc(cash.label)}</small><b>${money(cash.value)}</b></div>
          <div><small>MODEL</small><b>${money(r.likely_price)}</b></div>
          <div><small>SCORE</small><b>${r.score??'—'}</b></div>
        </div>
        <div class="hlm-role"><b>${esc(roleText(r))}</b><span>${esc(String(r.reach||'market').replaceAll('_',' '))}</span>${r.contracted_team?`<span>${esc(r.contracted_team)}</span>`:''}${evt?'<span class="hlm-fell-note">ECHL bid cleared without an ECHL contract</span>':''}</div>
        ${Array.isArray(r.details?.price?.likely_band_M)&&r.details.price.likely_band_M.length>=2?`<div class="hlm-bidline">Projected band <b>${money(Number(r.details.price.likely_band_M[0])*1000000)} – ${money(Number(r.details.price.likely_band_M[1])*1000000)}</b></div>`:''}
        ${r.details?.last?`<div class="hlm-bidline">Last sample <b>${esc([r.details.last.ppg!=null?r.details.last.ppg+' PPG':'',r.details.last.gp!=null?r.details.last.gp+' GP':'',r.details.last.pts!=null?r.details.last.pts+' PTS':'',r.details.last.sv!=null?r.details.last.sv+' SV%':'',r.details.last.gaa!=null?r.details.last.gaa+' GAA':''].filter(Boolean).join(' · ')||'—')}</b></div>`:''}
        ${echlBid!=null?`<div class="hlm-bidline">Current ECHL bid <b>${money(echlBid)}</b></div>`:''}
        <div class="hlm-actions">
          <button type="button" class="hs-btn" data-hlm-open="${esc(r.player_name)}">Open Full Profile</button>
          ${canWrite()&&isEligible(r)?`<button type="button" class="hs-btn" data-hlm-watch="${r.source_uid}">Watch</button><button type="button" class="hs-btn primary" data-hlm-bid="${r.source_uid}">Add to Bidding</button>`:''}
        </div>
      </article>`;
    }).join('');
    $('hlmEmpty').hidden=shown.length!==0;
    if($('hlmPageMeta'))$('hlmPageMeta').textContent=`${rows.length.toLocaleString()} players · Page ${M.page} of ${pages}`;
    if($('hlmPrev'))$('hlmPrev').disabled=M.page<=1;
    if($('hlmNext'))$('hlmNext').disabled=M.page>=pages;
    msg(rows.length?`Showing ${start+1}–${start+shown.length} of ${rows.length.toLocaleString()} matching players.`:'No matching players.');
    box.querySelectorAll('[data-hlm-open]').forEach(b=>b.onclick=()=>openPlayer(b.dataset.hlmOpen));
    box.querySelectorAll('[data-hlm-watch]').forEach(b=>b.onclick=()=>addToCalgary(Number(b.dataset.hlmWatch),false,b));
    box.querySelectorAll('[data-hlm-bid]').forEach(b=>b.onclick=()=>addToCalgary(Number(b.dataset.hlmBid),true,b));
  }

  function renderEvents(){
    const box=$('hlmEvents');if(!box)return;
    const labels={fell_to_chl:'FELL TO CHL',echl_bid_started:'ECHL BID STARTED',echl_bid_changed:'ECHL BID CHANGED',echl_signed:'ECHL SIGNED',chl_bid_changed:'CHL BID CHANGED',chl_signed:'CHL SIGNED'};
    box.innerHTML=M.events.slice(0,30).map(e=>`<div class="hlm-event"><span><b>${esc(labels[e.event_type]||e.event_type.replaceAll('_',' ').toUpperCase())}</b><strong>${esc(e.player_name)}</strong></span><small>${new Date(e.observed_at).toLocaleString()}</small></div>`).join('')||'<div class="hs-empty">No market changes recorded yet. The first snapshot establishes the baseline.</div>';
  }
  function msg(t){if($('hlmStatus'))$('hlmStatus').textContent=t||'';}

  async function loadAllPlayers(){
    const all=[];const batch=1000;
    for(let from=0;;from+=batch){
      const q=await db().from('hitmen_live_market_players').select('*').eq('team_id',TEAM_ID).eq('season',55).order('player_name',{ascending:true}).range(from,from+batch-1);
      if(q.error)throw q.error;
      all.push(...(q.data||[]));
      if((q.data||[]).length<batch)break;
    }
    return all;
  }

  async function load(){
    if(!db()||!auth().user||!role())return;
    try{
      const [players,events,meta]=await Promise.all([
        loadAllPlayers(),
        db().from('hitmen_live_market_events').select('*').eq('team_id',TEAM_ID).eq('season',55).order('observed_at',{ascending:false}).limit(60),
        db().from('hitmen_live_market_meta').select('*').eq('team_id',TEAM_ID).eq('season',55).maybeSingle()
      ]);
      const err=events.error||meta.error;if(err)throw err;
      M.rows=players;M.events=events.data||[];M.meta=meta.data||null;render();
    }catch(e){msg(e.message||'Could not load the full live player market.');}
  }

  async function sync(manual=false){
    if(M.busy||!canWrite()||!db()||!auth().user)return;
    M.busy=true;$('hlmSync')&&($('hlmSync').disabled=true);msg('Checking live bid board…');
    try{
      const res=await fetch('/api/hitmen-live-market',{cache:'no-store',headers:{accept:'application/json'}});
      const body=await res.json();
      if(!res.ok)throw new Error(body.error||'Live market source failed.');
      const rpc=await db().rpc('apply_hitmen_live_market_snapshot',{
        p_team_id:TEAM_ID,
        p_board_rev:body.board_rev||null,
        p_source_updated_at:body.bids_updated||new Date().toISOString(),
        p_auction_ran:body.auction_ran===true,
        p_row_total:Number(body.row_total||0),
        p_rows:body.rows||[]
      });
      if(rpc.error)throw rpc.error;
      await load();
      const x=rpc.data||{};
      msg(x.changed===false?'Market checked. No source changes yet.':`Market synced ✓ ${Number(x.players||0).toLocaleString()} source players · ${M.rows.filter(isEligible).length.toLocaleString()} eligible · ${x.events||0} new change${Number(x.events||0)===1?'':'s'}.`);
    }catch(e){
      console.error(e);
      msg((e.message||'Live refresh failed.')+' Existing shared market snapshot was kept.');
    }finally{
      M.busy=false;if($('hlmSync'))$('hlmSync').disabled=false;
    }
  }

  async function ensurePlayerInScouting(r,status='scouted'){
    const now=new Date().toISOString();
    let q=await db().from('scouting_players').select('id,gamertag,primary_position,platform').ilike('gamertag',r.player_name).limit(5);
    if(q.error)throw q.error;
    let player=(q.data||[]).find(x=>String(x.gamertag).trim().toLowerCase()===String(r.player_name).trim().toLowerCase())||q.data?.[0];
    if(!player){
      q=await db().from('scouting_players').insert({
        gamertag:r.player_name,
        primary_position:r.position||null,
        platform:r.console||null,
        is_returning_player:false,
        scouting_status:'scouted'
      }).select('id,gamertag,primary_position,platform').single();
      if(q.error)throw q.error;
      player=q.data;
    }else{
      const patch={};
      if(r.position&&!player.primary_position)patch.primary_position=r.position;
      if(r.console&&!player.platform)patch.platform=r.console;
      if(Object.keys(patch).length){
        const upd=await db().from('scouting_players').update({...patch,updated_at:now}).eq('id',player.id);
        if(upd.error)throw upd.error;
      }
    }

    q=await db().from('team_scouting_pool')
      .select('id,status,priority')
      .eq('team_id',TEAM_ID)
      .eq('scouting_player_id',player.id)
      .maybeSingle();
    if(q.error)throw q.error;

    const existing=q.data||null;
    const keepStatus=existing?.status&&existing.status!=='unscouted'?existing.status:status;
    const poolPayload={
      status:status==='bid_target'?'bid_target':keepStatus,
      projected_role:roleText(r),
      market_status:r.market_status,
      market_league:r.bid_league_id===84?'ECHL':(r.market_status==='chl_live_bid'?'CHL':null),
      market_team:r.contracted_team||null,
      market_price:r.live_chl_bid||r.bid_amount||r.contracted_amount||null,
      market_source:'live-market',
      market_updated_at:r.source_updated_at||now,
      is_biddable:isEligible(r),
      market_details:r.details||{},
      updated_by:auth().user.id,
      updated_at:now
    };

    if(existing){
      const upd=await db().from('team_scouting_pool').update(poolPayload).eq('id',existing.id).select('id').single();
      if(upd.error)throw upd.error;
      return {player,poolId:upd.data.id};
    }
    const ins=await db().from('team_scouting_pool').insert({
      ...poolPayload,
      team_id:TEAM_ID,
      scouting_player_id:player.id,
      added_by:auth().user.id
    }).select('id').single();
    if(ins.error)throw ins.error;
    return {player,poolId:ins.data.id};
  }

  async function addToCalgary(uid,toBid,button){
    if(!canWrite())return;
    const r=M.rows.find(x=>Number(x.source_uid)===Number(uid));if(!r)return;
    button.disabled=true;
    try{
      const ensured=await ensurePlayerInScouting(r,toBid?'bid_target':'watch');
      if(toBid){
        let q=await db().from('team_bid_board').select('id').eq('team_id',TEAM_ID).eq('scouting_player_id',ensured.player.id).maybeSingle();
        if(q.error)throw q.error;
        const now=new Date().toISOString();
        const bidPayload={
          status:'target',
          priority:2,
          plan:roleText(r),
          note:'Added from live player market',
          updated_by:auth().user.id,
          updated_at:now
        };
        const save=q.data
          ?await db().from('team_bid_board').update(bidPayload).eq('id',q.data.id)
          :await db().from('team_bid_board').insert({...bidPayload,team_id:TEAM_ID,scouting_player_id:ensured.player.id});
        if(save.error)throw save.error;
      }
      button.textContent=toBid?'Added ✓':'Watching ✓';
      window.dispatchEvent(new CustomEvent('vvhl-auth-change',{detail:auth()}));
    }catch(e){
      button.disabled=false;msg(e.message||'Could not update Calgary board.');
    }
  }

  async function openPlayer(name){
    const r=M.rows.find(x=>String(x.player_name||'').toLowerCase()===String(name||'').toLowerCase());
    if(!r)return;
    msg('Opening full player dossier…');
    try{
      const ensured=await ensurePlayerInScouting(r,'scouted');
      if(window.HitmenDossier?.open){
        await window.HitmenDossier.open(ensured.poolId);
      }else{
        const section=$('hsSectionSelect');
        if(section){section.value='pool';section.dispatchEvent(new Event('change',{bubbles:true}));}
        const s=$('hsSearch');if(s){s.value=name;s.dispatchEvent(new Event('input',{bubbles:true}));}
      }
      window.dispatchEvent(new CustomEvent('vvhl-auth-change',{detail:auth()}));
      msg('');
    }catch(e){msg(e.message||'Could not open this player profile.');}
  }

  function start(){
    if(!inject())return;
    load().then(()=>{
      if(canWrite()&&(!M.meta||Date.now()-new Date(M.meta.synced_at||0).getTime()>90000))sync(false);
    });
    if(!M.timer)M.timer=setInterval(()=>{if(document.visibilityState==='visible'&&canWrite())sync(false);},120000);
    if(!M.dbTimer)M.dbTimer=setInterval(()=>{if(document.visibilityState==='visible')load();},30000);
  }

  const obs=new MutationObserver(()=>{if(inject()&&auth().user&&role()){start();obs.disconnect();}});
  window.addEventListener('vvhl-auth-change',()=>setTimeout(start,80));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{start();obs.observe(document.body,{subtree:true,childList:true});});
  else{start();obs.observe(document.body,{subtree:true,childList:true});}
})();
