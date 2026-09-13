const TEAM_CAP = 30;
const ROSTER_KEY = "vvhl-team-rosters-v1";
const SELECTED_TEAM_KEY = "vvhl-selected-roster-team";
const playerData = Array.isArray(window.VVHL_PLAYERS) ? window.VVHL_PLAYERS : [];

const canonicalTeams = [
  "Angry Byrds","Barn Cats","Big Dawgs","Cherry Cartel","Coffin Floppers","Dover Demons","Evil Leprechauns","Grid Light Cycles","Hydra","Knights","Pine Rangers","Raptors","Royal Ghosts","Sicilian Dragons","Silver Foxes","Soul Reapers","Southbeach Snipers"
];

const getPlayerTeam = (row) => row[1] === "S" ? (row[11] || "") : (row[8] || "");
const money = (value) => `$${Number(value || 0).toFixed(1)}M`;
const salaryForRound = (round) => {
  const r = Number(round || 0);
  return r >= 1 && r <= 7 ? 8 - r : 0;
};
const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const players = [...new Map(playerData.map((row) => [row[0].trim().toLowerCase(), row])).values()]
  .sort((a,b) => a[0].localeCompare(b[0]));

const teams = [...new Set([...canonicalTeams, ...playerData.map(getPlayerTeam).filter(Boolean)])]
  .sort((a,b) => a.localeCompare(b));

function baseRosters() {
  return Object.fromEntries(teams.map((team) => [team, []]));
}

function loadRosters() {
  try {
    const saved = JSON.parse(localStorage.getItem(ROSTER_KEY) || "null");
    if (saved && typeof saved === "object") {
      teams.forEach((team) => { if (!Array.isArray(saved[team])) saved[team] = []; });
      return saved;
    }
  } catch {}
  const fresh = baseRosters();
  playerData.forEach((row) => {
    const team = getPlayerTeam(row);
    if (!team) return;
    const key = row[0].trim().toLowerCase();
    if (!fresh[team]) fresh[team] = [];
    if (!fresh[team].some((p) => p.key === key)) {
      fresh[team].push({ key, name: row[0], type: row[1], position: row[2], draftRound: 0 });
    }
  });
  saveRosters(fresh);
  return fresh;
}

function saveRosters(rosters) {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(rosters));
}

let rosters = loadRosters();
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

function teamOptions(selected) {
  return teams.map((team) => `<option value="${esc(team)}" ${team === selected ? "selected" : ""}>${esc(team)}</option>`).join("");
}

function roundOptions(selected) {
  const current = Number(selected || 0);
  return [
    `<option value="0" ${current === 0 ? "selected" : ""}>Set round…</option>`,
    ...Array.from({length:7}, (_, i) => {
      const r = i + 1;
      return `<option value="${r}" ${current === r ? "selected" : ""}>Round ${r} · ${money(salaryForRound(r))}</option>`;
    }),
    `<option value="8" ${current >= 8 ? "selected" : ""}>Round 8+ / Undrafted · $0.0M</option>`
  ].join("");
}

function rosterSpend(team) {
  return (rosters[team] || []).reduce((sum, player) => sum + salaryForRound(player.draftRound), 0);
}

function rosterByTeam(team) {
  return (rosters[team] || []).slice().sort((a,b) => {
    const ra = Number(a.draftRound || 99), rb = Number(b.draftRound || 99);
    return ra - rb || a.name.localeCompare(b.name);
  });
}

