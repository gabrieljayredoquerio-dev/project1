/* ============ STATE & STORAGE ============
   localStorage keys:
   - "as_users"         : array of {name, email, password, role}
   - "as_session"       : email of the logged-in person
   - "as_week_<email>"  : {allowance, periodStart, periodEnd, savingsGoal, days:{Monday:[{item, amount, category}], ...}}
   - "as_history_<email>": archived weekly budget snapshots for that user
   NOTE: passwords are stored as plain text in localStorage; do not reuse passwords. */
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CATEGORIES = {
  food: { label: "Food", image: "restaurant.png", className: "food" },
  transport: { label: "Transport", image: "motorbike.png", className: "transport" },
  school: { label: "School", image: "school.png", className: "school" },
  personal: { label: "Personal", icon: "♡", className: "personal" },
  other: { label: "Other", icon: "•", className: "other" }
};
const $ = (id) => document.getElementById(id);
const peso = (n) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (error) {
    sideMsg(`Could not read saved data (${key}). Check browser storage and reload.`, false);
    return fallback;
  }
}

function readText(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (error) {
    sideMsg(`Could not read saved setting (${key}). Check browser storage and reload.`, false);
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    sideMsg(`Could not save data (${key}). Free browser storage space and try again.`, false);
    return false;
  }
}

const getWeek = (email) => {
  const week = readJson("as_week_" + email, null);
  if (week === null || (week && typeof week === "object" && week.days && typeof week.days === "object")) return week;
  sideMsg("Saved budget data has an invalid format. It has not been changed.");
  return null;
};
const saveWeek = (email, w) => writeJson("as_week_" + email, w);
const getHistory = (email) => {
  const history = readJson("as_history_" + email, []);
  if (Array.isArray(history)) return history;
  sideMsg("Saved week history has an invalid format. It has not been changed.");
  return [];
};
const saveHistory = (email, history) => writeJson("as_history_" + email, history);

function removeStoredValue(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    sideMsg(`Could not clear saved data (${key}). Try again after checking browser storage.`, false);
    return false;
  }
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, count) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + count);
  return localDateString(date);
}

function mondayOf(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return localDateString(monday);
}

function periodLabel(week) {
  const start = week.periodStart || localDateString(new Date(week.archivedAt || Date.now()));
  const end = week.periodEnd || addDays(start, 6);
  const format = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  return `${format(start)} – ${format(end)}`;
}

let currentUser = null;   // the logged-in user object
let viewingHistoryId = null;
let editingExpense = null;
let activeTab = "overview";

/* ============ SHARED ACCOUNT DATA ============ */
function getUsers() {
  try {
    return AllowanceAuth.readUsers();
  } catch (error) {
    sideMsg(error.message || "Could not read saved account data.", false);
    return [];
  }
}

