// ============ HELPERS ============
function formatNumber(num) {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function cleanModelName(name) {
  let clean = name.replace('claude-', '').replace(/-\d{8}$/, '');
  const match = clean.match(/^(\w+)-(\d+)-(\d+)$/);
  if (match) {
    return match[1].charAt(0).toUpperCase() + match[1].slice(1) + ' ' + match[2] + '.' + match[3];
  }
  return clean.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getModelRates(model) {
  if (model.includes('sonnet')) return { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 };
  if (model.includes('opus')) return { input: 15, output: 75, cacheRead: 1.50, cacheWrite: 18.75 };
  if (model.includes('haiku')) return { input: 0.80, output: 4, cacheRead: 0.08, cacheWrite: 1 };
  return { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75 };
}

function estimateCost(modelUsage) {
  let total = 0;
  for (const [model, u] of Object.entries(modelUsage)) {
    if (u.costUSD > 0) { total += u.costUSD; continue; }
    const r = getModelRates(model);
    total += (u.inputTokens || 0) / 1e6 * r.input +
             (u.outputTokens || 0) / 1e6 * r.output +
             (u.cacheReadInputTokens || 0) / 1e6 * r.cacheRead +
             (u.cacheCreationInputTokens || 0) / 1e6 * r.cacheWrite;
  }
  return total;
}

function toDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getTodayStr() { return toDateStr(new Date()); }

function getWeekDates() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toDateStr(d);
  });
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

function formatDuration(ms) {
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hrs > 0) return hrs + 'h ' + mins + 'm';
  return mins + 'm';
}

function getSessionResetText(firstTimestamp) {
  if (!firstTimestamp) return '';
  const start = new Date(firstTimestamp).getTime();
  const windowMs = 5 * 60 * 60 * 1000;
  const resetAt = start + windowMs;
  const now = Date.now();
  const remaining = resetAt - now;
  if (remaining <= 0) return 'Reset available';
  return 'Resets in ' + formatDuration(remaining);
}

function getSessionPct(session) {
  if (!session) return 0;
  const model = session.model || '';
  const rates = getModelRates(model);
  const cost = (session.inputTokens || 0) / 1e6 * rates.input +
               (session.outputTokens || 0) / 1e6 * rates.output +
               (session.cacheReadTokens || 0) / 1e6 * rates.cacheRead +
               (session.cacheWriteTokens || 0) / 1e6 * rates.cacheWrite;
  return Math.min(99, Math.round((cost / 290) * 100));
}

function getTotalTokens(data) {
  let total = 0;
  for (const u of Object.values(data.modelUsage || {})) {
    total += (u.inputTokens || 0) + (u.outputTokens || 0) +
             (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0);
  }
  return total;
}

// ============ STATE ============
let isExpanded = true;
let currentPeriod = 'today';
let cachedData = { stats: null, session: null, usage: null };
let weeklyDays = [];

// ============ EXPAND / COLLAPSE ============
const expandBtn = document.getElementById('btn-expand');
const expandedView = document.getElementById('expanded-view');

function expand() {
  if (isExpanded) return;
  isExpanded = true;
  expandedView.style.display = 'flex';
  expandBtn.classList.add('expanded');
  window.electronAPI.toggleExpand(true);
}

function collapse() {
  if (!isExpanded) return;
  isExpanded = false;
  expandedView.style.display = 'none';
  expandBtn.classList.remove('expanded');
  window.electronAPI.toggleExpand(false);
}

// Click anywhere on collapsed bar to expand
document.getElementById('collapsed-view').addEventListener('click', (e) => {
  // Only the button collapses
  if (e.target.closest('#btn-expand')) {
    if (isExpanded) collapse();
    else expand();
    return;
  }
  if (e.target.closest('#btn-close')) return;
  expand();
});

expandBtn.classList.add('expanded');

// Start expanded
window.electronAPI.toggleExpand(true);

// ============ PERIOD SELECTOR ============
document.querySelectorAll('.period-option').forEach((opt) => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.period-option').forEach((o) => o.classList.remove('active'));
    opt.classList.add('active');
    currentPeriod = opt.dataset.period;
    updateActivitySection();
  });
});

