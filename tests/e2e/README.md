# Engagr — Playwright Auto-Test Harness

This is the "Browser MCP / Playwright" auto-test harness from the roadmap
(Stage 5). It drives the Engagr Mini App in a real browser, fully offline, and
asserts the full Feed lifecycle so we catch regressions right after every
change — exactly the "test the whole scenario and find where it breaks" loop
the user asked for.

## What it covers

| Spec | What it verifies |
| --- | --- |
| `tests/feed.spec.js` | Feed renders items · generate variants for `new_post` · select variant · Approve flips status · Decline updates badge · status chips show counts |
| `tests/media.spec.js` | A post with `media[]` renders an inline `MediaPreview` image that actually loads (guards the Task-1 Telegram-media feature) |
| `tests/action-selectors.spec.js` | The LinkedIn / X / Reddit DOM selectors the extension relies on still resolve against saved fixture HTML — catches platform UI drift before posting breaks in prod |

## How it works (offline)

- `webServer` in `playwright.config.js` builds the Mini App (`vite build`) and
  serves it via `vite preview` on `http://localhost:4173`.
- `tests/fixtures.js` installs a **mock backend** with `page.addInitScript` +
  a patched `window.fetch`, so the harness never calls Railway, Telegram, or
  the Chrome extension. Mutations (select/approve/skip/decline) mutate an
  in-memory queue so subsequent reads reflect the new status — mirroring the
  real API surface.
- The action-selector spec loads static fixture HTML snapshots
  (`tests/fixtures/*.html`) of each platform's post DOM and asserts the
  extension's key selectors resolve.

## Run it

```bash
cd tests/e2e
npm install
npm run install:browsers     # one-time: downloads Chromium
npm test                     # all specs, headless
npm run test:headed          # watch it run
npm run report               # open the HTML report
```

Single suite:

```bash
npm run test:feed
npm run test:media
npm run test:selectors
```

## Updating fixtures

When LinkedIn / X / Reddit ship a UI redesign:

1. Save a fresh snapshot of the post card DOM to `tests/fixtures/<platform>.html`.
2. Run `npm run test:selectors`.
3. If a selector no longer resolves, update the selector in the extension
   (`extension/src/<platform>_actions.js` / `<platform>_parser.js`) — **do not
   loosen the assertion**. This is the self-healing selector loop.

## CI

`playwright.config.js` already enables `retries: 1` and `workers: 1` under
`CI=true`. Add a step to your pipeline:

```yaml
- run: cd tests/e2e && npm ci && npm run install:browsers && npm test
```
