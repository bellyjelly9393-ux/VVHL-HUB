(() => {
  const body = document.body;
  body?.classList.add('wm-ds','wm-theme-wildman');

  if (!document.querySelector('link[href*="network-v2.css"]')) {
    const polish = document.createElement('link');
    polish.rel = 'stylesheet';
    polish.href = 'network-v2.css?v=20260920a';
    document.head.appendChild(polish);
  }

  const isPrivate = body?.classList.contains('management-protected');
  const path = location.pathname.split('/').pop() || 'index.html';

  const groups = {
    'index.html':'index.html',
    'team.html':'team.html','history.html':'team.html',
    'esports-hub.html':'esports-hub.html','esports-team.html':'esports-hub.html','services.html':'esports-hub.html',
    'events.html':'pro-series.html','event-format.html':'pro-series.html','pro-series.html':'pro-series.html','caps-gaming.html':'pro-series.html',
    'game-center.html':'game-center.html','multiview.html':'game-center.html','vod-center.html':'game-center.html','reports.html':'game-center.html','game.html':'game-center.html','live-game.html':'game-center.html','postgame.html':'game-center.html',
    'players.html':'players.html','esports-player.html':'players.html','player-rusty.html':'players.html','player-williamson20.html':'players.html','player-williamson88.html':'players.html','rosters.html':'players.html','season.html':'players.html',
    'academy.html':'academy.html',
    'signup.html':'signup.html',
    'management.html':'management.html',
    'wildman-media.html':'wildman-media.html','media.html':'wildman-media.html'
  };
  const activePath = groups[path] || path;

  const publicNav = [
    ['index.html','Home'],
    ['team.html','Wildman'],
    ['esports-hub.html','Esports Hub'],
    ['pro-series.html','Road to Pro'],
    ['game-center.html','Live'],
    ['players.html','Players'],
    ['academy.html','Academy'],
    ['wildman-media.html','Media'],
    ['management.html','Management'],
    ['signup.html','Join']
  ];

  if (!isPrivate) {
    const header = document.querySelector('.site-header');
    if (header) {
      header.innerHTML = `
        <a class="brand" href="index.html" aria-label="Wildman Hockey Esports Network home">
          <span class="wm-brand-mark">W</span>
          <span class="brand-copy wm-brand-copy">WILDMAN HOCKEY<br><b>ESPORTS NETWORK</b></span>
        </a>
        <button class="menu-toggle" type="button" aria-label="Open navigation" aria-expanded="false">☰</button>
        <nav class="main-nav">${publicNav.map(([href,label]) => `<a href="${href}"${activePath===href?' class="active-nav"':''}>${label}</a>`).join('')}</nav>
        <a class="wm-join-btn" href="management.html">Management Sign In</a>
      `;
    }

    if (!document.querySelector('.wm-network-strip')) {
      const strip = document.createElement('nav');
      strip.className = 'wm-network-strip';
      strip.setAttribute('aria-label','Competition and coverage shortcuts');
      strip.innerHTML = `
        <strong>WILDMAN NETWORK</strong>
        <a href="event-format.html?format=6v6">6v6</a>
        <a href="event-format.html?format=4v4">4v4</a>
        <a href="event-format.html?format=hut">HUT / 1v1</a>
        <a href="pro-series.html">Road to Pro</a>
        <a href="multiview.html">Multiview</a>
        <a href="vod-center.html">VOD Center</a>
        <a href="reports.html">Postgame</a>
      `;
      const header = document.querySelector('.site-header');
      if (header) header.insertAdjacentElement('afterend',strip);
    }
  }

  document.querySelectorAll('a[href="#"]').forEach(a => {
    a.addEventListener('click', e => e.preventDefault());
  });

  if (!document.querySelector('script[src*="ui-polish.js"]')) {
    const s=document.createElement('script');
    s.src='ui-polish.js?v=20260920a';
    s.async=false;
    document.body.appendChild(s);
  }
})();