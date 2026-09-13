const rosterCloudStatus = document.getElementById("rosterCloudStatus");
const tradeInbox = document.getElementById("tradeInbox");
const tradeInboxEmpty = document.getElementById("tradeInboxEmpty");
const tradeTeamACloud = document.getElementById("tradeTeamA");
const tradeTeamBCloud = document.getElementById("tradeTeamB");
const applyTradeCloud = document.getElementById("applyTrade");

let connected = false;
let preparing = false;
let cloudPlayersById = new Map();
let cloudPlayersByName = new Map();
let cloudTeamsById = new Map();
let cloudTeamsByName = new Map();
let editableTeamNames = [];

const ui = () => window.VVHLRosterUI;
const backend = () => window.VVHLBackend;

function setCloud(text, tone = "") {
  if (!rosterCloudStatus) return;
  rosterCloudStatus.textContent = text;
  rosterCloudStatus.dataset.tone = tone;
}

function currentState() {
  return backend()?.state || {};
}

function currentDb() {
  return backend()?.db;
}

function isAdmin() {
  return currentState().profile?.role === "admin";
}

function canManageTeamId(teamId) {
  if (!teamId) return false;
  if (isAdmin()) return true;
  return (currentState().memberships || []).some((membership) =>
    membership.active && membership.team_id === teamId && ["owner", "gm", "agm"].includes(membership.role)
  );
}

function canManageTeamName(teamName) {
  return canManageTeamId(cloudTeamsByName.get(teamName)?.id);
}

function buildPlayerMaps(players) {
  cloudPlayersById = new Map();
  cloudPlayersByName = new Map();
  (players || []).forEach((player) => {
    cloudPlayersById.set(player.id, player);
    const key = player.gamertag.trim().toLowerCase();
    if (!cloudPlayersByName.has(key)) cloudPlayersByName.set(key, []);
    cloudPlayersByName.get(key).push(player);
  });
}

function buildTeamMaps(teams) {
  cloudTeamsById = new Map((teams || []).map((team) => [team.id, team]));
  cloudTeamsByName = new Map((teams || []).map((team) => [team.name, team]));
}

function resolvePlayerByName(name) {
  const matches = cloudPlayersByName.get(String(name || "").trim().toLowerCase()) || [];
  return matches.find((player) => player.gamertag === name) || matches[0] || null;
}

function rosterPlayerFromEntry(entry) {
  const player = cloudPlayersById.get(entry.player_id);
  if (!player) return null;
  const position = player.primary_position || "Player";
  return {
    id: entry.id,
    rowId: entry.id,
    key: player.gamertag.trim().toLowerCase(),
    name: player.gamertag,
    playerId: player.id,
    teamId: entry.team_id,
    position,
    type: String(position).toLowerCase().includes("goal") ? "G" : "S",
    draftRound: ui().normalizeRound(entry.draft_round),
    capHit: Number(entry.cap_hit || 0),
    acquiredVia: entry.acquired_via || "draft",
    originalTeamId: entry.original_team_id || entry.team_id,
    rosterRole: entry.roster_role || "active"
  };
}

function getEditableTeamNames() {
  const state = currentState();
  if (state.profile?.role === "admin") return (state.teams || []).map((team) => team.name);
  const allowedIds = new Set((state.memberships || [])
    .filter((membership) => membership.active && ["owner", "gm", "agm"].includes(membership.role))
    .map((membership) => membership.team_id));
  return (state.teams || []).filter((team) => allowedIds.has(team.id)).map((team) => team.name);
}

