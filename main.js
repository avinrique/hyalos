const { app, BrowserWindow, ipcMain, Tray, Menu, screen, globalShortcut, safeStorage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');

let mainWindow;
let authWindow;
let adminWindow;
let tray;
let cachedUsage = null;
let authToken = null;
let currentUser = null;

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const STATS_PATH = path.join(CLAUDE_DIR, 'stats-cache.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const AUTH_PATH = path.join(app.getPath('userData'), 'auth.dat');

const API_BASE = 'http://localhost:3001';

const COLLAPSED_HEIGHT = 40;
const EXPANDED_HEIGHT = 340;

// ============ HTTP HELPER ============

function apiRequest(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_BASE);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = lib.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ error: 'Bad response' }); }
      });
    });

    req.on('error', () => resolve({ error: 'Connection failed' }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Request timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ============ AUTH TOKEN STORAGE (safeStorage) ============

function saveToken(token) {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(token);
      fs.writeFileSync(AUTH_PATH, encrypted);
    } else {
      fs.writeFileSync(AUTH_PATH, token, 'utf-8');
    }
  } catch { /* ignore */ }
}

function loadToken() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    const raw = fs.readFileSync(AUTH_PATH);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(raw);
    }
    return raw.toString('utf-8');
  } catch {
    return null;
  }
}

function clearToken() {
  try { fs.unlinkSync(AUTH_PATH); } catch { /* ignore */ }
  authToken = null;
  currentUser = null;
}

// ============ AUTH VALIDATION ============

async function validateToken(token) {
  const res = await apiRequest('GET', '/auth/me', null, token);
  if (res.user) {
    authToken = token;
    currentUser = res.user;
    return true;
  }
  return false;
}

// ============ FETCH REAL USAGE VIA `claude /usage` ============

