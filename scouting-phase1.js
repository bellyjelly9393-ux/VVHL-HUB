(() => {
  const SEASON = "Season 11";
  const state = {
    ready: false,
    players: [],
    stats: new Map(),
    board: new Map(),
    selectedId: "",
    search: "",
    position: "all",
  };

  const $ = (id) => document.getElementById(id);
  const db = () => window.VVHLBackend?.db;
  const authState = () => window.VVHLBackend?.state || {};
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[char]);
  const n = (value) => Number(value || 0);
  const perGame = (value, games) => games ? n(value) / n(games) : 0;
  const pct = (value, digits = 1) => `${n(value).toFixed(digits)}%`;
  const posLabel = (value) => ({
    center: "Center",
    leftwing: "Left Wing",
    rightwing: "Right Wing",
    defensemen: "Defense",
    defenseman: "Defense",
    goalie: "Goalie",
  })[String(value || "").toLowerCase()] || String(value || "Unknown").replace(/([a-z])([A-Z])/g, "$1 $2");

  function hasAccess() {
    return Boolean(window.VVHLManagementGuard?.hasAccess?.(authState()));
  }

  function setStatus(message, tone = "") {
    const el = $("scoutPhaseStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `scout-phase-status ${tone}`.trim();
  }

  function statFor(id) {
    return state.stats.get(id) || null;
  }

  function metricValues(getter) {
    return state.players
      .map((player) => getter(statFor(player.id), player))
      .filter((value) => Number.isFinite(value));
  }

  function quantile(values, q) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * q;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    if (low === high) return sorted[low];
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
  }

  function thresholds() {
    return {
      gpg: quantile(metricValues((s) => s ? perGame(s.goals, s.games_played) : NaN), .75),
      apg: quantile(metricValues((s) => s ? perGame(s.assists, s.games_played) : NaN), .75),
      hitpg: quantile(metricValues((s) => s ? perGame(s.hits, s.games_played) : NaN), .75),
      takeawaypg: quantile(metricValues((s) => s ? perGame(s.takeaways, s.games_played) : NaN), .75),
      giveawaypg: quantile(metricValues((s) => s ? perGame(s.giveaways, s.games_played) : NaN), .75),
      pluspg: quantile(metricValues((s) => s ? perGame(s.plus_minus, s.games_played) : NaN), .7),
    };
  }

  function deriveInsights(player, stats) {
    if (!stats) return [{ icon: "○", tone: "neutral", title: "Needs data", text: "No Season 11 regular-season stat line is connected yet." }];
    const t = thresholds();
    const gp = n(stats.games_played);
    const gpg = perGame(stats.goals, gp);
    const apg = perGame(stats.assists, gp);
    const hitpg = perGame(stats.hits, gp);
    const takepg = perGame(stats.takeaways, gp);
    const givepg = perGame(stats.giveaways, gp);
    const pluspg = perGame(stats.plus_minus, gp);
    const passing = n(stats.passing_pct);
    const faceoff = n(stats.faceoff_pct);
    const overall = n(stats.overall_rating);
    const position = String(player.primary_position || "").toLowerCase();
    const insights = [];

    if (gpg >= t.gpg && gp >= 8) insights.push({ icon: "◎", tone: "red", title: "Elite trigger", text: `${gpg.toFixed(2)} goals per game puts this player in the upper scoring tier of the loaded pool.` });
    if ((apg >= t.apg && gp >= 8) || passing >= 76) insights.push({ icon: "↗", tone: "blue", title: "Primary distributor", text: `${apg.toFixed(2)} assists per game on ${pct(passing)} passing. Do not give clean reset lanes.` });
    if (hitpg >= t.hitpg && gp >= 8) insights.push({ icon: "◇", tone: "gold", title: "Punishes on contact", text: `${hitpg.toFixed(2)} hits per game. Expect physical pressure around entries and puck recoveries.` });
    if (takepg >= t.takeawaypg && gp >= 8) insights.push({ icon: "⊕", tone: "teal", title: "Puck hawk", text: `${takepg.toFixed(2)} takeaways per game. Loose lateral passes are a risk around this player.` });
    if ((position.includes("defense") || position.includes("defence")) && pluspg >= t.pluspg && gp >= 8) insights.push({ icon: "▣", tone: "teal", title: "Reliable back end", text: `${pluspg.toFixed(2)} plus/minus per game with a ${n(stats.plus_minus) >= 0 ? "+" : ""}${n(stats.plus_minus)} total.` });
    if (position === "center" && faceoff >= 55) insights.push({ icon: "↔", tone: "purple", title: "Faceoff specialist", text: `${pct(faceoff)} at the dot. Plan defensive-zone draws instead of conceding clean possession.` });
    if (overall >= 78) insights.push({ icon: "★", tone: "purple", title: "High overall impact", text: `${overall.toFixed(1)} overall rating across the current statistical model.` });
    if (givepg >= t.giveawaypg && gp >= 8) insights.push({ icon: "!", tone: "risk", title: "Turnover pressure point", text: `${givepg.toFixed(2)} giveaways per game. Aggressive pressure may force extra possessions.` });
    if (gp < 10) insights.push({ icon: "◌", tone: "neutral", title: "Small sample", text: `Only ${gp} games in the connected sample, so treat the projection cautiously.` });
    if (!insights.length) insights.push({ icon: "○", tone: "neutral", title: "Balanced profile", text: "No extreme statistical tendency currently clears the scouting thresholds." });
    return insights.slice(0, 7);
  }

  function filteredPlayers() {
    const query = state.search.trim().toLowerCase();
    return state.players.filter((player) => {
      const matchesQuery = !query || String(player.gamertag || "").toLowerCase().includes(query);
      const p = String(player.primary_position || "").toLowerCase();
      const matchesPosition = state.position === "all" || p === state.position || (state.position === "defensemen" && p.includes("defense"));
      return matchesQuery && matchesPosition;
    });
  }

  function renderSummary() {
    const withStats = state.players.filter((p) => statFor(p.id)).length;
    const needsReview = state.players.filter((p) => p.scouting_status === "needs_scouting").length;
    $("scoutPoolCount").textContent = state.players.length;
    $("scoutStatCount").textContent = withStats;
    $("scoutWatchCount").textContent = state.board.size;
    $("scoutReviewCount").textContent = needsReview;
  }

  function renderPlayerList() {
    const list = $("scoutPlayerList");
    const players = filteredPlayers();
    if (!players.length) {
      list.innerHTML = `<div class="scout-empty">No players match those filters.</div>`;
      return;
    }
    list.innerHTML = players.slice(0, 80).map((player) => {
      const stats = statFor(player.id);
      const active = player.id === state.selectedId ? " active" : "";
      const watched = state.board.has(player.id);
      return `<button class="scout-player-row${active}" type="button" data-player-id="${esc(player.id)}">
        <span class="scout-player-name"><strong>${esc(player.gamertag)}</strong><small>${esc(posLabel(player.primary_position))}</small></span>
        <span class="scout-mini-stat"><b>${stats ? n(stats.games_played) : "—"}</b><small>GP</small></span>
        <span class="scout-mini-stat"><b>${stats ? n(stats.points) : "—"}</b><small>PTS</small></span>
        <span class="scout-mini-stat"><b>${stats?.overall_rating != null ? n(stats.overall_rating).toFixed(1) : "—"}</b><small>OVR</small></span>
        <span class="scout-watch-dot${watched ? " watched" : ""}" title="${watched ? "On watchlist" : "Not watched"}"></span>
      </button>`;
    }).join("");
    list.querySelectorAll("[data-player-id]").forEach((button) => button.addEventListener("click", () => selectPlayer(button.dataset.playerId)));
  }

  function renderDetail() {
    const player = state.players.find((p) => p.id === state.selectedId);
    const empty = $("scoutDetailEmpty");
    const content = $("scoutDetailContent");
    if (!player) {
      empty.hidden = false;
      content.hidden = true;
      return;
    }
    empty.hidden = true;
    content.hidden = false;
    const stats = statFor(player.id);
    const watched = state.board.get(player.id);
    $("scoutPlayerTitle").textContent = player.gamertag;
    $("scoutPlayerMeta").textContent = `${posLabel(player.primary_position)} · ${player.platform || "Platform unconfirmed"} · ${SEASON}`;
    $("scoutPlayerStatus").textContent = String(player.scouting_status || "needs_scouting").replaceAll("_", " ").toUpperCase();
    $("scoutWatchButton").textContent = watched ? "Remove from Watchlist" : "Add to Watchlist";
    $("scoutWatchButton").classList.toggle("watched", Boolean(watched));

    const gp = stats ? n(stats.games_played) : 0;
    const cards = stats ? [
      ["Games", gp], ["Points", n(stats.points)], ["Goals", n(stats.goals)], ["Assists", n(stats.assists)],
      ["+/−", `${n(stats.plus_minus) >= 0 ? "+" : ""}${n(stats.plus_minus)}`], ["Passing", pct(stats.passing_pct)],
      ["Takeaways", n(stats.takeaways)], ["Hits", n(stats.hits)], ["Overall", n(stats.overall_rating).toFixed(1)],
    ] : [["Games", "—"], ["Points", "—"], ["Overall", "—"]];
    $("scoutPlayerStats").innerHTML = cards.map(([label, value]) => `<div class="scout-stat-card"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join("");

    const insights = deriveInsights(player, stats);
    $("scoutInsights").innerHTML = insights.map((insight) => `<article class="scout-insight ${esc(insight.tone)}"><span class="scout-insight-icon">${esc(insight.icon)}</span><div><strong>${esc(insight.title)}</strong><p>${esc(insight.text)}</p></div></article>`).join("");

    const boardStatus = $("scoutBoardStatus");
    boardStatus.value = watched?.status || "watching";
    boardStatus.disabled = !watched;
    $("scoutBoardNote").value = watched?.note || "";
    $("scoutBoardNote").disabled = !watched;
    $("saveBoardEntry").disabled = !watched;
  }

  function renderWatchlist() {
    const el = $("scoutWatchlist");
    const rows = [...state.board.values()].sort((a, b) => (a.board_rank || 999) - (b.board_rank || 999));
    if (!rows.length) {
      el.innerHTML = `<div class="scout-empty compact">Your watchlist is empty. Add a player from the report panel.</div>`;
      return;
    }
    el.innerHTML = rows.map((entry) => {
      const player = state.players.find((p) => p.id === entry.scouting_player_id);
      if (!player) return "";
      return `<button type="button" class="watchlist-row" data-watch-player="${esc(player.id)}"><span><strong>${esc(player.gamertag)}</strong><small>${esc(posLabel(player.primary_position))}</small></span><span class="watch-status ${esc(entry.status)}">${esc(entry.status)}</span></button>`;
    }).join("");
    el.querySelectorAll("[data-watch-player]").forEach((button) => button.addEventListener("click", () => selectPlayer(button.dataset.watchPlayer)));
  }

  async function loadBoard() {
    const user = authState().user;
    if (!user) return;
    const { data, error } = await db().from("scouting_draft_board_entries").select("id,scouting_player_id,season,board_rank,tier,status,note,created_at,updated_at").eq("author_id", user.id).eq("season", SEASON);
    if (error) throw error;
    state.board = new Map((data || []).map((row) => [row.scouting_player_id, row]));
  }

  async function toggleWatchlist() {
    const playerId = state.selectedId;
    if (!playerId) return;
    const user = authState().user;
    const existing = state.board.get(playerId);
    setStatus(existing ? "Removing from watchlist…" : "Adding to watchlist…");
    if (existing) {
      const { error } = await db().from("scouting_draft_board_entries").delete().eq("id", existing.id).eq("author_id", user.id);
      if (error) return setStatus(error.message, "error");
    } else {
      const { error } = await db().from("scouting_draft_board_entries").insert({ author_id: user.id, scouting_player_id: playerId, season: SEASON, status: "watching" });
      if (error) return setStatus(error.message, "error");
    }
    await loadBoard();
    renderSummary();
    renderPlayerList();
    renderDetail();
    renderWatchlist();
    setStatus(existing ? "Removed from watchlist." : "Added to watchlist.", "success");
  }

  async function saveBoardEntry() {
    const entry = state.board.get(state.selectedId);
    if (!entry) return;
    const status = $("scoutBoardStatus").value;
    const note = $("scoutBoardNote").value.trim();
    setStatus("Saving watchlist details…");
    const { error } = await db().from("scouting_draft_board_entries").update({ status, note: note || null, updated_at: new Date().toISOString() }).eq("id", entry.id).eq("author_id", authState().user.id);
    if (error) return setStatus(error.message, "error");
    await loadBoard();
    renderDetail();
    renderWatchlist();
    setStatus("Watchlist details saved.", "success");
  }

  async function loadPrivateNote(playerId) {
    const user = authState().user;
    const fields = ["scoutNoteSummary", "scoutNoteStrengths", "scoutNoteConcerns", "scoutNoteRole", "scoutNoteGrade"];
    fields.forEach((id) => { $(id).value = ""; });
    $("scoutNoteConfidence").value = "3";
    $("scoutNoteId").value = "";
    const { data, error } = await db().from("scouting_manual_reports")
      .select("id,summary,strengths,concerns,projected_role,draft_grade,confidence,updated_at")
      .eq("author_id", user.id).eq("scouting_player_id", playerId).eq("season", SEASON)
      .eq("report_title", "Internal scouting note").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return setStatus(error.message, "error");
    if (!data) return;
    $("scoutNoteId").value = data.id;
    $("scoutNoteSummary").value = data.summary || "";
    $("scoutNoteStrengths").value = data.strengths || "";
    $("scoutNoteConcerns").value = data.concerns || "";
    $("scoutNoteRole").value = data.projected_role || "";
    $("scoutNoteGrade").value = data.draft_grade || "";
    $("scoutNoteConfidence").value = String(data.confidence || 3);
  }

  async function savePrivateNote() {
    if (!state.selectedId) return;
    const user = authState().user;
    const payload = {
      author_id: user.id,
      scouting_player_id: state.selectedId,
      season: SEASON,
      report_title: "Internal scouting note",
      summary: $("scoutNoteSummary").value.trim() || null,
      strengths: $("scoutNoteStrengths").value.trim() || null,
      concerns: $("scoutNoteConcerns").value.trim() || null,
      projected_role: $("scoutNoteRole").value.trim() || null,
      draft_grade: $("scoutNoteGrade").value.trim() || null,
      confidence: Number($("scoutNoteConfidence").value),
      tags: [],
      visibility: "private",
      updated_at: new Date().toISOString(),
    };
    setStatus("Saving private scouting note…");
    const noteId = $("scoutNoteId").value;
    const result = noteId
      ? await db().from("scouting_manual_reports").update(payload).eq("id", noteId).eq("author_id", user.id).select("id").single()
      : await db().from("scouting_manual_reports").insert(payload).select("id").single();
    if (result.error) return setStatus(result.error.message, "error");
    $("scoutNoteId").value = result.data.id;
    setStatus("Private scouting note saved.", "success");
  }

  async function selectPlayer(id) {
    state.selectedId = id;
    renderPlayerList();
    renderDetail();
    await loadPrivateNote(id);
    document.querySelector(".scout-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadData() {
    if (!hasAccess() || !authState().user || state.ready) return;
    setStatus("Loading Season 11 scouting data…");
    const [playersResult, statsResult] = await Promise.all([
      db().from("scouting_players").select("id,gamertag,platform,primary_position,is_returning_player,scouting_status").order("gamertag"),
      db().from("scouting_season_stats").select("scouting_player_id,season,phase,games_played,record,goals,assists,points,plus_minus,hits,takeaways,giveaways,passing_pct,faceoff_pct,offense_rating,defense_rating,teamplay_rating,overall_rating").eq("season", SEASON).eq("phase", "regular"),
    ]);
    if (playersResult.error) return setStatus(playersResult.error.message, "error");
    if (statsResult.error) return setStatus(statsResult.error.message, "error");
    state.players = playersResult.data || [];
    state.stats = new Map((statsResult.data || []).map((row) => [row.scouting_player_id, row]));
    try { await loadBoard(); } catch (error) { return setStatus(error.message, "error"); }
    state.ready = true;
    renderSummary();
    renderPlayerList();
    renderWatchlist();
    renderDetail();
    setStatus(`${state.players.length} scouting profiles loaded.`, "success");
  }

  function bind() {
    $("scoutSearch")?.addEventListener("input", (event) => { state.search = event.target.value; renderPlayerList(); });
    $("scoutPositionFilter")?.addEventListener("change", (event) => { state.position = event.target.value; renderPlayerList(); });
    $("scoutWatchButton")?.addEventListener("click", toggleWatchlist);
    $("saveBoardEntry")?.addEventListener("click", saveBoardEntry);
    $("saveScoutNote")?.addEventListener("click", savePrivateNote);
    $("refreshScoutData")?.addEventListener("click", async () => { state.ready = false; await loadData(); });
  }

  window.addEventListener("vvhl-auth-change", () => { if (hasAccess()) loadData(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { bind(); setTimeout(loadData, 0); });
  else { bind(); setTimeout(loadData, 0); }
})();
