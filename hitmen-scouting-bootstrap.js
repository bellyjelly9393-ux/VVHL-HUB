(() => {
  const route=(location.pathname.replace(/\/+$/,'').split('/').pop()||'').toLowerCase();
  if (!['hitmen','calgary','war-room','hitmen-workspace.html'].includes(route)) return;

  const addStyles = () => {
    if (document.querySelector('link[data-hitmen-scouting-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'hitmen-scouting.css';
    link.dataset.hitmenScoutingCss = '1';
    document.head.appendChild(link);
  };

  const markup = `
  <section id="hitmen-scouting" class="hs-desk" data-hitmen-scouting hidden>
    <div class="hs-header">
      <div><div class="eyebrow">SEASON 55 · PRIVATE TEAM INTELLIGENCE</div><h2>SCOUTING + BIDDING DESK</h2></div>
      <p>One shared Calgary board for every player you scout, every report management writes, and every bid ceiling you want ready before bidding opens.</p>
    </div>
    <div id="hsStatus" class="hitmen-status">Loading Calgary scouting desk…</div>
    <div class="hs-kpis">
      <div class="hs-kpi"><small>ChelScout Focus</small><strong id="hsScouted">0</strong></div>
      <div class="hs-kpi"><small>Priority Targets</small><strong id="hsPriority">0</strong></div>
      <div class="hs-kpi"><small>Bid Targets</small><strong id="hsBids">0</strong></div>
      <div class="hs-kpi"><small>Reports Logged</small><strong id="hsReports">0</strong></div>
    </div>
    <div class="hs-tabs">
      <button class="hs-tab active" data-hs-tab="pool" type="button">Scouting Market</button>
      <button class="hs-tab" data-hs-tab="targets" type="button">★ Targets</button>
      <button class="hs-tab" data-hs-tab="reports" type="button">Scouting Reports</button>
      <button class="hs-tab" data-hs-tab="bids" type="button">Bidding Board</button>
      <span id="hsRole" class="status-pill" style="margin-left:auto">PRIVATE</span>
    </div>

    <div class="hs-pane" data-hs-pane="targets">
      <section class="hs-card">
        <div class="hs-card-head"><div><div class="eyebrow">CALGARY SHORTLIST</div><h3>Target Wishlist</h3></div><span class="hs-msg">Click a player to open the full scouting profile</span></div>
        <div id="hsTargetBoard" class="hs-target-board"></div>
        <div id="hsTargetEmpty" class="hs-empty" hidden>No targets yet. Mark players Watch, Priority or Bid Target from their profile.</div>
      </section>
      <section class="hs-card" style="margin-top:14px">
        <div class="hs-card-head"><div><div class="eyebrow">ONE-CLICK EXTERNAL SYNC</div><h3>ChelScout → Wildman</h3></div><span id="hsChelSyncBadge" class="hs-tag">READY</span></div>
        <p class="hs-msg">Sync a ChelScout player report you legitimately opened into the matching Calgary profile without sending ChelScout cookies or passwords to Wildman.</p>
        <div class="hs-actions">
          <button id="hsCopyChelSync" class="hs-btn primary" type="button">Copy “Send to Wildman” Bookmark</button>
          <a class="hs-btn" href="https://chelscout.net/scout/player" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;text-decoration:none">Open ChelScout Player Scout ↗</a>
        </div>
        <div id="hsChelSyncMsg" class="hs-msg" style="margin-top:9px">Save the copied JavaScript as a browser bookmark URL once. On an exact ChelScout player report, tap that bookmark to send the report here.</div>
      </section>
    </div>

        <div class="hs-pane active" data-hs-pane="pool">
      <section class="hs-card hs-market-card">
        <div class="hs-market-top">
          <div>
            <div class="eyebrow">CALGARY HITMEN · SEASON 55</div>
            <h3>SCOUTING MARKET</h3>
            <p class="hs-msg">Search the full player pool, filter by position and market tier, then tap any player for the complete dossier.</p>
          </div>
          <span class="hs-market-live">LIVE TEAM INTEL</span>
        </div>

        <div class="hs-market-search">
          <span class="hs-search-icon">⌕</span>
          <input id="hsSearch" class="hs-input" type="search" placeholder="Search player">
        </div>

        <div class="hs-position-chips" aria-label="Position filters">
          <button class="active" type="button" data-hs-position="">All</button>
          <button type="button" data-hs-position="F">F</button>
          <button type="button" data-hs-position="D">D</button>
          <button type="button" data-hs-position="LW">LW</button>
          <button type="button" data-hs-position="C">C</button>
          <button type="button" data-hs-position="RW">RW</button>
          <button type="button" data-hs-position="LD">LD</button>
          <button type="button" data-hs-position="RD">RD</button>
          <button type="button" data-hs-position="G">G</button>
          <select id="hsPositionFilter" hidden><option value=""></option><option>F</option><option>D</option><option>LW</option><option>C</option><option>RW</option><option>LD</option><option>RD</option><option>G</option></select>
        </div>

        <div class="hs-market-controls">
          <details class="hs-filter-menu">
            <summary>Filters</summary>
            <label><span>Status</span><select id="hsStatusFilter" class="hs-select"><option value="">All statuses</option><option value="unscouted">Unscouted</option><option value="scouted">Scouted</option><option value="watch">Watch</option><option value="priority">Priority</option><option value="bid_target">Bid Target</option><option value="pass">Pass</option><option value="signed">Signed</option><option value="lost">Lost</option></select></label>
          </details>
          <label class="hs-sort-label"><span>Sort</span><select id="hsSort" class="hs-select"><option value="price_high">Price: high to low</option><option value="price_low">Price: low to high</option><option value="priority">Priority</option><option value="fit">Fit</option><option value="name">Player name</option></select></label>
        </div>

        <div class="hs-market-scopes">
          <button class="active" type="button" data-hs-scope="focus">ChelScout Focus <span id="hsScopeFocus">0</span></button>
          <button type="button" data-hs-scope="experienced">Recent Experience <span id="hsScopeExperienced">0</span></button>
          <button type="button" data-hs-scope="bidable">Confirmed Bidable <span id="hsScopeBidable">0</span></button>
          <button type="button" data-hs-scope="archive">Archive <span id="hsScopeArchive">0</span></button>
          <button type="button" data-hs-scope="bargains">Bargains <span id="hsScopeBargains">0</span></button>
          <button type="button" data-hs-scope="snake">Snake list <span id="hsScopeSnake">0</span></button>
        </div>
        <div class="hs-pool-key"><b>ChelScout Focus:</b> the 519-player working Season 55 market imported from ChelScout. Historical names are preserved under <b>Archive</b> and stay out of the active scouting board unless you deliberately open them. <b>Confirmed Bidable</b> is reserved for a full live bid-board sync.</div>

        <div class="hs-market-reach"><span>REACH</span><b>Could still be here</b><small>Price, role and Calgary fit are blended from your saved team plan plus imported scouting intelligence.</small></div>

        <div id="hsPoolBody" class="hs-player-market"></div>
        <div id="hsPoolEmpty" class="hs-empty" hidden>No players match these filters.</div>
        <div class="hs-market-paging"><span id="hsPoolMeta" class="hs-msg"></span><div><button id="hsPrevPage" class="hs-btn" type="button">Previous</button><button id="hsNextPage" class="hs-btn" type="button">Next</button></div></div>
      </section>

      <details class="hs-card hs-advanced-editor">
        <summary>Manual player plan + imports</summary>
        <div class="hs-advanced-inner">
          <div class="hs-card-head"><h3>Add Scouted Player</h3><span id="hsAddMsg" class="hs-msg"></span></div>
          <form id="hsAddForm">
            <div class="hs-form">
              <label><span class="hs-label">Gamertag</span><input id="hsNewGamertag" class="hs-input" required></label>
              <label><span class="hs-label">Primary Position</span><select id="hsNewPosition" class="hs-select"><option value="">Unknown</option><option>LW</option><option>C</option><option>RW</option><option>LD</option><option>RD</option><option>G</option></select></label>
              <label><span class="hs-label">Platform</span><select id="hsNewPlatform" class="hs-select"><option value="">Unknown</option><option>Xbox</option><option>PlayStation</option><option>Crossplay</option></select></label>
              <label><span class="hs-label">Initial Status</span><select id="hsNewStatus" class="hs-select"><option value="scouted">Scouted</option><option value="watch">Watch</option><option value="priority">Priority</option><option value="bid_target">Bid Target</option></select></label>
            </div>
            <div class="hs-actions"><button class="hs-btn primary" type="submit">Add to Calgary Pool</button></div>
          </form>

          <div id="hsEditor" style="margin-top:20px" hidden>
            <div class="hs-player-head"><div><small>SELECTED PLAYER</small><h3 id="hsSelectedName">Player</h3><small id="hsSelectedMeta"></small></div><button id="hsRemove" class="hs-btn" type="button">Remove</button></div>
            <div class="hs-actions hs-target-actions"><button class="hs-btn" type="button" data-hs-quick="watch">☆ Watch</button><button class="hs-btn" type="button" data-hs-quick="priority">★ Priority</button><button class="hs-btn primary" type="button" data-hs-quick="bid_target">Bid Target</button><button class="hs-btn" type="button" data-hs-quick="pass">Pass</button></div>
            <form id="hsEditForm">
              <div class="hs-form">
                <label><span class="hs-label">Status</span><select id="hsStatusEdit" class="hs-select"><option value="unscouted">Unscouted</option><option value="scouted">Scouted</option><option value="watch">Watch</option><option value="priority">Priority</option><option value="bid_target">Bid Target</option><option value="pass">Pass</option><option value="signed">Signed</option><option value="lost">Lost</option></select></label>
                <label><span class="hs-label">Priority 1-5</span><input id="hsPriorityEdit" class="hs-input" type="number" min="1" max="5"></label>
                <label><span class="hs-label">Fit Grade 1-10</span><input id="hsFitEdit" class="hs-input" type="number" min="1" max="10"></label>
                <label><span class="hs-label">Projected Role</span><input id="hsRoleEdit" class="hs-input" placeholder="Top line C, RD, depth G…"></label>
                <label><span class="hs-label">Target Bid</span><input id="hsTargetBid" class="hs-input" type="number" min="0" step="250000"></label>
                <label><span class="hs-label">Max Bid</span><input id="hsMaxBid" class="hs-input" type="number" min="0" step="250000"></label>
                <label class="wide"><span class="hs-label">Management Note</span><textarea id="hsMgmtNote" class="hs-textarea" placeholder="Fit, availability, chemistry, bidding plan, concerns…"></textarea></label>
              </div>
              <div class="hs-actions"><button class="hs-btn primary" type="submit">Save Player Plan</button><span id="hsEditMsg" class="hs-msg"></span></div>
            </form>
            <div style="margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.1)">
              <div class="hs-card-head"><h3>ChelScout Intelligence</h3><span id="hsIntelMeta" class="hs-msg"></span></div>
              <div id="hsIntelView" class="hs-empty" style="text-align:left">No ChelScout intelligence imported for this player yet.</div>
              <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">Import ChelScout GM Hub JSON</summary><p class="hs-msg">Paste the JSON response from your authorized ChelScout GM Hub scout request. It stays private to Calgary management.</p><textarea id="hsChelScoutJson" class="hs-textarea" style="min-height:150px" placeholder='{"availability":...,"career":[...],"dna":...}'></textarea><div class="hs-actions"><button id="hsChelScoutImport" class="hs-btn primary" type="button">Import ChelScout Intel</button><span id="hsChelScoutMsg" class="hs-msg"></span></div></details>
              <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)">
                <div class="hs-card-head"><h3>ChelScout Reports</h3><span id="hsExternalReportMeta" class="hs-msg"></span></div><div id="hsExternalReports" class="hs-reports"></div><div id="hsExternalReportEmpty" class="hs-empty">No ChelScout reports imported for this player yet.</div>
                <details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">Import ChelScout reports JSON</summary><p class="hs-msg">Paste the report response from your authorized ChelScout session. Arrays, reports, or data payloads are accepted. Your ChelScout login cookie is never stored.</p><textarea id="hsChelScoutReportsJson" class="hs-textarea" style="min-height:150px" placeholder='{"reports":[...]}'></textarea><div class="hs-actions"><button id="hsChelScoutReportsImport" class="hs-btn primary" type="button">Import Reports</button><span id="hsChelScoutReportsMsg" class="hs-msg"></span></div></details>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>

    <div class="hs-pane" data-hs-pane="reports">
      <div class="hs-grid">
        <section class="hs-card">
          <div class="hs-card-head"><h3>Write Scouting Report</h3><span id="hsReportMsg" class="hs-msg"></span></div>
          <form id="hsReportForm">
            <div class="hs-form">
              <label class="wide"><span class="hs-label">Player</span><select id="hsReportPlayer" class="hs-select" required></select></label>
              <label><span class="hs-label">Overall</span><input id="hsGradeOverall" class="hs-input" type="number" min="1" max="10"></label>
              <label><span class="hs-label">Offense</span><input id="hsGradeOffense" class="hs-input" type="number" min="1" max="10"></label>
              <label><span class="hs-label">Defense</span><input id="hsGradeDefense" class="hs-input" type="number" min="1" max="10"></label>
              <label><span class="hs-label">Hockey IQ</span><input id="hsGradeIQ" class="hs-input" type="number" min="1" max="10"></label>
              <label><span class="hs-label">Puck Movement</span><input id="hsGradePuck" class="hs-input" type="number" min="1" max="10"></label>
              <label><span class="hs-label">Positioning</span><input id="hsGradePositioning" class="hs-input" type="number" min="1" max="10"></label>
              <label><span class="hs-label">Communication</span><input id="hsGradeComms" class="hs-input" type="number" min="1" max="10"></label>
              <label><span class="hs-label">Consistency</span><input id="hsGradeConsistency" class="hs-input" type="number" min="1" max="10"></label>
              <label class="wide"><span class="hs-label">Recommendation</span><select id="hsRecommendation" class="hs-select"><option value="target">Target</option><option value="must_bid">Must Bid</option><option value="watch">Watch</option><option value="depth">Depth</option><option value="pass">Pass</option></select></label>
              <label class="wide"><span class="hs-label">Strengths</span><textarea id="hsStrengths" class="hs-textarea"></textarea></label>
              <label class="wide"><span class="hs-label">Concerns</span><textarea id="hsConcerns" class="hs-textarea"></textarea></label>
              <label class="wide"><span class="hs-label">Projected Role</span><input id="hsReportRole" class="hs-input"></label>
              <label class="wide"><span class="hs-label">Full Notes</span><textarea id="hsReportNotes" class="hs-textarea"></textarea></label>
            </div>
            <div class="hs-actions"><button class="hs-btn primary" type="submit">Save Scouting Report</button></div>
          </form>
        </section>
        <section class="hs-card"><div class="hs-card-head"><h3>Management Reports</h3></div><div id="hsReportList" class="hs-reports"></div><div id="hsReportEmpty" class="hs-empty" hidden>No scouting reports logged yet.</div></section>
      </div>
    </div>

    <div class="hs-pane" data-hs-pane="bids">
      <section class="hs-card">
        <div class="hs-card-head"><h3>Calgary Bidding Board</h3><span class="hs-msg">Shared target and ceiling plan</span></div>
        <div class="hs-table-wrap"><table class="hs-table"><thead><tr><th>Player</th><th>Pos</th><th>Priority</th><th>Status</th><th>Target Price</th><th>Max Price</th><th>Role / Plan</th><th>Remove</th></tr></thead><tbody id="hsBidBody"></tbody></table></div>
        <div id="hsBidEmpty" class="hs-empty" hidden>No bid targets yet. Add bid numbers to a player in the Scouting Pool.</div>
      </section>
    </div>

    <section id="hsAdminAccess" class="hs-card hs-access hs-admin-only" hidden>
      <div class="hs-card-head"><div><div class="eyebrow">WILDMAN ADMIN ONLY</div><h3>Hitmen Access Invites</h3></div><span id="hsInviteMsg" class="hs-msg"></span></div>
      <form id="hsInviteForm">
        <div class="hs-form">
          <label><span class="hs-label">Login Email</span><input id="hsInviteEmail" class="hs-input" type="email" required></label>
          <label><span class="hs-label">Display Name / Gamertag</span><input id="hsInviteName" class="hs-input" placeholder="imonaplaine / ctbli"></label>
          <label><span class="hs-label">Calgary Role</span><select id="hsInviteRole" class="hs-select"><option value="owner">Owner</option><option value="gm">GM</option><option value="agm">AGM</option><option value="scout">Scout</option></select></label>
        </div>
        <div class="hs-actions"><button class="hs-btn primary" type="submit">Save Calgary Access</button></div>
      </form>
      <div id="hsInviteList" style="margin-top:12px"></div>
    </section>
  </section>`;

  const inject = () => {
    addStyles();
    if (document.querySelector('[data-hitmen-scouting]')) return;
    const live = document.getElementById('hitmen-live-session');
    const shell = document.querySelector('.hitmen-shell');
    if (!shell) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = markup.trim();
    const node = wrap.firstElementChild;
    if (live) shell.insertBefore(node, live); else shell.appendChild(node);
    const s = document.createElement('script');
    s.src = 'hitmen-scouting.js';
    s.dataset.hitmenScoutingJs = '1';
    document.body.appendChild(s);
    const sync = document.createElement('script');
    sync.src = 'hitmen-chelscout-sync.js';
    sync.dataset.hitmenChelScoutSync = '1';
    document.body.appendChild(sync);
    const dossier = document.createElement('script');
    dossier.src = 'hitmen-player-dossier.js';
    dossier.dataset.hitmenPlayerDossier = '1';
    document.body.appendChild(dossier);
    const market = document.createElement('script');
    market.src = 'hitmen-market-import.js';
    market.dataset.hitmenMarketImport = '1';
    document.body.appendChild(market);
  };

  let claimBusy = false;
  const claimAccess = async (state) => {
    if (claimBusy || !state?.user || !window.VVHLBackend?.db) return;
    const key = `hitmen-claim-${state.user.id}`;
    if (sessionStorage.getItem(key)) return;
    claimBusy = true;
    try {
      const { data } = await window.VVHLBackend.db.rpc('claim_my_team_invite');
      sessionStorage.setItem(key, '1');
      if (data === true) setTimeout(() => window.VVHLBackend.refresh(), 50);
    } catch (e) { console.warn('Hitmen access claim', e); }
    finally { claimBusy = false; }
  };

  window.addEventListener('vvhl-auth-change', e => claimAccess(e.detail));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject); else inject();
})();