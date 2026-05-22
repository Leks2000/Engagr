# Engagr

**Engagr is a Telegram Mini App + Telegram Bot that helps founders and growth teams automate LinkedIn and Reddit engagement with AI, safe pacing, and human approval workflows.**

👉 **Use the official bot:** [@Engagr_bot](https://t.me/Engagr_bot)

---

## Repository Description (for GitHub)

Use this as your GitHub repository description:

> AI-powered Telegram Mini App for LinkedIn & Reddit engagement automation with approval queue, warm-up mode, anti-ban limits, and live session logs.

## Suggested GitHub Topics

Add these topics in your repo settings:

- `telegram-bot`
- `telegram-mini-app`
- `linkedin-automation`
- `reddit-bot`
- `ai-comments`
- `playwright`
- `flask`
- `react`
- `growth-automation`
- `social-media-automation`

---

## What Engagr Does

- Generates contextual AI comments for LinkedIn and Reddit.
- Lets you approve, edit, skip, or regenerate comments before posting.
- Runs scheduled engagement sessions with jittered timing and daily limits.
- Supports warm-up mode for safer account ramp-up.
- Shows live session logs so users can see what automation is doing.

---

## Core Features

- 🤖 **AI Comment Generation** with selectable tone/persona.
- 🔗 **LinkedIn Automation** via browser-based workflow and session cookies.
- 🧡 **Reddit Automation** with API-based integration.
- 📱 **Telegram Mini App UI** for onboarding, dashboard, queue, and settings.
- 💬 **Telegram Chat Fallback** for approvals directly in bot chat.
- ⏰ **Smart Scheduling** with per-platform sessions.
- 🛡️ **Anti-ban Controls**: jitter, hard daily caps, and pacing.
- 📊 **Live Session Visibility**: logs + health/status widgets.

---

## Quick Start

### 1) Requirements

- Python 3.11+
- Node.js 18+
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### 2) Install

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

### 3) Environment

```bash
cp .env.example .env
```

Fill required values:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
GROQ_API_KEY=your_groq_api_key
MINI_APP_URL=https://your-frontend-url.com
```

### 4) Run

```bash
python backend/main.py
```

For frontend development:

```bash
cd frontend
npm run dev
```

---

## LinkedIn Setup Notes

- Preferred approach: import valid session cookie (`li_at`) through the app flow.
- If session expires, reconnect account and refresh cookie/session.
- Use moderate limits and warm-up mode for newer accounts.

---

## Project Structure

```text
engagr/
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── storage.py
│   ├── ai_comment.py
│   ├── linkedin.py
│   ├── reddit_bot.py
│   ├── scheduler.py
│   ├── telegram_bot.py
│   └── setup.py
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── screens/
│   │   └── components/
│   ├── index.html
│   └── vite.config.js
├── requirements.txt
├── railway.toml
└── README.md
```

---

## Deployment (Railway + Static Frontend)

1. Push backend repo to GitHub.
2. Deploy on Railway from GitHub repo.
3. Add environment variables in Railway.
4. Deploy frontend (`frontend/dist`) to Vercel/Netlify/Railway static hosting.
5. Set Mini App URL in BotFather menu button.

---

## License

MIT
