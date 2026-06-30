(function () {
  window.BRX = window.BRX || {};
  const { SESSION_KEY, USERS_KEY } = window.BRX.config;

  function users() {
    return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
  }

  function saveUsers(nextUsers) {
    localStorage.setItem(USERS_KEY, JSON.stringify(nextUsers));
  }

  function saveUser(nextUser) {
    const nextUsers = users();
    const index = nextUsers.findIndex((user) => user.id === nextUser.id || user.backendUserId === nextUser.backendUserId || user.email === nextUser.email);
    if (index >= 0) {
      nextUsers[index] = nextUser;
      saveUsers(nextUsers);
    }
  }

  function upsertUser(nextUser) {
    const nextUsers = users();
    const index = nextUsers.findIndex((user) => user.id === nextUser.id || user.backendUserId === nextUser.backendUserId || user.email === nextUser.email);
    if (index >= 0) nextUsers[index] = { ...nextUsers[index], ...nextUser };
    else nextUsers.push(nextUser);
    saveUsers(nextUsers);
    return nextUsers[index >= 0 ? index : nextUsers.length - 1];
  }

  function session() {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  }

  function currentUser() {
    const activeSession = session();
    if (!activeSession) return null;
    return users().find((user) => user.id === activeSession.userId) || null;
  }

  function accessToken() {
    return session()?.accessToken || "";
  }

  function requireUser() {
    const user = currentUser();
    if (!user) {
      location.hash = "#/login";
      return null;
    }
    return user;
  }

  function setSession(userId, token = "") {
    const existing = session();
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId,
      accessToken: token || existing?.accessToken || "",
      signedInAt: new Date().toISOString(),
    }));
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  window.BRX.state = { users, saveUsers, saveUser, upsertUser, session, currentUser, requireUser, accessToken, setSession, clearSession };
})();