function updateActivitySection() {
  const { stats, session } = cachedData;
  const today = getTodayStr();
  const weekChart = document.getElementById('week-chart');
  const chartTooltip = document.getElementById('chart-tooltip');
  const extraEl = document.getElementById('activity-extra');

  weekChart.style.display = currentPeriod === 'week' ? 'flex' : 'none';
  chartTooltip.style.display = currentPeriod === 'week' ? 'block' : 'none';

  if (currentPeriod === 'today') {
    // Use session data for today (stats-cache may be stale)
    const sessionMsgs = session ? (session.userMessages || 0) + (session.assistantMessages || 0) : 0;
    const sessionTokens = session
      ? (session.inputTokens || 0) + (session.outputTokens || 0) +
        (session.cacheReadTokens || 0) + (session.cacheWriteTokens || 0)
      : 0;

    // Also check stats-cache for today
    const todayActivity = (stats?.dailyActivity || []).find((d) => d.date === today);
    const todayTokenEntry = (stats?.dailyModelTokens || []).find((d) => d.date === today);
    let statsTodayTokens = 0;
    if (todayTokenEntry) {
      for (const c of Object.values(todayTokenEntry.tokensByModel || {})) statsTodayTokens += c;
    }

    // Use whichever has more data
    const msgs = Math.max(sessionMsgs, todayActivity?.messageCount || 0);
    const tools = Math.max(session?.toolCalls || 0, todayActivity?.toolCallCount || 0);
    const tokens = Math.max(sessionTokens, statsTodayTokens);

    document.getElementById('activity-messages').textContent = formatNumber(msgs);
    document.getElementById('activity-tools').textContent = formatNumber(tools);
    document.getElementById('activity-tokens').textContent = formatNumber(tokens);
    document.getElementById('period-sub').textContent = '';
    extraEl.innerHTML = '';

  } else if (currentPeriod === 'week') {
    const weekDates = getWeekDates();
    document.getElementById('period-sub').textContent = formatDateShort(weekDates[0]) + ' - ' + formatDateShort(weekDates[6]);

    const days = weekDates.map((dateStr) => {
      const activity = (stats?.dailyActivity || []).find((d) => d.date === dateStr);
      const tokenEntry = (stats?.dailyModelTokens || []).find((d) => d.date === dateStr);
      let dayTokens = 0;
      if (tokenEntry) for (const c of Object.values(tokenEntry.tokensByModel || {})) dayTokens += c;
      return {
        date: dateStr, isToday: dateStr === today,
        messages: activity ? activity.messageCount : 0,
        sessions: activity ? activity.sessionCount : 0,
        tools: activity ? activity.toolCallCount : 0,
        tokens: dayTokens,
      };
    });
    weeklyDays = days;

    const maxMsgs = Math.max(1, ...days.map((d) => d.messages));
    for (let i = 0; i < 7; i++) {
      const bar = document.getElementById('bar-' + i);
      const dayLabel = bar.closest('.chart-bar-col').querySelector('.chart-day');
      const d = days[i];
      bar.style.height = d.messages > 0 ? Math.max(5, (d.messages / maxMsgs) * 100) + '%' : '0%';
      bar.className = 'chart-bar' + (d.isToday ? ' today' : '') + (d.messages === 0 ? ' empty' : '');
      dayLabel.className = 'chart-day' + (d.isToday ? ' today' : '') + (d.messages > 0 ? ' has-data' : '');
    }

    const totals = days.reduce((a, d) => ({
      messages: a.messages + d.messages, tools: a.tools + d.tools, sessions: a.sessions + d.sessions,
    }), { messages: 0, tools: 0, sessions: 0 });

    document.getElementById('activity-messages').textContent = formatNumber(totals.messages);
    document.getElementById('activity-tools').textContent = formatNumber(totals.tools);
    document.getElementById('activity-tokens').textContent = totals.sessions + ' sessions';
    extraEl.innerHTML = '';

  } else if (currentPeriod === 'alltime') {
    const totalCost = estimateCost(stats?.modelUsage || {});
    document.getElementById('period-sub').textContent = '$' + totalCost.toFixed(2);
    document.getElementById('activity-messages').textContent = formatNumber(stats?.totalMessages || 0);
    document.getElementById('activity-tools').textContent = (stats?.totalSessions || 0) + ' sessions';
    document.getElementById('activity-tokens').textContent = formatNumber(getTotalTokens(stats || {}));
    extraEl.innerHTML = '';
  }
}

