const { app, BrowserWindow, ipcMain, Tray, Menu, screen, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;
let tray;
let cachedUsage = null;

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const STATS_PATH = path.join(CLAUDE_DIR, 'stats-cache.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

const COLLAPSED_HEIGHT = 40;
const EXPANDED_HEIGHT = 340;

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
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
    let assistantMessages = 0, userMessages = 0, toolCalls = 0;
    let firstTimestamp = null, lastTimestamp = null, model = null;

    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (d.timestamp && !firstTimestamp) firstTimestamp = d.timestamp;
        if (d.timestamp) lastTimestamp = d.timestamp;
        if (d.type === 'user') userMessages++;
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
            if (block.type === 'tool_use') toolCalls++;
          }
        }
      } catch (e) {}
    }
    return { inputTokens: totalInput, outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead, cacheWriteTokens: totalCacheWrite,
      assistantMessages, userMessages, toolCalls, firstTimestamp, lastTimestamp, model };
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
}

// ============ WINDOW + TRAY ============

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

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray.setToolTip('Hyalos — Usage Glass');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show/Hide', click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() },
    { label: 'Refresh', click: () => refreshUsage() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

let clickThrough = false;

app.whenReady().then(async () => {
  createWindow();
  createTray();

  mainWindow.webContents.on('did-finish-load', async () => {
    sendAllData();
    refreshUsage();
  });

  // Cmd+Shift+U — show/hide overlay
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
});

ipcMain.on('close-app', () => mainWindow.hide());
ipcMain.on('refresh-data', () => refreshUsage());
ipcMain.on('toggle-expand', (_event, expanded) => {
  const [x, y] = mainWindow.getPosition();
  const [w] = mainWindow.getSize();
  mainWindow.setBounds({ x, y, width: w, height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT }, true);
});
ipcMain.on('toggle-pin', (event) => {
  const pinned = mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(!pinned);
  event.reply('pin-status', !pinned);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow) mainWindow.show(); });
