const TEAM_CAP = 30;
const ROSTER_KEY = "vvhl-team-rosters-v2";
const SELECTED_TEAM_KEY = "vvhl-selected-roster-team";
const playerData = Array.isArray(window.VVHL_PLAYERS) ? window.VVHL_PLAYERS : [];

const canonicalTeams = [
  "Angry Byrds", "Barn Cats", "Big Dawgs", "Cherry Cartel", "Coffin Floppers",
  "Dover Demons", "Evil Leprechauns", "Grid Light Cycles", "Hydra", "Knights",
  "Pine Rangers", "Raptors", "Royal Ghosts", "Sicilian Dragons", "Silver Foxes",
  "Soul Reapers", "Southbeach Snipers"
];

const getPlayerTeam = (row) => row[1] === "S" ? (row[11] || "") : (row[8] || "");
const money = (value) => `$${Number(value || 0).toFixed(1)}M`;
const salaryForRound = (round) => {
  const r = Number(round || 0);
  return r >= 1 ? Math.max(1, 8 - r) : 0;
};
const normalizeRound = (round) => {
  const r = Number(round || 0);
  return r >= 7 ? 7 : Math.max(0, r);
};
const roundLabel = (round) => {
  const r = normalizeRound(round);
  if (!r) return "Draft value unset";
  return r >= 7 ? "Round 7+" : `Round ${r}`;
};
const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const players = [...new Map(playerData.map((row) => [row[0].trim().toLowerCase(), row])).values()]
  .sort((a, b) => a[0].localeCompare(b[0]));

let teams = [...new Set([...canonicalTeams, ...playerData.map(getPlayerTeam).filter(Boolean)])]
  .sort((a, b) => a.localeCompare(b));

const baseRosters = () => Object.fromEntries(teams.map((team) => [team, []]));

function loadLocalRosters() {
  try {
    const saved = JSON.parse(localStorage.getItem(ROSTER_KEY) || "null");
    if (saved && typeof saved === "object") {
      teams.forEach((team) => { if (!Array.isArray(saved[team])) saved[team] = []; });
      Object.values(saved).flat().forEach((player) => {
        player.draftRound = normalizeRound(player.draftRound);
      });
      return saved;
    }
  } catch {}
  return baseRosters();
}

function saveLocalRosters() {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(rosters));
}

let rosters = loadLocalRosters();
let officialMode = false;
let editableTeams = new Set();
let selectedTeam = localStorage.getItem(SELECTED_TEAM_KEY) || teams[0];
const queryTeam = new URLSearchParams(location.search).get("team");
if (queryTeam && teams.includes(queryTeam)) selectedTeam = queryTeam;
if (!teams.includes(selectedTeam)) selectedTeam = teams[0];

const teamSelect = document.getElementById("teamSelect");
const rosterList = document.getElementById("rosterList");
const rosterEmpty = document.getElementById("rosterEmpty");
const playerInput = document.getElementById("rosterPlayer");
const playerNames = document.getElementById("rosterPlayerNames");
const draftRound = document.getElementById("draftRound");
const tradeTeamA = document.getElementById("tradeTeamA");
const tradeTeamB = document.getElementById("tradeTeamB");
const tradePlayerA = document.getElementById("tradePlayerA");
const tradePlayerB = document.getElementById("tradePlayerB");
const applyTradeButton = document.getElementById("applyTrade");

function teamOptions(selected) {
  return teams.map((team) => `<option value="${esc(team)}" ${team === selected ? "selected" : ""}>${esc(team)}</option>`).join("");
}

function roundOptions(selected) {
  const current = normalizeRound(selected);
  return [
    `<option value="0" ${current === 0 ? "selected" : ""}>Set round…</option>`,
    ...Array.from({ length: 6 }, (_, i) => {
      const r = i + 1;
      return `<option value="${r}" ${current === r ? "selected" : ""}>Round ${r} · ${money(salaryForRound(r))}</option>`;
    }),
    `<option value="7" ${current === 7 ? "selected" : ""}>Round 7+ · $1.0M</option>`
  ].join("");
}

