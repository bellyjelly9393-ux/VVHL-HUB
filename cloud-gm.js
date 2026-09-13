const cloudStatus = document.getElementById("cloudStatus");
const nextDay = (day) => {
  const d = new Date();
  const add = (day - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
};
const gameDates = { tue: nextDay(2), wed: nextDay(3) };
let cloudPlayers = new Map(),
  cloudTimer;
const setCloud = (text, tone = "") => {
  if (cloudStatus) {
    cloudStatus.textContent = text;
    cloudStatus.dataset.tone = tone;
  }
};

async function prepareCloud() {
  const { state, db } = window.VVHLBackend;
  if (!state.user) {
    setCloud("Sign in to sync this workspace");
    return;
  }
  if (!state.teamId) {
    setCloud("Waiting for a team assignment", "warning");
    return;
  }
  const { data: players, error } = await db
    .from("players")
    .select("id,gamertag");
  if (error) {
    setCloud(error.message, "error");
    return;
  }
  cloudPlayers = new Map(
    (players || []).map((p) => [p.gamertag.trim().toLowerCase(), p.id]),
  );
  await loadCloudAvailability();
  await loadCloudLineups();
  setCloud("Shared team workspace connected", "success");
}

async function loadCloudAvailability() {
  const { state, db } = window.VVHLBackend;
  const { data } = await db
    .from("player_availability")
    .select("player_id,game_date,status")
    .eq("team_id", state.teamId)
    .in("game_date", Object.values(gameDates));
  if (!data?.length) return;
  const byId = new Map([...cloudPlayers].map(([name, id]) => [id, name])),
    saved = {};
  data.forEach((row) => {
    const name = byId.get(row.player_id);
    if (!name) return;
    saved[name] ||= {};
    saved[name][row.game_date === gameDates.tue ? "tue" : "wed"] =
      row.status[0].toUpperCase() + row.status.slice(1);
  });
  localStorage.setItem("vvhl-player-availability", JSON.stringify(saved));
  renderAvailability();
  renderLineup();
}

async function saveCloudAvailability(select) {
  const { state, db } = window.VVHLBackend;
  const playerId = cloudPlayers.get(select.dataset.availability);
  if (!state.user || !state.teamId || !playerId) return;
  setCloud("Saving availability…");
  const { error } = await db
    .from("player_availability")
    .upsert(
      {
        player_id: playerId,
        team_id: state.teamId,
        game_date: gameDates[select.dataset.day],
        status: select.value.toLowerCase(),
        updated_by: state.user.id,
      },
      { onConflict: "player_id,game_date" },
    );
  setCloud(
    error ? error.message : "Availability saved",
    error ? "error" : "success",
  );
}

async function loadCloudLineups() {
  const { state, db } = window.VVHLBackend;
  const { data } = await db
    .from("lineups")
    .select("id,league,game_label,notes,lineup_slots(slot,player_id)")
    .eq("team_id", state.teamId);
  if (!data?.length) return;
  const byId = new Map([...cloudPlayers].map(([name, id]) => [id, name])),
    saved = {};
  data.forEach((line) => {
    const format = line.league === "VV6L 6s" ? "6s" : "4s";
    saved[format] = { name: line.game_label || "", notes: line.notes || "" };
    (line.lineup_slots || []).forEach(
      (slot) => (saved[format][slot.slot] = byId.get(slot.player_id) || ""),
    );
  });
  localStorage.setItem("vvhl-lineups", JSON.stringify(saved));
  renderLineup();
}

async function saveCloudLineup() {
  const { state, db } = window.VVHLBackend;
  if (!state.user || !state.teamId) return;
  const all = JSON.parse(localStorage.getItem("vvhl-lineups") || "{}"),
    current = all[lineupFormat] || {},
    league = lineupFormat === "6s" ? "VV6L 6s" : "VVHL 4s",
    clientKey = `${state.teamId}-${lineupFormat}`;
  setCloud("Saving lineup…");
  const { data: lineup, error } = await db
    .from("lineups")
    .upsert(
      {
        team_id: state.teamId,
        league,
        game_label: current.name || null,
        notes: current.notes || null,
        client_key: clientKey,
        created_by: state.user.id,
        updated_by: state.user.id,
      },
      { onConflict: "client_key" },
    )
    .select("id")
    .single();
  if (error) {
    setCloud(error.message, "error");
    return;
  }
  const slots = lineupPositions[lineupFormat].map((slot, i) => ({
    lineup_id: lineup.id,
    slot,
    player_id: cloudPlayers.get(current[slot]) || null,
    sort_order: i,
  }));
  const result = await db
    .from("lineup_slots")
    .upsert(slots, { onConflict: "lineup_id,slot" });
  setCloud(
    result.error ? result.error.message : "Lineup saved",
    result.error ? "error" : "success",
  );
}

document.getElementById("availabilityList").addEventListener("change", (e) => {
  if (e.target.matches("[data-availability]")) saveCloudAvailability(e.target);
});
document.querySelector(".lineup-panel").addEventListener("change", () => {
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(saveCloudLineup, 500);
});
document.querySelector(".lineup-panel").addEventListener("input", () => {
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(saveCloudLineup, 800);
});
window.addEventListener("vvhl-auth-change", prepareCloud);
