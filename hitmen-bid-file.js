(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const CHUNKS=Array.from({length:8},(_,i)=>`data/bid-file-s55-${i}.json`);
  const db=()=>window.VVHLBackend?.db;
  const state=()=>window.VVHLBackend?.state||{};
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
  const money=v=>v==null||Number.isNaN(Number(v))?'—':'$'+Number(v).toLocaleString();
  const S={file:[],rows:[],pool:[],live:[],bids:[],search:'',pos:'',sort:'name',page:1,pageSize:100,loading:false};

  function role(){
    if(String(state().profile?.role||'').toLowerCase()==='admin')return'admin';
    return (state().memberships||[]).find(m=>m.team_id===TEAM_ID&&m.active!==false&&['owner','gm','agm','scout'].includes(String(m.role||'').toLowerCase()))?.role||null;
  }
  const canWrite=()=>['admin','owner','gm','agm'].includes(String(role()||'').toLowerCase());

  function addCss(){
    if(document.querySelector('link[data-hitmen-bid-file-css]'))return;
    const l=document.createElement('link');
    l.rel='stylesheet';l.href='hitmen-bid-file.css';l.dataset.hitmenBidFileCss='1';
    document.head.appendChild(l);
  }

  function inject(){
    addCss();
    if($('hsBidFile'))return true;
    const pane=document.querySelector('[data-hs-pane="bidfile"]');
    if(!pane)return false;
    const section=document.createElement('section');
    section.id='hsBidFile';
    section.className='hs-card hbf-shell';
    section.innerHTML=`
      <div class="hbf-head">
        <div>
          <div class="eyebrow">SEASON 55 · OFFICIAL BIDDABLE LIST</div>
          <h3>BID FILE</h3>
          <p class="hs-msg">This tab is the authoritative player list from the BidList.xls file you supplied. Every name here is kept separate from the general market so management always knows who came from the official bid file.</p>
        </div>
        <span class="hbf-badge">BID FILE</span>
      </div>
      <div class="hbf-kpis">
        <div><small>BID FILE PLAYERS</small><strong id="hbfTotal">0</strong></div>
        <div><small>MATCHED IN WILDMAN</small><strong id="hbfMatched">0</strong></div>
        <div><small>LIVE MARKET MATCHES</small><strong id="hbfLive">0</strong></div>
        <div><small>ON CALGARY BID BOARD</small><strong id="hbfOnBoard">0</strong></div>
      </div>
      <div class="hbf-controls">
        <input id="hbfSearch" class="hs-input" type="search" placeholder="Search official bid file by gamertag">
        <select id="hbfSort" class="hs-select">
          <option value="name">Player name</option>
          <option value="price_high">Market price: high to low</option>
          <option value="position">Position</option>
          <option value="live">Live market first</option>
        </select>
      </div>
      <div class="hbf-pos">
        <button class="active" data-hbf-pos="">ALL</button>
        <button data-hbf-pos="F">F</button><button data-hbf-pos="D">D</button>
        <button data-hbf-pos="LW">LW</button><button data-hbf-pos="C">C</button><button data-hbf-pos="RW">RW</button>
        <button data-hbf-pos="LD">LD</button><button data-hbf-pos="RD">RD</button><button data-hbf-pos="G">G</button>
      </div>
      <div id="hbfStatus" class="hs-msg">Loading bid file…</div>
      <div id="hbfRows" class="hbf-grid"></div>
      <div id="hbfEmpty" class="hs-empty" hidden>No Bid File players match these filters.</div>
      <div class="hbf-page"><span id="hbfPageMeta"></span><div><button id="hbfPrev" class="hs-btn" type="button">Previous</button><button id="hbfNext" class="hs-btn" type="button">Next</button></div></div>
    `;
    pane.appendChild(section);
    $('hbfSearch').oninput=e=>{S.search=e.target.value.trim().toLowerCase();S.page=1;renderRows();};
    $('hbfSort').onchange=e=>{S.sort=e.target.value;S.page=1;renderRows();};
    section.querySelectorAll('[data-hbf-pos]').forEach(b=>b.onclick=()=>{
      S.pos=b.dataset.hbfPos||'';S.page=1;
      section.querySelectorAll('[data-hbf-pos]').forEach(x=>x.classList.toggle('active',x===b));
      renderRows();
    });
    $('hbfPrev').onclick=()=>{if(S.page>1){S.page--;renderRows();}};
    $('hbfNext').onclick=()=>{S.page++;renderRows();};
    return true;
  }

  async function allRows(table,select,extra){
    const out=[];const batch=1000;
    for(let from=0;;from+=batch){
      let q=db().from(table).select(select);
      if(extra)q=extra(q);
      q=q.range(from,from+batch-1);
      const r=await q;
      if(r.error)throw r.error;
      out.push(...(r.data||[]));
      if((r.data||[]).length<batch)break;
    }
    return out;
  }

  async function loadBidFile(){
    const parts=await Promise.all(CHUNKS.map(async path=>{
      const r=await fetch(path,{cache:'no-store'});
      if(!r.ok)throw new Error('Could not load '+path);
      return r.json();
    }));
    const seen=new Set();
    S.file=parts.flat().map(([uid,name])=>({uid:Number(uid),name:String(name)})).filter(x=>{
      const k=String(x.uid);
      if(seen.has(k))return false;
      seen.add(k);return true;
    });
  }

  function priceOf(live,pool){
    return live?.live_chl_bid??live?.bid_amount??live?.likely_price??pool?.market_price??pool?.market_details?.display_price??null;
  }
  function posOf(live,pool){
    return live?.position||pool?.scouting_players?.primary_position||'';
  }
  function statusOf(live){
    if(!live)return 'BID FILE · ELIGIBLE';
    const s=String(live.market_status||'').replaceAll('_',' ').toUpperCase();
    return s?('BID FILE · '+s):'BID FILE · ELIGIBLE';
  }
  function onBoard(pool){
    if(!pool)return false;
    return S.bids.some(b=>b.scouting_player_id===pool.scouting_player_id);
  }

  function rebuild(){
    const poolMap=new Map(S.pool.map(p=>[norm(p.scouting_players?.gamertag),p]));
    const liveMap=new Map(S.live.map(p=>[norm(p.player_name),p]));
    S.rows=S.file.map(f=>{
      const key=norm(f.name),pool=poolMap.get(key)||null,live=liveMap.get(key)||null;
      return {
        ...f,key,pool,live,
        matched:Boolean(pool||live),
        position:posOf(live,pool),
        price:priceOf(live,pool),
        profile_url:`https://www.leaguegaming.com/forums/index.php?leaguegaming/league&action=league&page=team_user&userid=${f.uid}&leagueid=39&seasonid=55/`
      };
    });
  }

  function matchPos(r){
    if(!S.pos)return true;
    const p=String(r.position||'').toUpperCase();
    if(S.pos==='F')return ['F','LW','C','RW'].includes(p);
    if(S.pos==='D')return ['D','LD','RD'].includes(p);
    return p===S.pos;
  }

  function render(){
    if(!$('hsBidFile'))return;
    $('hbfTotal').textContent=S.file.length.toLocaleString();
    $('hbfMatched').textContent=S.rows.filter(r=>r.matched).length.toLocaleString();
    $('hbfLive').textContent=S.rows.filter(r=>r.live).length.toLocaleString();
    $('hbfOnBoard').textContent=S.rows.filter(r=>onBoard(r.pool)).length.toLocaleString();
    renderRows();
  }

  function renderRows(){
    const box=$('hbfRows');if(!box)return;
    let rows=S.rows.filter(r=>{
      if(S.search&&!r.name.toLowerCase().includes(S.search))return false;
      return matchPos(r);
    });
    rows.sort((a,b)=>{
      if(S.sort==='price_high')return Number(b.price||0)-Number(a.price||0)||a.name.localeCompare(b.name);
      if(S.sort==='position')return String(a.position||'ZZ').localeCompare(String(b.position||'ZZ'))||a.name.localeCompare(b.name);
      if(S.sort==='live')return Number(Boolean(b.live))-Number(Boolean(a.live))||a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    const pages=Math.max(1,Math.ceil(rows.length/S.pageSize));
    if(S.page>pages)S.page=pages;
    const start=(S.page-1)*S.pageSize;
    const shown=rows.slice(start,start+S.pageSize);
    box.innerHTML=shown.map(r=>{
      const liveConflict=r.live&&['echl_signed','chl_signed','signed_other','off_auction'].includes(r.live.market_status);
      const role=r.live?.details?.role?.view?.chip||r.live?.details?.role?.chip||r.pool?.projected_role||'Role not set';
      const board=onBoard(r.pool);
      return `<article class="hbf-card ${liveConflict?'conflict':''}">
        <div class="hbf-card-top">
          <div><strong>${esc(r.name)}</strong><small>${esc(r.position||'POS ?')} · LG ID ${r.uid}</small></div>
          <span class="hbf-state">${esc(statusOf(r.live))}</span>
        </div>
        <div class="hbf-data">
          <div><small>MARKET</small><b>${money(r.price)}</b></div>
          <div><small>ROLE</small><b>${esc(role)}</b></div>
          <div><small>CROSS-REF</small><b>${r.matched?'MATCHED':'BID FILE ONLY'}</b></div>
        </div>
        ${liveConflict?`<div class="hbf-warning">Bid File says eligible, but the latest live snapshot says ${esc(String(r.live.market_status).replaceAll('_',' '))}. Verify before bidding.</div>`:''}
        <div class="hbf-actions">
          <a class="hs-btn" href="${esc(r.profile_url)}" target="_blank" rel="noopener">LG Profile</a>
          <button class="hs-btn" type="button" data-hbf-open="${r.uid}">Open Full Profile</button>
          ${canWrite()?`<button class="hs-btn" type="button" data-hbf-watch="${r.uid}">Watch</button><button class="hs-btn primary" type="button" data-hbf-bid="${r.uid}">${board?'On Bid Board ✓':'Add to Bidding'}</button>`:''}
        </div>
      </article>`;
    }).join('');
    $('hbfEmpty').hidden=shown.length!==0;
    $('hbfPageMeta').textContent=rows.length?`Showing ${start+1}–${start+shown.length} of ${rows.length.toLocaleString()} Bid File players`:'No matches';
    $('hbfPrev').disabled=S.page<=1;$('hbfNext').disabled=S.page>=pages;
    box.querySelectorAll('[data-hbf-open]').forEach(b=>b.onclick=()=>openProfile(Number(b.dataset.hbfOpen)));
    box.querySelectorAll('[data-hbf-watch]').forEach(b=>b.onclick=()=>setTarget(Number(b.dataset.hbfWatch),false,b));
    box.querySelectorAll('[data-hbf-bid]').forEach(b=>b.onclick=()=>setTarget(Number(b.dataset.hbfBid),true,b));
  }

  async function ensurePool(row){
    if(row.pool)return row.pool;
    const now=new Date().toISOString();
    let player=null;
    let q=await db().from('scouting_players').select('id,gamertag,primary_position,platform').ilike('gamertag',row.name).limit(5);
    if(q.error)throw q.error;
    player=(q.data||[]).find(x=>norm(x.gamertag)===row.key)||q.data?.[0]||null;
    if(!player){
      q=await db().from('scouting_players').insert({
        gamertag:row.name,
        primary_position:row.position||null,
        platform:row.live?.console||null,
        is_returning_player:false,
        scouting_status:'needs_scouting'
      }).select('id,gamertag,primary_position,platform').single();
      if(q.error)throw q.error;
      player=q.data;
    }
    q=await db().from('team_scouting_pool').select('id,scouting_player_id,status,priority,projected_role,market_price,scouting_players(id,gamertag,primary_position,platform)')
      .eq('team_id',TEAM_ID).eq('scouting_player_id',player.id).maybeSingle();
    if(q.error)throw q.error;
    if(q.data){row.pool=q.data;S.pool.push(q.data);return q.data;}
    const ins=await db().from('team_scouting_pool').insert({
      team_id:TEAM_ID,scouting_player_id:player.id,status:'scouted',
      projected_role:row.live?.details?.role?.view?.chip||row.live?.details?.role?.chip||null,
      market_status:'bid_file',market_price:row.price||null,market_source:'BidList.xls',
      market_updated_at:now,is_biddable:true,market_focus:true,
      market_details:{bid_file:true,lg_user_id:row.uid,profile_url:row.profile_url},
      market_import_batch:'bid-file-s55-20260922',market_scope:'official_bid_file',
      added_by:state().user.id,updated_by:state().user.id,updated_at:now
    }).select('id,scouting_player_id,status,priority,projected_role,market_price,scouting_players(id,gamertag,primary_position,platform)').single();
    if(ins.error)throw ins.error;
    row.pool=ins.data;S.pool.push(ins.data);return ins.data;
  }

  async function setTarget(uid,toBid,button){
    if(!canWrite())return;
    const row=S.rows.find(r=>r.uid===uid);if(!row)return;
    button.disabled=true;
    try{
      const pool=await ensurePool(row);
      const now=new Date().toISOString();
      const upd=await db().from('team_scouting_pool').update({
        status:toBid?'bid_target':'watch',
        priority:toBid?(pool.priority||2):pool.priority,
        is_biddable:true,market_status:'bid_file',market_source:'BidList.xls',
        market_updated_at:now,updated_by:state().user.id,updated_at:now
      }).eq('id',pool.id);
      if(upd.error)throw upd.error;
      pool.status=toBid?'bid_target':'watch';
      if(toBid){
        const found=S.bids.find(b=>b.scouting_player_id===pool.scouting_player_id);
        const payload={status:'target',priority:2,plan:pool.projected_role||'Bid File target',note:'Official Season 55 Bid File',updated_by:state().user.id,updated_at:now};
        const save=found
          ?await db().from('team_bid_board').update(payload).eq('id',found.id)
          :await db().from('team_bid_board').insert({...payload,team_id:TEAM_ID,scouting_player_id:pool.scouting_player_id}).select('*').single();
        if(save.error)throw save.error;
        if(!found&&save.data)S.bids.push(save.data);
      }
      button.textContent=toBid?'On Bid Board ✓':'Watching ✓';
      render();
      window.dispatchEvent(new CustomEvent('vvhl-auth-change',{detail:state()}));
    }catch(e){
      button.disabled=false;$('hbfStatus').textContent=e.message||'Could not update Calgary board.';
    }
  }

  async function openProfile(uid){
    const row=S.rows.find(r=>r.uid===uid);if(!row)return;
    $('hbfStatus').textContent='Opening full player dossier…';
    try{
      const pool=await ensurePool(row);
      if(window.HitmenDossier?.open)await window.HitmenDossier.open(pool.id);
      else{
        const sel=$('hsSectionSelect');if(sel){sel.value='pool';sel.dispatchEvent(new Event('change',{bubbles:true}));}
        const search=$('hsSearch');if(search){search.value=row.name;search.dispatchEvent(new Event('input',{bubbles:true}));}
      }
      $('hbfStatus').textContent='';
    }catch(e){$('hbfStatus').textContent=e.message||'Could not open player profile.';}
  }

  async function load(){
    if(S.loading||!db()||!state().user||!role())return;
    S.loading=true;
    try{
      $('hbfStatus')&&($('hbfStatus').textContent='Cross-referencing BidList.xls against Wildman…');
      const [_,pool,live,bids]=await Promise.all([
        S.file.length?Promise.resolve():loadBidFile(),
        allRows('team_scouting_pool','id,scouting_player_id,status,priority,projected_role,market_price,market_status,market_source,is_biddable,scouting_players(id,gamertag,primary_position,platform)',q=>q.eq('team_id',TEAM_ID)),
        allRows('hitmen_live_market_players','*',q=>q.eq('team_id',TEAM_ID).eq('season',55)),
        allRows('team_bid_board','*',q=>q.eq('team_id',TEAM_ID))
      ]);
      S.pool=pool;S.live=live;S.bids=bids;rebuild();render();
      $('hbfStatus').textContent=`Bid File loaded ✓ ${S.file.length.toLocaleString()} official biddable players · ${S.rows.filter(r=>r.matched).length.toLocaleString()} cross-referenced to Wildman.`;
    }catch(e){
      $('hbfStatus')&&($('hbfStatus').textContent=e.message||'Could not load Bid File.');
    }finally{S.loading=false;}
  }

  function start(){
    if(!inject())return;
    load();
  }
  const obs=new MutationObserver(()=>{if(inject()&&state().user&&role()){start();obs.disconnect();}});
  window.addEventListener('vvhl-auth-change',()=>setTimeout(load,100));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{start();obs.observe(document.body,{subtree:true,childList:true});});
  else{start();obs.observe(document.body,{subtree:true,childList:true});}
})();