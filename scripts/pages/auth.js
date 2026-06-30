(function () {
  window.BRX = window.BRX || {};
  window.BRX.pages = window.BRX.pages || {};

  const { PENDING_KEY } = window.BRX.config;
  const { requestJson } = window.BRX.api;
  const { users, saveUsers, setSession } = window.BRX.state;
  const { refs, showError, showToast } = window.BRX.ui;
  const { hashPassword, normalizeEmail } = window.BRX.utils;

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
          <div class="form-error" id="formError"></div>
          <button class="primary-button full" type="submit">Create account -></button>
          <p class="auth-footer">Already have an account? <a class="text-link" href="#/login">Sign in</a></p>
        </form>
      </section>
    `;
    document.querySelector("#registerForm").addEventListener("submit", handleRegister);
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
          <label class="form-field"><span>Verification code</span><input id="verificationCode" inputmode="numeric" maxlength="6" placeholder="123456" required /></label>
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
    refs.app.innerHTML = `
      <section class="auth-page">
        <form class="auth-card" id="loginForm" novalidate>
          <div class="auth-title">
            <a class="auth-logo" href="#/"><img src="./assets/brx-logo-transparent.png" alt="BRX" /></a>
            <h1>Sign in</h1>
            <p class="muted">Continue to your BRX wallet and market.</p>
          </div>
          <label class="form-field"><span>Email</span><input id="loginEmail" type="email" autocomplete="email" placeholder="you@example.com" required /></label>
          <label class="form-field"><span>Password</span><input id="loginPassword" type="password" autocomplete="current-password" placeholder="Your password" required /></label>
          <label class="form-field"><span>Authenticator code</span><input id="loginTwoFactor" inputmode="numeric" maxlength="6" placeholder="Required only if 2FA is enabled" /></label>
          <div class="form-error" id="formError"></div>
          <button class="primary-button full" type="submit">Sign in</button>
          <p class="auth-footer">New to BRX? <a class="text-link" href="#/register">Create account</a></p>
        </form>
      </section>
    `;
    document.querySelector("#loginForm").addEventListener("submit", handleLogin);
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

    const nextUsers = users();
    const existingIndex = nextUsers.findIndex((user) => user.email === email);
    if (existingIndex >= 0 && nextUsers[existingIndex].emailVerified) {
      return showError("An account with this email already exists. Sign in instead.");
    }

    try {
      await requestJson("/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
    } catch (error) {
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
    const twoFactorCode = document.querySelector("#loginTwoFactor").value.trim();

    let loginResult;
    try {
      loginResult = await requestJson("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, twoFactorCode }),
      });
    } catch (error) {
      if (String(error.message).toLowerCase().includes("verify")) {
        localStorage.setItem(PENDING_KEY, email);
        showToast("Verify your email to continue.");
        location.hash = "#/verify";
        return;
      }
      return showError(error.message || "Incorrect email or password.");
    }

    const localUser = await cacheAuthenticatedUser(loginResult.user, password);
    if (!localUser.emailVerified) {
      localStorage.setItem(PENDING_KEY, email);
      showToast("Verify your email to continue.");
      location.hash = "#/verify";
      return;
    }

    setSession(localUser.id, loginResult.accessToken);
    showToast("Signed in");
    location.hash = "#/dashboard";
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
  setSession(nextUsers[userIndex].id, verifyResult.accessToken);
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

  async function cacheAuthenticatedUser(backendUser, password) {
    const nextUsers = users();
    const existingIndex = nextUsers.findIndex((item) => item.email === backendUser.email);
    const existing = existingIndex >= 0 ? nextUsers[existingIndex] : null;
    const localUser = {
      ...(existing || {}),
      id: existing?.id || backendUser.id,
      backendUserId: backendUser.id,
      email: backendUser.email,
      passwordHash: existing?.passwordHash || await hashPassword(password),
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






