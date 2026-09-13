const adminData = Array.isArray(window.VVHL_PLAYERS) ? window.VVHL_PLAYERS : [];
const count = document.getElementById("adminPlayerCount");
if (count) count.textContent = adminData.length;
const notes = document.getElementById("adminNotes");
if (notes) {
  notes.value = localStorage.getItem("vvhl-admin-notes") || "";
  notes.addEventListener("input", () =>
    localStorage.setItem("vvhl-admin-notes", notes.value),
  );
}

const safe = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function renderAccountManager() {
  const { db, state } = window.VVHLBackend;
  const section = document.getElementById("accountManager");
  if (!state.user || state.profile?.role !== "admin") {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const [{ data: profiles, error }, { data: memberships }] = await Promise.all([
    db
      .from("profiles")
      .select("id,display_name,discord_handle,role,created_at")
      .order("created_at"),
    db.from("team_memberships").select("id,user_id,team_id,role,active"),
  ]);
  if (error) {
    document.getElementById("accountList").textContent = error.message;
    return;
  }
  const roleOptions = ["player", "scout", "agm", "gm", "owner", "admin"];
  document.getElementById("accountList").innerHTML =
    `<p class="section-note">Assign each management account a role and team. Changes take effect after refresh.</p>${(
      profiles || []
    )
      .map((p) => {
        const membership = (memberships || []).find(
          (m) => m.user_id === p.id && m.active,
        );
        return `<div class="account-row"><div><b>${safe(p.display_name || "Unnamed account")}</b><small>${safe(p.discord_handle || "No Discord handle")}</small></div><select class="select-field" data-profile-role="${p.id}">${roleOptions.map((r) => `<option ${r === p.role ? "selected" : ""}>${r}</option>`).join("")}</select><select class="select-field" data-profile-team="${p.id}"><option value="">No team</option>${state.teams.map((t) => `<option value="${t.id}" ${membership?.team_id === t.id ? "selected" : ""}>${safe(t.name)}</option>`).join("")}</select><span class="account-save" id="save-${p.id}"></span></div>`;
      })
      .join("")}`;
  document
    .querySelectorAll("[data-profile-role]")
    .forEach((el) =>
      el.addEventListener("change", () => saveAccount(el.dataset.profileRole)),
    );
  document
    .querySelectorAll("[data-profile-team]")
    .forEach((el) =>
      el.addEventListener("change", () => saveAccount(el.dataset.profileTeam)),
    );
}
async function saveAccount(userId) {
  const { db } = window.VVHLBackend,
    role = document.querySelector(`[data-profile-role="${userId}"]`).value,
    teamId = document.querySelector(`[data-profile-team="${userId}"]`).value,
    status = document.getElementById(`save-${userId}`);
  status.textContent = "Saving…";
  const profileResult = await db
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  await db.from("team_memberships").delete().eq("user_id", userId);
  let membershipError = null;
  if (teamId && ["scout", "agm", "gm", "owner"].includes(role)) {
    const result = await db
      .from("team_memberships")
      .insert({ user_id: userId, team_id: teamId, role, active: true });
    membershipError = result.error;
  }
  status.textContent =
    profileResult.error || membershipError
      ? (profileResult.error || membershipError).message
      : "Saved ✓";
}
window.addEventListener("vvhl-auth-change", renderAccountManager);
