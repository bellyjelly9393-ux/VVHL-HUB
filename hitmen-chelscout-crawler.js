(() => {
  const TEAM_ID='b0bcbdda-da9d-419d-8f61-b34937966d49';
  const ROOT_CHARS='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-. ';
  const STORAGE_PREFIX='hitmen-chelscout-crawl-v1:';
  const CAP=6;
  const MAX_DEPTH=5;
  const DELAY_MS=550;
  let running=false;
  let stopRequested=false;

  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const isAdmin=()=>String(auth().profile?.role||'').toLowerCase()==='admin';

  function stateKey(league,season){return STORAGE_PREFIX+league+':'+season;}
  function emptyState(league,season,label){
    return {league,season,label,queue:[...ROOT_CHARS].filter(x=>x.trim()||x==='_'||x==='-'||x==='.'),seenPrefixes:[],players:{},requests:0,errors:0,startedAt:new Date().toISOString(),complete:false};
  }
  function readState(league,season,label){
    try{
      const raw=localStorage.getItem(stateKey(league,season));
      if(raw){const x=JSON.parse(raw); if(x&&x.league===league&&Number(x.season)===Number(season))return x;}
    }catch{}
    return emptyState(league,season,label);
  }
  function saveState(s){localStorage.setItem(stateKey(s.league,s.season),JSON.stringify(s));}
  function removeState(league,season){localStorage.removeItem(stateKey(league,season));}

  function inject(){
    if(!isAdmin())return;
    const root=document.querySelector('[data-hitmen-scouting]');
    if(!root||document.getElementById('hsLeagueCrawler'))return;
    const card=document.createElement('section');
    card.id='hsLeagueCrawler';
    card.className='hs-card hs-admin-only';
    card.style.marginTop='14px';
    card.innerHTML=`
      <div class="hs-card-head">
        <div><div class="eyebrow">WILDMAN ADMIN · LEAGUE HISTORY</div><h3>ChelScout League Collector</h3></div>
        <span id="hsCrawlBadge" class="hs-tag">IDLE</span>
      </div>
      <p class="hs-msg">Collects ChelScout suggestion results slowly, deduplicates by LG/ChelScout user ID, and imports league history only for players already in Calgary's Season 55 pool.</p>
      <div class="hs-form">
        <label><span class="hs-label">League slug</span><input id="hsCrawlLeague" class="hs-input" value="lgechl"></label>
        <label><span class="hs-label">League label</span><input id="hsCrawlLabel" class="hs-input" value="ECHL"></label>
        <label><span class="hs-label">History season</span><input id="hsCrawlSeason" class="hs-input" type="number" value="54" min="1" max="99"></label>
      </div>
      <div class="hs-actions">
        <button id="hsCrawlStart" class="hs-btn primary" type="button">Start / Resume Collection</button>
        <button id="hsCrawlStop" class="hs-btn" type="button">Pause</button>
        <button id="hsCrawlImport" class="hs-btn" type="button">Import Matches Now</button>
        <button id="hsCrawlReset" class="hs-btn" type="button">Reset Saved Crawl</button>
      </div>
      <div id="hsCrawlStatus" class="hs-msg" style="margin-top:10px">Ready.</div>
    `;
    root.appendChild(card);
    document.getElementById('hsCrawlStart').onclick=start;
    document.getElementById('hsCrawlStop').onclick=()=>{stopRequested=true;};
    document.getElementById('hsCrawlImport').onclick=importMatches;
    document.getElementById('hsCrawlReset').onclick=reset;
    syncUi();
  }

  function values(){
    return {
      league:String(document.getElementById('hsCrawlLeague')?.value||'lgechl').trim().toLowerCase(),
      label:String(document.getElementById('hsCrawlLabel')?.value||'ECHL').trim().toUpperCase(),
      season:Number(document.getElementById('hsCrawlSeason')?.value||54)
    };
  }
  function status(text,badge){
    const el=document.getElementById('hsCrawlStatus');if(el)el.textContent=text;
    const b=document.getElementById('hsCrawlBadge');if(b&&badge)b.textContent=badge;
  }
  function syncUi(){
    const {league,label,season}=values();
    const s=readState(league,season,label);
    status(`${s.requests||0} requests · ${Object.keys(s.players||{}).length} unique players · ${s.queue?.length||0} prefixes remaining · ${s.errors||0} errors`,s.complete?'COMPLETE':running?'RUNNING':'SAVED');
  }

  async function suggest(q,league){
    const url='/api/chelscout-suggest?q='+encodeURIComponent(q)+'&league='+encodeURIComponent(league);
    const res=await fetch(url,{headers:{accept:'application/json'}});
    let body={};try{body=await res.json();}catch{}
    if(!res.ok){
      const e=new Error(body.error||('HTTP '+res.status));e.status=res.status;throw e;
    }
    return Array.isArray(body.results)?body.results:[];
  }

  function branch(prefix,queue,seen){
    if(prefix.length>=MAX_DEPTH)return;
    for(const ch of ROOT_CHARS){
      const next=prefix+ch;
      if(!seen.has(next)&&!queue.includes(next))queue.push(next);
    }
  }

  async function start(){
    if(running)return;
    const {league,label,season}=values();
    if(!/^lg[a-z0-9_-]{2,20}$/.test(league)){status('League slug is invalid.','ERROR');return;}
    running=true;stopRequested=false;
    const s=readState(league,season,label);
    const seen=new Set(s.seenPrefixes||[]);
    status('Collection running…','RUNNING');
    try{
      while(s.queue.length&&!stopRequested){
        const prefix=s.queue.shift();
        if(seen.has(prefix))continue;
        let results=[];
        try{
          results=await suggest(prefix,league);
          s.requests=(s.requests||0)+1;
          seen.add(prefix);
          s.seenPrefixes=[...seen];
          for(const p of results){
            const uid=String(p.user_id??'');
            if(!uid)continue;
            s.players[uid]=p;
          }
          if(results.length>=CAP)branch(prefix,s.queue,seen);
          saveState(s);
          syncUi();
          await sleep(DELAY_MS);
        }catch(e){
          s.errors=(s.errors||0)+1;
          s.queue.push(prefix);
          saveState(s);
          status(`Paused after ${e.status||'network'} error. Saved progress is safe.`,'PAUSED');
          if(e.status===429)await sleep(10000);
          else await sleep(3000);
          stopRequested=true;
        }
      }
      if(!s.queue.length&&!stopRequested){s.complete=true;saveState(s);status(`Collection complete · ${Object.keys(s.players).length} unique ${label} players found.`,'COMPLETE');}
      else if(stopRequested)syncUi();
    }finally{running=false;}
  }

  async function fetchPool(){
    const all=[];const batch=1000;
    for(let from=0;;from+=batch){
      const r=await db().from('team_scouting_pool')
        .select('scouting_player_id,scouting_players(id,gamertag)')
        .eq('team_id',TEAM_ID).order('id',{ascending:true}).range(from,from+batch-1);
      if(r.error)throw r.error;
      all.push(...(r.data||[]));
      if((r.data||[]).length<batch)break;
    }
    return all;
  }

  async function importMatches(){
    if(!db()||!auth().user){status('Sign in first.','ERROR');return;}
    const {league,label,season}=values();
    const s=readState(league,season,label);
    const collected=Object.values(s.players||{});
    if(!collected.length){status('No collected players to import yet.','EMPTY');return;}
    status('Matching collected players to Calgary pool…','IMPORTING');
    try{
      const pool=await fetchPool();
      const map=new Map(pool.map(x=>[norm(x.scouting_players?.gamertag),x]));
      const rows=[];
      for(const p of collected){
        const hit=map.get(norm(p.username));if(!hit)continue;
        rows.push({
          team_id:TEAM_ID,
          scouting_player_id:hit.scouting_player_id,
          source:'chelscout',
          source_player_uid:Number(p.user_id)||null,
          season,
          league:String(p.league_short||p.league||label).toUpperCase(),
          league_id:Number(p.league_id)||null,
          team_name:p.team||null,
          position:p.position||null,
          phase:'regular',
          stats:{player_type:p.player_type||null,source_username:p.username||null},
          imported_by:auth().user.id,
          imported_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        });
      }
      let imported=0;
      for(let i=0;i<rows.length;i+=200){
        const chunk=rows.slice(i,i+200);
        const r=await db().from('team_player_league_history').upsert(chunk,{onConflict:'team_id,scouting_player_id,source,season,league,phase'});
        if(r.error)throw r.error;
        imported+=chunk.length;
      }
      status(`Imported ${imported} ${label} history matches from ${collected.length} collected players.`,'IMPORTED');
    }catch(e){console.error(e);status(e.message||'Import failed.','ERROR');}
  }

  function reset(){
    const {league,label,season}=values();
    if(!confirm(`Reset saved ${label} S${season} crawl progress?`))return;
    removeState(league,season);syncUi();
  }

  const observer=new MutationObserver(()=>inject());
  window.addEventListener('vvhl-auth-change',()=>setTimeout(inject,0));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{inject();observer.observe(document.body,{subtree:true,childList:true});});
  else{inject();observer.observe(document.body,{subtree:true,childList:true});}
})();