function rosterByTeam(team) {
  return (rosters[team] || []).slice().sort((a, b) => {
    const ra = Number(a.draftRound || 99), rb = Number(b.draftRound || 99);
    return ra - rb || a.name.localeCompare(b.name);
  });
}

function rosterSpend(team) {
  return (rosters[team] || []).reduce((sum, player) => sum + Number(player.capHit ?? salaryForRound(player.draftRound)), 0);
}

function findRosterPlayer(team, key) {
  return (rosters[team] || []).find((player) => player.key === key);
}

function canEditTeam(team) {
  return officialMode && editableTeams.has(team);
}

function populateStaticControls() {
  teamSelect.innerHTML = teamOptions(selectedTeam);
  tradeTeamA.innerHTML = teamOptions(selectedTeam);
  tradeTeamB.innerHTML = teamOptions(teams.find((team) => team !== selectedTeam) || selectedTeam);
  playerNames.innerHTML = players.map((row) => `<option value="${esc(row[0])}">${esc(row[2] || (row[1] === "G" ? "Goalie" : "Skater"))}</option>`).join("");
}

function renderEditState() {
  const editable = canEditTeam(selectedTeam);
  const notice = document.getElementById("rosterEditNotice");
  document.getElementById("rosterEditor")?.classList.toggle("editor-locked", !editable);
  [playerInput, draftRound, document.getElementById("addRosterPlayer")].forEach((el) => {
    if (el) el.disabled = !editable;
  });
  if (notice) {
    notice.hidden = editable;
    notice.textContent = officialMode
      ? `You can view ${selectedTeam}, but only assigned management or league admins can edit this roster.`
      : "Sign in with a GM, AGM, owner or admin account to edit an official roster.";
  }
  const importer = document.getElementById("importTeam");
  if (importer) {
    importer.disabled = officialMode;
    importer.title = officialMode ? "Official roster entries require a confirmed draft round." : "Load tagged scouting players into the local planning view.";
  }
}

function renderRoster() {
  localStorage.setItem(SELECTED_TEAM_KEY, selectedTeam);
  teamSelect.value = selectedTeam;
  const roster = rosterByTeam(selectedTeam);
  const spend = rosterSpend(selectedTeam);
  const remaining = TEAM_CAP - spend;
  const unset = roster.filter((p) => !Number(p.draftRound)).length;
  document.getElementById("rosterTitle").textContent = selectedTeam;
  document.getElementById("teamCapUsed").textContent = money(spend);
  document.getElementById("teamCapSpace").textContent = money(remaining);
  document.getElementById("rosterCount").textContent = roster.length;
  const status = document.getElementById("capStatus");
  status.className = "status-pill";
  if (remaining < 0) {
    status.textContent = "OVER CAP";
    status.classList.add("over-cap");
  } else if (unset) {
    status.textContent = `${unset} VALUE${unset === 1 ? "" : "S"} TO SET`;
  } else {
    status.textContent = officialMode ? "OFFICIAL · CAP OK" : "CAP OK";
    status.classList.add("cap-ok");
  }

  const editable = canEditTeam(selectedTeam);
  rosterList.innerHTML = roster.map((player) => {
    const salary = Number(player.capHit ?? salaryForRound(player.draftRound));
    return `<div class="roster-row" data-key="${esc(player.key)}">
      <div class="roster-player"><b>${esc(player.name)}</b><small>${esc(player.position || (player.type === "G" ? "Goalie" : "Skater"))}${player.acquiredVia ? ` · ${esc(player.acquiredVia)}` : ""}</small></div>
      <select class="select-field round-select" data-round="${esc(player.key)}" aria-label="Draft round for ${esc(player.name)}" ${editable ? "" : "disabled"}>${roundOptions(player.draftRound)}</select>
      <span class="salary-pill">${Number(player.draftRound) ? money(salary) : "Unset"}</span>
      <button class="remove-roster" data-remove-roster="${esc(player.key)}" type="button" aria-label="Remove ${esc(player.name)}" ${editable ? "" : "disabled"}>✕</button>
    </div>`;
  }).join("");
  rosterEmpty.hidden = roster.length > 0;
  renderEditState();

  rosterList.querySelectorAll("[data-round]").forEach((select) => {
    select.addEventListener("change", async () => {
      const round = normalizeRound(select.value);
      if (window.VVHLRosterCloud?.isConnected()) {
        await window.VVHLRosterCloud.updateDraftRound(selectedTeam, select.dataset.round, round);
      } else {
        const player = findRosterPlayer(selectedTeam, select.dataset.round);
        if (player) {
          player.draftRound = round;
          player.capHit = salaryForRound(round);
          saveLocalRosters();
          renderAll();
        }
      }
    });
  });

  rosterList.querySelectorAll("[data-remove-roster]").forEach((button) => {
    button.addEventListener("click", async () => {
      const player = findRosterPlayer(selectedTeam, button.dataset.removeRoster);
      if (!player) return;
      if (!confirm(`Remove ${player.name} from ${selectedTeam}?`)) return;
      if (window.VVHLRosterCloud?.isConnected()) {
        await window.VVHLRosterCloud.removeRosterPlayer(selectedTeam, player.key);
      } else {
        rosters[selectedTeam] = rosters[selectedTeam].filter((p) => p.key !== player.key);
        saveLocalRosters();
        renderAll();
      }
    });
  });
}

