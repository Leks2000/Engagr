# Engagr WebBridge (Chrome Extension)

Browser bridge for Engagr: parses LinkedIn / X / Reddit feeds and executes approved actions.

**Project plan:** [../PROJECT_PLAN.md](../PROJECT_PLAN.md)

## Install

1. `chrome://extensions` → Developer mode → **Load unpacked** → this `extension/` folder
2. Connect via 5-minute login code from Mini App → Settings
3. Keep platform tabs open for auto-scan (every 15 min)

## What it does

| Feature | File |
|---------|------|
| Auto-scan alarm (15 min) | `src/background.js` |
| LinkedIn parser | `src/linkedin_parser.js` |
| X parser | `src/x_parser.js` |
| Reddit parser | `src/reddit_parser.js` |
| Comment / like / connect | `src/linkedin_actions.js` |
| Reply / like | `src/x_actions.js` |
| Mini App context sync | `src/miniapp_bridge.js` |

## API endpoints used

- `POST /api/extension/posts/push` — send scanned posts
- `GET /api/tasks` — poll approved tasks
- `POST /api/auth/extension-verify` — login with code

## Note

`manifest.json` must exist in this folder to load the extension. If missing from git, create it from the MV3 template in project history or ask in issues.
