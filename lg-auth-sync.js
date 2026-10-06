(() => {
  const E = id => document.getElementById(id);
  const PENDING_KEY = 'wildman-lg-auth-pending';
  const LAST_KEY = 'wildman-lg-auth-last';
  const LG_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?leaguegaming\.com$/i;

  // Runs inside the signed-in LeagueGaming tab. LG cookies, passwords and session tokens
  // never leave that tab: only sanitized page content is posted to the Wildman bridge.
  function collector(target) {
    try {
      const TARGET = String(target || 'https://wildmanhockey-elitechelmedia.app').replace(/\/+$/,'');
      if (!/(^|\.)leaguegaming\.com$/i.test(location.hostname)) {
        alert('Open the LeagueGaming page you want to sync first.');
        return;
      }

      const keep = new Set(['leaguegaming/league','action','page','leagueid','seasonid','teamid','gameid','userid','user_id','week','games']);
      const safeUrl = raw => {
        const u = new URL(raw, location.href);
        if (!/(^|\.)leaguegaming\.com$/i.test(u.hostname) || u.protocol !== 'https:') return '';
        u.username = ''; u.password = ''; u.hash = '';
        [...u.searchParams.keys()].forEach(k => { if (!keep.has(k)) u.searchParams.delete(k); });
        return u.toString();
      };
      const strip = root => {
        root.querySelectorAll('script,style,iframe,textarea,input,button,select,option,meta,link,canvas,video,audio,noscript').forEach(n => n.remove());
        root.querySelectorAll('form').forEach(f => f.replaceWith(...f.childNodes));
      };
      const contentRoot = doc => doc.querySelector('main,.p-body-main,#content,.mainContent,.pageContent') || doc.body;
      // One line per table cell / block, the layout the Public Log parser expects.
      const linesOf = root => {
        const c = root.cloneNode(true);
        strip(c);
        c.querySelectorAll('td,th,tr,div,p,br,li,h1,h2,h3,h4,h5,h6,dt,dd').forEach(n => n.after(document.createTextNode('\n')));
        return (c.textContent || '').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      };

      const body = document.body.cloneNode(true);
      strip(body);
      body.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(a => {
          const n = a.name.toLowerCase();
          if (!['href','title','alt','class','id','colspan','rowspan'].includes(n)) el.removeAttribute(a.name);
        });
        if (el.hasAttribute('href')) {
          const href = safeUrl(el.getAttribute('href') || '');
          if (href) el.setAttribute('href', href); else el.removeAttribute('href');
        }
      });

      const root = contentRoot(body);
      const tables = [...root.querySelectorAll('table')].slice(0, 120).map(t => ({
        text: (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50000),
        rows: [...t.querySelectorAll('tr')].slice(0, 300).map(r => ({
          text: (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
          links: [...r.querySelectorAll('a[href]')].slice(0, 30).map(a => ({
            text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
            href: safeUrl(a.getAttribute('href') || ''),
          })).filter(x => x.href)
        }))
      }));

      // Classify by the URL's page id. LG's site navigation mentions every page type, so body text is not used.
      const page = String(new URL(location.href).searchParams.get('page') || '').toLowerCase();
      const byPage = {roster:'roster', game:'game', league_game_edit_log:'box_score', team_page_schedule:'schedule',
        team_page:'schedule', schedule:'schedule', player_stats:'stats', player_stats_advanced:'stats', standings:'stats'};
      const titled = (page + ' ' + document.title).toLowerCase();
      const captureType = byPage[page] ||
        (/weekly\s*lines|weekly_lines|lineup/.test(titled) ? 'weekly_lines' : /transaction|trade/.test(titled) ? 'transactions' : 'unknown');

      const payload = {
        type: 'WILDMAN_LG_AUTH_SYNC_CAPTURE',
        data: {
          captureType,
          sourceUrl: safeUrl(location.href),
          sourceTitle: document.title || 'LeagueGaming',
          capturedAt: new Date().toISOString(),
          html: root.outerHTML.slice(0, 1500000),
          text: (captureType === 'box_score' ? linesOf(contentRoot(document)) : (root.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 400000),
          tables,
        }
      };

      const bridge = window.open(TARGET + '/lg-capture.html?mode=authsync', 'wildmanLgAuthSync');
      if (!bridge) {
        alert('Allow popups for LeagueGaming once, then run Wildman Auth Sync again.');
        return;
      }

      // The bridge may ask this tab for specific Calgary game Public Logs. Only numeric game ids are
      // accepted, only LG's own Public Log page is fetched, and only from the Wildman bridge window.
      const onRequest = async ev => {
        if (ev.origin !== TARGET || ev.source !== bridge) return;
        const d = ev.data;
        if (!d || d.type !== 'WILDMAN_LG_FETCH_PUBLIC_LOGS' || !Array.isArray(d.gameIds)) return;
        window.removeEventListener('message', onRequest);
        const ids = [...new Set(d.gameIds.map(String).filter(x => /^\d{1,12}$/.test(x)))].slice(0, 12);
        const logs = [];
        for (const id of ids) {
          const url = location.origin + '/forums/index.php?leaguegaming/league&action=league&page=league_game_edit_log&gameid=' + id;
          try {
            const r = await fetch(url, {credentials: 'include', cache: 'no-store', headers: {accept: 'text/html'}});
            if (!r.ok) { logs.push({gameId: id, error: 'LG returned HTTP ' + r.status}); continue; }
            const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
            const text = linesOf(contentRoot(doc));
            if (!/\bTeam Stats\b/i.test(text)) { logs.push({gameId: id, error: 'Box score not saved on LG yet'}); continue; }
            logs.push({gameId: id, sourceUrl: url, sourceTitle: doc.title || ('LG Public Log ' + id), text: text.slice(0, 200000)});
          } catch (e) { logs.push({gameId: id, error: String((e && e.message) || e)}); }
        }
        try { bridge.postMessage({type: 'WILDMAN_LG_PUBLIC_LOGS', logs}, TARGET); } catch {}
      };
      window.addEventListener('message', onRequest);
      setTimeout(() => window.removeEventListener('message', onRequest), 10 * 60 * 1000);

      let tries = 0;
      const send = () => {
        try { bridge.postMessage(payload, TARGET); } catch {}
        if (++tries < 7) setTimeout(send, 650);
      };
      setTimeout(send, 400);
    } catch (e) {
      console.error(e);
      alert('Wildman LG Sync could not capture this page. ' + ((e && e.message) || ''));
    }
  }

  const bookmarklet = 'javascript:(' + collector.toString() + ')(' + JSON.stringify(location.origin) + ')';

  function setMessage(text, bad = false) {
    const el = E('authSyncMessage');
    if (el) {
      el.textContent = text;
      el.style.color = bad ? '#ff9a9a' : '#9ff4bc';
    }
  }

  function setStatus(text) {
    const el = E('authSyncStatus');
    if (el) el.textContent = text;
  }

  function install() {
    const link = E('lgAuthSyncBookmarklet');
    if (link) link.href = bookmarklet;
    E('copyLgAuthSync')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(bookmarklet);
        setMessage('Copied. Save it as a bookmark named “Wildman Auth Sync”.');
      } catch {
        setMessage('Copy failed. Drag the Wildman Auth Sync button to your bookmarks bar instead.', true);
      }
    });
  }

  async function session() {
    const db = window.VVHLBackend?.db;
    if (!db) return {};
    const { data } = await db.auth.getSession();
    return { db, token: data.session?.access_token || '' };
  }

  async function ingestOne(db, data) {
    const { data: result, error } = await db.functions.invoke('lg-auth-ingest', { body: data });
    if (error) {
      let detail = error.message || 'Authenticated LG import failed.';
      try { const body = await error.context?.json?.(); if (body?.error) detail = body.error; } catch {}
      throw new Error(detail);
    }
    if (!result?.ok) throw new Error(result?.error || 'Authenticated LG import failed.');
    return result;
  }

  // ---- Calgary box scores and automatic recaps ----
  let lgWindow = null, lgOrigin = '';

  async function requestBoxScores() {
    const { db } = await session();
    if (!db || !lgWindow || !lgOrigin) return;
    const { data, error } = await db.rpc('lg_auth_pending_box_scores', { p_days: 14 });
    if (error) { setMessage('Could not check for missing Calgary box scores: ' + error.message, true); return; }
    // Games still needing a recap first, then newest first; the LG tab fetches at most 12 per click.
    const missing = (data || []).filter(g => !g.has_box_score)
      .sort((a, b) => (a.has_recap - b.has_recap) || (Date.parse(b.game_at) - Date.parse(a.game_at)))
      .slice(0, 12).map(g => String(g.lg_game_id));
    const needRecap = (data || []).filter(g => g.has_box_score && !g.has_recap).map(g => g.lg_game_id);
    if (missing.length) {
      setMessage('Fetching ' + missing.length + ' Calgary box score' + (missing.length === 1 ? '' : 's') + ' through your LeagueGaming tab…');
      try { lgWindow.postMessage({ type: 'WILDMAN_LG_FETCH_PUBLIC_LOGS', gameIds: missing }, lgOrigin); }
      catch { setMessage('The LeagueGaming tab was closed. Run Wildman Auth Sync again to pull box scores.', true); }
    } else if (needRecap.length) {
      writeRecaps(needRecap);
    }
  }

  async function receiveLogs(logs) {
    const { db } = await session();
    if (!db) return;
    const saved = [], problems = [];
    for (const log of (Array.isArray(logs) ? logs : []).slice(0, 12)) {
      if (!log?.text) { problems.push('Game ' + log?.gameId + ': ' + (log?.error || 'no box score')); continue; }
      try {
        const r = await ingestOne(db, { captureType: 'box_score', sourceUrl: log.sourceUrl, sourceTitle: log.sourceTitle,
          capturedAt: new Date().toISOString(), text: log.text, html: '', tables: [] });
        saved.push(Number(log.gameId));
        if (r.parsed && r.parsed.goals_reconcile === false) problems.push('Game ' + log.gameId + ': player goals did not add up to the final; review the box score.');
      } catch (e) { problems.push('Game ' + log.gameId + ': ' + e.message); }
    }
    setStatus('BOX SCORES · ' + saved.length + ' saved' + (problems.length ? ' · ' + problems.length + ' need attention' : ''));
    if (problems.length) setMessage(problems.join(' '), true);
    const { data } = await db.rpc('lg_auth_pending_box_scores', { p_days: 14 });
    const needRecap = (data || []).filter(g => g.has_box_score && !g.has_recap).map(g => g.lg_game_id);
    if (needRecap.length) writeRecaps(needRecap);
    else if (!problems.length) setMessage('Box scores saved. Recaps are already posted for these games.');
  }

  async function writeRecaps(ids) {
    const { token } = await session();
    if (!token) return;
    setMessage('Writing ' + ids.length + ' Hitmen recap' + (ids.length === 1 ? '' : 's') + '…');
    try {
      const r = await fetch('/api/hitmen-recap-writer', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lgGameIds: ids }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || ('Recap writer returned ' + r.status));
      const posted = (out.results || []).filter(x => x.ok);
      const failed = (out.results || []).filter(x => !x.ok);
      setStatus('RECAPS · ' + posted.length + ' posted to Hitmen Media' + (failed.length ? ' · ' + failed.length + ' failed' : ''));
      setMessage(posted.length ? posted.map(x => x.title).join(' · ') : '', false);
      if (failed.length) setMessage(failed.map(x => 'Game ' + x.lgGameId + ': ' + x.error).join(' '), true);
    } catch (e) {
      setMessage('Box scores are saved, but the recap writer failed: ' + e.message, true);
    }
  }

  async function ingest(data) {
    const { db, token } = await session();
    if (!db) {
      setMessage('Wildman account service is still loading. The capture is saved in this tab.', true);
      return;
    }
    if (!token) {
      setMessage('Sign in to Wildman management below. The captured LG page will import immediately after sign-in.', true);
      return;
    }

    setMessage('Authenticated LG capture received. Validating and importing…');
    let result;
    try { result = await ingestOne(db, data); }
    catch (e) {
      setMessage(e.message, true);
      sessionStorage.removeItem(PENDING_KEY);
      requestBoxScores();
      return;
    }

    sessionStorage.removeItem(PENDING_KEY);
    localStorage.setItem(LAST_KEY, JSON.stringify({ at: Date.now(), ...result }));
    if (result.captureType === 'roster') {
      const p = result.parsed || {};
      setStatus('ROSTER SYNCED · ' + Number(p.players_seen || p.rows || 0).toLocaleString() + ' players · ' +
        Number(p.teams_seen || p.teams || 0).toLocaleString() + ' teams · ' +
        Number((p.added_candidates || 0) + (p.removed_candidates || 0) + (p.change_candidates || 0)).toLocaleString() +
        ' roster-change candidates queued for review.');
      setMessage(result.duplicate ? 'This exact roster snapshot was already imported.' : 'LG roster imported through your authenticated browser session. No LG cookie or password was sent to Wildman.');
    } else {
      setStatus(String(result.captureType || 'LG').replaceAll('_',' ').toUpperCase() + ' CAPTURED · snapshot ' + String(result.snapshotId || result.snapshot?.id || '').slice(0, 8));
      setMessage(result.parsed?.note || result.note || 'Authenticated LG page captured safely for parsing.');
    }
    // Every sync also checks for Calgary games that still need a box score or recap.
    requestBoxScores();
  }

  function receive(event) {
    if (!LG_ORIGIN.test(event.origin)) return;
    if (event.data?.type === 'WILDMAN_LG_PUBLIC_LOGS') {
      if (event.source === lgWindow) receiveLogs(event.data.logs);
      return;
    }
    if (event.data?.type !== 'WILDMAN_LG_AUTH_SYNC_CAPTURE' || !event.data?.data) return;
    // The collector re-sends the same capture a few times until the bridge is listening; import it once.
    if (receive.seen === event.data.data.capturedAt) return;
    receive.seen = event.data.data.capturedAt;
    lgWindow = event.source;
    lgOrigin = event.origin;
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(event.data.data));
      setStatus('Capture received from ' + (event.data.data.sourceTitle || 'LeagueGaming') + '.');
      ingest(event.data.data);
    } catch (e) {
      setMessage(e?.message || 'Could not read the LG capture.', true);
    }
  }

  function retryPending() {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    try { ingest(JSON.parse(raw)); } catch { sessionStorage.removeItem(PENDING_KEY); }
  }

  window.addEventListener('message', receive);
  window.addEventListener('vvhl-auth-change', retryPending);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { install(); retryPending(); });
  } else {
    install();
    retryPending();
  }
})();