async function addPlayerToSelectedTeam() {
  const name = playerInput.value.trim();
  const row = playerData.find((item) => item[0].trim().toLowerCase() === name.toLowerCase());
  if (!row) {
    alert("Choose a player from the scouting database.");
    return;
  }
  const round = normalizeRound(draftRound.value);
  if (!round) {
    alert("Choose the player's draft round first.");
    return;
  }
  if (window.VVHLRosterCloud?.isConnected()) {
    await window.VVHLRosterCloud.addRosterPlayer(selectedTeam, row[0], round);
    playerInput.value = "";
    return;
  }
  const key = row[0].trim().toLowerCase();
  const existingTeam = teams.find((team) => (rosters[team] || []).some((p) => p.key === key));
  if (existingTeam && existingTeam !== selectedTeam) {
    alert(`${row[0]} is already on ${existingTeam}. Use the official trade workflow after signing in.`);
    return;
  }
  const existing = findRosterPlayer(selectedTeam, key);
  if (existing) {
    existing.draftRound = round;
    existing.capHit = salaryForRound(round);
  } else {
    rosters[selectedTeam].push({ key, name: row[0], type: row[1], position: row[2], draftRound: round, capHit: salaryForRound(round) });
  }
  saveLocalRosters();
  playerInput.value = "";
  renderAll();
}

function importCurrentTeamPlayers() {
  if (officialMode) return;
  const rows = playerData.filter((row) => getPlayerTeam(row) === selectedTeam);
  if (!rows.length) {
    alert("No current-team tags are available for this club in the scouting data yet.");
    return;
  }
  let added = 0;
  rows.forEach((row) => {
    const key = row[0].trim().toLowerCase();
    const onAnyTeam = teams.some((team) => (rosters[team] || []).some((p) => p.key === key));
    if (!onAnyTeam) {
      rosters[selectedTeam].push({ key, name: row[0], type: row[1], position: row[2], draftRound: 0, capHit: 0 });
      added++;
    }
  });
  saveLocalRosters();
  renderAll();
  const button = document.getElementById("importTeam");
  button.textContent = added ? `Imported ${added} ✓` : "Already Imported ✓";
  setTimeout(() => button.textContent = "Import Current Team Players", 1600);
}

