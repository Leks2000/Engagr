# Engagr — Project Plan (Source of Truth)

> **Last updated:** 2026-06-19 (media proxy + visual pass iteration)
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
| 0.1 | Extend `GET /api/queue/<user_id>` — support `?status=new_post,pending,approved` | `backend/main.py` | [x] |
| 0.2 | Queue UI: tabs **New** / **For review** | `frontend/src/screens/Queue.jsx` | [x] |
| 0.3 | Button **Generate reply** for `new_post` items | API + Queue UI | [x] |
| 0.4 | Add **X** platform filter in Queue | Queue UI | [x] |
| 0.5 | Remove **Simulate** from production UI (dev flag only) | Queue UI | [x] |
| 0.6 | Auto-generate 3 AI variants on `posts/push` (setting: on/off) | `backend/main.py` | [x] |
| 0.7 | Keyword filter on `posts/push` | `backend/main.py` | [x] |
| 0.8 | Telegram notification + deep link to Mini App Queue | `backend/telegram_bot.py` | [x] |

**Done when:** Extension scan → post appears in Mini App with comment variants → user can edit → approve.

---

### Phase 1 — Extension as sole executor (5–7 days)

**Goal:** After approve, extension auto-executes; no broken server executor paths.

| ID | Task | Area | Done |
|----|------|------|------|
| 1.1 | Fix approve: `source: extension_autoscan` → extension path, not `queue_executor` | `backend/main.py` | [x] |
| 1.2 | X items: UI shows "runs in browser", never server executor | Queue UI + API | [x] |
| 1.3 | Extension polls approved tasks and auto-executes | `extension/src/background.js` | [x] |
| 1.4 | Semi-auto → full auto: extension clicks Post/Reply after approve | `*_actions.js` | [x] |
| 1.5 | Status lifecycle: `approved` → `executing` → `published` / `failed` | backend + extension | [x] |
| 1.6 | Telegram notification on published / failed | `backend/telegram_bot.py` | [x] |

**Done when:** Approve in Mini App → comment live on platform within 1–3 min, status updated in UI.

---

### Phase 2 — Actions on post card (4–5 days)

**Goal:** Like and connect/follow as part of approve.

| ID | Task | Platform | Done |
|----|------|----------|------|
| 2.1 | Toggle **like** on card → extension action | LinkedIn, X, Reddit upvote | [x] |
| 2.2 | Toggle **connect / follow** on card | LinkedIn Connect, X Follow | [x] |
| 2.3 | Action chain with delays 30–180 sec between steps | `background.js` | [x] |
| 2.4 | Enforce daily limits (comments / likes / connects) | backend + extension | [x] |

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

---

## Current Roadmap After Feed Iteration (2026-06-15)

This roadmap reflects the actual code state after the Mini App was refocused on the core approval loop. It supersedes older feature-first plans until the loop below is stable in production:

```text
Post found
↓
Shown in unified Feed
↓
Generated variants shown to user
↓
User selects one variant
↓
User presses Approve
↓
Extension executes approved action
↓
Feed status updates: approved → executing → published / failed
```

### Stage 1 — Required MVP loop

- [x] Unified `Feed` screen for X, Reddit, and LinkedIn posts.
- [x] Feed shows `platform`, `author`, `text`, `created_at`, and execution `status`.
- [x] Supported visible statuses: `new_post`, `pending`, `approved`, `executing`, `published`, `failed`, `skipped`.
- [x] Generated `comment_variants` are displayed as explicit Variant 1 / 2 / 3 options.
- [x] Variant selection calls the existing `/select` endpoint and updates `selected_comment`.
- [x] Approve is an explicit user action; card no longer approves via copy/open side effect.
- [x] Backend keeps lifecycle status history instead of deleting published/skipped items from Feed.
- [x] Extension status update path accepts `executing` and maps legacy statuses to the current lifecycle.
- [ ] Production E2E verification with a real extension session: scan → Feed → select → approve → execute → published.

