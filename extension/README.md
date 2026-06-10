# Engagr WebBridge Extension

Personal Chrome Extension MVP for connecting browser workflows with the Engagr Telegram Mini App.

## v0.1 scope

- Manifest V3 extension shell.
- Popup UI inspired by the WebBridge reference.
- Local settings stored in `chrome.storage.sync`.
- Mini App connection check.
- Active-tab LinkedIn detection.
- Read-only LinkedIn feed parser that extracts author, post text, and post URL.
- AI comment generation/regeneration for parsed LinkedIn posts through the Engagr API.

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


## AI comments

The popup sends parsed posts to the Engagr API:

```text
POST /api/extension/linkedin/comment/<user_id>
POST /api/extension/linkedin/regenerate/<user_id>
```

Returned comments are saved in `chrome.storage.local` next to the parsed post preview. The extension still does not publish anything automatically.
