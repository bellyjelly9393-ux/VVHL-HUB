(() => {
  const db = window.VVHLBackend?.db;
  if (!db) return;

  const S = { events: [], teams: [], players: [], rosters: [], games: [], gameStats: [], reports: [], mediaJobs: [], eventId: "", lg: null };
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  const lower = (v) => String(v || "").toLowerCase();
  const norm = (v) => lower(v).replace(/[^a-z0-9]+/g, "");
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  const teamById = (id) => S.teams.find((x) => x.id === id);
  const playerById = (id) => S.players.find((x) => x.id === id);
  const gameById = (id) => S.games.find((x) => x.id === id);
  const currentGame = () => gameById($("reportGameSelect")?.value);
  const currentReport = () => S.reports.find((x) => x.game_id === currentGame()?.id);
  const gameStats = (gameId) => S.gameStats.filter((x) => x.game_id === gameId);
  const eventRoster = (eventId) => S.rosters.filter((x) => x.event_id === eventId && x.active !== false);
  const message = (id, value, bad = false) => { const el = $(id); if (el) { el.textContent = value; el.style.color = bad ? "#ff9a9a" : "#9ff4bc"; } };

  function gameLabel(g) {
    const home = teamById(g.home_team_id)?.name || "TBD";
    const away = teamById(g.away_team_id)?.name || "TBD";
    const when = g.scheduled_at ? new Date(g.scheduled_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "TBD";
    return `${g.status === "final" ? "FINAL" : g.status.toUpperCase()} · ${when} · ${home} vs ${away}`;
  }

  async function loadData() {
    const [events, teams, players, rosters, games, stats, reports, mediaJobs] = await Promise.all([
      db.from("esports_events").select("*").eq("active", true).order("starts_on"),
      db.from("esports_teams").select("*").eq("active", true).order("name"),
      db.from("esports_players").select("*").eq("active", true).order("gamertag"),
      db.from("esports_event_rosters").select("*"),
      db.from("esports_games").select("*").order("scheduled_at", { ascending: false }),
      db.from("esports_game_player_stats").select("*"),
      db.from("esports_game_reports").select("*"),
      db.from("postgame_media_jobs").select("*").order("created_at", { ascending: false }),
    ]);
    const err = [events, teams, players, rosters, games, stats, reports, mediaJobs].find((x) => x.error)?.error;
    if (err) { console.error(err); return; }
    Object.assign(S, {
      events: events.data || [], teams: teams.data || [], players: players.data || [], rosters: rosters.data || [], games: games.data || [], gameStats: stats.data || [], reports: reports.data || [], mediaJobs: mediaJobs.data || [],
    });
    S.eventId = S.events.find((x) => x.slug === "road-to-pro-2026")?.id || S.events[0]?.id || "";
    await syncMediaJobs();
    renderGames();
  }

  function renderGames() {
    const select = $("reportGameSelect");
    if (!select) return;
    const previous = select.value;
    const rows = S.games.filter((x) => x.event_id === S.eventId).sort((a, b) => {
      if (a.status === "final" && b.status !== "final") return -1;
      if (b.status === "final" && a.status !== "final") return 1;
      return new Date(b.scheduled_at || 0) - new Date(a.scheduled_at || 0);
    });
    select.innerHTML = rows.length ? rows.map((g) => `<option value="${g.id}">${esc(gameLabel(g))}</option>`).join("") : '<option value="">No tournament games loaded</option>';
    if (previous && rows.some((x) => x.id === previous)) select.value = previous;
    loadEditor();
  }

  function aggregateTeam(gameId, teamId) {
    const rows = gameStats(gameId).filter((x) => x.team_id === teamId);
    return rows.reduce((a, x) => {
      a.goals += num(x.goals); a.assists += num(x.assists); a.points += num(x.points); a.shots += num(x.shots); a.hits += num(x.hits);
      a.takeaways += num(x.takeaways); a.giveaways += num(x.giveaways); a.pim += num(x.pim); a.saves += num(x.goalie_saves); a.goalieShots += num(x.goalie_shots);
      return a;
    }, { goals: 0, assists: 0, points: 0, shots: 0, hits: 0, takeaways: 0, giveaways: 0, pim: 0, saves: 0, goalieShots: 0 });
  }

  function playerLine(row) {
    const p = playerById(row.player_id);
    return { player_id: row.player_id, gamertag: p?.gamertag || "Player", team_id: row.team_id, team: teamById(row.team_id)?.name || "Team", goals: num(row.goals), assists: num(row.assists), points: num(row.points), plus_minus: num(row.plus_minus), shots: num(row.shots), saves: num(row.goalie_saves), goalie_shots: num(row.goalie_shots) };
  }

  function threeStarsFor(game) {
    const rows = gameStats(game.id).map(playerLine);
    return rows.map((x) => {
      const goaliePct = x.goalie_shots ? x.saves / x.goalie_shots : 0;
      const score = x.points * 20 + x.goals * 4 + x.plus_minus * 1.5 + (goaliePct >= .8 ? goaliePct * 18 : 0) + (x.saves >= 10 ? x.saves * .25 : 0);
      return { ...x, score };
    }).sort((a, b) => b.score - a.score || b.points - a.points || b.goals - a.goals).slice(0, 3).map(({ score, ...x }) => x);
  }

  function factsFor(game) {
    const home = teamById(game.home_team_id), away = teamById(game.away_team_id);
    const homeStats = aggregateTeam(game.id, game.home_team_id), awayStats = aggregateTeam(game.id, game.away_team_id);
    const homeScore = num(game.home_score), awayScore = num(game.away_score);
    const winner = homeScore >= awayScore ? home : away;
    const loser = winner?.id === home?.id ? away : home;
    const winnerScore = winner?.id === home?.id ? homeScore : awayScore;
    const loserScore = winner?.id === home?.id ? awayScore : homeScore;
    return { home, away, homeStats, awayStats, homeScore, awayScore, winner, loser, winnerScore, loserScore, margin: Math.abs(homeScore - awayScore), stars: threeStarsFor(game) };
  }

  function draftReport(game) {
    const f = factsFor(game);
    const stage = [game.stage, game.round_label].filter(Boolean).join(" · ") || "tournament play";
    const ot = game.overtime ? " in overtime" : "";
    const verb = f.margin >= 4 ? "powers past" : f.margin === 1 ? "edges" : "defeats";
    const headline = `${f.winner?.name || "Winner"} ${verb} ${f.loser?.name || "Opponent"}, ${f.winnerScore}-${f.loserScore}${game.overtime ? " in OT" : ""}`;
    const subheadline = `${stage}: ${f.winner?.name || "The winner"} turns the matchup into a ${f.winnerScore}-${f.loserScore} final${ot}.`;

    const winnerAgg = f.winner?.id === f.home?.id ? f.homeStats : f.awayStats;
    const loserAgg = f.winner?.id === f.home?.id ? f.awayStats : f.homeStats;
    const analysis = [];
    analysis.push(`${f.winner?.name || "The winning side"} came away with a ${f.winnerScore}-${f.loserScore} win over ${f.loser?.name || "the opposition"}${ot}, getting the result that mattered in ${stage}. The final margin tells part of the story, but the more useful read is how the game was managed once the pressure rose.`);
    if (winnerAgg.shots || loserAgg.shots) analysis.push(`The tracked shot totals finished ${winnerAgg.shots}-${loserAgg.shots} in favor of ${f.winner?.name || "the winner"}. ${winnerAgg.shots > loserAgg.shots ? "That territorial pressure gave the winning side more repeat opportunities instead of asking its finishing to be perfect." : "The winner did not need the larger shot count; the difference was conversion and execution when chances arrived."}`);
    if (winnerAgg.takeaways || loserAgg.takeaways || winnerAgg.giveaways || loserAgg.giveaways) analysis.push(`Puck management also mattered. ${f.winner?.name || "The winner"} recorded ${winnerAgg.takeaways} takeaways against ${winnerAgg.giveaways} giveaways, while ${f.loser?.name || "the opponent"} finished at ${loserAgg.takeaways} takeaways and ${loserAgg.giveaways} giveaways. Those exchanges are often where an esports game tilts before the scoreboard fully reflects it.`);
    if (winnerAgg.hits || loserAgg.hits) analysis.push(`Physically, the teams combined for ${winnerAgg.hits + loserAgg.hits} tracked hits. The important piece was not simply contact volume, but whether pressure forced rushed exits, loose pucks and second possessions.`);
    if (f.stars[0]) analysis.push(`${f.stars[0].gamertag} supplied the clearest individual impact in the tracked line with ${f.stars[0].goals} goal${f.stars[0].goals === 1 ? "" : "s"} and ${f.stars[0].assists} assist${f.stars[0].assists === 1 ? "" : "s"} for ${f.stars[0].points} point${f.stars[0].points === 1 ? "" : "s"}. That production gave ${f.stars[0].team} a reliable focal point when the game needed a play.`);
    if (!gameStats(game.id).length) analysis.push(`The detailed player stat line has not been loaded yet, so this draft intentionally stays with the verified score and game context. Once the LG/public box score is synced, the report can tighten around shot share, puck-management numbers and individual matchups.`);

    let turningPoint;
    if (game.overtime) turningPoint = `The turning point was surviving regulation with the game still level and then making the first decisive play in overtime. In a one-chance environment, patience mattered more than forcing offense that was not there.`;
    else if (f.loserScore === 0) turningPoint = `${f.winner?.name || "The winner"} never allowed the game to open into a trade of chances. Protecting the middle and keeping the opponent off the board removed any realistic comeback window.`;
    else if (f.margin === 1) turningPoint = `This stayed a one-goal game, so the turning point was not one giant swing as much as the final clean sequence. ${f.winner?.name || "The winner"} handled the late-game possession battle without giving the tying chance back.`;
    else if (f.margin >= 4) turningPoint = `Separation came when ${f.winner?.name || "the winner"} converted its pressure into consecutive scoreboard damage. Once the game moved beyond one-possession range, ${f.loser?.name || "the opponent"} had to chase, and the ice opened even further.`;
    else turningPoint = `${f.winner?.name || "The winner"} created enough separation to force ${f.loser?.name || "the opponent"} out of its preferred game. From there, protecting the lead became more important than chasing another highlight.`;

    let deskTitle = "THE LATE DESK: THE SCOREBOARD HAS SPOKEN";
    let desk;
    if (game.overtime) desk = `Apparently regulation was too ordinary. ${f.winner?.name || "The winner"} needed bonus hockey, one more stress test and presumably a few elevated heart rates before finally ending it ${f.winnerScore}-${f.loserScore}. Completely reasonable behavior from a video game hockey tournament.`;
    else if (f.loserScore === 0) desk = `${f.loser?.name || "The losing side"} spent the night treating the goal horn like a museum exhibit: look, admire, absolutely do not touch. ${f.winner?.name || "The winner"} takes the shutout and the rest of us pretend defense is always this tidy.`;
    else if (f.margin >= 4) desk = `By the time this one settled, the scoreboard had done enough cardio for everybody. ${f.winner?.name || "The winner"} posted a ${f.winnerScore}-${f.loserScore} final and made the postgame math pleasantly uncomplicated.`;
    else if (f.margin === 1) desk = `One-goal hockey: the sport's preferred method for turning every harmless mistake into courtroom evidence. ${f.winner?.name || "The winner"} escapes ${f.winnerScore}-${f.loserScore}, and nobody involved will be describing the final minutes as relaxing.`;
    else desk = `No conspiracy board required here. ${f.winner?.name || "The winner"} simply banked more of its chances and walked away ${f.winnerScore}-${f.loserScore}. Somewhere, a virtual coach is still explaining that the next one starts 0-0.`;

    const keyStats = {
      home: { team: f.home?.name, score: f.homeScore, ...f.homeStats },
      away: { team: f.away?.name, score: f.awayScore, ...f.awayStats },
    };
    return { headline, subheadline, analyst_report: analysis.join("\n\n"), turning_point: turningPoint, desk_title: deskTitle, desk_banter: desk, three_stars: f.stars, key_stats: keyStats };
  }

  function mediaPackage(game) {
    const d = draftReport(game);
    const f = factsFor(game);
    const score = (f.home?.name || "Home") + " " + f.homeScore + "-" + f.awayScore + " " + (f.away?.name || "Away");
    const articleBody = [
      d.subheadline,
      d.analyst_report,
      d.turning_point ? "TURNING POINT\n" + d.turning_point : "",
      d.desk_banter ? (d.desk_title || "THE LATE DESK") + "\n" + d.desk_banter : ""
    ].filter(Boolean).join("\n\n");
    return {
      resultSnapshot: {
        game_id: game.id,
        event_id: game.event_id,
        status: game.status,
        scheduled_at: game.scheduled_at,
        overtime: Boolean(game.overtime),
        stage: game.stage || game.round_label || null,
        home: { id: game.home_team_id, name: f.home?.name || null, score: f.homeScore, stats: f.homeStats },
        away: { id: game.away_team_id, name: f.away?.name || null, score: f.awayScore, stats: f.awayStats },
        three_stars: d.three_stars
      },
      recapDraft: d.subheadline,
      articleTitle: d.headline,
      articleBody,
      socialCopy: {
        short: d.headline + ". " + d.subheadline,
        score,
        three_stars: d.three_stars,
        website_path: "postgame.html?id=" + game.id
      },
      sourceNotes: {
        generator: "wildman-postgame-v1",
        stats_loaded: gameStats(game.id).length > 0,
        evidence: "Verified tournament result and currently loaded game stats. VOD evidence can be merged before publication."
      }
    };
  }

  async function syncMediaJobs() {
    const finals = S.games.filter((g) => g.status === "final" && (!S.eventId || g.event_id === S.eventId));
    const existing = new Map(S.mediaJobs.filter((x) => x.esports_game_id).map((x) => [x.esports_game_id, x]));
    const user = window.VVHLBackend?.state?.user;
    for (const game of finals) {
      const job = existing.get(game.id);
      const pack = mediaPackage(game);
      const packageData = {
        result_snapshot: pack.resultSnapshot,
        recap_draft: pack.recapDraft,
        article_title: pack.articleTitle,
        article_body: pack.articleBody,
        social_copy: pack.socialCopy,
        source_notes: pack.sourceNotes,
        updated_at: new Date().toISOString()
      };
      if (job) {
        if (!["published","review"].includes(job.status) && (!job.article_title || job.status === "queued")) {
          const patch = { ...packageData, status: "ready" };
          const { error } = await db.from("postgame_media_jobs").update(patch).eq("id", job.id);
          if (error) console.warn("Postgame media automation", error);
          else Object.assign(job, patch);
        }
        continue;
      }
      const payload = {
        event_id: game.event_id,
        esports_game_id: game.id,
        status: "ready",
        website_publish_mode: "draft",
        ...packageData,
        created_by: user?.id || null
      };
      const { data, error } = await db.from("postgame_media_jobs").insert(payload).select("*").single();
      if (error) console.warn("Postgame media automation", error);
      else if (data) { S.mediaJobs.unshift(data); existing.set(game.id, data); }
    }
  }

  async function syncMediaJobFromEditor(game, status) {
    const job = S.mediaJobs.find((x) => x.esports_game_id === game.id);
    if (!job) return;
    const draft = draftReport(game);
    const published = status === "published";
    const articleBody = [
      $("reportSubheadline").value.trim(),
      $("reportAnalyst").value.trim(),
      $("reportTurningPoint").value.trim() ? "TURNING POINT\n" + $("reportTurningPoint").value.trim() : "",
      $("reportDeskBanter").value.trim() ? ($("reportDeskTitle").value.trim() || "THE LATE DESK") + "\n" + $("reportDeskBanter").value.trim() : ""
    ].filter(Boolean).join("\n\n");
    const social = {
      short: $("reportHeadline").value.trim() + ". " + ($("reportSubheadline").value.trim() || ""),
      score: (teamById(game.home_team_id)?.name || "Home") + " " + num(game.home_score) + "-" + num(game.away_score) + " " + (teamById(game.away_team_id)?.name || "Away"),
      three_stars: draft.three_stars,
      website_path: "postgame.html?id=" + game.id
    };
    const patch = {
      status: published ? "published" : "review",
      recap_draft: $("reportSubheadline").value.trim() || null,
      article_title: $("reportHeadline").value.trim(),
      article_body: articleBody,
      social_copy: social,
      updated_at: new Date().toISOString(),
      published_at: published ? (job.published_at || new Date().toISOString()) : job.published_at
    };
    const { error } = await db.from("postgame_media_jobs").update(patch).eq("id", job.id);
    if (error) console.warn("Postgame media job update", error);
    else Object.assign(job, patch);
  }

  function renderFacts(game) {
    const root = $("reportFactsPreview"); if (!root || !game) return;
    const f = factsFor(game);
    root.innerHTML = `<div class="key-stat-grid"><div class="key-stat"><small>Final</small><strong>${esc(f.home?.name)} ${f.homeScore}-${f.awayScore} ${esc(f.away?.name)}</strong></div><div class="key-stat"><small>Shots tracked</small><strong>${f.homeStats.shots}-${f.awayStats.shots}</strong></div><div class="key-stat"><small>Takeaways</small><strong>${f.homeStats.takeaways}-${f.awayStats.takeaways}</strong></div><div class="key-stat"><small>Giveaways</small><strong>${f.homeStats.giveaways}-${f.awayStats.giveaways}</strong></div></div>${f.stars.length ? `<div class="three-stars" style="margin-top:12px">${f.stars.map((s, i) => `<div class="star-card"><span>${i + 1}${i === 0 ? "ST" : i === 1 ? "ND" : "RD"} STAR</span><strong>${esc(s.gamertag)}</strong><small>${esc(s.team)} · ${s.goals}G ${s.assists}A ${s.points}P</small></div>`).join("")}</div>` : '<div class="empty-state" style="margin-top:12px">Player stats are not loaded for this game yet.</div>'}`;
  }

  function renderMediaAutomation(game) {
    const anchor = $("reportFactsPreview");
    if (!anchor) return;
    let panel = $("postgameMediaAutomation");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "postgameMediaAutomation";
      panel.className = "report-card";
      panel.style.marginTop = "16px";
      anchor.insertAdjacentElement("afterend", panel);
    }
    const job = S.mediaJobs.find((x) => x.esports_game_id === game.id);
    if (!job) {
      panel.innerHTML = '<div class="eyebrow">POSTGAME MEDIA AUTOMATION</div><h3>Waiting for Final</h3><p>Once this game is Final, Wildman queues the recap/article/social package automatically.</p>';
      return;
    }
    const social = job.social_copy?.short || "";
    panel.innerHTML = '<div class="eyebrow">POSTGAME MEDIA AUTOMATION</div><h3>' + esc(String(job.status || "queued").toUpperCase()) + '</h3><p><b>Article:</b> ' + esc(job.article_title || "Queued from final result") + '</p>' + (social ? '<p><b>Social copy:</b> <span id="postgameSocialText">' + esc(social) + '</span></p><div class="report-actions"><button id="copyPostgameSocial" class="small-btn" type="button">Copy Social Copy</button></div>' : '<p>Social copy will populate when the verified result package is enriched.</p>');
    $("copyPostgameSocial")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(social);
        message("reportSaveMessage", "Social copy copied.");
      } catch {
        message("reportSaveMessage", "Could not copy automatically. Select the social text manually.", true);
      }
    });
  }

  function loadEditor() {
    const game = currentGame(); if (!game) return;
    const report = currentReport() || {};
    $("reportHeadline").value = report.headline || "";
    $("reportSubheadline").value = report.subheadline || "";
    $("reportAnalyst").value = report.analyst_report || "";
    $("reportTurningPoint").value = report.turning_point || "";
    $("reportDeskTitle").value = report.desk_title || "";
    $("reportDeskBanter").value = report.desk_banter || "";
    $("reportSourceNotes").value = report.source_notes || "";
    $("lgPublicUrl").value = report.source_url || game.source_url || "";
    $("openPublicReportBtn").href = report.status === "published" ? `postgame.html?id=${encodeURIComponent(game.id)}` : "reports.html";
    S.lg = null; $("lgPreview").innerHTML = ""; $("importLgRowsBtn").disabled = true;
    renderFacts(game);
    renderMediaAutomation(game);
    message("reportSaveMessage", report.status === "published" ? "Published report loaded for editing." : report.id ? "Draft loaded." : "No report saved yet.");
  }

  function generateDraft() {
    const game = currentGame();
    if (!game) return message("reportGenerateMessage", "Choose a game first.", true);
    if (game.status !== "final") message("reportGenerateMessage", "This game is not marked Final yet. Drafting anyway, but verify the score before publishing.", true);
    else message("reportGenerateMessage", "Draft generated from the current score and loaded player stats.");
    const draft = draftReport(game);
    $("reportHeadline").value = draft.headline; $("reportSubheadline").value = draft.subheadline; $("reportAnalyst").value = draft.analyst_report;
    $("reportTurningPoint").value = draft.turning_point; $("reportDeskTitle").value = draft.desk_title; $("reportDeskBanter").value = draft.desk_banter;
    renderFacts(game);
  }

  function headerKey(value) {
    const raw = lower(value).trim().replace(/\s+/g, " ");
    const compact = raw.replace(/[^a-z0-9%+/-]/g, "");
    const aliases = {
      player: ["player", "gamertag", "gt", "username", "user", "name"], position: ["pos", "position"],
      goals: ["g", "goals"], assists: ["a", "assists"], points: ["p", "pts", "points"], plus_minus: ["+/-", "+−", "plusminus", "plus-minus"],
      shots: ["sh", "shots", "sog"], hits: ["hits", "hit"], takeaways: ["ta", "takeaways", "takeaway"], giveaways: ["gv", "gva", "giveaways", "giveaway"],
      pim: ["pim", "pims"], faceoff_wins: ["fow", "fowins", "faceoffwins"], faceoff_losses: ["fol", "folosses", "faceofflosses"],
      goalie_saves: ["sv", "saves"], goalie_shots: ["sa", "shotsagainst", "goalieshots"], save_pct: ["sv%", "save%", "savepct"],
    };
    for (const [key, list] of Object.entries(aliases)) if (list.some((x) => compact === x.replace(/[^a-z0-9%+/-]/g, ""))) return key;
    return null;
  }

  function detectLgTable() {
    let best = null;
    for (const table of S.lg?.tables || []) {
      for (let i = 0; i < Math.min(table.rows.length, 8); i += 1) {
        const map = {};
        table.rows[i].forEach((cell, idx) => { const key = headerKey(cell); if (key && map[key] === undefined) map[key] = idx; });
        const keys = Object.keys(map);
        const score = keys.length + (map.player !== undefined ? 5 : 0) + (["goals", "assists", "points"].some((x) => map[x] !== undefined) ? 4 : 0);
        if (!best || score > best.score) best = { table, headerRow: i, map, score };
      }
    }
    return best && best.score >= 7 ? best : null;
  }

  function renderLgPreview() {
    const root = $("lgPreview"); if (!root) return;
    if (!S.lg) { root.innerHTML = ""; return; }
    const detected = detectLgTable();
    const cards = (S.lg.tables || []).slice(0, 3).map((table, n) => {
      const rows = table.rows.slice(0, 16);
      return `<section class="lg-table-card"><header><strong>Table ${n + 1}</strong><span class="report-badge">stat score ${table.statScore || 0}</span></header><div class="lg-table-scroll"><table>${rows.map((r, i) => `<tr>${r.map((c) => `<${i === 0 ? "th" : "td"}>${esc(c)}</${i === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table></div></section>`;
    }).join("");
    root.innerHTML = `<div class="network-note"><strong>${esc(S.lg.title || "LeagueGaming public page")}</strong><br>${S.lg.tableCount || 0} HTML table${S.lg.tableCount === 1 ? "" : "s"} found.${detected ? " A player-stat table was detected and can be imported." : " No player-stat table could be mapped automatically yet."}</div>${cards || '<div class="empty-state">No HTML stat tables were returned.</div>'}`;
    $("importLgRowsBtn").disabled = !detected;
  }

  async function pullLgStats() {
    const game = currentGame(); const url = $("lgPublicUrl").value.trim();
    if (!game) return message("lgPullMessage", "Choose a game first.", true);
    if (!url) return message("lgPullMessage", "Paste a public LeagueGaming stats URL first.", true);
    message("lgPullMessage", "Pulling the public LG page…"); $("importLgRowsBtn").disabled = true;
    try {
      const response = await fetch(`/api/lg-public-stats?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `LG request failed (${response.status})`);
      S.lg = data; renderLgPreview();
      const user = window.VVHLBackend?.state?.user;
      const snapshot = await db.from("esports_lg_snapshots").insert({ event_id: game.event_id, game_id: game.id, source_url: url, source_kind: "game", parsed_payload: data, imported_by: user?.id || null });
      if (snapshot.error) console.warn(snapshot.error);
      message("lgPullMessage", `Pulled ${data.tableCount || 0} public LG table${data.tableCount === 1 ? "" : "s"}. Review before importing.`);
    } catch (error) {
      console.error(error); S.lg = null; renderLgPreview(); message("lgPullMessage", error.message || "Unable to pull LG public stats.", true);
    }
  }

  function matchingPlayer(cell, candidates) {
    const c = norm(cell);
    if (!c) return null;
    return candidates.find((p) => { const g = norm(p.gamertag); return g && (c === g || c.includes(g) || g.includes(c)); }) || null;
  }

  async function importLgRows() {
    const game = currentGame(); const detected = detectLgTable();
    if (!game || !detected) return message("lgPullMessage", "No importable LG player-stat table is detected.", true);
    const rosterRows = eventRoster(game.event_id).filter((r) => r.team_id === game.home_team_id || r.team_id === game.away_team_id);
    const candidates = rosterRows.map((r) => playerById(r.player_id)).filter(Boolean);
    const payload = [];
    for (const row of detected.table.rows.slice(detected.headerRow + 1)) {
      const playerCell = row[detected.map.player]; const player = matchingPlayer(playerCell, candidates); if (!player) continue;
      const roster = rosterRows.find((r) => r.player_id === player.id); if (!roster) continue;
      const get = (key) => detected.map[key] === undefined ? null : row[detected.map[key]];
      const n = (key) => { const value = Number(String(get(key) ?? "0").replace(/[^0-9.-]/g, "")); return Number.isFinite(value) ? value : 0; };
      const raw = {}; Object.entries(detected.map).forEach(([key, idx]) => { raw[key] = row[idx] ?? null; });
      payload.push({
        game_id: game.id, event_id: game.event_id, team_id: roster.team_id, player_id: player.id, position: roster.position || player.primary_position || null,
        goals: n("goals"), assists: n("assists"), points: detected.map.points === undefined ? n("goals") + n("assists") : n("points"), plus_minus: detected.map.plus_minus === undefined ? null : n("plus_minus"),
        shots: detected.map.shots === undefined ? null : n("shots"), hits: detected.map.hits === undefined ? null : n("hits"), takeaways: detected.map.takeaways === undefined ? null : n("takeaways"), giveaways: detected.map.giveaways === undefined ? null : n("giveaways"),
        pim: detected.map.pim === undefined ? null : n("pim"), faceoff_wins: detected.map.faceoff_wins === undefined ? null : n("faceoff_wins"), faceoff_losses: detected.map.faceoff_losses === undefined ? null : n("faceoff_losses"),
        goalie_saves: detected.map.goalie_saves === undefined ? null : n("goalie_saves"), goalie_shots: detected.map.goalie_shots === undefined ? null : n("goalie_shots"), save_pct: detected.map.save_pct === undefined ? null : n("save_pct"),
        raw_stats: raw, source_provider: "leaguegaming-public", updated_at: new Date().toISOString(),
      });
    }
    if (!payload.length) return message("lgPullMessage", "The LG table was detected, but none of its player names matched this game's imported tournament roster. Verify the official GTs first.", true);
    const result = await db.from("esports_game_player_stats").upsert(payload, { onConflict: "game_id,player_id" });
    if (result.error) return message("lgPullMessage", result.error.message, true);
    message("lgPullMessage", `Imported ${payload.length} matched LG player stat line${payload.length === 1 ? "" : "s"}.`);
    await loadData(); await rebuildEventTotals(game.event_id);
  }

  async function rebuildEventTotals(eventId) {
    const { data: rows, error } = await db.from("esports_game_player_stats").select("*").eq("event_id", eventId);
    if (error) { console.warn(error); return; }
    const map = new Map();
    for (const x of rows || []) {
      const key = x.player_id; const a = map.get(key) || { event_id: eventId, team_id: x.team_id, player_id: key, games_played: 0, goals: 0, assists: 0, points: 0, plus_minus: 0, shots: 0, hits: 0, takeaways: 0, giveaways: 0, pim: 0, faceoff_wins: 0, faceoff_losses: 0, goalie_shots: 0, goalie_saves: 0 };
      a.team_id = x.team_id || a.team_id; a.games_played += 1; a.goals += num(x.goals); a.assists += num(x.assists); a.points += num(x.points); a.plus_minus += num(x.plus_minus); a.shots += num(x.shots); a.hits += num(x.hits); a.takeaways += num(x.takeaways); a.giveaways += num(x.giveaways); a.pim += num(x.pim); a.faceoff_wins += num(x.faceoff_wins); a.faceoff_losses += num(x.faceoff_losses); a.goalie_shots += num(x.goalie_shots); a.goalie_saves += num(x.goalie_saves); map.set(key, a);
    }
    const totals = [...map.values()].map((x) => ({ ...x, shooting_pct: x.shots ? (x.goals / x.shots) * 100 : null, save_pct: x.goalie_shots ? (x.goalie_saves / x.goalie_shots) : null, raw_stats: {}, source_provider: "wildman-game-aggregate", source_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
    if (totals.length) {
      const res = await db.from("esports_player_event_stats").upsert(totals, { onConflict: "event_id,player_id" });
      if (res.error) console.warn(res.error);
    }
  }

  async function saveReport(status) {
    const game = currentGame(); if (!game) return message("reportSaveMessage", "Choose a game first.", true);
    if (status === "published" && game.status !== "final") return message("reportSaveMessage", "Mark the game Final before publishing the recap.", true);
    if (!$("reportHeadline").value.trim() || !$("reportAnalyst").value.trim()) return message("reportSaveMessage", "Headline and Hockey Report analysis are required.", true);
    const draft = draftReport(game); const user = window.VVHLBackend?.state?.user; const existing = currentReport();
    const payload = {
      game_id: game.id, event_id: game.event_id, status, headline: $("reportHeadline").value.trim(), subheadline: $("reportSubheadline").value.trim() || null,
      analyst_report: $("reportAnalyst").value.trim(), turning_point: $("reportTurningPoint").value.trim() || null, three_stars: draft.three_stars, desk_title: $("reportDeskTitle").value.trim() || "THE LATE DESK",
      desk_banter: $("reportDeskBanter").value.trim() || null, key_stats: draft.key_stats, source_notes: $("reportSourceNotes").value.trim() || null, source_url: $("lgPublicUrl").value.trim() || null,
      created_by: existing?.created_by || user?.id || null, updated_by: user?.id || null, published_at: status === "published" ? (existing?.published_at || new Date().toISOString()) : existing?.published_at || null, updated_at: new Date().toISOString(),
    };
    const res = await db.from("esports_game_reports").upsert(payload, { onConflict: "game_id" });
    if (res.error) return message("reportSaveMessage", res.error.message, true);
    await syncMediaJobFromEditor(game, status);
    message("reportSaveMessage", status === "published" ? "Published. The report is now live on the public Postgame Reports page and the media job is closed as published." : "Draft saved privately. Article and social package updated.");
    await loadData();
  }

  $("reportGameSelect")?.addEventListener("change", loadEditor);
  $("pullLgStatsBtn")?.addEventListener("click", pullLgStats);
  $("importLgRowsBtn")?.addEventListener("click", importLgRows);
  $("generateReportBtn")?.addEventListener("click", generateDraft);
  $("saveReportDraftBtn")?.addEventListener("click", () => saveReport("draft"));
  $("publishReportBtn")?.addEventListener("click", () => saveReport("published"));
  window.addEventListener("vvhl-auth-change", (event) => { if (window.VVHLManagementGuard?.hasAccess(event.detail)) loadData(); });
  if (window.VVHLManagementGuard?.hasAccess(window.VVHLBackend?.state)) loadData();
})();