### Stage 2 — Reddit execution and extension stability ✅ (2026-06-19)

- [x] Reddit content-script actions implemented (`reddit_actions.js`: comment prepare/submit + upvote, new + old Reddit).
- [x] Reddit actions wired into `background.js` via the message protocol and registered in `manifest.json`.
- [x] Reddit parser supports modern (shreddit) and old Reddit layouts.
- [x] Extension execution retry/backoff added (up to 2 retries with 1min/3min backoff, then terminal `failed`).
- [x] Double-execution race fixed: in-memory `inFlightTasks` set replaces the broken `task.execution === 'executing'` guard.
- [x] `retry_count` surfaced through the execution-status endpoint and persisted on the queue item.
- [x] All execution stays behind explicit Mini App approval.

### Stage 2.1 — Approval lifecycle & observability ✅ (2026-06-19)

- [x] **Decline** action added (distinct from neutral **Skip**): backend `/decline` endpoint + `declined` lifecycle status + Feed badge + Decline buttons in `Card`, `NewPostCard`, and `StatusPostCard`.
- [x] **Retry** button for failed items: backend `/retry` endpoint resets `failed → approved` and increments `retry_count` (capped at 5).
- [x] Failed items now show `failed_at`, `execution_error`, and `retry_count` in the expanded card.
- [x] **Browser Recorder** (`recorder.js`): every execution step is logged to `chrome.storage.local` (`execution_start → status_executing → step_done/failed → published/failed_terminal`) so any bug can be traced in under a minute. Popup can read/clear the log via `ENGAGR_GET_ACTION_LOG` / `ENGAGR_CLEAR_ACTION_LOG`.
- [x] Dead code removed: `_post_item_delayed` (backend) and unused bulk handlers (`handleApproveAll`/`handleSkipAll`) + `approveAll`/`skipAll` i18n keys (Queue/Dashboard).

### Stage 3 — Filtering: AI relevance + antispam/antiduplicates + sort ✅ (landed this iteration)

- [x] **AI relevance score 0–10** before showing a post (`backend/relevance_scorer.py`).
  - Heuristic score (length, keyword match, engagement, media) blended with optional Groq 0–10 (`auto_ai_relevance` setting).
  - Persisted on the queue item as `relevance_score`, `relevance_flags`, `sort_key`, `content_fingerprint`.
- [x] **Antispam / antiduplicates**: spam patterns, promoted/ad detection, low-effort filter, content-fingerprint dedupe against the live queue.
- [x] **Sort queue by importance** — `filter_and_sort_posts` orders kept posts by `sort_key` desc.
- [x] Wired into `POST /api/extension/posts/push` (runs *before* AI generation so Groq quota is never spent on spam/low-relevance posts).
- [x] User controls: `filtering_enabled` (toggle) + `min_relevance_score` (0–10 slider) via `GET/PUT /api/relevance/<user_id>` + Settings → Advanced → Relevance panel.
- [x] Telemetry in the push response: `stage3.dropped_low_relevance / dropped_spam / dropped_duplicate`.

### Stage 4 — Analytics funnel ✅ (landed this iteration)

- [x] **Real funnel** (`backend/analytics_funnel.py`, `GET /api/analytics/funnel/<user_id>?days=N`):
  *N found → M published → K declined/failed → CTR → AI cost → action history*.
- [x] CTR = published / (published + declined + failed + skipped) — "of everything decided, what went live". Open/undecided reported separately so it doesn't penalize CTR.
- [x] Per-platform breakdown + daily series (for the chart) + recent action history (50 cap).
- [x] AI cost tracking: authoritative from `stats.ai_cost_usd` / `ai_tokens`, fallback per-item estimate from Groq pricing.
- [x] Frontend: `frontend/src/screens/Analytics.jsx` — 4 funnel cards, per-platform cards, daily bar chart, AI cost panel, action history list. Window 1/7/30d. Reachable via Settings → Advanced → "Analytics funnel" and deep link `?screen=analytics`.

