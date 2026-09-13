const rawPlayers = Array.isArray(window.VVHL_PLAYERS)
  ? window.VVHL_PLAYERS
  : [];
const rolesByName = rawPlayers.reduce((m, r) => {
  const k = r[0].trim().toLowerCase();
  if (!m.has(k)) m.set(k, []);
  m.get(k).push(r);
  return m;
}, new Map());
const players = [...rolesByName.values()].map(
  (rows) => rows.find((r) => r[1] === "S") || rows[0],
);
const $ = (id) => document.getElementById(id),
  grid = $("playerGrid"),
  modal = $("playerModal");
const search = $("searchInput"),
  typeFilter = $("typeFilter"),
  positionFilter = $("positionFilter"),
  teamFilter = $("teamFilter");
let active = null;
const team = (r) => (r[1] === "S" ? r[11] || "" : r[8] || "");
const pos = (r) => r[2] || (r[1] === "G" ? "Goalie" : "Unknown");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
const pg = (v, g) => (g ? Number(v) / Number(g) : 0);
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const scale = (v, a, b) => clamp(((v - a) / (b - a)) * 100);
const board = () => {
  try {
    return JSON.parse(localStorage.getItem("vvhl-gm-board") || "[]");
  } catch {
    return [];
  }
};
const save = (v) => localStorage.setItem("vvhl-gm-board", JSON.stringify(v));
const winRate = (s) => {
  const [w = 0, l = 0, o = 0] = String(s || "")
    .split("-")
    .map(Number);
  return w + l + o ? w / (w + l + o) : 0;
};
const confidence = (g) =>
  g >= 24
    ? ["High confidence", "high"]
    : g >= 12
      ? ["Moderate confidence", "medium"]
      : ["Small sample", "low"];
const initials = (n) => {
  const p = n.trim().split(/\s+/);
  return (
    (p[0]?.[0] || "?") + (p.length > 1 ? p.at(-1)[0] : p[0]?.[1] || "")
  ).toUpperCase();
};
const roles = (r) => rolesByName.get(r[0].trim().toLowerCase()) || [r];
const roleLabel = (r) => {
  const rows = roles(r);
  return rows.length > 1
    ? "Skater / Goalie"
    : rows[0][1] === "G"
      ? "Goalie"
      : "Skater";
};
const positionLabel = (r) => [...new Set(roles(r).map(pos))].join(" / ");
const teamLogoPaths = {
  "Angry Byrds": "assets/teams/angry-byrds.webp",
  "Barn Cats": "assets/teams/barn-cats.png",
  "Big Dawgs": "assets/teams/big-dawgs.png",
  "Cherry Cartel": "assets/teams/cherry-cartel.png",
  "Dover Demons": "assets/teams/dover-demons.png",
  "Evil Leprechauns": "assets/teams/evil-leprechauns.png",
  Knights: "assets/teams/knights.png",
  "Pine Rangers": "assets/teams/pine-rangers.png",
  Raptors: "assets/teams/raptors.png",
  "Royal Ghosts": "assets/teams/royal-ghosts.png",
  "Silver Foxes": "assets/teams/silver-foxes.png",
  "Soul Reapers": "assets/teams/soul-reapers.png",
  "Southbeach Snipers": "assets/teams/southbeach-snipers.png",
};

