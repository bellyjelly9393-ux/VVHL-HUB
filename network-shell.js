(() => {
  const body = document.body;
  if (!body?.classList.contains('wn-launch')) body?.classList.add('wm-ds','wm-theme-wildman');

  if (!body?.classList.contains('wn-launch') && !document.querySelector('link[href*="network-v2.css"]')) {
    const polish = document.createElement('link');
    polish.rel = 'stylesheet';
    polish.href = 'network-v2.css?v=20261001nav1';
    document.head.appendChild(polish);
  }

  if (!body?.classList.contains('wn-launch') && !document.querySelector('link[href*="brand-refresh.css"]')) {
    const brandRefresh = document.createElement('link');
    brandRefresh.rel = 'stylesheet';
    brandRefresh.href = 'brand-refresh.css?v=20260928-channel-split';
    document.head.appendChild(brandRefresh);
  }

  const isPrivate = body?.classList.contains('management-protected');
  const path = location.pathname.split('/').pop() || 'index.html';

  const groups = {
    'index.html':'index.html',
    'wildman-room.html':'wildman-room.html','team.html':'wildman-room.html','history.html':'wildman-room.html',
    'hitmen-room.html':'hitmen-room.html','hitmen-media.html':'hitmen-room.html',
    'lg-network.html':'lg-network.html',
    'tournaments.html':'tournaments.html','competition.html':'tournaments.html','events.html':'tournaments.html','event-format.html':'tournaments.html','pro-series.html':'tournaments.html',
    'game-center.html':'game-center.html','live-channel.html':'game-center.html','multiview.html':'game-center.html','vod-center.html':'game-center.html','game.html':'game-center.html','live-game.html':'game-center.html',
    'academy.html':'academy.html','academy-training.html':'academy.html',
    'elite-chel-media.html':'elite-chel-media.html','media-story.html':'elite-chel-media.html','wildman-media.html':'elite-chel-media.html','media.html':'elite-chel-media.html','reports.html':'elite-chel-media.html','postgame.html':'elite-chel-media.html'
  };
  const activePath = groups[path] || path;
  if (!isPrivate) {
    if (!body?.classList.contains('wn-launch') && !document.querySelector('link[href*="public-network.css"]')) {
      const css=document.createElement('link'); css.rel='stylesheet'; css.href='public-network.css'; document.head.appendChild(css);
    }
    const header=document.querySelector('.site-header');
    if(header) {
      header.classList.add('wn-network-header');
      const items=[['index.html','Home'],['game-center.html','Live'],['lg-network.html','LG Network'],['hitmen-room.html','Hitmen'],['wildman-room.html','Wildman'],['tournaments.html','Tournaments'],['elite-chel-media.html','Media'],['academy.html','Academy']];
      header.innerHTML=`<a class="brand" href="index.html" aria-label="Wildman Hockey home"><img src="https://d2ol7oe51mr4n9.cloudfront.net/user_3Ic50OgPEnsF6yLkPdMjvCnPfo2/72f4c4d6-ce4d-4da6-a1b9-45079d9fb21b.png" alt=""><span class="brand-copy">WILDMAN HOCKEY<b>ELITE CHEL MEDIA NETWORK</b></span></a><button class="menu-toggle" type="button" aria-label="Open navigation" aria-controls="wnMainNav" aria-expanded="false">☰</button><nav id="wnMainNav" class="main-nav" aria-label="Main navigation">${items.map(([href,label])=>`<a href="${href}"${activePath===href?' aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
      // Legacy pages bind this button in script.js; launch pages use this handler.
      if(body.classList.contains('wn-launch')) {
        const button=header.querySelector('.menu-toggle'), nav=header.querySelector('.main-nav');
        const close=()=>{nav.classList.remove('open');button.setAttribute('aria-expanded','false');};
        button.addEventListener('click',()=>{const open=nav.classList.toggle('open');button.setAttribute('aria-expanded',String(open));});
        nav.addEventListener('click',e=>{if(e.target.closest('a'))close();});
        document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();}});
      }
      if(!document.querySelector('.wn-score-strip')) {
        const strip=document.createElement('section');strip.className='wn-score-strip';strip.setAttribute('aria-label','Scores and upcoming coverage');
        strip.innerHTML='<div class="wn-score-label">GAME DESK<small>WILDMAN NETWORK</small></div><div class="wn-score-track" tabindex="0" aria-label="Scroll scores and coverage"><a class="wn-ticker-item" href="lg-network.html#game-of-week"><small>ELITE CHEL MEDIA</small><strong>Game of the Week</strong><small>Matchup coverage &amp; LG headlines</small></a><a class="wn-ticker-item" href="tournaments.html"><small>COMPETITION CENTER</small><strong>Explore upcoming tournaments</strong><small>Events &amp; registration updates</small></a></div><a class="wn-full-scores" href="game-center.html#live-board">Full scores &amp; schedule →</a>';
        header.insertAdjacentElement('afterend',strip);
      }
    }
    document.querySelector('.wm-network-strip')?.remove();
  }

  document.querySelectorAll('a[href="#"]').forEach(a => {
    a.addEventListener('click', e => e.preventDefault());
  });

  if (!body?.classList.contains('wn-launch') && !document.querySelector('script[src*="ui-polish.js"]')) {
    const s=document.createElement('script');
    s.src='ui-polish.js?v=20260920a';
    s.async=false;
    document.body.appendChild(s);
  }
})();