(() => {
  const TARGET_ORIGIN = location.origin;
  const ALLOWED_LG_ORIGINS = new Set(['https://www.leaguegaming.com','https://leaguegaming.com']);
  const bookmarklet = `javascript:(async()=>{try{const O='https://wildmanhockey-elitechelmedia.app';const U=location.href;const M=U.match(/gameid=(\\d+)/i)||(document.body?.innerText||'').match(/gameid[=\\/](\\d+)/i);const G=M?M[1]:'';if(!G){alert('Open a LeagueGaming game page first, then run Wildman LG Capture.');return}const W=window.open(O+'/lg-capture.html','wildmanLgCapture','width=760,height=840');if(!W){alert('Allow pop-ups for LeagueGaming, then try again.');return}const L=location.origin+'/forums/index.php?leaguegaming/league&action=league&page=league_game_edit_log&gameid='+encodeURIComponent(G);let X='',T='LeagueGaming Public Log '+G;const V=document.body?.innerText||'';if(/\\bTeam Stats\\b/i.test(V)&&(/\\bUser Stats\\b/i.test(V)||/\\bPeriod Stats\\b/i.test(V))){X=V;T=document.title||T}else{const R=await fetch(L,{credentials:'include',cache:'no-store',headers:{'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}});if(!R.ok)throw new Error('LeagueGaming Public Log returned HTTP '+R.status);const H=await R.text();const D=new DOMParser().parseFromString(H,'text/html');X=D.body?.innerText||'';T=D.title||T;if(!/\\bTeam Stats\\b/i.test(X))throw new Error('The Public Log loaded, but the stats table was not available yet.')}const P={type:'WILDMAN_LG_PUBLIC_LOG_CAPTURE',url:L,title:T,text:X,gameId:G,capturedAt:new Date().toISOString()};let n=0;const send=()=>{try{W.postMessage(P,O)}catch(e){}};const h=e=>{if(e.origin===O&&e.data&&e.data.type==='WILDMAN_LG_BRIDGE_READY')send()};window.addEventListener('message',h);send();const q=setInterval(()=>{send();if(++n>20){clearInterval(q);window.removeEventListener('message',h)}},400)}catch(e){alert('Wildman LG Capture failed: '+e.message)}})()`;

  const scheduleBookmarklet = `javascript:(()=>{try{const O='https://wildmanhockey-elitechelmedia.app';if(!/leaguegaming\\.com$/i.test(location.hostname)){alert('Open the LeagueGaming Pro Series schedule or Streams page first.');return}const W=window.open(O+'/lg-capture.html?mode=schedule','wildmanLgScheduleCapture','width=760,height=840');if(!W){alert('Allow pop-ups for LeagueGaming, then try again.');return}const tid=h=>{try{return(new URL(h,location.href)).searchParams.get('teamid')||''}catch{return''}};const gid=h=>{try{return(new URL(h,location.href)).searchParams.get('gameid')||''}catch{return''}};const isStream=h=>/^(https?:\\/\\/)?(www\\.)?(twitch\\.tv|youtube\\.com|youtu\\.be|kick\\.com)\\//i.test(String(h||''));const clean=s=>String(s||'').replace(/\\s+/g,' ').trim();const cards=new Map;const teamAnchors=[...document.querySelectorAll('a[href*=\"teamid=\"]')];for(const a of teamAnchors){let n=a,best=null;for(let d=0;n&&d<8;d++,n=n.parentElement){const ls=[...n.querySelectorAll('a[href*=\"teamid=\"]')];const ids=[...new Set(ls.map(x=>tid(x.href)).filter(Boolean))];const tx=clean(n.innerText);if(ids.length===2&&(/\\bLIVE\\b/i.test(tx)||/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\\/?\\d{1,2}\\s+\\d{1,2}:\\d{2}\\s*(?:am|pm)/i.test(tx))){best={node:n,ids,tx};break}}if(!best)continue;const links=[...best.node.querySelectorAll('a[href]')];const streams=[];const gameIds=[];for(const x of links){const h=x.href||'';if(isStream(h))streams.push(h);const g=gid(h);if(g)gameIds.push(g);for(const at of ['onclick','data-url','data-href','data-stream','data-channel','title']){const v=x.getAttribute?.(at)||'';const m=v.match(/https?:\\/\\/(?:www\\.)?(?:twitch\\.tv|youtube\\.com|youtu\\.be|kick\\.com)\\/[^\\s'\"<>]+/ig)||[];streams.push(...m)}}const tm=best.tx.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\\/?\\d{1,2})\\s+(\\d{1,2}:\\d{2}\\s*(?:am|pm))/i);const key=best.ids.join('-')+'|'+(tm?tm[0]:'')+'|'+(gameIds[0]||'');if(!cards.has(key))cards.set(key,{teamIds:best.ids,timeText:tm?tm[0]:'',text:best.tx.slice(0,500),live:/\\bLIVE\\b/i.test(best.tx),streamUrls:[...new Set(streams)],gameIds:[...new Set(gameIds)]})}const orphanStreams=[...document.querySelectorAll('a[href]')].map(a=>({href:a.href,text:clean(a.innerText||a.title)})).filter(x=>isStream(x.href));const P={type:'WILDMAN_LG_SCHEDULE_STREAM_CAPTURE',url:location.href,title:document.title,cards:[...cards.values()],orphanStreams,capturedAt:new Date().toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};let k=0;const send=()=>{try{W.postMessage(P,O)}catch{}};const h=e=>{if(e.origin===O&&e.data&&e.data.type==='WILDMAN_LG_BRIDGE_READY')send()};window.addEventListener('message',h);send();const q=setInterval(()=>{send();if(++k>20){clearInterval(q);window.removeEventListener('message',h)}},400)}catch(e){alert('Wildman schedule capture failed: '+e.message)}})()`;

  const link = document.getElementById('lgBookmarklet');
  const copy = document.getElementById('copyLgBookmarklet');
  const message = document.getElementById('bookmarkletMessage');
  const scheduleLink = document.getElementById('lgScheduleBookmarklet');
  const scheduleCopy = document.getElementById('copyLgScheduleBookmarklet');
  const scheduleMessage = document.getElementById('scheduleBookmarkletMessage');
  const status = document.getElementById('bridgeStatus');

  if (link) link.href = bookmarklet;
  if (scheduleLink) scheduleLink.href = scheduleBookmarklet;
  if (copy) copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(bookmarklet);
      if (message) message.textContent = 'Bookmarklet copied. Create a bookmark and paste it into the bookmark URL/address field.';
    } catch {
      if (message) message.textContent = 'Clipboard access was blocked. Drag the Wildman LG Capture button to your bookmarks bar instead.';
    }
  });
  if (scheduleCopy) scheduleCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(scheduleBookmarklet);
      if (scheduleMessage) scheduleMessage.textContent = 'Schedule + Streams bookmarklet copied.';
    } catch {
      if (scheduleMessage) scheduleMessage.textContent = 'Clipboard access was blocked. Drag the Schedule + Streams button to your bookmarks bar instead.';
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
    if (payload?.type === 'WILDMAN_LG_SCHEDULE_STREAM_CAPTURE') {
      const saved = {
        type: 'leaguegaming-schedule-streams',
        url: String(payload.url || ''),
        title: String(payload.title || ''),
        cards: Array.isArray(payload.cards) ? payload.cards : [],
        orphanStreams: Array.isArray(payload.orphanStreams) ? payload.orphanStreams : [],
        capturedAt: String(payload.capturedAt || new Date().toISOString()),
        timezone: String(payload.timezone || '')
      };
      sessionStorage.setItem('wildman-lg-schedule-stream-capture', JSON.stringify(saved));
      if (status) status.innerHTML = '<strong>Schedule / stream data captured.</strong><br>Opening Tournament Control…';
      setTimeout(() => {
        location.href = 'tournament-control.html?lgstreams=1#broadcast';
      }, 350);
      return;
    }
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