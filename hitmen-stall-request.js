// My Stall: "Request your stall" for Discord-signed-in users with no Calgary stall.
// Only the typed gamertag goes to the server. Discord ID / name are read server-side
// (public.hitmen_request_stall). Nothing is attached until management approves in the War Room.
(() => {
  const E = id => document.getElementById(id);
  const DB = () => window.VVHLBackend?.db;
  const ST = () => window.VVHLBackend?.state || {};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const when = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}); };
  const cls = c => c === 'tc' || c === 'training_camp' ? 'Training camp' : c === 'active_roster' ? 'Active roster' : '—';
  const POLL_MS = 30000;

  const REASONS = {
    no_match: t => `No Calgary Season 55 stall matches “${t}”. Check the spelling on the LeagueGaming roster. Capitals and spaces don’t matter, but underscores, dots and numbers do.`,
    ambiguous: () => 'That matches more than one stall. Type the gamertag exactly as it appears, including I and l.',
    not_on_roster: () => 'That stall is archived. Only active roster and training camp players can request a stall.',
    stall_taken: () => 'That stall is already claimed by another account. If it’s yours, message management on Discord.',
    stall_linked: () => 'That stall is already linked to a different Discord account. If it’s yours, message management on Discord.',
    already_prelinked: () => 'Management has already linked your Discord account. Reload this page. If your stall still doesn’t show, message management.',
    request_pending: () => 'You already have a request waiting for management.',
    rate_limited: () => 'Too many requests in the last 24 hours. Try again tomorrow, or message management on Discord.',
    invalid_gamertag: () => 'Enter your gamertag (2 to 40 characters).',
    discord_required: () => 'Stall requests need a Discord sign-in. Sign out, then use Continue with Discord.',
    access_removed: () => 'This account’s Calgary access was removed, so it can’t request a stall. Message management on Discord.',
    already_has_stall: () => 'Your account already has a stall. Reloading…',
  };

  let state = null, poll = null, busy = false, wasPending = false, seq = 0;

  const host = () => E('stallRequest');
  const shell = () => E('stallRequestShell');

  function show(on) {
    if (shell()) shell().hidden = !on;
    if (host()) host().hidden = !on;
    // The request card explains the situation, so the generic "team sign-in required" note steps aside
    // (CSS: body.sr-active #lockerLockedMessage). A class, so the locker gate can keep toggling [hidden].
    document.body.classList.toggle('sr-active', Boolean(on));
    if (!on) stopPoll();
  }
  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }
  function startPoll() { if (!poll) poll = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS); }

  function openStall(lockerId) {
    const url = 'hitmen-player-locker.html' + (lockerId ? '?player=' + encodeURIComponent(lockerId) + '&stall=approved' : '');
    location.replace(url);
  }

  function formHtml(prefill, note) {
    return `<form class="sr-form" id="srForm" novalidate>
        <label for="srGamertag">Your LeagueGaming gamertag<input id="srGamertag" class="sr-input" name="gamertag" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Gamertag" value="${esc(prefill || '')}" required></label>
        <button class="sr-btn primary" id="srSubmit" type="submit">Request stall</button>
      </form>
      <p class="sr-note">${note || 'Type it as it appears on the Calgary roster on LeagueGaming. Capitals and spaces don’t matter. Active roster and training camp stalls only. Management approves every request. Nothing is linked automatically.'}</p>
      <div class="sr-msg" id="srMsg" role="status"></div>`;
  }

  function render() {
    const el = host(); if (!el) return;
    const s = state || {}, req = s.request;
    const head = (k, h, p) => `<div><span class="sr-k">${k}</span><h3>${h}</h3>${p ? `<p>${p}</p>` : ''}</div>`;
    if (!s.discord) {
      el.innerHTML = head('Calgary Hitmen · Season 55', 'Request your stall', REASONS.discord_required());
      stopPoll(); return;
    }
    if (s.access_removed) {
      el.innerHTML = head('Calgary Hitmen · Season 55', 'Stall requests closed', REASONS.access_removed());
      stopPoll(); return;
    }
    if (req && req.status === 'pending') {
      wasPending = true;
      el.innerHTML = head('Calgary Hitmen · Season 55', 'Waiting for management approval') +
        `<div class="sr-status"><span class="sr-pulse" aria-hidden="true"></span><div><b>Request sent</b><small>Management will check it against the roster. This page checks again every 30 seconds and opens your stall once it’s approved. You don’t need to sign in again.</small></div></div>
        <dl class="sr-dl"><div><dt>Stall</dt><dd>${esc(req.matched_gamertag)}</dd></div><div><dt>Roster</dt><dd>${esc(cls(req.roster_class))}</dd></div><div><dt>Sent</dt><dd>${esc(when(req.created_at))}</dd></div></dl>
        <div class="sr-actions"><button class="sr-btn ghost" id="srWithdraw" type="button">Withdraw request</button><button class="sr-btn ghost" id="srCheck" type="button">Check now</button></div>
        <div class="sr-msg" id="srMsg" role="status"></div>`;
      E('srWithdraw')?.addEventListener('click', withdraw);
      E('srCheck')?.addEventListener('click', () => refresh(true));
      startPoll(); return;
    }
    stopPoll();
    if (req && req.status === 'rejected') {
      el.innerHTML = head('Calgary Hitmen · Season 55', 'Request not approved') +
        `<div class="sr-status is-rejected"><span class="sr-pulse" aria-hidden="true"></span><div><b>${esc(req.matched_gamertag)} · not approved</b><small>${esc(req.decision_note || 'Management didn’t approve this request.')} ${esc(when(req.decided_at))}</small></div></div>` +
        formHtml('', 'If you think this is a mistake, check the gamertag and send a new request, or message management on Discord. Requests are limited to 3 per day.');
    } else {
      el.innerHTML = head('Calgary Hitmen · Season 55', 'Request your stall', 'Signed in with Discord, but this account isn’t linked to a Calgary stall yet. Send your gamertag and management will approve it.') + formHtml('');
    }
    E('srForm')?.addEventListener('submit', submit);
  }

  function msg(text, err) { const m = E('srMsg'); if (m) { m.textContent = text || ''; m.classList.toggle('err', Boolean(err)); } }

  async function submit(ev) {
    ev.preventDefault();
    if (busy) return;
    const input = E('srGamertag'); const tag = String(input?.value || '').trim();
    if (tag.length < 2 || tag.length > 40) { msg(REASONS.invalid_gamertag(), true); input?.focus(); return; }
    busy = true; const btn = E('srSubmit'); if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    msg('');
    try {
      const r = await DB().rpc('hitmen_request_stall', { p_gamertag: tag });
      if (r.error) throw r.error;
      const d = r.data || {};
      if (d.ok) { await refresh(); return; }
      if (d.reason === 'already_has_stall' || d.reason === 'already_prelinked') { msg((REASONS[d.reason] || REASONS.no_match)(tag)); setTimeout(() => location.reload(), 1600); return; }
      if (d.reason === 'request_pending') { await refresh(); return; }
      msg((REASONS[d.reason] || (() => 'That request couldn’t be sent. Try again, or message management.'))(tag), true);
    } catch (e) {
      console.warn('Stall request failed', e);
      msg('That request couldn’t be sent right now. Try again in a minute.', true);
    } finally {
      busy = false; if (btn && document.body.contains(btn)) { btn.disabled = false; btn.textContent = 'Request stall'; }
    }
  }

  async function withdraw() {
    if (busy) return; busy = true;
    const btn = E('srWithdraw'); if (btn) btn.disabled = true;
    try {
      const r = await DB().rpc('hitmen_withdraw_stall_request');
      if (r.error) throw r.error;
      wasPending = false; await refresh();
    } catch (e) { console.warn(e); msg('Couldn’t withdraw right now. Try again.', true); if (btn) btn.disabled = false; }
    finally { busy = false; }
  }

  async function refresh(manual) {
    const db = DB(), st = ST();
    if (!db || !st.user || !host()) { show(false); return; }
    const my = ++seq;
    let r;
    try { r = await db.rpc('hitmen_my_stall_request'); } catch (e) { r = { error: e }; }
    if (my !== seq) return;
    if (r.error) { console.warn('Stall request status unavailable', r.error); show(false); return; }
    const s = r.data || {};
    if (!s.signed_in || s.is_manager) { show(false); return; }
    if (s.has_stall) {
      // Approved while this page was open: open the stall in the same session (no new sign-in).
      // Approved earlier: the normal locker flow already shows it, so just stay out of the way.
      if (wasPending) {
        show(true);
        host().innerHTML = `<div><span class="sr-k">Calgary Hitmen · Season 55</span><h3>Approved</h3><p>Your stall is ready. Opening it now…</p></div>`;
        stopPoll();
        try { await window.VVHLBackend?.refresh?.(); } catch (_) {}
        setTimeout(() => openStall(s.locker_id), 600);
      } else show(false);
      return;
    }
    state = s; show(true); render();
    if (manual) msg('Still waiting. Checked ' + new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) + '.');
  }

  window.addEventListener('vvhl-auth-change', () => refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && poll) refresh(); });
  if (ST().user) refresh();
})();
