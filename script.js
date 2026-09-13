const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.main-nav');

if (nav) {
  if (!nav.querySelector('a[href="rosters.html"]')) {
    const rosterLink = document.createElement('a');
    rosterLink.href = 'rosters.html';
    rosterLink.textContent = 'Rosters & Cap';
    const finalsLink = nav.querySelector('a[href="finals.html"]');
    if (finalsLink) finalsLink.insertAdjacentElement('afterend', rosterLink);
    else nav.appendChild(rosterLink);
  }

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
