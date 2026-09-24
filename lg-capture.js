(() => {
  const TARGET_ORIGIN = location.origin;
  const ALLOWED_LG_ORIGINS = new Set(['https://www.leaguegaming.com','https://leaguegaming.com']);
  const bookmarklet = `javascript:(async()=>{try{const O='https://wildmanhockey-elitechelmedia.app';const U=location.href;const V=document.body?.innerText||'';const M=U.match(/gameid=(\\d+)/i)||V.match(/gameid[=\\/](\\d+)/i);const G=M?M[1]:'';if(!G){alert('Open a LeagueGaming game page first, then run Wildman LG Capture.');return}const W=window.open(O+'/lg-capture.html','wildmanLgCapture','width=760,height=840');if(!W){alert('Allow pop-ups for LeagueGaming, then try again.');return}const L=location.origin+'/forums/index.php?leaguegaming/league&action=league&page=league_game_edit_log&gameid='+encodeURIComponent(G);let X='',T='LeagueGaming Public Log '+G;if(/\\bTeam Stats\\b/i.test(V)&&(/\\bUser Stats\\b/i.test(V)||/\\bPeriod Stats\\b/i.test(V))){X=V;T=document.title||T}else{X=await new Promise((resolve,reject)=>{const I=document.createElement('iframe');I.style.cssText='position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;border:0;opacity:0;pointer-events:none';let done=false;const finish=(fn,v)=>{if(done)return;done=true;clearTimeout(timer);try{I.remove()}catch(e){}fn(v)};const timer=setTimeout(()=>finish(reject,new Error('LeagueGaming Public Log timed out')),12000);I.onload=()=>{try{const D=I.contentDocument||I.contentWindow?.document;const Z=D?.body?.innerText||'';if(!/\\bTeam Stats\\b/i.test(Z))throw new Error('The Public Log page loaded, but the stats table was not available yet.');T=D?.title||T;finish(resolve,Z)}catch(e){finish(reject,e)}};I.onerror=()=>finish(reject,new Error('LeagueGaming Public Log could not be opened'));document.body.appendChild(I);I.src=L})}const P={type:'WILDMAN_LG_PUBLIC_LOG_CAPTURE',url:L,title:T,text:X,gameId:G,capturedAt:new Date().toISOString()};let n=0;const send=()=>{try{W.postMessage(P,O)}catch(e){}};const h=e=>{if(e.origin===O&&e.data&&e.data.type==='WILDMAN_LG_BRIDGE_READY')send()};window.addEventListener('message',h);send();const q=setInterval(()=>{send();if(++n>20){clearInterval(q);window.removeEventListener('message',h)}},400)}catch(e){alert('Wildman LG Capture failed: '+e.message)}})()`;

  const link = document.getElementById('lgBookmarklet');
  const copy = document.getElementById('copyLgBookmarklet');
  const message = document.getElementById('bookmarkletMessage');
  const status = document.getElementById('bridgeStatus');

  if (link) link.href = bookmarklet;
  if (copy) copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      if (message) message.textContent = 'Bookmarklet copied. Create a bookmark and paste it into the bookmark URL/address field.';
    } catch {
      if (message) message.textContent = 'Clipboard access was blocked. Drag the Wildman LG Capture button to your bookmarks bar instead.';
    }
  });

  function gameIdFrom(payload) {
    const direct = String(payload?.gameId || '').match(/\d+/)?.[0];
    if (direct) return direct;
    const fromUrl = String(payload?.url || '').match(/gameid=(\d+)/i)?.[1];
    if (fromUrl) return fromUrl;
    return String(payload?.text || '').match(/gameid[=\/](\d+)/i)?.[1] || '';
  }

  function validPublicLogText(text) {
    const t = String(text || '');
    return /\bTeam Stats\b/i.test(t) && (/\bUser Stats\b/i.test(t) || /\bPeriod Stats\b/i.test(t));
  }

  window.addEventListener('message', (event) => {
    if (!ALLOWED_LG_ORIGINS.has(event.origin)) return;
    const payload = event.data;
    if (!payload || payload.type !== 'WILDMAN_LG_PUBLIC_LOG_CAPTURE') return;

    const text = String(payload.text || '');
    if (!validPublicLogText(text)) {
      if (status) status.innerHTML = '<strong>The LeagueGaming stats could not be read.</strong><br>Open the game page after stats are saved, then run Wildman LG Capture again.';
      return;
    }

    const saved = {
      type: 'leaguegaming-public-log',
      text,
      url: String(payload.url || ''),
      title: String(payload.title || ''),
      gameId: gameIdFrom(payload),
      capturedAt: String(payload.capturedAt || new Date().toISOString())
    };
    sessionStorage.setItem('wildman-lg-public-log-capture', JSON.stringify(saved));
    if (status) status.innerHTML = '<strong>Public Log captured.</strong><br>Opening Tournament Control…';
    setTimeout(() => {
      location.href = 'tournament-control.html?lgcapture=1#lg-public-log';
    }, 350);
  });

  try {
    if (window.opener) {
      for (const origin of ALLOWED_LG_ORIGINS) {
        try { window.opener.postMessage({type:'WILDMAN_LG_BRIDGE_READY'}, origin); } catch {}
      }
    }
  } catch {}
})();