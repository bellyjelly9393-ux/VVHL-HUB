(() => {
  const db=()=>window.VVHLBackend?.db;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let current=null,segments=[],markers=[],busy=false;

  function selectedGameId(){return $('reportGameSelect')?.value||'';}
  function fmt(sec){sec=Math.max(0,Math.floor(Number(sec)||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;}

  function install(){
    if($('postgameVodPanel'))return;
    const editor=document.querySelector('.report-card[style*="margin-top"]');
    if(!editor)return;
    const panel=document.createElement('section');
    panel.id='postgameVodPanel';panel.className='report-card';panel.style.marginTop='16px';
    panel.innerHTML=`<div class="eyebrow">2.5 · FILM REVIEW</div><h3>VOD Evidence Bridge</h3><p>When a Kickoff Classic game is marked Final, its VOD review is created automatically. Once the period review is saved, this desk can fold those observations into the postgame draft without retyping them.</p><div id="postgameVodPreview" class="lg-preview"><div class="empty-state">Choose a game to check its VOD review.</div></div><div class="report-actions"><button id="loadVodIntoDraft" class="small-btn primary" type="button" disabled>Load Film Review Into Draft</button><a id="openLinkedVod" class="small-btn" href="vod-lab.html?team=wildman-hockey">Open VOD Lab</a><button id="refreshLinkedVod" class="small-btn" type="button">Refresh Film Review</button></div><span id="postgameVodMessage" class="control-message"></span>`;
    editor.insertAdjacentElement('beforebegin',panel);
    $('loadVodIntoDraft')?.addEventListener('click',mergeFilmIntoDraft);
    $('refreshLinkedVod')?.addEventListener('click',load);
    $('reportGameSelect')?.addEventListener('change',()=>setTimeout(load,60));
    $('generateReportBtn')?.addEventListener('click',()=>setTimeout(()=>{ if(current) mergeFilmIntoDraft(true); },40));
    chooseQueryGame();
    load();
  }

  function chooseQueryGame(){
    const wanted=new URLSearchParams(location.search).get('game');
    if(!wanted)return;
    const select=$('reportGameSelect');
    const trySelect=()=>{
      const option=[...(select?.options||[])].find(o=>o.value===wanted);
      if(!option)return false;
      select.value=wanted;select.dispatchEvent(new Event('change',{bubbles:true}));return true;
    };
    if(trySelect())return;
    let n=0;const timer=setInterval(()=>{n++;if(trySelect()||n>30)clearInterval(timer);},200);
  }

  async function load(){
    if(busy||!db())return;const gameId=selectedGameId();if(!gameId)return;busy=true;
    try{
      const {data:r,error}=await db().from('vod_review_sessions').select('*').eq('esports_game_id',gameId).maybeSingle();
      if(error)throw error;current=r||null;segments=[];markers=[];
      if(current){
        const [s,m]=await Promise.all([
          db().from('vod_review_segments').select('*').eq('review_id',current.id).order('start_seconds'),
          db().from('vod_review_markers').select('*').eq('review_id',current.id).order('timestamp_seconds')
        ]);
        if(s.error)throw s.error;if(m.error)throw m.error;segments=s.data||[];markers=m.data||[];
      }
      render();
    }catch(e){
      const p=$('postgameVodPreview');if(p)p.innerHTML=`<div class="network-note">${esc(e.message||'Could not load VOD review.')}</div>`;
    }finally{busy=false;}
  }

  function render(){
    const root=$('postgameVodPreview'),btn=$('loadVodIntoDraft'),link=$('openLinkedVod');if(!root)return;
    if(!current){
      root.innerHTML='<div class="empty-state">No linked VOD review yet. Kickoff Classic finals will create one automatically; for a pre-final rehearsal you can still create the review manually in VOD Lab.</div>';
      if(btn)btn.disabled=true;if(link)link.href='vod-lab.html?team=wildman-hockey';return;
    }
    const periods=segments.filter(s=>['period','overtime'].includes(s.segment_type));
    const completed=periods.filter(s=>s.status==='complete').length;
    const analyzed=periods.filter(s=>s.analysis_summary||s.offense_notes||s.defense_notes||s.transition_notes||s.special_teams_notes).length;
    const hasEvidence=Boolean(current.full_game_summary||current.recurring_patterns||current.strengths||current.corrections||analyzed);
    const worker=String(current.worker_status||'not uploaded').replaceAll('_',' ');
    root.innerHTML=`<div class="key-stat-grid"><div class="key-stat"><small>VOD Review</small><strong>${esc(current.title)}</strong></div><div class="key-stat"><small>Pipeline</small><strong>${esc(worker.toUpperCase())}</strong></div><div class="key-stat"><small>Periods</small><strong>${completed}/${periods.length||3} verified</strong></div><div class="key-stat"><small>Markers</small><strong>${markers.length}</strong></div></div>${current.full_game_summary?`<div class="network-note" style="margin-top:12px"><strong>Film rollup</strong><br>${esc(current.full_game_summary)}</div>`:'<div class="empty-state" style="margin-top:12px">The VOD review exists, but the full-game rollup has not been saved yet.</div>'}`;
    if(btn)btn.disabled=!hasEvidence;if(link)link.href=`vod-lab.html?team=wildman-hockey&review=${encodeURIComponent(current.id)}`;
  }

  function evidenceText(){
    if(!current)return'';
    const periodLines=segments.filter(s=>s.analysis_summary).map(s=>`${s.label}: ${s.analysis_summary}`);
    const lines=[];
    if(current.full_game_summary)lines.push(current.full_game_summary);else if(periodLines.length)lines.push(periodLines.join('\n'));
    if(current.recurring_patterns)lines.push(`Recurring patterns: ${current.recurring_patterns}`);
    if(current.strengths)lines.push(`What worked: ${current.strengths}`);
    if(current.corrections)lines.push(`Corrections / next-game focus: ${current.corrections}`);
    return lines.join('\n\n');
  }

  function mergeFilmIntoDraft(silent=false){
    if(!current)return;
    const evidence=evidenceText();if(!evidence){if(!silent)$('postgameVodMessage').textContent='The linked review has no saved film analysis yet.';return;}
    const box=$('reportAnalyst');if(box){
      const marker='\n\nFILM REVIEW\n';
      const base=String(box.value||'').split(marker)[0].trim();
      box.value=`${base}${marker}${evidence}`.trim();
    }
    const source=$('reportSourceNotes');if(source){
      const note=`VOD review: ${current.title}. ${segments.filter(s=>s.status==='complete').length}/${segments.filter(s=>['period','overtime'].includes(s.segment_type)).length||3} period segments human-verified; ${markers.length} timestamp marker${markers.length===1?'':'s'}.`;
      const clean=String(source.value||'').replace(/\n?VOD review:.*$/s,'').trim();source.value=[clean,note].filter(Boolean).join('\n');
    }
    if(!silent){$('postgameVodMessage').textContent='Film review merged into the analyst draft. Review the wording before publishing.';}
  }

  const observer=new MutationObserver(()=>install());
  const start=()=>{install();observer.observe(document.body,{childList:true,subtree:true});setInterval(()=>{if(!document.hidden&&selectedGameId())load();},15000);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();