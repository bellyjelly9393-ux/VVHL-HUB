(() => {
  const WORKER='https://wildman-video-worker-production.up.railway.app';
  const db=()=>window.VVHLBackend?.db;
  let timer=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reviewId=()=>document.querySelector('.vod-row.active')?.dataset?.vodId||'';

  async function fetchReview(){
    const id=reviewId(); if(!id||!db()) return null;
    const [{data:r,error:e1},{data:s,error:e2},{data:m,error:e3}]=await Promise.all([
      db().from('vod_review_sessions').select('*').eq('id',id).maybeSingle(),
      db().from('vod_review_segments').select('*').eq('review_id',id).order('start_seconds'),
      db().from('vod_review_markers').select('*').eq('review_id',id).order('timestamp_seconds')
    ]);
    if(e1)throw e1;if(e2)throw e2;if(e3)throw e3;
    return {review:r,segments:s||[],markers:m||[]};
  }

  async function health(){
    try{const r=await fetch(WORKER+'/health',{cache:'no-store'});if(!r.ok)throw new Error();return await r.json();}catch{return null;}
  }

  function install(){
    const panel=document.getElementById('vodPipelinePanel');
    if(!panel||document.getElementById('vodPipelineVisual'))return;
    const box=document.createElement('div');
    box.id='vodPipelineVisual';
    box.innerHTML=`<div class="vod-pipeline-health"><div id="vpWorker"><small>Video Worker</small><strong>Checking…</strong></div><div id="vpAi"><small>AI Analysis</small><strong>Checking…</strong></div></div><div id="vodPipelineTrack" class="vod-pipeline-track"></div><div id="vodPipelineNext" class="vod-pipeline-next">Select a review to see the next action.</div><div class="vod-writeup-actions"><button id="copyWriteupPacket" class="small-btn" type="button">Copy Write-Up Packet</button><button id="refreshPipelineVisual" class="small-btn" type="button">Refresh Pipeline</button></div>`;
    panel.appendChild(box);
    document.getElementById('copyWriteupPacket')?.addEventListener('click',copyPacket);
    document.getElementById('refreshPipelineVisual')?.addEventListener('click',refresh);
    refresh();
  }

  function drawSteps(data){
    const root=document.getElementById('vodPipelineTrack'); if(!root)return;
    const r=data?.review, segs=data?.segments||[];
    const periods=segs.filter(s=>['period','overtime'].includes(s.segment_type)&&s.end_seconds!=null);
    const allReviewed=periods.length>0&&periods.every(s=>['complete','needs_review'].includes(s.status));
    const allComplete=periods.length>0&&periods.every(s=>s.status==='complete');
    const worker=r?.worker_status||'';
    const analysisDone=worker==='ready_for_review';
    const blocked=worker==='awaiting_ai';
    const writeup=Boolean(r?.full_game_summary||r?.recurring_patterns||r?.strengths||r?.corrections);
    const stages=[
      {icon:'🎥',label:'1 · Source',name:'Game Review',done:Boolean(r)},
      {icon:'⏱',label:'2 · Split',name:'Periods',done:periods.length>=3},
      {icon:'☁',label:'3 · Retrieve',name:'Recording',done:Boolean(r?.worker_job_id)&&worker!=='retrieving'},
      {icon:'🧠',label:'4 · Analyze',name:'AI Review',done:analysisDone,blocked},
      {icon:'🔎',label:'5 · Verify',name:'Human Review',done:allComplete,active:analysisDone&&!allComplete},
      {icon:'✍',label:'6 · Publish',name:'Write-Up',done:writeup&&allComplete,active:allReviewed&&!writeup}
    ];
    const firstPending=stages.findIndex(s=>!s.done&&!s.blocked);
    root.innerHTML=stages.map((s,i)=>`<div class="vod-pipeline-step ${s.done?'done':''} ${s.blocked?'blocked':''} ${(s.active||i===firstPending)?'active':''}"><div class="step-icon">${s.done?'✓':s.icon}</div><small>${esc(s.label)}</small><b>${esc(s.name)}</b></div>`).join('');
    let next='Create or select a VOD review.';
    if(r&&!r.worker_job_id)next='Next: press Analyze Game to use the saved capture or Twitch replay. Upload is an optional fallback.';
    else if(worker==='needs_periods')next='Automatic detection needs help: open Manual period times, save the period boundaries, then press Continue / Retry.';
    else if(worker==='retrieving')next='Retrieving the saved Twitch replay. You can leave this page and return to check progress.';
    else if(blocked)next='Blocked only at AI: the video is validated and reusable. Connect the AI API on Railway, then press Retry AI. No re-upload.';
    else if(r?.worker_job_id&&!analysisDone)next=`Next: let Railway finish. Current status: ${String(worker||'processing').replaceAll('_',' ')}.`;
    else if(analysisDone&&!allComplete)next='Next: review the imported period notes and markers. Correct anything questionable, then mark each segment complete.';
    else if(allComplete&&!writeup)next='Next: build the full-game rollup, edit the write-up, then save it.';
    else if(writeup&&allComplete)next='Pipeline complete: analysis is reviewed and the game write-up is saved.';
    document.getElementById('vodPipelineNext').textContent=next;
  }

  async function refresh(){
    install();
    const [h,d]=await Promise.all([health(),fetchReview().catch(()=>null)]);
    const w=document.getElementById('vpWorker'),a=document.getElementById('vpAi');
    if(w){w.dataset.tone=h?'good':'bad';w.querySelector('strong').textContent=h?'ONLINE':'UNREACHABLE';}
    if(a){a.dataset.tone=h?.aiConfigured?'good':'warn';a.querySelector('strong').textContent=h?.aiConfigured?'CONNECTED':'NOT CONNECTED';}
    drawSteps(d);
  }

  function fmt(sec){sec=Math.max(0,Math.floor(Number(sec)||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;}
  async function copyPacket(){
    try{
      const d=await fetchReview(); if(!d?.review)throw new Error('Select a VOD review first.');
      const r=d.review;
      const lines=[
        `WILDMAN WRITE-UP PACKET`,
        `Title: ${r.title||'Game Review'}`,
        `Opponent: ${r.opponent_label||'Not labeled'}`,
        `Type: ${String(r.game_type||'review').replaceAll('_',' ')}`,
        `Date: ${r.game_date?new Date(r.game_date).toLocaleString():'Not set'}`,
        `VOD: ${r.vod_url||'Not attached'}`,
        ``, `PERIOD ANALYSIS`
      ];
      for(const s of d.segments){
        lines.push(``,`${s.label} (${fmt(s.start_seconds)}-${fmt(s.end_seconds)})`,s.analysis_summary||'No summary.',s.offense_notes?`Offense: ${s.offense_notes}`:'',s.defense_notes?`Defense: ${s.defense_notes}`:'',s.transition_notes?`Transition: ${s.transition_notes}`:'',s.special_teams_notes?`Special Teams: ${s.special_teams_notes}`:'',Array.isArray(s.player_notes)&&s.player_notes.length?`Player Notes: ${s.player_notes.join(' | ')}`:'');
      }
      lines.push(``,`KEY MOMENTS`,...(d.markers||[]).map(m=>`${fmt(m.timestamp_seconds)} · ${m.player_label?m.player_label+' · ':''}${m.note}`));
      lines.push(``,`CURRENT GAME ROLLUP`,r.full_game_summary||'Not built yet.',`Recurring Patterns: ${r.recurring_patterns||'Not built yet.'}`,`Strengths: ${r.strengths||'Not entered.'}`,`Corrections: ${r.corrections||'Not entered.'}`,``,`WRITE-UP INSTRUCTION`,`Create a concise hockey postgame/scouting write-up using only the evidence above. Separate verified facts from observations and uncertainty. Include a headline, game story, 3 key takeaways, notable player notes, and next-game focus.`);
      await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'));
      const b=document.getElementById('copyWriteupPacket');const old=b.textContent;b.textContent='Copied ✓';setTimeout(()=>b.textContent=old,1600);
    }catch(e){alert(e.message||'Could not build the write-up packet.');}
  }

  let lastReview='';
  const observer=new MutationObserver(()=>{install();const id=reviewId();if(id!==lastReview){lastReview=id;clearTimeout(timer);timer=setTimeout(refresh,180);}});
  const start=()=>{install();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});setInterval(()=>{if(!document.hidden)refresh();},15000);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