const vodReports = {
  "l setty l": {
    alias: "Bad News Kells",
    summary:
      "Active attacking winger who supports entries, moves into interior scoring space and finishes around traffic. The footage also shows useful offensive interaction with thenny32.",
    notes: [
      [
        "01:41",
        "Offensive support",
        "Stays available above the puck as Grid establishes the zone.",
      ],
      [
        "03:45",
        "Net-front involvement",
        "Works into the interior lane instead of remaining exclusively on the perimeter.",
      ],
      [
        "06:03",
        "Goal / finishing",
        "Converts Grid's third goal after joining the attack through the middle; thenny32 is involved in the sequence.",
      ],
    ],
  },
  thenny32: {
    summary:
      "Center-oriented distributor who supports the puck through the middle and connects Grid's transition game. The first period shows promising chemistry with l Setty l, including involvement in the third goal.",
    notes: [
      [
        "00:55",
        "Center assignment",
        "Handles Grid's opening faceoff responsibility.",
      ],
      [
        "02:18",
        "Puck support",
        "Drops underneath the rush to provide a central outlet.",
      ],
      [
        "06:03",
        "Chemistry",
        "Combines with l Setty l during Grid's third-goal sequence.",
      ],
    ],
  },
  gritty028: {
    summary:
      "Generally provides the deepest Grid support and protects the middle behind aggressive forwards. He activates selectively while maintaining a safety position through most transitions.",
    notes: [
      [
        "01:22",
        "Defensive support",
        "Holds above the play while Grid's forwards work below the circles.",
      ],
      [
        "03:20",
        "Transition defence",
        "Retreats through the middle and keeps the rush in front of him.",
      ],
      [
        "05:48",
        "Outlet support",
        "Makes himself available behind the puck during Grid's regroup.",
      ],
    ],
  },
  "theone-iso": {
    summary:
      "Records a scoreless reviewed period and stays composed during Dover's limited attacks. The sample supports positional stability, but shot volume is too small for a firm goalie projection.",
    notes: [
      [
        "02:47",
        "Rush tracking",
        "Remains square as Dover enters and the attack moves laterally.",
      ],
      [
        "04:08",
        "Crease positioning",
        "Maintains depth and angle while traffic develops above the crease.",
      ],
      [
        "06:50",
        "Late-period management",
        "Protects the shutout through Dover's final pressure in the clip.",
      ],
    ],
  },
  nihilisticyeti: {
    summary:
      "Joins Dover's transition pressure and supports attacks above the puck. His aggression creates disruption, but more footage is needed to judge the results of his pinches.",
    notes: [
      [
        "01:35",
        "Neutral-zone pressure",
        "Closes early and attempts to interrupt Grid's controlled entry.",
      ],
      [
        "04:40",
        "Transition support",
        "Moves up with Dover's attack instead of remaining passive.",
      ],
      [
        "06:18",
        "Defensive recovery",
        "Tracks back through the middle after possession changes.",
      ],
    ],
  },
  schielf35: {
    summary:
      "Shows repeated middle-lane responsibility at both ends. The sample supports two-way involvement, while a larger review is required to grade distribution and chance creation.",
    notes: [
      [
        "00:55",
        "Faceoff assignment",
        "Takes Dover's opening center responsibility.",
      ],
      [
        "03:18",
        "Defensive positioning",
        "Returns through the central lane between the puck and slot.",
      ],
      [
        "05:02",
        "Offensive support",
        "Arrives underneath the rush as a middle option.",
      ],
    ],
  },
  spychopaht: {
    summary:
      "Assertive, mobile defender who steps toward carriers and influences play above the circles. His aggression should be tracked over more games for the space it can leave behind him.",
    notes: [
      [
        "01:12",
        "Entry defence",
        "Challenges the carrier near the blue line rather than conceding an easy entry.",
      ],
      [
        "04:49",
        "Physical pressure",
        "Steps into contact to disrupt Grid's transition and earns an in-game highlight.",
      ],
      [
        "05:48",
        "Puck support",
        "Moves into an outlet lane quickly when Dover regains possession.",
      ],
    ],
  },
  "cosmictv-": {
    summary:
      "Faces sustained Grid pressure and allows three goals in the reviewed period. The clip locates the scoring sequences, but one period cannot separate goalie execution from screens, coverage and chance quality.",
    notes: [
      [
        "03:56",
        "Traffic management",
        "Tracks through layered traffic as Grid establishes crease pressure.",
      ],
      [
        "05:13",
        "Set position",
        "Gets square during a settled possession and controls the initial look.",
      ],
      [
        "06:03",
        "Goal against",
        "Grid converts from the interior; review alongside Dover's coverage before assigning responsibility.",
      ],
    ],
  },
};

