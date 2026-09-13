const CAP = 30;
const data = Array.isArray(window.VVHL_PLAYERS) ? window.VVHL_PLAYERS : [];
const targetList = document.getElementById("targetList");
const boardEmpty = document.getElementById("boardEmpty");
const datalist = document.getElementById("playerNames");
const quickPlayer = document.getElementById("quickPlayer");
const notes = document.getElementById("gmNotes");
const uniquePlayers = [
  ...new Map(data.map((r) => [r[0].trim().toLowerCase(), r])).values(),
];
const availabilityKey = "vvhl-player-availability";
const lineupKey = "vvhl-lineups";
let lineupFormat = "4s";
const availability = () => {
  try {
    return JSON.parse(localStorage.getItem(availabilityKey) || "{}");
  } catch {
    return {};
  }
};
const saveAvailability = (value) =>
  localStorage.setItem(availabilityKey, JSON.stringify(value));
const lineups = () => {
  try {
    return JSON.parse(localStorage.getItem(lineupKey) || "{}");
  } catch {
    return {};
  }
};
const saveLineups = (value) =>
  localStorage.setItem(lineupKey, JSON.stringify(value));

const getTeam = (r) => (r[1] === "S" ? r[11] || "" : r[8] || "");
const getBoard = () => {
  try {
    return JSON.parse(localStorage.getItem("vvhl-gm-board") || "[]");
  } catch {
    return [];
  }
};
const saveBoard = (b) =>
  localStorage.setItem("vvhl-gm-board", JSON.stringify(b));
const money = (n) => `$${Number(n || 0).toFixed(1)}M`;

function populateNames() {
  const names = [...new Set(data.map((r) => r[0]))].sort((a, b) =>
    a.localeCompare(b),
  );
  datalist.innerHTML = names
    .map((n) => `<option value="${n.replaceAll('"', "&quot;")}">`)
    .join("");
}

function addByName(name) {
  const r = data.find((x) => x[0].toLowerCase() === name.trim().toLowerCase());
  if (!r) return;
  const key = `${r[0]}|${r[1]}`;
  const board = getBoard();
  if (!board.some((x) => x.key === key))
    board.push({
      key,
      name: r[0],
      type: r[1],
      position: r[2],
      team: getTeam(r),
      bid: 0,
      note: "",
    });
  saveBoard(board);
  quickPlayer.value = "";
  render();
}

function updateBid(key, value) {
  const board = getBoard();
  const row = board.find((x) => x.key === key);
  if (row) row.bid = Math.max(0, Number(value) || 0);
  saveBoard(board);
  renderSummary(board);
}
function updateNote(key, value) {
  const board = getBoard();
  const row = board.find((x) => x.key === key);
  if (row) row.note = value;
  saveBoard(board);
}
function removeTarget(key) {
  saveBoard(getBoard().filter((x) => x.key !== key));
  render();
}

function rowHtml(x) {
  return `<div class="target-row"><div class="target-name"><b>${x.name}</b><small>${x.team || "VVHL"} · ${x.position || (x.type === "G" ? "Goalie" : "Skater")}</small></div><div class="target-pos"><input class="text-input" data-note="${x.key}" value="${(x.note || "").replaceAll('"', "&quot;")}" placeholder="Role"></div><div><input class="money-input" data-bid="${x.key}" type="number" min="0" max="30" step="0.1" value="${Number(x.bid || 0)}" aria-label="Max bid for ${x.name}"></div><button class="remove-btn" data-remove="${x.key}" type="button">✕</button></div>`;
}

function renderSummary(board) {
  const spend = board.reduce((s, x) => s + (Number(x.bid) || 0), 0);
  const rem = CAP - spend;
  const avg = board.length ? Math.max(0, rem) / board.length : 0;
  document.getElementById("plannedSpend").textContent = money(spend);
  document.getElementById("capRemaining").textContent = money(rem);
  document.getElementById("targetCount").textContent = board.length;
  document.getElementById("sideSpend").textContent = money(spend);
  document.getElementById("sideRemaining").textContent = money(rem);
  document.getElementById("avgRoom").textContent = money(avg);
  const pct = Math.min(100, Math.max(0, (spend / CAP) * 100));
  const fill = document.getElementById("capFill");
  fill.style.width = `${pct}%`;
  fill.classList.toggle("over", spend > CAP);
  const line = document.getElementById("remainingLine");
  line.classList.toggle("over", rem < 0);
  line.classList.toggle("remaining", rem >= 0);
}

function render() {
  const board = getBoard();
  targetList.innerHTML = board.map(rowHtml).join("");
  boardEmpty.hidden = board.length > 0;
  renderSummary(board);
  targetList
    .querySelectorAll("[data-bid]")
    .forEach((el) =>
      el.addEventListener("input", () => updateBid(el.dataset.bid, el.value)),
    );
  targetList
    .querySelectorAll("[data-note]")
    .forEach((el) =>
      el.addEventListener("input", () => updateNote(el.dataset.note, el.value)),
    );
  targetList
    .querySelectorAll("[data-remove]")
    .forEach((el) =>
      el.addEventListener("click", () => removeTarget(el.dataset.remove)),
    );
}

