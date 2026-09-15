(() => {
  if (!window.supabase) return;
  const db = window.supabase.createClient("https://lrgllzvwgvqagcpiyvfd.supabase.co", "sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP");
  const S = { reports: [], games: [], teams: [], players: [] };
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  const teamById = (id) => S.teams.find((x) => x.id === id);
  const gameById = (id) => S.games.find((x) => x.id === id);
  const fmtDate = (v) => v ? new Date(v).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
  const stat = (obj, key) => Number(obj?.[key] || 0);

  async function load() {
    const [reports, games, teams, players] = await Promise.all([
      db.from("esports_game_reports").select("*").eq("status", "published").order("published_at", { ascending: false }),
      db.from("esports_games").select("*"),
      db.from("esports_teams").select("*").eq("active", true),
      db.from("esports_players").select("*").eq("active", true),
    ]);
    if ([reports, games, teams, players].some((x) => x.error)) return;
    Object.assign(S, { reports: reports.data || [], games: games.data || [], teams: teams.data || [], players: players.data || [] });
    renderList(); renderDetail();
  }

  function renderList() {
    const root = document.getElementById("postgameReportList"); if (!root) return;
    const count = document.getElementById("reportCount"); if (count) count.textContent = `${S.reports.length} REPORT${S.reports.length === 1 ? "" : "S"}`;
    root.innerHTML = S.reports.length ? S.reports.map((r) => {
      const g = gameById(r.game_id), h = teamById(g?.home_team_id), a = teamById(g?.away_team_id);
      return `<a class="report-list-card" href="postgame.html?id=${encodeURIComponent(r.game_id)}"><div><span class="report-badge">POSTGAME REPORT</span><h3>${esc(r.headline || `${h?.name || "Team"} vs ${a?.name || "Team"}`)}</h3><p>${esc(r.subheadline || "Tournament analysis and late-desk recap.")}</p><small>${esc(fmtDate(r.published_at || g?.scheduled_at))}</small></div><div class="report-list-score">${g ? `${g.home_score ?? 0}-${g.away_score ?? 0}` : "FINAL"}</div></a>`;
    }).join("") : '<div class="empty-state">No postgame reports have been published yet.</div>';
  }

  function renderStars(stars) {
    if (!Array.isArray(stars) || !stars.length) return '<div class="empty-state">Three stars were not recorded for this report.</div>';
    return `<div class="three-stars">${stars.slice(0, 3).map((s, i) => `<div class="star-card"><span>${i + 1}${i === 0 ? "ST" : i === 1 ? "ND" : "RD"} STAR</span><strong>${esc(s.gamertag || "Player")}</strong><small>${esc(s.team || "")} · ${stat(s, "goals")}G ${stat(s, "assists")}A ${stat(s, "points")}P</small></div>`).join("")}</div>`;
  }

  function renderKeyStats(keyStats) {
    const h = keyStats?.home, a = keyStats?.away;
    if (!h || !a) return "";
    return `<div class="key-stat-grid"><div class="key-stat"><small>Shots</small><strong>${stat(h, "shots")}-${stat(a, "shots")}</strong></div><div class="key-stat"><small>Hits</small><strong>${stat(h, "hits")}-${stat(a, "hits")}</strong></div><div class="key-stat"><small>Takeaways</small><strong>${stat(h, "takeaways")}-${stat(a, "takeaways")}</strong></div><div class="key-stat"><small>Giveaways</small><strong>${stat(h, "giveaways")}-${stat(a, "giveaways")}</strong></div></div>`;
  }

  function renderDetail() {
    const root = document.getElementById("postgameReportDetail"); if (!root) return;
    const id = new URLSearchParams(location.search).get("id");
    const r = S.reports.find((x) => x.game_id === id);
    if (!r) { root.innerHTML = '<div class="empty-state">This postgame report is not published yet.</div>'; return; }
    const g = gameById(r.game_id), h = teamById(g?.home_team_id), a = teamById(g?.away_team_id);
    document.title = `${r.headline || "Postgame Report"} | Wildman Hockey`;
    root.innerHTML = `<a class="profile-back" href="reports.html">← All Postgame Reports</a><div class="eyebrow">WILDMAN HOCKEY ESPORTS NETWORK · POSTGAME</div><h1>${esc(r.headline || "Postgame Report")}</h1>${r.subheadline ? `<p class="section-note">${esc(r.subheadline)}</p>` : ""}<div class="report-scoreline"><div><strong>${esc(h?.name || "Home")}</strong><small>HOME</small></div><div class="report-score">${g?.home_score ?? 0}-${g?.away_score ?? 0}</div><div><strong>${esc(a?.name || "Away")}</strong><small>AWAY</small></div></div><div class="report-preview-shell" style="margin-top:20px"><section class="report-section"><div class="eyebrow">THE HOCKEY REPORT</div><h2>What decided the game</h2><p>${esc(r.analyst_report || "")}</p></section>${r.turning_point ? `<section class="report-section"><div class="eyebrow">TURNING POINT</div><h2>Where it tilted</h2><p>${esc(r.turning_point)}</p></section>` : ""}<section class="report-section"><div class="eyebrow">THREE STARS</div><h2>Impact players</h2>${renderStars(r.three_stars)}</section>${renderKeyStats(r.key_stats) ? `<section class="report-section"><div class="eyebrow">BY THE NUMBERS</div><h2>Key tracked stats</h2>${renderKeyStats(r.key_stats)}</section>` : ""}${r.desk_banter ? `<section class="report-section"><div class="late-desk"><div class="eyebrow">THE LATE DESK</div><h2>${esc(r.desk_title || "The Late Desk")}</h2><p>${esc(r.desk_banter)}</p></div></section>` : ""}<section class="report-section"><p class="report-source-note">Published ${esc(fmtDate(r.published_at))}.${r.source_url ? " Public LeagueGaming data may have been used as a source and was reviewed before publication." : ""}</p>${r.source_url ? `<p><a class="small-btn" href="${esc(r.source_url)}" target="_blank" rel="noopener">View Public LG Source</a></p>` : ""}</section></div>`;
  }

  load();
})();
