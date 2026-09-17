(() => {
  const db=()=>window.VVHLBackend?.db;
  let objectUrl='',wired=false;
  const fmt=sec=>{sec=Math.max(0,Math.floor(Number(sec)||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;};
  const reviewId=()=>document.querySelector('.vod-row.active')?.dataset?.vodId||'';
  const status=t=>{const e=document.getElementById('vodLocalStatus');if(e)e.textContent=t;};

  function install(){
    const input=document.getElementById('vodPipelineFile'),panel=document.getElementById('vodPipelinePanel');
    if(!input||!panel)return;
    if(!document.getElementById('vodLocalMarker')){
      const box=document.createElement('div');box.id='vodLocalMarker';box.className='vod-local-marker';
      box.innerHTML=`<div class="eyebrow">FAST PERIOD MARKER</div><h3>Use the same recording to mark periods</h3><p>Select the MP4/MOV once. It previews only in your browser until you press Upload. Play to the start of each period and stamp the current time.</p><video id="vodLocalPreview" controls playsinline preload="metadata"></video><div class="vod-marker-actions"><button class="small-btn" data-stamp="period1Start">Set P1 Here</button><button class="small-btn" data-stamp="period2Start">Set P2 Here</button><button class="small-btn" data-stamp="period3Start">Set P3 Here</button><button class="small-btn" data-stamp="periodVodEnd">Set End Here</button></div><small id="vodLocalStatus">Choose the recording above to enable the marker.</small>`;
      const visual=document.getElementById('vodPipelineVisual');
      if(visual)visual.insertAdjacentElement('beforebegin',box);else panel.appendChild(box);
      box.querySelectorAll('[data-stamp]').forEach(b=>b.addEventListener('click',()=>stamp(b.dataset.stamp)));
    }
    if(!input.dataset.markerWired){input.dataset.markerWired='1';input.addEventListener('change',loadFile);}
  }

  async function loadFile(e){
    const file=e.target.files?.[0],video=document.getElementById('vodLocalPreview');if(!file||!video)return;
    if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=URL.createObjectURL(file);video.src=objectUrl;status(`Reading ${file.name}…`);
    video.onloadedmetadata=async()=>{
      const duration=Math.floor(video.duration||0);if(!duration)return status('Could not read the recording duration.');
      const end=document.getElementById('periodVodEnd');if(end)end.value=fmt(duration);
      const p1=document.getElementById('period1Start');if(p1&&!p1.value.trim())p1.value='0:00';
      status(`${file.name} · ${fmt(duration)} · ${(file.size/1024/1024).toFixed(1)} MB. Play to each period start and stamp it.`);
      const id=reviewId();if(id&&db()){
        const {error}=await db().from('vod_review_sessions').update({duration_seconds:duration,source_file_name:file.name,updated_at:new Date().toISOString()}).eq('id',id);
        if(error)console.warn('Could not save local video metadata',error);
      }
    };
  }

  function stamp(fieldId){
    const video=document.getElementById('vodLocalPreview'),field=document.getElementById(fieldId);if(!video?.src||!field)return status('Choose the recording first.');
    const sec=fieldId==='periodVodEnd'&&Number.isFinite(video.duration)?video.duration:video.currentTime;
    field.value=fmt(sec);field.dispatchEvent(new Event('change',{bubbles:true}));
    const label={period1Start:'P1',period2Start:'P2',period3Start:'P3',periodVodEnd:'VOD end'}[fieldId]||'Timestamp';
    status(`${label} marked at ${fmt(sec)}.`);
  }

  const obs=new MutationObserver(install);
  const start=()=>{install();obs.observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('beforeunload',()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);});
})();