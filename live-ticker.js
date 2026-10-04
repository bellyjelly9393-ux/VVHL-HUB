/*! Wildman Hockey · site-wide live ticker (self-contained).
 * Drop-in: <script src="/live-ticker.js" defer></script>
 * Two independent feeds, rendered Hitmen-first:
 *   1. Calgary Hitmen  /api/live-ticker   (record, streak, next game, LIVE window, results, upcoming)
 *   2. LGCHL league    /api/lgchl-scores  (last night's finals + today's slate from Supabase lgchl_games:
 *                      every WHL game + OHL/QMJHL big games; Hitmen games excluded)
 * Either feed can fail without taking the other down.
 * Optional attributes on the script tag:
 *   data-endpoint="/api/live-ticker"    Hitmen feed
 *   data-league-endpoint="/api/lgchl-scores?view=ticker"
 *   data-league="featured"              featured (WHL + OHL/QMJHL big games) | whl | big | all | off
 *   data-tz="America/Edmonton"          force a display time zone (default: viewer's zone)
 *   data-sticky="true"                  pin the ticker to the top while scrolling
 *   data-href="/hitmen-hub.html"        make the team block a link
 * QA only: ?ticker_now=2026-10-05T01:12:00Z previews another moment.
 */
(() => {
  'use strict';
  if (window.__wmLiveTicker) return;
  window.__wmLiveTicker = true;

  const script = document.currentScript;
  const ds = script?.dataset || {};
  const cfg = {
    endpoint: ds.endpoint || '/api/live-ticker',
    leagueEndpoint: ds.leagueEndpoint || '/api/lgchl-scores?view=ticker',
    league: (ds.league || 'featured').toLowerCase(),
    tz: ds.tz || undefined,
    sticky: ds.sticky === 'true',
    href: ds.href || '',
    poll: 60000,
    leaguePoll: 300000,
    pxPerSecond: 60,
  };
  const CACHE_KEY = 'wm-live-ticker:v3';
  const AUTH_KEY = 'sb-lrgllzvwgvqagcpiyvfd-auth-token';
  const LEAGUE_ORDER = ['WHL', 'OHL', 'QMJHL']; // Calgary's league first
  const qsNow = (() => {
    try { const v = new URLSearchParams(location.search).get('ticker_now'); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; } catch { return null; }
  })();
  const offset = qsNow == null ? 0 : qsNow - Date.now();
  const now = () => Date.now() + offset;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');

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
  const dayKey = ms => new Intl.DateTimeFormat('en-CA', { timeZone: cfg.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const fmtTime = (ms, zone) => new Intl.DateTimeFormat('en-US', { timeZone: cfg.tz, hour: 'numeric', minute: '2-digit', ...(zone ? { timeZoneName: 'short' } : {}) }).format(ms);
  const fmtDate = ms => new Intl.DateTimeFormat('en-US', { timeZone: cfg.tz, weekday: 'short', month: 'short', day: 'numeric' }).format(ms);
  function fmtDay(ms) {
    const k = dayKey(ms);
    if (k === dayKey(now())) return 'Tonight';
    if (k === dayKey(now() + 864e5)) return 'Tomorrow';
    return fmtDate(ms);
  }
  function fmtShortDay(ms) {
    if (dayKey(ms) === dayKey(now())) return 'Today';
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
  function badge(team, cls = '') {
    const abbr = esc(team?.abbr || '?');
    if (team?.logo) return `<span class="lt-badge ${cls}"><img src="${esc(team.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async" data-abbr="${abbr}"></span>`;
    return `<span class="lt-badge lt-badge-text ${cls}" aria-hidden="true">${abbr}</span>`;
  }
  // Home/away marker. The API derives `home` from calgary_side ('right' = Calgary home,
  // 'left' = Calgary away; verified against official LGCHL home/away splits).
  // Home -> "vs OPP", away -> "@ OPP", unknown -> "vs".
  const venue = g => (g && g.home === false ? '@' : 'vs');
  const venueLabel = g => (g && g.home === false ? 'away at' : g && g.home === true ? 'home vs' : 'vs');

  let hData = null;   // Hitmen feed
  let lData = null;   // League feed
  let root = null;
  let featureKey = '';

  // ---------- Hitmen ----------
  function pickFeature(d) {
    const win = (d.game_window_min || 35) * 60e3;
    const seen = new Set(); const pool = [];
    for (const g of [d.live, ...(d.upcoming || [])]) if (g && g.at && !seen.has(g.id)) { seen.add(g.id); pool.push(g); }
    pool.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const t = now();
    return {
      live: pool.find(g => { const s = Date.parse(g.at); return t >= s && t < s + win; }),
      next: pool.find(g => Date.parse(g.at) > t),
    };
  }

  function featureHtml(d) {
    if (!d) { featureKey = 'league-only'; return ''; }
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
    return `<div class="lt-feature" data-mode="none"><span class="lt-flag">Season</span><span class="lt-when">No games scheduled</span></div>`;
  }

  // Final score pair: winner bright + bold, loser dimmed. No colour coding.
  function scorePair(us, them) {
    const win = us > them;
    return `<span class="lt-score"><span class="${win ? 'lt-hi' : 'lt-lo'}">${esc(us)}</span><span class="lt-dash">–</span><span class="${win ? 'lt-lo' : 'lt-hi'}">${esc(them)}</span></span>`;
  }

  function hitmenRail(d) {
    const parts = [];
    const { live, next } = pickFeature(d);
    const pending = (d.pending || []).filter(g => !live || g.id !== live.id);
    if (pending.length) {
      parts.push(`<span class="lt-label">Awaiting final</span>`);
      for (const g of pending.slice(-3)) parts.push(`<span class="lt-item"><span class="lt-vs">${esc(venue(g))}</span>${badge(g.opponent)}<span class="lt-abbr">${esc(g.opponent.abbr)}</span><span class="lt-muted">${esc(fmtShortDay(Date.parse(g.at)))} ${esc(fmtTime(Date.parse(g.at)))}</span></span>`);
    }
    if (d.recent?.length) {
      parts.push(`<span class="lt-label">Hitmen finals</span>`);
      for (const g of d.recent) {
        const tag = g.source_url ? 'a' : 'span';
        const href = g.source_url ? ` href="${esc(g.source_url)}" target="_blank" rel="noopener"` : '';
        const res = g.result || '';
        parts.push(`<${tag} class="lt-item lt-res-${esc(res)}"${href}><span class="lt-res">${esc(res)}</span><span class="lt-vs">${esc(venue(g))}</span>${badge(g.opponent)}<span class="lt-abbr">${esc(g.opponent.abbr)}</span>${scorePair(g.gf, g.ga)}${g.ot ? '<span class="lt-tag">OT</span>' : ''}</${tag}>`);
      }
    }
    const later = (d.upcoming || []).filter(g => g.id !== next?.id && g.id !== live?.id && Date.parse(g.at) > now()).slice(0, 6);
    if (later.length) {
      parts.push(`<span class="lt-label">Hitmen next</span>`);
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

  // ---------- League (separate section, after all Hitmen content) ----------
  function leagueState(g, win) {
    if (g.state === 'final' || (g.away_score != null && g.home_score != null)) return 'final';
    const t = Date.parse(g.at);
    if (now() < t) return 'scheduled';
    if (now() < t + win) return 'live';
    return 'pending';
  }
  function leagueOf(d, g) { return g.league || d.teams?.[g.home]?.league || d.teams?.[g.away]?.league || 'LGCHL'; }
  // Scope is applied server-side (?scope=); OHL/QMJHL groups only carry big games unless scope=all.
  const groupName = lg => (lg !== 'WHL' && cfg.league !== 'all' ? `${lg} big games` : lg);
  function byLeague(d, games) {
    const groups = new Map(LEAGUE_ORDER.map(k => [k, []]));
    for (const g of games) { const k = leagueOf(d, g); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
    return [...groups.entries()].filter(([, list]) => list.length);
  }
  function teamSide(d, id, score, other, final) {
    const t = d.teams?.[id] || { abbr: String(id) };
    const cls = !final ? '' : score > other ? ' lt-hi' : ' lt-lo';
    return `<span class="lt-side${cls}">${badge(t)}<span class="lt-abbr">${esc(t.abbr)}</span>${final ? `<span class="lt-num">${esc(score)}</span>` : ''}</span>`;
  }
  function leagueFinal(d, g) {
    return `<a class="lt-item lt-lg" href="${esc(g.url)}" target="_blank" rel="noopener" title="${esc((d.teams?.[g.away]?.name || '') + ' at ' + (d.teams?.[g.home]?.name || ''))}">${teamSide(d, g.away, g.away_score, g.home_score, true)}${teamSide(d, g.home, g.home_score, g.away_score, true)}<span class="lt-tag">F</span></a>`;
  }
  function leagueMatchup(d, g, note = '') {
    return `<span class="lt-item lt-lg">${teamSide(d, g.away)}<span class="lt-at">@</span>${teamSide(d, g.home)}${note ? `<span class="lt-tag">${esc(note)}</span>` : ''}</span>`;
  }
  function leagueRail(d) {
    const win = (d.game_window_min || 35) * 60e3;
    const parts = [`<span class="lt-section" role="separator" aria-label="LGCHL league scores">LGCHL<span>League scores</span></span>`];
    const nights = [];
    if (d.last_night?.games?.length) nights.push({ kind: 'finals', day: d.last_night.day, games: d.last_night.games });
    if (d.today?.games?.length) nights.push({ kind: 'today', day: d.today.day, games: d.today.games });
    else if (d.next_night?.games?.length) nights.push({ kind: 'next', day: d.next_night.day, games: d.next_night.games });
    for (const n of nights) {
      const games = n.games.map(g => ({ ...g, st: leagueState(g, win) }));
      if (!games.length) continue;
      const dayLabel = fmtDate(Date.parse(games[0].at));
      const finals = games.filter(g => g.st === 'final');
      const active = games.filter(g => g.st === 'live' || g.st === 'pending');
      const slate = games.filter(g => g.st === 'scheduled');
      if (finals.length) for (const [lg, list] of byLeague(d, finals)) {
        parts.push(`<span class="lt-label">${esc(groupName(lg))} · ${esc(n.kind === 'today' ? 'Tonight' : dayLabel)} · Final</span>`);
        for (const g of list) parts.push(leagueFinal(d, g));
      }
      if (active.length) for (const [lg, list] of byLeague(d, active)) {
        parts.push(`<span class="lt-label">${esc(groupName(lg))} · In progress</span>`);
        for (const g of list) parts.push(leagueMatchup(d, g, g.st === 'live' ? 'In prog' : 'Awaiting'));
      }
      if (slate.length) {
        const slots = new Map();
        for (const g of slate) { const k = g.at; if (!slots.has(k)) slots.set(k, []); slots.get(k).push(g); }
        for (const [at, list] of [...slots.entries()].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))) {
          const ms = Date.parse(at);
          for (const [lg, glist] of byLeague(d, list)) {
            parts.push(`<span class="lt-label">${esc(groupName(lg))} · ${esc(fmtDay(ms))} ${esc(fmtTime(ms, true))}</span>`);
            for (const g of glist) parts.push(leagueMatchup(d, g));
          }
        }
      }
    }
    return parts.length > 1 ? parts.join('') : '';
  }

  // ---------- render ----------
  function brandHtml() {
    const tag = cfg.href ? 'a' : 'div';
    const href = cfg.href ? ` href="${esc(cfg.href)}"` : '';
    if (hData) {
      const d = hData;
      const streak = d.streak ? `<span class="lt-streak" title="Current streak">${esc(d.streak.label)}</span>` : '';
      return `<${tag} class="lt-brand"${href}>${badge(d.team, 'lt-badge-team')}<span class="lt-brand-copy"><span class="lt-team">${esc(d.team.short || d.team.name)}</span><span class="lt-league">${esc(d.team.league || '')} · S${esc(d.season)}</span></span><span class="lt-record" title="Season record W-L-OTL"><span class="lt-rec">${esc(d.record.label)}</span>${streak}</span></${tag}>`;
    }
    return `<div class="lt-brand lt-brand-league"><span class="lt-brand-copy"><span class="lt-team">LGCHL</span><span class="lt-league">S${esc(lData?.season || '')} · Scores</span></span></div>`;
  }

  function render() {
    if (!root) return;
    const seq = (hData ? hitmenRail(hData) : '') + (lData && cfg.league !== 'off' ? leagueRail(lData) : '');
    root.innerHTML = `
      ${brandHtml()}
      ${featureHtml(hData)}
      <div class="lt-rail" tabindex="0" aria-label="Results and upcoming games">
        <div class="lt-track"><div class="lt-seq">${seq}</div><div class="lt-seq lt-clone" aria-hidden="true">${seq}</div></div>
      </div>
      <span class="lt-sr">${esc(summary())}</span>`;
    root.querySelectorAll('img[data-abbr]').forEach(img => img.addEventListener('error', () => {
      const span = img.parentElement; span.classList.add('lt-badge-text'); span.textContent = img.dataset.abbr;
    }, { once: true }));
    root.querySelectorAll('.lt-clone a').forEach(a => a.setAttribute('tabindex', '-1'));
    sizeMarquee();
    tick();
  }

  function summary() {
    let s = '';
    if (hData) {
      const { live, next } = pickFeature(hData);
      s = `Calgary Hitmen ${hData.record.label}${hData.streak ? ', streak ' + hData.streak.label : ''}.`;
      if (live) s += ` Live now, ${venueLabel(live)} ${live.opponent.name}.`;
      else if (next) s += ` Next: ${venueLabel(next)} ${next.opponent.name}, ${fmtDay(Date.parse(next.at))} ${fmtTime(Date.parse(next.at), true)}.`;
    }
    if (lData) s += ` LGCHL league scores: ${lData.last_night?.games?.length || 0} recent finals, ${lData.today?.games?.length || 0} games today.`;
    return s.trim();
  }

  function sizeMarquee() {
    const seq = root?.querySelector('.lt-seq'); const track = root?.querySelector('.lt-track');
    if (!seq || !track) return;
    track.style.setProperty('--lt-duration', `${Math.max(20, Math.round(seq.scrollWidth / cfg.pxPerSecond))}s`);
  }

  function tick() {
    if (!root) return;
    if (hData) {
      const { live, next } = pickFeature(hData);
      const key = live ? 'live:' + live.id : next ? 'next:' + next.id : 'none';
      if (key !== featureKey) { render(); return; }
    }
    const clock = root.querySelector('.lt-clock');
    if (!clock) return;
    if (clock.dataset.until) {
      clock.textContent = countdown(Date.parse(clock.dataset.until) - now());
    } else if (clock.dataset.elapsed) {
      const ms = now() - Date.parse(clock.dataset.elapsed);
      clock.textContent = `+${pad(Math.max(0, Math.floor(ms / 60000)))}:${pad(Math.floor((ms % 60000) / 1000))}`;
    }
  }

  // ---------- data ----------
  function readToken() {
    try {
      const s = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      const tok = s?.access_token || s?.currentSession?.access_token;
      const exp = s?.expires_at || s?.currentSession?.expires_at;
      return tok && (!exp || exp * 1000 > Date.now() + 5000) ? tok : null;
    } catch { return null; }
  }
  async function sessionToken() {
    try {
      // eslint-disable-next-line no-undef
      if (typeof vvhlDb !== 'undefined' && vvhlDb?.auth?.getSession) { const { data: s } = await vvhlDb.auth.getSession(); if (s?.session?.access_token) return s.session.access_token; }
    } catch {}
    return readToken();
  }
  async function getJson(url, headers = {}) {
    const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, credentials: 'same-origin' });
    return r;
  }
  async function loadHitmen() {
    let r = await getJson(cfg.endpoint);
    if (r.status === 401) { const tok = await sessionToken(); if (tok) r = await getJson(cfg.endpoint, { Authorization: `Bearer ${tok}` }); }
    if (!r.ok) throw new Error('hitmen ' + r.status);
    const b = await r.json(); if (!b?.ok) throw new Error('hitmen payload'); return b;
  }
  async function loadLeague() {
    const u = new URL(cfg.leagueEndpoint, location.href);
    if (!u.searchParams.has('scope')) u.searchParams.set('scope', ['all', 'whl', 'big'].includes(cfg.league) ? cfg.league : 'featured');
    const r = await getJson(u.pathname + u.search);
    if (!r.ok) throw new Error('league ' + r.status);
    const b = await r.json(); if (!b?.ok) throw new Error('league payload'); return b;
  }

  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'live-ticker'; root.className = 'lt';
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Live ticker: Calgary Hitmen and LGCHL scores');
    document.body.prepend(root);
    document.documentElement.classList.add('has-live-ticker');
    if (cfg.sticky) document.documentElement.classList.add('lt-sticky');
  }
  function unmount() { root?.remove(); root = null; document.documentElement.classList.remove('has-live-ticker', 'lt-sticky'); }
  function save() { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), h: hData, l: lData })); } catch {} }
  // Only re-render when the content changed, so polling never restarts a long crawl mid-loop.
  const VOLATILE = new Set(['generated_at', 'fetched_at', 'full_crawl_at', 'crawl', 'mode']);
  const sig = o => JSON.stringify(o, (k, v) => (VOLATILE.has(k) ? undefined : v));
  let lastSig = '';
  function show() {
    if (!hData && !lData) { unmount(); return; }
    const s = sig([hData, lData]);
    mount();
    if (s !== lastSig || !root.firstChild) { lastSig = s; render(); }
    save();
  }

  async function refreshHitmen() {
    if (document.hidden && hData) return;
    try { hData = await loadHitmen(); } catch { /* keep last good */ }
    show();
  }
  async function refreshLeague() {
    if (cfg.league === 'off' || (document.hidden && lData)) return;
    try { lData = await loadLeague(); } catch { /* keep last good */ }
    show();
  }

  function start() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
      if (c && Date.now() - c.at < 10 * 60e3) { hData = c.h?.ok ? c.h : null; lData = c.l?.ok ? c.l : null; if (hData || lData) { mount(); lastSig = sig([hData, lData]); render(); } }
    } catch {}
    refreshHitmen(); refreshLeague();
    setInterval(tick, 1000);
    setInterval(refreshHitmen, cfg.poll);
    setInterval(refreshLeague, cfg.leaguePoll);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshHitmen(); refreshLeague(); } });
    window.addEventListener('resize', () => sizeMarquee(), { passive: true });
    reduced?.addEventListener?.('change', () => render());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
