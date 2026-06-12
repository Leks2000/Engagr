# Engagr Mini App (Frontend)

Telegram WebApp built with React + Vite.

**Project plan:** [../PROJECT_PLAN.md](../PROJECT_PLAN.md)

## Dev

```bash
npm install
npm run dev
```

API URL: set `VITE_API_URL` in `.env` or defaults to production Railway.

## Key screens

| Screen | File | Role |
|--------|------|------|
| App shell + nav | `src/App.jsx` | Routing, API client, extension bridge |
| Queue | `src/screens/Queue.jsx` | Approve / edit / skip |
| Dashboard | `src/screens/Dashboard.jsx` | Stats, run sessions (being simplified) |
| Control Center | `src/screens/ControlCenter.jsx` | Extension login code |
| Settings (per platform) | `LinkedInSettings.jsx`, `RedditSettings.jsx`, `XSettings.jsx` | Merging into unified Settings per plan |

## Build

```bash
npm run build
```

Output: `dist/` — served by backend in dev or deployed to Vercel.
