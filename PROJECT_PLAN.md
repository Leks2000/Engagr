# Engagr — Project Plan (Source of Truth)

> **Last updated:** 2026-06-12  
> **Status:** Active development plan  
> **For AI agents:** Read this file before implementing features. Phases are ordered — do not skip Phase 0–1 unless explicitly asked. Check off tasks in this file when completed.

---

## Target Product (one sentence)

**Chrome Extension parses LinkedIn / X / Reddit → Railway backend + Groq AI prepares comment variants → user approves in Telegram Mini App → Extension automatically posts comment, like, connect/follow.**

Reddit discovery additionally runs on the backend (public JSON) as a fallback when the browser is closed.

---

## Architecture (fixed decision)

```
┌─────────────────────────────────────────────────────────────────┐
│  DISCOVERY                                                       │
│  • Extension: DOM parse on open tabs (all 3 platforms, 15 min)  │
│  • Backend:  Reddit public JSON scheduler (fallback)             │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND (Railway) — orchestrator                                │
│  • POST /api/extension/posts/push                                │
│  • Groq AI → 3 comment variants                                  │
│  • Queue (queue.json per user)                                   │
│  • Limits, warm-up, keyword filter                               │
│  • Telegram notifications + deep links                           │
└────────────────────────────┬────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  MINI APP (Telegram WebApp)                                      │
│  • Feed: all posts + execution status                            │
│  • Queue: pending items with approve / edit / skip               │
│  • Settings: platforms, keywords, limits, extension login code   │
│  • Profile: User Memory (AI personalization)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │ approve
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  EXTENSION — executor (all actions after approve)                │
│  • comment / reply (auto-submit after approve)                   │
│  • like / upvote                                                 │
│  • LinkedIn Connect / X Follow                                   │
│  • Status: executing → published / failed                        │
└─────────────────────────────────────────────────────────────────┘
```

### Platform responsibilities

| Platform | Parsing | Execution after approve | Ban risk |
|----------|---------|-------------------------|----------|
| **Reddit** | Backend (primary) + Extension | Extension or backend cookies | Low–medium |
| **LinkedIn** | Extension only (reliable) | Extension DOM | High without limits |
| **X** | Extension only | Extension DOM | Medium–high |

### What we deliberately avoid

- Server-side posting for LinkedIn / X (fragile, high ban risk, slow to build)
- Full autopilot without user approve
- LinkedIn feed crawl without user's open browser tab
- Ideas Engine / heavy analytics in main Mini App navigation

### Requirements for users

- **Chrome on PC** with Engagr WebBridge installed and logged into social accounts
- **Telegram** for Mini App and notifications
- Extension auto-scan works only when relevant tabs are open (max 1 per platform)

---

## Mini App navigation (target UI)

| Tab | Content |
|-----|---------|
| **Feed** | All posts: `new_post` + `pending` + `approved` + execution status |
| **Queue** | Only `pending` with actions (edit, regenerate, approve, skip) |
| **Settings** | Platforms, keywords, limits, scan interval, extension login code, language |
| **Profile** | User Memory (project, audience, tone) |

**Hidden in Advanced (not main nav):** Ideas Engine, detailed analytics, simulate mode.

---

## Development Phases

### Phase 0 — Posts visible, single flow (3–5 days)

**Goal:** One path: post arrives → AI variants → approve. No gaps between extension and Mini App.

| ID | Task | Area | Done |
|----|------|------|------|
| 0.1 | Extend `GET /api/queue/<user_id>` — support `?status=new_post,pending,approved` | `backend/main.py` | [ ] |
| 0.2 | Queue UI: tabs **New** / **For review** | `frontend/src/screens/Queue.jsx` | [ ] |
| 0.3 | Button **Generate reply** for `new_post` items | API + Queue UI | [ ] |
| 0.4 | Add **X** platform filter in Queue | Queue UI | [ ] |
| 0.5 | Remove **Simulate** from production UI (dev flag only) | Queue UI | [ ] |
| 0.6 | Auto-generate 3 AI variants on `posts/push` (setting: on/off) | `backend/main.py` | [ ] |
| 0.7 | Keyword filter on `posts/push` | `backend/main.py` | [ ] |
| 0.8 | Telegram notification + deep link to Mini App Queue | `backend/telegram_bot.py` | [ ] |

**Done when:** Extension scan → post appears in Mini App with comment variants → user can edit → approve.

---

### Phase 1 — Extension as sole executor (5–7 days)

**Goal:** After approve, extension auto-executes; no broken server executor paths.

| ID | Task | Area | Done |
|----|------|------|------|
| 1.1 | Fix approve: `source: extension_autoscan` → extension path, not `queue_executor` | `backend/main.py` | [ ] |
| 1.2 | X items: UI shows "runs in browser", never server executor | Queue UI + API | [ ] |
| 1.3 | Extension polls approved tasks and auto-executes | `extension/src/background.js` | [ ] |
| 1.4 | Semi-auto → full auto: extension clicks Post/Reply after approve | `*_actions.js` | [ ] |
| 1.5 | Status lifecycle: `approved` → `executing` → `published` / `failed` | backend + extension | [ ] |
| 1.6 | Telegram notification on published / failed | `backend/telegram_bot.py` | [ ] |