function stripAnsi(str) {
  // Replace cursor-right movement (e.g. \x1b[1C) with a space (it acts as spacing in terminal)
  let s = str.replace(/\x1b\[\d*C/g, ' ');
  // Strip screen-clear and cursor-home sequences (TUI frameworks)
  s = s.replace(/\x1b\[2J/g, '');
  s = s.replace(/\x1b\[H/g, '');
  // Strip bracketed paste mode sequences
  s = s.replace(/\x1b\[\?200[0-9][hl]/g, '');
  // Strip remaining ANSI escape sequences
  s = s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  s = s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  s = s.replace(/\x1b[()][AB012]/g, '');
  s = s.replace(/\x1b\[?[0-9;]*[a-zA-Z]/g, '');
  // Strip Unicode block characters (progress bar fill)
  s = s.replace(/[█▓▒░▏▎▍▌▋▊▉]/g, '');
  // Strip control chars including \r, but keep \n
  s = s.replace(/[\x00-\x09\x0b-\x0c\x0e-\x1f]/g, '');
  s = s.replace(/\r/g, '');
  // Collapse multiple spaces into one
  s = s.replace(/ {2,}/g, ' ');
  return s;
}

function parseUsageOutput(raw) {
  const clean = stripAnsi(raw);
  const result = {};

  // Current session: X% used
  const sessionMatch = clean.match(/Current session[^%]*?(\d+)%\s*used/);
  if (sessionMatch) result.sessionPct = parseInt(sessionMatch[1]);

  // Session reset: may appear as "Rese s" (mangled by ANSI cursor codes) or "Resets"
  const sessionResetMatch = clean.match(/Current session[\s\S]*?%\s*used[\s\S]*?Rese\s*s\s+([^\n]+)/);
  if (sessionResetMatch) {
    result.sessionReset = 'Resets ' + sessionResetMatch[1].trim();
  }

  // Current week (all models): X% used
  const weekAllMatch = clean.match(/Current week \(all models\)[^%]*?(\d+)%\s*used/);
  if (weekAllMatch) result.weekAllPct = parseInt(weekAllMatch[1]);

  const weekAllResetMatch = clean.match(/Current week \(all models\)[\s\S]*?Resets\s+([^\n]+)/);
  if (weekAllResetMatch) result.weekAllReset = weekAllResetMatch[1].trim();

  // Current week (Sonnet only): X% used
  const weekSonnetMatch = clean.match(/Current week \(Sonnet only\)[^%]*?(\d+)%\s*used/);
  if (weekSonnetMatch) result.weekSonnetPct = parseInt(weekSonnetMatch[1]);

  const weekSonnetResetMatch = clean.match(/Current week \(Sonnet only\)[\s\S]*?Resets\s+([^\n]+)/);
  if (weekSonnetResetMatch) result.weekSonnetReset = weekSonnetResetMatch[1].trim();

  // Extra usage: X% used, $X.XX / $Y.YY spent
  const extraMatch = clean.match(/Extra usage[^%]*?(\d+)%\s*used/);
  if (extraMatch) result.extraPct = parseInt(extraMatch[1]);

  const extraSpentMatch = clean.match(/\$([0-9.]+)\s*\/\s*\$([0-9.]+)\s*spent/);
  if (extraSpentMatch) {
    result.extraSpent = parseFloat(extraSpentMatch[1]);
    result.extraLimit = parseFloat(extraSpentMatch[2]);
  }

  const extraResetMatch = clean.match(/Extra usage[\s\S]*?Resets\s+([^\n(]+)/);
  if (extraResetMatch) result.extraReset = extraResetMatch[1].trim();

  // Strip timezone parenthetical from reset strings
  for (const key of ['sessionReset', 'weekAllReset', 'weekSonnetReset', 'extraReset']) {
    if (result[key]) result[key] = result[key].replace(/\s*\([^)]+\)\s*$/, '').trim();
  }

  // Only return if we got at least session data
  if (result.sessionPct !== undefined) return result;
  return null;
}

function fetchClaudeUsage() {
  return new Promise((resolve) => {
    let output = '';
    let resolved = false;

    const done = (data) => {
      if (resolved) return;
      resolved = true;
      resolve(data);
    };

    // Build a clean env without CLAUDECODE (which blocks nesting)
    const cleanEnv = { ...process.env, TERM: 'xterm-256color' };
    delete cleanEnv.CLAUDECODE;
    // Ensure common install paths are in PATH (Electron launched from Finder may lack them)
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', path.join(os.homedir(), '.nix-profile/bin')];
    cleanEnv.PATH = extraPaths.join(':') + ':' + (cleanEnv.PATH || '');

    // Use `expect` to allocate a proper PTY (works from Electron, unlike `script`)
    // Note: ANSI codes insert cursor-move sequences between words, so match partial text
    const expectScript = `
      set timeout 25
      spawn claude /usage
      expect {
        "trust" {
          sleep 1
          send "\\r"
          exp_continue
        }
        "Current session" {
          sleep 8
        }
        timeout {}
        eof {}
      }
    `;

    const proc = spawn('expect', ['-c', expectScript], {
      cwd: os.homedir(),
      env: cleanEnv,
    });

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr.on('data', () => {}); // suppress

    proc.on('close', () => {
      const parsed = parseUsageOutput(output);
      done(parsed);
    });

    proc.on('error', () => {
      done(null);
    });

    // Timeout after 40 seconds — kill process but let close handler parse output
    setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch (e) {}
      // Give close handler 2s to fire and parse output before fallback
      setTimeout(() => done(null), 2000);
    }, 40000);
  });
}

// ============ LOCAL DATA (stats + session) ============

function getStatsData() {
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function findLatestSessionFile() {
  try {
    let latestFile = null;
    let latestMtime = 0;
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const dirPath = path.join(PROJECTS_DIR, dir);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      for (const file of fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'))) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        // Skip tiny stubs (<500 bytes) — these are created by `claude /usage` spawns
        if (stat.size < 500) continue;
        if (stat.mtimeMs > latestMtime) { latestMtime = stat.mtimeMs; latestFile = filePath; }
      }
    }
    return latestFile;
  } catch (err) {
    return null;
  }
}

function getCurrentSessionData() {
  const filePath = findLatestSessionFile();
  if (!filePath) return null;
  try {
    const fileStat = fs.statSync(filePath);
    const fileAge = Date.now() - fileStat.mtimeMs;
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
    let assistantMessages = 0, userMessages = 0, toolCalls = 0;
    let firstTimestamp = null, lastTimestamp = null, model = null;
    let lastMessageType = null;
    // Track pending tool_use IDs that haven't received results yet
    let pendingToolIds = new Set();

    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (d.timestamp && !firstTimestamp) firstTimestamp = d.timestamp;
        if (d.timestamp) lastTimestamp = d.timestamp;
        if (d.type === 'user') { userMessages++; pendingToolIds.clear(); }
        if (d.type) lastMessageType = d.type;
        const msg = d.message || {};
        if (msg.usage) {
          totalInput += msg.usage.input_tokens || 0;
          totalOutput += msg.usage.output_tokens || 0;
          totalCacheRead += msg.usage.cache_read_input_tokens || 0;
          totalCacheWrite += msg.usage.cache_creation_input_tokens || 0;
          assistantMessages++;
        }
        if (msg.model) model = msg.model;
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_use') { toolCalls++; pendingToolIds.add(block.id); }
            if (block.type === 'tool_result') pendingToolIds.delete(block.tool_use_id);
          }
        }
        // Also check top-level tool_result (some formats put it at message level)
        if (d.type === 'result' && d.tool_use_id) pendingToolIds.delete(d.tool_use_id);
        if (msg.type === 'tool_result' && msg.tool_use_id) pendingToolIds.delete(msg.tool_use_id);
      } catch (e) {}
    }

    const hasPendingTools = pendingToolIds.size > 0;
    // Waiting for input: last message is assistant + file idle 3s+
    // Waiting for tool approval: there are unresolved tool_use calls + file idle 3s+
    const waitingForInput = fileAge > 3000 && (lastMessageType === 'assistant' || hasPendingTools);
    const waitingReason = waitingForInput
      ? (hasPendingTools ? 'Tool confirmation needed' : 'Waiting for your input')
      : null;

    return { inputTokens: totalInput, outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead, cacheWriteTokens: totalCacheWrite,
      assistantMessages, userMessages, toolCalls, firstTimestamp, lastTimestamp, model,
      waitingForInput, waitingReason };
  } catch (err) {
    return null;
  }
}