function populateStaticControls() {
  teamSelect.innerHTML = teamOptions(selectedTeam);
  tradeTeamA.innerHTML = teamOptions(selectedTeam);
  tradeTeamB.innerHTML = teamOptions(teams.find((team) => team !== selectedTeam) || selectedTeam);
  playerNames.innerHTML = players.map((row) => `<option value="${esc(row[0])}">${esc(row[2] || (row[1] === "G" ? "Goalie" : "Skater"))}</option>`).join("");
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
    status.textContent = "CAP OK";
    status.classList.add("cap-ok");
  }
  rosterList.innerHTML = roster.map((player) => {
    const salary = salaryForRound(player.draftRound);
    return `<div class="roster-row" data-key="${esc(player.key)}">
      <div class="roster-player"><b>${esc(player.name)}</b><small>${esc(player.position || (player.type === "G" ? "Goalie" : "Skater"))}</small></div>
      <select class="select-field round-select" data-round="${esc(player.key)}" aria-label="Draft round for ${esc(player.name)}">${roundOptions(player.draftRound)}</select>
      <span class="salary-pill">${Number(player.draftRound) ? money(salary) : "Unset"}</span>
      <button class="remove-roster" data-remove-roster="${esc(player.key)}" type="button" aria-label="Remove ${esc(player.name)}">✕</button>
    </div>`;
  }).join("");
  rosterEmpty.hidden = roster.length > 0;

  rosterList.querySelectorAll("[data-round]").forEach((select) => {
    select.addEventListener("change", () => {
      const player = rosters[selectedTeam].find((p) => p.key === select.dataset.round);
      if (player) player.draftRound = Number(select.value);
      saveRosters(rosters);
      renderRoster();
      renderTradePlayers();
    });
  });
  rosterList.querySelectorAll("[data-remove-roster]").forEach((button) => {
    button.addEventListener("click", () => {
      rosters[selectedTeam] = rosters[selectedTeam].filter((p) => p.key !== button.dataset.removeRoster);
      saveRosters(rosters);
      renderRoster();
      renderTradePlayers();
    });
  });
}

function addPlayerToSelectedTeam() {
  const name = playerInput.value.trim();
  const row = playerData.find((item) => item[0].trim().toLowerCase() === name.toLowerCase());
  if (!row) {
    alert("Choose a player from the scouting database.");
    return;
  }
  const key = row[0].trim().toLowerCase();
  const existingTeam = teams.find((team) => (rosters[team] || []).some((p) => p.key === key));
  if (existingTeam && existingTeam !== selectedTeam) {
    const move = confirm(`${row[0]} is already on ${existingTeam}. Move them to ${selectedTeam}? Their draft value will stay attached.`);
    if (!move) return;
    rosters[existingTeam] = rosters[existingTeam].filter((p) => p.key !== key);
  }
  const existing = (rosters[selectedTeam] || []).find((p) => p.key === key);
  if (existing) {
    existing.draftRound = Number(draftRound.value);
  } else {
    rosters[selectedTeam].push({ key, name: row[0], type: row[1], position: row[2], draftRound: Number(draftRound.value) });
  }
  saveRosters(rosters);
  playerInput.value = "";
  renderRoster();
  renderTradePlayers();
}

function importCurrentTeamPlayers() {
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
      rosters[selectedTeam].push({ key, name: row[0], type: row[1], position: row[2], draftRound: 0 });
      added++;
    }
  });
  saveRosters(rosters);
  renderRoster();
  renderTradePlayers();
  document.getElementById("importTeam").textContent = added ? `Imported ${added} ✓` : "Already Imported ✓";
  setTimeout(() => document.getElementById("importTeam").textContent = "Import Current Team Players", 1600);
}

function playerTradeOptions(team, selectedKey) {
  const roster = rosterByTeam(team);
  return [`<option value="">Select player…</option>`, ...roster.map((player) => {
    const salary = salaryForRound(player.draftRound);
    const label = Number(player.draftRound) ? `${player.name} · R${player.draftRound} · ${money(salary)}` : `${player.name} · value unset`;
    return `<option value="${esc(player.key)}" ${player.key === selectedKey ? "selected" : ""}>${esc(label)}</option>`;
  })].join("");
}

