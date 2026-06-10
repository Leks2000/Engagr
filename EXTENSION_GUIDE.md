# Engagr Extension Guide

This guide explains how to run the personal **Engagr WebBridge** Chrome Extension MVP.

## Current MVP decision

For v0.1 the extension is a local browser bridge:

```text
Telegram Mini App
  ↓ approve / edit / skip / regenerate
Chrome Extension: Engagr WebBridge
  ↓ prepare browser-side action
LinkedIn
```

The extension does **not** publish comments automatically in v0.1. The safer flow is: Engagr prepares or inserts the approved text, then you manually review and click the final LinkedIn publish button.

## AI provider

The project currently uses Groq in the backend AI comment module, so the extension defaults to **Groq** as the MVP provider label. OpenAI remains a selectable future option in the popup settings.

## Local install in Chrome

1. Start the Mini App if you want the connection check to show as connected.

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

2. Open Chrome and go to:

   ```text
   chrome://extensions
   ```

3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository `extension/` directory.
6. Pin **Engagr WebBridge** in the browser toolbar.
7. Open the popup and set:
   - Mini App URL: `http://localhost:5173` for local Vite development.
   - Telegram user ID: optional in v0.1.
   - AI provider: `Groq` for the current project default.
8. Click **Save settings** or **Check**.

## v0.1 checklist

- [x] Manifest V3 extension.
- [x] Popup UI matching the WebBridge reference direction.
- [x] Settings saved via `chrome.storage.sync`.
- [x] Mini App connection check.
- [x] Active LinkedIn tab detection.
- [x] LinkedIn feed parser.
- [ ] Send parsed posts to the Mini App approval queue.
- [ ] Prepare approved LinkedIn comment action.


## LinkedIn parser usage

1. Open `https://www.linkedin.com/feed/` in Chrome.
2. Scroll until the posts you want are visible.
3. Open **Engagr WebBridge**.
4. Click **Scan LinkedIn feed**.
5. The popup stores the latest parsed items locally as:

   ```json
   {
     "author": "...",
     "post": "...",
     "url": "..."
   }
   ```

For v0.2 this is intentionally read-only parsing. Sending these parsed posts into the Mini App approval queue belongs to the next integration step.

## Chrome Web Store release checklist

Use this only when the local MVP is stable enough to publish.

- Prepare production extension name and description.
- Add production-safe extension icons as supported store assets.
- Remove unused host permissions or narrow them to required domains.
- Add a privacy policy explaining what page data is read.
- Confirm there is no automatic final submit without clear user action.
- Zip the `extension/` directory.
- Upload the ZIP in Chrome Web Store Developer Dashboard.
- Complete screenshots, category, privacy practices, and review notes.

## Troubleshooting

### Popup says “Mini App not reachable”

- Make sure `npm run dev` is running in `frontend/`.
- Confirm the popup Mini App URL matches the Vite URL.
- For production, replace the local URL with the deployed Mini App URL.

### LinkedIn tab is not detected

- Open a tab under `https://www.linkedin.com/`.
- Reopen the extension popup.
- Confirm the extension has the requested host permissions.

### Settings are not saved

- Reload the unpacked extension from `chrome://extensions`.
- Reopen the popup and try **Save settings** again.
