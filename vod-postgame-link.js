(() => {
  const db=()=>window.VVHLBackend?.db;
  const reviewId=()=>document.querySelector('.vod-row.active')?.dataset?.vodId||'';
  let timer=null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function chooseQueryReview(){
    const wanted=new URLSearchParams(location.search).get('review');if(!wanted)return;
    const tryPick=()=>{const row=document.querySelector(`[data-vod-id="${CSS.escape(wanted)}"]`);if(!row)return false;if(!row.classList.contains('active'))row.click();return true;};
    if(tryPick())return;
    let n=0;const t=setInterval(()=>{n++;if(tryPick()||n>35)clearInterval(t);},200);
  }

  function install(){
    const visual=document.getElementById('vodPipelineVisual');if(!visual||document.getElementById('vodPostgameHandoff'))return;
    const box=document.createElement('div');box.id='vodPostgameHandoff';box.className='vod-handoff-card';
    box.innerHTML=`<div><small>FINAL HANDOFF</small><strong id="vodHandoffTitle">Checking game connection…</strong><span id="vodHandoffText">Wildman will tell you what happens after the film review.</span></div><a id="vodHandoffBtn" class="small-btn" href="postgame-desk.html" style="display:none">Open Postgame Desk</a>`;
    visual.appendChild(box);refresh();
  }

  async function refresh(){
    install();const id=reviewId();if(!id||!db())return;
    try{
      const {data:r,error}=await db().from('vod_review_sessions').select('*').eq('id',id).maybeSingle();if(error)throw error;if(!r)return;
      const title=document.getElementById('vodHandoffTitle'),text=document.getElementById('vodHandoffText'),btn=document.getElementById('vodHandoffBtn');
      if(!r.esports_game_id){
        title.textContent='Internal team review';text.textContent='This review stays inside the team workspace. Use Copy Write-Up Packet for scouting/coaching notes.';btn.style.display='none';return;
      }
      const [{data:segs},{data:report}]=await Promise.all([
        db().from('vod_review_segments').select('status').eq('review_id',r.id).in('segment_type',['period','overtime']),
        db().from('esports_game_reports').select('id,status').eq('game_id',r.esports_game_id).maybeSingle()
      ]);
      const rows=segs||[],verified=rows.length>0&&rows.every(s=>s.status==='complete'),rollup=Boolean(r.full_game_summary||r.recurring_patterns||r.strengths||r.corrections);
      if(report?.status==='published'){
        title.textContent='Postgame published ✓';text.textContent='The film review is linked to the published tournament report.';
      }else if(report){
        title.textContent='Postgame draft connected';text.textContent='A private postgame draft exists. Open it to review and publish when ready.';
      }else if(verified&&rollup){
        title.textContent='Ready for Postgame Desk';text.textContent='Periods are verified and the game rollup is saved. The Postgame Desk can now merge the film evidence into its draft.';
      }else{
        title.textContent='Finish film review first';text.textContent='Verify the period analysis and save the full-game rollup before treating the write-up as publishable.';
      }
      btn.href=`postgame-desk.html?game=${encodeURIComponent(r.esports_game_id)}`;btn.textContent=report?'Open Postgame Draft':'Build Postgame Draft';btn.style.display='inline-flex';btn.classList.toggle('primary',verified&&rollup&&!report);
    }catch(e){
      const t=document.getElementById('vodHandoffTitle'),x=document.getElementById('vodHandoffText');if(t)t.textContent='Postgame link unavailable';if(x)x.textContent=e.message||'Could not check the postgame handoff.';
    }
  }

  const observer=new MutationObserver(()=>{install();chooseQueryReview();clearTimeout(timer);timer=setTimeout(refresh,180);});
  const start=()=>{install();chooseQueryReview();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden']});setInterval(()=>{if(!document.hidden)refresh();},15000);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();