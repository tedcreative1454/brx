(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { PENDING_KEY, TURNSTILE_SITE_KEY } = window.BRX.config;
  const { requestJson } = window.BRX.api;
  const { users, saveUsers, setSession } = window.BRX.state;
  const { refs, showError, showToast } = window.BRX.ui;
  const { hashPassword, normalizeEmail } = window.BRX.utils;
  let pendingLoginChallenge = null;
  const turnstileWidgets = {};
  const turnstileRenderAttempts = {};
  window.addEventListener("brx:turnstile-ready", renderVisibleTurnstiles);

  function renderRegister() {
    refs.app.innerHTML = `
      <section class="auth-page">
        <form class="auth-card" id="registerForm" novalidate>
          <div class="auth-title">
            <a class="auth-logo" href="#/"><img src="./assets/brx-logo-transparent.png" alt="BRX" /></a>
            <h1>Create account</h1>
            <p class="muted">Verified traders. BRX-secured escrow.</p>
          </div>

          <label class="form-field"><span>Email</span><input id="registerEmail" type="email" autocomplete="email" placeholder="you@example.com" required /></label>
          <label class="form-field"><span>Password</span><input id="registerPassword" type="password" autocomplete="new-password" placeholder="Create a strong password" required /></label>
          <label class="form-field"><span>Confirm password</span><input id="registerConfirm" type="password" autocomplete="new-password" placeholder="Repeat your password" required /></label>
          <label class="form-field"><span>Referral code</span><input id="registerReferral" placeholder="Optional" /></label>

          <label class="check-row"><input id="registerTerms" type="checkbox" /><span>I am at least <strong>18 years old</strong> and agree to BRX escrow terms.</span></label>
          ${turnstileMarkup("registerTurnstile")}
          <div class="form-error" id="formError"></div>
          <button class="primary-button full" type="submit">Create account -></button>
          <div class="oauth-divider"><span>or</span></div>
          <button class="google-auth-button" type="button" id="googleRegister">${googleLogo()}Continue with Google</button>
          <p class="auth-footer">Already have an account? <a class="text-link" href="#/login">Login</a></p>
        </form>
      </section>
    `;
    document.querySelector("#registerForm").addEventListener("submit", handleRegister);
    document.querySelector("#googleRegister").addEventListener("click", handleGoogleAuth);
    renderTurnstile("registerTurnstile");
  }

  function renderVerify() {
    const pendingEmail = localStorage.getItem(PENDING_KEY);
    const user = users().find((item) => item.email === pendingEmail);
    if (!user) {
      refs.app.innerHTML = `<section class="auth-page"><div class="auth-card"><h1>Email verification</h1><p class="muted">No account is waiting for verification.</p><a class="primary-button full" href="#/register">Create account</a></div></section>`;
      return;
    }

    refs.app.innerHTML = `
      <section class="auth-page">
        <form class="auth-card" id="verifyForm" novalidate>
          <div class="auth-title">
            <a class="auth-logo" href="#/"><img src="./assets/brx-logo-transparent.png" alt="BRX" /></a>
            <h1>Verify your email</h1>
            <p class="muted">Enter the six-digit code for ${user.email}.</p>
          </div>
          <div class="verify-code"><span>Email verification</span><p class="muted">We sent a six-digit verification code to your email. BRX uses this step before wallet access.</p></div>
          <label class="form-field"><span>Verification code</span><input id="verificationCode" inputmode="numeric" maxlength="6" placeholder="code" required /></label>
          <div class="form-error" id="formError"></div>
          <button class="primary-button full" type="submit">Verify email</button>
          <button class="secondary-button full" type="button" id="resendCode">Resend code</button>
        </form>
      </section>
    `;
    document.querySelector("#verifyForm").addEventListener("submit", handleVerify);
    document.querySelector("#resendCode").addEventListener("click", resendCode);
  }

  function renderLogin() {
    pendingLoginChallenge = null;
    refs.app.innerHTML = `
      <section class="auth-page">
        <form class="auth-card" id="loginForm" novalidate>
          <div class="auth-title">
            <a class="auth-logo" href="#/"><img src="./assets/brx-logo-transparent.png" alt="BRX" /></a>
            <h1>Login</h1>
            <p class="muted">Continue to your BRX wallet and market.</p>
          </div>
          <label class="form-field"><span>Email</span><input id="loginEmail" type="email" autocomplete="email" placeholder="you@example.com" required /></label>
          <label class="form-field"><span>Password</span><input id="loginPassword" type="password" autocomplete="current-password" placeholder="Your password" required /></label>
          ${turnstileMarkup("loginTurnstile")}
          <div class="form-error" id="formError"></div>
          <button class="primary-button full" type="submit">Login</button>
          <div class="oauth-divider"><span>or</span></div>
          <button class="google-auth-button" type="button" id="googleLogin">${googleLogo()}Continue with Google</button>
          <p class="auth-footer">New to BRX? <a class="text-link" href="#/register">Create account</a></p>
        </form>
      </section>
    `;
    document.querySelector("#loginForm").addEventListener("submit", handleLogin);
    document.querySelector("#googleLogin").addEventListener("click", handleGoogleAuth);
    renderTurnstile("loginTurnstile");
    const googleError = window.BRX.router.routeParams().get("googleError");
    if (googleError) showError(googleError);
  }

  function renderTwoFactorLogin(email) {
    refs.app.innerHTML = `
      <section class="auth-page">
        <form class="auth-card" id="loginTwoFactorForm" novalidate>
          <div class="auth-title">
            <a class="auth-logo" href="#/"><img src="./assets/brx-logo-transparent.png" alt="BRX" /></a>
            <h1>Two-step verification</h1>
            <p class="muted">Enter the six-digit code from your authenticator app.</p>
          </div>
          <div class="verify-code">
            <span>${escapeHtml(email)}</span>
            <p class="muted">Your password is correct. BRX needs your authenticator code to finish sign-in.</p>
          </div>
          <label class="form-field"><span>Authenticator code</span><input id="loginTwoFactor" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="code" required autofocus /></label>
          ${turnstileMarkup("loginTwoFactorTurnstile")}
          <div class="form-error" id="formError"></div>
          <button class="primary-button full" type="submit">Verify and login</button>
          <button class="secondary-button full" type="button" id="backToLogin">Back</button>
        </form>
      </section>
    `;
    document.querySelector("#loginTwoFactorForm").addEventListener("submit", handleLoginTwoFactor);
    document.querySelector("#backToLogin").addEventListener("click", renderLogin);
    document.querySelector("#loginTwoFactor")?.focus();
    renderTurnstile("loginTwoFactorTurnstile");
  }

  function renderOAuthCallback() {
    refs.app.innerHTML = `
      <section class="auth-page">
        <div class="auth-card">
          <div class="auth-title">
            <a class="auth-logo" href="#/"><img src="./assets/brx-logo-transparent.png" alt="BRX" /></a>
            <h1>Signing you in</h1>
            <p class="muted">Finishing Google account verification.</p>
          </div>
          <div class="form-error" id="formError"></div>
        </div>
      </section>
    `;
    void finishGoogleAuth();
  }

  function renderGoogleTwoFactor(ticket) {
    refs.app.innerHTML = `
      <section class="auth-page">
        <form class="auth-card" id="googleTwoFactorForm" novalidate>
          <div class="auth-title">
            <a class="auth-logo" href="#/"><img src="./assets/brx-logo-transparent.png" alt="BRX" /></a>
            <h1>Two-step verification</h1>
            <p class="muted">Google verified your account. Enter your authenticator code to finish sign-in.</p>
          </div>
          <label class="form-field"><span>Authenticator code</span><input id="googleTwoFactor" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="code" required autofocus /></label>
          <div class="form-error" id="formError"></div>
          <button class="primary-button full" type="submit">Verify and login</button>
          <a class="secondary-button full" href="#/login">Back to login</a>
        </form>
      </section>
    `;
    document.querySelector("#googleTwoFactorForm").addEventListener("submit", (event) => handleGoogleTwoFactor(event, ticket));
    document.querySelector("#googleTwoFactor")?.focus();
  }

  async function handleRegister(event) {
    event.preventDefault();
    showError("");

    const email = normalizeEmail(document.querySelector("#registerEmail").value);
    const password = document.querySelector("#registerPassword").value;
    const confirm = document.querySelector("#registerConfirm").value;
    const terms = document.querySelector("#registerTerms").checked;

    if (!/^\S+@\S+\.\S+$/.test(email)) return showError("Enter a valid email address.");
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return showError("Password must be at least 8 characters and include a letter and number.");
    if (password !== confirm) return showError("Passwords do not match.");
    if (!terms) return showError("You must accept the BRX escrow terms.");
    const turnstileToken = turnstileTokenFor("registerTurnstile");
    if (turnstileToken === null) return;

    const nextUsers = users();
    const existingIndex = nextUsers.findIndex((user) => user.email === email);
    if (existingIndex >= 0 && nextUsers[existingIndex].emailVerified) {
      return showError("An account with this email already exists. Login instead.");
    }

    try {
      await requestJson("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password, turnstileToken }),
      });
    } catch (error) {
      resetTurnstile("registerTurnstile");
      return showError(error.message || "Could not send verification email.");
    }

    const newUser = {
      id: existingIndex >= 0 ? nextUsers[existingIndex].id : `BRX-${Date.now().toString().slice(-6)}`,
      email,
      passwordHash: await hashPassword(password),
      emailVerified: false,
      kycStatus: "unsubmitted",
      depositAddress: existingIndex >= 0 ? nextUsers[existingIndex].depositAddress || "" : "",
      createdAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) nextUsers[existingIndex] = { ...nextUsers[existingIndex], ...newUser };
    else nextUsers.push(newUser);
    saveUsers(nextUsers);
    localStorage.setItem(PENDING_KEY, email);
    showToast("Verification code sent.");
    location.hash = "#/verify";
  }

  async function handleLogin(event) {
    event.preventDefault();
    showError("");
    const email = normalizeEmail(document.querySelector("#loginEmail").value);
    const password = document.querySelector("#loginPassword").value;
    const turnstileToken = turnstileTokenFor("loginTurnstile");
    if (turnstileToken === null) return;

    let loginResult;
    try {
      loginResult = await requestJson("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, turnstileToken }),
      });
    } catch (error) {
      if (error.code === "two_factor_required") {
        pendingLoginChallenge = { email, password };
        renderTwoFactorLogin(email);
        return;
      }
      if (String(error.message).toLowerCase().includes("verify")) {
        localStorage.setItem(PENDING_KEY, email);
        showToast("Verify your email to continue.");
        location.hash = "#/verify";
        return;
      }
      resetTurnstile("loginTurnstile");
      return showError(error.message || "Incorrect email or password.");
    }

    const localUser = await cacheAuthenticatedUser(loginResult.user, password);
    if (!localUser.emailVerified) {
      localStorage.setItem(PENDING_KEY, email);
      showToast("Verify your email to continue.");
      location.hash = "#/verify";
      return;
    }

    await persistSession(localUser, loginResult.accessToken || "");
    showToast("Signed in");
    location.hash = "#/dashboard";
  }

  async function handleLoginTwoFactor(event) {
    event.preventDefault();
    showError("");
    if (!pendingLoginChallenge) {
      showToast("Login again.");
      renderLogin();
      return;
    }
    const twoFactorCode = document.querySelector("#loginTwoFactor").value.trim();
    if (!/^\d{6}$/.test(twoFactorCode)) return showError("Enter the six-digit authenticator code.");
    const turnstileToken = turnstileTokenFor("loginTwoFactorTurnstile");
    if (turnstileToken === null) return;

    let loginResult;
    try {
      loginResult = await requestJson("/auth/login", {
        method: "POST",
        body: JSON.stringify({ ...pendingLoginChallenge, twoFactorCode, turnstileToken }),
      });
    } catch (error) {
      resetTurnstile("loginTwoFactorTurnstile");
      return showError(error.message || "Invalid authenticator code.");
    }

    const localUser = await cacheAuthenticatedUser(loginResult.user, pendingLoginChallenge.password);
    pendingLoginChallenge = null;
    await persistSession(localUser, loginResult.accessToken || "");
    showToast("Signed in");
    location.hash = "#/dashboard";
  }

  function turnstileMarkup(containerId) {
    if (!TURNSTILE_SITE_KEY) return "";
    return `<div class="turnstile-slot" id="${escapeHtml(containerId)}" data-turnstile-state="loading" aria-live="polite"></div>`;
  }

  function renderVisibleTurnstiles() {
    document.querySelectorAll(".turnstile-slot[id]").forEach((container) => renderTurnstile(container.id));
  }

  function renderTurnstile(containerId) {
    if (!TURNSTILE_SITE_KEY) return;
    const container = document.querySelector(`#${containerId}`);
    if (!container || container.dataset.turnstileRendered === "true") return;
    if (!window.turnstile?.render) {
      turnstileRenderAttempts[containerId] = (turnstileRenderAttempts[containerId] || 0) + 1;
      const delay = turnstileRenderAttempts[containerId] < 20 ? 150 : 500;
      setTimeout(() => renderTurnstile(containerId), delay);
      return;
    }
    turnstileWidgets[containerId] = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      size: "normal",
      "error-callback": (code) => handleTurnstileError(containerId, code),
    });
    container.dataset.turnstileRendered = "true";
    container.dataset.turnstileState = "ready";
  }

  function turnstileTokenFor(containerId) {
    if (!TURNSTILE_SITE_KEY) return "";
    const widgetId = turnstileWidgets[containerId];
    if (!window.turnstile || widgetId === undefined) {
      showError("Human verification is still loading. Try again in a moment.");
      return null;
    }
    const token = window.turnstile.getResponse(widgetId);
    if (!token) {
      showError("Complete the human verification before continuing.");
      return null;
    }
    return token;
  }

  function resetTurnstile(containerId) {
    const widgetId = turnstileWidgets[containerId];
    if (TURNSTILE_SITE_KEY && window.turnstile && widgetId !== undefined) window.turnstile.reset(widgetId);
  }

  function handleTurnstileError(containerId, code) {
    const normalizedCode = String(code || "unknown");
    const container = document.querySelector(`#${containerId}`);
    if (container) container.dataset.turnstileState = "error";
    console.error("Turnstile failed", { containerId, code: normalizedCode });
    if (normalizedCode === "110200") {
      showError("Cloudflare Turnstile is not authorized for this domain. Add brxp2p.com in Cloudflare Hostname Management.");
      return;
    }
    if (normalizedCode === "110100" || normalizedCode === "110110" || normalizedCode === "400020") {
      showError("Cloudflare Turnstile site key is invalid. Check the production site key.");
      return;
    }
    if (normalizedCode === "400070") {
      showError("Cloudflare Turnstile site key is disabled in Cloudflare.");
      return;
    }
    showError(`Cloudflare Turnstile could not load. Refresh and try again. Code: ${escapeHtml(normalizedCode)}`);
  }
  async function persistSession(localUser, token = "") {
    setSession(localUser.id, token || "");
    if (!token) return;
    try {
      await requestJson("/auth/me", { headers: { authorization: `Bearer ${token}` } });
    } catch (error) {
      console.warn(error);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  }

  function googleLogo() {
    return `
      <span class="google-mark" aria-hidden="true">
        <svg viewBox="0 0 18 18" focusable="false">
          <path fill="#4285f4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.12-.84 2.08-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"></path>
          <path fill="#34a853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.94v2.33A8.99 8.99 0 0 0 9 18z"></path>
          <path fill="#fbbc05" d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.94A8.99 8.99 0 0 0 0 9c0 1.45.34 2.82.94 4.05l3.02-2.33z"></path>
          <path fill="#ea4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.65 8.65 0 0 0 9 0 8.99 8.99 0 0 0 .94 4.95l3.02 2.33C4.67 5.16 6.66 3.58 9 3.58z"></path>
        </svg>
      </span>
    `;
  }

  async function handleGoogleAuth() {
    showError("");
    try {
      const baseUrl = localOauthBaseUrl();
      const { url } = await requestJson(`/auth/google/start?returnTo=${encodeURIComponent(baseUrl)}`);
      window.location.href = url;
    } catch (error) {
      showError(error.message || "Google sign-in is not available yet.");
    }
  }


  function localOauthBaseUrl() {
    const url = new URL(window.location.href.split("#")[0]);
    if (["localhost", "127.0.0.1"].includes(url.hostname)) url.hostname = "localhost";
    return url.toString();
  }

  function normalizeLocalOauthHost() {
    if (window.location.hostname !== "127.0.0.1") return false;
    const url = new URL(window.location.href);
    url.hostname = "localhost";
    window.location.replace(url.toString());
    return true;
  }
  async function finishGoogleAuth() {
    if (normalizeLocalOauthHost()) return;
    const query = window.BRX.router.routeParams();
    const legacyToken = query.get("token");
    const twoFactorRequired = query.get("twoFactor") === "required";
    const ticket = query.get("ticket");
    if (twoFactorRequired && ticket) {
      renderGoogleTwoFactor(ticket);
      return;
    }

    try {
      const result = await requestJson("/auth/me", legacyToken ? { headers: { authorization: `Bearer ${legacyToken}` } } : undefined);
      const localUser = await cacheAuthenticatedUser(result.user, "");
      await persistSession(localUser, legacyToken || "");
      showToast("Signed in with Google");
      location.replace(`${location.pathname}${location.search}#/dashboard`);
    } catch (error) {
      showError(error.message || "Could not finish Google sign-in.");
    }
  }

  async function handleGoogleTwoFactor(event, ticket) {
    event.preventDefault();
    showError("");
    const twoFactorCode = document.querySelector("#googleTwoFactor").value.trim();
    if (!/^\d{6}$/.test(twoFactorCode)) return showError("Enter the six-digit authenticator code.");

    try {
      const result = await requestJson("/auth/google/2fa", {
        method: "POST",
        body: JSON.stringify({ ticket, twoFactorCode }),
      });
      const localUser = await cacheAuthenticatedUser(result.user, "");
      await persistSession(localUser, result.accessToken || "");
      showToast("Signed in with Google");
      location.hash = "#/dashboard";
    } catch (error) {
      showError(error.message || "Invalid authenticator code.");
    }
  }

  async function handleVerify(event) {
    event.preventDefault();
    showError("");
    const pendingEmail = localStorage.getItem(PENDING_KEY);
    const code = document.querySelector("#verificationCode").value.trim();
    const nextUsers = users();
    const userIndex = nextUsers.findIndex((item) => item.email === pendingEmail);
    if (userIndex < 0) return showError("Verification session expired.");

  let verifyResult;
  try {
    verifyResult = await requestJson("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ email: pendingEmail, code }),
    });
  } catch (error) {
    return showError(error.message || "Invalid verification code.");
  }

  const backendUser = verifyResult.user;
  nextUsers[userIndex].emailVerified = true;
  nextUsers[userIndex].verifiedAt = new Date().toISOString();
    nextUsers[userIndex].backendUserId = backendUser.id;
    nextUsers[userIndex].depositAddress = backendUser.depositAddress;
    nextUsers[userIndex].kycStatus = backendUser.kycStatus || nextUsers[userIndex].kycStatus || "unsubmitted";
    nextUsers[userIndex].role = backendUser.role || nextUsers[userIndex].role || "user";
    nextUsers[userIndex].status = backendUser.status || nextUsers[userIndex].status || "active";
    nextUsers[userIndex].balance = backendUser.balance || window.BRX.profileService.emptyBalance();
  saveUsers(nextUsers);
  localStorage.removeItem(PENDING_KEY);
  await persistSession(nextUsers[userIndex], verifyResult.accessToken || "");
  showToast("Email verified. Welcome to BRX.");
  location.hash = "#/dashboard";
}

  async function resendCode() {
    const pendingEmail = localStorage.getItem(PENDING_KEY);
    if (!pendingEmail) return showError("Verification session expired.");
    try {
      await requestJson("/auth/resend-code", {
        method: "POST",
        body: JSON.stringify({ email: pendingEmail }),
      });
      showToast("Verification code sent.");
    } catch (error) {
      showError(error.message || "Could not resend verification code.");
    }
  }

  window.BRX.pages.renderRegister = renderRegister;
  window.BRX.pages.renderVerify = renderVerify;
  window.BRX.pages.renderLogin = renderLogin;
  window.BRX.pages.renderOAuthCallback = renderOAuthCallback;

  async function cacheAuthenticatedUser(backendUser, password) {
    const nextUsers = users();
    const existingIndex = nextUsers.findIndex((item) => item.email === backendUser.email);
    const existing = existingIndex >= 0 ? nextUsers[existingIndex] : null;
    const localUser = {
      ...(existing || {}),
      id: existing?.id || backendUser.id,
      backendUserId: backendUser.id,
      email: backendUser.email,
      passwordHash: existing?.passwordHash || (password ? await hashPassword(password) : ""),
      emailVerified: Boolean(backendUser.emailVerified),
      kycStatus: backendUser.kycStatus || existing?.kycStatus || "unsubmitted",
      role: backendUser.role || existing?.role || "user",
      status: backendUser.status || existing?.status || "active",
      depositAddress: backendUser.depositAddress || existing?.depositAddress || "",
      balance: backendUser.balance || existing?.balance || window.BRX.profileService.emptyBalance(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    if (existingIndex >= 0) nextUsers[existingIndex] = localUser;
    else nextUsers.push(localUser);
    saveUsers(nextUsers);
    return localUser;
  }
})();