function skaterReport(r) {
  const g = +r[3] || 0,
    p = +r[4] || 0,
    goals = +r[7] || 0,
    assists = +r[8] || 0,
    pm = +r[9] || 0,
    fo = +r[10] || 0;
  const ppg = pg(p, g),
    gpg = pg(goals, g),
    apg = pg(assists, g),
    pmg = pg(pm, g),
    wr = winRate(r[6]),
    position = pos(r);
  let arch = "Two-Way Skater";
  if (position === "Center")
    arch =
      fo >= 55
        ? "Faceoff Two-Way Center"
        : apg > gpg * 1.15
          ? "Pass-First Playmaker"
          : gpg >= 1.5
            ? "Scoring Center"
            : "Two-Way Center";
  else if (position === "Left Wing")
    arch =
      gpg >= 1.8 || goals > assists * 1.35
        ? "Goal-Scoring Winger"
        : assists > goals * 1.15
          ? "Playmaking Winger"
          : pmg >= 1
            ? "Two-Way Winger"
            : "Offensive Winger";
  else if (position.includes("Defense"))
    arch =
      apg >= 2.5
        ? "Puck-Moving Defenseman"
        : pmg >= 1.25
          ? "Two-Way Defenseman"
          : assists > goals * 2.5
            ? "Transition Defenseman"
            : "Defensive Defenseman";
  const good = [],
    risk = [];
  if (ppg >= 5)
    good.push(`Elite production at ${ppg.toFixed(2)} points per game.`);
  else if (ppg >= 3.5)
    good.push(`Strong production rate of ${ppg.toFixed(2)} points per game.`);
  else if (ppg < 2.25)
    risk.push(
      `Limited current production at ${ppg.toFixed(2)} points per game.`,
    );
  if (gpg >= 1.75)
    good.push(`High-end goal output at ${gpg.toFixed(2)} per game.`);
  if (apg >= 2.5)
    good.push(
      `Strong distribution results at ${apg.toFixed(2)} assists per game.`,
    );
  if (pmg >= 1)
    good.push(
      `Positive team results while dressed (${pm >= 0 ? "+" : ""}${pm}).`,
    );
  else if (pmg <= -0.75)
    risk.push(`The ${pm} rating needs lineup and opponent context.`);
  if (position === "Center" && fo >= 55)
    good.push(`Reliable faceoff results at ${fo.toFixed(1)}%.`);
  else if (position === "Center" && fo < 47)
    risk.push(
      `Faceoff rate of ${fo.toFixed(1)}% is below the preferred center range.`,
    );
  if (wr >= 0.65) good.push(`Strong ${r[6]} game record.`);
  else if (wr < 0.4)
    risk.push(`The ${r[6]} record requires closer role and lineup review.`);
  if (g < 12)
    risk.push(
      `Only ${g} games played; projection carries significant sample risk.`,
    );
  if (!good.length)
    good.push("Balanced statistical profile without one category dominating.");
  if (!risk.length)
    risk.push(
      "No major statistical warning; VOD is still required to confirm play style.",
    );
  return {
    arch,
    good,
    risk,
    grades: [
      ["Production", scale(ppg, 1.25, 6.5)],
      ["Finishing", scale(gpg, 0.25, 3)],
      ["Playmaking", scale(apg, 0.5, 3.75)],
      ["Team Results", scale(pmg, -3, 3)],
      ["Winning", scale(wr, 0.2, 0.8)],
    ],
    summary: `${arch} with ${p} points in ${g} games (${ppg.toFixed(2)} per game). The ${pm >= 0 ? "+" : ""}${pm} rating and ${r[6]} record provide the current team-results context. This is a statistical projection pending game-log and VOD confirmation.`,
  };
}

function goalieReport(r) {
  const g = +r[3] || 0,
    sv = +r[4] || 0,
    gaa = +r[5] || 0,
    so = +r[7] || 0,
    wr = winRate(r[6]);
  const arch =
      sv >= 0.76
        ? "High-Efficiency Goaltender"
        : gaa <= 4.75
          ? "Low-Event Goaltender"
          : g >= 22
            ? "Volume Starter"
            : "Developing Goaltender",
    good = [],
    risk = [];
  if (sv >= 0.76) good.push(`Excellent ${sv.toFixed(3)} save percentage.`);
  else if (sv >= 0.72)
    good.push(`Competitive ${sv.toFixed(3)} save percentage.`);
  else
    risk.push(
      `The ${sv.toFixed(3)} save percentage is below the top-performing range.`,
    );
  if (gaa <= 4.75)
    good.push(`${gaa.toFixed(2)} GAA supports strong suppression results.`);
  else if (gaa >= 6.5)
    risk.push(
      `${gaa.toFixed(2)} GAA needs defensive-system and shot-quality context.`,
    );
  if (wr >= 0.65) good.push(`Strong ${r[6]} record.`);
  else if (wr < 0.4) risk.push(`The ${r[6]} record increases projection risk.`);
  if (so)
    good.push(
      `${so} shutout${so === 1 ? "" : "s"} demonstrate game-stealing upside.`,
    );
  if (g < 12) risk.push(`Only ${g} appearances; treat this as a small sample.`);
  if (!good.length)
    good.push("Provides a usable statistical baseline for VOD review.");
  if (!risk.length)
    risk.push(
      "No major statistical warning; rebound control and save selection require VOD.",
    );
  return {
    arch,
    good,
    risk,
    grades: [
      ["Save Efficiency", scale(sv, 0.58, 0.82)],
      ["Goals Against", scale(gaa, 8.5, 3)],
      ["Winning", scale(wr, 0.15, 0.8)],
      ["Workload", scale(g, 3, 28)],
      ["Shutout Value", scale(so, 0, 2)],
    ],
    summary: `${arch} with a ${sv.toFixed(3)} save percentage, ${gaa.toFixed(2)} GAA and ${r[6]} record through ${g} appearances. Team defense and shot quality are not yet available, so this remains a statistical projection pending VOD.`,
  };
}
const report = (r) => (r[1] === "G" ? goalieReport(r) : skaterReport(r));
const detail = (a, b) =>
  `<div class="detail"><small>${esc(a)}</small><b>${esc(b ?? "—")}</b></div>`;
