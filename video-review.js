(() => {
  const report = window.VideoReviewReport;
  const gameSelect = document.getElementById('reportGameSelect');
  if (!gameSelect) return;
  const section = document.createElement('section');
  section.className = 'report-card video-review';
  section.style.marginTop = '16px';
  section.innerHTML = `
    <div class="eyebrow">VIDEO REVIEW · PRIVATE</div><h3>Turn game film into coaching notes</h3>
    <p>Uses the game selected above. Upload a recording and include the intermission shot chart and action tracker in your period ranges.</p>
    <p id="vrStatus" class="video-review-status" role="status" aria-live="polite">Checking video service…</p>
    <div class="video-review-grid">
      <div><label for="vrReplay">Replay link (optional)</label><input id="vrReplay" class="field" type="url" placeholder="https://www.twitch.tv/videos/…">
      <small>This upload uses your recording; the replay link provides evidence links.</small>
      <label for="vrFile">MP4 or MOV recording</label><input id="vrFile" class="field" type="file" accept="video/mp4,video/quicktime,.mp4,.mov">
      <small id="vrLimit">Recordings are temporary; reports stay available.</small>
      <label for="vrPlayers">Players to look for (optional)</label><input id="vrPlayers" class="field" maxlength="2000" placeholder="Gamertags and positions">
      <label for="vrFormat">Game format</label><select id="vrFormat" class="select-field"><option value="unknown">Not specified</option><option value="6s">6s</option><option value="4s">4s / three skaters + goalie</option><option value="3s">3s</option><option value="HUT">HUT</option></select>
      <label for="vrOffset">Recording begins in the original replay at</label><input id="vrOffset" class="field" value="0:00" placeholder="00:00"><small>For a trimmed recording, enter its start time in the full Twitch replay so evidence links match.</small>
      <label>Period ranges in recording time</label><small>Use mm:ss or hh:mm:ss. Leave all ranges blank to review the full recording.</small>
      ${[1,2,3].map(n => `<div class="period-row"><input class="field vr-label" value="Period ${n}" aria-label="Period ${n} label"><input class="field vr-start" placeholder="Start 00:00" aria-label="Period ${n} start"><input class="field vr-end" placeholder="End 10:00" aria-label="Period ${n} end"></div>`).join('')}
      <div class="report-actions"><button id="vrStart" class="small-btn primary" disabled>Upload and review</button></div>
      <progress id="vrProgress" max="100" value="0" hidden aria-label="Review progress"></progress></div>
      <div><video id="vrPlayer" controls preload="metadata" hidden></video>
      <p>The scout reviews sampled footage, then checks selected gameplay sequences more closely. Reports show the actual coverage. Player identities and hockey reads still need your review.</p>
      <label for="vrHistory">Your previous reviews</label><select id="vrHistory" class="select-field"><option value="">Select a review</option></select>
      <div class="report-actions"><button id="vrRefresh" class="small-btn" disabled>Refresh reviews</button><button id="vrRetry" class="small-btn" hidden>Retry unfinished review</button><button id="vrReanalyze" class="small-btn" hidden>Run fresh scouting review</button><button id="vrImport" class="small-btn" hidden>Add complete scouting report</button></div>
      <p id="vrImportStatus" role="status"></p></div>
    </div><div id="vrResults"></div>`;
  const editor = document.getElementById('reportHeadline')?.closest('section');
  editor.before(section);
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let base = '', current = null, timer = null, objectUrl = '', busy = false, maxUpload = 0, userId = '';
  const status = text => { $('vrStatus').textContent = text; };
  const clock = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const labels = {awaiting_upload:'Waiting for recording',uploading:'Uploading',queued:'Queued',processing:'Reviewing footage',awaiting_ai:'Waiting for AI connection',failed:'Review interrupted',ready_for_review:'Ready for coach review',expired:'Recording expired'};
  function parseTime(value) {
    if (!/^\d+(?::[0-5]\d){0,2}$/.test(value)) throw new Error('Use seconds, mm:ss or hh:mm:ss for period times.');
    return value.split(':').reduce((n, p) => n*60 + Number(p), 0);
  }
  async function token() {
    const {data, error} = await window.VVHLBackend.db.auth.getSession();
    if (error || !data.session) throw new Error('Sign in to continue.');
    return data.session.access_token;
  }
  async function api(path, options={}) {
    const response = await fetch(base + path, {...options, headers: {'Content-Type':'application/json', Authorization:`Bearer ${await token()}`, ...options.headers}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Video service unavailable.');
    return data;
  }
  function render(job) {
    current = job;
    const chunks = job.result.chunks || [];
    const stage = {preparing_video:'Preparing recording', checking_sequences:'Checking gameplay sequences', writing_report:'Writing scouting report'}[job.result.stage];
    status(`${job.status === 'processing' && stage ? stage : labels[job.status] || job.status}${job.error ? ': '+job.error : ''}`);
    $('vrProgress').hidden = false;
    $('vrProgress').value = job.result.total_chunks ? (report.complete(job) ? 100 : Math.min(90, 90*chunks.length/job.result.total_chunks)) : 0;
    $('vrRetry').hidden = !['failed','awaiting_ai'].includes(job.status);
    $('vrImport').hidden = !report.complete(job);
    $('vrReanalyze').hidden = !['ready_for_review','failed','awaiting_ai'].includes(job.status);
    const rollup = job.result.game_rollup || {};
    const fullReport = report.sections.filter(([key]) => rollup[key]).map(([key,title]) => `<details open><summary>${esc(title)}</summary><p class="vr-prose">${esc(rollup[key])}</p></details>`).join('');
    $('vrResults').innerHTML = `<p>${esc(report.coverage(job))}</p>${fullReport}<p>${chunks.length} / ${job.result.total_chunks || '—'} sections reviewed · ${esc(job.metadata.title)}</p>` + chunks.map(c => `<details open><summary>${esc(c.label)} · ${clock(c.start)}–${clock(c.end)}</summary><p>${esc(c.review.summary)}</p><ul>${c.review.observations.map(o => {
      const link = report.replayLink(job.metadata.vod_url,o.timestamp,job.metadata.vod_offset_seconds);
      return `<li><span class="evidence-time">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${clock(o.timestamp)}</a>` : clock(o.timestamp)}</span> · ${esc(o.source.replaceAll('_',' '))} · Needs review${o.player ? ' · '+esc(o.player) : ''}<br>${esc(o.note)}</li>`;
    }).join('')}</ul>${Object.entries(c.review.tactical || {}).map(([k,v]) => `<p><b>${esc(k.replaceAll('_',' '))}:</b> ${esc(v)}</p>`).join('')}${(c.review.player_evaluations || []).map(p => `<p class="vr-prose"><b>${esc(p.player)} · ${esc(p.confidence)} confidence</b><br>${esc(p.strengths)}<br>Concerns: ${esc(p.concerns)}<br>Coach note: ${esc(p.coach_note)}<br>Evidence: ${(p.evidence_timestamps || []).map(clock).join(', ')}</p>`).join('')}${c.sequence_review ? `<details><summary>Closer gameplay review · ${clock(c.sequence_review.start)}–${clock(c.sequence_review.end)}</summary><p class="vr-prose">${esc(report.evidenceText(c.sequence_review))}</p></details>` : ''}${c.review.uncertainties.length ? '<p><b>Uncertainties:</b> '+esc(c.review.uncertainties.join(' '))+'</p>' : ''}</details>`).join('');
    clearTimeout(timer);
    if (['queued','processing','uploading','retrieving'].includes(job.status)) timer = setTimeout(() => loadJob(job.id).catch(e => status(e.message)), 4000);
  }
  async function loadJob(id) { const expectedUser = userId; const job = await api('/jobs/'+id); if (expectedUser && expectedUser === userId && window.VVHLBackend.state.user?.id === expectedUser) render(job); }
  async function history() {
    const data = await api('/jobs');
    $('vrHistory').innerHTML = '<option value="">Select a review</option>' + data.jobs.map(j => `<option value="${esc(j.id)}">${esc(j.metadata.title || 'Game film')} · ${esc(labels[j.status] || j.status)}</option>`).join('');
    if (current) $('vrHistory').value = current.id;
  }
  async function upload(id, file) {
    const accessToken = await token();
    await new Promise((resolve,reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT',base+'/jobs/'+id+'/upload');
      xhr.setRequestHeader('Authorization','Bearer '+accessToken);
      xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.upload.onprogress = e => { if(e.lengthComputable){$('vrProgress').value=e.loaded/e.total*100;status(`Uploading recording: ${Math.round(e.loaded/e.total*100)}%`);} };
      xhr.onerror=()=>reject(new Error('Upload interrupted. Check your connection.'));
      xhr.onload=()=>{try{const d=JSON.parse(xhr.responseText);xhr.status<300?resolve(d):reject(new Error(d.error));}catch{reject(new Error('Upload failed.'));}};
      xhr.send(file);
    });
  }
  $('vrFile').onchange = () => {
    if(objectUrl) URL.revokeObjectURL(objectUrl);
    const file = $('vrFile').files[0];
    $('vrPlayer').hidden = !file;
    if(file){objectUrl=URL.createObjectURL(file);$('vrPlayer').src=objectUrl;}
  };
  $('vrStart').onclick = async () => {
    if (busy) return;
    busy = true; $('vrStart').disabled=true;
    try {
      const file=$('vrFile').files[0];
      if(!file) throw new Error('Choose a recording first.');
      if(file.size>maxUpload) throw new Error(`Recording exceeds ${Math.floor(maxUpload/1024**2)} MB. Export a smaller recording or one period.`);
      if(!gameSelect.value) throw new Error('Choose the game above first.');
      const periods=[...section.querySelectorAll('.period-row')].flatMap(row => {
        const start=row.querySelector('.vr-start').value.trim(),end=row.querySelector('.vr-end').value.trim();
        if(!start&&!end)return [];
        if(!start||!end)throw new Error('Enter both the start and end of each selected period.');
        return [{label:row.querySelector('.vr-label').value,start:parseTime(start),end:parseTime(end)}];
      });
      let previous=0;
      for(const p of periods){if(p.start<previous||p.end<=p.start)throw new Error('Period ranges must be ordered and must not overlap.');previous=p.end;}
      const job=await api('/jobs',{method:'POST',body:JSON.stringify({game_id:gameSelect.value,title:gameSelect.selectedOptions[0].text, vod_url:$('vrReplay').value.trim(),players:$('vrPlayers').value,game_format:$('vrFormat').value,vod_offset_seconds:parseTime($('vrOffset').value.trim() || '0'),periods})});
      $('vrProgress').hidden=false;
      await upload(job.id,file); await loadJob(job.id); await history();
    } catch(e){status(e.message);} finally {busy=false;$('vrStart').disabled=!base;}
  };
  $('vrHistory').onchange=()=>{if($('vrHistory').value)loadJob($('vrHistory').value).catch(e=>status(e.message));};
  $('vrRefresh').onclick=()=>history().catch(e=>status(e.message));
  $('vrRetry').onclick=async()=>{try{render(await api('/jobs/'+current.id+'/retry',{method:'POST',body:'{}'}));}catch(e){status(e.message);}};
  $('vrReanalyze').onclick=async()=>{
    if(!current || !window.confirm('Run a new AI review of the saved recording? This uses API credits and replaces the worker’s previous analysis. Your saved draft is kept.'))return;
    try{render(await api('/jobs/'+current.id+'/reanalyze',{method:'POST',body:'{}'}));}catch(e){status(e.message);}
  };
  $('vrImport').onclick=()=>{
    if(!report.complete(current)){$('vrImportStatus').textContent='Wait for the complete scouting report.';return;}
    if(current.metadata.game_id!==gameSelect.value){$('vrImportStatus').textContent='Select the matching game above before importing.';return;}
    $('reportAnalyst').value = report.replaceBlock($('reportAnalyst').value,current.id,report.reportText(current));
    $('reportSourceNotes').value = report.replaceBlock($('reportSourceNotes').value,current.id,report.coverage(current)+' Recording timestamps; replay offset '+clock(Number(current.metadata.vod_offset_seconds || 0))+'. No official stats changed. '+current.metadata.vod_url);
    if(!$('reportHeadline').value.trim())$('reportHeadline').value=current.metadata.title+' — Scouting report';
    $('vrImportStatus').textContent='Complete report added. Review it, then Save Draft. Re-importing updates this report’s marked section.';
  };
  async function initialize() {
    if(!window.VVHLManagementGuard?.hasAccess(window.VVHLBackend?.state))return;
    const nextUser=window.VVHLBackend.state.user.id;
    if(nextUser===userId && base)return;
    userId=nextUser;
    try{
      const response=await fetch('/api/video-review-config',{cache:'no-store'});
      if(!response.ok)throw new Error('Video service is not connected yet.');
      const config=await response.json();
      if(!config.configured){status('Video service is not connected yet. Recording review will activate once the worker is deployed.');return;}
      const url=new URL(config.workerUrl);if(url.protocol!=='https:')throw new Error('Video service needs a secure connection.');
      base=url.href.replace(/\/$/,'');
      const health=await fetch(base+'/health').then(r=>{if(!r.ok)throw new Error('Video service unavailable.');return r.json();});
      maxUpload=health.maxUploadBytes;
      $('vrLimit').textContent=`Maximum ${Math.floor(maxUpload/1024**2)} MB per recording. Temporary footage expires after ${health.retentionHours || 24} hours.`;
      await history();$('vrStart').disabled=false;$('vrRefresh').disabled=false;
      status(health.aiConfigured?'Ready for a recorded-game review.':'Video processing is connected. AI analysis still needs its API connection.');
    }catch(e){base='';status(e.message);}
  }
  window.addEventListener('vvhl-auth-change',()=>{
    if(!window.VVHLBackend.state.user || window.VVHLBackend.state.user.id!==userId){
      clearTimeout(timer);current=null;base='';userId='';$('vrResults').textContent='';$('vrHistory').innerHTML='<option value="">Select a review</option>';$('vrStart').disabled=true;$('vrRefresh').disabled=true;$('vrImport').hidden=true;$('vrRetry').hidden=true;$('vrReanalyze').hidden=true;
    }
    initialize();
  });
  initialize();
})();