const statusOptions = (selected) =>
  ["Unknown", "Available", "Maybe", "Unavailable"]
    .map(
      (value) =>
        `<option ${selected === value ? "selected" : ""}>${value}</option>`,
    )
    .join("");
function renderAvailability() {
  const q = document
    .getElementById("availabilitySearch")
    .value.trim()
    .toLowerCase();
  const selectedTeam = document.getElementById("availabilityTeam").value;
  const saved = availability();
  const rows = uniquePlayers
    .filter(
      (r) =>
        (!q || r[0].toLowerCase().includes(q)) &&
        (selectedTeam === "all" || getTeam(r) === selectedTeam),
    )
    .sort((a, b) => a[0].localeCompare(b[0]));
  document.getElementById("availabilityList").innerHTML =
    rows
      .map((r) => {
        const key = r[0].trim().toLowerCase();
        const row = saved[key] || {};
        return `<div class="availability-row"><div><b>${r[0]}</b><small>${getTeam(r) || "Team unconfirmed"} · ${r[2]}</small></div><label>Tue<select data-availability="${key}" data-day="tue">${statusOptions(row.tue || "Unknown")}</select></label><label>Wed<select data-availability="${key}" data-day="wed">${statusOptions(row.wed || "Unknown")}</select></label></div>`;
      })
      .join("") ||
    '<div class="empty-state">No players match that search.</div>';
  document.querySelectorAll("[data-availability]").forEach((select) =>
    select.addEventListener("change", () => {
      const all = availability();
      all[select.dataset.availability] = {
        ...(all[select.dataset.availability] || {}),
        [select.dataset.day]: select.value,
      };
      saveAvailability(all);
      renderLineup();
    }),
  );
}

const lineupPositions = {
  "4s": ["LW", "C", "D", "G"],
  "6s": ["LW", "C", "RW", "LD", "RD", "G"],
};
function playerOptions(selected, slot) {
  const isGoalie = slot === "G";
  const saved = availability();
  return [
    '<option value="">Select player</option>',
    ...uniquePlayers
      .filter((r) =>
        isGoalie
          ? data.some(
              (x) => x[0].toLowerCase() === r[0].toLowerCase() && x[1] === "G",
            )
          : data.some(
              (x) => x[0].toLowerCase() === r[0].toLowerCase() && x[1] === "S",
            ),
      )
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map((r) => {
        const key = r[0].trim().toLowerCase();
        const a = saved[key] || {};
        const warning =
          a.tue === "Unavailable" && a.wed === "Unavailable"
            ? " · unavailable"
            : a.tue === "Available" || a.wed === "Available"
              ? " · available"
              : "";
        return `<option value="${key}" ${selected === key ? "selected" : ""}>${r[0]}${warning}</option>`;
      }),
  ].join("");
}
function renderLineup() {
  const all = lineups();
  const current = all[lineupFormat] || {};
  document.getElementById("lineupLabel").textContent =
    `${lineupFormat === "4s" ? "VVHL 4s" : "VV6L 6s"} game-night unit`;
  document.getElementById("lineupSlots").innerHTML = lineupPositions[
    lineupFormat
  ]
    .map(
      (slot) =>
        `<label class="lineup-slot"><span>${slot}</span><select class="select-field" data-lineup-slot="${slot}">${playerOptions(current[slot] || "", slot)}</select></label>`,
    )
    .join("");
  document.getElementById("lineupName").value = current.name || "";
  document.getElementById("lineupNotes").value = current.notes || "";
  document
    .querySelectorAll("[data-lineup-slot]")
    .forEach((select) =>
      select.addEventListener("change", () =>
        updateLineup(select.dataset.lineupSlot, select.value),
      ),
    );
}
function updateLineup(field, value) {
  const all = lineups();
  all[lineupFormat] = { ...(all[lineupFormat] || {}), [field]: value };
  saveLineups(all);
}

