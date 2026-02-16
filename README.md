# Hyalos

> *hyalos (ὕαλος) — Greek for "glass"*

A transparent glass overlay for your desktop that shows real-time usage stats for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Know your limits before you hit them. Now with cloud sync, teams, and an admin dashboard.

**Built by [Earthling Aid Tech](https://github.com/avinrique)**

![Hyalos](assets/screenshot.png)

## Features

### Overlay
- **Session usage** — current session percentage with reset countdown
- **Weekly limits** — all models, Sonnet-only, and extra usage bars
- **Activity stats** — messages, tool calls, tokens (today / this week / all time)
- **Weekly chart** — bar chart of daily activity
- **System stats** — CPU and memory usage
- **Cost estimates** — based on token counts and model pricing
- **Input notification** — pulsing yellow alert when Claude Code is waiting for your input or tool confirmation

### Cloud & Teams (Phase 2)
- **User accounts** — email + password auth with encrypted token storage
- **Cloud sync** — usage snapshots upload every 60s automatically
- **Teams** — create teams, invite members via invite code
- **Admin dashboard** — live team-wide usage stats (session %, weekly %, tokens, last active)
- **Role management** — admin and member roles per team

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI installed and authenticated
- macOS (primary), Windows and Linux builds available
- `expect` command (pre-installed on macOS)
- **For cloud features:** PostgreSQL and Node.js

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

### Cloud Setup (optional)

Cloud sync, teams, and the admin dashboard require the backend server:

```bash
# 1. Install and start PostgreSQL
brew install postgresql@17
brew services start postgresql@17

# 2. Create database
createdb hyalos

# 3. Configure server
cp server/.env.example server/.env
# Edit server/.env — set DB_URL, JWT_SECRET, PORT

# 4. Install dependencies and run migration
cd server
npm install
npm run migrate

# 5. Start the API server
npm start
# → Hyalos API running on port 3001
```

Then launch the Electron app (`npm start` from root). It will show a login screen — register an account and the overlay opens with cloud sync enabled.

#### Environment Variables (`server/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_URL` | PostgreSQL connection string | `postgres://localhost:5432/hyalos` |
| `JWT_SECRET` | Secret key for signing JWT tokens | — |
| `PORT` | API server port | `3001` |

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
| **User menu** | Click user icon in footer — teams, admin dashboard, logout |

## Teams & Admin

1. **Create a team** — user icon > "+ Create Team" > enter a name
2. **Share invite code** — give your team the 8-character code
3. **Members join** — user icon > "+ Join Team" > paste code
4. **Admin dashboard** — user icon > "Admin Dashboard" (admins only)
   - See all members' session %, weekly %, tokens, last active
   - Auto-refreshes every 30 seconds
   - Copy invite code to share

## Themes

- **Dark** — semi-transparent dark glass (default)
- **Light** — light background for bright environments
- **Night** — ultra-dim for late night coding

## How It Works

1. Runs `claude /usage` via PTY every 60s to get real rate-limit percentages
2. Reads `~/.claude/stats-cache.json` for aggregate activity data
3. Parses the latest session `.jsonl` for current token counts and input-waiting state
4. Syncs snapshots to the cloud API (if logged in)
5. Renders everything in a frameless, transparent overlay

## Architecture

```
Electron App                    Node.js API (Express)           PostgreSQL
┌─────────────┐    HTTPS/JWT    ┌──────────────┐               ┌──────────┐
│ Auth Window  │ ──────────────→│ /auth/*      │──────────────→│ users    │
│ Overlay      │ ──────────────→│ /usage/sync  │──────────────→│ snapshots│
│ Admin Window │ ──────────────→│ /teams/*     │──────────────→│ teams    │
└─────────────┘                 └──────────────┘               └──────────┘
```

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | — | Create account |
| POST | `/auth/login` | — | Sign in |
| GET | `/auth/me` | JWT | Get profile |
| POST | `/usage/sync` | JWT | Upload usage snapshot |
| GET | `/usage/history` | JWT | Get own snapshot history |
| POST | `/teams` | JWT | Create team |
| POST | `/teams/join` | JWT | Join by invite code |
| GET | `/teams/mine` | JWT | List your teams |
| GET | `/teams/:id/members` | JWT + Admin | Get team members + stats |
| DELETE | `/teams/:id/members/:uid` | JWT + Admin | Remove member |
| PATCH | `/teams/:id/members/:uid` | JWT + Admin | Change role |

## Build

```bash
npm run build:mac      # macOS (.dmg + .zip)
npm run build:win      # Windows (.exe)
npm run build:linux    # Linux (.AppImage + .deb)
```

## License

MIT — Earthling Aid Tech
