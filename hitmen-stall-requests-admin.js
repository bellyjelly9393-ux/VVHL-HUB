// War Room: "Stall requests" panel. Management only: the list/approve/reject RPCs check
// private.vvhl_can_manage_team (owner / GM / AGM / site admin) inside the database, and the
// panel stays hidden for anyone the list call refuses (scouts, players).
(() => {
  const E = id => document.getElementById(id);
  const DB = () => window.VVHLBackend?.db;
  const ST = () => window.VVHLBackend?.state || {};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const when = v => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}); };
  const cls = c => c === 'tc' || c === 'training_camp' ? 'TC' : c === 'active_roster' ? 'Active' : String(c || '—');
  const ERR = {
    access_removed: 'Refused: this account’s Calgary access was removed (archived player).',
    already_has_stall: 'Refused: this account already has a stall.',
    not_on_roster: 'Refused: that stall is no longer active roster or TC.',
    stall_taken: 'Refused: the stall is already claimed by another account.',
    stall_linked: 'Refused: the stall is pre-linked to a different Discord ID.',
    discord_linked_elsewhere: 'Refused: this Discord ID is already linked to another stall.',
    alias_conflict: 'Refused: a Discord link with this gamertag already exists for another stall. Fix it in the links table first.',
    not_pending: 'Already decided. Refreshing.',
    not_found: 'Request not found. Refreshing.',
  };
  let rows = [], loading = false, allowed = null;

  const panel = () => E('stallReqPanel');
  function setVisible(on) { [panel(), E('stallReqHead')].forEach(el => { if (el) el.hidden = !on; }); }

  function rowHtml(r, closed) {
    const typed = r.requested_gamertag && r.requested_gamertag.replace(/\s+/g, ' ').toLowerCase() !== String(r.matched_gamertag || '').toLowerCase()
      ? `<span class="sr-sub">Typed “${esc(r.requested_gamertag)}”</span>` : '';
    const flags = [];
    if (r.access_removed) flags.push('<span class="sr-tag flag">Account removed</span>');
    if (r.stall_taken && !closed) flags.push('<span class="sr-tag flag">Stall already claimed</span>');
    if (Number(r.same_stall_pending) > 0 && !closed) flags.push(`<span class="sr-tag flag">${Number(r.same_stall_pending)} other request${Number(r.same_stall_pending) === 1 ? '' : 's'} for this stall</span>`);
    const discord = `<div class="sr-dn">${esc(r.discord_name || r.discord_username || 'Discord user')}</div>` +
      (r.discord_username && r.discord_username !== r.discord_name ? `<span class="sr-sub">@${esc(r.discord_username)}</span>` : '') +
      `<code title="Discord user ID">${esc(r.discord_user_id)}</code>`;
    const right = closed
      ? `<div><span class="sr-tag">${esc(r.status)}</span><span class="sr-sub">${esc(when(r.decided_at))}</span>${r.decision_note ? `<span class="sr-sub">${esc(r.decision_note)}</span>` : ''}</div>`
      : `<div class="sr-actions"><button class="sr-btn primary" type="button" data-sr-approve="${esc(r.id)}" ${r.access_removed || r.stall_taken ? 'disabled' : ''}>Approve</button><button class="sr-btn" type="button" data-sr-reject="${esc(r.id)}">Reject</button></div>
         <div class="sr-reject-note"><input class="sr-input" maxlength="280" placeholder="Reason shown to the player (optional)" data-sr-note="${esc(r.id)}" aria-label="Reject reason"><button class="sr-btn" type="button" data-sr-reject-go="${esc(r.id)}">Confirm reject</button><button class="sr-btn ghost" type="button" data-sr-reject-cancel="${esc(r.id)}">Cancel</button></div>
         <div class="sr-msg sr-rowmsg" data-sr-msg="${esc(r.id)}" role="status"></div>`;
    return `<li class="sr-row" data-sr-row="${esc(r.id)}">
      <div><div class="sr-gt">${esc(r.matched_gamertag)}</div><span class="sr-sub"><span class="sr-tag">${esc(cls(r.roster_class))}</span> ${esc(r.position || '')}</span>${typed}${flags.length ? `<div class="sr-flags">${flags.join('')}</div>` : ''}</div>
      <div>${discord}</div>
      <div class="sr-when">${esc(when(r.created_at))}</div>
      ${right}
    </li>`;
  }

  function render() {
    const el = panel(); if (!el) return;
    const open = rows.filter(r => r.status === 'pending'), closed = rows.filter(r => r.status !== 'pending');
    const count = E('stallReqCount'); if (count) count.textContent = open.length ? `${open.length} waiting` : 'None waiting';
    el.innerHTML = `<div class="sr-admin-bar"><p>Players who signed in with Discord and asked for a stall. Approve links their Discord ID to the stall and gives them ordinary player access, the same as a management pre-link. Archived accounts and claimed stalls are refused by the database.</p><button class="sr-btn ghost" type="button" id="stallReqRefresh">Refresh</button></div>
      ${open.length ? `<ul class="sr-list">${open.map(r => rowHtml(r, false)).join('')}</ul>` : '<div class="sr-empty">No stall requests waiting.</div>'}
      ${closed.length ? `<details class="sr-closed"><summary>Decided in the last 30 days · ${closed.length}</summary><ul class="sr-list">${closed.map(r => rowHtml(r, true)).join('')}</ul></details>` : ''}`;
    E('stallReqRefresh')?.addEventListener('click', load);
    el.querySelectorAll('[data-sr-approve]').forEach(b => b.addEventListener('click', () => approve(b)));
    el.querySelectorAll('[data-sr-reject]').forEach(b => b.addEventListener('click', () => { const row = b.closest('.sr-row'); row?.classList.add('rejecting'); row?.querySelector('[data-sr-note]')?.focus(); }));
    el.querySelectorAll('[data-sr-reject-cancel]').forEach(b => b.addEventListener('click', () => b.closest('.sr-row')?.classList.remove('rejecting')));
    el.querySelectorAll('[data-sr-reject-go]').forEach(b => b.addEventListener('click', () => reject(b)));
  }

  const rowMsg = (id, t, err) => { const m = panel()?.querySelector(`[data-sr-msg="${CSS.escape(id)}"]`); if (m) { m.textContent = t || ''; m.classList.toggle('err', Boolean(err)); } };

  async function approve(btn) {
    const id = btn.dataset.srApprove;
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed'); btn.textContent = 'Confirm approve';
      setTimeout(() => { if (document.body.contains(btn) && !btn.disabled) { btn.classList.remove('armed'); btn.textContent = 'Approve'; } }, 5000);
      return;
    }
    btn.disabled = true; btn.textContent = 'Approving…';
    try {
      const r = await DB().rpc('hitmen_approve_stall_request', { p_request_id: id });
      if (r.error) throw r.error;
      if (!r.data?.ok) { rowMsg(id, ERR[r.data?.reason] || 'Refused: ' + (r.data?.reason || 'unknown'), true); btn.disabled = false; btn.classList.remove('armed'); btn.textContent = 'Approve'; if (['not_pending','not_found'].includes(r.data?.reason)) setTimeout(load, 900); return; }
      rowMsg(id, `Approved. ${r.data.gamertag} is linked. The player sees the stall on their next load.`);
      setTimeout(load, 1200);
    } catch (e) { console.warn(e); rowMsg(id, e.message || 'Approve failed.', true); btn.disabled = false; btn.classList.remove('armed'); btn.textContent = 'Approve'; }
  }

  async function reject(btn) {
    const id = btn.dataset.srRejectGo;
    const note = panel()?.querySelector(`[data-sr-note="${CSS.escape(id)}"]`)?.value || '';
    btn.disabled = true; btn.textContent = 'Rejecting…';
    try {
      const r = await DB().rpc('hitmen_reject_stall_request', { p_request_id: id, p_note: note.trim() || null });
      if (r.error) throw r.error;
      if (!r.data?.ok) { rowMsg(id, ERR[r.data?.reason] || 'Could not reject.', true); setTimeout(load, 900); return; }
      rowMsg(id, 'Rejected. The player sees the decision on My Stall.');
      setTimeout(load, 900);
    } catch (e) { console.warn(e); rowMsg(id, e.message || 'Reject failed.', true); btn.disabled = false; btn.textContent = 'Confirm reject'; }
  }

  async function load() {
    const db = DB(), st = ST();
    if (!db || !st.user || !panel()) { setVisible(false); return; }
    if (loading) return; loading = true;
    try {
      const r = await db.rpc('hitmen_list_stall_requests', { p_include_closed: true });
      if (r.error) { allowed = false; setVisible(false); if (String(r.error.code) !== '42501') console.warn('Stall requests unavailable', r.error); return; }
      allowed = true; rows = Array.isArray(r.data) ? r.data : [];
      setVisible(true); render();
    } catch (e) { console.warn(e); setVisible(false); }
    finally { loading = false; }
  }

  window.addEventListener('vvhl-auth-change', () => load());
  setInterval(() => { if (allowed && !document.hidden && !panel()?.querySelector('.armed,.rejecting')) load(); }, 60000);
  if (ST().user) load();
})();
