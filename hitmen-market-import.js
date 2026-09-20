(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  const $=id=>document.getElementById(id);
  const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  const isAdmin=()=>String(auth().profile?.role||'').toLowerCase()==='admin';
  const MARKET_PREFIX='WILDMAN_CHELSCOUT_MARKET:';

  let previewRows=[];
  let poolCache=null;

  function inject(){
    if(!isAdmin()) return;
    const root=document.querySelector('[data-hitmen-scouting]');
    if(!root||document.getElementById('hsMarketImport'))return;
    const pane=root.querySelector('[data-hs-pane="pool"]');
    if(!pane)return;
    const box=document.createElement('section');
    box.id='hsMarketImport';
    box.className='hs-card hs-admin-only';
    box.style.marginBottom='14px';
    box.innerHTML=`
      <div class="hs-card-head">
        <div><div class="eyebrow">WILDMAN ADMIN · LIVE MARKET FILTER</div><h3>ChelScout Market Import</h3></div>
        <span id="hsMarketImportBadge" class="hs-tag">READY</span>
      </div>
      <p class="hs-msg">Paste the JSON response from a ChelScout GM Hub market request. Wildman matches by ChelScout/LG UID first, then exact gamertag, and updates Calgary's live availability without deleting historical player intelligence.</p>
      <div class="hs-form">
        <label><span class="hs-label">ChelScout response</span><select id="hsMarketImportSource" class="hs-select">
          <option value="bid-board">Bid Board / currently biddable</option>
          <option value="signings">Signings / won players</option>
          <option value="market-changes">Market Changes</option>
        </select></label>
        <label id="hsMarketCompleteWrap"><span class="hs-label">Snapshot type</span><select id="hsMarketComplete" class="hs-select">
          <option value="false">Partial / unsure</option>
          <option value="true">Full bid-board snapshot</option>
        </select></label>
        <label class="wide"><span class="hs-label">Response JSON</span><textarea id="hsMarketImportJson" class="hs-textarea" style="min-height:180px" placeholder='Paste the full JSON response here'></textarea></label>
      </div>
      <div class="hs-actions">
        <button id="hsCopyMarketSync" class="hs-btn" type="button">Copy “Send Market to Wildman” Bookmark</button>
        <button id="hsMarketPreview" class="hs-btn" type="button">Preview Import</button>
        <button id="hsMarketApply" class="hs-btn primary" type="button" disabled>Apply to Calgary Pool</button>
        <span id="hsMarketImportMsg" class="hs-msg"></span>
      </div>
      <div id="hsMarketPreviewBox" class="hs-empty" style="margin-top:12px;text-align:left">Nothing previewed yet.</div>
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-weight:800">How to copy the ChelScout data</summary>
        <div class="hs-msg" style="margin-top:10px;line-height:1.65">
          <b>Fastest on mobile:</b> copy the “Send Market to Wildman” bookmark once. On ChelScout Market, tap Show more until the full filtered list is visible, then run that bookmark. It transfers only the visible page text, never your cookies or login.<br><br>
          <b>JSON option:</b> on desktop you can still copy the GM Hub response body from DevTools → Network → Fetch/XHR and paste it above.<br><br>
          Never paste your Discord login cookie, authorization headers or password.
        </div>
      </details>`;
    pane.insertBefore(box,pane.firstChild);
    $('hsMarketImportSource').addEventListener('change',syncSourceUi);
    $('hsCopyMarketSync').addEventListener('click',copyMarketBookmark);
    $('hsMarketPreview').addEventListener('click',preview);
    $('hsMarketApply').addEventListener('click',apply);
    syncSourceUi();
    consumeMarketTransfer();
  }


  function marketBookmarklet(){
    async function collector(){
      try{
        if(location.hostname!=='chelscout.net'&&location.hostname!=='www.chelscout.net'){
          alert('Open ChelScout GM Hub Market first.');return;
        }
        var txt=String(document.body&&document.body.innerText||'').trim();
        if(!txt||!/Market/i.test(txt)||!/Show more|PPG|goalies get no dollar value/i.test(txt)){
          alert('Open the ChelScout Market player list first.');return;
        }
        var payload={source:'chelscout_market_text',source_url:location.href,captured_at:new Date().toISOString(),text:txt};
        var w=window.open('about:blank','_blank');
        if(!w){alert('Allow popups once, then run Send Market to Wildman again.');return;}
        w.name='WILDMAN_CHELSCOUT_MARKET:'+JSON.stringify(payload);
        w.location='https://wildmanhockey-esportshub.vercel.app/hitmen-workspace.html#chelscout-market-import';
      }catch(e){alert('Could not capture the ChelScout Market page.');}
    }
    return 'javascript:('+collector.toString()+')();';
  }

  async function copyMarketBookmark(){
    try{
      await navigator.clipboard.writeText(marketBookmarklet());
      message('Copied. Save it as a browser bookmark named “Send Market to Wildman”. On ChelScout Market, show the full filtered list and tap that bookmark.','COPIED');
    }catch(e){
      message('Clipboard access was blocked by this browser.','COPY BLOCKED');
    }
  }

  async function fetchPoolNames(){
    if(poolCache)return poolCache;
    const rows=[];const batch=1000;
    for(let from=0;;from+=batch){
      const r=await db().from('team_scouting_pool')
        .select('scouting_player_id,scouting_players(gamertag,primary_position)')
        .eq('team_id',TEAM_ID).range(from,from+batch-1);
      if(r.error)throw r.error;
      rows.push(...(r.data||[]));
      if((r.data||[]).length<batch)break;
    }
    poolCache=rows.map(x=>({
      id:x.scouting_player_id,
      gamertag:String(x.scouting_players?.gamertag||'').trim(),
      position:String(x.scouting_players?.primary_position||'').trim()
    })).filter(x=>x.gamertag).sort((a,b)=>b.gamertag.length-a.gamertag.length);
    return poolCache;
  }

  function cashToInt(raw){
    const m=String(raw||'').replace(/,/g,'').match(/\$?\s*(\d+(?:\.\d+)?)\s*([MK])?/i);
    if(!m)return null;
    let n=Number(m[1]);const unit=String(m[2]||'').toUpperCase();
    if(unit==='M')n*=1000000; else if(unit==='K')n*=1000;
    return Math.round(n);
  }

  async function parseMarketText(raw){
    const pool=await fetchPoolNames();
    const blocks=String(raw||'').split(/⇄/).map(x=>x.trim()).filter(Boolean);
    const out=[];const seen=new Set();
    for(const block of blocks){
      const lines=block.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      let hit=null,hitLine=null;
      for(const line of lines.slice(0,5)){
        const low=line.toLowerCase();
        hit=pool.find(p=>low.startsWith(p.gamertag.toLowerCase()));
        if(hit){hitLine=line;break;}
      }
      if(!hit)continue;
      const key=hit.id;if(seen.has(key))continue;seen.add(key);
      const server=((block.match(/\b(East|West|Central)\s+server\b/i)||[])[1]||null);
      const reach=((block.match(/[↓]\s*(\d{1,3})%/)||[])[1]||null);
      const rank=block.match(/#(\d+)\/(\d+)\s+([FD])/i);
      const ppg=block.match(/(\d+(?:\.\d+)?)\s+PPG\s*·\s*(\d+)\s+GP\s*·\s*CHL\s*S(\d+)/i);
      const save=block.match(/(\.\d{3})\s*·\s*(\d+)\s+GP\s*·\s*(?:CHL|ECHL)\s*S(\d+)/i);
      const last=block.match(/last\s+\$([0-9.]+)\s*([MK])?/i);
      const lineRole=(block.match(/\b(CHL\s+(?:1st|2nd|3rd|ST|BU)|NO LINE)\b/i)||[])[1]||null;
      const tier=(block.match(/\b(STEAL|STRONG|GOOD|FAIR|PREM|OVER|WALK|RANGE)\b/i)||[])[1]||null;
      const displayed=block.match(/\b(?:STEAL|STRONG|GOOD|FAIR|PREM|OVER|WALK)\s+\$([0-9.]+)\s*([MK])?/i);
      const position=hit.position||String(hitLine||'').slice(hit.gamertag.length).match(/(LW|RW|LD|RD|C|G)$/i)?.[1]||null;
      out.push({
        gamertag:hit.gamertag,
        position,
        league:'CHL',
        market_status:'chelscout_market',
        is_biddable:true,
        price:displayed?cashToInt('
    const source=$('hsMarketImportSource')?.value;
    if($('hsMarketCompleteWrap'))$('hsMarketCompleteWrap').hidden=source!=='bid-board';
    previewRows=[];
    if($('hsMarketApply'))$('hsMarketApply').disabled=true;
  }

  function priceValue(v){
    if(v==null||v==='')return null;
    if(typeof v==='number'&&Number.isFinite(v))return Math.round(v<1000?v*1000000:v);
    const s=String(v).replace(/[$,\s]/g,'').toUpperCase();
    const m=s.match(/^(-?\d+(?:\.\d+)?)([MK])?$/);
    if(!m)return null;
    let n=Number(m[1]);
    if(m[2]==='M')n*=1000000;
    if(m[2]==='K')n*=1000;
    return Number.isFinite(n)?Math.round(n):null;
  }

  function first(obj,keys){
    for(const k of keys){
      const v=obj?.[k];
      if(v!==undefined&&v!==null&&v!=='')return v;
    }
    return null;
  }

  function playerObject(obj){
    const p=obj?.player;
    return p&&typeof p==='object'&&!Array.isArray(p)?p:null;
  }

  function toRow(obj,source){
    const p=playerObject(obj);
    const gamertag=first(obj,['username','gamertag','player_name','playerName','display_name','displayName'])||
      first(p,['username','gamertag','player_name','name','display_name']);
    const genericName=first(obj,['name']);
    const uid=first(obj,['chelscout_uid','user_id','userId','uid','player_uid','playerUid'])||
      first(p,['chelscout_uid','user_id','userId','uid','id']);
    const pos=first(obj,['position','pos','signed_position','played_position'])||first(p,['position','pos']);
    const hasPlayerSignal=gamertag||uid||p||(genericName&&pos);
    if(!hasPlayerSignal)return null;

    const name=gamertag||(genericName&&pos?genericName:null);
    if(!name&&!uid)return null;

    const league=first(obj,['league_short','league','league_name','current_league','level','tier']);
    const team=first(obj,['team','team_name','current_team','winning_team','signed_team','club']);
    const rawStatus=String(first(obj,['market_status','status','state','event','action','transaction_type','type'])||'').toLowerCase();
    const price=priceValue(first(obj,['winning_bid','winningBid','salary','price','amount','bid','contract_value','contractValue']));

    let marketStatus='unknown',isBiddable=null;
    if(source==='bid-board'){
      marketStatus='available';
      isBiddable=true;
    }else if(source==='signings'){
      const l=String(league||'').toLowerCase();
      marketStatus=l?'signed_'+l.replace(/[^a-z0-9]+/g,'_'):'signed';
      isBiddable=false;
    }else{
      const txt=(rawStatus+' '+String(first(obj,['description','message','label'])||'')).toLowerCase();
      if(/sign|won|roster|contract|awarded|claimed/.test(txt)){marketStatus='signed';isBiddable=false;}
      else if(/avail|biddable|open|released|waived|returned/.test(txt)){marketStatus='available';isBiddable=true;}
      else if(/withdraw|ineligible|remove|closed/.test(txt)){marketStatus='unavailable';isBiddable=false;}
      else marketStatus=rawStatus||'market_change';
    }

    return {
      uid:uid==null?null:Number(uid)||null,
      gamertag:name?String(name).trim():null,
      position:pos?String(pos).trim():null,
      league:league?String(league).trim().toUpperCase():null,
      team:team?String(team).trim():null,
      price,
      market_status:marketStatus,
      is_biddable:isBiddable
    };
  }

  function collect(root,source){
    const rows=[];
    const seenObjects=new WeakSet();
    function walk(v,depth=0){
      if(depth>12||v==null)return;
      if(Array.isArray(v)){v.forEach(x=>walk(x,depth+1));return;}
      if(typeof v!=='object')return;
      if(seenObjects.has(v))return;seenObjects.add(v);
      const row=toRow(v,source);
      if(row)rows.push(row);
      Object.values(v).forEach(x=>{if(x&&typeof x==='object')walk(x,depth+1);});
    }
    walk(root);
    const dedupe=new Map();
    for(const r of rows){
      const key=r.uid?('uid:'+r.uid):('name:'+norm(r.gamertag));
      if(!key||key==='name:')continue;
      const prev=dedupe.get(key)||{};
      dedupe.set(key,{...prev,...Object.fromEntries(Object.entries(r).filter(([,v])=>v!==null&&v!==''))});
    }
    return [...dedupe.values()];
  }

  async function preview(){
    const source=$('hsMarketImportSource')?.value||'bid-board';
    const raw=$('hsMarketImportJson')?.value.trim();
    if(!raw)return message('Paste the ChelScout response JSON first.','EMPTY');
    let parsed=null;
    try{parsed=JSON.parse(raw);}catch(e){}
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&parsed.uid&&Array.isArray(parsed.career)&&(parsed.fv_by_league||parsed.expect||parsed.dna)){
      previewRows=[];
      $('hsMarketApply').disabled=true;
      $('hsMarketPreviewBox').className='hs-empty';
      $('hsMarketPreviewBox').textContent='This is a single-player ChelScout scouting payload, not the bulk market board. It belongs in that player’s ChelScout Intelligence import.';
      return message('Player report detected. Use the market list, not one player’s dossier.','PLAYER REPORT');
    }
    try{
      previewRows=parsed?collect(parsed,source):await parseMarketText(raw);
    }catch(e){return message(e.message||'Could not parse this market snapshot.','ERROR');}
    if(!previewRows.length)return message('I could not identify player rows in this response yet. Keep the JSON and send it to ChatGPT so the parser can be adapted to this exact ChelScout response.','NO PLAYERS');

    const signed=previewRows.filter(x=>x.is_biddable===false).length;
    const open=previewRows.filter(x=>x.is_biddable===true).length;
    const priced=previewRows.filter(x=>x.price!=null).length;
    const sample=previewRows.slice(0,8).map(x=>`<tr><td>${escapeHtml(x.gamertag||('UID '+x.uid))}</td><td>${escapeHtml(x.position||'—')}</td><td>${escapeHtml(x.market_status)}</td><td>${escapeHtml(x.league||'—')}</td><td>${escapeHtml(x.team||'—')}</td><td>${x.price==null?'—':'$'+Number(x.price).toLocaleString()}</td></tr>`).join('');
    $('hsMarketPreviewBox').className='';
    $('hsMarketPreviewBox').innerHTML=`<div class="hs-msg"><b>${previewRows.length.toLocaleString()} player rows found</b> · ${open} biddable · ${signed} unavailable/signed · ${priced} with price data</div><div class="hs-table-wrap" style="margin-top:9px"><table class="hs-table"><thead><tr><th>Player</th><th>Pos</th><th>Market</th><th>League</th><th>Team</th><th>Price</th></tr></thead><tbody>${sample}</tbody></table></div>`;
    $('hsMarketApply').disabled=false;
    message('Preview ready. Nothing has changed in Calgary yet.','PREVIEW');
  }

  async function apply(){
    if(!previewRows.length||!db()||!auth().user)return;
    const source=$('hsMarketImportSource')?.value||'bid-board';
    const complete=source==='bid-board'&&$('hsMarketComplete')?.value==='true';
    if(complete&&!confirm('This marks Calgary players NOT present in this imported bid board as not currently biddable. Continue only if this response contains the full bid board.'))return;
    $('hsMarketApply').disabled=true;
    message('Matching market rows to Calgary…','IMPORTING');
    try{
      const {data,error}=await db().rpc('apply_hitmen_market_import',{
        p_team_id:TEAM_ID,
        p_source:source,
        p_rows:previewRows,
        p_complete_snapshot:complete
      });
      if(error)throw error;
      const matched=Number(data?.matched||0),unmatched=Number(data?.unmatched||0);
      message(`Imported ✓ ${matched.toLocaleString()} matched Calgary players · ${unmatched.toLocaleString()} unmatched.`,'SYNCED');
      if($('hsMarketPreviewBox')){
        $('hsMarketPreviewBox').innerHTML+=`<p class="hs-msg" style="margin-top:10px"><b>Applied:</b> ${matched} matched. ${unmatched?('Unmatched sample: '+(data.unmatched_names||[]).slice(0,12).map(escapeHtml).join(' · ')):'No unmatched rows.'}</p>`;
      }
      setTimeout(()=>window.dispatchEvent(new CustomEvent('vvhl-auth-change',{detail:auth()})),100);
    }catch(e){
      message(e.message||'Market import failed.','ERROR');
      $('hsMarketApply').disabled=false;
    }
  }

  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function message(text,badge){
    if($('hsMarketImportMsg'))$('hsMarketImportMsg').textContent=text;
    if($('hsMarketImportBadge'))$('hsMarketImportBadge').textContent=badge||'';
  }

  const obs=new MutationObserver(inject);
  window.addEventListener('vvhl-auth-change',()=>setTimeout(inject,60));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();obs.observe(document.body,{subtree:true,childList:true});});
  else{inject();obs.observe(document.body,{subtree:true,childList:true});}
})();+displayed[1]+(displayed[2]||'')):null,
        source_details:{
          server,
          reach_pct:reach?Number(reach):null,
          rank:rank?Number(rank[1]):null,
          rank_pool:rank?Number(rank[2]):null,
          rank_group:rank?rank[3].toUpperCase():null,
          line_role:lineRole,
          market_tier:tier?tier.toUpperCase():null,
          latest_ppg:ppg?Number(ppg[1]):null,
          latest_gp:ppg?Number(ppg[2]):(save?Number(save[2]):null),
          latest_season:ppg?Number(ppg[3]):(save?Number(save[3]):null),
          latest_save_pct:save?Number(save[1]):null,
          last_price:last?cashToInt('
    const source=$('hsMarketImportSource')?.value;
    if($('hsMarketCompleteWrap'))$('hsMarketCompleteWrap').hidden=source!=='bid-board';
    previewRows=[];
    if($('hsMarketApply'))$('hsMarketApply').disabled=true;
  }

  function priceValue(v){
    if(v==null||v==='')return null;
    if(typeof v==='number'&&Number.isFinite(v))return Math.round(v<1000?v*1000000:v);
    const s=String(v).replace(/[$,\s]/g,'').toUpperCase();
    const m=s.match(/^(-?\d+(?:\.\d+)?)([MK])?$/);
    if(!m)return null;
    let n=Number(m[1]);
    if(m[2]==='M')n*=1000000;
    if(m[2]==='K')n*=1000;
    return Number.isFinite(n)?Math.round(n):null;
  }

  function first(obj,keys){
    for(const k of keys){
      const v=obj?.[k];
      if(v!==undefined&&v!==null&&v!=='')return v;
    }
    return null;
  }

  function playerObject(obj){
    const p=obj?.player;
    return p&&typeof p==='object'&&!Array.isArray(p)?p:null;
  }

  function toRow(obj,source){
    const p=playerObject(obj);
    const gamertag=first(obj,['username','gamertag','player_name','playerName','display_name','displayName'])||
      first(p,['username','gamertag','player_name','name','display_name']);
    const genericName=first(obj,['name']);
    const uid=first(obj,['chelscout_uid','user_id','userId','uid','player_uid','playerUid'])||
      first(p,['chelscout_uid','user_id','userId','uid','id']);
    const pos=first(obj,['position','pos','signed_position','played_position'])||first(p,['position','pos']);
    const hasPlayerSignal=gamertag||uid||p||(genericName&&pos);
    if(!hasPlayerSignal)return null;

    const name=gamertag||(genericName&&pos?genericName:null);
    if(!name&&!uid)return null;

    const league=first(obj,['league_short','league','league_name','current_league','level','tier']);
    const team=first(obj,['team','team_name','current_team','winning_team','signed_team','club']);
    const rawStatus=String(first(obj,['market_status','status','state','event','action','transaction_type','type'])||'').toLowerCase();
    const price=priceValue(first(obj,['winning_bid','winningBid','salary','price','amount','bid','contract_value','contractValue']));

    let marketStatus='unknown',isBiddable=null;
    if(source==='bid-board'){
      marketStatus='available';
      isBiddable=true;
    }else if(source==='signings'){
      const l=String(league||'').toLowerCase();
      marketStatus=l?'signed_'+l.replace(/[^a-z0-9]+/g,'_'):'signed';
      isBiddable=false;
    }else{
      const txt=(rawStatus+' '+String(first(obj,['description','message','label'])||'')).toLowerCase();
      if(/sign|won|roster|contract|awarded|claimed/.test(txt)){marketStatus='signed';isBiddable=false;}
      else if(/avail|biddable|open|released|waived|returned/.test(txt)){marketStatus='available';isBiddable=true;}
      else if(/withdraw|ineligible|remove|closed/.test(txt)){marketStatus='unavailable';isBiddable=false;}
      else marketStatus=rawStatus||'market_change';
    }

    return {
      uid:uid==null?null:Number(uid)||null,
      gamertag:name?String(name).trim():null,
      position:pos?String(pos).trim():null,
      league:league?String(league).trim().toUpperCase():null,
      team:team?String(team).trim():null,
      price,
      market_status:marketStatus,
      is_biddable:isBiddable
    };
  }

  function collect(root,source){
    const rows=[];
    const seenObjects=new WeakSet();
    function walk(v,depth=0){
      if(depth>12||v==null)return;
      if(Array.isArray(v)){v.forEach(x=>walk(x,depth+1));return;}
      if(typeof v!=='object')return;
      if(seenObjects.has(v))return;seenObjects.add(v);
      const row=toRow(v,source);
      if(row)rows.push(row);
      Object.values(v).forEach(x=>{if(x&&typeof x==='object')walk(x,depth+1);});
    }
    walk(root);
    const dedupe=new Map();
    for(const r of rows){
      const key=r.uid?('uid:'+r.uid):('name:'+norm(r.gamertag));
      if(!key||key==='name:')continue;
      const prev=dedupe.get(key)||{};
      dedupe.set(key,{...prev,...Object.fromEntries(Object.entries(r).filter(([,v])=>v!==null&&v!==''))});
    }
    return [...dedupe.values()];
  }

  function preview(){
    const source=$('hsMarketImportSource')?.value||'bid-board';
    const raw=$('hsMarketImportJson')?.value.trim();
    if(!raw)return message('Paste the ChelScout response JSON first.','EMPTY');
    let parsed;
    try{parsed=JSON.parse(raw);}catch(e){return message('That response is not valid JSON. Copy the Response body, not the request headers.','ERROR');}
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&parsed.uid&&Array.isArray(parsed.career)&&(parsed.fv_by_league||parsed.expect||parsed.dna)){
      previewRows=[];
      $('hsMarketApply').disabled=true;
      $('hsMarketPreviewBox').className='hs-empty';
      $('hsMarketPreviewBox').textContent='This is a single-player ChelScout scouting payload, not the bulk market board. It belongs in that player’s ChelScout Intelligence import.';
      return message('Player report detected. Find the request that returns the filtered market/player list after “Show players”.','PLAYER REPORT');
    }
    previewRows=collect(parsed,source);
    if(!previewRows.length)return message('I could not identify player rows in this response yet. Keep the JSON and send it to ChatGPT so the parser can be adapted to this exact ChelScout response.','NO PLAYERS');

    const signed=previewRows.filter(x=>x.is_biddable===false).length;
    const open=previewRows.filter(x=>x.is_biddable===true).length;
    const priced=previewRows.filter(x=>x.price!=null).length;
    const sample=previewRows.slice(0,8).map(x=>`<tr><td>${escapeHtml(x.gamertag||('UID '+x.uid))}</td><td>${escapeHtml(x.position||'—')}</td><td>${escapeHtml(x.market_status)}</td><td>${escapeHtml(x.league||'—')}</td><td>${escapeHtml(x.team||'—')}</td><td>${x.price==null?'—':'$'+Number(x.price).toLocaleString()}</td></tr>`).join('');
    $('hsMarketPreviewBox').className='';
    $('hsMarketPreviewBox').innerHTML=`<div class="hs-msg"><b>${previewRows.length.toLocaleString()} player rows found</b> · ${open} biddable · ${signed} unavailable/signed · ${priced} with price data</div><div class="hs-table-wrap" style="margin-top:9px"><table class="hs-table"><thead><tr><th>Player</th><th>Pos</th><th>Market</th><th>League</th><th>Team</th><th>Price</th></tr></thead><tbody>${sample}</tbody></table></div>`;
    $('hsMarketApply').disabled=false;
    message('Preview ready. Nothing has changed in Calgary yet.','PREVIEW');
  }

  async function apply(){
    if(!previewRows.length||!db()||!auth().user)return;
    const source=$('hsMarketImportSource')?.value||'bid-board';
    const complete=source==='bid-board'&&$('hsMarketComplete')?.value==='true';
    if(complete&&!confirm('This marks Calgary players NOT present in this imported bid board as not currently biddable. Continue only if this response contains the full bid board.'))return;
    $('hsMarketApply').disabled=true;
    message('Matching market rows to Calgary…','IMPORTING');
    try{
      const {data,error}=await db().rpc('apply_hitmen_market_import',{
        p_team_id:TEAM_ID,
        p_source:source,
        p_rows:previewRows,
        p_complete_snapshot:complete
      });
      if(error)throw error;
      const matched=Number(data?.matched||0),unmatched=Number(data?.unmatched||0);
      message(`Imported ✓ ${matched.toLocaleString()} matched Calgary players · ${unmatched.toLocaleString()} unmatched.`,'SYNCED');
      if($('hsMarketPreviewBox')){
        $('hsMarketPreviewBox').innerHTML+=`<p class="hs-msg" style="margin-top:10px"><b>Applied:</b> ${matched} matched. ${unmatched?('Unmatched sample: '+(data.unmatched_names||[]).slice(0,12).map(escapeHtml).join(' · ')):'No unmatched rows.'}</p>`;
      }
      setTimeout(()=>window.dispatchEvent(new CustomEvent('vvhl-auth-change',{detail:auth()})),100);
    }catch(e){
      message(e.message||'Market import failed.','ERROR');
      $('hsMarketApply').disabled=false;
    }
  }

  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function message(text,badge){
    if($('hsMarketImportMsg'))$('hsMarketImportMsg').textContent=text;
    if($('hsMarketImportBadge'))$('hsMarketImportBadge').textContent=badge||'';
  }

  const obs=new MutationObserver(inject);
  window.addEventListener('vvhl-auth-change',()=>setTimeout(inject,60));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();obs.observe(document.body,{subtree:true,childList:true});});
  else{inject();obs.observe(document.body,{subtree:true,childList:true});}
})();+last[1]+(last[2]||'')):null,
          raw_text:block.slice(0,1400)
        }
      });
    }
    return out;
  }

  async function consumeMarketTransfer(){
    if(location.hash!=='#chelscout-market-import'||!String(window.name||'').startsWith(MARKET_PREFIX))return;
    if(!db()||!auth().user){message('Market snapshot received. Sign into Wildman management and it will be ready to preview.','WAITING');return;}
    try{
      const payload=JSON.parse(String(window.name).slice(MARKET_PREFIX.length));
      window.name='';
      history.replaceState(null,'',location.pathname+location.search+'#hitmen-scouting');
      $('hsMarketImportSource').value='bid-board';
      $('hsMarketComplete').value='false';
      $('hsMarketImportJson').value=payload.text||'';
      await preview();
      message('ChelScout visible market captured ✓ Review the preview, then Apply to Calgary Pool.','CAPTURED');
      setTimeout(()=>$('hsMarketImport')?.scrollIntoView({behavior:'smooth',block:'start'}),100);
    }catch(e){message('The transferred ChelScout market snapshot could not be read.','ERROR');}
  }

  function syncSourceUi(){
    const source=$('hsMarketImportSource')?.value;
    if($('hsMarketCompleteWrap'))$('hsMarketCompleteWrap').hidden=source!=='bid-board';
    previewRows=[];
    if($('hsMarketApply'))$('hsMarketApply').disabled=true;
  }

  function priceValue(v){
    if(v==null||v==='')return null;
    if(typeof v==='number'&&Number.isFinite(v))return Math.round(v<1000?v*1000000:v);
    const s=String(v).replace(/[$,\s]/g,'').toUpperCase();
    const m=s.match(/^(-?\d+(?:\.\d+)?)([MK])?$/);
    if(!m)return null;
    let n=Number(m[1]);
    if(m[2]==='M')n*=1000000;
    if(m[2]==='K')n*=1000;
    return Number.isFinite(n)?Math.round(n):null;
  }

  function first(obj,keys){
    for(const k of keys){
      const v=obj?.[k];
      if(v!==undefined&&v!==null&&v!=='')return v;
    }
    return null;
  }

  function playerObject(obj){
    const p=obj?.player;
    return p&&typeof p==='object'&&!Array.isArray(p)?p:null;
  }

  function toRow(obj,source){
    const p=playerObject(obj);
    const gamertag=first(obj,['username','gamertag','player_name','playerName','display_name','displayName'])||
      first(p,['username','gamertag','player_name','name','display_name']);
    const genericName=first(obj,['name']);
    const uid=first(obj,['chelscout_uid','user_id','userId','uid','player_uid','playerUid'])||
      first(p,['chelscout_uid','user_id','userId','uid','id']);
    const pos=first(obj,['position','pos','signed_position','played_position'])||first(p,['position','pos']);
    const hasPlayerSignal=gamertag||uid||p||(genericName&&pos);
    if(!hasPlayerSignal)return null;

    const name=gamertag||(genericName&&pos?genericName:null);
    if(!name&&!uid)return null;

    const league=first(obj,['league_short','league','league_name','current_league','level','tier']);
    const team=first(obj,['team','team_name','current_team','winning_team','signed_team','club']);
    const rawStatus=String(first(obj,['market_status','status','state','event','action','transaction_type','type'])||'').toLowerCase();
    const price=priceValue(first(obj,['winning_bid','winningBid','salary','price','amount','bid','contract_value','contractValue']));

    let marketStatus='unknown',isBiddable=null;
    if(source==='bid-board'){
      marketStatus='available';
      isBiddable=true;
    }else if(source==='signings'){
      const l=String(league||'').toLowerCase();
      marketStatus=l?'signed_'+l.replace(/[^a-z0-9]+/g,'_'):'signed';
      isBiddable=false;
    }else{
      const txt=(rawStatus+' '+String(first(obj,['description','message','label'])||'')).toLowerCase();
      if(/sign|won|roster|contract|awarded|claimed/.test(txt)){marketStatus='signed';isBiddable=false;}
      else if(/avail|biddable|open|released|waived|returned/.test(txt)){marketStatus='available';isBiddable=true;}
      else if(/withdraw|ineligible|remove|closed/.test(txt)){marketStatus='unavailable';isBiddable=false;}
      else marketStatus=rawStatus||'market_change';
    }

    return {
      uid:uid==null?null:Number(uid)||null,
      gamertag:name?String(name).trim():null,
      position:pos?String(pos).trim():null,
      league:league?String(league).trim().toUpperCase():null,
      team:team?String(team).trim():null,
      price,
      market_status:marketStatus,
      is_biddable:isBiddable
    };
  }

  function collect(root,source){
    const rows=[];
    const seenObjects=new WeakSet();
    function walk(v,depth=0){
      if(depth>12||v==null)return;
      if(Array.isArray(v)){v.forEach(x=>walk(x,depth+1));return;}
      if(typeof v!=='object')return;
      if(seenObjects.has(v))return;seenObjects.add(v);
      const row=toRow(v,source);
      if(row)rows.push(row);
      Object.values(v).forEach(x=>{if(x&&typeof x==='object')walk(x,depth+1);});
    }
    walk(root);
    const dedupe=new Map();
    for(const r of rows){
      const key=r.uid?('uid:'+r.uid):('name:'+norm(r.gamertag));
      if(!key||key==='name:')continue;
      const prev=dedupe.get(key)||{};
      dedupe.set(key,{...prev,...Object.fromEntries(Object.entries(r).filter(([,v])=>v!==null&&v!==''))});
    }
    return [...dedupe.values()];
  }

  function preview(){
    const source=$('hsMarketImportSource')?.value||'bid-board';
    const raw=$('hsMarketImportJson')?.value.trim();
    if(!raw)return message('Paste the ChelScout response JSON first.','EMPTY');
    let parsed;
    try{parsed=JSON.parse(raw);}catch(e){return message('That response is not valid JSON. Copy the Response body, not the request headers.','ERROR');}
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&parsed.uid&&Array.isArray(parsed.career)&&(parsed.fv_by_league||parsed.expect||parsed.dna)){
      previewRows=[];
      $('hsMarketApply').disabled=true;
      $('hsMarketPreviewBox').className='hs-empty';
      $('hsMarketPreviewBox').textContent='This is a single-player ChelScout scouting payload, not the bulk market board. It belongs in that player’s ChelScout Intelligence import.';
      return message('Player report detected. Find the request that returns the filtered market/player list after “Show players”.','PLAYER REPORT');
    }
    previewRows=collect(parsed,source);
    if(!previewRows.length)return message('I could not identify player rows in this response yet. Keep the JSON and send it to ChatGPT so the parser can be adapted to this exact ChelScout response.','NO PLAYERS');

    const signed=previewRows.filter(x=>x.is_biddable===false).length;
    const open=previewRows.filter(x=>x.is_biddable===true).length;
    const priced=previewRows.filter(x=>x.price!=null).length;
    const sample=previewRows.slice(0,8).map(x=>`<tr><td>${escapeHtml(x.gamertag||('UID '+x.uid))}</td><td>${escapeHtml(x.position||'—')}</td><td>${escapeHtml(x.market_status)}</td><td>${escapeHtml(x.league||'—')}</td><td>${escapeHtml(x.team||'—')}</td><td>${x.price==null?'—':'$'+Number(x.price).toLocaleString()}</td></tr>`).join('');
    $('hsMarketPreviewBox').className='';
    $('hsMarketPreviewBox').innerHTML=`<div class="hs-msg"><b>${previewRows.length.toLocaleString()} player rows found</b> · ${open} biddable · ${signed} unavailable/signed · ${priced} with price data</div><div class="hs-table-wrap" style="margin-top:9px"><table class="hs-table"><thead><tr><th>Player</th><th>Pos</th><th>Market</th><th>League</th><th>Team</th><th>Price</th></tr></thead><tbody>${sample}</tbody></table></div>`;
    $('hsMarketApply').disabled=false;
    message('Preview ready. Nothing has changed in Calgary yet.','PREVIEW');
  }

  async function apply(){
    if(!previewRows.length||!db()||!auth().user)return;
    const source=$('hsMarketImportSource')?.value||'bid-board';
    const complete=source==='bid-board'&&$('hsMarketComplete')?.value==='true';
    if(complete&&!confirm('This marks Calgary players NOT present in this imported bid board as not currently biddable. Continue only if this response contains the full bid board.'))return;
    $('hsMarketApply').disabled=true;
    message('Matching market rows to Calgary…','IMPORTING');
    try{
      const {data,error}=await db().rpc('apply_hitmen_market_import',{
        p_team_id:TEAM_ID,
        p_source:source,
        p_rows:previewRows,
        p_complete_snapshot:complete
      });
      if(error)throw error;
      const matched=Number(data?.matched||0),unmatched=Number(data?.unmatched||0);
      message(`Imported ✓ ${matched.toLocaleString()} matched Calgary players · ${unmatched.toLocaleString()} unmatched.`,'SYNCED');
      if($('hsMarketPreviewBox')){
        $('hsMarketPreviewBox').innerHTML+=`<p class="hs-msg" style="margin-top:10px"><b>Applied:</b> ${matched} matched. ${unmatched?('Unmatched sample: '+(data.unmatched_names||[]).slice(0,12).map(escapeHtml).join(' · ')):'No unmatched rows.'}</p>`;
      }
      setTimeout(()=>window.dispatchEvent(new CustomEvent('vvhl-auth-change',{detail:auth()})),100);
    }catch(e){
      message(e.message||'Market import failed.','ERROR');
      $('hsMarketApply').disabled=false;
    }
  }

  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function message(text,badge){
    if($('hsMarketImportMsg'))$('hsMarketImportMsg').textContent=text;
    if($('hsMarketImportBadge'))$('hsMarketImportBadge').textContent=badge||'';
  }

  const obs=new MutationObserver(inject);
  window.addEventListener('vvhl-auth-change',()=>setTimeout(inject,60));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();obs.observe(document.body,{subtree:true,childList:true});});
  else{inject();obs.observe(document.body,{subtree:true,childList:true});}
})();