function playerTradeOptions(team, selectedKey) {
  const roster = rosterByTeam(team);
  return [`<option value="">Select player…</option>`, ...roster.map((player) => {
    const salary = Number(player.capHit ?? salaryForRound(player.draftRound));
    const label = Number(player.draftRound) ? `${player.name} · ${roundLabel(player.draftRound)} · ${money(salary)}` : `${player.name} · value unset`;
    return `<option value="${esc(player.key)}" ${player.key === selectedKey ? "selected" : ""}>${esc(label)}</option>`;
  })].join("");
}

function renderTradePlayers() {
  const oldA = tradePlayerA.value;
  const oldB = tradePlayerB.value;
  tradePlayerA.innerHTML = playerTradeOptions(tradeTeamA.value, oldA);
  tradePlayerB.innerHTML = playerTradeOptions(tradeTeamB.value, oldB);
  calculateTrade();
}

function impactText(delta) {
  if (delta > 0) return `Uses ${money(delta)} more cap`;
  if (delta < 0) return `Gains ${money(Math.abs(delta))} cap space`;
  return "No cap change";
}

function calculateTrade() {
  const teamA = tradeTeamA.value, teamB = tradeTeamB.value;
  const playerA = findRosterPlayer(teamA, tradePlayerA.value);
  const playerB = findRosterPlayer(teamB, tradePlayerB.value);
  const impactA = document.getElementById("tradeImpactA");
  const impactB = document.getElementById("tradeImpactB");
  const summary = document.getElementById("tradeSummary");

  if (!playerA || !playerB || teamA === teamB) {
    impactA.className = "trade-impact neutral";
    impactB.className = "trade-impact neutral";
    impactA.textContent = teamA === teamB ? "Choose two different teams" : "Select a player";
    impactB.textContent = teamA === teamB ? "Choose two different teams" : "Select a player";
    summary.textContent = "Choose two rostered players to see the cap effect.";
    applyTradeButton.disabled = true;
    return null;
  }

  const valueA = Number(playerA.capHit ?? salaryForRound(playerA.draftRound));
  const valueB = Number(playerB.capHit ?? salaryForRound(playerB.draftRound));
  const deltaA = valueB - valueA;
  const deltaB = valueA - valueB;
  const newSpendA = rosterSpend(teamA) + deltaA;
  const newSpendB = rosterSpend(teamB) + deltaB;
  const overCap = newSpendA > TEAM_CAP || newSpendB > TEAM_CAP;

  impactA.className = `trade-impact ${deltaA < 0 ? "good" : deltaA > 0 ? "bad" : "neutral"}`;
  impactB.className = `trade-impact ${deltaB < 0 ? "good" : deltaB > 0 ? "bad" : "neutral"}`;
  impactA.textContent = `${teamA}: ${impactText(deltaA)} · New used ${money(newSpendA)}`;
  impactB.textContent = `${teamB}: ${impactText(deltaB)} · New used ${money(newSpendB)}`;
  summary.innerHTML = `<strong>${esc(playerA.name)} (${money(valueA)})</strong> for <strong>${esc(playerB.name)} (${money(valueB)})</strong>. ${overCap ? "This proposal would put a team over the $30M cap." : "Both teams remain within the $30M cap."}`;
  applyTradeButton.disabled = overCap || !officialMode || !editableTeams.has(teamA);
  return { teamA, teamB, playerA, playerB, valueA, valueB, deltaA, deltaB, newSpendA, newSpendB, overCap };
}

async function proposeTrade() {
  const trade = calculateTrade();
  if (!trade || trade.overCap) return;
  if (!window.VVHLRosterCloud?.isConnected()) {
    alert("Sign in with team management access to submit an official trade proposal.");
    return;
  }
  await window.VVHLRosterCloud.proposeTrade(trade, document.getElementById("tradeMessage").value.trim());
}