const leaderboardMetrics = {
  skaters: [
    ["points", "Points"],
    ["goals", "Goals"],
    ["assists", "Assists"],
    ["ppg", "Points / Game"],
    ["plusminus", "+ / -"],
    ["overall", "Overall"],
  ],
  goalies: [
    ["save", "Save %"],
    ["gaa", "Lowest GAA"],
    ["wins", "Wins"],
    ["shutouts", "Shutouts"],
  ],
};
function renderMetricOptions() {
  const type = document.getElementById("leaderboardType").value;
  document.getElementById("leaderboardMetric").innerHTML = leaderboardMetrics[
    type
  ]
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  renderLeaderboard();
}
function metricValue(r, metric) {
  if (r[1] === "G") {
    if (metric === "save") return +r[4];
    if (metric === "gaa") return +r[5];
    if (metric === "wins") return +(String(r[6]).split("-")[0] || 0);
    return +r[7] || 0;
  }
  if (metric === "points") return +r[4];
  if (metric === "goals") return +r[7];
  if (metric === "assists") return +r[8];
  if (metric === "ppg") return (+r[4] || 0) / (+r[3] || 1);
  if (metric === "plusminus") return +r[9];
  return +r[5];
}
function displayMetric(value, metric) {
  if (metric === "save") return value.toFixed(3);
  if (metric === "gaa" || metric === "ppg" || metric === "overall")
    return value.toFixed(2);
  return String(value);
}
function renderLeaderboard() {
  const type = document.getElementById("leaderboardType").value;
  const metric =
    document.getElementById("leaderboardMetric").value ||
    leaderboardMetrics[type][0][0];
  const role = type === "goalies" ? "G" : "S";
  const rows = data
    .filter((r) => r[1] === role)
    .map((r) => ({ r, value: metricValue(r, metric) }))
    .sort((a, b) => (metric === "gaa" ? a.value - b.value : b.value - a.value))
    .slice(0, 15);
  document.getElementById("leaderboard").innerHTML = rows
    .map(
      ({ r, value }, i) =>
        `<a class="leaderboard-row" href="scouting.html?player=${encodeURIComponent(r[0])}"><strong>${i + 1}</strong><div><b>${r[0]}</b><small>${getTeam(r) || r[2]}</small></div><span>${displayMetric(value, metric)}</span></a>`,
    )
    .join("");
}

document
  .getElementById("quickAdd")
  .addEventListener("click", () => addByName(quickPlayer.value));
quickPlayer.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addByName(quickPlayer.value);
});
document.getElementById("clearBoard").addEventListener("click", () => {
  if (confirm("Clear the entire GM target board?")) {
    saveBoard([]);
    render();
  }
});
notes.value = localStorage.getItem("vvhl-gm-notes") || "";
notes.addEventListener("input", () =>
  localStorage.setItem("vvhl-gm-notes", notes.value),
);
document.getElementById("exportBoard").addEventListener("click", async () => {
  const board = getBoard();
  const spend = board.reduce((s, x) => s + (Number(x.bid) || 0), 0);
  const lines = [
    "VVHL GM BIDDING BOARD",
    `Planned spend: ${money(spend)} / $30.0M`,
    `Remaining: ${money(CAP - spend)}`,
    "",
    ...board.map(
      (x, i) =>
        `${i + 1}. ${x.name} — ${x.position} — max ${money(x.bid)}${x.note ? ` — ${x.note}` : ""}`,
    ),
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    document.getElementById("exportBoard").textContent = "Copied ✓";
    setTimeout(
      () =>
        (document.getElementById("exportBoard").textContent =
          "Copy Board Summary"),
      1600,
    );
  } catch {
    alert(lines.join("\n"));
  }
});
populateNames();
render();
const teams = [...new Set(data.map(getTeam).filter(Boolean))].sort();
document.getElementById("availabilityTeam").innerHTML += teams
  .map((team) => `<option>${team}</option>`)
  .join("");
document
  .getElementById("availabilitySearch")
  .addEventListener("input", renderAvailability);
document
  .getElementById("availabilityTeam")
  .addEventListener("change", renderAvailability);
document.querySelectorAll("[data-lineup-format]").forEach((button) =>
  button.addEventListener("click", () => {
    lineupFormat = button.dataset.lineupFormat;
    document
      .querySelectorAll("[data-lineup-format]")
      .forEach((item) => item.classList.toggle("active", item === button));
    renderLineup();
  }),
);
document
  .getElementById("lineupName")
  .addEventListener("input", (event) =>
    updateLineup("name", event.target.value),
  );
document
  .getElementById("lineupNotes")
  .addEventListener("input", (event) =>
    updateLineup("notes", event.target.value),
  );
document.getElementById("copyLineup").addEventListener("click", async () => {
  const current = lineups()[lineupFormat] || {};
  const names = Object.fromEntries(
    uniquePlayers.map((r) => [r[0].trim().toLowerCase(), r[0]]),
  );
  const output = [
    current.name || `${lineupFormat.toUpperCase()} LINEUP`,
    ...lineupPositions[lineupFormat].map(
      (slot) => `${slot}: ${names[current[slot]] || "TBD"}`,
    ),
    current.notes ? `Notes: ${current.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    await navigator.clipboard.writeText(output);
    document.getElementById("copyLineup").textContent = "Copied ✓";
    setTimeout(
      () => (document.getElementById("copyLineup").textContent = "Copy Lineup"),
      1600,
    );
  } catch {
    alert(output);
  }
});
document
  .getElementById("leaderboardType")
  .addEventListener("change", renderMetricOptions);
document
  .getElementById("leaderboardMetric")
  .addEventListener("change", renderLeaderboard);
renderAvailability();
renderLineup();
renderMetricOptions();
