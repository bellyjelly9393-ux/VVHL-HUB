/*! Wildman Hockey · Calgary Hitmen live ticker (self-contained).
 * Drop-in: <script src="/live-ticker.js" defer></script>
 * Optional attributes on the script tag:
 *   data-endpoint="/api/live-ticker"   feed URL
 *   data-tz="America/Edmonton"         force a display time zone (default: viewer's zone)
 *   data-sticky="true"                 pin the ticker to the top while scrolling
 *   data-href="/hitmen-hub.html"       make the team block a link
 * QA only: append ?ticker_now=2026-10-05T01:12:00Z to preview another moment.
 */
(() => {
  'use strict';
  if (window.__wmLiveTicker) return;
  window.__wmLiveTicker = true;

  const script = document.currentScript;
  const cfg = {
    endpoint: script?.dataset.endpoint || '/api/live-ticker',
    tz: script?.dataset.tz || undefined,
    sticky: script?.dataset.sticky === 'true',
    href: script?.dataset.href || '',
    poll: 60000,
  };
  const CACHE_KEY = 'wm-live-ticker:v1';
  const AUTH_KEY = 'sb-lrgllzvwgvqagcpiyvfd-auth-token';
  const qsNow = (() => {
    try { const v = new URLSearchParams(location.search).get('ticker_now'); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; } catch { return null; }
  })();
  const offset = qsNow == null ? 0 : qsNow - Date.now();
  const now = () => Date.now() + offset;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  // Stylesheet lives next to this script so one tag is enough.
  if (!document.querySelector('link[data-live-ticker]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.liveTicker = '';
    const src = script?.src || location.href;
    link.href = new URL('live-ticker.css' + new URL(src).search, src).href;
    document.head.appendChild(link);
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');

  function dayKey(ms) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: cfg.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
    return p; // YYYY-MM-DD
  }
  function fmtTime(ms, withZone) {
    return new Intl.DateTimeFormat('en-US', { timeZone: cfg.tz, hour: 'numeric', minute: '2-digit', ...(withZone ? { timeZoneName: 'short' } : {}) }).format(ms);
  }
  function fmtDay(ms) {
    const today = dayKey(now());
    const tomorrow = dayKey(now() + 864e5);
    const k = dayKey(ms);
    if (k === today) return 'Tonight';
    if (k === tomorrow) return 'Tomorrow';
    return new Intl.DateTimeFormat('en-US', { timeZone: cfg.tz, weekday: 'short', month: 'short', day: 'numeric' }).format(ms);
  }
  function fmtShortDay(ms) {
    const k = dayKey(ms);
    if (k === dayKey(now())) return 'Today';
    return new Intl.DateTimeFormat('en-US', { timeZone: cfg.tz, weekday: 'short' }).format(ms);
  }
  function countdown(ms) {
    if (ms <= 0) return '00:00';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d >= 2) return `${d}D ${pad(h)}H`;
    if (d >= 1 || h >= 1) return `${pad(d * 24 + h)}:${pad(m)}:${pad(sec)}`;
    return `${pad(m)}:${pad(sec)}`;
  }

  // Home/away marker. The API derives `home` from calgary_side ('right' = Calgary home,
  // 'left' = Calgary away; verified against official LGCHL home/away splits).
  // Home -> "vs OPP", away -> "@ OPP", unknown -> "vs".
  const venue = g => (g && g.home === false ? '@' : 'vs');
  const venueLabel = g => (g && g.home === false ? 'away at' : g && g.home === true ? 'home vs' : 'vs');

  function badge(team, cls = '') {
    const abbr = esc(team?.abbr || '?');
    if (team?.logo) {
      return `<span class="lt-badge ${cls}"><img src="${esc(team.logo)}" alt="" width="24" height="24" loading="lazy" decoding="async" data-abbr="${abbr}"></span>`;
    }
    return `<span class="lt-badge lt-badge-text ${cls}" aria-hidden="true">${abbr}</span>`;
  }

  let data = null;
  let root = null;
  let featureKey = '';

  function pickFeature(d) {
    const win = (d.game_window_min || 35) * 60e3;
    const pool = [];
    const seen = new Set();
    for (const g of [d.live, ...(d.upcoming || [])]) {
      if (g && g.at && !seen.has(g.id)) { seen.add(g.id); pool.push(g); }
    }
    pool.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const t = now();
    const live = pool.find(g => { const s = Date.parse(g.at); return t >= s && t < s + win; });
    const next = pool.find(g => Date.parse(g.at) > t);
    return { live, next, win };
  }

  function featureHtml(d) {
    const { live, next } = pickFeature(d);
    if (live) {
      featureKey = 'live:' + live.id;
      return `<div class="lt-feature" data-mode="live">
        <span class="lt-flag lt-flag-live"><i class="lt-dot" aria-hidden="true"></i>Live</span>
        <span class="lt-matchup"><span class="lt-self">${badge(d.team)}<b class="lt-abbr">${esc(d.team.abbr)}</b></span><span class="lt-vs" title="${esc(venueLabel(live))}">${esc(venue(live))}</span>${badge(live.opponent)}<b class="lt-abbr">${esc(live.opponent.abbr)}</b><span class="lt-oppname">${esc(live.opponent.name)}</span></span>
        <span class="lt-when">In progress</span>
        <span class="lt-clock" data-elapsed="${esc(live.at)}" aria-label="Time since puck drop"></span>
      </div>`;
    }
    if (next) {
      featureKey = 'next:' + next.id;
      const at = Date.parse(next.at);
      return `<div class="lt-feature" data-mode="next">
        <span class="lt-flag">Next</span>
        <span class="lt-matchup"><span class="lt-vs" title="${esc(venueLabel(next))}">${esc(venue(next))}</span>${badge(next.opponent)}<b class="lt-abbr">${esc(next.opponent.abbr)}</b><span class="lt-oppname">${esc(next.opponent.name)}</span></span>
        <span class="lt-when"><span class="lt-day">${esc(fmtDay(at))}</span> <time class="lt-time" datetime="${esc(next.at)}">${esc(fmtTime(at, true))}</time></span>
        <span class="lt-clock" data-until="${esc(next.at)}" aria-label="Countdown to puck drop"></span>
      </div>`;
    }
    featureKey = 'none';
    return `<div class="lt-feature" data-mode="none"><span class="lt-flag lt-flag-muted">Season</span><span class="lt-when">No games scheduled</span></div>`;
  }

  function railHtml(d) {
    const parts = [];
    const { live, next } = pickFeature(d);
    const pending = (d.pending || []).filter(g => !live || g.id !== live.id);
    if (pending.length) {
      parts.push(`<span class="lt-label">Awaiting final</span>`);
      for (const g of pending.slice(-3)) {
        parts.push(`<span class="lt-item"><span class="lt-vs">${esc(venue(g))}</span>${badge(g.opponent)}<span class="lt-abbr">${esc(g.opponent.abbr)}</span><span class="lt-muted">${esc(fmtShortDay(Date.parse(g.at)))} ${esc(fmtTime(Date.parse(g.at)))}</span></span>`);
      }
    }
    if (d.recent?.length) {
      parts.push(`<span class="lt-label">Finals</span>`);
      for (const g of d.recent) {
        const tag = g.source_url ? 'a' : 'span';
        const href = g.source_url ? ` href="${esc(g.source_url)}" target="_blank" rel="noopener"` : '';
        const res = g.result === 'OTL' ? 'OTL' : g.result;
        parts.push(`<${tag} class="lt-item lt-res-${esc(res)}"${href}><span class="lt-chip">${esc(res)}</span><span class="lt-vs">${esc(venue(g))}</span>${badge(g.opponent)}<span class="lt-abbr">${esc(g.opponent.abbr)}</span><span class="lt-score">${esc(g.gf)}<span class="lt-dash">–</span>${esc(g.ga)}</span>${g.ot ? '<span class="lt-ot">OT</span>' : ''}</${tag}>`);
      }
    }
    const later = (d.upcoming || []).filter(g => g.id !== next?.id && g.id !== live?.id && Date.parse(g.at) > now()).slice(0, 6);
    if (later.length) {
      parts.push(`<span class="lt-label">Up next</span>`);
      for (const g of later) {
        const at = Date.parse(g.at);
        parts.push(`<span class="lt-item"><span class="lt-date">${esc(fmtShortDay(at))} ${esc(fmtTime(at))}</span><span class="lt-vs">${esc(venue(g))}</span>${badge(g.opponent)}<span class="lt-abbr">${esc(g.opponent.abbr)}</span></span>`);
      }
    }
    const r = d.record;
    if (r) {
      const diff = r.diff > 0 ? `+${r.diff}` : r.diff < 0 ? `−${Math.abs(r.diff)}` : '0';
      parts.push(`<span class="lt-label">S${esc(d.season)}</span><span class="lt-item lt-stat"><span>GP <b>${esc(r.gp)}</b></span><span>PTS <b>${esc(r.pts)}</b></span><span>GF <b>${esc(r.gf)}</b></span><span>GA <b>${esc(r.ga)}</b></span><span>DIFF <b>${esc(diff)}</b></span><span>LEFT <b>${esc(d.counts?.remaining ?? '')}</b></span></span>`);
    }
    return parts.join('');
  }

  function render(d) {
    const streak = d.streak ? `<span class="lt-streak lt-streak-${esc(d.streak.type)}" title="Current streak">${esc(d.streak.label)}</span>` : '';
    const brandTag = cfg.href ? 'a' : 'div';
    const brandHref = cfg.href ? ` href="${esc(cfg.href)}"` : '';
    const seq = railHtml(d);
    root.innerHTML = `
      <${brandTag} class="lt-brand"${brandHref}>
        ${badge(d.team, 'lt-badge-team')}
        <span class="lt-brand-copy"><span class="lt-team">${esc(d.team.short || d.team.name)}</span><span class="lt-league">${esc(d.team.league || '')} · S${esc(d.season)}</span></span>
        <span class="lt-record" title="Season record W-L-OTL"><span class="lt-rec">${esc(d.record.label)}</span>${streak}</span>
      </${brandTag}>
      ${featureHtml(d)}
      <div class="lt-rail" tabindex="0" aria-label="Recent results and upcoming games">
        <div class="lt-track"><div class="lt-seq">${seq}</div><div class="lt-seq lt-clone" aria-hidden="true">${seq}</div></div>
      </div>
      <span class="lt-sr">${esc(summary(d))}</span>`;
    root.querySelectorAll('img[data-abbr]').forEach(img => img.addEventListener('error', () => {
      const span = img.parentElement; span.classList.add('lt-badge-text'); span.textContent = img.dataset.abbr;
    }, { once: true }));
    root.querySelectorAll('.lt-clone a').forEach(a => a.setAttribute('tabindex', '-1'));
    sizeMarquee();
    tick();
  }

  function summary(d) {
    const { live, next } = pickFeature(d);
    let s = `Calgary Hitmen ${d.record.label}${d.streak ? ', streak ' + d.streak.label : ''}.`;
    if (live) s += ` Live now, ${venueLabel(live)} ${live.opponent.name}.`;
    else if (next) s += ` Next: ${venueLabel(next)} ${next.opponent.name}, ${fmtDay(Date.parse(next.at))} ${fmtTime(Date.parse(next.at), true)}.`;
    return s;
  }

  function sizeMarquee() {
    const seq = root?.querySelector('.lt-seq');
    const track = root?.querySelector('.lt-track');
    if (!seq || !track) return;
    const w = seq.scrollWidth;
    track.style.setProperty('--lt-duration', `${Math.max(20, Math.round(w / 40))}s`);
  }

  function tick() {
    if (!root || !data) return;
    const { live, next } = pickFeature(data);
    const key = live ? 'live:' + live.id : next ? 'next:' + next.id : 'none';
    if (key !== featureKey) { render(data); return; }
    const clock = root.querySelector('.lt-clock');
    if (!clock) return;
    if (clock.dataset.until) {
      const ms = Date.parse(clock.dataset.until) - now();
      clock.textContent = countdown(ms);
      clock.classList.toggle('lt-soon', ms < 3600e3);
    } else if (clock.dataset.elapsed) {
      const ms = now() - Date.parse(clock.dataset.elapsed);
      const m = Math.max(0, Math.floor(ms / 60000));
      clock.textContent = `+${pad(m)}:${pad(Math.floor((ms % 60000) / 1000))}`;
    }
  }

  function readToken() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const tok = s?.access_token || s?.currentSession?.access_token;
      const exp = s?.expires_at || s?.currentSession?.expires_at;
      return tok && (!exp || exp * 1000 > Date.now() + 5000) ? tok : null;
    } catch { return null; }
  }
  async function sessionToken() {
    try {
      // backend.js (when present on the page) owns the Supabase client; prefer it so tokens are refreshed.
      // eslint-disable-next-line no-undef
      if (typeof vvhlDb !== 'undefined' && vvhlDb?.auth?.getSession) {
        // eslint-disable-next-line no-undef
        const { data: s } = await vvhlDb.auth.getSession();
        if (s?.session?.access_token) return s.session.access_token;
      }
    } catch {}
    return readToken();
  }

  async function load() {
    const get = headers => fetch(cfg.endpoint, { headers: { accept: 'application/json', ...headers }, credentials: 'same-origin' });
    let r = await get({});
    if (r.status === 401) {
      const tok = await sessionToken();
      if (tok) r = await get({ Authorization: `Bearer ${tok}` });
    }
    if (!r.ok) throw new Error('ticker ' + r.status);
    const body = await r.json();
    if (!body?.ok) throw new Error('ticker payload');
    return body;
  }

  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'live-ticker';
    root.className = 'lt';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Calgary Hitmen live ticker');
    document.body.prepend(root);
    document.documentElement.classList.add('has-live-ticker');
    if (cfg.sticky) document.documentElement.classList.add('lt-sticky');
  }
  function unmount() {
    root?.remove(); root = null;
    document.documentElement.classList.remove('has-live-ticker', 'lt-sticky');
  }

  async function refresh() {
    if (document.hidden && data) return;
    try {
      const d = await load();
      data = d;
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), d })); } catch {}
      mount();
      render(d);
    } catch (e) {
      if (!data) unmount();
    }
  }

  function start() {
    // Paint instantly from the previous page's payload (same tab), then revalidate.
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (c?.d?.ok && Date.now() - c.at < 10 * 60e3) { data = c.d; mount(); render(data); }
    } catch {}
    refresh();
    setInterval(tick, 1000);
    setInterval(refresh, cfg.poll);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('resize', () => sizeMarquee(), { passive: true });
    reduced?.addEventListener?.('change', () => data && render(data));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