### Stage 5 — Automated testing & self-healing ✅ (harness + self-heal landed)

- [x] **Playwright auto-test harness** (`tests/e2e/`): drives the Mini App in Chromium fully offline. A mock backend (`fixtures.js`) mirrors the real API (settings, queue, regenerate/select/approve/skip/decline, translate-all, media proxy) so tests run with no Railway/Telegram/extension.
  - `feed.spec.js`: render items · generate variants for `new_post` · select variant + Approve flips status · Decline updates badge · status chip counts.
  - `media.spec.js`: inline `MediaPreview` image renders through `/api/media/proxy` and actually decodes · **graceful "Media unavailable — Retry" fallback** appears on a simulated CDN 403 (guards the hotlink-bypass fix).
  - `action-selectors.spec.js`: LinkedIn/X/Reddit selector regression guards against saved fixture HTML — catches platform UI drift before posting breaks in prod.
- [x] **Record-selector self-healing** (`backend/selector_healer.py`):
  - Extension reports every selector probe (`found` node count + surrounding HTML snippet) to `POST /api/extension/selector/probe`.
  - After N consecutive failures (default 3), Groq proposes a replacement selector from the HTML snippet; the proposal is stored and surfaced in the Mini App for Accept/Reject.
  - `GET /api/extension/selector/health/<user_id>` → `frontend/src/screens/SelfHealing.jsx` (summary, per-selector status, pending AI proposals with Accept/Reject, recent probe log).
  - `POST /api/extension/selector/proposal/<user_id>/<id>/accept|reject` applies the new selector.
- Run with `cd tests/e2e && npm install && npx playwright install chromium && npm test`.

#### How "Browser MCP / Stage 5" works (plain explanation)

Two layers:

1. **Playwright auto-test harness (shipped, `tests/e2e/`)** — a headless Chromium that loads the Mini App against a *mock* backend (no Railway, no Telegram, no extension needed). After every code change you run `npm test` and it verifies the full UI loop: posts render → generate variants → select → approve → decline → status badges → media preview → selector regression. This catches regressions in seconds, offline. That is the "ИИ сам запускает приложение, жмёт кнопки, ищет ошибки, делает отчёт" piece — it is real and runs in this repo today.

2. **Browser MCP (shipped this iteration, `backend/browser_mcp.py`)** — an MCP client that lets the Railway backend drive the user's *real* browser through a Cloudflare tunnel, for self-healing verification on the live DOM (see Stage 6).

### Stage 6 — Browser MCP integration ✅ (landed this iteration)

The user runs a Playwright MCP server on their PC and exposes it via a Cloudflare tunnel so the Railway backend can drive their real browser for self-healing verification and live DOM checks.

**On the user's PC (Windows / PowerShell):**
```powershell
# 1. Start the Playwright MCP server on a local port
npx @playwright/mcp@latest --port 8931

# 2. Expose it via cloudflared (separate terminal)
C:\cloudflared\cloudflared.exe tunnel --url http://localhost:8931
```
cloudflared prints a `https://<random>.trycloudflare.com` URL. Set it on Railway as `BROWSER_MCP_URL` (e.g. `https://tech-appropriate-golden-benchmark.trycloudflare.com/mcp`).

**On Railway:**
- `BROWSER_MCP_URL` env var → read live by `backend/browser_mcp.py`.
- Backend endpoints:
  - `GET  /api/mcp/status` — tunnel liveness probe.
  - `GET  /api/mcp/tools` — list Playwright MCP tools.
  - `POST /api/mcp/call` — invoke a tool (`{ "tool": "browser_navigate", "arguments": {...} }`).
  - `POST /api/mcp/verify-selector` — self-heal verification (`{ "url", "selector" }`).
