(() => {
  const SUPABASE_URL = "https://lrgllzvwgvqagcpiyvfd.supabase.co";
  const SUPABASE_KEY = "sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP";
  const db = window.VVHLBackend?.db || (window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null);
  if (!db) return;

  const state = {
    teams: [], players: [], teamPlayers: [], events: [], eventTeams: [], eventRosters: [], games: [], stats: [], gamePlayerStats: [], teamStats: []
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
    "the rusty knot": "assets/wildman/rusty.webp",
    "williamson20": "assets/wildman/williamson20.webp",
    "williamson88": "assets/wildman/williamson88.webp",
    "williamsonx88": "assets/wildman/williamson88.webp"
  };

  const playerHref = (player) => `esports-player.html?id=${encodeURIComponent(player?.id || "")}`;
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
    : `<div class="network-team-mark network-team-mark-fallback" title="Team logo pending">${esc(team?.abbreviation || initials(team?.name))}</div>`;

  const teamMini = (team) => team?.logo_url
    ? `<img class="network-team-mini-logo" src="${esc(team.logo_url)}" alt="" aria-hidden="true">`
    : `<span class="network-team-mini-mark">${esc(team?.abbreviation || initials(team?.name))}</span>`;

  const roleLabel = (role) => {
    const value = String(role || "").toLowerCase();
    if (value === "owner") return "OWNER";
    if (value === "gm") return "GM";
    if (value === "agm") return "AGM";
    if (value === "captain") return "CAPTAIN";
    return "";
  };

  const rosterPreview = (roster) => {
    const ordered = [...roster].sort((a,b) => {
      const order = {LW:1,C:2,RW:3,LD:4,RD:5,G:6,UTL:7};
      return (order[a.position] || 99) - (order[b.position] || 99);
    });
    return ordered.slice(0,7).map(r => {
      const p = playerById(r.player_id);
      const pos = r.position || p?.primary_position || "TBD";
      return `<span class="pro-roster-chip"><b>${esc(pos)}</b><em>${esc(p?.gamertag || "Player")}</em></span>`;
    }).join("");
  };
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
  const statsFor = (playerId, eventId) => {
    const rows = state.stats.filter(s => s.player_id === playerId && (!eventId || s.event_id === eventId));
    const priority = value => {
      const src = lower(value?.source_provider);
      if (src.includes("leaguegaming-player-profile")) return 4;
      if (src.includes("leaguegaming-official")) return 3;
      if (src.includes("wildman_game_aggregate")) return 2;
      return 1;
    };
    return rows.sort((a,b) => priority(b)-priority(a) || new Date(b.updated_at||0)-new Date(a.updated_at||0))[0] || null;
  };
  const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const pct = (v, digits = 1) => {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    const out = Math.abs(n) <= 1 ? n * 100 : n;
    return `${out.toFixed(digits).replace(/\.0$/,"")}%`;
  };
  const rate = (value, games) => num(games) ? (num(value) / num(games)).toFixed(2) : "0.00";
  const teamProfileHref = team => team ? `esports-team.html?team=${encodeURIComponent(team.slug || team.id)}` : "esports-hub.html";
  const gameById = id => state.games.find(g => g.id === id);
  const teamEventStat = (eventId, teamId) => state.teamStats.find(s => s.event_id === eventId && s.team_id === teamId);

  function renderNetworkHub() {
    const proEvent = eventBySlug("road-to-pro-2026");
    const proEntries = proEvent
      ? state.eventTeams.filter(x => x.event_id === proEvent.id).sort((a,b) => (a.seed || 999) - (b.seed || 999))
      : [];
    const teamCount = document.getElementById("networkTeamCount");
    const playerCount = document.getElementById("networkPlayerCount");
    const eventCount = document.getElementById("networkEventCount");
    const gameCount = document.getElementById("networkGameCount");
    if (teamCount) teamCount.textContent = state.teams.filter(t => t.active !== false).length;
    if (playerCount) playerCount.textContent = state.players.filter(p => p.active !== false).length;
    if (eventCount) eventCount.textContent = state.events.filter(e => e.active !== false).length;
    if (gameCount) gameCount.textContent = state.games.length;

    const proGrid = document.getElementById("proSeriesHubTeams") || document.getElementById("ownedTeamsGrid");
    const proCount = document.getElementById("proSeriesHubTeamCount");
    if (proCount) proCount.textContent = `${proEntries.length} TEAMS`;
    if (proGrid) proGrid.innerHTML = proEntries.length ? proEntries.map(entry => {
      const team = teamById(entry.team_id);
      if (!team) return "";
      const count = rosterForTeam(team.id, proEvent.id).length;
      return `<a class="network-team-card" href="${esc(teamHref(team))}">${teamMark(team)}<div><small>#${entry.seed || "—"} · PRO SERIES TEAM</small><h3>${esc(team.name)}</h3><p>${count} tournament player${count === 1 ? "" : "s"} rostered.</p><b>OPEN ROSTER →</b></div></a>`;
    }).join("") : `<div class="empty-state">Pro Series teams have not been loaded yet.</div>`;

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
    const eventTeams = state.eventTeams.filter(x => x.event_id === event.id).sort((a,b) => (a.seed || 999) - (b.seed || 999));
    const eventRosters = state.eventRosters.filter(x => x.event_id === event.id && x.active !== false);
    if (status) status.textContent = event.status === "upcoming"
      ? (eventTeams.length > 1 ? "FIELD LOADED" : "AWAITING FIELD")
      : event.status.toUpperCase();
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
        const management = roster.filter(r => roleLabel(r.roster_role)).map(r => roleLabel(r.roster_role));
        const roles = [...new Set(management)].join(" · ");
        return `<a class="network-team-card pro-team-card ${team.is_owned ? "is-wildman" : ""}" href="${esc(teamHref(team))}">
          <div class="pro-team-crest">${teamMark(team)}<span>${team.logo_url ? "TEAM CREST" : "LOGO SLOT"}</span></div>
          <div class="pro-team-copy">
            <small>${team.is_owned ? "WILDMAN ENTRY" : "PRO SERIES · SEASON 14"}</small>
            <h3>${esc(team.name)}</h3>
            <div class="pro-team-meta"><span>${roster.length} PLAYERS</span>${roles ? `<span>${esc(roles)}</span>` : ""}${entry.group_name ? `<span>${esc(entry.group_name)}</span>` : ""}</div>
            <div class="pro-roster-preview">${rosterPreview(roster)}</div>
            <b>OPEN TEAM HUB →</b>
          </div>
        </a>`;
      }).join("")}</div>${eventTeams.length <= 1 ? `<div class="network-note">Only Wildman Hockey is loaded right now. The rest of the field will appear automatically after the official tournament roster import.</div>` : ""}` : `<div class="empty-state">Official tournament teams have not been imported yet.</div>`;
    }

    const scheduleRoot = document.getElementById("proSeriesSchedule");
    if (scheduleRoot) scheduleRoot.innerHTML = eventGames.length ? `<div class="game-list">${eventGames.map(gameCard).join("")}</div>` : `<div class="empty-state">The official schedule has not been imported yet. Once it drops, every matchup will get a live Game Center page.</div>`;

    const leaderboard = document.getElementById("proLeaderboard");
    if (leaderboard) {
      const rows = state.stats.filter(x => x.event_id === event.id).sort((a,b) => (b.points || 0) - (a.points || 0) || (b.goals || 0) - (a.goals || 0));
      leaderboard.innerHTML = rows.length ? `<div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>GT</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>P</th><th>+/-</th></tr></thead><tbody>${rows.map(s => {
        const p = playerById(s.player_id); const t = teamById(s.team_id);
        return `<tr><td><a href="${esc(playerHref(p))}">${esc(p?.gamertag || "Player")}</a></td><td><span class="network-team-inline">${teamMini(t)}<span>${esc(t?.name || "—")}</span></span></td><td>${s.games_played || 0}</td><td>${s.goals || 0}</td><td>${s.assists || 0}</td><td><b>${s.points || 0}</b></td><td>${s.plus_minus ?? "—"}</td></tr>`;
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
    const managerRows = roster.filter(r => roleLabel(r.roster_role));
    const isProSeriesTeam = currentEventEntry?.slug === "road-to-pro-2026";
    root.innerHTML = `<a class="profile-back" href="pro-series.html">← Back to Pro Series</a>
      <div class="network-profile-head pro-team-profile-head">
        <div class="pro-profile-crest">${teamMark(team)}</div>
        <div>
          <div class="eyebrow">${isProSeriesTeam ? "PRO SERIES TEAM · SEASON 14" : (team.is_owned ? "WILDMAN ORGANIZATION" : "ESPORTS TEAM")}</div>
          <h1>${esc(team.name)}</h1>
          <p>${esc(currentEventEntry?.name || (team.team_type === "academy" ? "Wildman development roster" : "Esports team profile"))}</p>
          <div class="pro-profile-badges"><span>${roster.length} ROSTERED</span>${managerRows.map(r => {
            const p = playerById(r.player_id);
            return `<span>${esc(roleLabel(r.roster_role))} · ${esc(p?.gamertag || "Player")}</span>`;
          }).join("")}</div>
        </div>
      </div>
      <div class="hub-tabs"><a href="#roster">Roster</a><a href="#stats">Tournament Stats</a><a href="#games">Games</a></div>
      <section id="roster" class="profile-section">
        <div class="section-heading"><div><div class="eyebrow">ROSTER</div><h2>${esc(currentEventEntry?.name || "CURRENT TEAM")}</h2></div></div>
        ${roster.length ? rosterTable(roster,currentEventEntry?.id,team) : `<div class="empty-state">No roster has been imported for this team yet.</div>`}
      </section>
      <section id="stats" class="profile-section"><div class="section-heading"><div><div class="eyebrow">PERFORMANCE</div><h2>TOURNAMENT STATS</h2></div></div>${teamStatsTable(team.id,currentEventEntry?.id)}</section>
      <section id="games" class="profile-section"><div class="section-heading"><div><div class="eyebrow">SCHEDULE + RESULTS</div><h2>GAME CENTER</h2></div></div><div class="game-list">${games.length ? games.map(gameCard).join("") : `<div class="empty-state">No games loaded for this team yet.</div>`}</div></section>`;
  }

  function rosterTable(roster, eventId, team = null) {
    const order = {LW:1,C:2,RW:3,LD:4,RD:5,G:6,UTL:7};
    const ordered = [...roster].sort((a,b) => (order[a.position]||99)-(order[b.position]||99) || String(playerById(a.player_id)?.gamertag||"").localeCompare(String(playerById(b.player_id)?.gamertag||"")));
    return `<div class="pro-roster-shell">
      <div class="pro-roster-banner">${team ? teamMark(team) : ""}<div><small>ACTIVE TOURNAMENT ROSTER</small><strong>${esc(team?.name || "TEAM ROSTER")}</strong></div><span>${ordered.length} PLAYERS</span></div>
      <div class="wm-table-wrap"><table class="wm-table pro-roster-table"><thead><tr><th>Player</th><th>Position</th><th>Role</th><th>GP</th><th>PTS</th><th>Profile</th></tr></thead><tbody>${ordered.map(r => {
        const p = playerById(r.player_id); const s = eventId ? statsFor(r.player_id,eventId) : null;
        const role = roleLabel(r.roster_role) || String(r.roster_role || r.roster_status || "Active").toUpperCase();
        const href = playerHref(p);
        return `<tr>
          <td><div class="pro-player-cell">${team ? `<span class="pro-player-team-crest">${teamMini(team)}</span>` : `<span class="pro-position-icon">${esc(r.position || p?.primary_position || "?")}</span>`}<div><a class="pro-player-name-link" href="${esc(href)}"><strong>${esc(p?.gamertag || "Player")}</strong></a><small>${esc(p?.source_player_id ? "LG ID "+p.source_player_id : "Tournament player")}</small></div></div></td>
          <td><span class="pro-pos-pill">${esc(r.position || p?.primary_position || "TBD")}</span></td>
          <td><span class="pro-role-pill ${role === "OWNER" || role === "GM" || role === "AGM" ? "is-management" : ""}">${esc(role)}</span></td>
          <td>${s?.games_played ?? 0}</td><td>${s?.points ?? 0}</td>
          <td><a href="${esc(href)}">OPEN →</a></td>
        </tr>`;
      }).join("")}</tbody></table></div>
    </div>`;
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

    const eventRows = eventMemberships(player.id).sort((a,b) => new Date(eventById(b.event_id)?.starts_on||0)-new Date(eventById(a.event_id)?.starts_on||0));
    const permanent = permanentMemberships(player.id);
    const membership = eventRows[0] || permanent[0] || null;
    const team = membership ? teamById(membership.team_id) : null;
    const currentEvent = membership?.event_id ? eventById(membership.event_id) : null;
    const playerStats = state.stats.filter(s => s.player_id === player.id).sort((a,b) => new Date(eventById(b.event_id)?.starts_on || 0) - new Date(eventById(a.event_id)?.starts_on || 0));
    const currentStats = currentEvent ? statsFor(player.id,currentEvent.id) : playerStats[0] || null;
    const tracked = state.gamePlayerStats
      .filter(s => s.player_id === player.id && (!currentEvent || s.event_id === currentEvent.id))
      .map(s => ({...s, game:gameById(s.game_id)}))
      .filter(x => x.game)
      .sort((a,b) => new Date(b.game.scheduled_at||0)-new Date(a.game.scheduled_at||0));
    const pos = membership?.position || player.primary_position || "TBD";
    const isGoalie = pos === "G" || num(currentStats?.goalie_shots) > 0;
    const gp = num(currentStats?.games_played);
    const wins = num(currentStats?.wins), losses = num(currentStats?.losses), otl = num(currentStats?.ot_losses);
    const role = roleLabel(membership?.roster_role) || (membership?.is_captain ? "CAPTAIN" : "PLAYER");
    const teamStat = currentEvent && team ? teamEventStat(currentEvent.id,team.id) : null;
    const race = teamStat?.raw_stats?.race || membership?.group_name || "";
    const groupRank = teamStat?.raw_stats?.group_rank || teamStat?.seed || "";
    const raw = currentStats?.raw_stats || {};
    const foPct = raw.fo_pct !== undefined ? pct(raw.fo_pct) : (num(currentStats?.faceoff_wins)+num(currentStats?.faceoff_losses) ? pct(num(currentStats?.faceoff_wins)/(num(currentStats?.faceoff_wins)+num(currentStats?.faceoff_losses))) : "—");
    const gaa = raw.gaa !== undefined ? Number(raw.gaa).toFixed(2) : (gp ? (num(currentStats?.goalie_goals_against)/gp).toFixed(2) : "0.00");
    const points = num(currentStats?.points), goals = num(currentStats?.goals), assists = num(currentStats?.assists);
    const shots = num(currentStats?.shots), hits = num(currentStats?.hits), takeaways = num(currentStats?.takeaways), giveaways = num(currentStats?.giveaways);
    const blocks = num(currentStats?.blocked_shots), interceptions = num(currentStats?.interceptions), pim = num(currentStats?.pim);
    const savePct = pct(currentStats?.save_pct);
    const shotPct = currentStats?.shooting_pct !== null && currentStats?.shooting_pct !== undefined ? pct(currentStats.shooting_pct) : (shots ? pct(goals/shots) : "0%");
    const teamRecord = teamStat ? `${num(teamStat.wins)}-${num(teamStat.losses)}-${num(teamStat.ot_losses)}` : "—";

    const statCards = isGoalie ? [
      ["WINS",wins],["SAVE %",savePct],["SAVES",num(currentStats?.goalie_saves)],["GAA",gaa],["SHOTS AGAINST",num(currentStats?.goalie_shots)],["GAMES",gp]
    ] : [
      ["GOALS",goals],["ASSISTS",assists],["POINTS",points],["POINTS / GP",rate(points,gp)],["SHOTS",shots],["SHOT %",shotPct]
    ];

    const gameResult = item => {
      const g=item.game, playerTeamId=item.team_id;
      const own = g.home_team_id===playerTeamId ? num(g.home_score) : num(g.away_score);
      const opp = g.home_team_id===playerTeamId ? num(g.away_score) : num(g.home_score);
      if(g.status!=="final") return g.status?.toUpperCase() || "GAME";
      return own>opp ? `W ${own}-${opp}` : own<opp ? `L ${own}-${opp}` : `T ${own}-${opp}`;
    };
    const opponent = item => {
      const g=item.game;
      return teamById(g.home_team_id===item.team_id ? g.away_team_id : g.home_team_id);
    };
    const recentCards = tracked.slice(0,5).map(item => {
      const opp=opponent(item);
      const headline=isGoalie
        ? `${num(item.goalie_saves)} SV · ${pct(item.save_pct)} · ${num(item.goalie_goals_against)} GA`
        : `${num(item.goals)}G · ${num(item.assists)}A · ${num(item.points)}P`;
      return `<a class="player-recent-card" href="live-game.html?id=${encodeURIComponent(item.game.id)}">
        <div class="player-recent-logo">${teamMini(opp)}</div>
        <div><small>${esc(fmtDate(item.game.scheduled_at))} · ${esc(gameResult(item))}</small><strong>vs ${esc(opp?.name||"Opponent")}</strong><span>${esc(headline)} · ${esc(item.position||pos)}</span></div>
      </a>`;
    }).join("");

    const posMap = new Map();
    tracked.forEach(item => {
      const key=item.position||pos||"TBD";
      const row=posMap.get(key)||{gp:0,w:0,l:0,otl:0};
      row.gp++;
      const g=item.game, own=g.home_team_id===item.team_id?num(g.home_score):num(g.away_score), opp=g.home_team_id===item.team_id?num(g.away_score):num(g.home_score);
      if(g.status==="final"){ if(own>opp)row.w++; else if(own<opp)row.l++; else row.otl++; }
      posMap.set(key,row);
    });
    const positionRows=[...posMap.entries()].map(([position,r])=>`<div class="player-position-row"><b>${esc(position)}</b><span>${r.gp} tracked</span><strong>${r.w}-${r.l}-${r.otl}</strong></div>`).join("");

    const milestone = (label,value,target,sub) => {
      const safe=Math.max(0,num(value)), pctDone=Math.min(100,target?Math.round((safe/target)*100):0);
      return `<div class="player-milestone"><div><strong>${esc(label)}</strong><span>${esc(sub||"")}</span><b>${safe}/${target}</b></div><div class="player-progress"><i style="width:${pctDone}%"></i></div></div>`;
    };
    const milestones=isGoalie
      ? [milestone("5 Wins",wins,5,"Season wins"),milestone("50 Saves",num(currentStats?.goalie_saves),50,"Pucks turned aside"),milestone("100 Shots Faced",num(currentStats?.goalie_shots),100,"Workload"),milestone("10 Games",gp,10,"Tournament appearances")].join("")
      : [milestone("5 Goals",goals,5,"Scoring milestone"),milestone("5 Assists",assists,5,"Playmaking milestone"),milestone("10 Points",points,10,"Production milestone"),milestone("10 Hits",hits,10,"Physical play")].join("");

    const trackedNote = gp > tracked.length ? `${tracked.length} of ${gp} appearances currently have detailed EA/ChelStats box scores.` : `${tracked.length} detailed box score${tracked.length===1?"":"s"} connected.`;
    const sourceLabel = lower(currentStats?.source_provider).includes("leaguegaming") ? "LeagueGaming Season 14 profile totals" : "Tournament aggregate";

    document.title = `${player.gamertag} | Wildman Esports Network`;
    root.innerHTML = `<a class="profile-back" href="${team ? esc(teamProfileHref(team)) : "players.html"}">← ${team ? "Back to "+esc(team.name) : "Back to Player Directory"}</a>
      <div class="player-dashboard-shell">
        <aside class="player-dashboard-side">
          <div class="player-dashboard-teammark">${team ? teamMark(team) : playerVisual(player)}</div>
          <div class="eyebrow">PLAYER PROFILE</div>
          <h1>${esc(player.gamertag)}</h1>
          <p>${esc(pos)}${team ? ` · ${esc(team.name)}` : ""}</p>
          <div class="player-profile-pills"><span>${esc(role)}</span>${player.source_player_id?`<span>LG ID ${esc(player.source_player_id)}</span>`:""}${currentEvent?`<span>${esc(currentEvent.name)}</span>`:""}</div>
          ${team ? `<a class="player-team-card" href="${esc(teamProfileHref(team))}">${teamMini(team)}<span><small>CURRENT TEAM</small><strong>${esc(team.name)}</strong></span></a>` : ""}
          ${player.lg_profile_url ? `<a class="small-btn player-lg-link" href="${esc(player.lg_profile_url)}" target="_blank" rel="noopener">OPEN LG PROFILE →</a>` : ""}
        </aside>
        <div class="player-dashboard-main">
          <section class="player-season-head">
            <div><div class="eyebrow">${esc(currentEvent?.name || "CURRENT EVENT")}</div><h2>SEASON DASHBOARD</h2></div>
            <div class="player-season-record"><small>RECORD</small><strong>${wins}-${losses}-${otl}</strong></div>
          </section>

          <div class="player-stat-cards">${statCards.map(([label,value])=>`<div><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join("")}</div>

          <div class="player-dashboard-grid">
            <section class="player-panel" id="recent"><div class="player-panel-head"><h3>RECENT PERFORMANCE</h3><span>${esc(trackedNote)}</span></div>
              <div class="player-recent-grid">${recentCards || '<div class="empty-state">No detailed game box scores are connected yet.</div>'}</div>
            </section>
            <section class="player-panel"><div class="player-panel-head"><h3>RECORD BY POSITION</h3><span>Tracked game logs</span></div>
              <div class="player-position-list">${positionRows || `<div class="player-position-row"><b>${esc(pos)}</b><span>Official season record</span><strong>${wins}-${losses}-${otl}</strong></div>`}</div>
            </section>
          </div>

          <section class="player-panel" id="ratings">
            <div class="player-panel-head"><h3>PLAYER METRICS</h3><span>${esc(sourceLabel)}</span></div>
            ${isGoalie ? `<div class="player-metrics-grid">
              <div><h4>GOALTENDING</h4><p><span>Games</span><b>${gp}</b></p><p><span>Record</span><b>${wins}-${losses}-${otl}</b></p><p><span>Shots Faced</span><b>${num(currentStats?.goalie_shots)}</b></p><p><span>Saves</span><b>${num(currentStats?.goalie_saves)}</b></p><p><span>Save %</span><b>${savePct}</b></p><p><span>GAA</span><b>${gaa}</b></p></div>
              <div><h4>RESULTS</h4><p><span>Goals Against</span><b>${num(currentStats?.goalie_goals_against)}</b></p><p><span>Wins / GP</span><b>${rate(wins,gp)}</b></p><p><span>Team Record</span><b>${esc(teamRecord)}</b></p><p><span>Race</span><b>${esc(race||"—")}</b></p><p><span>Group Rank</span><b>${esc(groupRank||"—")}</b></p></div>
              <div><h4>CONNECTED DATA</h4><p><span>Detailed Games</span><b>${tracked.length}</b></p><p><span>Source</span><b>LG + EA</b></p><p><span>Position</span><b>${esc(pos)}</b></p><p><span>Role</span><b>${esc(role)}</b></p></div>
            </div>` : `<div class="player-metrics-grid">
              <div><h4>OFFENSE</h4><p><span>Games</span><b>${gp}</b></p><p><span>Goals</span><b>${goals}</b></p><p><span>G / GP</span><b>${rate(goals,gp)}</b></p><p><span>Assists</span><b>${assists}</b></p><p><span>A / GP</span><b>${rate(assists,gp)}</b></p><p><span>Points</span><b>${points}</b></p><p><span>P / GP</span><b>${rate(points,gp)}</b></p><p><span>Shots</span><b>${shots}</b></p><p><span>Shot %</span><b>${shotPct}</b></p></div>
              <div><h4>DEFENSE</h4><p><span>+/-</span><b>${currentStats?.plus_minus??0}</b></p><p><span>Hits</span><b>${hits}</b></p><p><span>Blocked Shots</span><b>${blocks}</b></p><p><span>Interceptions</span><b>${interceptions}</b></p><p><span>Takeaways</span><b>${takeaways}</b></p><p><span>Giveaways</span><b>${giveaways}</b></p><p><span>Turnover Diff</span><b>${takeaways-giveaways}</b></p></div>
              <div><h4>TEAM</h4><p><span>Record</span><b>${wins}-${losses}-${otl}</b></p><p><span>PIM</span><b>${pim}</b></p><p><span>FO %</span><b>${foPct}</b></p><p><span>Team Record</span><b>${esc(teamRecord)}</b></p><p><span>Race</span><b>${esc(race||"—")}</b></p><p><span>Group Rank</span><b>${esc(groupRank||"—")}</b></p><p><span>Detailed Games</span><b>${tracked.length}</b></p></div>
            </div>`}
          </section>

          <section class="player-panel" id="milestones"><div class="player-panel-head"><h3>SEASON MILESTONES</h3><span>Season 14</span></div><div class="player-milestones">${milestones}</div></section>

          <div class="player-dashboard-grid">
            <section class="player-panel"><div class="player-panel-head"><h3>PLAYER NEWS</h3><span>Wildman Media</span></div>
              <div class="player-news-empty"><strong>${esc(player.gamertag)}</strong><p>No published Wildman feature is attached yet. Game recaps and player features can populate this panel without inventing a headline for the sake of filling a box.</p></div>
            </section>
            <section class="player-panel"><div class="player-panel-head"><h3>AROUND THE TEAM</h3><span>${esc(currentEvent?.name||"Current event")}</span></div>
              <div class="player-team-summary">${team ? teamMark(team):""}<div><strong>${esc(team?.name||"No team")}</strong><p>${teamStat?`${teamRecord} · ${num(teamStat.points)} PTS · ${num(teamStat.goals_for)} GF / ${num(teamStat.goals_against)} GA`:"Team totals pending."}</p><small>${esc(race||"")}${groupRank?` · Rank #${esc(groupRank)}`:""}</small></div></div>
            </section>
          </div>

          <section class="profile-section"><div class="section-heading"><div><div class="eyebrow">TOURNAMENT HISTORY</div><h2>EVENT STATS</h2></div></div>
          ${playerStats.length ? `<div class="wm-table-wrap"><table class="wm-table"><thead><tr><th>Event</th><th>Team</th><th>GP</th><th>Record</th><th>G</th><th>A</th><th>P</th><th>+/-</th></tr></thead><tbody>${playerStats.map(s => {
            const t = teamById(s.team_id);
            return `<tr><td>${esc(eventById(s.event_id)?.name || "Event")}</td><td><span class="network-team-inline">${teamMini(t)}<span>${esc(t?.name || "—")}</span></span></td><td>${s.games_played || 0}</td><td>${num(s.wins)}-${num(s.losses)}-${num(s.ot_losses)}</td><td>${s.goals || 0}</td><td>${s.assists || 0}</td><td><b>${s.points || 0}</b></td><td>${s.plus_minus ?? "—"}</td></tr>`;
          }).join("")}</tbody></table></div>` : `<div class="empty-state">No tournament stats have been imported for this player yet.</div>`}</section>
        </div>
      </div>`;
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
    const [teams, players, teamPlayers, events, eventTeams, eventRosters, games, stats, gamePlayerStats, teamStats] = await Promise.all([
      db.from("esports_teams").select("*").eq("active", true).order("name"),
      db.from("esports_players").select("*").eq("active", true).order("gamertag"),
      db.from("esports_team_players").select("*").eq("active", true),
      db.from("esports_events").select("*").eq("active", true).eq("is_public", true).order("starts_on", { ascending: false }),
      db.from("esports_event_teams").select("*"),
      db.from("esports_event_rosters").select("*").eq("active", true),
      db.from("esports_games").select("*").order("scheduled_at", { ascending: true, nullsFirst: false }),
      db.from("esports_player_event_stats").select("*"),
      db.from("esports_game_player_stats").select("*"),
      db.from("esports_team_event_stats").select("*")
    ]);
    const responses = {teams, players, teamPlayers, events, eventTeams, eventRosters, games, stats, gamePlayerStats, teamStats};
    Object.entries(responses).forEach(([name,res]) => { if (res.error) console.warn(`Esports network ${name}:`, res.error.message); });
    const rawTeams = teams.data || [];
    const privateTeamIds = new Set(rawTeams.filter(isPrivateOperationsTeam).map(t => t.id));

    // Calgary Hitmen hockey-operations data is private. Keep it out of every
    // public directory, search result, roster surface, event listing and game page.
    const publicEventIds = new Set((events.data || []).map(e => e.id));
    state.teams = rawTeams.filter(t => !privateTeamIds.has(t.id));
    state.players = players.data || [];
    state.teamPlayers = (teamPlayers.data || []).filter(r => !privateTeamIds.has(r.team_id));
    state.events = events.data || [];
    state.eventTeams = (eventTeams.data || []).filter(r => publicEventIds.has(r.event_id) && !privateTeamIds.has(r.team_id));
    state.eventRosters = (eventRosters.data || []).filter(r => publicEventIds.has(r.event_id) && !privateTeamIds.has(r.team_id));
    state.games = (games.data || []).filter(g => publicEventIds.has(g.event_id) && !privateTeamIds.has(g.home_team_id) && !privateTeamIds.has(g.away_team_id));
    state.stats = (stats.data || []).filter(s => publicEventIds.has(s.event_id) && !privateTeamIds.has(s.team_id));
    state.gamePlayerStats = (gamePlayerStats.data || []).filter(s => publicEventIds.has(s.event_id) && !privateTeamIds.has(s.team_id));
    state.teamStats = (teamStats.data || []).filter(s => publicEventIds.has(s.event_id) && !privateTeamIds.has(s.team_id));
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