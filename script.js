const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.main-nav');

if (document.body.classList.contains('wildman-site')) {
  const imageStyles = document.createElement('link');
  imageStyles.rel = 'stylesheet';
  imageStyles.href = 'wildman-images.css';
  document.head.appendChild(imageStyles);

  const heroImage = document.querySelector('.wm-visual-hero img');
  if (heroImage) {
    heroImage.decoding = 'async';
    heroImage.fetchPriority = 'high';
  }

  document.querySelectorAll('.wm-player-card img').forEach((image) => {
    image.loading = 'lazy';
    image.decoding = 'async';
  });
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
