const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.main-nav');

if (document.body.classList.contains('wildman-site')) {
  const imageStyles = document.createElement('link');
  imageStyles.rel = 'stylesheet';
  imageStyles.href = 'wildman-images.css';
  document.head.appendChild(imageStyles);

  const polishStyles = document.createElement('link');
  polishStyles.rel = 'stylesheet';
  polishStyles.href = 'visual-polish.css?v=20260916c';
  document.head.appendChild(polishStyles);

  const finishStyles = document.createElement('link');
  finishStyles.rel = 'stylesheet';
  finishStyles.href = 'pipeline-finish.css?v=20260916c';
  document.head.appendChild(finishStyles);

  const heroImage = document.querySelector('.wm-visual-hero img');
  if (heroImage) {
    heroImage.decoding = 'async';
    heroImage.fetchPriority = 'high';
  }

  document.querySelectorAll('.wm-player-card img').forEach((image) => {
    image.loading = 'lazy';
    image.decoding = 'async';
  });

  // Keep competitive intelligence behind the authenticated management wall.
  if (!document.body.classList.contains('management-protected')) {
    document.querySelectorAll('a[href="scouting-lab.html"]').forEach((link) => {
      link.href = 'management.html';
      link.setAttribute('title', 'Management sign-in required');
      if (link.closest('.main-nav')) link.textContent = 'Management';
    });
  }
}

if (nav) {
  const currentFile = location.pathname.split('/').pop() || 'index.html';
  nav.querySelectorAll('a').forEach((link) => {
    const file = link.getAttribute('href')?.split('?')[0];
    link.classList.toggle('active-nav', file === currentFile);
  });
}

if (menuButton && nav) {
  menuButton.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(isOpen));
    menuButton.textContent = isOpen ? '✕' : '☰';
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.textContent = '☰';
    });
  });
}

// Lightweight visual upgrades and page-specific management helpers.
(() => {
  const page=(location.pathname.split('/').pop()||'').toLowerCase();
  const load=(src)=>{
    if(document.querySelector(`script[data-wm-helper="${src}"]`))return;
    const s=document.createElement('script');
    s.src=src;
    s.defer=true;
    s.dataset.wmHelper=src;
    document.body.appendChild(s);
  };
  if(document.body.classList.contains('wildman-site')) load('ui-polish.js?v=20260916c');
  if(page==='hitmen-workspace.html'||page==='hitmen') {
    load('hitmen-delete-controls.js?v=20260916');
    load('hitmen-vod-handoff.js?v=20260916');
    load('live-pipeline-status.js?v=20260917a');
  }
  if(page==='tournament-control.html'||page==='tournament-control') {
    load('live-pipeline-status.js?v=20260917a');
  }
  if(page==='vod-lab.html'||page==='vod-lab') {
    load('vod-pipeline.js?v=20260916b');
    load('vod-pipeline-polish.js?v=20260916b');
    load('vod-local-marker.js?v=20260916');
    load('vod-postgame-link.js?v=20260916');
  }
  if(page==='postgame-desk.html'||page==='postgame-desk') {
    load('postgame-vod-bridge.js?v=20260916');
  }
})();