function findRosterPlayer(team, key) {
  return (rosters[team] || []).find((player) => player.key === key);
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
  const apply = document.getElementById("applyTrade");

  if (!playerA || !playerB || teamA === teamB) {
    impactA.className = "trade-impact neutral";
    impactB.className = "trade-impact neutral";
    impactA.textContent = teamA === teamB ? "Choose two different teams" : "Select a player";
    impactB.textContent = teamA === teamB ? "Choose two different teams" : "Select a player";
    summary.textContent = "Choose two rostered players to see the cap effect.";
    apply.disabled = true;
    return;
  }

  const valueA = salaryForRound(playerA.draftRound);
  const valueB = salaryForRound(playerB.draftRound);
  const deltaA = valueB - valueA;
  const deltaB = valueA - valueB;
  const newSpendA = rosterSpend(teamA) + deltaA;
  const newSpendB = rosterSpend(teamB) + deltaB;
  const overCap = newSpendA > TEAM_CAP || newSpendB > TEAM_CAP;

  impactA.className = `trade-impact ${deltaA < 0 ? "good" : deltaA > 0 ? "bad" : "neutral"}`;
  impactB.className = `trade-impact ${deltaB < 0 ? "good" : deltaB > 0 ? "bad" : "neutral"}`;
  impactA.textContent = `${teamA}: ${impactText(deltaA)} · New used ${money(newSpendA)}`;
  impactB.textContent = `${teamB}: ${impactText(deltaB)} · New used ${money(newSpendB)}`;
  summary.innerHTML = `<strong>${esc(playerA.name)} (${money(valueA)})</strong> for <strong>${esc(playerB.name)} (${money(valueB)})</strong>. ${overCap ? "This trade would put a team over the $30M cap." : "Both teams remain within the $30M cap."}`;
  apply.disabled = overCap;
}

function applyTrade() {
  const teamA = tradeTeamA.value, teamB = tradeTeamB.value;
  const keyA = tradePlayerA.value, keyB = tradePlayerB.value;
  const playerA = findRosterPlayer(teamA, keyA);
  const playerB = findRosterPlayer(teamB, keyB);
  if (!playerA || !playerB || teamA === teamB) return;

  rosters[teamA] = rosters[teamA].filter((player) => player.key !== keyA && player.key !== keyB);
  rosters[teamB] = rosters[teamB].filter((player) => player.key !== keyA && player.key !== keyB);
  rosters[teamA].push(playerB);
  rosters[teamB].push(playerA);
  saveRosters(rosters);
  tradePlayerA.value = "";
  tradePlayerB.value = "";
  renderRoster();
  renderTradePlayers();
  document.getElementById("applyTrade").textContent = "Trade Applied ✓";
  setTimeout(() => document.getElementById("applyTrade").textContent = "Apply Trade", 1600);
}

async function copyRoster() {
  const roster = rosterByTeam(selectedTeam);
  const spend = rosterSpend(selectedTeam);
  const lines = [
    `${selectedTeam.toUpperCase()} · VVHL CAP SHEET`,
    `Cap used: ${money(spend)} / $30.0M`,
    `Cap space: ${money(TEAM_CAP - spend)}`,
    "",
    ...roster.map((player, index) => `${index + 1}. ${player.name} · ${player.position || player.type} · ${Number(player.draftRound) ? `Round ${player.draftRound} · ${money(salaryForRound(player.draftRound))}` : "Draft value unset"}`)
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    document.getElementById("copyRoster").textContent = "Copied ✓";
    setTimeout(() => document.getElementById("copyRoster").textContent = "Copy Cap Sheet", 1600);
  } catch {
    alert(lines.join("\n"));
  }
}

populateStaticControls();
renderRoster();
renderTradePlayers();

teamSelect.addEventListener("change", () => { selectedTeam = teamSelect.value; renderRoster(); });
document.getElementById("addRosterPlayer").addEventListener("click", addPlayerToSelectedTeam);
playerInput.addEventListener("keydown", (event) => { if (event.key === "Enter") addPlayerToSelectedTeam(); });
document.getElementById("importTeam").addEventListener("click", importCurrentTeamPlayers);
document.getElementById("copyRoster").addEventListener("click", copyRoster);
tradeTeamA.addEventListener("change", renderTradePlayers);
tradeTeamB.addEventListener("change", renderTradePlayers);
tradePlayerA.addEventListener("change", calculateTrade);
tradePlayerB.addEventListener("change", calculateTrade);
document.getElementById("applyTrade").addEventListener("click", applyTrade);