// ============ UPDATE UI ============
function updateUI({ stats, session, usage, system }) {
  cachedData = { stats, session, usage };

  // --- Input notification ---
  const notifyEl = document.getElementById('input-notify');
  const notifyText = document.getElementById('input-notify-text');
  if (session?.waitingForInput) {
    notifyEl.style.display = 'flex';
    notifyText.textContent = session.waitingReason || 'Waiting for your input';
  } else {
    notifyEl.style.display = 'none';
  }

  const hasRealUsage = usage && usage.sessionPct !== undefined;

  const pct = hasRealUsage ? usage.sessionPct : getSessionPct(session);
  document.getElementById('c-session-bar').style.width = pct + '%';
  document.getElementById('c-session-pct').textContent = pct + '% used';

  // Session reset in collapsed view
  const resetText = hasRealUsage && usage.sessionReset ? usage.sessionReset : getSessionResetText(session?.firstTimestamp);
  document.getElementById('c-session-reset').textContent = resetText;

  if (session && session.model) {
    document.getElementById('c-model').textContent = cleanModelName(session.model);
  }


  // --- Expanded: Session Details ---
  if (session || hasRealUsage) {
    const sessionTokens = session
      ? (session.inputTokens || 0) + (session.outputTokens || 0) +
        (session.cacheReadTokens || 0) + (session.cacheWriteTokens || 0)
      : 0;

    document.getElementById('session-bar-expanded').style.width = pct + '%';
    document.getElementById('session-pct-expanded').textContent = pct + '% used';
    document.getElementById('session-reset-text').textContent =
      hasRealUsage && usage.sessionReset ? usage.sessionReset : getSessionResetText(session?.firstTimestamp);
    document.getElementById('session-messages').textContent = session?.userMessages || 0;
    document.getElementById('session-tools').textContent = session?.toolCalls || 0;
    document.getElementById('session-tokens').textContent = formatNumber(sessionTokens);

    if (session?.firstTimestamp) {
      const dur = Date.now() - new Date(session.firstTimestamp).getTime();
      document.getElementById('session-duration').textContent = formatDuration(dur);
    }
  }

  // --- Weekly limits (from real usage) ---
  if (hasRealUsage && usage.weekAllPct !== undefined) {
    document.getElementById('week-all-bar').style.width = usage.weekAllPct + '%';
    document.getElementById('week-all-pct').textContent = usage.weekAllPct + '% used';
    document.getElementById('week-all-reset').textContent = usage.weekAllReset || '';

    if (usage.weekSonnetPct !== undefined) {
      document.getElementById('week-sonnet-row').style.display = 'flex';
      document.getElementById('week-sonnet-bar').style.width = usage.weekSonnetPct + '%';
      document.getElementById('week-sonnet-pct').textContent = usage.weekSonnetPct + '% used';
      document.getElementById('week-sonnet-reset').textContent = usage.weekSonnetReset || '';
    }

    if (usage.extraPct !== undefined) {
      document.getElementById('extra-row').style.display = 'flex';
      document.getElementById('extra-bar').style.width = usage.extraPct + '%';
      document.getElementById('extra-pct').textContent = usage.extraPct + '% used';
      const extraText = usage.extraSpent !== undefined
        ? `$${usage.extraSpent.toFixed(2)} / $${usage.extraLimit.toFixed(2)} spent`
        : '';
      document.getElementById('extra-spent').textContent = extraText;
    }

    document.getElementById('weekly-limits-section').style.display = 'block';
  }

  // --- Activity section ---
  updateActivitySection();

  // --- System stats ---
  if (system) {
    document.getElementById('sys-cpu').textContent = system.cpu + '%';
    document.getElementById('sys-mem').textContent = system.mem.usedPct + '%';
    document.getElementById('sys-mem-detail').textContent = system.mem.usedGB + '/' + system.mem.totalGB + 'G';
  }

  document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
}

// ============ CHART TOOLTIPS ============
const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
document.querySelectorAll('.chart-bar-col').forEach((col, i) => {
  col.addEventListener('mouseenter', () => {
    const d = weeklyDays[i];
    if (d) document.getElementById('chart-tooltip').textContent =
      `${dayNames[i]}: ${d.messages} msgs, ${d.tools} tools, ${formatNumber(d.tokens)} tok`;
  });
  col.addEventListener('mouseleave', () => {
    document.getElementById('chart-tooltip').textContent = '';
  });
});


// ============ BUTTONS ============
document.getElementById('btn-close').addEventListener('click', () => window.electronAPI.closeApp());
document.getElementById('btn-refresh').addEventListener('click', () => window.electronAPI.refreshData());

const pinBtn = document.getElementById('btn-pin');
pinBtn.classList.add('pinned');
pinBtn.addEventListener('click', () => window.electronAPI.togglePin());
window.electronAPI.onPinStatus((pinned) => pinBtn.classList.toggle('pinned', pinned));

// ============ THEME ============
const themes = ['dark', 'light', 'night'];
const themeLabels = { dark: 'DARK', light: 'LIGHT', night: 'NIGHT' };
let currentTheme = localStorage.getItem('overlay-theme') || 'dark';