function configureTradeAccess() {
  editableTeamNames = getEditableTeamNames();
  const allTeams = ui().getTeams();
  const state = currentState();
  const contextName = cloudTeamsById.get(state.teamId)?.name;
  const preferred = editableTeamNames.includes(contextName)
    ? contextName
    : editableTeamNames.includes(ui().getSelectedTeam())
      ? ui().getSelectedTeam()
      : editableTeamNames[0];

  tradeTeamACloud.innerHTML = editableTeamNames.length
    ? editableTeamNames.map((name) => `<option value="${ui().esc(name)}">${ui().esc(name)}</option>`).join("")
    : '<option value="">No managed team</option>';
  tradeTeamACloud.disabled = editableTeamNames.length <= 1;
  if (preferred) tradeTeamACloud.value = preferred;

  tradeTeamBCloud.innerHTML = allTeams.map((name) => `<option value="${ui().esc(name)}">${ui().esc(name)}</option>`).join("");
  if (tradeTeamBCloud.value === tradeTeamACloud.value || !tradeTeamBCloud.value) {
    tradeTeamBCloud.value = allTeams.find((name) => name !== tradeTeamACloud.value) || "";
  }
  tradeTeamBCloud.disabled = !editableTeamNames.length;
  applyTradeCloud.disabled = true;
  ui().renderAll();
}

async function loadOfficialRosters() {
  const db = currentDb();
  const state = currentState();
  const teamIds = (state.teams || []).map((team) => team.id);
  const rosters = Object.fromEntries((state.teams || []).map((team) => [team.name, []]));
  if (!teamIds.length) {
    ui().setOfficialRosters(rosters, editableTeamNames);
    return;
  }

  const { data: entries, error } = await db
    .from("roster_entries")
    .select("id,team_id,player_id,draft_round,cap_hit,roster_role,acquired_via,original_team_id,updated_at")
    .in("team_id", teamIds)
    .order("draft_round", { ascending: true });
  if (error) throw error;

  (entries || []).forEach((entry) => {
    const team = cloudTeamsById.get(entry.team_id);
    const player = rosterPlayerFromEntry(entry);
    if (team && player) rosters[team.name].push(player);
  });
  ui().setOfficialRosters(rosters, editableTeamNames);
}

async function loadCloudReferenceData() {
  const db = currentDb();
  const state = currentState();
  buildTeamMaps(state.teams || []);
  ui().setTeams((state.teams || []).map((team) => team.name));

  const { data: players, error } = await db
    .from("players")
    .select("id,gamertag,primary_position,secondary_position,status,approved")
    .order("gamertag", { ascending: true });
  if (error) throw error;
  buildPlayerMaps(players || []);
  const datalist = document.getElementById("rosterPlayerNames");
  if (datalist) {
    datalist.innerHTML = (players || []).map((player) =>
      `<option value="${ui().esc(player.gamertag)}">${ui().esc(player.primary_position || "Player")}</option>`
    ).join("");
  }
}

function applyContextTeam() {
  const contextName = cloudTeamsById.get(currentState().teamId)?.name;
  if (contextName && ui().getTeams().includes(contextName)) ui().selectTeam(contextName);
}

async function prepareCloud() {
  if (preparing) return;
  preparing = true;
  try {
    const state = currentState();
    if (!state.user) {
      connected = false;
      editableTeamNames = [];
      ui().setOfflineMode();
      tradeTeamACloud.disabled = true;
      tradeTeamBCloud.disabled = true;
      applyTradeCloud.disabled = true;
      tradeInbox.innerHTML = "";
      tradeInboxEmpty.hidden = false;
      tradeInboxEmpty.textContent = "Sign in to view trades involving your team.";
      setCloud("Sign in to load the official shared roster workspace");
      return;
    }

    setCloud("Loading official rosters…");
    await loadCloudReferenceData();
    editableTeamNames = getEditableTeamNames();
    await loadOfficialRosters();
    applyContextTeam();
    connected = true;
    configureTradeAccess();
    await loadTradeInbox();
    setCloud(
      editableTeamNames.length ? "Official shared rosters connected" : "Official rosters connected · awaiting team management assignment",
      editableTeamNames.length ? "success" : "warning"
    );
  } catch (error) {
    connected = false;
    console.error("Roster cloud connection failed", error);
    setCloud(error?.message || "Could not load official roster workspace", "error");
  } finally {
    preparing = false;
  }
}

async function reloadOfficialWorkspace(message = "Official rosters updated") {
  editableTeamNames = getEditableTeamNames();
  await loadOfficialRosters();
  configureTradeAccess();
  await loadTradeInbox();
  setCloud(message, "success");
}

