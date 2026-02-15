# Hyalos

> *hyalos (ὕαλος) — Greek for "glass"*

A transparent glass overlay for your desktop that shows real-time usage stats for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Know your limits before you hit them.

**Built by [Earthling Aid Tech](https://github.com/avinrique)**

![Hyalos](assets/screenshot.png)

## What It Shows

- **Session usage** — current session percentage with reset countdown
- **Weekly limits** — all models, Sonnet-only, and extra usage bars
- **Activity stats** — messages, tool calls, tokens (today / this week / all time)
- **Weekly chart** — bar chart of daily activity
- **System stats** — CPU and memory usage
- **Cost estimates** — based on token counts and model pricing

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and authenticated
- macOS (primary), Windows and Linux builds available
- `expect` command (pre-installed on macOS)

## Install

### Download

Grab the latest `.dmg` from [Releases](../../releases).

> **Note:** The app is unsigned. On first launch: right-click > **Open** > **Open** to bypass Gatekeeper.

### From Source

```bash
git clone https://github.com/avinrique/hyalos.git
cd hyalos
npm install
npm start
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Show / Hide | `Cmd+Shift+U` |
| Ghost mode (click-through) | `Cmd+Shift+G` |

## Controls

| Action | How |
|--------|-----|
| **Move** | Drag the title bar |
| **Expand** | Click anywhere on the collapsed bar |
| **Collapse** | Click the arrow button |
| **Switch theme** | Click theme button in footer (Dark / Light / Night) |
| **Pin / Unpin** | Pin button in footer |
| **Refresh** | Refresh button in footer or tray menu |

## Themes

- **Dark** — semi-transparent dark glass (default)
- **Light** — light background for bright environments
- **Night** — ultra-dim for late night coding

## How It Works

1. Runs `claude /usage` via PTY every 60s to get real rate-limit percentages
2. Reads `~/.claude/stats-cache.json` for aggregate activity data
3. Parses the latest session `.jsonl` for current token counts
4. Renders everything in a frameless, transparent overlay

## Build

```bash
npm run build:mac      # macOS (.dmg + .zip)
npm run build:win      # Windows (.exe)
npm run build:linux    # Linux (.AppImage + .deb)
```

## License

MIT — Earthling Aid Tech
