(() => {
  if(window.WildmanVODPipelineInstalled)return;window.WildmanVODPipelineInstalled=true;
  const WORKER='https://wildman-video-worker-production.up.railway.app';
  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  let pollTimer=null;
  let busy=false;
  let checking=false;
  let savedState=null;
  async function durableState(reviewId,job=null){
    const [r,s,p]=await Promise.all([
      db().from('vod_review_sessions').select('*').eq('id',reviewId).maybeSingle(),
      db().from('vod_review_segments').select('*').eq('review_id',reviewId),
      db().from('vod_game_publications').select('active,report').eq('review_id',reviewId).maybeSingle()
    ]);
    if(r.error)throw r.error;if(s.error)throw s.error;if(p.error)throw p.error;
    return r.data?window.WildmanVODReview.reconcile(r.data,s.data,p.data,job):null;
  }
  function showDurable(state){
    if(!state?.usableEvidence)return false;
    const text=state.next+(state.recovered?' Raw recording retrieval failed earlier; the saved reports remain available.':'');
    setStatus(text,state.analysisComplete?'good':'warn');
    const b=document.getElementById('vodAnalyzeGame');if(b)b.textContent=state.analysisComplete?'View Reports':'Continue Analysis';
    return true;
  }
  async function showAttemptError(error,fallback){
    const message=error.message||fallback;
    try{
      const state=await durableState(selectedReviewId());
      if(state?.usableEvidence){setStatus(`New attempt failed: ${message} Saved evidence is preserved. ${state.next}`,'warn');return;}
    }catch{}
    setStatus(message,'bad');
  }

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selectedReviewId=()=>document.querySelector('.vod-row.active')?.dataset?.vodId||'';
  const statusEl=()=>document.getElementById('vodPipelineStatus');
  function setStatus(text,tone=''){
    const el=statusEl(); if(!el)return;
    if(el.textContent!==text)el.textContent=text;
    if(el.dataset.tone!==tone)el.dataset.tone=tone;
  }

  function normalizeTwitchReplay(value){
    try{
      const u=new URL(String(value||'').trim());
      if(u.protocol!=='https:'||!['twitch.tv','www.twitch.tv'].includes(u.hostname.toLowerCase()))return '';
      const m=u.pathname.match(/^\/(?:videos|v)\/(\d+)\/?$/)||u.pathname.match(/^\/[^/]+\/v\/(\d+)\/?$/);
      return m?`https://www.twitch.tv/videos/${m[1]}`:'';
    }catch{return '';}
  }
  function parseClock(value){
    const s=String(value??'').trim();if(!s)return null;
    if(/^\d+$/.test(s))return Number(s);
    const parts=s.split(':').map(Number);if(parts.some(Number.isNaN)||parts.length>3)return null;
    if(parts.length===2)return parts[0]*60+parts[1];
    if(parts.length===3)return parts[0]*3600+parts[1]*60+parts[2];
    return null;
  }
  function fmtClock(seconds){
    const n=Math.max(0,Math.floor(Number(seconds)||0)),h=Math.floor(n/3600),m=Math.floor((n%3600)/60),s=n%60;
    return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
  }

  async function token(){
    const {data,error}=await db().auth.getSession();
    if(error)throw error;
    const t=data?.session?.access_token;
    if(!t)throw new Error('Sign in again before starting video analysis.');
    return t;
  }

  async function workerFetch(path,options={}){
    const t=await token();
    const headers={...(options.headers||{}),Authorization:`Bearer ${t}`};
    const res=await fetch(WORKER+path,{...options,headers});
    let body={}; try{body=await res.json();}catch{}
    if(!res.ok){
      const error=new Error(body.error||`Video worker returned HTTP ${res.status}`);
      error.code=body.code||"";
      error.httpStatus=res.status;
      throw error;
    }
    return body;
  }

  async function currentReview(){
    const id=selectedReviewId(); if(!id)return null;
    const {data,error}=await db().from('vod_review_sessions').select('*').eq('id',id).maybeSingle();
    if(error)throw error; return data;
  }

  function ensureScoutMode(review){
    const mode=String(review?.intake_mode||'scout').toLowerCase();
    if(mode==='scout')return true;
    if(mode==='media')throw new Error('Media mode keeps this source available for Tournament Center and postgame content without starting scouting analysis. Change the intake mode to Scout before analyzing.');
    throw new Error('Archive mode stores the source only and does not start the analysis worker. Change the intake mode to Scout before analyzing.');
  }

  async function periodsFor(reviewId){
    const {data,error}=await db().from('vod_review_segments').select('id,label,segment_type,segment_index,start_seconds,end_seconds,archived_at').eq('review_id',reviewId).in('segment_type',['period','overtime']).order('start_seconds');
    if(error)throw error;
    return (data||[]).filter(s=>!s.archived_at&&s.end_seconds!=null).map(s=>({id:s.id,label:s.label,start:Number(s.start_seconds),end:Number(s.end_seconds)}));
  }
  async function requiredPeriodsImported(reviewId){
    const {data,error}=await db().from('vod_review_segments').select('segment_type,segment_index,analysis_summary,archived_at').eq('review_id',reviewId).eq('segment_type','period');
    if(error)throw error;
    const periods=(data||[]).filter(p=>!p.archived_at);
    return [1,2,3].every(index=>periods.some(p=>Number(p.segment_index)===index&&String(p.analysis_summary||'').trim()));
  }
  const sourceOffset=review=>Math.max(0,Number(review?.source_start_seconds)||0);
  const isOvertimeLabel=value=>/over|\bot\b/i.test(String(value||''));
  async function linkedFinalOvertime(review){
    if(!review?.schedule_game_id)return null;
    const {data,error}=await db().from('hitmen_schedule_games').select('status,overtime').eq('id',review.schedule_game_id).maybeSingle();
    if(error)throw error;
    if(!data||data.status!=='final')return null;
    return data.overtime===true;
  }
  function normalizePeriodReports(reports,noOvertime){
    if(!noOvertime)return reports||[];
    const list=reports||[],third=list.filter(p=>p?.label==='Period 3'),ots=list.filter(p=>isOvertimeLabel(p?.label));
    if(!ots.length)return list;
    const merged=[...third,...ots],base=third[0]||ots[0]||{};
    const report={...(base.report||{})};
    for(const key of ['summary','player_report','tactical_report']){
      const parts=merged.map(p=>String(p?.report?.[key]||'').trim()).filter(Boolean);
      if(parts.length)report[key]=[...new Set(parts)].join('\n\n');
    }
    return [...list.filter(p=>p?.label!=='Period 3'&&!isOvertimeLabel(p?.label)),{...base,label:'Period 3',report}];
  }
  const workerPeriods=(review,periods)=>{
    const offset=sourceOffset(review);
    return periods.map(p=>({label:p.label,start:Math.max(0,p.start-offset),end:Math.max(0,p.end-offset)}));
  };

  function install(){
    const detail=document.getElementById('vodDetail');
    if(!detail||document.getElementById('vodPipelinePanel'))return;
    // Step 2 (Analyze) sits right under Step 1 (period times).
    const anchor=document.getElementById('manualPeriodBuilder')||detail.querySelector('.vod-detail-head'); if(!anchor)return;
    const panel=document.createElement('div');
    panel.id='vodPipelinePanel'; panel.className='analysis-note'; panel.style.marginTop='16px';
    panel.innerHTML=`<div class="eyebrow">GAME ANALYSIS</div><h3 style="margin:6px 0 8px">Step 2 · Analyze Game</h3><p>Analyze Game sends the saved period times to the video worker. Pressing it again reuses the same job: unchanged periods are not paid for twice, and changed times re-run only that game.</p><div class="vod-actions"><button id="vodAnalyzeGame" class="small-btn primary" type="button">Analyze Game</button></div><details id="vodPipelineAdvanced"><summary>Advanced Tools</summary><div class="vod-actions"><button id="vodCheckPipeline" class="small-btn" type="button">Check Status</button><button id="vodRetryPipeline" class="small-btn" type="button">Continue / Retry</button><button id="vodRefreshReport" class="small-btn" type="button">Refresh Detailed Report</button><button id="vodEliteReanalyze" class="small-btn" type="button">Re-run Elite Scout</button></div>
    <details id="vodTwitchConnect" style="margin-top:12px"><summary>Twitch Retrieval Connection <span id="vodTwitchAuthBadge" class="status-pill" style="margin-left:8px">CHECKING</span></summary><p><strong>Only needed when Twitch blocks anonymous VOD playback.</strong> Paste the Twitch website <code>auth-token</code> here, never into chat. It is stored privately on the Railway worker and is not written to logs.</p><div class="vod-form"><label class="wide">Twitch web auth-token<input id="vodTwitchToken" class="field mono" type="password" autocomplete="off" placeholder="Private token · not your password"></label></div><div class="vod-actions"><button id="vodSaveTwitchAuth" class="small-btn primary" type="button">Connect Twitch Retrieval</button><button id="vodClearTwitchAuth" class="small-btn" type="button">Disconnect</button><span id="vodTwitchAuthMsg" class="copy-feedback"></span></div><small>This token can grant broad Twitch account access. Use it only on this private management page and revoke it from Twitch Security if you no longer want the worker connected.</small></details>
    <details style="margin-top:12px"><summary>Recording source / game window / upload fallback</summary><p>Use the exact Twitch replay plus the start and end of this game inside the full broadcast. The worker retrieves bounded slices of this game and keeps each period separate.</p><div class="vod-form"><label class="wide">Saved Twitch replay URL<input id="vodReplayUrl" class="field" type="url" placeholder="https://www.twitch.tv/videos/..."></label><label>Game starts in full VOD<input id="vodSourceStart" class="field mono" placeholder="0:00"></label><label>Game ends in full VOD<input id="vodSourceEnd" class="field mono" placeholder="28:40"></label><label>Game format<select id="vodGameFormat" class="select-field"><option value="6s">6s</option><option value="4s">4s</option><option value="3s">3s</option><option value="HUT">HUT</option><option value="unknown">Unknown</option></select></label><label class="wide">Lineup / scouting context<textarea id="vodScoutingContext" class="text-input" placeholder="Calgary: LW ..., C ..., RW ..., LD ..., RD ..., G ...&#10;Opponent: ..."></textarea></label></div><button id="vodSaveReplay" class="small-btn" type="button">Save source + game window</button><p>Or upload an MP4 / MOV recording containing this game:</p><input id="vodPipelineFile" class="field" type="file" accept="video/mp4,video/quicktime,.mp4,.mov"><button id="vodStartPipeline" class="small-btn" type="button">Upload & Start Pipeline</button></details></details><small id="vodPipelineStatus">Save the period times, then press Analyze Game.</small>`;
    anchor.insertAdjacentElement('afterend',panel);
    document.getElementById('vodStartPipeline')?.addEventListener('click',start);
    document.getElementById('vodCheckPipeline')?.addEventListener('click',checkSelected);
    document.getElementById('vodRetryPipeline')?.addEventListener('click',retry);
    document.getElementById('vodRefreshReport')?.addEventListener('click',refreshDetailedReport);
    document.getElementById('vodEliteReanalyze')?.addEventListener('click',reanalyzeElite);
    document.getElementById('vodAnalyzeGame')?.addEventListener('click',async()=>{
      try{const r=await currentReview();if(!r)return;
        const state=await durableState(r.id);
        if(state?.analysisComplete){document.getElementById('gameReviewLayers')?.scrollIntoView({behavior:'smooth'});return;}
        return analyzeGame();
      }catch(e){setStatus(e.message,'bad');}
    });
    document.getElementById('vodSaveReplay')?.addEventListener('click',saveReplay);
    document.getElementById('vodSaveTwitchAuth')?.addEventListener('click',saveTwitchAuth);
    document.getElementById('vodClearTwitchAuth')?.addEventListener('click',clearTwitchAuth);
    syncTwitchAuth();
    syncStoredStatus();
  }

  async function syncTwitchAuth(){
    const badge=document.getElementById('vodTwitchAuthBadge');
    const msg=document.getElementById('vodTwitchAuthMsg');
    try{
      const status=await workerFetch('/twitch-auth');
      if(badge){badge.textContent=status.configured?'AUTH CONNECTED':'PUBLIC ONLY';badge.dataset.tone=status.configured?'good':'warn';}
      if(msg)msg.textContent=status.configured?'Authenticated VOD fallback is available.':'Public Twitch retrieval will be tried first. If Twitch blocks this VOD, connect authenticated retrieval below.';
      const clear=document.getElementById('vodClearTwitchAuth');if(clear)clear.disabled=!status.configured;
    }catch(e){
      if(badge)badge.textContent='UNAVAILABLE';
      if(msg)msg.textContent=e.message||'Could not check Twitch connection.';
    }
  }

  async function saveTwitchAuth(){
    const input=document.getElementById('vodTwitchToken');
    const msg=document.getElementById('vodTwitchAuthMsg');
    const value=input?.value.trim()||'';
    if(!value){if(msg)msg.textContent='Paste the private Twitch auth-token first.';return;}
    try{
      await workerFetch('/twitch-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:value})});
      input.value='';
      if(msg)msg.textContent='Twitch retrieval connected. Retry Analyze Game.';
      await syncTwitchAuth();
    }catch(e){if(msg)msg.textContent=e.message||'Could not connect Twitch retrieval.';}
  }

  async function clearTwitchAuth(){
    if(!confirm('Disconnect authenticated Twitch VOD retrieval from the worker?'))return;
    const msg=document.getElementById('vodTwitchAuthMsg');
    try{
      await workerFetch('/twitch-auth',{method:'DELETE'});
      if(msg)msg.textContent='Twitch retrieval disconnected.';
      await syncTwitchAuth();
    }catch(e){if(msg)msg.textContent=e.message||'Could not disconnect Twitch retrieval.';}
  }

  async function saveReplay(){
    try{
      const review=await currentReview();if(!review)return;
      const raw=document.getElementById('vodReplayUrl').value.trim();
      const url=normalizeTwitchReplay(raw);
      if(!url)throw new Error('Paste a Twitch replay link such as twitch.tv/videos/123… or a Twitch share link such as twitch.tv/channel/v/123…');
      const start=parseClock(document.getElementById('vodSourceStart')?.value||'0:00');
      const end=parseClock(document.getElementById('vodSourceEnd')?.value);
      if(start==null||start<0)throw new Error('Game start must look like 12:30 or 1:02:15.');
      if(document.getElementById('vodSourceEnd')?.value.trim()&&end==null)throw new Error('Game end must look like 38:45 or 1:22:10.');
      if(end!=null&&end<=start)throw new Error('Game end must be after game start.');
      const changedWindow=start!==sourceOffset(review)||(end??null)!==(review.source_end_seconds==null?null:Number(review.source_end_seconds));
      if(changedWindow&&review.worker_job_id&&review.worker_status)throw new Error('This review already started processing. Create a fresh review before changing its source game window.');
      const payload={
        vod_url:url,source_provider:'twitch',source_start_seconds:start,source_end_seconds:end,
        duration_seconds:end!=null?end-start:review.duration_seconds,
        game_format:document.getElementById('vodGameFormat')?.value||review.game_format||'6s',
        scouting_context:document.getElementById('vodScoutingContext')?.value.trim()||null,
        updated_at:new Date().toISOString()
      };
      const {data,error}=await db().from('vod_review_sessions').update(payload).eq('id',review.id).select('id');
      if(error)throw error;if(!data?.length)throw new Error('Replay source was not saved. Check your access.');
      document.getElementById('vodReplayUrl').value=url;
      setStatus(end!=null?`Source saved. Railway will retrieve only ${fmtClock(start)} → ${fmtClock(end)}. Press Analyze Game.`:'Replay link saved. Add a game end before Analyze Game if this VOD contains more than one game.','good');
    }catch(e){setStatus(e.message,'bad');}
  }

  async function analyzeGame(){
    if(busy)return;busy=true;
    const button=document.getElementById('vodAnalyzeGame');button.disabled=true;
    try{
      const review=await currentReview();if(!review)throw new Error('Select a game first.');
      ensureScoutMode(review);
      const {data:segments,error:segError}=await db().from('vod_review_segments').select('*').eq('review_id',review.id);
      if(segError)throw segError;
      const model=window.WildmanVODReview;
      const problems=model.periodErrors(review,segments||[]);
      if(problems.length){
        document.getElementById('manualPeriodBuilder')?.setAttribute('open','');
        throw new Error('Save the period times first (Step 1). '+problems.join(' '));
      }
      const periods=model.workerPeriods(review,segments||[]);
      setStatus('Sending the period times to the video worker…');
      const {job}=await workerFetch(`/reviews/${encodeURIComponent(review.id)}/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        source_start_seconds:sourceOffset(review),source_end_seconds:Number(review.source_end_seconds),
        overtime_confirmed:periods.some(p=>/^Overtime/.test(p.label)),periods})});
      if(!job)throw new Error('The video worker did not return a job.');
      // The game keeps the job the worker answered with; the poller never swaps it afterwards.
      const {error}=await db().from('vod_review_sessions').update({worker_job_id:job.id,worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
      if(error)throw error;
      if(selectedReviewId()!==review.id)return;
      setStatus('Analysis queued with your period times.','good');
      beginPoll(job.id,review.id);
    }catch(e){
      const msg=e.code==='periods_required'?'Save the period times first (Step 1), then press Analyze Game.':(e.message||'Could not start the analysis.');
      setStatus(msg,'bad');
      if(/twitch.*(blocked|authenticated|authentication)|anonymous replay playback/i.test(msg)){
        const details=document.getElementById('vodTwitchConnect');
        const badge=document.getElementById('vodTwitchAuthBadge');
        const authMsg=document.getElementById('vodTwitchAuthMsg');
        if(details)details.open=true;
        if(badge){badge.textContent='AUTH REQUIRED';badge.dataset.tone='bad';}
        if(authMsg)authMsg.textContent='This VOD was rejected by Twitch public playback. Connect Twitch Retrieval here, then press Analyze Game again.';
      }
    }
    finally{busy=false;button.disabled=false;}
  }

  async function queueBatchReviews(reviewIds){
    const ids=[...new Set((reviewIds||[]).filter(Boolean))].slice(0,8);
    if(!ids.length)return;
    const status=document.getElementById('batchVodStatus');
    let queued=0,failed=0;
    try{
      const healthResponse=await fetch(WORKER+'/health',{cache:'no-store'});
      const health=healthResponse.ok?await healthResponse.json():null;
      if(status&&health?.storage){
        const free=Math.max(0,Math.floor(Number(health.storage.usableBytes||0)/1024/1024));
        status.textContent=`Worker ready · ${free} MB usable temporary space · queueing ${ids.length} games…`;
      }
    }catch{}
    for(let i=0;i<ids.length;i++){
      const reviewId=ids[i];
      try{
        if(status)status.textContent=`Queueing game ${i+1}/${ids.length}…`;
        const {job}=await workerFetch(`/reviews/${encodeURIComponent(reviewId)}/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        if(!job)throw new Error('No recording job was created.');
        const {error}=await db().from('vod_review_sessions').update({
          worker_job_id:job.id||null,
          worker_status:job.status,
          worker_updated_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        }).eq('id',reviewId);
        if(error)throw error;
        queued++;
      }catch(e){
        failed++;
        console.error('Batch VOD queue failed',reviewId,e);
      }
    }
    if(status){
      status.textContent=failed
        ?`Queued ${queued}/${ids.length} games. ${failed} could not enter the queue; use Continue / Retry on those reviews.`
        :`Queued all ${queued} games. Railway will retrieve, analyze and release each Twitch clip as it finishes.`;
    }
    document.getElementById('refreshVod')?.click();
  }

  async function start(){
    if(busy)return; busy=true;
    const button=document.getElementById('vodStartPipeline'); if(button)button.disabled=true;
    try{
      const review=await currentReview();
      if(!review)throw new Error('Select a VOD review first.');
      ensureScoutMode(review);
      const periods=await periodsFor(review.id);
      const localPeriods=workerPeriods(review,periods);
      const file=document.getElementById('vodPipelineFile')?.files?.[0];
      if(!file)throw new Error('Choose the MP4 or MOV recording first.');
      const healthResponse=await fetch(WORKER+'/health',{cache:'no-store'});
      if(!healthResponse.ok)throw new Error('Video worker is unavailable. Try again shortly.');
      const health=await healthResponse.json();
      if(file.size>health.maxUploadBytes)throw new Error(`This recording exceeds the current ${Math.floor(health.maxUploadBytes/1024/1024)} MB limit.`);
      setStatus('Creating secure video job…');
      const job=await workerFetch('/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game_id:review.id,title:review.title||'Game VOD',vod_url:review.vod_url||'',players:review.scouting_context||'',game_format:review.game_format||'6s',vod_offset_seconds:sourceOffset(review),periods:localPeriods.length>=3?localPeriods:[]})});
      await db().from('vod_review_sessions').update({worker_job_id:job.id,worker_status:job.status,source_file_name:file.name,worker_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',review.id);
      setStatus(`Uploading ${file.name}… keep this tab open until the upload finishes.`);
      const uploaded=await workerFetch(`/jobs/${encodeURIComponent(job.id)}/upload`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});
      await db().from('vod_review_sessions').update({worker_status:uploaded.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
      setStatus(periods.length>=3?'Upload complete. Railway is processing your saved period windows.':'Upload complete. Railway is detecting P1/P2/P3 automatically.','good');
      beginPoll(job.id,review.id);
    }catch(e){await showAttemptError(e,'Could not start video pipeline.');}
    finally{busy=false;if(button)button.disabled=false;}
  }

  async function checkSelected(){
    try{
      const review=await currentReview(); if(!review)throw new Error('Select a VOD review first.');
      // A published review is durable state. Do not let an old successful worker job
      // trigger another ingest or make the UI wait on evidence that is already saved.
      // Failed/expired attempts still flow through checkJob so management sees the
      // recovery warning while the published report remains protected.
      const durable=await durableState(review.id);
      if(durable?.published&&!['failed','expired'].includes(durable.rawStatus)){
        showDurable(durable);
        return;
      }
      await checkJob(review.worker_job_id,review.id,true);
    }catch(e){setStatus(e.message||'Could not check pipeline.','bad');}
  }

  async function retry(){
    try{
      const review=await currentReview(); if(!review)return;
      ensureScoutMode(review);
      // Anything that needs the period times (re)applied goes through Analyze Game, which reuses the same job.
      if(!review.worker_job_id||!review.worker_status||['needs_periods','failed','expired'].includes(review.worker_status))return analyzeGame();
      const job=await workerFetch(`/jobs/${encodeURIComponent(review.worker_job_id)}/retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      await db().from('vod_review_sessions').update({worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
      setStatus('Retry queued. Saved parts are kept; only what is missing runs again.','good');
      beginPoll(review.worker_job_id,review.id);
    }catch(e){await showAttemptError(e,'Retry is not available yet.');}
  }

  async function refreshDetailedReport(){
    try{
      const review=await currentReview();if(!review)return;
      ensureScoutMode(review);
      setStatus('Rebuilding the detailed scouting report from saved reviewed evidence…');
      const response=await workerFetch(`/reviews/${encodeURIComponent(review.id)}/refresh-report`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const job=response?.job;if(!job?.id)throw new Error('The worker did not start the saved-evidence report refresh.');
      const {error}=await db().from('vod_review_sessions').update({worker_job_id:job.id,worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
      if(error)throw error;
      setStatus('Saved video evidence is being re-synthesized into the detailed team, unit and player report. The video itself is not being re-analyzed.','good');
      beginPoll(job.id,review.id);
    }catch(e){await showAttemptError(e,'Detailed report refresh could not be started.');}
  }

  async function reanalyzeElite(){
    try{
      const review=await currentReview();
      if(!review?.worker_job_id)throw new Error('There is no saved recording to re-analyze yet.');
      ensureScoutMode(review);
      if(!confirm('Run a fresh Elite Scout pass on the saved recording? New evidence is saved as a separate draft; existing reviewed reports are preserved.'))return;
      setStatus('Starting a fresh elite scouting pass on the saved recording…');
      const job=await workerFetch(`/jobs/${encodeURIComponent(review.worker_job_id)}/reanalyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const {error:reviewError}=await db().from('vod_review_sessions').update({worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
      if(reviewError)throw reviewError;
      setStatus('New analysis queued as a separate draft. Saved period evidence and approvals are preserved.','good');
      beginPoll(review.worker_job_id,review.id);
    }catch(e){
      await showAttemptError(e,'Fresh scout pass could not be started.');
    }
  }

  function beginPoll(jobId,reviewId){
    clearInterval(pollTimer);
    checkJob(jobId,reviewId,false);
    pollTimer=setInterval(()=>checkJob(jobId,reviewId,false),5000);
  }

  async function checkJob(jobId,reviewId,loud=false){
    if(checking)return;checking=true;
    try{
      savedState=await durableState(reviewId);
      if(selectedReviewId()!==reviewId)return;
      const response=await workerFetch(`/reviews/${encodeURIComponent(reviewId)}/job`);
      const job=response.job;
      if(selectedReviewId()!==reviewId)return;
      if(!job){if(!showDurable(savedState)&&loud)setStatus('Save the period times, then press Analyze Game.');return;}
      if(job.waiting_for_capture){if(!showDurable(savedState))setStatus(`Game capture: ${job.status}. Waiting for the saved recording; no upload needed.`,'good');return;}
      // Never silently move a game onto a different job: only link when it has none yet.
      const {data:link,error:linkError}=await db().from('vod_review_sessions').select('worker_job_id,worker_status').eq('id',reviewId).maybeSingle();
      if(linkError)throw linkError;
      if(link?.worker_job_id&&link.worker_job_id!==job.id){
        setStatus('This game is linked to a different analysis job than the worker reported. Press Analyze Game to continue with the period times saved here.','warn');
        clearInterval(pollTimer);pollTimer=null;return;
      }
      if(!link?.worker_job_id||link.worker_status!==job.status){
        const {error:saveError}=await db().from('vod_review_sessions').update({worker_job_id:job.id,worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',reviewId);
        if(saveError)throw saveError;
      }
      savedState=await durableState(reviewId,job);
      if(selectedReviewId()!==reviewId)return;
      const done=['ready_for_review','failed','expired','awaiting_ai','needs_periods'].includes(job.status);
      if(savedState?.analysisComplete&&job.status!=='ready_for_review'){showDurable(savedState);}
      else if(job.status==='needs_periods'){
        if(selectedReviewId()===reviewId)document.getElementById('manualPeriodBuilder')?.setAttribute('open','');
        setStatus('Enter the period times in Step 1, save them, then press Analyze Game. Nothing is analyzed until the times are set.','warn');
      }
      else if(job.status==='awaiting_ai')setStatus(job.result?.period_detection==='auto'?'Periods detected automatically ✓ Video is split and ready. AI scouting is the only remaining connection. No re-upload needed.':'Video validated and split into period-sized work. AI is not connected to Railway yet. No re-upload is needed once the AI connection is added.','warn');
      else if(job.status==='ready_for_review'){
        const review=await currentReview();
        const periodsImported=await requiredPeriodsImported(reviewId);
        if(periodsImported&&((review?.pending_worker_result?.website_imported===true&&review.pending_worker_result?.import_key===importKey(job))||(review?.worker_result?.website_imported===true&&review?.worker_result?.import_key===importKey(job))))setStatus('Analysis is saved. Review the notes and game report below.','good');
        else{
          setStatus(periodsImported?'Refreshing completed worker evidence…':'Completed worker analysis found. Repairing missing period evidence…','good');
          await ingest(job,reviewId);
        }
      }
      else if(job.status==='failed'||job.status==='expired'){
        const code=job.result?.failure_code||'';
        let msg=job.error||`Pipeline ${job.status}.`;
        if(code==='storage_limit_exceeded')msg='Temporary storage cap reached before this clip could fit. Completed Twitch clips are released automatically; press Continue / Retry after the older job finishes.';
        if(code==='clip_size_exceeded')msg='This game window is larger than the configured clip-size cap. Shorten the saved start/end window, then create a fresh review for that game.';
        if(code==='queue_full')msg='The video queue is full. Let an older game finish, then press Continue / Retry.';
        if(!showDurable(savedState))setStatus(msg,'bad');
        if(!savedState?.usableEvidence&&/twitch.*(blocked|authenticated|authentication)|anonymous replay playback/i.test(msg)){
          const details=document.getElementById('vodTwitchConnect');
          const badge=document.getElementById('vodTwitchAuthBadge');
          if(details)details.open=true;
          if(badge){badge.textContent='AUTH REQUIRED';badge.dataset.tone='bad';}
        }
      }
      else if(job.status==='queued'&&/rate limit|cooling down/i.test(job.error||''))setStatus(job.error,'warn');
      else {
        const stageLabels={scanning_period_boundaries:'Finding P1 / P2 / P3 from game clock',scanning_next_clock_slice:'Scanning next clock section',period_boundaries_locked:'P1 / P2 / P3 locked',analyzing_period:'Analyzing current period',writing_period_report:'Saving current period report',retrieving_next_period:'Retrieving next period',needs_period_boundaries:'Period detection needs review',watching_game_clock:'Watching game clock / period',analyzing_period_slice:'Analyzing current period slice',checking_period_sequences:'Reviewing key sequences',retrieving_next_period_slice:'Retrieving next period slice',writing_report:'Building full-game report',preparing_video:'Preparing video',analyzing_video:'Analyzing video',checking_sequences:'Reviewing key sequences'};
        const stage=stageLabels[job.result?.stage]||String(job.status).replaceAll('_',' ');
        const scan=job.result?.scan_unit_count?` · clock scan ${Number(job.result.scan_unit_index||0)+1}/${job.result.scan_unit_count}`:'';
        const period=job.result?.period_count?` · period ${Number(job.result.period_index||0)+1}/${job.result.period_count}`:'';
        const slice=job.result?.stream_unit_count?` · slice ${Number(job.result.stream_unit_index||0)+1}/${job.result.stream_unit_count}`:'';

        const chunks=job.result?.total_chunks?` · ${job.result.chunks?.length||0}/${job.result.total_chunks} chunks`:'';
        setStatus(`Pipeline: ${stage}${scan}${period}${slice}${chunks}`,'good');
      }
      if(done){clearInterval(pollTimer);pollTimer=null;}
      if(loud&&job.status==='ready_for_review')document.getElementById('refreshVod')?.click();
    }catch(e){if(selectedReviewId()===reviewId&&!showDurable(savedState))setStatus(e.message||'Could not reach video worker. Retrying…','bad');}finally{checking=false;}
  }

  function importKey(job){
    const text=JSON.stringify([job.id,job.result?.review_version,job.result?.game_rollup,job.result?.period_reports,job.result?.chunks]);
    let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return `${job.id}:${text.length}:${hash>>>0}`;
  }
  async function ingest(job,reviewId){
    const model=window.WildmanVODReview;
    let chunks=job?.result?.chunks||[];
    let periodReports=job?.result?.period_reports||[];
    if(!chunks.length&&!periodReports.length)throw new Error('The worker finished without importable period evidence. Keep this review private and retry the worker before approving.');
    const {data:review,error:reviewError}=await db().from('vod_review_sessions').select('*').eq('id',reviewId).maybeSingle();
    if(reviewError)throw reviewError;if(!review?.team_id)throw new Error('VOD review team is missing.');
    const offset=sourceOffset(review);
    let {data:segments,error}=await db().from('vod_review_segments').select('*').eq('review_id',reviewId).order('start_seconds');
    if(error)throw error;
    segments=model.activeSegments(segments);
    // Overtime the manager entered is real; the schedule's "no OT" only folds OT into P3 when none was entered.
    const linkedOt=await linkedFinalOvertime(review),noOvertime=linkedOt===false&&!segments.some(s=>s.segment_type==='overtime');
    if(noOvertime){
      chunks=chunks.map(c=>isOvertimeLabel(c?.label)?{...c,label:'Period 3'}:c);
      periodReports=normalizePeriodReports(periodReports,true);
    }
    const {data:publication}=await db().from('vod_game_publications').select('active').eq('review_id',reviewId).maybeSingle();
    // Only approved periods (or a live publication) are protected. Opened/edited/rejected ones take the new analysis.
    const protectedReview=Boolean(publication?.active)||segments.some(model.protectedEvidence);
    const staged=await db().rpc('stage_vod_worker_result',{target_review:reviewId,worker_result:job.result,worker_job:job.id});
    if(staged.error)throw staged.error;

    const fallbackFullGame=job?.result?.period_detection==='full_game_fallback';
    if(fallbackFullGame){
      setStatus('This analysis was not split into periods. Save the period times in Step 1, then press Analyze Game.','warn');
      document.getElementById('manualPeriodBuilder').open=true;
      return;
    }
    const problems=model.periodErrors(review,segments||[]);
    if(problems.length){
      document.getElementById('manualPeriodBuilder').hidden=false;
      document.getElementById('manualPeriodBuilder').open=true;
      throw new Error('Save the period times before importing: '+problems.join(' '));
    }
    const existingMarkers=await db().from('vod_review_markers').select('timestamp_seconds,note').eq('review_id',reviewId);
    if(existingMarkers.error)throw existingMarkers.error;
    const seen=new Set((existingMarkers.data||[]).map(m=>`${Math.round(Number(m.timestamp_seconds)||0)}|${m.note}`));
    const summaries=[]; const markers=[];let filled=0,skippedApproved=0;
    const periodRows=segments.filter(s=>['period','overtime'].includes(s.segment_type));
    for(const seg of periodRows){
      // A chunk belongs to the period it was filmed in (by time), so labels from older runs cannot misfile it.
      const matched=chunks.filter(c=>model.segmentForChunk(c,periodRows,offset)?.id===seg.id);
      const periodReport=periodReports.find(p=>model.periodLabel(p?.label)===model.periodLabel(seg.label))?.report||null;
      if(!matched.length&&!periodReport)continue;
      if(model.protectedEvidence(seg)){skippedApproved++;continue;}
      const summary=matched.length
        ?matched.map(c=>c.review?.summary).filter(Boolean).join('\n\n')
        :String(periodReport?.summary||'').trim();
      const uncertainties=[...new Set(matched.flatMap(c=>c.review?.uncertainties||[]))];
      const observationPlayers=matched.flatMap(c=>(c.review?.observations||[]).filter(o=>o.player).map(o=>`${o.player} — ${o.note}`));
      const evaluatedPlayers=matched.flatMap(c=>(c.review?.player_evaluations||[]).map(p=>{
        const pos=p.position?` (${p.position})`:'';
        const stamps=(p.evidence_timestamps||[]).map(x=>offset+Math.floor(Number(x)||0)).filter(Number.isFinite);
        const evidence=stamps.length?` [evidence: ${stamps.join(', ')}s]`:'';
        return `${p.player}${pos} — Strengths: ${p.strengths||'—'} | Concerns: ${p.concerns||'—'} | Habits: ${p.habits||'—'} | Coach: ${p.coach_note||'—'} | Confidence: ${p.confidence||'low'}${evidence}`;
      }));
      const fallbackPlayers=periodReport?.player_report?[String(periodReport.player_report)]:[];
      const playerNotes=[...new Set([...evaluatedPlayers,...observationPlayers,...fallbackPlayers])];
      const tactical=matched.map(c=>c.review?.tactical).filter(Boolean);
      const tacticalText=tactical.length?[
        ...new Set(tactical.flatMap(t=>[
          t.offense&&`Offense: ${t.offense}`, t.defense&&`Defense: ${t.defense}`,
          t.transition&&`Transition: ${t.transition}`, t.forecheck&&`Forecheck: ${t.forecheck}`,
          t.special_teams&&`Special teams: ${t.special_teams}`, t.goalie&&`Goalie: ${t.goalie}`,
          t.game_management&&`Game management: ${t.game_management}`
        ].filter(Boolean)))
      ].join('\n'):'';
      const fallbackTactical=!matched.length&&periodReport?.tactical_report?String(periodReport.tactical_report):'';
      const notes=[summary,tacticalText||fallbackTactical,uncertainties.length?`Needs review: ${uncertainties.join(' | ')}`:''].filter(Boolean).join('\n\n');
      const update={
        analysis_summary:notes||null,player_notes:playerNotes,
        forecheck_notes:tactical.map(t=>t.forecheck).filter(Boolean).join('\n')||null,
        breakout_notes:tactical.map(t=>t.breakout).filter(Boolean).join('\n')||null,
        offense_notes:tactical.map(t=>t.offense).filter(Boolean).join('\n')||null,
        defense_notes:tactical.map(t=>t.defense).filter(Boolean).join('\n')||null,
        transition_notes:tactical.map(t=>t.transition).filter(Boolean).join('\n')||null,
        special_teams_notes:tactical.map(t=>t.special_teams).filter(Boolean).join('\n')||null,
        tags:[...new Set(matched.flatMap(c=>(c.review?.observations||[]).map(o=>o.source)))]
      };
      // Re-importing the same evidence must not touch the row (it would race an approval in progress).
      const same=['analysis_summary','forecheck_notes','breakout_notes','offense_notes','defense_notes','transition_notes','special_teams_notes'].every(k=>(seg[k]||null)===update[k])
        &&JSON.stringify(seg.player_notes||[])===JSON.stringify(update.player_notes)&&seg.status==='needs_review';
      if(!same){
        const {data:updatedSegments,error:uerr}=await db().from('vod_review_segments').update({...update,status:'needs_review',confidence:'preliminary',updated_at:new Date().toISOString()})
          .eq('id',seg.id).eq('updated_at',seg.updated_at).is('archived_at',null).neq('status','complete').select('id');
        if(uerr)throw uerr;
        if(!updatedSegments?.length)continue;
      }
      filled++;
      if(summary)summaries.push(`${seg.label}: ${summary}`);
      for(const c of matched)for(const o of c.review?.observations||[]){
        const category=String(o.category||'general').replaceAll('_',' ');
        const impact=o.impact?` · ${o.impact}`:'';
        const note=`[AI ${String(o.source||'gameplay').replaceAll('_',' ')} · ${category}${impact}] ${o.note}`;
        const absoluteTimestamp=offset+(Number(o.timestamp)||0);
        if(!Number.isFinite(absoluteTimestamp)||absoluteTimestamp<seg.start_seconds||absoluteTimestamp>seg.end_seconds)continue;
        const key=`${Math.round(absoluteTimestamp)}|${note}`;
        if(seen.has(key))continue; seen.add(key);
        markers.push({review_id:reviewId,segment_id:seg.id,team_id:seg.team_id,timestamp_seconds:Math.round(absoluteTimestamp),category:'general',player_label:o.player||null,note,created_by:auth().user?.id||null});
      }
    }
    if(markers.length){const {error:merr}=await db().from('vod_review_markers').insert(markers);if(merr)throw merr;}

    const flagged={...job.result,website_imported:true,import_key:importKey(job)};
    if(protectedReview){
      const {error}=await db().from('vod_review_sessions').update({pending_worker_result:flagged,worker_status:'ready_for_review',worker_updated_at:new Date().toISOString()}).eq('id',reviewId);
      if(error)throw error;
      setStatus(`New analysis filled ${filled} unapproved period${filled===1?'':'s'}. ${skippedApproved?`${skippedApproved} approved period${skippedApproved===1?' was':'s were'} kept as approved. `:''}The new game write-up is shown as a draft until every period is approved.`,'good');
    }else{
      // The RPC rechecks approvals under a lock to avoid racing a manager's approval.
      const {data:imported,error:rerr}=await db().rpc('import_vod_worker_draft',{target_review:reviewId,worker_job:job.id,worker_result:flagged});
      if(rerr)throw rerr;
      setStatus(imported?.reviewed_evidence_preserved
        ?'A period was approved while importing, so the new game write-up was kept as a draft. Period evidence is saved.'
        :`Analysis imported into ${filled} period${filled===1?'':'s'}. Review each period, approve it, then publish.`,'good');
    }
    setTimeout(()=>document.getElementById('refreshVod')?.click(),350);
  }

  async function syncStoredStatus(){
    try{
      const review=await currentReview(); if(!review)return;
      if(selectedReviewId()!==review.id)return;
      savedState=await durableState(review.id);
      const analyzeButton=document.getElementById('vodAnalyzeGame');if(analyzeButton)analyzeButton.textContent=savedState?.analysisComplete?'View Reports':'Analyze Game';
      const source=document.getElementById('vodReplayUrl');if(source)source.value=review.vod_url||'';
      const start=document.getElementById('vodSourceStart');if(start)start.value=fmtClock(sourceOffset(review));
      const end=document.getElementById('vodSourceEnd');if(end)end.value=review.source_end_seconds==null?'':fmtClock(review.source_end_seconds);
      const format=document.getElementById('vodGameFormat');if(format)format.value=review.game_format||'6s';
      const context=document.getElementById('vodScoutingContext');if(context)context.value=review.scouting_context||'';
      if(!showDurable(savedState)&&review.worker_job_id){
        const extra=review.source_file_name?` · ${review.source_file_name}`:'';
        setStatus(`Saved pipeline: ${String(review.worker_status||'unknown').replaceAll('_',' ')}${extra}`);
      }
      beginPoll(review.worker_job_id,review.id);
    }catch{}
  }

window.addEventListener('vvhl-vod-rendered',event=>{
    if(event.detail?.review?.id!==selectedReviewId())return;
    savedState=window.WildmanVODReview.reconcile(event.detail.review,event.detail.segments,event.detail.publication);
    showDurable(savedState);
  });
  let lastSelectedReviewId='';
  let autoAnalyzeStarted=false;
  function maybeAutoAnalyze(id){
    const url=new URL(location.href);
    if(autoAnalyzeStarted||!id||url.searchParams.get('analyze')!=='1')return;
    autoAnalyzeStarted=true;
    url.searchParams.delete('analyze');
    history.replaceState(null,'',url);
    setTimeout(()=>document.getElementById('vodAnalyzeGame')?.click(),500);
  }
  window.addEventListener('vvhl-vod-batch-created',event=>{
    queueBatchReviews(event.detail?.reviewIds||[]).catch(error=>{
      const status=document.getElementById('batchVodStatus');
      if(status)status.textContent=error.message||'Could not queue the game batch.';
    });
  });

  const observer=new MutationObserver(()=>{
    install();
    const id=selectedReviewId();
    if(id!==lastSelectedReviewId){
      lastSelectedReviewId=id;savedState=null;
      clearInterval(pollTimer);pollTimer=null;
      document.getElementById('manualPeriodBuilder')?.removeAttribute('open');
      setStatus('Save the period times, then press Analyze Game.');
      syncStoredStatus();
      maybeAutoAnalyze(id);
    }
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});});
  else{install();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});}
})();
