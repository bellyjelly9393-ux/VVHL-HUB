const WILDMAN_PRIMARY_ADMIN_ID = "86ff218f-c551-49bb-83b2-d75d5f70d4cb";
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
  const primaryAdmin = state.user?.id === WILDMAN_PRIMARY_ADMIN_ID && state.profile?.role === "admin";
  document.querySelectorAll("[data-primary-admin-only]").forEach((el) => {
    el.hidden = !primaryAdmin;
  });
  if (!primaryAdmin) {
    if (section) section.hidden = true;
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
    `<p class="section-note"><strong>Primary owner only.</strong> Assign management roles, team access and temporary passwords here. This section is hidden from every other management account.</p>${(
      profiles || []
    )
      .map((p) => {
        const membership = (memberships || []).find(
          (m) => m.user_id === p.id && m.active,
        );
        return `<div class="account-row"><div><b>${safe(p.display_name || "Unnamed account")}</b><small>${safe(p.discord_handle || "No Discord handle")}</small></div><select class="select-field" data-profile-role="${p.id}">${roleOptions.map((r) => `<option ${r === p.role ? "selected" : ""}>${r}</option>`).join("")}</select><select class="select-field" data-profile-team="${p.id}"><option value="">No team</option>${state.teams.map((t) => `<option value="${t.id}" ${membership?.team_id === t.id ? "selected" : ""}>${safe(t.name)}</option>`).join("")}</select><button class="small-btn" type="button" data-temp-password="${p.id}" data-temp-name="${safe(p.display_name || "this user")}">Set Temp Password</button><span class="account-save" id="save-${p.id}"></span></div>`;
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
  document
    .querySelectorAll("[data-temp-password]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        setTemporaryPassword(el.dataset.tempPassword, el.dataset.tempName),
      ),
    );
}

function makeTemporaryPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return "W7" + Array.from(bytes, (n) => chars[n % chars.length]).join("");
}

async function setTemporaryPassword(userId, displayName) {
  const { db } = window.VVHLBackend;
  const suggested = makeTemporaryPassword();
  const password = window.prompt(
    `Set a temporary password for ${displayName || "this user"}.\n\nGive this password to them privately. They can sign in immediately with email + password.\n\nTemporary password:`,
    suggested,
  );
  if (password === null) return;
  if (password.length < 10) {
    window.alert("Use at least 10 characters for the temporary password.");
    return;
  }

  const status = document.getElementById(`save-${userId}`);
  if (status) status.textContent = "Setting password…";

  const { data, error } = await db.functions.invoke("admin-set-user-password", {
    body: { userId, password },
  });

  const problem = error || data?.error;
  if (problem) {
    if (status) status.textContent = problem.message || String(problem);
    return;
  }

  if (status) status.textContent = "Temp password set ✓";
  try {
    await navigator.clipboard.writeText(password);
    window.alert(
      `Temporary password set for ${displayName || "the user"}.\n\n${password}\n\nIt has also been copied to your clipboard. Send it privately. Their existing roles and team access were not changed.`,
    );
  } catch {
    window.alert(
      `Temporary password set for ${displayName || "the user"}.\n\n${password}\n\nSend it privately. Their existing roles and team access were not changed.`,
    );
  }
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
