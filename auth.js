/* Authentication page and shared session helpers. */
(function () {
  const $ = (id) => document.getElementById(id);
  const USERS_KEY = "as_users";
  const SESSION_KEY = "as_session";

  function readUsers() {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw === null) return [];
    const users = JSON.parse(raw);
    if (!Array.isArray(users)) throw new Error("Saved account data is not valid.");
    return users;
  }

  function writeUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function readSession() {
    return localStorage.getItem(SESSION_KEY);
  }

  function setSession(email) {
    localStorage.setItem(SESSION_KEY, email);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }

  function deleteLocalAccount(email) {
    const users = readUsers();
    if (!users.some((user) => user.email === email)) {
      throw new Error("The local account could not be found.");
    }
    localStorage.removeItem("as_week_" + email);
    localStorage.removeItem("as_history_" + email);
    writeUsers(users.filter((user) => user.email !== email));
    if (readSession() === email) clearSession();
  }

  window.AllowanceAuth = { readUsers, readSession, setSession, clearSession, deleteLocalAccount };

  const form = $("auth-form");
  const themeToggle = $("login-theme-toggle");

  function setTheme(theme, persist) {
    const chosen = theme === "dark" ? "dark" : "light";
    document.body.dataset.theme = chosen;
    if (themeToggle) {
      const dark = chosen === "dark";
      themeToggle.setAttribute("aria-pressed", String(dark));
      themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      $("login-theme-label").textContent = dark ? "Light mode" : "Dark mode";
      themeToggle.querySelector(".login-theme-icon").textContent = dark ? "☀" : "☾";
    }
    if (!persist) return;
    try {
      localStorage.setItem("as_theme", chosen);
    } catch (error) {
      const authMessage = $("auth-msg");
      if (authMessage) {
        authMessage.textContent = "Theme changed for this visit, but could not be saved.";
        authMessage.classList.remove("ok");
      }
    }
  }

  try {
    setTheme(localStorage.getItem("as_theme") || "light", false);
  } catch (error) {
    setTheme("light", false);
    const authMessage = $("auth-msg");
    if (authMessage) authMessage.textContent = "Could not load your saved theme preference.";
  }

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      setTheme(document.body.dataset.theme === "dark" ? "light" : "dark", true);
    });
  }

  if (!form) return;

  let mode = "login";
  const message = (text, success) => {
    $("auth-msg").textContent = text;
    $("auth-msg").classList.toggle("ok", !!success);
  };

  function setMode(nextMode) {
    mode = nextMode;
    $("tab-login").classList.toggle("active", mode === "login");
    $("tab-register").classList.toggle("active", mode === "register");
    $("name-row").hidden = mode === "login";
    $("a-pass").autocomplete = mode === "login" ? "current-password" : "new-password";
    $("auth-submit").textContent = mode === "login" ? "Log in" : "Create account";
    message("", false);
  }

  function submitAuth() {
    const email = $("a-email").value.trim().toLowerCase();
    const password = $("a-pass").value;
    if (!email || !password) return message("Enter your email and password.");
    if (!$("a-email").validity.valid) return message("Enter a valid email address.");

    try {
      const users = readUsers();
      if (mode === "register") {
        const name = $("a-name").value.trim();
        if (!name) return message("Enter your full name.");
        if (users.some((user) => user.email === email)) {
          return message("That email already has an account. Log in instead.");
        }
        users.push({ name, email, password, role: "user" });
        writeUsers(users);
        setMode("login");
        return message("Account created. Log in to continue.", true);
      }

      const user = users.find((account) => account.email === email && account.password === password);
      if (!user) return message("Wrong email or password.");
      setSession(user.email);
      window.location.replace("index.html");
    } catch (error) {
      message(error.message || "Could not access saved account data. Check browser storage and try again.");
    }
  }

  $("tab-login").addEventListener("click", () => setMode("login"));
  $("tab-register").addEventListener("click", () => setMode("register"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAuth();
  });

  try {
    const sessionEmail = readSession();
    if (sessionEmail && readUsers().some((user) => user.email === sessionEmail)) {
      window.location.replace("index.html");
    }
  } catch (error) {
    message(error.message || "Could not read saved account data. Check browser storage and try again.");
  }
})();