function applyTheme(theme) {
  const card = document.querySelector('.card');
  card.classList.remove('theme-light', 'theme-night');
  if (theme === 'light') card.classList.add('theme-light');
  else if (theme === 'night') card.classList.add('theme-night');
  document.getElementById('btn-theme').textContent = themeLabels[theme];
  localStorage.setItem('overlay-theme', theme);
  currentTheme = theme;
}

applyTheme(currentTheme);

document.getElementById('btn-theme').addEventListener('click', () => {
  const idx = (themes.indexOf(currentTheme) + 1) % themes.length;
  applyTheme(themes[idx]);
});

// ============ USER MENU DROPDOWN ============
const userBtn = document.getElementById('btn-user');
const userDropdown = document.getElementById('user-dropdown');
const dropdownUserInfo = document.getElementById('dropdown-user-info');
const dropdownTeams = document.getElementById('dropdown-teams');
const dropdownAdmin = document.getElementById('dropdown-admin');
let userMenuOpen = false;

userBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  userMenuOpen = !userMenuOpen;
  userDropdown.classList.toggle('open', userMenuOpen);
  if (userMenuOpen) loadUserMenu();
});

document.addEventListener('click', () => {
  if (userMenuOpen) {
    userMenuOpen = false;
    userDropdown.classList.remove('open');
  }
});

userDropdown.addEventListener('click', (e) => e.stopPropagation());

async function loadUserMenu() {
  const auth = await window.electronAPI.getAuthState();
  if (auth.user) {
    dropdownUserInfo.textContent = auth.user.name || auth.user.email;
  }
  try {
    const teams = await window.electronAPI.getMyTeams();
    if (teams.length > 0) {
      dropdownTeams.innerHTML = teams.map((t) =>
        `<div class="dropdown-team-item">${escapeHtmlAttr(t.name)} <span class="team-role">${t.role}</span></div>`
      ).join('');
      const isAdmin = teams.some((t) => t.role === 'admin');
      dropdownAdmin.style.display = isAdmin ? 'block' : 'none';
    } else {
      dropdownTeams.innerHTML = '<div class="dropdown-team-empty">No teams yet</div>';
      dropdownAdmin.style.display = 'none';
    }
  } catch {
    dropdownTeams.innerHTML = '';
  }
}

function escapeHtmlAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.getElementById('dropdown-logout').addEventListener('click', () => {
  window.electronAPI.logout();
});

document.getElementById('dropdown-admin').addEventListener('click', () => {
  window.electronAPI.openAdmin();
  userMenuOpen = false;
  userDropdown.classList.remove('open');
});

// Inline input helper — replaces prompt() which doesn't work in frameless Electron windows
function showInlineInput(buttonEl, placeholder, onSubmit) {
  // Don't create duplicate inputs
  if (buttonEl.nextElementSibling?.classList.contains('dropdown-inline-form')) return;

  const form = document.createElement('div');
  form.className = 'dropdown-inline-form';
  form.innerHTML = `<input class="dropdown-inline-input" type="text" placeholder="${placeholder}" autocomplete="off">
    <div class="dropdown-inline-btns">
      <button class="dropdown-inline-ok">OK</button>
      <button class="dropdown-inline-cancel">Cancel</button>
    </div>
    <div class="dropdown-inline-error"></div>`;
  buttonEl.after(form);

  const input = form.querySelector('input');
  const errorEl = form.querySelector('.dropdown-inline-error');
  input.focus();

  const submit = async () => {
    const val = input.value.trim();
    if (!val) { errorEl.textContent = 'Cannot be empty'; return; }
    errorEl.textContent = '';
    form.querySelector('.dropdown-inline-ok').textContent = '...';
    const result = await onSubmit(val);
    if (result?.error) {
      errorEl.textContent = result.error;
      form.querySelector('.dropdown-inline-ok').textContent = 'OK';
    } else {
      form.remove();
      loadUserMenu();
    }
  };

  form.querySelector('.dropdown-inline-ok').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') form.remove();
  });
  form.querySelector('.dropdown-inline-cancel').addEventListener('click', () => form.remove());
}

document.getElementById('dropdown-create-team').addEventListener('click', function () {
  showInlineInput(this, 'Team name', (name) => window.electronAPI.createTeam(name));
});

document.getElementById('dropdown-join-team').addEventListener('click', function () {
  showInlineInput(this, 'Invite code', (code) => window.electronAPI.joinTeam(code));
});

// ============ GHOST MODE ============
window.electronAPI.onGhostMode((active) => {
  document.querySelector('.card').classList.toggle('ghost-mode', active);
});

// ============ DATA LISTENER ============
window.electronAPI.onStatsData((data) => updateUI(data));
