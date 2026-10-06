(() => {
  const E = id => document.getElementById(id);
  const PENDING_KEY = 'wildman-lg-auth-pending';
  const LAST_KEY = 'wildman-lg-auth-last';

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

      const body = document.body.cloneNode(true);
      body.querySelectorAll('script,style,iframe,textarea,input,button,select,option,meta,link,canvas,video,audio').forEach(n => n.remove());
      body.querySelectorAll('form').forEach(f => f.replaceWith(...f.childNodes));
      body.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(a => {
          const n = a.name.toLowerCase();
          const allowed = ['href','title','alt','class','id','colspan','rowspan'].includes(n);
          if (!allowed) el.removeAttribute(a.name);
        });
        if (el.hasAttribute('href')) {
          const href = safeUrl(el.getAttribute('href') || '');
          if (href) el.setAttribute('href', href); else el.removeAttribute('href');
        }
      });

      const root = body.querySelector('main,.p-body-main,#content,.mainContent,.pageContent') || body;
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

      const page = String(new URL(location.href).searchParams.get('page') || '').toLowerCase();
      const pageText = (root.textContent || '').replace(/\s+/g, ' ').trim();
      const hay = (page + ' ' + pageText.slice(0, 8000)).toLowerCase();
      const captureType = /roster/.test(hay) ? 'roster'
        : /weekly\s*lines|weekly_lines|lineup/.test(hay) ? 'weekly_lines'
        : /transaction|trade/.test(hay) ? 'transactions'
        : /\bteam stats\b|\buser stats\b/.test(hay) || page === 'game' ? 'game'
        : /schedule|calendar|team_page/.test(hay) ? 'schedule'
        : /stats|memberstats/.test(hay) ? 'stats' : 'unknown';

      const payload = {
        type: 'WILDMAN_LG_AUTH_SYNC_CAPTURE',
        data: {
          captureType,
          sourceUrl: safeUrl(location.href),
          sourceTitle: document.title || 'LeagueGaming',
          capturedAt: new Date().toISOString(),
          html: root.outerHTML.slice(0, 1500000),
          text: pageText.slice(0, 400000),
          tables,
        }
      };

      const bridge = window.open(TARGET + '/lg-capture.html?mode=authsync', 'wildmanLgAuthSync');
      if (!bridge) {
        alert('Allow popups for LeagueGaming once, then run Wildman Auth Sync again.');
        return;
      }
      let tries = 0;
      const send = () => {
        try { bridge.postMessage(payload, TARGET); } catch {}
        if (++tries < 7) setTimeout(send, 650);
      };
      setTimeout(send, 400);
      alert('Wildman authenticated sync sent. The bridge will confirm what was imported.');
    } catch (e) {
      console.error(e);
      alert('Wildman LG Sync could not capture this page. ' + (e?.message || ''));
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

  async function ingest(data) {
    const db = window.VVHLBackend?.db;
    if (!db) {
      setMessage('Wildman account service is still loading. The capture is saved in this tab.', true);
      return;
    }
    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData.session?.access_token) {
      setMessage('Sign in to Wildman management below. The captured LG page will import immediately after sign-in.', true);
      return;
    }

    setMessage('Authenticated LG capture received. Validating and importing…');
    const { data: result, error } = await db.functions.invoke('lg-auth-ingest', { body: data });
    if (error) {
      setMessage(error.message || 'Authenticated LG import failed.', true);
      return;
    }
    if (!result?.ok) {
      setMessage(result?.error || 'Authenticated LG import failed.', true);
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
      setMessage(result.parsed?.note || 'Authenticated LG page captured safely for parsing.');
    }
  }

  function receive(event) {
    if (!/^https:\/\/([a-z0-9-]+\.)?leaguegaming\.com$/i.test(event.origin)) return;
    if (event.data?.type !== 'WILDMAN_LG_AUTH_SYNC_CAPTURE' || !event.data?.data) return;
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