async function addRosterPlayer(teamName, playerName, round) {
  try {
    if (!connected) throw new Error("Sign in to edit official rosters.");
    const db = currentDb();
    const state = currentState();
    const team = cloudTeamsByName.get(teamName);
    const player = resolvePlayerByName(playerName);
    const normalizedRound = ui().normalizeRound(round);
    if (!team || !canManageTeamId(team.id)) throw new Error("You do not manage this team.");
    if (!player) throw new Error("That player was not found in the league player database.");
    if (!normalizedRound) throw new Error("Choose the player's draft round.");

    const existing = Object.entries(ui().getRosters()).find(([, roster]) => roster.some((item) => item.playerId === player.id));
    if (existing) throw new Error(`${player.gamertag} is already rostered by ${existing[0]}. Use the trade workflow to move a rostered player.`);

    setCloud(`Adding ${player.gamertag} to ${teamName}…`);
    const { error } = await db.from("roster_entries").insert({
      team_id: team.id,
      player_id: player.id,
      draft_round: normalizedRound,
      cap_hit: ui().salaryForRound(normalizedRound),
      roster_role: "active",
      acquired_via: "draft",
      original_team_id: team.id,
      created_by: state.user.id,
      updated_by: state.user.id
    });
    if (error) throw error;
    await reloadOfficialWorkspace(`${player.gamertag} added to ${teamName}`);
  } catch (error) {
    setCloud(error.message, "error");
    alert(error.message);
  }
}

