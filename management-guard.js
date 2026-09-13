(() => {
  const managementRoles = new Set(["owner", "gm", "agm"]);

  function hasManagementAccess(state) {
    if (!state?.user) return false;
    const profileRole = String(state.profile?.role || "").toLowerCase();
    if (profileRole === "admin" || profileRole === "commissioner") return true;
    return (state.memberships || []).some(
      (membership) => membership.active !== false && managementRoles.has(String(membership.role || "").toLowerCase()),
    );
  }

  function renderManagementAccess(state = window.VVHLBackend?.state || {}) {
    const allowed = hasManagementAccess(state);
    const protectedSections = document.querySelectorAll("[data-management-content]");
    const lockedMessage = document.getElementById("managementLockedMessage");
    const accessStatus = document.getElementById("managementAccessStatus");

    protectedSections.forEach((section) => {
      section.hidden = !allowed;
    });

    if (lockedMessage) {
      lockedMessage.hidden = allowed;
      if (!state.user) {
        lockedMessage.innerHTML =
          "<b>Management sign-in required.</b><p>Scouting, opponent tendencies, lineup recommendations and film-room notes are restricted to authorized Wildman/VVHL management.</p>";
      } else {
        lockedMessage.innerHTML =
          "<b>Management access not assigned.</b><p>Your account is signed in, but it is not currently assigned an Owner, GM, AGM, Commissioner or Admin role.</p>";
      }
    }

    if (accessStatus) {
      if (allowed) {
        const role = String(state.profile?.role || state.memberships?.[0]?.role || "management").toUpperCase();
        accessStatus.textContent = `AUTHORIZED · ${role}`;
      } else {
        accessStatus.textContent = state.user ? "SIGNED IN · ACCESS RESTRICTED" : "PRIVATE · MANAGEMENT ONLY";
      }
    }

    document.body.classList.toggle("management-authorized", allowed);
  }

  window.VVHLManagementGuard = {
    hasAccess: hasManagementAccess,
    render: renderManagementAccess,
  };

  window.addEventListener("vvhl-auth-change", (event) => {
    renderManagementAccess(event.detail);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => renderManagementAccess());
  } else {
    renderManagementAccess();
  }
})();
