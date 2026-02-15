# Claude Usage Overlay

A lightweight desktop overlay that shows your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) usage stats in real-time. Always-on-top, draggable, and stays out of your way.

![Claude Usage Overlay](assets/screenshot.png)

## What It Shows

- **Session usage** — current session percentage with reset countdown
- **Weekly limits** — all models, Sonnet-only, and extra usage bars
- **Activity stats** — messages, tool calls, tokens (today / this week / all time)
- **Weekly chart** — bar chart of daily activity
- **System stats** — CPU and memory usage
- **Cost estimates** — based on token counts and model pricing

## Prerequisites

- **Claude Code CLI** installed and authenticated (`claude` command must work in your terminal)
- **macOS** (primary), Windows and Linux builds available but less tested
- `expect` command available (pre-installed on macOS)

## Install

### From Release (recommended)

Download the latest `.dmg` from [Releases](../../releases), open it, drag to Applications.

> **Note:** The app is unsigned. On first launch, right-click the app > **Open** > **Open** to bypass Gatekeeper.

### From Source

```bash
git clone https://github.com/YOUR_USERNAME/claude-usage-overlay.git
cd claude-usage-overlay
npm install
npm start
```

## Usage

The overlay appears in the top-right corner of your screen.

| Action | How |
|--------|-----|
| **Show/Hide** | `Cmd+Shift+U` (or tray icon) |
| **Ghost mode** (click-through) | `Cmd+Shift+G` |
| **Move** | Drag the title bar |
| **Expand/Collapse** | Click anywhere to expand, arrow button to collapse |
| **Switch theme** | Click theme button in footer (Dark / Light / Night) |
| **Pin/Unpin** | Pin button in footer |
| **Refresh** | Refresh button in footer (or tray menu) |

## How It Works

1. Spawns `claude /usage` via a PTY (using `expect`) every 60 seconds to get real rate-limit percentages
2. Reads `~/.claude/stats-cache.json` for aggregate activity data
3. Parses the latest `~/.claude/projects/**/*.jsonl` session file for current session tokens
4. Displays everything in a frameless, transparent Electron window

## Build

```bash
npm run build:mac      # macOS (.dmg + .zip)
npm run build:win      # Windows (.exe)
npm run build:linux    # Linux (.AppImage + .deb)
```

## Themes

Three built-in themes, switchable from the footer:

- **Dark** — default, semi-transparent dark glass
- **Light** — light background for bright environments
- **Night** — ultra-dim for late night coding

## License

MIT
