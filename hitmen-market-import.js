(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  const $=id=>document.getElementById(id);
  const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  const isAdmin=()=>String(auth().profile?.role||'').toLowerCase()==='admin';

  let previewRows=[];

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
        <button id="hsMarketPreview" class="hs-btn" type="button">Preview Import</button>
        <button id="hsMarketApply" class="hs-btn primary" type="button" disabled>Apply to Calgary Pool</button>
        <span id="hsMarketImportMsg" class="hs-msg"></span>
      </div>
      <div id="hsMarketPreviewBox" class="hs-empty" style="margin-top:12px;text-align:left">Nothing previewed yet.</div>
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-weight:800">How to copy the ChelScout data</summary>
        <div class="hs-msg" style="margin-top:10px;line-height:1.65">
          1. Sign into ChelScout and open GM Hub.<br>
          2. Open browser DevTools → Network → Fetch/XHR.<br>
          3. Reload or open the Bid Board / Signings / Market Changes screen.<br>
          4. Select the matching network request, open Response, then Copy Response.<br>
          5. Paste it above, Preview, then Apply.<br><br>
          Never paste your Discord login cookie, authorization headers or password. Wildman only needs the JSON response body.
        </div>
      </details>`;
    pane.insertBefore(box,pane.firstChild);
    $('hsMarketImportSource').addEventListener('change',syncSourceUi);
    $('hsMarketPreview').addEventListener('click',preview);
    $('hsMarketApply').addEventListener('click',apply);
    syncSourceUi();
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