(() => {
  const db=()=>window.VVHLBackend?.db;
  const state=()=>window.VVHLBackend?.state||{};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const page=()=>String(location.pathname.split('/').pop()||'').toLowerCase();
  let timer=null;

  const labels={
    armed:['ARMED','Stream saved. Waiting for LIVE.'],
    queued:['QUEUED','Game is live and waiting for the capture worker.'],
    claimed:['CLAIMED','Railway claimed this game.'],
    capturing:['CAPTURING','Railway is recording the Twitch feed now.'],
    waiting_vod:['WAITING VOD','Game ended before an automatic capture started. Use the local recording fallback.'],
    captured:['CAPTURED','Recording finished and is being handed to VOD review.'],
    processing:['PROCESSING','Recording is moving through the VOD analysis worker.'],
    awaiting_ai:['AWAITING AI','Recording is safe, but the AI API connection is still required.'],
    ready_for_review:['REVIEW READY','Analysis is ready for human verification.'],
    failed:['NEEDS ATTENTION','Automatic capture failed. The local recording fallback is still available.'],
    cancelled:['CANCELLED','This media job was cancelled.']
  };
  const tone=s=>s==='ready_for_review'?'good':(['failed','waiting_vod'].includes(s)?'bad':(s==='awaiting_ai'?'warn':(['capturing','processing','queued','claimed','captured'].includes(s)?'live':'idle')));
  const fmtSeconds=n=>{n=Number(n);if(!Number.isFinite(n)||n<=0)return'';const m=Math.floor(n/60),s=Math.floor(n%60);return `${m}:${String(s).padStart(2,'0')}`;};
  const providerIcon=p=>p==='twitch'?'◉':p==='youtube'?'▶':'●';

  function host(){
    if(document.getElementById('livePipelineStatus'))return document.getElementById('livePipelineStatus');
    const managed=document.querySelector('[data-management-content]'); if(!managed)return null;
    const shell=managed.querySelector('.hitmen-shell,.section-shell')||managed;
    const section=document.createElement('section');
    section.id='livePipelineStatus';
    section.className='live-pipeline-panel';
    section.innerHTML=`<div class="live-pipeline-head"><div><div class="eyebrow">AUTOMATIC MEDIA PIPELINE</div><h3>Live Capture & Review Queue</h3><p>Paste the stream once. Wildman follows the game from LIVE through capture, VOD review and report prep.</p></div><div class="live-pipeline-health" id="livePipelineHealth">CHECKING</div></div><div id="livePipelineRows" class="live-pipeline-rows"><div class="live-pipeline-empty">Loading media queue…</div></div>`;
    if(page()==='hitmen-workspace.html'||page()==='hitmen'){
      const target=shell.querySelector('#hitmen-live-session')||shell.lastElementChild;
      target?.insertAdjacentElement('beforebegin',section);
    }else{
      const tabs=shell.querySelector('.tournament-tabs');
      tabs?.insertAdjacentElement('afterend',section);
      if(!tabs)shell.prepend(section);
    }
    return section;
  }

  async function workerHealth(){
    try{const r=await fetch('https://wildman-video-worker-production.up.railway.app/health',{cache:'no-store'});if(!r.ok)throw new Error();return await r.json();}catch{return null;}
  }

  async function teamFilter(query){
    if(!(page()==='hitmen-workspace.html'||page()==='hitmen'))return query;
    const teams=state().teams||[];
    let team=teams.find(t=>String(t.name||'').toLowerCase()==='calgary hitmen');
    if(!team){const {data}=await db().from('teams').select('id,name').eq('name','Calgary Hitmen').maybeSingle();team=data;}
    return team?.id?query.eq('team_id',team.id):query;
  }

  async function load(){
    if(!db()||!state().user)return;
    const root=host(); if(!root)return;
    try{
      let q=db().from('media_pipeline_queue').select('*').order('updated_at',{ascending:false}).limit(8);
      q=await teamFilter(q);
      const [{data:rows,error},health]=await Promise.all([q,workerHealth()]);
      if(error)throw error;
      const h=document.getElementById('livePipelineHealth');
      if(h){
        h.dataset.tone=health?.liveIngestion?'good':'bad';
        h.textContent=health?.liveIngestion?(health?.aiConfigured?'CAPTURE + AI ONLINE':'CAPTURE ONLINE · AI PENDING'):'CAPTURE WORKER OFFLINE';
      }
      const ids=(rows||[]).map(x=>x.id);
      let reviewMap=new Map();
      if(ids.length){
        const {data:reviews}=await db().from('vod_review_sessions').select('id,title,status,media_queue_id,worker_status').in('media_queue_id',ids);
        reviewMap=new Map((reviews||[]).map(r=>[r.media_queue_id,r]));
      }
      render(rows||[],reviewMap);
    }catch(e){
      const el=document.getElementById('livePipelineRows');
      if(el)el.innerHTML=`<div class="live-pipeline-empty error">${esc(e.message||'Could not load the media queue.')}</div>`;
    }
  }

  function render(rows,reviews){
    const el=document.getElementById('livePipelineRows');if(!el)return;
    if(!rows.length){el.innerHTML='<div class="live-pipeline-empty">No active media jobs yet. Add the Twitch URL to the game/session and the pipeline will arm automatically.</div>';return;}
    el.innerHTML=rows.map(r=>{
      const [title,desc]=labels[r.status]||[String(r.status||'UNKNOWN').toUpperCase(),'Pipeline state updated.'];
      const review=reviews.get(r.id);
      const source=r.source_kind==='team_game'?'HITMEN GAME':'TOURNAMENT GAME';
      const age=r.updated_at?new Date(r.updated_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';
      const dur=fmtSeconds(r.duration_seconds);
      const reviewLink=review?`<a class="small-btn" href="vod-lab.html${r.source_kind==='team_game'?'?team=calgary-hitmen':''}">Open VOD Review</a>`:'';
      return `<article class="live-pipeline-row" data-tone="${tone(r.status)}"><div class="live-pipeline-icon">${providerIcon(r.provider)}</div><div class="live-pipeline-copy"><div class="live-pipeline-meta"><span>${esc(source)}</span><span>${esc(String(r.provider||'external').toUpperCase())}</span>${age?`<span>${esc(age)}</span>`:''}${dur?`<span>${esc(dur)}</span>`:''}</div><strong>${esc(title)}</strong><p>${esc(desc)}</p>${r.last_error?`<small class="live-pipeline-error">${esc(r.last_error)}</small>`:''}</div><div class="live-pipeline-actions"><span class="pipeline-state-pill">${esc(title)}</span>${reviewLink}<a class="small-btn" href="${esc(r.stream_url)}" target="_blank" rel="noopener">Stream</a></div></article>`;
    }).join('');
  }

  function start(){host();load();timer=setInterval(()=>{if(!document.hidden)load();},5000);}
  window.addEventListener('vvhl-auth-change',()=>setTimeout(load,200));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