async function copyRoster() {
  const roster = rosterByTeam(selectedTeam);
  const spend = rosterSpend(selectedTeam);
  const lines = [
    `${selectedTeam.toUpperCase()} · VVHL CAP SHEET`,
    `Cap used: ${money(spend)} / $30.0M`,
    `Cap space: ${money(TEAM_CAP - spend)}`,
    "",
    ...roster.map((player, index) => `${index + 1}. ${player.name} · ${player.position || player.type} · ${roundLabel(player.draftRound)} · ${money(player.capHit ?? salaryForRound(player.draftRound))}`)
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    document.getElementById("copyRoster").textContent = "Copied ✓";
    setTimeout(() => document.getElementById("copyRoster").textContent = "Copy Cap Sheet", 1600);
  } catch {
    alert(lines.join("\n"));
  }
}

function renderAll() {
  renderRoster();
  renderTradePlayers();
}

function setTeams(nextTeams) {
  const clean = [...new Set(nextTeams.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!clean.length) return;
  teams = clean;
  teams.forEach((team) => { if (!Array.isArray(rosters[team])) rosters[team] = []; });
  if (!teams.includes(selectedTeam)) selectedTeam = teams[0];
  populateStaticControls();
  renderAll();
}

function setOfficialRosters(nextRosters, nextEditableTeams = []) {
  const clean = Object.fromEntries(teams.map((team) => [team, []]));
  Object.entries(nextRosters || {}).forEach(([team, list]) => {
    if (!clean[team]) clean[team] = [];
    clean[team] = Array.isArray(list) ? list : [];
  });
  rosters = clean;
  officialMode = true;
  editableTeams = new Set(nextEditableTeams);
  renderAll();
}

function setOfflineMode() {
  officialMode = false;
  editableTeams = new Set();
  rosters = loadLocalRosters();
  renderAll();
}

function selectTeam(team) {
  if (!teams.includes(team)) return;
  selectedTeam = team;
  teamSelect.value = team;
  renderAll();
}

function setTradeProposerTeam(team, lock = false) {
  if (teams.includes(team)) tradeTeamA.value = team;
  tradeTeamA.disabled = lock;
  if (tradeTeamB.value === tradeTeamA.value) tradeTeamB.value = teams.find((name) => name !== team) || team;
  renderTradePlayers();
}

window.VVHLRosterUI = {
  TEAM_CAP,
  money,
  salaryForRound,
  normalizeRound,
  roundLabel,
  esc,
  getTeams: () => teams.slice(),
  getRosters: () => rosters,
  getRoster: rosterByTeam,
  getSelectedTeam: () => selectedTeam,
  getTradeSelection: calculateTrade,
  rosterSpend,
  findRosterPlayer,
  setTeams,
  setOfficialRosters,
  setOfflineMode,
  selectTeam,
  setTradeProposerTeam,
  renderAll,
  canEditTeam
};

populateStaticControls();
renderAll();

teamSelect.addEventListener("change", () => {
  selectedTeam = teamSelect.value;
  renderRoster();
  if (officialMode && editableTeams.has(selectedTeam)) setTradeProposerTeam(selectedTeam, editableTeams.size === 1);
});
document.getElementById("addRosterPlayer").addEventListener("click", addPlayerToSelectedTeam);
playerInput.addEventListener("keydown", (event) => { if (event.key === "Enter") addPlayerToSelectedTeam(); });
document.getElementById("importTeam").addEventListener("click", importCurrentTeamPlayers);
document.getElementById("copyRoster").addEventListener("click", copyRoster);
tradeTeamA.addEventListener("change", renderTradePlayers);
tradeTeamB.addEventListener("change", renderTradePlayers);
tradePlayerA.addEventListener("change", calculateTrade);
tradePlayerB.addEventListener("change", calculateTrade);
applyTradeButton.addEventListener("click", proposeTrade);
