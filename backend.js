const VVHL_SUPABASE_URL = "https://lrgllzvwgvqagcpiyvfd.supabase.co";
const VVHL_SUPABASE_KEY = "sb_publishable_9GD6JhLzUGgoPNtahx7eQQ_JDARGIaP";
const vvhlDb = window.supabase.createClient(
  VVHL_SUPABASE_URL,
  VVHL_SUPABASE_KEY,
);

const backendState = {
  user: null,
  profile: null,
  teams: [],
  memberships: [],
  teamId: localStorage.getItem("vvhl-team-context") || "",
};
const emitBackend = () =>
  window.dispatchEvent(
    new CustomEvent("vvhl-auth-change", { detail: backendState }),
  );

async function loadBackendState() {
  const {
    data: { user },
  } = await vvhlDb.auth.getUser();
  backendState.user = user || null;
  backendState.profile = null;
  backendState.memberships = [];
  const { data: teams } = await vvhlDb
    .from("teams")
    .select("id,name,logo_url,league_id")
    .eq("active", true)
    .order("name");
  backendState.teams = teams || [];
  if (user) {
    // Automatically claim any active team invite tied to this signed-in email
    // before loading memberships, so access appears immediately after login.
    try {
      await vvhlDb.rpc("claim_my_team_invite");
    } catch (error) {
      console.warn("Could not auto-claim team invite", error);
    }
    const [{ data: profile }, { data: memberships }] = await Promise.all([
      vvhlDb
        .from("profiles")
        .select("id,display_name,role")
        .eq("id", user.id)
        .maybeSingle(),
      vvhlDb
        .from("team_memberships")
        .select("team_id,role,active,teams(name)")
        .eq("user_id", user.id)
        .eq("active", true),
    ]);
    backendState.profile = profile;
    backendState.memberships = memberships || [];
    const allowed =
      profile?.role === "admin"
        ? backendState.teams
        : backendState.teams.filter((t) =>
            backendState.memberships.some((m) => m.team_id === t.id),
          );
    if (!allowed.some((t) => t.id === backendState.teamId)) {
      const preferredTeam = allowed.find((t) => t.name === "Wildman Hockey") || allowed[0];
      backendState.teamId = preferredTeam?.id || "";
    }
    if (backendState.teamId)
      localStorage.setItem("vvhl-team-context", backendState.teamId);
  }
  renderAccountPanel();
  emitBackend();
}

function renderAccountPanel() {
  const panel = document.getElementById("accountPanel");
  if (!panel) return;
  if (!backendState.user) {
    const signupPage = document.body.classList.contains("signup-page");
    panel.innerHTML = signupPage
      ? `<div><div class="eyebrow">JOIN THE WILDMAN NETWORK</div><h3>Create Your Account</h3><p>Create one Wildman account for tournaments, Academy access, player tools and any management permissions you are assigned later.</p></div><div class="account-form"><input id="authEmail" class="field" type="email" placeholder="Email" autocomplete="email"><input id="authPassword" class="field" type="password" placeholder="Password · 6+ characters" autocomplete="new-password"><button id="signUp" class="small-btn primary" type="button">Create Account</button><button id="signIn" class="small-btn" type="button">Already Have an Account? Sign In</button><button id="magicLink" class="small-btn" type="button">Email Me a Sign-In Link</button><button id="resetPassword" class="small-btn" type="button">Reset Password</button><span id="authMessage"></span></div>`
      : `<div><div class="eyebrow">SECURE WILDMAN ACCESS</div><h3>Management Sign In</h3><p>Sign in to access any Wildman Hockey, Calgary Hitmen or tournament-management tools assigned to your account.</p></div><div class="account-form"><input id="authEmail" class="field" type="email" placeholder="Email" autocomplete="email"><input id="authPassword" class="field" type="password" placeholder="Password" autocomplete="current-password"><button id="signIn" class="small-btn primary" type="button">Sign In</button><button id="magicLink" class="small-btn" type="button">Email Me a Sign-In Link</button><a class="small-btn" href="signup.html">Create Account</a><button id="resetPassword" class="small-btn" type="button">Reset Password</button><span id="authMessage"></span></div>`;
    document.getElementById("signIn")?.addEventListener("click", () => authenticate("signin"));
    document.getElementById("magicLink")?.addEventListener("click", sendMagicLink);
    document.getElementById("signUp")?.addEventListener("click", () => authenticate("signup"));
    document.getElementById("resetPassword")?.addEventListener("click", resetPassword);
    return;
  }
  const allowed =
    backendState.profile?.role === "admin"
      ? backendState.teams
      : backendState.teams.filter((t) =>
          backendState.memberships.some((m) => m.team_id === t.id),
        );
  panel.innerHTML = `<div><div class="eyebrow">SIGNED IN</div><h3>${backendState.profile?.display_name || backendState.user.email}</h3><p>${backendState.profile?.role || "pending"} access</p></div><div class="account-form"><select id="teamContext" class="select-field" ${allowed.length ? "" : "disabled"}>${allowed.length ? allowed.map((t) => `<option value="${t.id}" ${t.id === backendState.teamId ? "selected" : ""}>${t.name}</option>`).join("") : "<option>Awaiting team assignment</option>"}</select><button id="signOut" class="small-btn" type="button">Sign Out</button></div>`;
  document.getElementById("signOut").onclick = async () => {
    await vvhlDb.auth.signOut();
    await loadBackendState();
  };
  document.getElementById("teamContext")?.addEventListener("change", (e) => {
    backendState.teamId = e.target.value;
    localStorage.setItem("vvhl-team-context", backendState.teamId);
    emitBackend();
  });
}

