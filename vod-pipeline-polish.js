(() => {
  if(window.WildmanVODPolishInstalled)return;window.WildmanVODPolishInstalled=true;
  const WORKER='https://wildman-video-worker-production.up.railway.app';
  const db=()=>window.VVHLBackend?.db;
  let timer=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const reviewId=()=>document.querySelector('.vod-row.active')?.dataset?.vodId||'';

  async function fetchReview(){
    const id=reviewId(); if(!id||!db()) return null;
    const [{data:r,error:e1},{data:s,error:e2},{data:m,error:e3},{data:publication,error:e4}]=await Promise.all([
      db().from('vod_review_sessions').select('*').eq('id',id).maybeSingle(),
      db().from('vod_review_segments').select('*').eq('review_id',id).order('start_seconds'),
      db().from('vod_review_markers').select('*').eq('review_id',id).order('timestamp_seconds'),
      db().from('vod_game_publications').select('active,report,published_at').eq('review_id',id).maybeSingle()
    ]);
    if(e1)throw e1;if(e2)throw e2;if(e3)throw e3;if(e4)throw e4;
    return {review:r,segments:window.WildmanVODReview.activeSegments(s),markers:m||[],publication};
  }

  async function health(){
    try{const r=await fetch(WORKER+'/health',{cache:'no-store'});if(!r.ok)throw new Error();return await r.json();}catch{return null;}
  }

  function install(){
    const panel=document.getElementById('vodPipelinePanel');
    if(!panel||document.getElementById('vodPipelineVisual'))return;
    const box=document.createElement('div');
    box.id='vodPipelineVisual';
    box.innerHTML=`<div class="vod-pipeline-health"><div id="vpWorker"><small>Video Worker</small><strong>Checking…</strong></div><div id="vpAi"><small>AI Analysis</small><strong>Checking…</strong></div></div><div id="vodPipelineTrack" class="vod-pipeline-track"></div><div id="vodPipelineNext" class="vod-pipeline-next">Select a review to see the next action.</div><details><summary>Advanced pipeline tools</summary><div class="vod-writeup-actions"><button id="copyWriteupPacket" class="small-btn" type="button">Copy Write-Up Packet</button><button id="refreshPipelineVisual" class="small-btn" type="button">Refresh Pipeline</button></div></details>`;
    panel.appendChild(box);
    document.getElementById('copyWriteupPacket')?.addEventListener('click',copyPacket);
    document.getElementById('refreshPipelineVisual')?.addEventListener('click',refresh);
    refresh();
  }

  function drawSteps(data){
    const root=document.getElementById('vodPipelineTrack'); if(!root)return;
    if(!data?.review)return;
    const state=window.WildmanVODReview.reconcile(data.review,data.segments,data.publication);
    const firstPending=state.stages.findIndex(s=>!s.done&&!s.blocked);
    root.innerHTML=state.stages.map((s,i)=>`<div class="vod-pipeline-step ${s.done?'done':''} ${s.blocked?'blocked':''} ${s.recovered?'recovered':''} ${!s.done&&i===firstPending?'active':''}"><div class="step-icon">${s.done?'✓':i+1}</div><small>${esc(s.label)}</small><b>${esc(s.name)}</b></div>`).join('');
    document.getElementById('vodPipelineNext').textContent=state.next+(state.recovered?' Raw recording retrieval previously failed; saved evidence remains usable.':'');
  }

  async function refresh(){
    install();
    const selected=reviewId();
    const [h,d]=await Promise.all([health(),fetchReview().catch(()=>null)]);
    const w=document.getElementById('vpWorker'),a=document.getElementById('vpAi');
    if(w){w.dataset.tone=h?'good':'bad';w.querySelector('strong').textContent=h?'ONLINE':'UNREACHABLE';}
    if(a){a.dataset.tone=h?.aiConfigured?'good':'warn';a.querySelector('strong').textContent=h?.aiConfigured?'CONNECTED':'NOT CONNECTED';}
    if(selected===reviewId())drawSteps(d);
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
      for(const s of d.segments.filter(s=>s.status==='complete')){
        lines.push(``,`${s.label} (${fmt(s.start_seconds)}-${fmt(s.end_seconds)})`,s.analysis_summary||'No summary.',s.offense_notes?`Offense: ${s.offense_notes}`:'',s.defense_notes?`Defense: ${s.defense_notes}`:'',s.transition_notes?`Transition: ${s.transition_notes}`:'',s.special_teams_notes?`Special Teams: ${s.special_teams_notes}`:'',Array.isArray(s.player_notes)&&s.player_notes.length?`Player Notes: ${s.player_notes.join(' | ')}`:'');
      }
      const approvedIds=new Set(d.segments.filter(s=>s.status==='complete').map(s=>s.id));
      lines.push(``,`KEY MOMENTS`,...(d.markers||[]).filter(m=>approvedIds.has(m.segment_id)).map(m=>`${fmt(m.timestamp_seconds)} · ${m.player_label?m.player_label+' · ':''}${m.note}`));
      lines.push(``,`CURRENT GAME ROLLUP`,r.full_game_summary||'Not built yet.',`Recurring Patterns: ${r.recurring_patterns||'Not built yet.'}`,`Strengths: ${r.strengths||'Not entered.'}`,`Corrections: ${r.corrections||'Not entered.'}`,``,`WRITE-UP INSTRUCTION`,`Create a concise hockey postgame/scouting write-up using only the evidence above. Separate verified facts from observations and uncertainty. Include a headline, game story, 3 key takeaways, notable player notes, and next-game focus.`);
      await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'));
      const b=document.getElementById('copyWriteupPacket');const old=b.textContent;b.textContent='Copied ✓';setTimeout(()=>b.textContent=old,1600);
    }catch(e){alert(e.message||'Could not build the write-up packet.');}
  }

  window.addEventListener('vvhl-vod-rendered',event=>{if(event.detail?.review?.id===reviewId())drawSteps(event.detail);});
  let lastReview='';
  const observer=new MutationObserver(()=>{install();const id=reviewId();if(id!==lastReview){lastReview=id;clearTimeout(timer);timer=setTimeout(refresh,180);}});
  const start=()=>{install();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});setInterval(()=>{if(!document.hidden)refresh();},15000);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
