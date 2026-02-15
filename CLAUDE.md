# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An Electron desktop overlay app that displays Claude Code usage statistics as an always-on-top floating widget. It shows session usage percentages, weekly limits, token counts, cost estimates, and activity charts.

## Commands

- `npm start` — Run the app (launches Electron)
- `npm run build:mac` — Build for macOS (dmg + zip)
- `npm run build:win` — Build for Windows (nsis + portable)
- `npm run build:linux` — Build for Linux (AppImage + deb)

No test suite exists. No linter is configured.

## Architecture

### Data Sources (main.js)

The app pulls data from two sources:

1. **`claude /usage` CLI command** — Spawned via `expect` (to get a PTY) to fetch real rate-limit percentages (session %, weekly all-models %, weekly Sonnet-only %, extra usage). The raw output contains heavy ANSI escape sequences that `stripAnsi()` cleans before `parseUsageOutput()` regex-parses the percentages and reset times. This runs every 60 seconds and is cached in `cachedUsage`.

2. **Local `~/.claude/` filesystem** — Two paths are read directly:
   - `~/.claude/stats-cache.json` — Aggregate stats (total sessions, messages, daily activity, model usage with token breakdowns)
   - `~/.claude/projects/**/*.jsonl` — Session transcript files. The app finds the most recently modified `.jsonl` and parses each JSON line to sum tokens (input/output/cache-read/cache-write), count messages and tool calls, and extract the model name.

### IPC Flow

- **Main process** (`main.js`) gathers data and sends it to renderer via `mainWindow.webContents.send('stats-data', {...})`
- **Preload** (`preload.js`) exposes `electronAPI` bridge with `onStatsData`, `closeApp`, `refreshData`, `toggleExpand`, `togglePin`
- **Renderer** (`renderer/app.js`) receives data in `updateUI()` and updates DOM directly (no framework)

### UI States

The window has two states controlled by `toggle-expand` IPC:
- **Collapsed** (72px height) — Shows session progress bar, model name, expand/close buttons
- **Expanded** (620px height) — Shows full dashboard: session details, weekly limits, today/week/all-time stats, bar chart, model list

### Cost Estimation (renderer/app.js)

`getModelRates()` returns per-million-token pricing for Opus/Sonnet/Haiku. `estimateCost()` uses `costUSD` from stats if available, otherwise calculates from token counts. Session percentage is estimated against a ~$290 cap (calibrated for Max plan with Opus) when real `/usage` data isn't available yet.

### Window Behavior

- Frameless, transparent, always-on-top, visible on all workspaces
- Positioned at top-right of screen (screenWidth - 320, y: 20)
- Opacity drops to 0.8 while dragging
- System tray icon with Show/Hide, Refresh, Quit menu
- `CLAUDECODE` env var is deleted from spawned processes to avoid nesting detection