- Frontend: Settings → Advanced → "Browser MCP (Playwright tunnel)" panel shows tunnel status, tool count, and the PC commands to run.

**How it fits together:**
```
User PC                              Railway backend
────────                             ──────────────
npx @playwright/mcp (port 8931)      browser_mcp.py ── /api/mcp/*
        │                                   │
        ▼                                   ▼
cloudflared tunnel ── HTTPS ───────► JSON-RPC 2.0 over HTTP+SSE
        │                                   │
        ▼                                   ▼
Real Chrome (user's session)         self-heal: verify a proposed
                                     selector on the live post DOM
```
Every MCP call degrades gracefully when the tunnel is down (PC off) — the rest of the app keeps working.

### Deferred / legacy areas

- `backend/queue_executor.py` remains legacy server-side execution and should not be used for LinkedIn/X publishing.
- Ideas Engine stays under Settings → Advanced, not main navigation.
- `Dashboard.jsx` (legacy session-log view) is superseded by `Analytics.jsx` (Stage 4 funnel); kept for warm-up/live-log view.

---

## Iteration log — 2026-06-19 (media proxy + visual pass)

**Root cause found:** the media pipeline (parser → backend → GET /api/queue → MediaPreview) was *not* broken — `media[]` was flowing through. The real reason post images/videos did not show in the Telegram Mini App was **CDN hotlink protection**: `media.licdn.com`, `pbs.twimg.com`, `preview.redd.it` return 403 when the Mini App webview loads `<img src="…cdn…">` directly (wrong Referer), and `MediaPreview` then **silently vanished** (`onError → return null`), so the user saw empty cards and assumed it was broken.

**What shipped this iteration:**

- **`/api/media/proxy` (backend)** — server-side fetch of social-CDN assets with a permissive Referer (linkedin.com / x.com / reddit.com by host suffix), streamed back with `Cache-Control: public, max-age=86400` + permissive CORS. Domain-suffix allow-list (`licdn.com`, `twimg.com`, `redd.it`, `redditmedia.com`) blocks SSRF/open-redirect abuse.
- **`MediaPreview.jsx` rewrite (frontend)** — every asset is routed through the proxy; added a shimmer skeleton (never blank while loading), a gallery with prev/next + counter for multi-attachment posts, and a graceful **"Media unavailable — Retry"** chip that replaces the silent-disappear-on-error behaviour. `API_BASE` is now exported from `App.jsx` so the proxy URL is built correctly in any deployment.
- **Parser hardening (extension)** — `linkedin_parser.js` / `x_parser.js` / `reddit_parser.js` now read lazy-load attributes (`data-delayed-url`, `data-img-perf-url`, `data-perf-url`, `data-srcset`) and pick the highest-resolution `srcset` candidate, plus fall back to `og:image` meta. Captures the real CDN URL even before the image decodes on the social site.
- **Visual pass (frontend CSS)** — discovered that the primary Card action classes (`queue-btn-primary`, `queue-btn-secondary`, `queue-card-actions-semi/row`, `queue-btn-skip-small`, `queue-card-invite`, `queue-card-variant-translation`) were **referenced in `Card.jsx` but never defined in `index.css`**, so Approve/Decline/Invite/Edit/Regen rendered as bare browser-default buttons. Added a consistent, mobile-first button system (44px tap targets, clear primary/secondary hierarchy, active feedback) + `feed-lang-select` styling. Feed header refresh button slimmed to an icon.
- **E2E** — `media.spec.js` extended with a regression test for the graceful fallback (simulated 403 → "Media unavailable — Retry" chip visible); mock backend gained a `proxyFails` flag + `page.route` fulfilment for the proxy image request (the `<img>` loader bypasses `window.fetch`). **11/11 tests passing.**

**Verification:** `ast.parse` clean · `vite build` 391 modules exit 0 · `node -c` clean on all three parsers · Playwright 11/11.
