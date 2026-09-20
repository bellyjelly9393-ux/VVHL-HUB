(() => {
  const SUPABASE_URL = "https://lrgllzvwgvqagcpiyvfd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP";
  const db = window.VVHLBackend?.db || (window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null);
  if (!db) return;

  const state = {
    teams: [], players: [], teamPlayers: [], events: [], eventTeams: [], eventRosters: [], games: [], stats: []
  };

  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const lower = (v) => String(v || "").toLowerCase();
  const byId = (rows, id) => rows.find(r => r.id === id);
  const teamById = (id) => byId(state.teams, id);
  const playerById = (id) => byId(state.players, id);
  const eventById = (id) => byId(state.events, id);
  const eventBySlug = (slug) => state.events.find(e => e.slug === slug);
  const isPrivateOperationsTeam = (team) => {
    const haystack = lower(`${team?.name || ""} ${team?.slug || ""} ${team?.abbreviation || ""}`);
    return haystack.includes("calgary hitmen") || haystack.includes("calgary-hitmen") || haystack === "hitmen" || haystack.includes(" hitmen ");
  };
  const coreImages = {
    "therustyknot": "assets/wildman/rusty.webp",
    "williamson20": "assets/wildman/williamson20.webp",
    "williamson88": "assets/wildman/williamson88.webp"
  };
  const coreProfiles = {
    "therustyknot": "player-rusty.html",
    "williamson20": "player-williamson20.html",
    "williamson88": "player-williamson88.html"
  };

  const playerHref = (player) => coreProfiles[lower(player?.gamertag)] || `esports-player.html?id=${encodeURIComponent(player?.id || "")}`;
  const teamHref = (team) => {
    if (!team) return "esports-hub.html";
    if (team.slug === "wildman-hockey") return "team.html";
    if (team.slug === "wildman-academy") return "academy.html";
    return `esports-team.html?team=${encodeURIComponent(team.slug)}`;
  };
  const fmtDate = (value) => {
    if (!value) return "TBD";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const initials = (name) => String(name || "WH").split(/\s+/).map(x => x[0]).join("").slice(0,3).toUpperCase();
  const teamMark = (team) => team?.logo_url
    ? `<img class="network-team-logo" src="${esc(team.logo_url)}" alt="${esc(team.name)} logo">`
    : `<div class="network-team-mark">${esc(team?.abbreviation || initials(team?.name))}</div>`;
  const playerVisual = (player) => {
    const src = coreImages[lower(player?.gamertag)];
    return src
      ? `<img src="${esc(src)}" alt="${esc(player.gamertag)}">`
      : `<div class="directory-avatar">${esc(initials(player?.gamertag))}</div>`;
  };
  const permanentMemberships = (playerId) => state.teamPlayers.filter(x => x.player_id === playerId && x.active !== false);
  const eventMemberships = (playerId) => state.eventRosters.filter(x => x.player_id === playerId && x.active !== false);
  const rosterForTeam = (teamId, eventId = null) => eventId
    ? state.eventRosters.filter(r => r.team_id === teamId && r.event_id === eventId && r.active !== false)
    : state.teamPlayers.filter(r => r.team_id === teamId && r.active !== false);
  const statsFor = (playerId, eventId) => state.stats.find(s => s.player_id === playerId && (!eventId || s.event_id === eventId));

  function renderNetworkHub() {
    const owned = state.teams.filter(t => t.is_owned && t.active !== false);
    const teamCount = document.getElementById("networkTeamCount");
    const playerCount = document.getElementById("networkPlayerCount");
    const eventCount = document.getElementById("networkEventCount");
    const gameCount = document.getElementById("networkGameCount");
    if (teamCount) teamCount.textContent = state.teams.filter(t => t.active !== false).length;
    if (playerCount) playerCount.textContent = state.players.filter(p => p.active !== false).length;
    if (eventCount) eventCount.textContent = state.events.filter(e => e.active !== false).length;
    if (gameCount) gameCount.textContent = state.games.length;

    const ownedGrid = document.getElementById("ownedTeamsGrid");
    if (ownedGrid) ownedGrid.innerHTML = owned.map(team => {
      const count = rosterForTeam(team.id).length;
      return `<a class="network-team-card" href="${esc(teamHref(team))}">${teamMark(team)}<div><small>${team.team_type === "academy" ? "Development Team" : "Competitive Team"}</small><h3>${esc(team.name)}</h3><p>${count ? `${count} player${count === 1 ? "" : "s"} currently indexed.` : "Roster opens as players are added."}</p><b>OPEN TEAM →</b></div></a>`;
    }).join("");

    const eventGrid = document.getElementById("networkEventGrid");
    if (eventGrid) eventGrid.innerHTML = state.events.length ? state.events.map(event => {
      const teams = state.eventTeams.filter(x => x.event_id === event.id).length;
      const games = state.games.filter(x => x.event_id === event.id).length;
      return `<a class="ops-card" href="${event.slug === "road-to-pro-2026" ? "pro-series.html" : `esports-hub.html?event=${encodeURIComponent(event.slug)}`}"><small>${esc(event.organizer || "Tournament")}</small><h3>${esc(event.name)}</h3><p>${esc(event.game_title || "EA SPORTS NHL")} · ${teams} teams indexed · ${games} games loaded.</p><span class="ops-link">Open Event →</span></a>`;
    }).join("") : `<div class="empty-state">No event feeds are loaded yet.</div>`;

    const search = document.getElementById("networkSearch");
    const results = document.getElementById("networkSearchResults");
    if (search && results) {
      const draw = () => {
        const q = lower(search.value).trim();
        if (!q) {
          results.innerHTML = `<div class="empty-state">Search a team, gamertag or tournament. When Pro Series rosters are imported, the entire field will be searchable here.</div>`;
          return;
        }
        const teamRows = state.teams.filter(t => lower(`${t.name} ${t.abbreviation}`).includes(q)).slice(0,8).map(t => ({type:"TEAM", title:t.name, meta:t.team_type === "external" ? "Tournament Team" : "Wildman", href:teamHref(t)}));
        const playerRows = state.players.filter(p => lower(`${p.gamertag} ${p.display_name} ${p.primary_position}`).includes(q)).slice(0,12).map(p => {
          const membership = permanentMemberships(p.id)[0] || eventMemberships(p.id)[0];
          const team = membership ? teamById(membership.team_id) : null;
          return {type:"PLAYER", title:p.gamertag, meta:`${p.primary_position || membership?.position || "POS TBD"}${team ? ` · ${team.name}` : ""}`, href:playerHref(p)};
        });
        const eventRows = state.events.filter(e => lower(`${e.name} ${e.organizer} ${e.game_title}`).includes(q)).slice(0,5).map(e => ({type:"EVENT", title:e.name, meta:`${e.organizer || "Tournament"} · ${e.status}`, href:e.slug === "road-to-pro-2026" ? "pro-series.html" : "esports-hub.html"}));
        const rows = [...teamRows, ...playerRows, ...eventRows];
        results.innerHTML = rows.length ? rows.map(r => `<a class="network-result" href="${esc(r.href)}"><span>${esc(r.type)}</span><div><strong>${esc(r.title)}</strong><small>${esc(r.meta)}</small></div><b>OPEN →</b></a>`).join("") : `<div class="empty-state">Nothing indexed for “${esc(search.value)}” yet.</div>`;
      };
      search.oninput = draw;
      draw();
    }
  }

  function renderPlayerDirectory() {
    const grid = document.getElementById("playerDirectoryGrid");
    if (!grid) return;
    const search = document.getElementById("playerDirectorySearch");
    const pool = document.getElementById("playerDirectoryPool");
    const count = document.getElementById("playerDirectoryCount");
    const draw = () => {
      const q = lower(search?.value).trim();
      const filter = pool?.value || "all";
      const rows = state.players.filter(player => {
        const permanent = permanentMemberships(player.id);
        const events = eventMemberships(player.id);
        const teamIds = new Set([...permanent, ...events].map(x => x.team_id));
        const teamSlugs = [...teamIds].map(id => teamById(id)?.slug).filter(Boolean);
        const matchesPool = filter === "all" || teamSlugs.includes(filter) || (filter === "tournament" && events.length > 0);
        const matchesText = !q || lower(`${player.gamertag} ${player.display_name} ${player.primary_position} ${teamSlugs.join(" ")}`).includes(q);
        return player.active !== false && matchesPool && matchesText;
      });
      if (count) count.textContent = `${rows.length} PLAYER${rows.length === 1 ? "" : "S"}`;
      grid.innerHTML = rows.length ? rows.map(player => {
        const membership = permanentMemberships(player.id)[0] || eventMemberships(player.id)[0];
        const team = membership ? teamById(membership.team_id) : null;
        const pos = player.primary_position || membership?.position || "TBD";
        return `<a class="directory-card" href="${esc(playerHref(player))}">${playerVisual(player)}<div class="directory-card-body"><small>${esc(team?.name || "Esports Player")}</small><h3>${esc(player.gamertag)}</h3><div class="directory-meta"><span class="directory-pill">POS ${esc(pos)}</span><span class="directory-pill">${esc(player.platform || "Platform TBD")}</span>${eventMemberships(player.id).length ? `<span class="directory-pill">Tournament</span>` : ""}</div><p>${team ? `${esc(team.name)} player profile and event stats hub.` : "Player profile ready for roster and tournament data."}</p><b class="ops-link">Open Profile →</b></div></a>`;
      }).join("") : `<div class="empty-state">No players match this search yet.</div>`;
    };
    if (search) search.oninput = draw;
    if (pool) pool.onchange = draw;
    draw();
  }

  function renderProSeries() {
    const event = eventBySlug("road-to-pro-2026");
    if (!event) return;
    const status = document.getElementById("proSeriesStatus");
    if (status) status.textContent = event.status === "upcoming" ? "Awaiting official field" : event.status.toUpperCase();
    const eventTeams = state.eventTeams.filter(x => x.event_id === event.id);
    const eventRosters = state.eventRosters.filter(x => x.event_id === event.id && x.active !== false);
    const eventGames = state.games.filter(x => x.event_id === event.id);
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    set("proTeamCount", eventTeams.length);
    set("proGameCount", eventGames.length);
    set("proPlayerCount", new Set(eventRosters.map(x => x.player_id)).size);

    const teamsRoot = document.getElementById("proSeriesTeams");
    if (teamsRoot) {
      teamsRoot.innerHTML = eventTeams.length ? `<div class="network-team-grid">${eventTeams.map(entry => {
        const team = teamById(entry.team_id);
        if (!team) return "";
        const roster = rosterForTeam(team.id, event.id);
        return `<a class="network-team-card" href="${esc(teamHref(team))}">${teamMark(team)}<div><small>${team.is_owned ? "Wildman Entry" : "Tournament Team"}</small><h3>${esc(team.name)}</h3><p>${roster.length} rostered player${roster.length === 1 ? "" : "s"}${entry.group_name ? ` · ${esc(entry.group_name)}` : ""}</p><b>OPEN ROSTER →</b></div></a>`;
      }).join("")}</div>${eventTeams.length <= 1 ? `<div class="network-note">Only Wildman Hockey is loaded right now. The rest of the field will appear automatically after the official tournament roster import.</div>` : ""}` : `<div class="empty-state">Official tournament teams have not been imported yet.</div>`;
    }

    const scheduleRoot = document.getElementById("proSeriesSchedule");
    if (scheduleRoot) scheduleRoot.innerHTML = eventGames.length ? `<div class="game-list">${eventGames.map(gameCard).join("")}</div>` : `<div class="empty-state">The official schedule has not been imported yet. Once it drops, every matchup will get a live Game Center page.</div>`;

    const leaderboard = document.getElementById("proLeaderboard");
    if (leaderboard) {
      const rows = state.stats.filter(x => x.event_id === event.id).sort((a,b) => (b.points || 0) - (a.points || 0) || (b.goals || 0) - (a.goals || 0));
      leaderboard.innerHTML = rows.length ? `<div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>GT</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th></tr></thead><tbody>${rows.map(s => {
        const p = playerById(s.player_id); const t = teamById(s.team_id);
        return `<tr><td><a href="${esc(playerHref(p))}">${esc(p?.gamertag || "Player")}</a></td><td>${esc(t?.name || "—")}</td><td>${s.games_played || 0}</td><td>${s.goals || 0}</td><td>${s.assists || 0}</td><td><b>${s.points || 0}</b></td><td>${s.plus_minus ?? "—"}</td></tr>`;
      }).join("")}</tbody></table></div>` : `<div class="empty-state">Tournament player stats will populate here as soon as the event feed starts producing results.</div>`;
    }

    const search = document.getElementById("tournamentSearch");
    const results = document.getElementById("tournamentSearchResults");
    if (search && results) {
      const draw = () => {
        const q = lower(search.value).trim();
        if (!q) { results.innerHTML = `<div class="empty-state">Search the current tournament by team or gamertag.</div>`; return; }
        const teamIds = new Set(eventTeams.map(x => x.team_id));
        const playerIds = new Set(eventRosters.map(x => x.player_id));
        const matches = [];
        state.teams.filter(t => teamIds.has(t.id) && lower(`${t.name} ${t.abbreviation}`).includes(q)).forEach(t => matches.push({type:"TEAM",title:t.name,meta:`${rosterForTeam(t.id,event.id).length} rostered players`,href:teamHref(t)}));
        state.players.filter(p => playerIds.has(p.id) && lower(`${p.gamertag} ${p.display_name} ${p.primary_position}`).includes(q)).forEach(p => {
          const r = eventRosters.find(x => x.player_id === p.id); const t = r ? teamById(r.team_id) : null; const s = statsFor(p.id,event.id);
          matches.push({type:"PLAYER",title:p.gamertag,meta:`${r?.position || p.primary_position || "POS TBD"}${t ? ` · ${t.name}` : ""}${s ? ` · ${s.points || 0} PTS` : ""}`,href:playerHref(p)});
        });
        results.innerHTML = matches.length ? matches.slice(0,20).map(r => `<a class="network-result" href="${esc(r.href)}"><span>${r.type}</span><div><strong>${esc(r.title)}</strong><small>${esc(r.meta)}</small></div><b>OPEN →</b></a>`).join("") : `<div class="empty-state">No tournament result for “${esc(search.value)}” yet.</div>`;
      };
      search.oninput = draw; draw();
    }
  }

  function gameCard(game) {
    const home = teamById(game.home_team_id);
    const away = teamById(game.away_team_id);
    const live = game.status === "live";
    const score = game.status === "scheduled" ? "VS" : `${game.home_score ?? 0}-${game.away_score ?? 0}`;
    return `<a class="game-row ${live ? "is-live" : ""}" href="live-game.html?id=${encodeURIComponent(game.id)}"><div><strong>${live ? "LIVE" : esc(fmtDate(game.scheduled_at))}</strong><small style="display:block">${esc(game.stage || game.round_label || eventById(game.event_id)?.name || "Event")}</small></div><div><strong>${esc(home?.name || "TBD")} vs ${esc(away?.name || "TBD")}</strong><small style="display:block">${esc(eventById(game.event_id)?.name || "Esports Event")}</small></div><div class="game-score">${esc(score)}</div><div class="game-result">${live ? "WATCH LIVE" : game.status === "final" ? "FINAL" : "OPEN"} →</div></a>`;
  }

  function renderGameCenter() {
    const root = document.getElementById("networkGameList");
    if (!root) return;
    const eventFilter = document.getElementById("gameEventFilter");
    const statusFilter = document.getElementById("gameStatusFilter");
    if (eventFilter && eventFilter.options.length <= 1) {
      state.events.forEach(e => eventFilter.insertAdjacentHTML("beforeend", `<option value="${esc(e.id)}">${esc(e.name)}</option>`));
    }
    const draw = () => {
      const eventId = eventFilter?.value || "all";
      const status = statusFilter?.value || "all";
      const rows = state.games.filter(g => (eventId === "all" || g.event_id === eventId) && (status === "all" || g.status === status));
      root.innerHTML = rows.length ? rows.map(gameCard).join("") : `<div class="empty-state">No tournament games are loaded for this filter yet. The board is ready for the official schedule import.</div>`;
    };
    if (eventFilter) eventFilter.onchange = draw;
    if (statusFilter) statusFilter.onchange = draw;
    draw();
  }

  function renderTeamDetail() {
    const root = document.getElementById("networkTeamDetail");
    if (!root) return;
    const key = new URLSearchParams(location.search).get("team");
    const team = state.teams.find(t => t.slug === key || t.id === key);
    if (!team) { root.innerHTML = `<div class="empty-state">Team not found in the esports directory.</div>`; return; }
    const permanent = rosterForTeam(team.id);
    const eventEntries = state.eventTeams.filter(x => x.team_id === team.id);
    const currentEventEntry = eventEntries.map(x => eventById(x.event_id)).filter(Boolean).sort((a,b) => new Date(b.starts_on || 0) - new Date(a.starts_on || 0))[0];
    const roster = currentEventEntry ? rosterForTeam(team.id, currentEventEntry.id) : permanent;
    const games = state.games.filter(g => g.home_team_id === team.id || g.away_team_id === team.id);
    document.title = `${team.name} | Wildman Esports Network`;
    root.innerHTML = `<a class="profile-back" href="esports-hub.html">← Back to Esports Hub</a><div class="network-profile-head">${teamMark(team)}<div><div class="eyebrow">${team.is_owned ? "WILDMAN ORGANIZATION" : "ESPORTS TEAM"}</div><h1>${esc(team.name)}</h1><p>${esc(currentEventEntry?.name || (team.team_type === "academy" ? "Wildman development roster" : "Esports team profile"))}</p></div></div><div class="hub-tabs"><a href="#roster">Roster</a><a href="#stats">Tournament Stats</a><a href="#games">Games</a></div><section id="roster" class="profile-section"><div class="section-heading"><div><div class="eyebrow">ROSTER</div><h2>${esc(currentEventEntry?.name || "CURRENT TEAM")}</h2></div></div>${roster.length ? rosterTable(roster,currentEventEntry?.id) : `<div class="empty-state">No roster has been imported for this team yet.</div>`}</section><section id="stats" class="profile-section"><div class="section-heading"><div><div class="eyebrow">PERFORMANCE</div><h2>TOURNAMENT STATS</h2></div></div>${teamStatsTable(team.id,currentEventEntry?.id)}</section><section id="games" class="profile-section"><div class="section-heading"><div><div class="eyebrow">SCHEDULE + RESULTS</div><h2>GAME CENTER</h2></div></div><div class="game-list">${games.length ? games.map(gameCard).join("") : `<div class="empty-state">No games loaded for this team yet.</div>`}</div></section>`;
  }

  function rosterTable(roster, eventId) {
    return `<div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>GT</th><th>Position</th><th>Status</th><th>GP</th><th>PTS</th><th>Profile</th></tr></thead><tbody>${roster.map(r => {
      const p = playerById(r.player_id); const s = eventId ? statsFor(r.player_id,eventId) : null;
      return `<tr><td>${esc(p?.gamertag || "Player")}</td><td>${esc(r.position || p?.primary_position || "TBD")}</td><td>${esc(r.roster_role || r.roster_status || "Active")}</td><td>${s?.games_played ?? "—"}</td><td>${s?.points ?? "—"}</td><td><a href="${esc(playerHref(p))}">OPEN →</a></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function teamStatsTable(teamId, eventId) {
    if (!eventId) return `<div class="empty-state">Tournament stats appear after this team is attached to an active event.</div>`;
    const rows = state.stats.filter(s => s.team_id === teamId && s.event_id === eventId).sort((a,b) => (b.points || 0) - (a.points || 0));
    return rows.length ? `<div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>GT</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>Shots</th><th>Hits</th><th>TA</th><th>GA</th></tr></thead><tbody>${rows.map(s => { const p = playerById(s.player_id); return `<tr><td><a href="${esc(playerHref(p))}">${esc(p?.gamertag || "Player")}</a></td><td>${s.games_played || 0}</td><td>${s.goals || 0}</td><td>${s.assists || 0}</td><td><b>${s.points || 0}</b></td><td>${s.shots ?? "—"}</td><td>${s.hits ?? "—"}</td><td>${s.takeaways ?? "—"}</td><td>${s.giveaways ?? "—"}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty-state">No tournament stats have been imported for this team yet.</div>`;
  }

  function renderPlayerDetail() {
    const root = document.getElementById("networkPlayerDetail");
    if (!root) return;
    const id = new URLSearchParams(location.search).get("id");
    const player = state.players.find(p => p.id === id || p.slug === id);
    if (!player) { root.innerHTML = `<div class="empty-state">Player not found in the esports directory.</div>`; return; }
    const permanent = permanentMemberships(player.id);
    const eventRows = eventMemberships(player.id);
    const team = permanent[0] ? teamById(permanent[0].team_id) : eventRows[0] ? teamById(eventRows[0].team_id) : null;
    const playerStats = state.stats.filter(s => s.player_id === player.id).sort((a,b) => new Date(eventById(b.event_id)?.starts_on || 0) - new Date(eventById(a.event_id)?.starts_on || 0));
    document.title = `${player.gamertag} | Wildman Esports Network`;
    root.innerHTML = `<a class="profile-back" href="players.html">← Back to Player Directory</a><div class="network-player-profile">${playerVisual(player)}<div><div class="eyebrow">ESPORTS PLAYER PROFILE</div><h1>${esc(player.gamertag)}</h1><p>${esc(player.primary_position || eventRows[0]?.position || "Position TBD")}${team ? ` · ${esc(team.name)}` : ""}${player.platform ? ` · ${esc(player.platform)}` : ""}</p><div class="directory-meta">${player.lg_profile_url ? `<a class="directory-pill" href="${esc(player.lg_profile_url)}" target="_blank" rel="noopener">LG Profile</a>` : ""}${player.chelstats_username ? `<span class="directory-pill">Chelstats Connected</span>` : ""}</div></div></div><section class="profile-section"><div class="section-heading"><div><div class="eyebrow">TOURNAMENT HISTORY</div><h2>EVENT STATS</h2></div></div>${playerStats.length ? `<div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>Event</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th></tr></thead><tbody>${playerStats.map(s => `<tr><td>${esc(eventById(s.event_id)?.name || "Event")}</td><td>${esc(teamById(s.team_id)?.name || "—")}</td><td>${s.games_played || 0}</td><td>${s.goals || 0}</td><td>${s.assists || 0}</td><td><b>${s.points || 0}</b></td><td>${s.plus_minus ?? "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">No tournament stats have been imported for this player yet.</div>`}</section>`;
  }

  function renderLiveGameDetail() {
    const root = document.getElementById("networkGameDetail");
    if (!root) return;
    const id = new URLSearchParams(location.search).get("id");
    const game = state.games.find(g => g.id === id);
    if (!game) { root.innerHTML = `<div class="empty-state">This tournament game has not been loaded yet.</div>`; return; }
    const home = teamById(game.home_team_id); const away = teamById(game.away_team_id); const event = eventById(game.event_id);
    document.title = `${home?.name || "TBD"} vs ${away?.name || "TBD"} | Game Center`;
    let stream = `<div class="stream-placeholder"><strong>STREAM NOT ASSIGNED</strong><span>A Twitch or broadcast feed can be attached to this matchup when coverage is confirmed.</span></div>`;
    if (game.stream_url) {
      if (lower(game.stream_provider) === "twitch") {
        const channel = game.stream_url.split("/").filter(Boolean).pop();
        stream = `<iframe class="network-stream" src="https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(location.hostname)}" allowfullscreen title="Live Twitch stream"></iframe>`;
      } else stream = `<a class="ops-card" href="${esc(game.stream_url)}" target="_blank" rel="noopener"><small>Live Broadcast</small><h3>Open Stream</h3><p>${esc(game.broadcast_title || "Watch this matchup live")}</p><span class="ops-link">WATCH →</span></a>`;
    }
    root.innerHTML = `<a class="profile-back" href="game-center.html">← Back to Game Center</a><div class="eyebrow">${esc(event?.name || "ESPORTS GAME")}</div><div class="live-scoreboard"><div><a href="${esc(teamHref(home))}">${teamMark(home)}<strong>${esc(home?.name || "TBD")}</strong></a></div><div class="live-score"><span>${game.status === "scheduled" ? "VS" : `${game.home_score || 0} - ${game.away_score || 0}`}</span><small>${esc(game.status.toUpperCase())} · ${esc(fmtDate(game.scheduled_at))}</small></div><div><a href="${esc(teamHref(away))}">${teamMark(away)}<strong>${esc(away?.name || "TBD")}</strong></a></div></div><div class="stream-shell">${stream}</div><div class="status-board" style="margin-top:18px"><div class="wm-stat"><div class="eyebrow">STAGE</div><strong>${esc(game.stage || "TBD")}</strong><span>${esc(game.round_label || "Tournament")}</span></div><div class="wm-stat"><div class="eyebrow">COMMENTARY</div><strong>${esc((game.commentary_status || "none").toUpperCase())}</strong><span>Wildman broadcast coverage status.</span></div><div class="wm-stat"><div class="eyebrow">STREAM</div><strong>${game.stream_url ? "LIVE LINK" : "TBD"}</strong><span>${esc(game.stream_provider || "Provider pending")}</span></div><div class="wm-stat"><div class="eyebrow">GAME PAGE</div><strong>PERMANENT</strong><span>Score, stream and stats archive stay here.</span></div></div>`;
  }

  async function load() {
    const [teams, players, teamPlayers, events, eventTeams, eventRosters, games, stats] = await Promise.all([
      db.from("esports_teams").select("*").eq("active", true).order("name"),
      db.from("esports_players").select("*").eq("active", true).order("gamertag"),
      db.from("esports_team_players").select("*").eq("active", true),
      db.from("esports_events").select("*").eq("active", true).order("starts_on", { ascending: false }),
      db.from("esports_event_teams").select("*"),
      db.from("esports_event_rosters").select("*").eq("active", true),
      db.from("esports_games").select("*").order("scheduled_at", { ascending: true, nullsFirst: false }),
      db.from("esports_player_event_stats").select("*")
    ]);
    const responses = {teams, players, teamPlayers, events, eventTeams, eventRosters, games, stats};
    Object.entries(responses).forEach(([name,res]) => { if (res.error) console.warn(`Esports network ${name}:`, res.error.message); });
    const rawTeams = teams.data || [];
    const privateTeamIds = new Set(rawTeams.filter(isPrivateOperationsTeam).map(t => t.id));

    // Calgary Hitmen hockey-operations data is private. Keep it out of every
    // public directory, search result, roster surface, event listing and game page.
    state.teams = rawTeams.filter(t => !privateTeamIds.has(t.id));
    state.players = players.data || [];
    state.teamPlayers = (teamPlayers.data || []).filter(r => !privateTeamIds.has(r.team_id));
    state.events = events.data || [];
    state.eventTeams = (eventTeams.data || []).filter(r => !privateTeamIds.has(r.team_id));
    state.eventRosters = (eventRosters.data || []).filter(r => !privateTeamIds.has(r.team_id));
    state.games = (games.data || []).filter(g => !privateTeamIds.has(g.home_team_id) && !privateTeamIds.has(g.away_team_id));
    state.stats = (stats.data || []).filter(s => !privateTeamIds.has(s.team_id));
    renderNetworkHub();
    renderPlayerDirectory();
    renderProSeries();
    renderGameCenter();
    renderTeamDetail();
    renderPlayerDetail();
    renderLiveGameDetail();
  }

  window.WildmanEsportsNetwork = { state, refresh: load };
  load();
})();