const playerKey = (r) => r[0].trim().toLowerCase();
const find = (k) => players.find((r) => playerKey(r) === k);
const playerTeam = (r) => roles(r).map(team).find(Boolean) || "";
const hasRole = (r, type) => roles(r).some((x) => x[1] === type);
const teamLogo = (r) => teamLogoPaths[playerTeam(r)] || "";
const statBlock = (r) =>
  r[1] === "S"
    ? `<article class="split-stat-block"><div class="eyebrow">SKATER · ${esc(pos(r))}</div><div class="detail-grid">${detail("Games", r[3])}${detail("Overall", r[5])}${detail("Points", r[4])}${detail("Goals", r[7])}${detail("Assists", r[8])}${detail("+ / -", r[9])}${detail("Faceoff %", r[10] + "%")}${detail("Record", r[6])}</div></article>`
    : `<article class="split-stat-block"><div class="eyebrow">GOALTENDER</div><div class="detail-grid">${detail("Games", r[3])}${detail("Record", r[6])}${detail("Save %", r[4])}${detail("GAA", r[5])}${detail("Shutouts", r[7])}</div></article>`;

function add(r) {
  const b = board(),
    key = playerKey(r),
    already = (x) =>
      x.key === key ||
      String(x.name || "")
        .trim()
        .toLowerCase() === key;
  if (!b.some(already)) {
    b.push({
      key,
      name: r[0],
      type: roleLabel(r),
      position: positionLabel(r),
      team: playerTeam(r),
      bid: 0,
      note: "",
    });
    save(b);
  }
  counts();
  document.querySelectorAll("[data-add]").forEach((x) => {
    if (x.dataset.add === key) {
      x.textContent = "Added ✓";
      x.disabled = true;
    }
  });
  if (active === r) $("modalAdd").textContent = "Added to GM Board ✓";
}
function tab(name) {
  document
    .querySelectorAll(".profile-tab")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.profileTab === name),
    );
  document
    .querySelectorAll(".profile-panel")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.profilePanel === name),
    );
}
function renderVod(r) {
  const v = vodReports[playerKey(r)];
  if (!v)
    return `<b>VOD evaluation</b><p>No reviewed footage has been attached to this player yet. Future observations will include the game, situation, timestamp and confidence level.</p>`;
  return `<div class="vod-header"><div><div class="eyebrow">VOD-CONFIRMED · PRELIMINARY</div><h3>Grid Light Cycles vs Dover Demons</h3><p>First period · 7:14 reviewed${v.alias ? ` · In-game name: <b>${esc(v.alias)}</b>` : ""}</p></div><span class="vod-confidence">ONE-PERIOD SAMPLE</span></div><article class="report-card vod-summary"><div class="eyebrow">VIDEO SCOUT SUMMARY</div><p>${esc(v.summary)}</p></article><div class="vod-timeline">${v.notes.map(([time, type, note]) => `<article class="vod-note"><time>${esc(time)}</time><div><b>${esc(type)}</b><p>${esc(note)}</p></div></article>`).join("")}</div>`;
}
function openPlayer(r, setUrl = true) {
  active = r;
  const rp = report(r),
    games = Math.max(...roles(r).map((x) => +x[3] || 0)),
    cf = confidence(games),
    key = playerKey(r),
    previousTeam = playerTeam(r);
  $("modalTitle").textContent = r[0];
  $("modalMeta").textContent =
    `${previousTeam || "Team unconfirmed"} · ${roleLabel(r)}`;
  $("modalPosition").textContent = positionLabel(r);
  $("modalPosition").dataset.position = pos(r);
  $("modalArchetype").textContent = rp.arch;
  $("modalConfidence").textContent = cf[0];
  $("modalConfidence").className = `confidence-chip ${cf[1]}`;
  $("profileMonogram").textContent = initials(r[0]);
  let logo = $("modalTeamLogo");
  if (!logo) {
    logo = document.createElement("img");
    logo.id = "modalTeamLogo";
    logo.className = "profile-team-logo";
    $("profileMonogram").after(logo);
  }
  const logoPath = teamLogo(r);
  logo.hidden = !logoPath;
  if (logoPath) {
    logo.src = logoPath;
    logo.alt = `${previousTeam} logo`;
  }
  $("modalDetails").innerHTML = roles(r)
    .map((x) =>
      x[1] === "S"
        ? detail("Skater GP", x[3]) +
          detail("Skater Points", x[4]) +
          detail("Skater Record", x[6])
        : detail("Goalie GP", x[3]) +
          detail("Goalie Save %", x[4]) +
          detail("Goalie Record", x[6]),
    )
    .join("");
  $("regularStats").innerHTML =
    `<div class="season-context"><b>Regular Season · VVHL 4s</b><span>${esc(previousTeam || "Previous team unconfirmed")}</span></div><div class="split-stat-grid">${roles(r).map(statBlock).join("")}</div>`;
  $("reportSummary").textContent = rp.summary;
  const vod = vodReports[key];
  $("profileEvidence").textContent = vod
    ? "Statistical projection supported by an attached preliminary VOD review. Open the VOD tab for timestamped evidence."
    : "Generated from Season XI statistical results—not yet VOD-confirmed.";
  $("vodReport").className = vod ? "" : "profile-empty";
  $("vodReport").innerHTML = renderVod(r);
  $("reportGrades").innerHTML = rp.grades
    .map(
      ([a, v]) =>
        `<div class="grade-row"><span>${esc(a)}</span><div class="grade-track"><i style="width:${v}%"></i></div><b>${v}</b></div>`,
    )
    .join("");
  $("reportStrengths").innerHTML = rp.good
    .map((x) => `<li>${esc(x)}</li>`)
    .join("");
  $("reportConcerns").innerHTML = rp.risk
    .map((x) => `<li>${esc(x)}</li>`)
    .join("");
  $("modalAdd").textContent = board().some(
    (x) =>
      x.key === key ||
      String(x.name || "")
        .trim()
        .toLowerCase() === key,
  )
    ? "Added to GM Board ✓"
    : "Add to GM Board";
  document
    .querySelectorAll("[data-format]")
    .forEach((x) => x.classList.toggle("active", x.dataset.format === "4s"));
  tab("overview");
  modal.classList.add("open");
  document.body.style.overflow = "hidden";
  if (setUrl) {
    const u = new URL(location.href);
    u.searchParams.set("player", r[0]);
    u.searchParams.delete("type");
    history.replaceState({}, "", u);
  }
}
function closePlayer() {
  modal.classList.remove("open");
  document.body.style.overflow = "";
  active = null;
  const u = new URL(location.href);
  u.searchParams.delete("player");
  u.searchParams.delete("type");
  history.replaceState({}, "", u);
}
function card(r) {
  const g = !hasRole(r, "S"),
    key = playerKey(r),
    rp = report(r),
    cf = confidence(Math.max(...roles(r).map((x) => +x[3] || 0))),
    added = board().some(
      (x) =>
        x.key === key ||
        String(x.name || "")
          .trim()
          .toLowerCase() === key,
    ),
    previousTeam = playerTeam(r),
    logo = teamLogo(r);
  const stats = g
    ? [
        ["GP", r[3]],
        ["SV%", r[4]],
        ["GAA", r[5]],
        ["SO", r[7]],
      ]
    : [
        ["GP", r[3]],
        ["PTS", r[4]],
        ["OVR", r[5]],
        ["+/-", r[9]],
      ];
  return `<article class="player-card ${g ? "goalie" : ""}" data-card="${esc(key)}" tabindex="0" role="button"><div class="player-head"><div class="card-player-id">${logo ? `<img class="card-team-logo" src="${esc(logo)}" alt="${esc(previousTeam)} logo">` : ""}<div><h3>${esc(r[0])}</h3><div class="player-meta">${esc(positionLabel(r))}</div></div></div><span class="player-type">${esc(roleLabel(r))}</span></div><div class="player-team">${esc(previousTeam || "Team unconfirmed")}</div><div class="card-archetype">${esc(rp.arch)} <small>${esc(cf[0])}</small></div><div class="player-stats">${stats.map(([a, b]) => `<div class="mini-stat"><small>${a}</small><b>${esc(b)}</b></div>`).join("")}</div><div class="card-actions"><button class="small-btn" data-view="${esc(key)}" type="button">Full Report</button><button class="small-btn primary" data-add="${esc(key)}" type="button" ${added ? "disabled" : ""}>${added ? "Added ✓" : "Add to GM"}</button></div></article>`;
}
function filtered() {
  const q = search.value.trim().toLowerCase();
  return players
    .filter((r) => {
      const h =
          `${r[0]} ${playerTeam(r)} ${positionLabel(r)} ${roleLabel(r)} ${report(r).arch}`.toLowerCase(),
        teamMatch =
          teamFilter.value === "all" ||
          (teamFilter.value === "unconfirmed"
            ? !playerTeam(r)
            : playerTeam(r) === teamFilter.value);
      return (
        (!q || h.includes(q)) &&
        teamMatch &&
        (typeFilter.value === "all" || hasRole(r, typeFilter.value)) &&
        (positionFilter.value === "all" ||
          roles(r).some((x) => pos(x) === positionFilter.value))
      );
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
}
function render() {
  const rows = filtered();
  grid.innerHTML = rows.map(card).join("");
  $("emptyState").hidden = !!rows.length;
  grid.querySelectorAll("[data-view]").forEach(
    (x) =>
      (x.onclick = (e) => {
        e.stopPropagation();
        openPlayer(find(x.dataset.view));
      }),
  );
  grid.querySelectorAll("[data-add]").forEach(
    (x) =>
      (x.onclick = (e) => {
        e.stopPropagation();
        add(find(x.dataset.add));
      }),
  );
  grid.querySelectorAll("[data-card]").forEach((x) => {
    x.onclick = () => openPlayer(find(x.dataset.card));
    x.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        x.click();
      }
    };
  });
}
function counts() {
  $("totalPlayers").textContent = players.length;
  $("skaterCount").textContent = players.filter((x) => hasRole(x, "S")).length;
  $("goalieCount").textContent = players.filter((x) => hasRole(x, "G")).length;
  $("shortlistCount").textContent = board().length;
}
[...new Set(rawPlayers.map(team).filter(Boolean))]
  .sort()
  .forEach((name) => teamFilter.add(new Option(name, name)));
