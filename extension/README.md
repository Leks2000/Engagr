# Engagr WebBridge Extension

Personal Chrome Extension MVP for connecting browser workflows with the Engagr Telegram Mini App.

## v0.1 scope

- Manifest V3 extension shell.
- Popup UI inspired by the WebBridge reference.
- Local settings stored in `chrome.storage.sync`.
- Mini App connection check.
- Active-tab LinkedIn detection.
- Read-only LinkedIn feed parser that extracts author, post text, and post URL.

## Non-goals for v0.1

- No backend inside the extension.
- No database.
- No automatic publishing.
- No binary assets.
- No multi-account support.

## Local install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension/` directory.
5. Open the extension popup and set the Mini App URL.


## Parser output

The LinkedIn parser returns an array shaped like:

```json
[
  {
    "author": "...",
    "post": "...",
    "url": "..."
  }
]
```