async function authenticate(mode) {
  const email = document.getElementById("authEmail").value.trim(),
    password = document.getElementById("authPassword").value,
    message = document.getElementById("authMessage");
  if (!email || password.length < 6) {
    message.textContent = "Enter an email and at least 6 characters.";
    return;
  }
  message.textContent = "Working…";
  const result =
    mode === "signup"
      ? await vvhlDb.auth.signUp({ email, password })
      : await vvhlDb.auth.signInWithPassword({ email, password });
  message.textContent = result.error
    ? result.error.message
    : mode === "signup" && !result.data.session
      ? "Check your email to confirm the account."
      : "Signed in.";
  if (!result.error && result.data.session) await loadBackendState();
}


async function sendMagicLink() {
  const email = document.getElementById("authEmail").value.trim();
  const message = document.getElementById("authMessage");
  if (!email) {
    message.textContent = "Enter your email first.";
    return;
  }
  message.textContent = "Sending sign-in link…";
  const { error } = await vvhlDb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${location.origin}${location.pathname}`,
      shouldCreateUser: true,
    },
  });
  message.textContent = error
    ? error.message
    : "Sign-in link sent. Check your inbox and spam folder.";
}

async function resetPassword() {
  const email = document.getElementById("authEmail").value.trim();
  const message = document.getElementById("authMessage");
  if (!email) {
    message.textContent = "Enter your admin email first.";
    return;
  }
  message.textContent = "Sending reset link…";
  const { error } = await vvhlDb.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}${location.pathname}`,
  });
  message.textContent = error
    ? error.message
    : "Password-reset email sent. Check your inbox and spam folder.";
}

function showPasswordRecovery() {
  const panel = document.getElementById("accountPanel");
  if (!panel) return;
  panel.innerHTML = `<div><div class="eyebrow">ACCOUNT RECOVERY</div><h3>Choose a New Password</h3><p>Use at least eight characters.</p></div><div class="account-form"><input id="newPassword" class="field" type="password" minlength="8" placeholder="New password"><button id="savePassword" class="small-btn primary" type="button">Save Password</button><span id="authMessage"></span></div>`;
  document.getElementById("savePassword").onclick = async () => {
    const password = document.getElementById("newPassword").value,
      message = document.getElementById("authMessage");
    if (password.length < 8) {
      message.textContent = "Use at least eight characters.";
      return;
    }
    const { error } = await vvhlDb.auth.updateUser({ password });
    message.textContent = error
      ? error.message
      : "Password updated. You are now signed in.";
    if (!error) setTimeout(loadBackendState, 600);
  };
}

window.VVHLBackend = {
  db: vvhlDb,
  state: backendState,
  refresh: loadBackendState,
};
vvhlDb.auth.onAuthStateChange((event) =>
  event === "PASSWORD_RECOVERY"
    ? setTimeout(showPasswordRecovery, 0)
    : setTimeout(loadBackendState, 0),
);
loadBackendState();
