# Engagr

**AI-powered engagement assistant:** Chrome Extension parses LinkedIn, X, and Reddit → Groq generates comment variants → you approve in Telegram Mini App → Extension posts comments, likes, and connections.

👉 **Bot:** [@Engagr_bot](https://t.me/Engagr_bot)

📋 **Development plan:** [PROJECT_PLAN.md](PROJECT_PLAN.md) — source of truth for architecture, phases, and task checklist.

---

## How it works

```mermaid
flowchart LR
    EXT[Chrome Extension<br/>parse + execute]
    API[Railway Backend<br/>AI + queue]
    TG[Telegram Mini App<br/>approve / edit]
    EXT -->|new posts| API
    API -->|variants + queue| TG
    TG -->|approve| EXT
```

1. **Extension** scans open tabs every 15 minutes (LinkedIn, X, Reddit) and pushes new posts to the backend.
2. **Backend** (Railway) generates AI comment variants, stores the queue, sends Telegram notifications.
3. **Mini App** shows posts — edit, regenerate, approve, or skip.
4. **Extension** executes approved actions in the browser (comment, like, connect/follow).

**Reddit** is also discoverable via backend scheduler (public JSON) when the browser is closed.

**Human approve is required** before any action — this is intentional for account safety.

---

## Stack

| Component | Tech | Role |
|-----------|------|------|
| Backend | Python 3.11, Flask, APScheduler | API, AI, queue, Telegram bot |
| Frontend | React, Vite | Telegram Mini App |
| Extension | Chrome MV3 | DOM parsing + action execution |
| AI | Groq (llama-3.3-70b) | Comment generation |
| Deploy | Railway (API), Vercel (frontend) | Production |

---

## Quick start

### Requirements

- Python 3.11+
- Node.js 18+
- Telegram bot token ([@BotFather](https://t.me/BotFather))
- Groq API key

### Install

```bash
git clone https://github.com/Leks2000/Engagr.git
cd Engagr

pip install -r requirements.txt

cd frontend && npm install && npm run build && cd ..
```

### Environment

```bash
cp .env.example .env
```

```env
TELEGRAM_BOT_TOKEN=your_bot_token
GROQ_API_KEY=your_groq_key
MINI_APP_URL=https://your-frontend-url.com
```

### Run

```bash
python backend/main.py
```

Frontend dev server:

```bash
cd frontend && npm run dev
```

### Chrome Extension

1. Open `chrome://extensions` → **Developer mode** → **Load unpacked** → select `extension/`
2. In Mini App → **Settings** → generate extension login code (5 min)
3. Paste code in extension popup → **Connect**
4. Keep social tabs open for auto-scan

---

## Project structure

```text
Engagr/
├── PROJECT_PLAN.md      ← development roadmap (read this first)
├── backend/
│   ├── main.py          Flask API + routes
│   ├── scheduler.py     Reddit/LinkedIn scheduled sessions
│   ├── ai_comment.py    Groq comment generation
│   ├── telegram_bot.py  Bot commands + queue cards
│   ├── reddit_public.py Reddit parsing (no OAuth)
│   ├── linkedin.py      LinkedIn API (cookie-based, fallback)
│   └── queue_executor.py Server-side execution (Reddit/LinkedIn legacy)
├── extension/src/
│   ├── background.js    Auto-scan (15 min) + task polling
│   ├── linkedin_parser.js, x_parser.js, reddit_parser.js
│   └── linkedin_actions.js, x_actions.js
├── frontend/src/
│   ├── App.jsx
│   └── screens/         Dashboard, Queue, Settings, …
└── data/                Per-user JSON (gitignored)
```

---

## Mini App (target navigation)

| Tab | Purpose |
|-----|---------|
| **Feed** | All posts + execution status |
| **Queue** | Pending items — approve / edit / skip |
| **Settings** | Platforms, keywords, limits, extension code |
| **Profile** | User Memory for AI personalization |

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for implementation phases.

---

## Daily limits

| Platform | Comments | Likes / Upvotes | Connections |
|----------|----------|-----------------|-------------|
| LinkedIn | 15/day | 5/day | 5/day |
| Reddit | 15/day | 5/day | — |
| X | 15/day | 5/day | Follow via extension |

Warm-up mode and random delays between actions are enabled by default.

---

## Bot commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome + setup |
| `/queue` | Pending comments |
| `/dashboard` | Today's stats |
| `/settings` | Open Mini App |
| `/pause` / `/resume` | Pause/resume automation |

---

## Railway deployment

The active MVP flow is intentionally simple and approval-first:

```mermaid
flowchart LR
    FOUND[Post found] --> FEED[Mini App Feed]
    FEED --> VARIANTS[Generated variants]
    VARIANTS --> APPROVE[User selects + approves]
    APPROVE --> EXT[Chrome Extension executes]
    EXT --> STATUS[Status updates in Feed]
```

Advanced features such as Ideas Engine, analytics, relevance scoring, and smart filtering are not part of the primary navigation until this cycle is stable end-to-end.


1. Push to GitHub
2. [railway.app](https://railway.app) → Deploy from GitHub
3. Set env vars (`TELEGRAM_BOT_TOKEN`, `GROQ_API_KEY`, `MINI_APP_URL`)
4. Health check: `/health`

---

## Project progress

This section mirrors the active roadmap in [PROJECT_PLAN.md](PROJECT_PLAN.md) so progress is visible from the repository front page.

### Done

- ✅ Phase 0: posts can flow into the queue, generate AI variants, and be approved.
- ✅ Phase 1: approved actions are executed by the Chrome extension with status updates.
- ✅ Phase 2: like/upvote and connect/follow actions are part of the approved action chain.
- ✅ Reddit backend discovery exists as the reference fallback model via public JSON.
- ✅ Stage 7 research and implementation plan for X/LinkedIn backend discovery has been documented.

### In progress / next

- ⏳ Phase 3: simplify Mini App navigation to Feed · Queue · Settings · Profile.
- ⏳ Stage 7.2: add `backend/x_public.py` with provider modes `mcp`, `twitterapi`, and `off`, plus `seen_x.json` dedupe and keyword/relevance handoff.
- ⏳ Stage 7.4: add `backend/linkedin_mcp.py` using Browser MCP only, with `seen_linkedin.json` dedupe.
- ⏳ Stage 7.5: wire X and LinkedIn discovery into the scheduler with conservative intervals and provider settings.
- ⏳ Stage 7.7–7.8: add Morning Brief and batch approve.
- ⏳ Stage 7.9: add default-off semi-autopilot with trust threshold and daily cap.
- ⏳ Stage 7.10: add engagement tracking feedback loop into interaction memory.
- ⏳ Stage 7.11: add tests and smoke checks for new discovery modules.

### Safety stance

- Human approval stays required by default.
- X and LinkedIn execution stays in the user's browser through the extension.
- LinkedIn backend discovery is planned only through Browser MCP, not direct Voyager/cookie scraping.
- Backend discovery modules must dedupe and respect daily limits before queueing items.

---

## License

MIT
