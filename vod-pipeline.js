(() => {
  const WORKER='https://wildman-video-worker-production.up.railway.app';
  const db=()=>window.VVHLBackend?.db;
  const auth=()=>window.VVHLBackend?.state||{};
  let pollTimer=null;
  let busy=false;

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
    if(!res.ok)throw new Error(body.error||`Video worker returned HTTP ${res.status}`);
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
    const {data,error}=await db().from('vod_review_segments').select('id,label,segment_type,segment_index,start_seconds,end_seconds').eq('review_id',reviewId).in('segment_type',['period','overtime']).order('start_seconds');
    if(error)throw error;
    return (data||[]).filter(s=>s.end_seconds!=null).map(s=>({id:s.id,label:s.label,start:Number(s.start_seconds),end:Number(s.end_seconds)}));
  }

  function install(){
    const detail=document.getElementById('vodDetail');
    if(!detail||document.getElementById('vodPipelinePanel'))return;
    const anchor=detail.querySelector('.vod-detail-head'); if(!anchor)return;
    const panel=document.createElement('div');
    panel.id='vodPipelinePanel'; panel.className='analysis-note'; panel.style.marginTop='16px';
    panel.innerHTML=`<div class="eyebrow">GAME ANALYSIS</div><h3 style="margin:6px 0 8px">Retrieve Recording · Detect Periods · Analyze</h3><p>Analyze Game reuses this game's capture or retrieves its saved Twitch replay. Existing jobs resume without starting again.</p><div class="vod-actions"><button id="vodAnalyzeGame" class="small-btn primary" type="button">Analyze Game</button><button id="vodCheckPipeline" class="small-btn" type="button">Check Status</button><button id="vodRetryPipeline" class="small-btn" type="button">Continue / Retry</button><button id="vodEliteReanalyze" class="small-btn" type="button">Re-run Elite Scout</button></div>
    <details id="vodTwitchConnect" style="margin-top:12px"><summary>Twitch Retrieval Connection <span id="vodTwitchAuthBadge" class="status-pill" style="margin-left:8px">CHECKING</span></summary><p><strong>Only needed when Twitch blocks anonymous VOD playback.</strong> Paste the Twitch website <code>auth-token</code> here, never into chat. It is stored privately on the Railway worker and is not written to logs.</p><div class="vod-form"><label class="wide">Twitch web auth-token<input id="vodTwitchToken" class="field mono" type="password" autocomplete="off" placeholder="Private token · not your password"></label></div><div class="vod-actions"><button id="vodSaveTwitchAuth" class="small-btn primary" type="button">Connect Twitch Retrieval</button><button id="vodClearTwitchAuth" class="small-btn" type="button">Disconnect</button><span id="vodTwitchAuthMsg" class="copy-feedback"></span></div><small>This token can grant broad Twitch account access. Use it only on this private management page and revoke it from Twitch Security if you no longer want the worker connected.</small></details>
    <details style="margin-top:12px"><summary>Recording source / upload fallback</summary><p>A Twitch replay link identifies the recording. Channel links alone cannot identify a past game. Use a recording containing one game.</p><label>Saved Twitch replay URL<input id="vodReplayUrl" class="field" type="url" placeholder="https://www.twitch.tv/videos/..."></label><button id="vodSaveReplay" class="small-btn" type="button">Save replay link</button><p>Or upload an MP4 / MOV recording:</p><input id="vodPipelineFile" class="field" type="file" accept="video/mp4,video/quicktime,.mp4,.mov"><button id="vodStartPipeline" class="small-btn" type="button">Upload & Start Pipeline</button></details><small id="vodPipelineStatus">Press Analyze Game to retrieve the saved recording.</small>`;
    anchor.insertAdjacentElement('afterend',panel);
    document.getElementById('vodStartPipeline')?.addEventListener('click',start);
    document.getElementById('vodCheckPipeline')?.addEventListener('click',checkSelected);
    document.getElementById('vodRetryPipeline')?.addEventListener('click',retry);
    document.getElementById('vodEliteReanalyze')?.addEventListener('click',reanalyzeElite);
    document.getElementById('vodAnalyzeGame')?.addEventListener('click',analyzeGame);
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
      const {data,error}=await db().from('vod_review_sessions').update({vod_url:url,source_provider:'twitch',updated_at:new Date().toISOString()}).eq('id',review.id).select('id');
      if(error)throw error;if(!data?.length)throw new Error('Replay link was not saved. Check your access.');
      document.getElementById('vodReplayUrl').value=url;
      setStatus('Replay link saved. Press Analyze Game.','good');
    }catch(e){setStatus(e.message,'bad');}
  }

  async function analyzeGame(){
    if(busy)return;busy=true;
    const button=document.getElementById('vodAnalyzeGame');button.disabled=true;
    try{
      const review=await currentReview();if(!review)throw new Error('Select a game first.');
      ensureScoutMode(review);
      setStatus('Finding this game’s recording…');
      const {job}=await workerFetch(`/reviews/${encodeURIComponent(review.id)}/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      if(selectedReviewId()!==review.id)return;
      if(!job)throw new Error('No recording found.');
      beginPoll(job.id,review.id);
    }catch(e){
      const msg=e.message||'Could not retrieve recording.';
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

  async function start(){
    if(busy)return; busy=true;
    const button=document.getElementById('vodStartPipeline'); if(button)button.disabled=true;
    try{
      const review=await currentReview();
      if(!review)throw new Error('Select a VOD review first.');
      ensureScoutMode(review);
      const periods=await periodsFor(review.id);
      const file=document.getElementById('vodPipelineFile')?.files?.[0];
      if(!file)throw new Error('Choose the MP4 or MOV recording first.');
      const healthResponse=await fetch(WORKER+'/health',{cache:'no-store'});
      if(!healthResponse.ok)throw new Error('Video worker is unavailable. Try again shortly.');
      const health=await healthResponse.json();
      if(file.size>health.maxUploadBytes)throw new Error(`This recording exceeds the current ${Math.floor(health.maxUploadBytes/1024/1024)} MB limit.`);
      setStatus('Creating secure video job…');
      const job=await workerFetch('/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game_id:review.id,title:review.title||'Game VOD',vod_url:review.vod_url||'',players:'',periods:periods.length>=3?periods.map(p=>({label:p.label,start:p.start,end:p.end})):[]})});
      await db().from('vod_review_sessions').update({worker_job_id:job.id,worker_status:job.status,source_file_name:file.name,worker_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',review.id);
      setStatus(`Uploading ${file.name}… keep this tab open until the upload finishes.`);
      const uploaded=await workerFetch(`/jobs/${encodeURIComponent(job.id)}/upload`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});
      await db().from('vod_review_sessions').update({worker_status:uploaded.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
      setStatus(periods.length>=3?'Upload complete. Railway is processing your saved period windows.':'Upload complete. Railway is detecting P1/P2/P3 automatically.','good');
      beginPoll(job.id,review.id);
    }catch(e){setStatus(e.message||'Could not start video pipeline.','bad');}
    finally{busy=false;if(button)button.disabled=false;}
  }

  async function checkSelected(){
    try{
      const review=await currentReview(); if(!review)throw new Error('Select a VOD review first.');
      await checkJob(review.worker_job_id,review.id,true);
    }catch(e){setStatus(e.message||'Could not check pipeline.','bad');}
  }

  async function retry(){
    try{
      const review=await currentReview(); if(!review?.worker_job_id)throw new Error('There is no saved worker job to continue.');
      ensureScoutMode(review);
      if(review.worker_status==='needs_periods'){
        const periods=await periodsFor(review.id);
        if(periods.length<3)throw new Error('Automatic detection needs help. Mark P1, P2 and P3 below, press Build / Update Periods, then press Continue / Retry. The video stays uploaded.');
        const job=await workerFetch(`/jobs/${encodeURIComponent(review.worker_job_id)}/periods`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({periods:periods.map(p=>({label:p.label,start:p.start,end:p.end}))})});
        await db().from('vod_review_sessions').update({worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
        setStatus('Manual period correction accepted. Reusing the uploaded video now.','good');
        beginPoll(review.worker_job_id,review.id);
      }else if(review.worker_status==='failed'&&String(review.source_provider||'').toLowerCase()==='twitch'){
        setStatus('Retrying Twitch retrieval using the saved replay link…','good');
        const {job}=await workerFetch(`/reviews/${encodeURIComponent(review.id)}/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        if(!job)throw new Error('No recording found.');
        await db().from('vod_review_sessions').update({worker_job_id:job.id,worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
        beginPoll(job.id,review.id);
      }else{
        const job=await workerFetch(`/jobs/${encodeURIComponent(review.worker_job_id)}/retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        await db().from('vod_review_sessions').update({worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
        setStatus('Retry queued. The original uploaded recording is being reused.','good');
        beginPoll(review.worker_job_id,review.id);
      }
    }catch(e){setStatus(e.message||'Retry is not available yet.','bad');}
  }

  async function reanalyzeElite(){
    try{
      const review=await currentReview();
      if(!review?.worker_job_id)throw new Error('There is no saved recording to re-analyze yet.');
      ensureScoutMode(review);
      if(!confirm('Run a fresh Elite Scout pass on the saved recording? This replaces the old AI evidence but keeps the video.'))return;
      setStatus('Starting a fresh elite scouting pass on the saved recording…');
      const job=await workerFetch(`/jobs/${encodeURIComponent(review.worker_job_id)}/reanalyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const oldAiMarkers=await db().from('vod_review_markers').delete().eq('review_id',review.id).like('note','[AI%');
      if(oldAiMarkers.error)throw oldAiMarkers.error;
      const resetSegments=await db().from('vod_review_segments').update({
        analysis_summary:null,offense_notes:null,defense_notes:null,transition_notes:null,
        special_teams_notes:null,player_notes:[],tags:[],status:'queued',confidence:'preliminary',
        updated_at:new Date().toISOString()
      }).eq('review_id',review.id);
      if(resetSegments.error)throw resetSegments.error;
      const resetReview=await db().from('vod_review_sessions').update({
        worker_status:job.status,status:'queued',
        full_game_summary:null,recurring_patterns:null,strengths:null,corrections:null,
        tactical_report:null,player_report:null,professional_writeup:null,
        worker_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()
      }).eq('id',review.id);
      if(resetReview.error)throw resetReview.error;
      setStatus('Fresh scout pass queued. The original recording is being reused.','good');
      beginPoll(review.worker_job_id,review.id);
    }catch(e){setStatus(e.message||'Fresh scout pass could not be started.','bad');}
  }

  function beginPoll(jobId,reviewId){
    clearInterval(pollTimer);
    checkJob(jobId,reviewId,false);
    pollTimer=setInterval(()=>checkJob(jobId,reviewId,false),5000);
  }

  async function importDetectedPeriods(reviewId,job){
    const periods=job?.result?.detected_periods||[];
    if(job?.result?.period_detection!=='auto'||periods.length<3)return false;
    const {data:existing,error:existingError}=await db().from('vod_review_segments').select('id').eq('review_id',reviewId).limit(1);
    if(existingError)throw existingError;
    if(existing?.length)return false;
    const {data:review,error:rerr}=await db().from('vod_review_sessions').select('team_id').eq('id',reviewId).maybeSingle();
    if(rerr)throw rerr;if(!review?.team_id)return false;
    const payload=periods.map((p,i)=>({review_id:reviewId,team_id:review.team_id,segment_type:'period',segment_index:i+1,label:p.label||`Period ${i+1}`,start_seconds:Number(p.start),end_seconds:Number(p.end),status:'queued',confidence:'preliminary'}));
    const {error}=await db().from('vod_review_segments').upsert(payload,{onConflict:'review_id,segment_type,segment_index'});if(error)throw error;
    await db().from('vod_review_sessions').update({duration_seconds:Number(job.result?.duration)||null,overtime_count:0,updated_at:new Date().toISOString()}).eq('id',reviewId);
    return true;
  }

  async function checkJob(jobId,reviewId,loud=false){
    try{
      const response=await workerFetch(`/reviews/${encodeURIComponent(reviewId)}/job`);
      const job=response.job;
      if(selectedReviewId()!==reviewId)return;
      if(!job){if(loud)setStatus('Press Analyze Game to retrieve the saved recording.');return;}
      if(job.waiting_for_capture){setStatus(`Game capture: ${job.status}. Waiting for the saved recording; no upload needed.`,'good');return;}
      const {error:saveError}=await db().from('vod_review_sessions').update({worker_job_id:job.id,worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',reviewId);
      if(saveError)throw saveError;
      const autoImported=await importDetectedPeriods(reviewId,job);
      if(autoImported)document.getElementById('refreshVod')?.click();
      const done=['ready_for_review','failed','expired','awaiting_ai','needs_periods'].includes(job.status);
      if(job.status==='needs_periods'){
        if(selectedReviewId()===reviewId)document.getElementById('manualPeriodBuilder')?.setAttribute('open','');
        setStatus('The upload is safe, but automatic period detection was not confident enough. Use the manual P1/P2/P3 marker below, Build / Update Periods, then press Continue / Retry. No re-upload.','warn');
      }
      else if(job.status==='awaiting_ai')setStatus(job.result?.period_detection==='auto'?'Periods detected automatically ✓ Video is split and ready. AI scouting is the only remaining connection. No re-upload needed.':'Video validated and split into period-sized work. AI is not connected to Railway yet. No re-upload is needed once the AI connection is added.','warn');
      else if(job.status==='ready_for_review'){
        const review=await currentReview();
        if(review?.status==='complete'||(review?.status==='reviewing'&&review?.full_game_summary))setStatus('Analysis is saved. Review the notes and game report below.','good');
        else{setStatus('AI period review finished. Importing results into VOD Lab…','good');await ingest(job,reviewId);}
      }
      else if(job.status==='failed'||job.status==='expired'){
        const msg=job.error||`Pipeline ${job.status}.`;
        setStatus(msg,'bad');
        if(/twitch.*(blocked|authenticated|authentication)|anonymous replay playback/i.test(msg)){
          const details=document.getElementById('vodTwitchConnect');
          const badge=document.getElementById('vodTwitchAuthBadge');
          if(details)details.open=true;
          if(badge){badge.textContent='AUTH REQUIRED';badge.dataset.tone='bad';}
        }
      }
      else if(job.status==='queued'&&/rate limit|cooling down/i.test(job.error||''))setStatus(job.error,'warn');
      else setStatus(`Pipeline: ${String(job.status).replaceAll('_',' ')}${job.result?.total_chunks?` · ${job.result.chunks?.length||0}/${job.result.total_chunks} chunks`:''}`,'good');
      if(done){clearInterval(pollTimer);pollTimer=null;}
      if(loud&&job.status==='ready_for_review')document.getElementById('refreshVod')?.click();
    }catch(e){setStatus(e.message||'Could not reach video worker. Retrying…','bad');}
  }

  async function ingest(job,reviewId){
    const chunks=job?.result?.chunks||[]; if(!chunks.length)return;
    let {data:segments,error}=await db().from('vod_review_segments').select('*').eq('review_id',reviewId).order('start_seconds');
    if(error)throw error;

    const fallbackFullGame=job?.result?.period_detection==='full_game_fallback';
    if((!segments||!segments.length)&&fallbackFullGame){
      const {data:review,error:rerr}=await db().from('vod_review_sessions').select('team_id').eq('id',reviewId).maybeSingle();
      if(rerr)throw rerr;
      const duration=Number(job?.result?.duration)||Math.max(...chunks.map(c=>Number(c.end)||0));
      const {data:created,error:cerr}=await db().from('vod_review_segments').insert({
        review_id:reviewId,team_id:review.team_id,segment_type:'custom',segment_index:1,label:'Full Game',
        start_seconds:0,end_seconds:duration,status:'queued',confidence:'preliminary'
      }).select('*').single();
      if(cerr)throw cerr;
      segments=[created];
    }

    const existingMarkers=await db().from('vod_review_markers').select('timestamp_seconds,note').eq('review_id',reviewId);
    const seen=new Set((existingMarkers.data||[]).map(m=>`${Math.round(Number(m.timestamp_seconds)||0)}|${m.note}`));
    const summaries=[]; const markers=[];
    for(const seg of segments||[]){
      const matched=fallbackFullGame?chunks:chunks.filter(c=>c.label===seg.label);
      if(!matched.length)continue;
      const summary=matched.map(c=>c.review?.summary).filter(Boolean).join('\n\n');
      const uncertainties=[...new Set(matched.flatMap(c=>c.review?.uncertainties||[]))];
      const observationPlayers=matched.flatMap(c=>(c.review?.observations||[]).filter(o=>o.player).map(o=>`${o.player} — ${o.note}`));
      const evaluatedPlayers=matched.flatMap(c=>(c.review?.player_evaluations||[]).map(p=>{
        const pos=p.position?` (${p.position})`:'';
        const stamps=(p.evidence_timestamps||[]).map(x=>Math.floor(Number(x)||0)).filter(Number.isFinite);
        const evidence=stamps.length?` [evidence: ${stamps.join(', ')}s]`:'';
        return `${p.player}${pos} — Strengths: ${p.strengths||'—'} | Concerns: ${p.concerns||'—'} | Habits: ${p.habits||'—'} | Coach: ${p.coach_note||'—'} | Confidence: ${p.confidence||'low'}${evidence}`;
      }));
      const playerNotes=[...new Set([...evaluatedPlayers,...observationPlayers])];
      const tactical=matched.map(c=>c.review?.tactical).filter(Boolean);
      const tacticalText=tactical.length?[
        ...new Set(tactical.flatMap(t=>[
          t.offense&&`Offense: ${t.offense}`, t.defense&&`Defense: ${t.defense}`,
          t.transition&&`Transition: ${t.transition}`, t.forecheck&&`Forecheck: ${t.forecheck}`,
          t.special_teams&&`Special teams: ${t.special_teams}`, t.goalie&&`Goalie: ${t.goalie}`,
          t.game_management&&`Game management: ${t.game_management}`
        ].filter(Boolean)))
      ].join('\n'):'';
      const notes=[summary,tacticalText,uncertainties.length?`Needs review: ${uncertainties.join(' | ')}`:''].filter(Boolean).join('\n\n');
      const {error:uerr}=await db().from('vod_review_segments').update({
        analysis_summary:notes||null,player_notes:playerNotes,
        tags:[...new Set(matched.flatMap(c=>(c.review?.observations||[]).map(o=>o.source)))],
        status:'needs_review',confidence:'preliminary',updated_at:new Date().toISOString()
      }).eq('id',seg.id);
      if(uerr)throw uerr;
      if(summary)summaries.push(`${seg.label}: ${summary}`);
      for(const c of matched)for(const o of c.review?.observations||[]){
        const category=String(o.category||'general').replaceAll('_',' ');
        const impact=o.impact?` · ${o.impact}`:'';
        const note=`[AI ${String(o.source||'gameplay').replaceAll('_',' ')} · ${category}${impact}] ${o.note}`;
        const key=`${Math.round(Number(o.timestamp)||0)}|${note}`;
        if(seen.has(key))continue; seen.add(key);
        markers.push({review_id:reviewId,segment_id:seg.id,team_id:seg.team_id,timestamp_seconds:Number(o.timestamp)||0,category:'general',player_label:o.player||null,note,created_by:auth().user?.id||null});
      }
    }
    if(markers.length){const {error:merr}=await db().from('vod_review_markers').insert(markers);if(merr)throw merr;}

    const rollup=job?.result?.game_rollup||{};
    const payload={
      full_game_summary:rollup.summary||summaries.join('\n\n')||null,
      recurring_patterns:rollup.patterns||null,
      strengths:rollup.strengths||null,
      corrections:rollup.corrections||null,
      tactical_report:rollup.tactical_report||null,
      player_report:rollup.player_report||null,
      professional_writeup:rollup.professional_writeup||null,
      status:'reviewing',worker_status:'ready_for_review',
      worker_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()
    };
    const {error:rerr}=await db().from('vod_review_sessions').update(payload).eq('id',reviewId);
    if(rerr)throw rerr;
    setStatus(fallbackFullGame
      ?'Full-game AI scouting report imported. Automatic period detection was skipped; review the evidence and report below.'
      :'Period analysis imported. Review the AI notes/markers, then save the final game report.','good');
    setTimeout(()=>document.getElementById('refreshVod')?.click(),350);
  }

  async function syncStoredStatus(){
    try{
      const review=await currentReview(); if(!review)return;
      if(selectedReviewId()!==review.id)return;
      const source=document.getElementById('vodReplayUrl');if(source)source.value=review.vod_url||'';
      if(review.worker_job_id){
        const extra=review.source_file_name?` · ${review.source_file_name}`:'';
        setStatus(`Saved pipeline: ${String(review.worker_status||'unknown').replaceAll('_',' ')}${extra}`);
      }
      beginPoll(review.worker_job_id,review.id);
    }catch{}
  }

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
  const observer=new MutationObserver(()=>{
    install();
    const id=selectedReviewId();
    if(id!==lastSelectedReviewId){
      lastSelectedReviewId=id;
      clearInterval(pollTimer);pollTimer=null;
      document.getElementById('manualPeriodBuilder')?.removeAttribute('open');
      setStatus('Press Analyze Game to retrieve the saved recording.');
      syncStoredStatus();
      maybeAutoAnalyze(id);
    }
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});});
  else{install();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});}
})();
