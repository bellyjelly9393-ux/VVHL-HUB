(() => {
  function ensurePresentationLayer(){
    document.body?.classList.add('wm-ds');
    if(!document.querySelector('link[href*="network-v2.css"]')){
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href='network-v2.css?v=20260920a';
      document.head.appendChild(link);
    }
    if(!document.querySelector('script[src*="ui-polish.js"]')){
      const s=document.createElement('script');
      s.src='ui-polish.js?v=20260920a';
      s.async=false;
      document.head.appendChild(s);
    }
  }
  ensurePresentationLayer();

  const managementRoles = new Set(["owner", "gm", "agm"]);
  const HITMEN_TEAM_ID = "b0bcbdda-da9d-419d-8f61-b34937966d49";

  function hasManagementAccess(state) {
    if (!state?.user) return false;
    const profileRole = String(state.profile?.role || "").toLowerCase();
    if (profileRole === "admin" || profileRole === "commissioner") return true;

    const page = (location.pathname.split("/").pop() || "").toLowerCase();
    const hitmenPage = ["hitmen","hitmen-workspace.html","hitmen-management.html","hitmen-locker-room.html","hitmen-battle-plan.html","hitmen-card-vault.html"].includes(page);

    return (state.memberships || []).some((membership) => {
      const role = String(membership.role || "").toLowerCase();
      if (membership.active === false || !managementRoles.has(role)) return false;
      return hitmenPage ? membership.team_id === HITMEN_TEAM_ID : true;
    });
  }

  function renderManagementAccess(state = window.VVHLBackend?.state || {}) {
    const allowed = hasManagementAccess(state);
    const protectedSections = document.querySelectorAll("[data-management-content]");
    const lockedMessage = document.getElementById("managementLockedMessage");
    const accessStatus = document.getElementById("managementAccessStatus");
    const page = (location.pathname.split("/").pop() || "").toLowerCase();
    const hitmenPage = ["hitmen","hitmen-workspace.html","hitmen-management.html","hitmen-locker-room.html","hitmen-battle-plan.html","hitmen-card-vault.html"].includes(page);

    protectedSections.forEach((section) => {
      section.hidden = !allowed;
    });

    if (lockedMessage) {
      lockedMessage.hidden = allowed;
      if (!state.user) {
        lockedMessage.innerHTML =
          "<b>Management sign-in required.</b><p>This workspace is restricted to authorized management accounts.</p>";
      } else if (hitmenPage) {
        lockedMessage.innerHTML =
          "<b>Calgary Hitmen access not assigned.</b><p>Your account is signed in, but it does not currently have an active Owner, GM or AGM membership for the Calgary Hitmen.</p>";
      } else {
        lockedMessage.innerHTML =
          "<b>Management access not assigned.</b><p>Your account is signed in, but it is not currently assigned an Owner, GM, AGM, Commissioner or Admin role.</p>";
      }
    }

    if (accessStatus) {
      if (allowed) {
        const hitmenMembership = (state.memberships || []).find(
          (m) => m.team_id === HITMEN_TEAM_ID && m.active !== false,
        );
        const role = String(
          state.profile?.role === "admin"
            ? "admin"
            : hitmenPage
              ? hitmenMembership?.role || "management"
              : state.profile?.role || state.memberships?.[0]?.role || "management",
        ).toUpperCase();
        accessStatus.textContent = `AUTHORIZED · ${role}`;
      } else {
        accessStatus.textContent = state.user ? "SIGNED IN · ACCESS RESTRICTED" : "PRIVATE · MANAGEMENT ONLY";
      }
    }

    document.body.classList.toggle("management-authorized", allowed);

    const isAdmin = Boolean(state?.user && state.profile?.role === "admin");
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
      el.hidden = !isAdmin;
    });
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
