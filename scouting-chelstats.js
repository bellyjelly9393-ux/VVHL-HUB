(() => {
  const state = { data: null, metric: "shots", username: "", teamname: "", consoleName: "common-gen5", loading: false };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  const num = (value) => Number(value || 0);
  const hasAccess = () => Boolean(window.VVHLManagementGuard?.hasAccess?.(window.VVHLBackend?.state || {}));
  const storageKey = (username) => `vvhl-chelstats-link:${String(username || "").toLowerCase()}`;

  function setStatus(message, tone = "") {
    const el = $("chelstatsStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `chel-status ${tone}`.trim();
  }

  function selectedScoutingGamertag() {
    const title = $("scoutPlayerTitle")?.textContent?.trim();
    if (title && title.toLowerCase() !== "player") return title;
    const select = $("shotPlayerFilter");
    if (select && select.value && select.value !== "all") return select.options[select.selectedIndex]?.textContent?.trim() || "";
    return "";
  }

  function loadSavedLink(username) {
    try {
      const raw = localStorage.getItem(storageKey(username));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveLink(username, teamname, consoleName) {
    try {
      localStorage.setItem(storageKey(username), JSON.stringify({ teamname, consoleName }));
    } catch {}
  }

  function primeInputsFromSelection(autoSync = false) {
    const username = selectedScoutingGamertag();
    if (!username || !$('chelstatsUsername')) return;
    if ($('chelstatsUsername').value !== username) {
      $('chelstatsUsername').value = username;
      const saved = loadSavedLink(username);
      $('chelstatsTeamname').value = saved?.teamname || "";
      $('chelstatsConsole').value = saved?.consoleName || "common-gen5";
      state.data = null;
      render();
      if (autoSync && saved?.teamname) syncChelstats();
    }
  }

  function metricValue(row, totalShots) {
    if (state.metric === "goals") return num(row.goals);
    if (state.metric === "efficiency") return num(row.efficiency);
    if (state.metric === "share") return totalShots ? (num(row.shots) / totalShots) * 100 : 0;
    return num(row.shots);
  }

  function metricLabel(value) {
    return state.metric === "efficiency" || state.metric === "share" ? `${value.toFixed(1)}%` : String(Math.round(value));
  }

  function renderProfile() {
    const el = $("chelstatsProfile");
    if (!el) return;
    if (!state.data) {
      el.innerHTML = "";
      return;
    }
    const p = state.data.profile || {};
    const rows = [
      ["Record", p.record || "—"],
      ["Games", p.gamesPlayed || 0],
      ["Points", p.points || 0],
      ["Shot %", `${num(p.shootingPct).toFixed(1)}%`],
      ["Pass %", `${num(p.passPct).toFixed(1)}%`],
      ["FO %", `${num(p.faceoffPct).toFixed(1)}%`],
      ["Hits / GP", num(p.hitsPerGame).toFixed(2)],
      ["Takeaways / GP", num(p.takeawaysPerGame).toFixed(2)],
      ["Giveaways / GP", num(p.giveawaysPerGame).toFixed(2)],
      ["Blocks / GP", num(p.blockedShotsPerGame).toFixed(2)],
      ["Breakaway %", `${num(p.breakawayPct).toFixed(1)}%`],
      ["Shots / GP", num(p.shotsPerGame).toFixed(2)],
    ];
    el.innerHTML = rows.map(([label, value]) => `<div class="chel-profile-stat"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`).join("");
  }

  function renderMaps() {
    const iceRows = state.data?.ice || [];
    const netRows = state.data?.net || [];
    const totalIceShots = iceRows.reduce((sum, row) => sum + num(row.shots), 0);
    const totalNetShots = netRows.reduce((sum, row) => sum + num(row.shots), 0);
    let iceMax = 0;
    let netMax = 0;
    iceRows.forEach((row) => { iceMax = Math.max(iceMax, metricValue(row, totalIceShots)); });
    netRows.forEach((row) => { netMax = Math.max(netMax, metricValue(row, totalNetShots)); });

    document.querySelectorAll("[data-chel-ice]").forEach((el) => {
      const zone = Number(el.dataset.chelIce);
      const row = iceRows.find((item) => item.zone === zone) || { shots: 0, goals: 0, efficiency: 0 };
      const value = metricValue(row, totalIceShots);
      const ratio = iceMax ? value / iceMax : 0;
      el.style.setProperty("--heat", String(.08 + ratio * .78));
      el.querySelector("strong").textContent = metricLabel(value);
      el.title = `Chelstats Ice Zone ${zone} · ${row.shots} shots · ${row.goals} goals · ${num(row.efficiency).toFixed(1)}%`;
    });

    document.querySelectorAll("[data-chel-net]").forEach((el) => {
      const zone = Number(el.dataset.chelNet);
      const row = netRows.find((item) => item.zone === zone) || { shots: 0, goals: 0, efficiency: 0 };
      const value = metricValue(row, totalNetShots);
      const ratio = netMax ? value / netMax : 0;
      el.style.setProperty("--heat", String(.1 + ratio * .8));
      el.querySelector("strong").textContent = metricLabel(value);
      const small = el.querySelector("small");
      if (small) small.textContent = state.metric === "share" ? `${row.shots} shots` : `${row.goals} G / ${row.shots} S`;
      el.title = `Chelstats Net Zone ${zone} · ${row.shots} shots · ${row.goals} goals · ${num(row.efficiency).toFixed(1)}%`;
    });
  }

  function renderInsights() {
    const el = $("chelstatsInsights");
    if (!el) return;
    if (!state.data) {
      el.innerHTML = `<div class="chel-insight"><b>No Chelstats player loaded yet.</b> Select a scouting player, enter the Chelstats team name if needed, and sync.</div>`;
      return;
    }
    const ice = state.data.ice || [];
    const net = state.data.net || [];
    const hottest = [...ice].sort((a, b) => b.shots - a.shots)[0];
    const efficient = [...ice].filter((row) => row.shots >= 5).sort((a, b) => b.efficiency - a.efficiency)[0];
    const target = [...net].sort((a, b) => b.shots - a.shots)[0];
    const p = state.data.profile || {};
    const notes = [];
    if (hottest) notes.push(`<div class="chel-insight"><b>Primary shooting area:</b> Ice Zone ${hottest.zone} has ${hottest.shots} shots and ${hottest.goals} goals.</div>`);
    if (efficient) notes.push(`<div class="chel-insight"><b>Best finishing zone:</b> Ice Zone ${efficient.zone} converts at ${num(efficient.efficiency).toFixed(1)}% on ${efficient.shots} shots.</div>`);
    if (target) notes.push(`<div class="chel-insight"><b>Preferred net target:</b> Net Zone ${target.zone} receives ${target.shots} shots, the largest share of tracked targets.</div>`);
    if (num(p.hitsPerGame) >= 5) notes.push(`<div class="chel-insight"><b>Physical pressure:</b> ${num(p.hitsPerGame).toFixed(2)} hits per game. Expect contact on entries and recoveries.</div>`);
    if (num(p.faceoffPct) >= 55) notes.push(`<div class="chel-insight"><b>Strong at the dot:</b> ${num(p.faceoffPct).toFixed(1)}% faceoffs. Defensive-zone draw planning matters.</div>`);
    if (num(p.giveawaysPerGame) >= 4) notes.push(`<div class="chel-insight"><b>Pressure opportunity:</b> ${num(p.giveawaysPerGame).toFixed(2)} giveaways per game suggests aggressive pressure can create extra possessions.</div>`);
    el.innerHTML = notes.join("") || `<div class="chel-insight">No strong Chelstats tendency clears the current thresholds.</div>`;
  }

  function render() {
    document.querySelectorAll("[data-chel-metric]").forEach((button) => button.classList.toggle("active", button.dataset.chelMetric === state.metric));
    renderProfile();
    renderMaps();
    renderInsights();
    const pill = $("chelstatsLivePill");
    if (pill) pill.textContent = state.data ? `LIVE FEED · ${state.data.username}` : "CHELSTATS READY";
  }

  async function syncChelstats() {
    if (state.loading || !hasAccess()) return;
    const username = $('chelstatsUsername')?.value.trim();
    const teamname = $('chelstatsTeamname')?.value.trim();
    const consoleName = $('chelstatsConsole')?.value.trim() || "common-gen5";
    if (!username) return setStatus("Choose or enter a Chelstats username first.", "error");
    state.loading = true;
    setStatus(`Loading ${username} from Chelstats…`);
    try {
      const params = new URLSearchParams({ username, console: consoleName });
      if (teamname) params.set("teamname", teamname);
      const response = await fetch(`/api/chelstats-player?${params.toString()}`, { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) {
        const hint = !teamname ? " Try entering the exact Chelstats team name shown on the player's page." : "";
        throw new Error((payload.error || `Chelstats returned ${response.status}`) + hint);
      }
      state.data = payload;
      state.username = username;
      state.teamname = teamname;
      state.consoleName = consoleName;
      saveLink(username, teamname, consoleName);
      render();
      setStatus(`Chelstats synced · ${payload.totals?.iceShots || 0} mapped shots · ${payload.totals?.iceGoals || 0} mapped goals.`, "success");
    } catch (error) {
      state.data = null;
      render();
      setStatus(error.message || "Unable to sync Chelstats.", "error");
    } finally {
      state.loading = false;
    }
  }

  function bind() {
    $('chelstatsSync')?.addEventListener("click", syncChelstats);
    $('chelstatsUseSelected')?.addEventListener("click", () => { primeInputsFromSelection(false); syncChelstats(); });
    document.querySelectorAll("[data-chel-metric]").forEach((button) => button.addEventListener("click", () => { state.metric = button.dataset.chelMetric; render(); }));
    $('shotPlayerFilter')?.addEventListener("change", () => primeInputsFromSelection(true));
    $('scoutPlayerList')?.addEventListener("click", () => setTimeout(() => primeInputsFromSelection(true), 0));

    const title = $('scoutPlayerTitle');
    if (title) {
      new MutationObserver(() => primeInputsFromSelection(true)).observe(title, { childList: true, characterData: true, subtree: true });
    }
  }

  function init() {
    if (!$('chelstatsAutoPanel')) return;
    bind();
    primeInputsFromSelection(false);
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
  window.addEventListener("vvhl-auth-change", () => setTimeout(init, 0));
})();
