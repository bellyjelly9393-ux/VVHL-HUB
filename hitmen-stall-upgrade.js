/* Hitmen photo-stall upgrade layer.
   Drop-in: load hitmen-stall-scene.css + hitmen-stall-scene.js + this file on the team or player locker page.
   It does not touch the page's own logic: it reads the name/number the page already renders
   (nameplate text), hides the old CSS-drawn stall and shows the photo stall in its place. */
(() => {
  const S = () => window.HitmenStall;
  const txt = el => (el?.textContent || '').trim();

  // ---------- Player locker (hitmen-player-locker.html) ----------
  function upgradePlayer() {
    const section = document.getElementById('stall');
    const scene = section?.querySelector('.player-stall-scene');
    if (!section || !scene || section.dataset.hsUpgraded) return;
    section.dataset.hsUpgraded = '1';
    section.classList.add('hs-hero');
    const host = document.createElement('div');
    host.className = 'player-stall-photo';
    scene.style.setProperty('display', 'none', 'important'); // keep old nodes so the page's own code can still write to them
    scene.parentNode.insertBefore(host, scene);
    const nameEl = document.getElementById('lockerPlateName') || document.getElementById('jerseyNameLive');
    const numEl = document.getElementById('lockerPlateNumLeft') || document.getElementById('jerseyNumberLive');
    const paint = () => {
      const name = txt(nameEl), num = txt(numEl).replace(/\D/g, '');
      const state = { name: name === 'PLAYER' ? '' : name, number: num, empty: !num };
      if (!host.firstChild) S().mount(host, state); else S().update(host, state);
    };
    paint();
    const mo = new MutationObserver(paint);
    [nameEl, numEl].filter(Boolean).forEach(el => mo.observe(el, { childList: true, characterData: true, subtree: true }));
  }

  // ---------- Team locker room (hitmen-team-locker.html) ----------
  function upgradeCard(card) {
    if (card.dataset.hsUpgraded) return;
    const plate = card.querySelector('.stall-nameplate');
    const interior = card.querySelector('.stall-interior');
    if (!plate || !interior) return;
    card.dataset.hsUpgraded = '1';
    card.classList.add('hs-upgraded');
    const name = txt(plate.querySelector('strong'));
    const num = txt(plate.querySelector('.stall-name-num')).replace(/\D/g, '');
    plate.style.setProperty('display', 'none', 'important'); interior.style.setProperty('display', 'none', 'important');
    const host = document.createElement('div');
    host.innerHTML = S().markup({ mini: true, empty: !num });
    const stall = host.firstChild;
    card.insertBefore(stall, card.firstChild);
    S().update(stall, { name, number: num });
    if (window.ResizeObserver) new ResizeObserver(() => S().fitAll(stall)).observe(stall);
  }
  function upgradeTeam(root = document) {
    root.querySelectorAll('.locker-stall').forEach(upgradeCard);
  }

  function run() {
    if (!S()) return;
    upgradePlayer();
    upgradeTeam();
  }
  const start = () => {
    run();
    new MutationObserver(() => run()).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