**Done when:** Approve in Mini App → comment live on platform within 1–3 min, status updated in UI.

---

### Phase 2 — Actions on post card (4–5 days)

**Goal:** Like and connect/follow as part of approve.

| ID | Task | Platform | Done |
|----|------|----------|------|
| 2.1 | Toggle **like** on card → extension action | LinkedIn, X, Reddit upvote | [ ] |
| 2.2 | Toggle **connect / follow** on card | LinkedIn Connect, X Follow | [ ] |
| 2.3 | Action chain with delays 30–180 sec between steps | `background.js` | [ ] |
| 2.4 | Enforce daily limits (comments / likes / connects) | backend + extension | [ ] |

**Done when:** Card with post + ☑ like + ☑ connect → approve → all steps execute in sequence.

---

### Phase 3 — Simplify Mini App (3–4 days)

**Goal:** 4 tabs instead of 5+ scattered screens.

| ID | Task | Done |
|----|------|------|
| 3.1 | New **Feed** screen (unified post list) | [ ] |
| 3.2 | Merge LinkedIn + Reddit bottom tabs into **Settings** | [ ] |
| 3.3 | Move Control Center (extension code, pause) into **Settings** | [ ] |
| 3.4 | Hide Ideas Engine + analytics under **Advanced** | [ ] |
| 3.5 | Update bottom nav: Feed · Queue · Settings · Profile | `frontend/src/App.jsx` | [ ] |

---

### Phase 4 — Smart filtering (3–5 days, after stable MVP)

**Goal:** Queue not flooded with irrelevant posts.

| ID | Task | Done |
|----|------|------|
| 4.1 | AI relevance score 0–10 before showing post | [ ] |
| 4.2 | Filter promoted / ads / too-short posts | [ ] |
| 4.3 | Backend Reddit scheduler as background fallback | [ ] |
| 4.4 | Minimum engagement threshold (likes/comments on post) | [ ] |

---

## Known gaps (current codebase)

| Issue | Location | Fix in phase |
|-------|----------|--------------|
| `new_post` items not returned by queue API | `GET /api/queue` filters `pending` only | Phase 0.1 |
| Autoscan posts only in Telegram bot, not Mini App | `extension_autoscan` + `new_post` status | Phase 0 |
| `extension_autoscan` approve may hit server executor | `approve_item` in `main.py` | Phase 1.1 |
| X returns "Unknown platform" in `queue_executor` | `queue_executor.py` | Phase 1.2 (extension-only) |
| `manifest.json` may be missing from repo | `extension/` | Fix before extension testing |
| Mini App bridge only works in Chrome, not TG WebView | `miniapp_bridge.js` | Document in onboarding |

---

## Key files map

| Area | Files |
|------|-------|
| API & queue | `backend/main.py`, `backend/storage.py` |
| Execution (legacy server) | `backend/queue_executor.py` — Reddit/LinkedIn only; X must use extension |
| Reddit backend parse | `backend/reddit_public.py`, `backend/scheduler.py` |
| AI comments | `backend/ai_comment.py` |
| Telegram bot | `backend/telegram_bot.py` |
| Extension core | `extension/src/background.js`, `popup.js` |
| Parsers | `extension/src/linkedin_parser.js`, `x_parser.js`, `reddit_parser.js` |
| Actions | `extension/src/linkedin_actions.js`, `x_actions.js` |
| Mini App shell | `frontend/src/App.jsx` |
| Queue UI | `frontend/src/screens/Queue.jsx` |

---

## Daily limits (product defaults)

| Platform | Action | Max/day |
|----------|--------|---------|
| LinkedIn | Comments | 15 |
| LinkedIn | Likes | 5 |
| LinkedIn | Connections | 5 |
| Reddit | Comments | 15 |
| Reddit | Upvotes | 5 |
| X | Replies | 15 |
| X | Likes | 5 |

Warm-up mode gradually increases limits (+1 every 3 days). Random delays between actions: 30–180 seconds.

---

## Out of scope (MVP)

- Autopilot without approve
- Server-side LinkedIn / X posting
- LinkedIn parsing without open browser tab
- Reddit "friends" (no such mechanic)
- Ideas Engine in main navigation

---

## Implementation order

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4
   ↑         ↑
 visibility  auto-post
```

Phases 0 and 1 are blockers. Phase 3 can partially overlap with Phase 1.

**Estimated MVP timeline:** 3–4 weeks.

---

## Extension setup (quick)

1. Load unpacked extension from `extension/` in `chrome://extensions`
2. In Mini App → Settings → generate 5-minute extension login code
3. Paste code in extension popup → Connect
4. Keep LinkedIn / X / Reddit tabs open for auto-scan (every 15 min)

See [README.md](README.md) for full install and deploy instructions.