function applyTheme(theme) {
  const chosen = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = chosen;
  try {
    localStorage.setItem("as_theme", chosen);
  } catch (error) {
    sideMsg("Your theme changed for this visit but could not be saved.", false);
  }
  const toggle = $("theme-toggle");
  if (toggle) {
    toggle.classList.toggle("dark", chosen === "dark");
    toggle.setAttribute("aria-label", chosen === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
}

function logout() {
  try {
    AllowanceAuth.clearSession();
    window.location.replace("login.html");
  } catch (error) {
    sideMsg("Could not clear your saved login session. Check browser storage before closing.", false);
  }
}

/* Decide which dashboard to show based on role */
function showApp(user) {
  currentUser = user;
  if (user.role === "admin") {
    $("admin-view").hidden = false;
    $("user-view").hidden = true;
    $("admin-welcome").textContent = "Admin: " + user.name;
    renderAdmin();
  } else {
    $("admin-view").hidden = true;
    $("user-view").hidden = false;
    $("welcome").textContent = "Welcome, " + user.name + "!";
    prepareCurrentWeek();
    renderUser();
  }
}

function prepareCurrentWeek() {
  const week = getWeek(currentUser.email);
  if (!week) return;
  if (!week.periodStart) week.periodStart = mondayOf(new Date());
  if (!week.periodEnd) week.periodEnd = addDays(week.periodStart, 6);
  if (!Number.isFinite(week.savingsGoal)) week.savingsGoal = 0;
  const today = localDateString(new Date());
  if (today > week.periodEnd) {
    const history = getHistory(currentUser.email);
    history.unshift({ ...week, id: `${Date.now()}`, archivedAt: new Date().toISOString() });
    if (!saveHistory(currentUser.email, history)) return;
    if (!removeStoredValue("as_week_" + currentUser.email)) return;
    sideMsg(`Your ${periodLabel(week)} budget was archived automatically. Start a new week when you're ready.`, true);
    return;
  }
  saveWeek(currentUser.email, week);
}

/* ============ CALCULATIONS ============ */
const sum = (list) => list.reduce((t, e) => t + e.amount, 0);

/* Returns totals + a per-day list with spent and running balance */
function compute(week) {
  let running = week ? week.allowance : 0;
  const rows = DAYS.map((day) => {
    const items = week ? week.days[day] : [];
    const spent = sum(items);
    running -= spent;                       // balance after this day
    return { day, items, spent, balance: running };
  });
  const spent = rows.reduce((t, r) => t + r.spent, 0);
  return { rows, allowance: week ? week.allowance : 0, spent, left: (week ? week.allowance : 0) - spent };
}

/* ============ USER DASHBOARD ============ */
function renderUser(weekOverride) {
  const activeWeek = getWeek(currentUser.email);
  const isViewingHistory = viewingHistoryId !== null;
  const week = weekOverride === undefined
    ? isViewingHistory
      ? getHistory(currentUser.email).find((entry) => entry.id === viewingHistoryId) || activeWeek
      : activeWeek
    : weekOverride;
  if (isViewingHistory && (!week || !getHistory(currentUser.email).some((entry) => entry.id === viewingHistoryId))) {
    viewingHistoryId = null;
    return renderUser(activeWeek);
  }
  const data = compute(week);
  setWeekFlow(week, !isViewingHistory);
  const dailyMax = Math.max(...data.rows.map((r) => r.spent), 1);
  const usagePercent = data.allowance ? ((data.spent / data.allowance) * 100) : 0;
  const trendText = usagePercent >= 90 ? "High spend" : usagePercent >= 60 ? "On track" : "Under plan";

  $("c-allow").textContent = peso(data.allowance);
  $("c-spent").textContent = peso(data.spent);
  const left = $("c-left");
  left.textContent = peso(data.left);
  left.className = data.left >= 0 ? "pos" : "neg";

  $("hero-allow").textContent = peso(data.allowance);
  $("hero-left").textContent = peso(data.left);
  $("hero-left").className = data.left >= 0 ? "pos" : "neg";
  $("hero-trend").textContent = `${Math.min(100, usagePercent).toFixed(0)}% used`;
  $("hero-saved").textContent = peso(Math.max(data.left, 0));
  $("chart-total").textContent = peso(data.spent);
  $("hero-period").textContent = !week
    ? "No active week"
    : `${isViewingHistory ? "Archived week" : "Budget period"} · ${periodLabel(week)}`;
  renderHistoryControls();
  renderInsights(data, isViewingHistory);

  $("spending-chart").innerHTML = data.rows.map((r) => {
    const height = Math.max((r.spent / dailyMax) * 100, r.spent > 0 ? 14 : 8);
    const label = r.day.slice(0, 3);
    return `
      <div class="chart-column">
        <div class="chart-bar-wrap">
          <span class="chart-value">${peso(r.spent)}</span>
          <div class="chart-bar" style="height:${height}%"></div>
        </div>
        <span class="chart-label">${label}</span>
      </div>`;
  }).join("");

  const search = $("expense-search").value.trim().toLowerCase();
  const selectedDay = $("filter-day").value;
  const selectedCategory = $("filter-category").value;
  const filtersActive = !!(search || selectedDay || selectedCategory);
  const rows = data.rows.filter((row) => !selectedDay || row.day === selectedDay);
  const renderedRows = rows.map((r) => {
    const items = r.items.map((item, index) => ({ item, index })).filter(({ item }) => {
      const categoryKey = CATEGORIES[item.category] ? item.category : "other";
      const categoryName = CATEGORIES[categoryKey].label.toLowerCase();
      const itemName = String(item.item || "").toLowerCase();
      return (!selectedCategory || categoryKey === selectedCategory)
        && (!search || itemName.includes(search) || categoryName.includes(search));
    });
    return { ...r, visibleItems: items };
  }).filter((row) => !filtersActive || selectedDay || row.visibleItems.length);
  $("filter-note").textContent = filtersActive
    ? "Expense tags are filtered; daily totals and balances still include every expense."
    : "Daily totals include all expenses.";
  $("day-rows").innerHTML = renderedRows.length ? renderedRows.map((r) => `
    <tr>
      <td class="day-name" data-label="Day">${r.day}</td>
      <td class="day-spent" data-label="Spent">${peso(r.spent)}</td>
      <td class="day-balance ${r.balance >= 0 ? "pos" : "neg"}" data-label="Remaining balance">${peso(r.balance)}</td>
      <td class="day-items">
        <span class="mobile-cell-label">Items</span>
        ${r.visibleItems.length ? r.visibleItems.map(({ item: i, index }) => {
          const category = CATEGORIES[i.category] || CATEGORIES.other;
          const icon = category.image
            ? `<img class="category-image" src="${category.image}" alt="">`
            : category.icon;
          const actions = isViewingHistory ? "" : `
            <span class="expense-actions">
              <button class="expense-action" type="button" data-expense-action="edit" data-day="${r.day}" data-index="${index}" aria-label="Edit ${escapeHtml(i.item)}">Edit</button>
              <button class="expense-action delete" type="button" data-expense-action="delete" data-day="${r.day}" data-index="${index}" aria-label="Delete ${escapeHtml(i.item)}">Delete</button>
            </span>`;
          return `<span class="expense-tag"><span class="category-icon ${category.className}" aria-hidden="true">${icon}</span><span class="expense-name">${escapeHtml(i.item)}<small>${category.label}</small></span><em>${peso(i.amount)}</em>${actions}</span>`;
        }).join("") : `<span class="no-expense">${filtersActive ? "No matching expenses" : "No expenses"}</span>`}
      </td>
    </tr>`).join("") : `<tr><td colspan="4" class="no-expense">No expenses match these filters.</td></tr>`;

  $("hero-trend").title = `${trendText} · ${Math.min(100, usagePercent).toFixed(0)}% of your allowance used`;
}

function renderHistoryControls() {
  const history = getHistory(currentUser.email);
  const panel = $("history-panel");
  const select = $("history-select");
  panel.hidden = activeTab !== "history" || history.length === 0;
  $("history-empty").hidden = activeTab !== "history" || history.length > 0;
  const selectedId = viewingHistoryId || "";
  select.innerHTML = `<option value="">Choose a week to review</option>` + history.map((entry) => {
    const spent = compute(entry).spent;
    return `<option value="${escapeHtml(entry.id)}">${periodLabel(entry)} · ${peso(entry.allowance)} allowance · ${peso(spent)} spent</option>`;
  }).join("");
  select.value = selectedId;
  $("show-current-week").hidden = !viewingHistoryId;
  $("view-history").disabled = !select.value;
  $("restore-history").disabled = !select.value;
  $("export-history").disabled = !select.value;
}

function renderInsights(data, isViewingHistory) {
  const spentDays = data.rows.filter((row) => row.spent > 0);
  const highestDay = spentDays.reduce((highest, row) => !highest || row.spent > highest.spent ? row : highest, null);
  const categoryTotals = {};
  data.rows.forEach((row) => row.items.forEach((item) => {
    const category = CATEGORIES[item.category] ? item.category : "other";
    categoryTotals[category] = (categoryTotals[category] || 0) + item.amount;
  }));
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
  $("insight-day").textContent = highestDay ? `${highestDay.day} · ${peso(highestDay.spent)}` : "No spending yet";
  $("insight-category").textContent = topCategory
    ? `${CATEGORIES[topCategory[0]].label} · ${peso(topCategory[1])}`
    : "No spending yet";
  $("insight-food").textContent = peso(categoryTotals.food || 0);
  $("insight-caption").textContent = isViewingHistory ? "Based on the archived week" : "Based on this week's expenses";
  $("category-totals").innerHTML = Object.entries(CATEGORIES).map(([key, category]) => `
    <div class="category-total ${category.className}">
      <span>${category.label}</span><strong>${peso(categoryTotals[key] || 0)}</strong>
    </div>`).join("");
  const week = isViewingHistory
    ? getHistory(currentUser.email).find((entry) => entry.id === viewingHistoryId)
    : getWeek(currentUser.email);
  const goal = week ? Number(week.savingsGoal) || 0 : 0;
  const saved = Math.max(data.left, 0);
  const progress = goal > 0 ? Math.min((saved / goal) * 100, 100) : 0;
  $("goal-amount").value = goal || "";
  $("goal-amount").disabled = isViewingHistory || !week;
  $("save-goal").disabled = isViewingHistory || !week;
  $("goal-progress").style.width = `${progress}%`;
  $("goal-progress").setAttribute("aria-valuenow", String(Math.round(progress)));
  $("goal-status").textContent = goal > 0
    ? `${peso(saved)} saved of ${peso(goal)} goal${saved >= goal ? " · Goal reached!" : ""}`
    : "Set a savings goal to track your progress.";
}

function setWeekFlow(week, isEditingAllowed) {
  const hasWeek = !!week;
  const reportVisible = (activeTab === "overview" && !!getWeek(currentUser.email))
    || (activeTab === "insights" && !!getWeek(currentUser.email))
    || (activeTab === "history" && !!viewingHistoryId && hasWeek);
  $("week-content").hidden = !reportVisible;
  $("week-summary").hidden = activeTab === "insights";
  $("insights-panel").hidden = activeTab === "overview";
  $("spending-panel").hidden = activeTab === "insights";
  $("breakdown-panel").hidden = activeTab === "insights";
  $("dashboard-hero").hidden = activeTab !== "overview";
  $("week-empty").hidden = activeTab === "history" || !!getWeek(currentUser.email);
  $("history-panel").hidden = activeTab !== "history" || getHistory(currentUser.email).length === 0;
  $("history-empty").hidden = activeTab !== "history" || getHistory(currentUser.email).length > 0;
  $("hero-metrics").hidden = !hasWeek;
  $("hero-art").hidden = !hasWeek;
  $("hero-title").textContent = hasWeek
    ? "Keep every peso working for you."
    : "Build a simple plan for your week.";
  $("view-eyebrow").textContent = activeTab === "history"
    ? "WEEK HISTORY"
    : activeTab === "insights" ? "SPENDING INSIGHTS" : "BUDGET OVERVIEW";
  document.querySelectorAll(".nav-tab").forEach((button) => {
    const selected = button.dataset.view === activeTab;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("open-expense").disabled = !getWeek(currentUser.email);
  $("open-allowance").disabled = !getWeek(currentUser.email) || !!viewingHistoryId;
  $("mobile-log-expense").disabled = !getWeek(currentUser.email);
  $("open-week").textContent = getWeek(currentUser.email) ? "Start a new week" : "Set weekly allowance";
  $("week-dialog-title").textContent = getWeek(currentUser.email) ? "Start a new week" : "Set your weekly allowance";
  $("start-week").textContent = getWeek(currentUser.email) ? "Save week & start fresh" : "Start my week";
  if (!isEditingAllowed) cancelExpenseEdit();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function sideMsg(text, ok) {
  const userMessage = $("side-msg");
  const el = userMessage && !userMessage.closest("[hidden]") ? userMessage : $("admin-side-msg");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("ok", !!ok);
}

function cancelExpenseEdit() {
  editingExpense = null;
  $("expense-form").reset();
  $("log-expense").textContent = "Log expense";
  $("cancel-edit").hidden = true;
  $("expense-dialog-title").textContent = "Log an expense";
}

function startExpenseEdit(day, index) {
  const week = getWeek(currentUser.email);
  const expense = week && week.days[day] && week.days[day][index];
  if (!expense) return sideMsg("That expense could not be found. Refresh the page and try again.");
  viewingHistoryId = null;
  editingExpense = { day, index };
  setActiveTab("overview");
  $("s-day").value = day;
  $("s-item").value = expense.item;
  $("s-category").value = CATEGORIES[expense.category] ? expense.category : "other";
  $("s-amt").value = expense.amount;
  $("log-expense").textContent = "Save changes";
  $("expense-dialog-title").textContent = "Edit expense";
  $("cancel-edit").hidden = false;
  $("expense-dialog").showModal();
  $("s-item").focus();
  sideMsg(`Editing ${expense.item} from ${day}.`, true);
}

function handleExpenseAction(event) {
  const button = event.target.closest("[data-expense-action]");
  if (!button) return;
  const day = button.dataset.day;
  const index = Number(button.dataset.index);
  if (!DAYS.includes(day) || !Number.isInteger(index) || index < 0) return;
  if (button.dataset.expenseAction === "edit") return startExpenseEdit(day, index);
  if (button.dataset.expenseAction !== "delete") return;
  const week = getWeek(currentUser.email);
  const expense = week && week.days[day] && week.days[day][index];
  if (!expense) return sideMsg("That expense could not be found. Refresh the page and try again.");
  if (!window.confirm(`Delete ${expense.item} (${peso(expense.amount)}) from ${day}?`)) return;
  week.days[day].splice(index, 1);
  if (!saveWeek(currentUser.email, week)) return;
  if (editingExpense && editingExpense.day === day && editingExpense.index === index) cancelExpenseEdit();
  else if (editingExpense && editingExpense.day === day && editingExpense.index > index) editingExpense.index--;
  renderUser();
  sideMsg(`${expense.item} was removed from ${day}.`, true);
}

function startWeek() {
  const amount = Number($("s-allow").value);
  const periodStart = $("period-start").value;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) {
    sideMsg("Enter a valid allowance greater than 0 (up to ₱1,000,000,000).");
    return false;
  }
  const parsedStart = new Date(`${periodStart}T12:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)
    || Number.isNaN(parsedStart.getTime())
    || localDateString(parsedStart) !== periodStart) {
    sideMsg("Choose a valid start date for this budget period.");
    return false;
  }
  if (mondayOf(parsedStart) !== periodStart) {
    sideMsg("A budget week must start on a Monday.");
    return false;
  }
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    sideMsg("Enter an allowance with no more than 2 decimal places.");
    return false;
  }
  const previousWeek = getWeek(currentUser.email);
  if (previousWeek && periodStart <= previousWeek.periodEnd) {
    sideMsg(`This period overlaps your current budget. Choose ${addDays(previousWeek.periodEnd, 1)} or later.`);
    return false;
  }
  if (previousWeek && !window.confirm("Starting a new week will save this week's budget to Weekly history and create a fresh expense log. Continue?")) return false;
  const days = {};
  DAYS.forEach((d) => (days[d] = []));
  const newWeek = {
    allowance: amount,
    periodStart,
    periodEnd: addDays(periodStart, 6),
    savingsGoal: 0,
    allowanceAdjustments: [],
    days
  };
  if (previousWeek) {
    const history = getHistory(currentUser.email);
    history.unshift({
      ...previousWeek,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      archivedAt: new Date().toISOString()
    });
    if (!saveHistory(currentUser.email, history)) return false;
  }
  if (!saveWeek(currentUser.email, newWeek)) {
    sideMsg(previousWeek
      ? "The previous week was safely copied to history, but the new budget could not be saved. Your previous active week is unchanged."
      : "The new budget could not be saved. Your data is unchanged.", false);
    return false;
  }
  viewingHistoryId = null;
  cancelExpenseEdit();
  $("s-allow").value = "";
  $("period-start").value = addDays(periodStart, 7);
  renderUser();
  sideMsg(previousWeek
    ? "Previous week saved to history. Your new week is ready."
    : "Your week is ready. Log your first expense below.", true);
  return true;
}

function logExpense() {
  const week = getWeek(currentUser.email);
  if (!week) {
    sideMsg("Set a weekly allowance before logging expenses.");
    return false;
  }
  const item = $("s-item").value.trim();
  const amount = Number($("s-amt").value);
  if (!item || !Number.isFinite(amount) || amount <= 0 || amount > 1000000000
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    sideMsg("Enter an item name and a valid amount (up to ₱1,000,000,000, with at most 2 decimal places).");
    return false;
  }
  const day = $("s-day").value;
  if (!DAYS.includes(day)) {
    sideMsg("Choose a valid day for this expense.");
    return false;
  }
  const category = $("s-category").value;
  if (!CATEGORIES[category]) {
    sideMsg("Choose a valid expense category.");
    return false;
  }
  if (!week.days[day]) week.days[day] = [];
  if (editingExpense) {
    const originalItems = week.days[editingExpense.day];
    if (!originalItems || !originalItems[editingExpense.index]) {
      cancelExpenseEdit();
      sideMsg("That expense could not be found. Refresh the page and try again.");
      return false;
    }
    originalItems.splice(editingExpense.index, 1);
    week.days[day].push({ item, amount, category });
  } else {
    week.days[day].push({ item, amount, category });
  }
  if (!saveWeek(currentUser.email, week)) return false;
  const wasEditing = !!editingExpense;
  cancelExpenseEdit();
  renderUser();
  sideMsg(wasEditing ? `${item} updated for ${day}.` : `${peso(amount)} for ${item} added to ${day}.`, true);
  return true;
}

function viewSelectedHistory() {
  const selectedId = $("history-select").value;
  const entry = getHistory(currentUser.email).find((week) => week.id === selectedId);
  if (!entry) return sideMsg("Choose an archived week to review.");
  cancelExpenseEdit();
  viewingHistoryId = entry.id;
  renderUser(entry);
  document.querySelector(".main").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showCurrentWeek() {
  viewingHistoryId = null;
  setActiveTab("overview");
}

function setActiveTab(tab) {
  if (!["overview", "insights", "history"].includes(tab)) return;
  activeTab = tab;
  if (tab !== "history") viewingHistoryId = null;
  if (tab !== "overview" && editingExpense) cancelExpenseEdit();
  renderUser();
}

function openExpenseDialog() {
  if (!getWeek(currentUser.email)) {
    sideMsg("Set your weekly allowance before logging expenses.");
    $("week-dialog").showModal();
    $("s-allow").focus();
    return;
  }
  setActiveTab("overview");
  $("expense-dialog").showModal();
  $("s-item").focus();
}

function openWeekDialog() {
  const activeWeek = getWeek(currentUser.email);
  $("period-start").value = activeWeek && activeWeek.periodEnd
    ? addDays(activeWeek.periodEnd, 1)
    : mondayOf(new Date());
  $("week-dialog").showModal();
  $("s-allow").focus();
}

function addAllowance(event) {
  event.preventDefault();
  if (viewingHistoryId) return sideMsg("Return to the current week before adding allowance.");
  const week = getWeek(currentUser.email);
  if (!week) return sideMsg("Set a weekly allowance before adding to it.");
  const amount = Number($("additional-allowance").value);
  const total = Number(week.allowance) + amount;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    return sideMsg("Enter an additional amount greater than 0 with at most 2 decimal places.");
  }
  if (!Number.isFinite(total) || total > 1000000000) {
    return sideMsg("The updated allowance cannot exceed ₱1,000,000,000.");
  }
  week.allowanceAdjustments = Array.isArray(week.allowanceAdjustments) ? week.allowanceAdjustments : [];
  const addedAt = new Date().toISOString();
  week.allowanceAdjustments.push({ amount, addedAt });
  week.allowance = total;
  if (!saveWeek(currentUser.email, week)) return;
  $("additional-allowance").value = "";
  $("allowance-dialog").close();
  renderUser();
  sideMsg(`${peso(amount)} added to this week's allowance. New total: ${peso(total)}.`, true);
}

function saveSavingsGoal(event) {
  event.preventDefault();
  if (viewingHistoryId) return;
  const week = getWeek(currentUser.email);
  const goal = Number($("goal-amount").value);
  if (!week) return sideMsg("Set a weekly allowance before adding a savings goal.");
  if (!Number.isFinite(goal) || goal < 0 || goal > week.allowance || goal > 1000000000
    || (goal > 0 && Math.abs(goal * 100 - Math.round(goal * 100)) > 0.000001)) {
    return sideMsg(`Enter a goal from ₱0 up to this week's allowance (${peso(week.allowance)}), with at most 2 decimal places.`);
  }
  week.savingsGoal = goal;
  if (!saveWeek(currentUser.email, week)) return;
  renderUser();
  sideMsg(goal ? "Weekly savings goal updated." : "Savings goal cleared.", true);
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportWeek(week) {
  if (!week) return sideMsg("Choose a budget week to export.");
  try {
    const lines = [
      ["Period start", week.periodStart || "", "Period end", week.periodEnd || ""],
      ["Allowance", week.allowance, "Savings goal", week.savingsGoal || 0],
      ["Record type", "Date added", "Day", "Item / description", "Category", "Amount"]
    ];
    (week.allowanceAdjustments || []).forEach((adjustment) => {
      lines.push(["Allowance added", adjustment.addedAt || "", "", "Additional allowance", "", Number(adjustment.amount).toFixed(2)]);
    });
    DAYS.forEach((day) => (week.days[day] || []).forEach((expense) => {
      const categoryKey = CATEGORIES[expense.category] ? expense.category : "other";
      lines.push(["Expense", "", day, expense.item, CATEGORIES[categoryKey].label, Number(expense.amount).toFixed(2)]);
    }));
    const csv = "\uFEFF" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `allowance-week-${week.periodStart || "record"}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    sideMsg(`CSV exported for ${periodLabel(week)}.`, true);
  } catch (error) {
    sideMsg("Could not export this week. Your saved data is unchanged.", false);
  }
}

function exportCurrentWeek() {
  const week = viewingHistoryId
    ? getHistory(currentUser.email).find((entry) => entry.id === viewingHistoryId)
    : getWeek(currentUser.email);
  exportWeek(week);
}

function exportSelectedHistory() {
  const selected = getHistory(currentUser.email).find((entry) => entry.id === $("history-select").value);
  exportWeek(selected);
}

function restoreSelectedHistory() {
  const history = getHistory(currentUser.email);
  const selectedId = $("history-select").value;
  const selected = history.find((entry) => entry.id === selectedId);
  if (!selected) return sideMsg("Choose a saved week to restore.");
  if (!window.confirm(`Restore ${periodLabel(selected)} as your current week? Your existing current week will first be saved to history.`)) return;
  const active = getWeek(currentUser.email);
  const updatedHistory = active
    ? [{ ...active, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, archivedAt: new Date().toISOString() }, ...history]
    : history;
  if (active && !saveHistory(currentUser.email, updatedHistory)) return;
  const nextStart = active && active.periodEnd > mondayOf(new Date())
    ? addDays(active.periodEnd, 1)
    : mondayOf(new Date());
  const restored = {
    allowance: selected.allowance,
    periodStart: nextStart,
    periodEnd: addDays(nextStart, 6),
    savingsGoal: Number(selected.savingsGoal) || 0,
    allowanceAdjustments: Array.isArray(selected.allowanceAdjustments) ? selected.allowanceAdjustments : [],
    days: selected.days
  };
  if (!saveWeek(currentUser.email, restored)) {
    sideMsg("The saved week could not be restored. Your current budget and history remain available.", false);
    return;
  }
  const remainingHistory = updatedHistory.filter((entry) => entry.id !== selectedId);
  const historyCleaned = saveHistory(currentUser.email, remainingHistory);
  viewingHistoryId = null;
  $("history-select").value = "";
  setActiveTab("overview");
  sideMsg(historyCleaned
    ? `Saved expenses restored as the current week (${periodLabel(restored)}).`
    : "The week was restored, but its history copy could not be removed. Your records are preserved.", historyCleaned);
}

/* ============ ADMIN DASHBOARD ============ */
function renderAdmin() {
  const students = getUsers().filter((u) => u.role === "user");
  let totalSaved = 0, active = 0;
  const rows = students.map((u) => {
    const week = getWeek(u.email);
    const d = compute(week);
    if (week) { active++; totalSaved += d.left; }
    return `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>${peso(d.allowance)}</td><td>${peso(d.spent)}</td><td class="${d.left >= 0 ? "pos" : "neg"}">${peso(d.left)}</td></tr>`;
  });
  $("m-users").textContent = students.length;
  $("m-saved").textContent = peso(totalSaved);
  $("m-active").textContent = active;
  $("user-rows").innerHTML = rows.join("") || `<tr><td colspan="5"><small>No student accounts yet.</small></td></tr>`;
}

/* ============ INIT ============ */
$("s-day").innerHTML = DAYS.map((d) => `<option>${d}</option>`).join("");
$("filter-day").innerHTML += DAYS.map((day) => `<option value="${day}">${day}</option>`).join("");
$("week-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (startWeek()) $("week-dialog").close();
});
$("allowance-form").addEventListener("submit", addAllowance);
$("expense-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (logExpense()) $("expense-dialog").close();
});
$("cancel-edit").onclick = () => {
  cancelExpenseEdit();
  $("expense-dialog").close();
};
$("day-rows").addEventListener("click", handleExpenseAction);
$("open-expense").onclick = openExpenseDialog;
$("open-allowance").onclick = () => {
  if (!getWeek(currentUser.email)) return sideMsg("Set a weekly allowance before adding to it.");
  if (viewingHistoryId) return sideMsg("Return to the current week before adding allowance.");
  $("additional-allowance").value = "";
  $("allowance-dialog").showModal();
  $("additional-allowance").focus();
};
$("mobile-log-expense").onclick = openExpenseDialog;
$("open-week").onclick = openWeekDialog;
document.querySelectorAll(".nav-tab").forEach((button) => {
  button.onclick = () => setActiveTab(button.dataset.view);
});
$("history-select").addEventListener("change", () => {
  $("view-history").disabled = !$("history-select").value;
});
$("view-history").onclick = viewSelectedHistory;
$("show-current-week").onclick = showCurrentWeek;
$("goal-form").addEventListener("submit", saveSavingsGoal);
$("expense-search").addEventListener("input", () => renderUser());
["filter-day", "filter-category"].forEach((id) => $(id).addEventListener("change", () => renderUser()));
$("clear-filters").onclick = () => {
  $("expense-search").value = "";
  $("filter-day").value = "";
  $("filter-category").value = "";
  renderUser();
};
$("export-week").onclick = exportCurrentWeek;
$("export-history").onclick = exportSelectedHistory;
$("history-select").addEventListener("change", () => {
  $("export-history").disabled = !$("history-select").value;
  $("restore-history").disabled = !$("history-select").value;
});
$("restore-history").onclick = restoreSelectedHistory;
$("export-backup").onclick = exportLocalBackup;
$("import-backup").addEventListener("change", importLocalBackup);
$("delete-local-account").onclick = deleteCurrentLocalAccount;
$("admin-export-backup").onclick = exportLocalBackup;
$("admin-import-backup").addEventListener("change", importLocalBackup);
$("admin-delete-local-account").onclick = deleteCurrentLocalAccount;
$("expense-dialog").addEventListener("close", () => {
  if (editingExpense) cancelExpenseEdit();
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.onclick = () => {
    if (button.dataset.closeDialog === "expense-dialog" && editingExpense) cancelExpenseEdit();
    $(button.dataset.closeDialog).close();
  };
});
$("setup-week").onclick = () => {
  openWeekDialog();
};
$("theme-toggle").onclick = () => applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
document.querySelectorAll(".logout").forEach((b) => (b.onclick = logout));

function exportLocalBackup() {
  try {
    const backup = {
      app: "AllowanceSaver",
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profile: { name: currentUser.name, email: currentUser.email },
      currentWeek: getWeek(currentUser.email),
      history: getHistory(currentUser.email)
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `allowancesaver-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    sideMsg("Your local budget backup was downloaded. Keep the file somewhere private.", true);
  } catch (error) {
    sideMsg("Could not create your backup. Your saved data has not been changed.", false);
  }
}

function isValidBackupWeek(week) {
  if (week === null) return true;
  if (!week || typeof week !== "object"
    || !Number.isFinite(week.allowance) || week.allowance <= 0 || week.allowance > 1000000000
    || !week.days || typeof week.days !== "object") return false;
  return DAYS.every((day) => Array.isArray(week.days[day]) && week.days[day].every((expense) =>
    expense && typeof expense.item === "string"
    && expense.item.length <= 500
    && Number.isFinite(expense.amount) && expense.amount > 0 && expense.amount <= 1000000000
    && Object.prototype.hasOwnProperty.call(CATEGORIES, expense.category)));
}

async function importLocalBackup(event) {
  const input = event.currentTarget;
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) {
      sideMsg("Backup files must be smaller than 5 MB.", false);
      return;
    }
    const backup = JSON.parse(await file.text());
    if (!backup || backup.app !== "AllowanceSaver" || backup.schemaVersion !== 1
      || !backup.profile || backup.profile.email !== currentUser.email
      || !isValidBackupWeek(backup.currentWeek)
      || !Array.isArray(backup.history) || !backup.history.every((week) => week !== null && isValidBackupWeek(week))) {
      sideMsg("This backup is invalid, unsupported, or belongs to a different local account.", false);
      return;
    }
    if (!window.confirm("Restore this backup? It will replace this account's current week and saved history.")) return;
    const weekKey = "as_week_" + currentUser.email;
    const historyKey = "as_history_" + currentUser.email;
    const previousWeek = localStorage.getItem(weekKey);
    const previousHistory = localStorage.getItem(historyKey);
    try {
      if (backup.currentWeek === null) localStorage.removeItem(weekKey);
      else localStorage.setItem(weekKey, JSON.stringify(backup.currentWeek));
      localStorage.setItem(historyKey, JSON.stringify(backup.history));
    } catch (error) {
      try {
        if (previousWeek === null) localStorage.removeItem(weekKey);
        else localStorage.setItem(weekKey, previousWeek);
        if (previousHistory === null) localStorage.removeItem(historyKey);
        else localStorage.setItem(historyKey, previousHistory);
      } catch (rollbackError) {
        sideMsg("Backup restore failed, and the previous data could not be fully restored. Check this browser's storage before continuing.", false);
        return;
      }
      sideMsg("Backup restore failed. Your previous budget data was restored.", false);
      return;
    }
    viewingHistoryId = null;
    setActiveTab("overview");
    sideMsg("Backup restored for this local account.", true);
  } catch (error) {
    sideMsg("Could not read this backup file. Choose a valid AllowanceSaver JSON backup.", false);
  } finally {
    input.value = "";
  }
}

function deleteCurrentLocalAccount() {
  if (!window.confirm("Permanently delete this local account, its active budget, and all saved history from this browser? This cannot be undone.")) return;
  try {
    AllowanceAuth.deleteLocalAccount(currentUser.email);
    window.location.replace("login.html");
  } catch (error) {
    sideMsg(error.message || "Could not completely delete this local account. Check this browser's storage and try again.", false);
  }
}

applyTheme(readText("as_theme", "light"));

// Dashboard pages require a valid session; authentication lives in login.html.
try {
  const sessionEmail = AllowanceAuth.readSession();
  const restored = getUsers().find((user) => user.email === sessionEmail);
  if (restored) showApp(restored);
  else window.location.replace("login.html");
} catch (error) {
  sideMsg(error.message || "Could not restore your login. Please sign in again.", false);
  window.location.replace("login.html");
}