// ============ SYSTEM STATS ============

let lastCpuInfo = os.cpus().map((c) => ({ ...c.times }));

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  for (let i = 0; i < cpus.length; i++) {
    const prev = lastCpuInfo[i] || { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const curr = cpus[i].times;
    const idleDiff = curr.idle - prev.idle;
    const totalDiff = (curr.user - prev.user) + (curr.nice - prev.nice) +
      (curr.sys - prev.sys) + (curr.idle - prev.idle) + (curr.irq - prev.irq);
    totalIdle += idleDiff;
    totalTick += totalDiff;
  }
  lastCpuInfo = cpus.map((c) => ({ ...c.times }));
  return totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
}

function getMemUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return { usedPct: Math.round((used / total) * 100), usedGB: (used / 1e9).toFixed(1), totalGB: (total / 1e9).toFixed(1) };
}

// ============ CLOUD SYNC ============

function buildSnapshot() {
  const session = getCurrentSessionData();
  const stats = getStatsData();
  const today = new Date().toISOString().slice(0, 10);
  const todayActivity = (stats?.dailyActivity || []).find((d) => d.date === today);

  return {
    sessionPct: cachedUsage?.sessionPct ?? null,
    weekAllPct: cachedUsage?.weekAllPct ?? null,
    weekSonnetPct: cachedUsage?.weekSonnetPct ?? null,
    extraPct: cachedUsage?.extraPct ?? null,
    sessionInputTokens: session?.inputTokens ?? 0,
    sessionOutputTokens: session?.outputTokens ?? 0,
    sessionCacheReadTokens: session?.cacheReadTokens ?? 0,
    sessionCacheWriteTokens: session?.cacheWriteTokens ?? 0,
    messages: session ? (session.userMessages + session.assistantMessages) : 0,
    toolCalls: session?.toolCalls ?? 0,
    model: session?.model ?? null,
    totalSessions: stats?.totalSessions ?? 0,
    totalMessages: stats?.totalMessages ?? 0,
    todayMessages: todayActivity?.messageCount ?? 0,
    estimatedCostUsd: 0,
    lastActive: session?.lastTimestamp ?? null,
  };
}

function syncToCloud() {
  if (!authToken) return;
  const snapshot = buildSnapshot();
  apiRequest('POST', '/usage/sync', snapshot, authToken).catch(() => {});
}

// ============ SEND DATA TO RENDERER ============

async function sendAllData() {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('stats-data', {
      stats: getStatsData(),
      session: getCurrentSessionData(),
      usage: cachedUsage,
      system: { cpu: getCpuUsage(), mem: getMemUsage() },
    });
  } catch (e) { /* window not ready yet */ }
}

async function refreshUsage() {
  const usage = await fetchClaudeUsage();
  if (usage) cachedUsage = usage;
  sendAllData();
  // Fire-and-forget cloud sync
  syncToCloud();
}

// ============ WINDOWS ============

function createWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: 220, height: EXPANDED_HEIGHT,
    x: screenWidth - 235, y: 10,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true, hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.on('will-move', () => mainWindow.setOpacity(0.8));
  mainWindow.on('moved', () => mainWindow.setOpacity(1.0));
}