async function updateDraftRound(teamName, playerKey, round) {
  try {
    if (!connected) throw new Error("Sign in to edit official rosters.");
    const db = currentDb();
    const state = currentState();
    const team = cloudTeamsByName.get(teamName);
    const player = ui().findRosterPlayer(teamName, playerKey);
    const normalizedRound = ui().normalizeRound(round);
    if (!team || !canManageTeamId(team.id)) throw new Error("You do not manage this team.");
    if (!player?.rowId) throw new Error("Official roster entry not found.");
    if (!normalizedRound) throw new Error("Choose a valid draft round.");

    setCloud(`Updating ${player.name}'s draft value…`);
    const { error } = await db
      .from("roster_entries")
      .update({
        draft_round: normalizedRound,
        cap_hit: ui().salaryForRound(normalizedRound),
        updated_by: state.user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", player.rowId);
    if (error) throw error;
    await reloadOfficialWorkspace(`${player.name}'s cap value updated`);
  } catch (error) {
    setCloud(error.message, "error");
    alert(error.message);
    await loadOfficialRosters().catch(() => {});
  }
}

async function removeRosterPlayer(teamName, playerKey) {
  try {
    if (!connected) throw new Error("Sign in to edit official rosters.");
    const db = currentDb();
    const team = cloudTeamsByName.get(teamName);
    const player = ui().findRosterPlayer(teamName, playerKey);
    if (!team || !canManageTeamId(team.id)) throw new Error("You do not manage this team.");
    if (!player?.rowId) throw new Error("Official roster entry not found.");

    setCloud(`Removing ${player.name}…`);
    const { error } = await db.from("roster_entries").delete().eq("id", player.rowId);
    if (error) throw error;
    await reloadOfficialWorkspace(`${player.name} removed from ${teamName}`);
  } catch (error) {
    setCloud(error.message, "error");
    alert(error.message);
  }
}

async function proposeTrade(trade, note = "") {
  try {
    if (!connected) throw new Error("Sign in to propose an official trade.");
    const db = currentDb();
    const teamA = cloudTeamsByName.get(trade.teamA);
    const teamB = cloudTeamsByName.get(trade.teamB);
    if (!teamA || !teamB || !canManageTeamId(teamA.id)) throw new Error("You can only propose trades for a team you manage.");
    if (!trade.playerA?.playerId || !trade.playerB?.playerId) throw new Error("Both players must be on official rosters before they can be traded.");
    if (trade.overCap) throw new Error("This trade would put a team over the $30M cap.");

    applyTradeCloud.disabled = true;
    applyTradeCloud.textContent = "Submitting…";
    setCloud("Submitting official trade proposal…");
    const fallback = `${trade.playerA.name} (${ui().money(trade.valueA)}) for ${trade.playerB.name} (${ui().money(trade.valueB)})`;
    const { data, error } = await db.rpc("vvhl_submit_trade_proposal", {
      proposing_team: teamA.id,
      receiving_team: teamB.id,
      proposing_player: trade.playerA.playerId,
      receiving_player: trade.playerB.playerId,
      proposal_message: note || fallback
    });
    if (error) throw error;

    document.getElementById("tradeMessage").value = "";
    document.getElementById("tradePlayerA").value = "";
    document.getElementById("tradePlayerB").value = "";
    await loadTradeInbox();
    ui().renderAll();
    setCloud(`Trade proposal ${String(data || "").slice(0, 8)} submitted`, "success");
    applyTradeCloud.textContent = "Proposed ✓";
    setTimeout(() => {
      applyTradeCloud.textContent = "Propose Trade";
      ui().renderAll();
    }, 1600);
  } catch (error) {
    setCloud(error.message, "error");
    alert(error.message);
    applyTradeCloud.textContent = "Propose Trade";
    ui().renderAll();
  }
}

function statusLabel(status) {
  return ({
    proposed: "PROPOSED",
    countered: "COUNTERED",
    accepted: "ACCEPTED · ADMIN REVIEW",
    declined: "DECLINED",
    approved: "APPROVED",
    rejected: "REJECTED",
    cancelled: "CANCELLED",
    admin_review: "ADMIN REVIEW"
  })[status] || String(status || "").toUpperCase();
}

function actionButton(tradeId, action, label, className = "") {
  return `<button class="small-btn ${className}" type="button" data-trade-action="${action}" data-trade-id="${tradeId}">${label}</button>`;
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function renderTradeInbox(trades, items) {
  const state = currentState();
  const itemsByTrade = new Map();
  (items || []).forEach((item) => {
    if (!itemsByTrade.has(item.trade_id)) itemsByTrade.set(item.trade_id, []);
    itemsByTrade.get(item.trade_id).push(item);
  });

  tradeInbox.innerHTML = (trades || []).map((trade) => {
    const proposer = cloudTeamsById.get(trade.proposing_team_id);
    const receiver = cloudTeamsById.get(trade.receiving_team_id);
    const tradeItems = itemsByTrade.get(trade.id) || [];
    const proposerItem = tradeItems.find((item) => item.from_team_id === trade.proposing_team_id);
    const receiverItem = tradeItems.find((item) => item.from_team_id === trade.receiving_team_id);
    const proposerPlayer = proposerItem ? cloudPlayersById.get(proposerItem.player_id) : null;
    const receiverPlayer = receiverItem ? cloudPlayersById.get(receiverItem.player_id) : null;
    const actions = [];
    const receiverManager = canManageTeamId(trade.receiving_team_id);
    const creator = trade.created_by === state.user?.id;

    if (["proposed", "countered"].includes(trade.status) && receiverManager) {
      actions.push(actionButton(trade.id, "accepted", "Accept", "primary"));
      actions.push(actionButton(trade.id, "declined", "Decline"));
    }
    if (["proposed", "countered"].includes(trade.status) && (creator || isAdmin())) {
      actions.push(actionButton(trade.id, "cancelled", "Cancel"));
    }
    if (trade.status === "accepted" && isAdmin()) {
      actions.push(actionButton(trade.id, "approved", "Approve & Apply", "primary"));
      actions.push(actionButton(trade.id, "rejected", "Reject"));
    }

    return `<article class="trade-inbox-card" data-status="${ui().esc(trade.status)}">
      <div class="trade-inbox-top"><div><span class="trade-status">${ui().esc(statusLabel(trade.status))}</span><small>${ui().esc(formatDate(trade.created_at))}</small></div><span class="trade-id">#${trade.id.slice(0, 8)}</span></div>
      <div class="trade-inbox-matchup">
        <div><small>${ui().esc(proposer?.name || "Proposing team")} sends</small><b>${ui().esc(proposerPlayer?.gamertag || proposerItem?.description || "Player")}</b><span>${ui().money(proposerItem?.cap_amount || 0)}</span></div>
        <strong>⇄</strong>
        <div><small>${ui().esc(receiver?.name || "Receiving team")} sends</small><b>${ui().esc(receiverPlayer?.gamertag || receiverItem?.description || "Player")}</b><span>${ui().money(receiverItem?.cap_amount || 0)}</span></div>
      </div>
      ${trade.message ? `<p class="trade-note">${ui().esc(trade.message)}</p>` : ""}
      ${actions.length ? `<div class="trade-inbox-actions">${actions.join("")}</div>` : ""}
    </article>`;
  }).join("");
  tradeInboxEmpty.hidden = Boolean((trades || []).length);
  if (!(trades || []).length) tradeInboxEmpty.textContent = isAdmin() ? "No league trades have been submitted yet." : "No trades involving your team yet.";

  tradeInbox.querySelectorAll("[data-trade-action]").forEach((button) => {
    button.addEventListener("click", () => updateTradeStatus(button.dataset.tradeId, button.dataset.tradeAction, button));
  });
}

async function loadTradeInbox() {
  const db = currentDb();
  const state = currentState();
  if (!state.user) {
    renderTradeInbox([], []);
    return;
  }
  const { data: trades, error } = await db
    .from("trades")
    .select("id,proposing_team_id,receiving_team_id,status,message,created_by,reviewed_by,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const ids = (trades || []).map((trade) => trade.id);
  let items = [];
  if (ids.length) {
    const result = await db
      .from("trade_items")
      .select("id,trade_id,from_team_id,player_id,cap_amount,description")
      .in("trade_id", ids);
    if (result.error) throw result.error;
    items = result.data || [];
  }
  renderTradeInbox(trades || [], items);
}

async function updateTradeStatus(tradeId, status, button) {
  try {
    const db = currentDb();
    if (!connected) throw new Error("Sign in to review trades.");
    const confirmText = status === "approved"
      ? "Approve this trade and apply the roster swap now?"
      : status === "accepted"
        ? "Accept this proposal and send it to league administration?"
        : status === "declined"
          ? "Decline this trade proposal?"
          : status === "rejected"
            ? "Reject this accepted trade?"
            : status === "cancelled"
              ? "Cancel this trade proposal?"
              : "Update this trade?";
    if (!confirm(confirmText)) return;

    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "Saving…";
    setCloud(`Updating trade to ${statusLabel(status).toLowerCase()}…`);
    const { error } = await db.from("trades").update({ status }).eq("id", tradeId);
    if (error) throw error;

    if (status === "approved") {
      await reloadOfficialWorkspace("Trade approved and official rosters updated");
    } else {
      await loadTradeInbox();
      setCloud(`Trade ${statusLabel(status).toLowerCase()}`, "success");
    }
    button.textContent = oldText;
  } catch (error) {
    console.error("Trade status update failed", error);
    setCloud(error.message, "error");
    alert(error.message);
    await loadTradeInbox().catch(() => {});
  }
}

window.VVHLRosterCloud = {
  isConnected: () => connected,
  canManageTeam: canManageTeamName,
  addRosterPlayer,
  updateDraftRound,
  removeRosterPlayer,
  proposeTrade,
  loadTradeInbox,
  reload: prepareCloud
};

tradeTeamACloud.addEventListener("change", () => {
  if (tradeTeamBCloud.value === tradeTeamACloud.value) {
    tradeTeamBCloud.value = ui().getTeams().find((name) => name !== tradeTeamACloud.value) || "";
  }
  ui().renderAll();
});
document.getElementById("refreshTrades")?.addEventListener("click", async () => {
  try {
    setCloud("Refreshing trade inbox…");
    await loadTradeInbox();
    setCloud("Trade inbox refreshed", "success");
  } catch (error) {
    setCloud(error.message, "error");
  }
});

window.addEventListener("vvhl-auth-change", prepareCloud);
setTimeout(() => {
  if (backend()?.state) prepareCloud();
}, 0);
