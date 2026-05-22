# Engagr

**Telegram Mini App + Bot for LinkedIn & Reddit engagement automation.**

Semi-automated social engagement powered by AI. Copy-to-clipboard workflow ensures zero ban risk while maximizing your LinkedIn & Reddit presence.

---

## Architecture: Semi-Automation (Copy-to-Clipboard)

Unlike risky full-automation tools, Engagr uses a **safe semi-automated approach**:

1. **AI generates** personalized comments, invite messages, and replies
2. **User copies** the text to clipboard with one tap
3. **App opens** the target post/profile via deep link
4. **User pastes** and submits natively in LinkedIn/Reddit

**Why this is the best approach:**
- **Safety (10/10):** Zero ban risk — actions are performed by a real human from their native app
- **Maintenance (10/10):** No dependency on LinkedIn's UI/DOM — works regardless of interface changes
- **Cross-platform:** Works on iOS, Android, and desktop via Telegram

---

## Features

- **AI Comment Generation** — Groq (llama-3.3-70b-versatile) generates genuine, human-sounding comments (3 variants per post)
- **Copy-to-Clipboard Workflow** — One-tap copy + deep link to LinkedIn/Reddit post
- **Invite Generator** — AI-crafted connection requests (max 300 chars) with copy + profile link
- **Humanness Scoring** — Filters out AI-generated posts (no point commenting on robots)
- **Interaction Memory (CRM)** — Remembers previous conversations with authors
- **News Jacking** — Monitors HackerNews/TechCrunch/ProductHunt for early commenting opportunities
- **Daily Digest** — Top 3 posts delivered to Telegram with ready-to-use comments
- **Nested Reply Tracking** — Detects replies to your comments, generates follow-up responses
- **Smart Schedule** — AI calculates optimal posting times based on engagement patterns
- **Warm-up Mode** — Gradually increases daily activity to avoid detection
- **Multi-language** — Full i18n support (EN, RU, ES, DE)
- **Telegram Bot Fallback** — Approve/edit/skip comments directly in chat

---

## Quick Start

### 1. Prerequisites

- Python 3.11+
- Node.js 18+
- A Telegram bot (via [@BotFather](https://t.me/BotFather))

### 2. Clone & Install

```bash
git clone https://github.com/Leks2000/Engagr.git
cd Engagr

# Backend
pip install -r requirements.txt

# Frontend
cd frontend
npm install
npm run build
cd ..
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
GROQ_API_KEY=your_groq_api_key
MINI_APP_URL=https://your-deployed-frontend-url.com
```

### 4. Run Locally

```bash
python backend/main.py
```

The bot starts polling Telegram, Flask API runs on port 5000, and the scheduler activates.

For frontend development:

```bash
cd frontend
npm run dev
```

---

## Project Structure

```
engagr/
├── backend/
│   ├── main.py               # Entry point: Flask API + Telegram bot + scheduler
│   ├── config.py             # Environment vars, constants, daily limits
│   ├── storage.py            # JSON-based per-user data storage
│   ├── ai_comment.py         # Groq API comment generation (3 variants + translation)
│   ├── linkedin.py           # LinkedIn API integration (OAuth + cookie)
│   ├── reddit_bot.py         # Reddit via asyncpraw
│   ├── scheduler.py          # APScheduler session management
│   ├── telegram_bot.py       # Telegram bot commands & approval flow
│   ├── humanness_scorer.py   # AI post detection & filtering
│   ├── interaction_memory.py # CRM: tracks interactions with authors
│   ├── invite_generator.py   # LinkedIn invite message generator (300 char)
│   ├── daily_digest.py       # Daily top-3 posts digest for Telegram
│   ├── nested_replies.py     # Tracks replies to our comments
│   ├── news_grounding.py     # HackerNews/TechCrunch/PH aggregator
│   ├── smart_schedule.py     # Optimal posting time calculator
│   └── setup.py              # LinkedIn login cookie helper
├── frontend/
│   ├── src/
│   │   ├── App.jsx           # Root component + routing
│   │   ├── screens/
│   │   │   ├── Onboarding.jsx
│   │   │   ├── Dashboard.jsx     # Stats, analytics, smart schedule
│   │   │   ├── Queue.jsx         # Semi-auto comment queue
│   │   │   ├── LinkedInSettings.jsx
│   │   │   └── RedditSettings.jsx
│   │   └── components/
│   │       ├── Card.jsx      # Queue card with copy/like/invite buttons
│   │       ├── Slider.jsx
│   │       ├── TagInput.jsx
│   │       └── Toggle.jsx
│   ├── index.html
│   ├── tailwind.config.js
│   └── vite.config.js
├── data/                     # Auto-created: per-user JSON storage
├── .env.example
├── requirements.txt
├── railway.toml
└── README.md
```

---

## Semi-Auto Workflow (Queue Card Actions)

Each post in the queue shows:

| Button | Action |
|--------|--------|
| **💬 Copy & Open** | Copies selected AI comment to clipboard → opens LinkedIn post deep link |
| **👍 Like** | Opens post for quick reaction |
| **🤝 Invite** | Generates 300-char invite → copies to clipboard → opens author profile |
| **✏️ Edit** | Modify the AI comment before copying |
| **🔄 Regen** | Generate a new comment variant |
| **✕ Skip** | Remove post from queue |

---

## Daily Limits (Hard Caps)

| Platform | Action     | Max/Day |
|----------|-----------|---------|
| LinkedIn | Comments   | 15      |
| LinkedIn | Likes      | 5       |
| LinkedIn | Connections| 5       |
| Reddit   | Comments   | 15      |
| Reddit   | Upvotes    | 5       |

---

## Anti-spam Delays

| Action             | Delay Range     |
|--------------------|-----------------|
| Between comments   | 5–30 minutes    |
| Between likes      | 2–7 minutes     |
| Between connections| 3–10 minutes    |

---

## Bot Commands

| Command       | Description                |
|---------------|----------------------------|
| `/start`      | Welcome + setup            |
| `/dashboard`  | Today's stats              |
| `/queue`      | Pending comments           |
| `/settings`   | Open Mini App settings     |
| `/digest`     | Get daily top-3 posts      |
| `/connections`| View networking CRM        |
| `/linkedin`   | LinkedIn setup guide       |
| `/reddit`     | Reddit setup guide         |
| `/pause`      | Pause all sessions         |
| `/resume`     | Resume sessions            |

---

## Key Killer Features

### 1. Humanness Scorer
Posts are analyzed for AI-generated patterns (cliches, emoji spam, engagement bait). Only genuinely human posts appear in your queue.

### 2. Interaction Memory (CRM)
The app remembers who you've engaged with before. When the same author posts again, you get a notification: "You've interacted with them 3 times before. Keep building this relationship!"

### 3. News Jacking
First comments under viral posts get 90% of views. The system monitors RSS feeds and alerts you to trending topics matching your keywords.

### 4. Nested Conversation Booster
When someone replies to your AI comment, the app generates a follow-up reply to keep the conversation going and convert leads.

### 5. Daily Digest
Every morning, you receive 3 top posts with ready-made comments in Telegram. One tap to copy + open.

---

## Railway Deployment

1. Push to GitHub
2. Deploy on [railway.app](https://railway.app) → Deploy from GitHub
3. Add environment variables
4. Railway auto-deploys using `railway.toml`

---

## License

MIT