[search, typeFilter, positionFilter, teamFilter].forEach(
  (x) => (x.oninput = render),
);
document
  .querySelectorAll(".profile-tab")
  .forEach((x) => (x.onclick = () => tab(x.dataset.profileTab)));
document.querySelectorAll("[data-format]").forEach(
  (x) =>
    (x.onclick = () => {
      document
        .querySelectorAll("[data-format]")
        .forEach((b) => b.classList.toggle("active", b === x));
      $("regularStats").innerHTML =
        x.dataset.format === "4s"
          ? `<div class="season-context"><b>Regular Season · VVHL 4s</b><span>${esc(playerTeam(active) || "Previous team unconfirmed")}</span></div><div class="split-stat-grid">${roles(active).map(statBlock).join("")}</div>`
          : `<div class="profile-empty"><b>VV6L 6s profile ready</b><p>Sixes statistics will appear here when the VV6L season data is connected. No 4s results are mixed into this view.</p></div>`;
    }),
);
$("modalClose").onclick = closePlayer;
modal.onclick = (e) => {
  if (e.target === modal) closePlayer();
};
document.onkeydown = (e) => {
  if (e.key === "Escape" && modal.classList.contains("open")) closePlayer();
};
$("modalAdd").onclick = () => active && add(active);
$("copyProfile").onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $("copyProfile").textContent = "Link Copied ✓";
    setTimeout(
      () => ($("copyProfile").textContent = "Copy Profile Link"),
      1600,
    );
  } catch {
    $("copyProfile").textContent = "Copy Failed";
  }
};
counts();
const requestedTeam = new URLSearchParams(location.search).get("team");
if (
  requestedTeam &&
  [...teamFilter.options].some((option) => option.value === requestedTeam)
) {
  teamFilter.value = requestedTeam;
}
render();
const wanted = new URLSearchParams(location.search).get("player");
if (wanted) {
  const r = players.find((x) => x[0].toLowerCase() === wanted.toLowerCase());
  if (r) openPlayer(r, false);
}
