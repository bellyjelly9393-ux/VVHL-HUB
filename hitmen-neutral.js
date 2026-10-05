/* Calgary Hitmen neutral broadcast pass: presentation helpers only (no data, no access logic).
   1. Keeps hitmen-neutral.css the last stylesheet: script.js, management-guard.js and ui-polish.js
      append legacy stylesheets at runtime, which would otherwise land after it.
   2. On pages that opt in (data-hn-navsync), hides the management-only nav links for accounts that
      aren't Calgary management, matching what the team locker already does. The pages behind those
      links keep their own guards; this only tidies the nav. */
(() => {
  const head = document.head;
  const last = () => head.querySelector('link[data-hn-last]');
  const keepLast = () => {
    const el = last(); if (!el) return;
    const sheets = head.querySelectorAll('link[rel="stylesheet"],style');
    if (sheets[sheets.length - 1] !== el) head.appendChild(el);
  };
  keepLast();
  new MutationObserver(muts => {
    if (muts.some(m => [...m.addedNodes].some(n => n !== last() && (n.tagName === 'LINK' || n.tagName === 'STYLE')))) keepLast();
  }).observe(head, { childList: true });

  if (document.body?.hasAttribute('data-hn-navsync')) {
    const TEAM = 'b0bcbdda-da9d-419d-8f61-b34937966d49';
    const sync = () => {
      const s = window.VVHLBackend?.state || {};
      const pr = String(s.profile?.role || '').toLowerCase();
      const mgmt = Boolean(s.user) && (pr === 'admin' || pr === 'commissioner' ||
        (s.memberships || []).some(m => m.team_id === TEAM && m.active !== false && ['owner', 'gm', 'agm', 'scout'].includes(String(m.role || '').toLowerCase())));
      document.querySelectorAll('[data-management-nav]').forEach(a => { a.hidden = !mgmt; });
    };
    sync();
    window.addEventListener('vvhl-auth-change', sync);
  }
})();
