# Engagr

**Telegram Mini App + Bot for LinkedIn & Reddit engagement automation.**

Automate your social media engagement with AI-powered comments, smart scheduling, and full approval control via Telegram.

---

## Features

- 🤖 **AI Comment Generation** — Groq (llama-3.3-70b-versatile) generates genuine, human-sounding comments
- 🔗 **LinkedIn Automation** — Comment, like, and connect with people via Playwright
- 🧡 **Reddit Automation** — Comment and upvote via PRAW API
- 📱 **Telegram Mini App** — Beautiful mobile UI for settings, dashboard, and queue management
- 💬 **Telegram Bot Fallback** — Approve/edit/skip comments directly in chat
- ⏰ **Smart Scheduling** — Up to 3 session times per day per platform
- 🛡️ **Anti-spam Protection** — Random delays, daily hard limits, jittered timing
- 👥 **Multi-user Ready** — All data keyed by Telegram user ID

---

## Quick Start

### 1. Prerequisites

- Python 3.11+
- Node.js 18+
- A Telegram bot (via [@BotFather](https://t.me/BotFather))

### 2. Clone & Install

```bash
git clone https://github.com/your-username/engagr.git
cd engagr

# Backend
pip install -r requirements.txt
playwright install chromium

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

### 4. Reddit App Registration

1. Go to [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)
2. Click **"Create App"** (or "Create Another App")
3. Fill in:
   - **Name**: Engagr
   - **Type**: Script
   - **Redirect URI**: `http://localhost:8080`
4. Note the **client ID** (under app name) and **client secret**
5. Enter these in the Mini App onboarding or `.env` file

### 5. LinkedIn Cookie Setup

```bash
python backend/setup.py
```

This opens a visible browser window:
1. Log in to LinkedIn manually
2. Press Enter in the terminal
3. Cookies are saved to `data/cookies.json`

> If cookies expire, the bot will notify you to re-run `setup.py`.

### 6. Run Locally

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

## Railway Deployment

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/engagr.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app)
2. Create new project → Deploy from GitHub
3. Select your repo
4. Add environment variables in Railway dashboard:
   - `TELEGRAM_BOT_TOKEN`
   - `GROQ_API_KEY`
   - `REDDIT_CLIENT_ID`
   - `REDDIT_CLIENT_SECRET`
   - `REDDIT_USERNAME`
   - `REDDIT_PASSWORD`
   - `MINI_APP_URL` (your frontend URL)
5. Railway will auto-deploy using `railway.toml`

### 3. Frontend Hosting

Build the frontend and deploy to any static hosting (Vercel, Netlify, Railway):

```bash
cd frontend
npm run build
```

The `dist/` folder is ready for deployment.

### 4. Set Mini App URL in BotFather

1. Open [@BotFather](https://t.me/BotFather)
2. Run `/mybots` → Select your bot → **Bot Settings** → **Menu Button**
3. Set the URL to your deployed frontend

---

## Project Structure

```
engagr/
├── backend/
│   ├── main.py           # Entry point: Flask API + Telegram bot + scheduler
│   ├── config.py          # Environment vars, constants, daily limits
│   ├── storage.py         # JSON-based per-user data storage
│   ├── ai_comment.py      # Groq API comment generation
│   ├── linkedin.py        # Playwright-based LinkedIn automation
│   ├── reddit_bot.py      # PRAW-based Reddit automation
│   ├── scheduler.py       # APScheduler session management
│   ├── telegram_bot.py    # Telegram bot commands & approval flow
│   └── setup.py           # LinkedIn login cookie helper
├── frontend/
│   ├── src/
│   │   ├── App.jsx                # Root component + routing
│   │   ├── screens/
│   │   │   ├── Onboarding.jsx     # Language + platform setup
│   │   │   ├── Dashboard.jsx      # Daily stats + session control
│   │   │   ├── LinkedInSettings.jsx
│   │   │   ├── RedditSettings.jsx
│   │   │   └── Queue.jsx          # Comment approval queue
│   │   └── components/
│   │       ├── Card.jsx           # Queue item card
│   │       ├── Slider.jsx         # Range slider
│   │       ├── TagInput.jsx       # Tag input with keyboard support
│   │       └── Toggle.jsx         # Toggle switch
│   ├── index.html
│   ├── tailwind.config.js
│   └── vite.config.js
├── data/                  # Auto-created: per-user JSON storage
├── .env.example
├── requirements.txt
├── railway.toml
└── README.md
```

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

All delays are jittered (never exactly the same).

---

## Bot Commands

| Command     | Description              |
|-------------|--------------------------|
| `/start`    | Welcome + setup          |
| `/dashboard`| Today's stats            |
| `/queue`    | Pending comments         |
| `/settings` | Open Mini App settings   |
| `/linkedin` | LinkedIn setup guide     |
| `/reddit`   | Reddit setup guide       |
| `/pause`    | Pause all sessions       |
| `/resume`   | Resume sessions          |

---

## License

MIT
