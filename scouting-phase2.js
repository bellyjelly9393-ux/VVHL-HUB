(() => {
  const SEASON = "Season 11";
  const ICE_ZONES = {
    left_point: "Left Point", high_slot: "High Slot", right_point: "Right Point",
    left_circle: "Left Circle", mid_slot: "Mid Slot", right_circle: "Right Circle",
    left_low: "Left Low", low_slot: "Low Slot", right_low: "Right Low",
    left_corner: "Left Corner", behind_net: "Behind Net", right_corner: "Right Corner",
  };
  const NET_ZONES = {
    top_left: "Top Left", top_right: "Top Right", bottom_left: "Bottom Left",
    bottom_right: "Bottom Right", five_hole: "Five Hole", unknown: "Unknown",
  };
  const state = {
    initialized: false,
    loading: false,
    players: [],
    stats: [],
    events: [],
    teams: [],
    playerId: "all",
    teamId: "all",
    phase: "regular",
    metric: "shots",
  };

  const $ = (id) => document.getElementById(id);
  const db = () => window.VVHLBackend?.db;
  const authState = () => window.VVHLBackend?.state || {};
  const num = (v) => Number(v || 0);
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const hasAccess = () => Boolean(window.VVHLManagementGuard?.hasAccess?.(authState()));
  const playerName = (id) => state.players.find((p) => p.id === id)?.gamertag || "Unknown player";
  const teamName = (id) => state.teams.find((t) => t.id === id)?.name || "Unassigned team";

  function setStatus(message, tone = "") {
    const el = $("shotPhaseStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `shot-status ${tone}`.trim();
  }

  function optionList(rows, valueKey, labelKey, firstLabel) {
    return `<option value="">${esc(firstLabel)}</option>` + rows.map((row) => `<option value="${esc(row[valueKey])}">${esc(row[labelKey])}</option>`).join("");
  }

  function populateControls() {
    const players = [...state.players].sort((a,b) => String(a.gamertag).localeCompare(String(b.gamertag)));
    const teams = [...state.teams].sort((a,b) => String(a.name).localeCompare(String(b.name)));

    const playerFilter = $("shotPlayerFilter");
    const capturePlayer = $("shotCapturePlayer");
    const teamFilter = $("shotTeamFilter");
    const captureTeam = $("shotCaptureTeam");

    if (playerFilter) {
      playerFilter.innerHTML = `<option value="all">All players</option>` + players.map((p) => `<option value="${esc(p.id)}">${esc(p.gamertag)}</option>`).join("");
      playerFilter.value = state.playerId;
    }
    if (capturePlayer) {
      capturePlayer.innerHTML = optionList(players, "id", "gamertag", "Select player…");
      if (state.playerId !== "all") capturePlayer.value = state.playerId;
    }
    if (teamFilter) {
      teamFilter.innerHTML = `<option value="all">All teams</option>` + teams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
      teamFilter.value = state.teamId;
    }
    if (captureTeam) {
      captureTeam.innerHTML = optionList(teams, "id", "name", "No team assigned");
      if (state.teamId !== "all") captureTeam.value = state.teamId;
    }
  }

  function filteredEvents() {
    return state.events.filter((event) => {
      if (state.playerId !== "all" && event.scouting_player_id !== state.playerId) return false;
      if (state.teamId !== "all" && event.team_id !== state.teamId) return false;
      if (state.phase !== "all" && event.phase !== state.phase) return false;
      return true;
    });
  }

  function filteredStats() {
    return state.stats.filter((row) => {
      if (state.playerId !== "all" && row.scouting_player_id !== state.playerId) return false;
      if (state.phase !== "all" && row.phase !== state.phase) return false;
      return true;
    });
  }

  function eventCounts(rows) {
    const attempts = rows.length;
    const shots = rows.filter((row) => row.result === "goal" || row.result === "save").length;
    const goals = rows.filter((row) => row.result === "goal").length;
    return { attempts, shots, goals, efficiency: shots ? goals / shots * 100 : 0 };
  }

  function baselineTotals() {
    if (state.teamId !== "all") return null;
    const rows = filteredStats();
    const shots = rows.reduce((sum,row) => sum + num(row.shots), 0);
    const goals = rows.reduce((sum,row) => sum + num(row.goals), 0);
    const attempts = rows.reduce((sum,row) => sum + num(row.shot_attempts), 0);
    return { shots, goals, attempts, efficiency: shots ? goals / shots * 100 : 0 };
  }

  function metricValue(counts) {
    if (state.metric === "goals") return counts.goals;
    if (state.metric === "attempts") return counts.attempts;
    if (state.metric === "efficiency") return counts.efficiency;
    return counts.shots;
  }

  function metricText(counts) {
    const value = metricValue(counts);
    return state.metric === "efficiency" ? `${value.toFixed(1)}%` : String(value);
  }

  function renderKpis() {
    const events = filteredEvents();
    const tracked = eventCounts(events);
    const baseline = baselineTotals();
    const totals = baseline || tracked;
    $("shotKpiShots").textContent = totals.shots;
    $("shotKpiGoals").textContent = totals.goals;
    $("shotKpiEfficiency").textContent = `${totals.efficiency.toFixed(1)}%`;
    $("shotKpiCoverage").textContent = baseline?.shots ? `${Math.min(100, tracked.shots / baseline.shots * 100).toFixed(1)}%` : `${tracked.attempts}`;
    $("shotKpiShotsLabel").textContent = baseline ? "Season Shots" : "Tracked Shots";
    $("shotKpiGoalsLabel").textContent = baseline ? "Season Goals" : "Tracked Goals";
    $("shotKpiCoverageLabel").textContent = baseline ? "Location Coverage" : "Located Attempts";
    $("shotSourcePill").textContent = `${tracked.attempts} located events`;
  }

  function renderIceMap() {
    const rows = filteredEvents();
    const values = {};
    let max = 0;
    Object.keys(ICE_ZONES).forEach((zone) => {
      const counts = eventCounts(rows.filter((row) => row.ice_zone === zone));
      values[zone] = counts;
      max = Math.max(max, metricValue(counts));
    });
    document.querySelectorAll(".shot-zone[data-zone]").forEach((el) => {
      const zone = el.dataset.zone;
      const counts = values[zone] || eventCounts([]);
      const value = metricValue(counts);
      const ratio = max > 0 ? value / max : 0;
      el.style.setProperty("--zone-alpha", String(.07 + ratio * .58));
      const valueEl = el.querySelector("strong");
      if (valueEl) valueEl.textContent = metricText(counts);
      el.title = `${ICE_ZONES[zone]} · ${counts.shots} shots · ${counts.goals} goals · ${counts.attempts} attempts`;
    });
  }

  function renderNetMap() {
    const rows = filteredEvents().filter((row) => row.net_zone && row.net_zone !== "unknown");
    const values = {};
    let max = 0;
    Object.keys(NET_ZONES).filter((z) => z !== "unknown").forEach((zone) => {
      const counts = eventCounts(rows.filter((row) => row.net_zone === zone));
      values[zone] = counts;
      max = Math.max(max, metricValue(counts));
    });
    document.querySelectorAll(".shot-net-zone[data-net-zone]").forEach((el) => {
      const zone = el.dataset.netZone;
      const counts = values[zone] || eventCounts([]);
      const value = metricValue(counts);
      const ratio = max > 0 ? value / max : 0;
      el.style.setProperty("--zone-alpha", String(.07 + ratio * .58));
      const text = el.querySelector("span");
      if (text) text.textContent = metricText(counts);
      el.title = `${NET_ZONES[zone]} · ${counts.shots} shots · ${counts.goals} goals`;
    });
  }

  function renderEmptyState() {
    const rows = filteredEvents();
    const note = $("shotEmptyNote");
    if (!note) return;
    note.hidden = rows.length > 0;
    if (!rows.length) {
      const scope = state.playerId === "all" ? "this selection" : playerName(state.playerId);
      note.textContent = `No shot-location events are tracked for ${scope} yet. Season totals are still real; use Film Review Capture below to start building the location map.`;
    }
  }

  function renderMetricButtons() {
    document.querySelectorAll("[data-shot-metric]").forEach((button) => button.classList.toggle("active", button.dataset.shotMetric === state.metric));
    const label = $("shotMetricLabel");
    if (label) label.textContent = ({shots:"Shots on Goal",goals:"Goals",attempts:"All Attempts",efficiency:"Goal Efficiency"})[state.metric];
  }

  function canDelete(event) {
    const auth = authState();
    const role = String(auth.profile?.role || "").toLowerCase();
    return event.created_by === auth.user?.id || role === "admin" || role === "commissioner";
  }

  function renderRecent() {
    const el = $("shotRecentEvents");
    if (!el) return;
    const rows = [...filteredEvents()].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0,10);
    if (!rows.length) {
      el.innerHTML = `<div class="shot-empty-note">No captured location events in this view yet.</div>`;
      return;
    }
    el.innerHTML = rows.map((row) => `<div class="shot-event-row">
      <div><strong>${esc(playerName(row.scouting_player_id))} · ${esc(String(row.result).toUpperCase())}</strong><small>${esc(ICE_ZONES[row.ice_zone] || row.ice_zone)}${row.net_zone && row.net_zone !== "unknown" ? ` → ${esc(NET_ZONES[row.net_zone] || row.net_zone)}` : ""}${row.team_id ? ` · ${esc(teamName(row.team_id))}` : ""}</small></div>
      ${canDelete(row) ? `<button class="shot-delete" type="button" data-delete-shot="${esc(row.id)}">Delete</button>` : ""}
    </div>`).join("");
    el.querySelectorAll("[data-delete-shot]").forEach((button) => button.addEventListener("click", () => deleteShot(button.dataset.deleteShot)));
  }

  function renderAll() {
    renderKpis();
    renderMetricButtons();
    renderIceMap();
    renderNetMap();
    renderEmptyState();
    renderRecent();
  }

  function updateCaptureSelection() {
    const ice = $("shotCaptureIceZone")?.value || "";
    const net = $("shotCaptureNetZone")?.value || "";
    document.querySelectorAll(".shot-zone[data-zone]").forEach((el) => el.classList.toggle("capture-selected", Boolean(ice) && el.dataset.zone === ice));
    document.querySelectorAll(".shot-net-zone[data-net-zone]").forEach((el) => el.classList.toggle("capture-selected", Boolean(net) && el.dataset.netZone === net));
    const summary = $("shotCaptureSelection");
    if (summary) summary.textContent = `Ice: ${ICE_ZONES[ice] || "not selected"} · Net: ${NET_ZONES[net] || "not selected"}`;
  }

  async function captureShot() {
    const user = authState().user;
    const playerId = $("shotCapturePlayer").value;
    const iceZone = $("shotCaptureIceZone").value;
    if (!user || !playerId || !iceZone) return setStatus("Choose a player and an ice zone before saving.", "error");
    const result = $("shotCaptureResult").value;
    let netZone = $("shotCaptureNetZone").value || null;
    if ((result === "miss" || result === "block") && !netZone) netZone = "unknown";
    const payload = {
      scouting_player_id: playerId,
      team_id: $("shotCaptureTeam").value || null,
      season: SEASON,
      phase: $("shotCapturePhase").value,
      result,
      ice_zone: iceZone,
      net_zone: netZone,
      shot_type: $("shotCaptureType").value || null,
      source_label: $("shotCaptureSource").value.trim() || "film review",
      note: $("shotCaptureNote").value.trim() || null,
      created_by: user.id,
    };
    setStatus("Saving shot event…");
    const { error } = await db().from("scouting_shot_events").insert(payload);
    if (error) return setStatus(error.message, "error");
    $("shotCaptureNote").value = "";
    await loadEvents();
    renderAll();
    setStatus("Shot location saved. Maps updated.", "success");
  }

  async function deleteShot(id) {
    setStatus("Deleting shot event…");
    const { error } = await db().from("scouting_shot_events").delete().eq("id", id);
    if (error) return setStatus(error.message, "error");
    await loadEvents();
    renderAll();
    setStatus("Shot event deleted.", "success");
  }

  async function loadEvents() {
    const { data, error } = await db().from("scouting_shot_events")
      .select("id,scouting_player_id,scouting_match_id,team_id,source_club_id,opponent_source_club_id,season,phase,result,ice_zone,net_zone,shot_type,source_label,note,created_by,created_at")
      .eq("season", SEASON)
      .order("created_at", { ascending: false });
    if (error) throw error;
    state.events = data || [];
  }

  async function loadData() {
    if (state.loading || !db() || !hasAccess()) return;
    state.loading = true;
    setStatus("Loading Season 11 shot analysis…");
    try {
      const [playersRes, statsRes, teamsRes] = await Promise.all([
        db().from("scouting_players").select("id,gamertag,primary_position,platform").order("gamertag"),
        db().from("scouting_season_stats").select("scouting_player_id,season,phase,games_played,goals,shots,shot_attempts,shooting_pct").eq("season", SEASON),
        db().from("teams").select("id,name,active").eq("active", true).order("name"),
      ]);
      if (playersRes.error) throw playersRes.error;
      if (statsRes.error) throw statsRes.error;
      if (teamsRes.error) throw teamsRes.error;
      state.players = playersRes.data || [];
      state.stats = statsRes.data || [];
      state.teams = teamsRes.data || [];
      await loadEvents();
      populateControls();
      renderAll();
      setStatus(`Phase 2 ready · ${state.events.length} located shot events tracked.`, "success");
    } catch (error) {
      setStatus(error.message || "Unable to load shot analysis.", "error");
    } finally {
      state.loading = false;
    }
  }

  function bind() {
    $("shotPlayerFilter")?.addEventListener("change", (e) => {
      state.playerId = e.target.value;
      if (state.playerId !== "all") $("shotCapturePlayer").value = state.playerId;
      renderAll();
    });
    $("shotTeamFilter")?.addEventListener("change", (e) => {
      state.teamId = e.target.value;
      if (state.teamId !== "all") $("shotCaptureTeam").value = state.teamId;
      renderAll();
    });
    $("shotPhaseFilter")?.addEventListener("change", (e) => { state.phase = e.target.value; renderAll(); });
    $("refreshShotData")?.addEventListener("click", loadData);
    $("saveShotEvent")?.addEventListener("click", captureShot);
    $("shotCaptureIceZone")?.addEventListener("change", updateCaptureSelection);
    $("shotCaptureNetZone")?.addEventListener("change", updateCaptureSelection);
    document.querySelectorAll("[data-shot-metric]").forEach((button) => button.addEventListener("click", () => { state.metric = button.dataset.shotMetric; renderAll(); }));
    document.querySelectorAll(".shot-zone[data-zone]").forEach((button) => button.addEventListener("click", () => {
      $("shotCaptureIceZone").value = button.dataset.zone;
      updateCaptureSelection();
    }));
    document.querySelectorAll(".shot-net-zone[data-net-zone]").forEach((button) => button.addEventListener("click", () => {
      $("shotCaptureNetZone").value = button.dataset.netZone;
      updateCaptureSelection();
    }));
  }

  function maybeInit() {
    if (!$("shotAnalysis")) return;
    if (!state.initialized) {
      bind();
      state.initialized = true;
    }
    if (hasAccess()) loadData();
  }

  window.addEventListener("vvhl-auth-change", maybeInit);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", maybeInit);
  else maybeInit();
})();