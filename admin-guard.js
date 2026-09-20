(() => {
  function renderAdminAccess(state = window.VVHLBackend?.state || {}) {
    const allowed = Boolean(state.user && state.profile?.role === "admin");
    document.querySelectorAll("[data-admin-content]").forEach((section) => {
      section.hidden = !allowed;
    });
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
      el.hidden = !allowed;
    });

    const locked = document.getElementById("adminLockedMessage");
    const status = document.getElementById("adminAccessStatus");

    if (locked) {
      locked.hidden = allowed;
      locked.innerHTML = !state.user
        ? "<b>Admin sign-in required.</b><p>Use the account panel above. Only Wildman accounts with the Admin role can open this console.</p>"
        : "<b>Admin role required.</b><p>Your account is signed in, but it does not have Wildman Admin permission.</p>";
    }

    if (status) {
      status.textContent = allowed
        ? "AUTHORIZED · ADMIN"
        : state.user
          ? "SIGNED IN · ADMIN REQUIRED"
          : "PRIVATE · ADMIN ONLY";
    }

    document.body.classList.toggle("admin-authorized", allowed);
  }

  window.WildmanAdminGuard = { render: renderAdminAccess };

  window.addEventListener("vvhl-auth-change", (event) => {
    renderAdminAccess(event.detail);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => renderAdminAccess());
  } else {
    renderAdminAccess();
  }
})();