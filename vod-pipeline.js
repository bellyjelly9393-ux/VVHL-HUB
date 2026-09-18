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
    panel.innerHTML=`<div class="eyebrow">ONE-UPLOAD PIPELINE</div><h3 style="margin:6px 0 8px">Upload Once · Auto-Detect Periods · Analyze</h3><p>Select the actual recording once. Wildman uploads it to the Railway worker, automatically looks for the NHL period indicator, builds P1/P2/P3 when confidence is high, then analyzes those windows. The manual marker below is only the fallback.</p><input id="vodPipelineFile" class="field" type="file" accept="video/mp4,video/quicktime,.mp4,.mov"><div class="vod-actions" style="margin-top:10px"><button id="vodStartPipeline" class="small-btn primary" type="button">Upload & Start Pipeline</button><button id="vodCheckPipeline" class="small-btn" type="button">Check Status</button><button id="vodRetryPipeline" class="small-btn" type="button">Continue / Retry</button></div><small id="vodPipelineStatus">Choose the recording once. Automatic period detection runs after upload.</small>`;
    anchor.insertAdjacentElement('afterend',panel);
    document.getElementById('vodStartPipeline')?.addEventListener('click',start);
    document.getElementById('vodCheckPipeline')?.addEventListener('click',checkSelected);
    document.getElementById('vodRetryPipeline')?.addEventListener('click',retry);
    syncStoredStatus();
  }

  async function start(){
    if(busy)return; busy=true;
    const button=document.getElementById('vodStartPipeline'); if(button)button.disabled=true;
    try{
      const review=await currentReview();
      if(!review)throw new Error('Select a VOD review first.');
      const periods=await periodsFor(review.id);
      const file=document.getElementById('vodPipelineFile')?.files?.[0];
      if(!file)throw new Error('Choose the MP4 or MOV recording first.');
      if(file.size>700*1024*1024)throw new Error('This recording is over the current 700 MB worker upload limit.');
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
      if(!review.worker_job_id)throw new Error('This review has not been uploaded to the video worker yet.');
      await checkJob(review.worker_job_id,review.id,true);
    }catch(e){setStatus(e.message||'Could not check pipeline.','bad');}
  }

  async function retry(){
    try{
      const review=await currentReview(); if(!review?.worker_job_id)throw new Error('There is no saved worker job to continue.');
      if(review.worker_status==='needs_periods'){
        const periods=await periodsFor(review.id);
        if(periods.length<3)throw new Error('Automatic detection needs help. Mark P1, P2 and P3 below, press Build / Update Periods, then press Continue / Retry. The video stays uploaded.');
        const job=await workerFetch(`/jobs/${encodeURIComponent(review.worker_job_id)}/periods`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({periods:periods.map(p=>({label:p.label,start:p.start,end:p.end}))})});
        await db().from('vod_review_sessions').update({worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
        setStatus('Manual period correction accepted. Reusing the uploaded video now.','good');
      }else{
        const job=await workerFetch(`/jobs/${encodeURIComponent(review.worker_job_id)}/retry`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        await db().from('vod_review_sessions').update({worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',review.id);
        setStatus('Retry queued. The original uploaded recording is being reused.','good');
      }
      beginPoll(review.worker_job_id,review.id);
    }catch(e){setStatus(e.message||'Retry is not available yet.','bad');}
  }

  function beginPoll(jobId,reviewId){
    clearInterval(pollTimer);
    checkJob(jobId,reviewId,false);
    pollTimer=setInterval(()=>checkJob(jobId,reviewId,false),5000);
  }

  async function importDetectedPeriods(reviewId,job){
    const periods=job?.result?.detected_periods||[];
    if(job?.result?.period_detection!=='auto'||periods.length<3)return false;
    const {data:review,error:rerr}=await db().from('vod_review_sessions').select('team_id').eq('id',reviewId).maybeSingle();
    if(rerr)throw rerr;if(!review?.team_id)return false;
    const payload=periods.map((p,i)=>({review_id:reviewId,team_id:review.team_id,segment_type:'period',segment_index:i+1,label:p.label||`Period ${i+1}`,start_seconds:Number(p.start),end_seconds:Number(p.end),status:'queued',confidence:'preliminary'}));
    const {error}=await db().from('vod_review_segments').upsert(payload,{onConflict:'review_id,segment_type,segment_index'});if(error)throw error;
    await db().from('vod_review_sessions').update({duration_seconds:Number(job.result?.duration)||null,overtime_count:0,updated_at:new Date().toISOString()}).eq('id',reviewId);
    return true;
  }

  async function checkJob(jobId,reviewId,loud=false){
    try{
      const job=await workerFetch(`/jobs/${encodeURIComponent(jobId)}`);
      await db().from('vod_review_sessions').update({worker_status:job.status,worker_updated_at:new Date().toISOString()}).eq('id',reviewId);
      const autoImported=await importDetectedPeriods(reviewId,job);
      if(autoImported)document.getElementById('refreshVod')?.click();
      const done=['ready_for_review','failed','expired','awaiting_ai','needs_periods'].includes(job.status);
      if(job.status==='needs_periods'){
        if(selectedReviewId()===reviewId)document.getElementById('manualPeriodBuilder')?.setAttribute('open','');
        setStatus('The upload is safe, but automatic period detection was not confident enough. Use the manual P1/P2/P3 marker below, Build / Update Periods, then press Continue / Retry. No re-upload.','warn');
      }
      else if(job.status==='awaiting_ai')setStatus(job.result?.period_detection==='auto'?'Periods detected automatically ✓ Video is split and ready. AI scouting is the only remaining connection. No re-upload needed.':'Video validated and split into period-sized work. AI is not connected to Railway yet. No re-upload is needed once the AI connection is added.','warn');
      else if(job.status==='ready_for_review'){setStatus('AI period review finished. Importing results into VOD Lab…','good');await ingest(job,reviewId);}
      else if(job.status==='failed'||job.status==='expired')setStatus(job.error||`Pipeline ${job.status}.`,'bad');
      else setStatus(`Pipeline: ${String(job.status).replaceAll('_',' ')}${job.result?.total_chunks?` · ${job.result.chunks?.length||0}/${job.result.total_chunks} chunks`:''}`,'good');
      if(done){clearInterval(pollTimer);pollTimer=null;}
      if(loud&&job.status==='ready_for_review')document.getElementById('refreshVod')?.click();
    }catch(e){if(loud)setStatus(e.message||'Could not reach video worker.','bad');}
  }

  async function ingest(job,reviewId){
    const chunks=job?.result?.chunks||[]; if(!chunks.length)return;
    const {data:segments,error}=await db().from('vod_review_segments').select('*').eq('review_id',reviewId).order('start_seconds');
    if(error)throw error;
    const existingMarkers=await db().from('vod_review_markers').select('timestamp_seconds,note').eq('review_id',reviewId);
    const seen=new Set((existingMarkers.data||[]).map(m=>`${Math.round(Number(m.timestamp_seconds)||0)}|${m.note}`));
    const summaries=[]; const markers=[];
    for(const seg of segments||[]){
      const matched=chunks.filter(c=>c.label===seg.label);
      if(!matched.length)continue;
      const summary=matched.map(c=>c.review?.summary).filter(Boolean).join('\n\n');
      const uncertainties=[...new Set(matched.flatMap(c=>c.review?.uncertainties||[]))];
      const playerNotes=matched.flatMap(c=>(c.review?.observations||[]).filter(o=>o.player).map(o=>`${o.player} — ${o.note}`));
      const notes=summary+(uncertainties.length?`\n\nNeeds review: ${uncertainties.join(' | ')}`:'');
      const {error:uerr}=await db().from('vod_review_segments').update({analysis_summary:notes||null,player_notes:playerNotes,tags:[...new Set(matched.flatMap(c=>(c.review?.observations||[]).map(o=>o.source)))],status:'needs_review',confidence:'preliminary',updated_at:new Date().toISOString()}).eq('id',seg.id);
      if(uerr)throw uerr;
      if(summary)summaries.push(`${seg.label}: ${summary}`);
      for(const c of matched)for(const o of c.review?.observations||[]){
        const note=`[AI ${String(o.source||'gameplay').replaceAll('_',' ')}] ${o.note}`;
        const key=`${Math.round(Number(o.timestamp)||0)}|${note}`;
        if(seen.has(key))continue; seen.add(key);
        markers.push({review_id:reviewId,segment_id:seg.id,team_id:seg.team_id,timestamp_seconds:Number(o.timestamp)||0,category:'general',player_label:o.player||null,note,created_by:auth().user?.id||null});
      }
    }
    if(markers.length){const {error:merr}=await db().from('vod_review_markers').insert(markers);if(merr)throw merr;}
    const {error:rerr}=await db().from('vod_review_sessions').update({full_game_summary:summaries.join('\n\n')||null,status:'reviewing',worker_status:'ready_for_review',worker_updated_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',reviewId);
    if(rerr)throw rerr;
    setStatus('Period analysis imported. Review the AI notes/markers, then save the final game report.','good');
    setTimeout(()=>document.getElementById('refreshVod')?.click(),350);
  }

  async function syncStoredStatus(){
    try{
      const review=await currentReview(); if(!review)return;
      if(review.worker_job_id){
        const extra=review.source_file_name?` · ${review.source_file_name}`:'';
        setStatus(`Saved pipeline: ${String(review.worker_status||'unknown').replaceAll('_',' ')}${extra}`);
      }
    }catch{}
  }

  let lastSelectedReviewId='';
  const observer=new MutationObserver(()=>{
    install();
    const id=selectedReviewId();
    if(id!==lastSelectedReviewId){
      lastSelectedReviewId=id;
      clearInterval(pollTimer);pollTimer=null;
      document.getElementById('manualPeriodBuilder')?.removeAttribute('open');
      setStatus('Choose the recording once. Automatic period detection runs after upload.');
      syncStoredStatus();
    }
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});});
  else{install();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','class']});}
})();