function createAuthWindow() {
  authWindow = new BrowserWindow({
    width: 340, height: 440,
    center: true,
    frame: true, transparent: false, alwaysOnTop: false,
    resizable: false, minimizable: false,
    title: 'Hyalos — Sign In',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  authWindow.loadFile(path.join(__dirname, 'renderer', 'auth.html'));
  authWindow.on('closed', () => { authWindow = null; });
}

function createAdminWindow() {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.focus();
    return;
  }
  adminWindow = new BrowserWindow({
    width: 700, height: 500,
    center: true,
    frame: true, transparent: false, alwaysOnTop: false,
    resizable: true, minimizable: true,
    title: 'Hyalos — Admin Dashboard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  adminWindow.loadFile(path.join(__dirname, 'renderer', 'admin.html'));
  adminWindow.on('closed', () => { adminWindow = null; });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray.setToolTip('Hyalos — Usage Glass');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show/Hide', click: () => mainWindow && (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()) },
    { label: 'Refresh', click: () => refreshUsage() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// ============ APP STARTUP ============

let clickThrough = false;

async function startApp() {
  createTray();

  // Try to restore auth
  const savedToken = loadToken();
  if (savedToken) {
    const valid = await validateToken(savedToken);
    if (valid) {
      openOverlay();
      return;
    }
  }

  // No valid token — show auth window
  createAuthWindow();
}

function openOverlay() {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
    authWindow = null;
  }

  createWindow();

  mainWindow.webContents.on('did-finish-load', async () => {
    sendAllData();
    refreshUsage();
  });

  // Cmd+Shift+U — show/hide overlay
  try { globalShortcut.unregisterAll(); } catch {}
  globalShortcut.register('CommandOrControl+Shift+U', () => {
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });

  // Cmd+Shift+G — toggle click-through (ghost mode)
  globalShortcut.register('CommandOrControl+Shift+G', () => {
    clickThrough = !clickThrough;
    mainWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
    mainWindow.setOpacity(clickThrough ? 0.4 : 1.0);
    mainWindow.webContents.send('ghost-mode', clickThrough);
  });

  setInterval(refreshUsage, 60000);
  setInterval(sendAllData, 5000);
}

app.whenReady().then(startApp);

// ============ IPC: EXISTING ============

ipcMain.on('close-app', () => { if (mainWindow) mainWindow.hide(); });
ipcMain.on('refresh-data', () => refreshUsage());
ipcMain.on('toggle-expand', (_event, expanded) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [x, y] = mainWindow.getPosition();
  const [w] = mainWindow.getSize();
  mainWindow.setBounds({ x, y, width: w, height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT }, true);
});
ipcMain.on('toggle-pin', (event) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const pinned = mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(!pinned);
  event.reply('pin-status', !pinned);
});

// ============ IPC: AUTH ============

ipcMain.handle('login', async (_event, email, password) => {
  const res = await apiRequest('POST', '/auth/login', { email, password });
  if (res.token) {
    authToken = res.token;
    currentUser = res.user;
    saveToken(authToken);
    openOverlay();
    return { user: res.user };
  }
  return { error: res.error || 'Login failed' };
});

ipcMain.handle('register', async (_event, email, password, name) => {
  const res = await apiRequest('POST', '/auth/register', { email, password, name });
  if (res.token) {
    authToken = res.token;
    currentUser = res.user;
    saveToken(authToken);
    openOverlay();
    return { user: res.user };
  }
  return { error: res.error || 'Registration failed' };
});

ipcMain.handle('logout', async () => {
  clearToken();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  if (adminWindow && !adminWindow.isDestroyed()) adminWindow.close();
  mainWindow = null;
  createAuthWindow();
  return { ok: true };
});

ipcMain.handle('getAuthState', async () => {
  return { loggedIn: !!authToken, user: currentUser };
});

// ============ IPC: TEAMS ============

ipcMain.handle('getMyTeams', async () => {
  const res = await apiRequest('GET', '/teams/mine', null, authToken);
  return res.teams || [];
});

ipcMain.handle('createTeam', async (_event, name) => {
  const res = await apiRequest('POST', '/teams', { name }, authToken);
  return res.team ? { team: res.team } : { error: res.error || 'Failed' };
});

ipcMain.handle('joinTeam', async (_event, code) => {
  const res = await apiRequest('POST', '/teams/join', { code }, authToken);
  return res.team ? { team: res.team } : { error: res.error || 'Failed' };
});

ipcMain.handle('getTeamMembers', async (_event, teamId) => {
  const res = await apiRequest('GET', `/teams/${teamId}/members`, null, authToken);
  return res.members || [];
});

// ============ IPC: NAV ============

ipcMain.handle('openAdmin', () => {
  createAdminWindow();
  return { ok: true };
});

// ============ APP LIFECYCLE ============

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else if (authWindow) authWindow.show();
});
