(() => {
  if(!/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent||'')) return;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function replaceFrames(){
    document.querySelectorAll('iframe[src*="player.twitch.tv"]').forEach(frame=>{
      if(frame.dataset.mobileHandled==='1') return;
      frame.dataset.mobileHandled='1';
      let channel='';
      try{channel=new URL(frame.src).searchParams.get('channel')||'';}catch{}
      if(!channel) return;
      const url=`https://www.twitch.tv/${encodeURIComponent(channel)}`;
      const box=document.createElement('div');
      box.className='mobile-stream-fallback';
      box.innerHTML=`<div class="live-play-icon">▶</div><strong>LIVE ON TWITCH</strong><p>The embedded Twitch player can fail inside Android and in-app browsers. The stream itself is still connected.</p><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">WATCH ${esc(channel.toUpperCase())} ON TWITCH →</a>`;
      frame.replaceWith(box);
    });
  }
  replaceFrames();
  const observer=new MutationObserver(replaceFrames);
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();