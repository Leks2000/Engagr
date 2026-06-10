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
7. Open the Engagr Telegram Mini App once. The frontend sends its user ID, API URL, and selected LinkedIn keywords to the extension automatically.
8. Open LinkedIn and click the extension popup. It will use the synced Mini App settings; there is no extension form to fill.

## v0.1 checklist

- [x] Manifest V3 extension.
- [x] Popup UI matching the WebBridge reference direction.
- [x] Settings saved via `chrome.storage.sync`.
- [x] Mini App connection check.
- [x] Active LinkedIn tab detection.
- [x] LinkedIn feed parser.
- [x] AI comment generation/regeneration for parsed LinkedIn posts.
- [x] Automatic Mini App sync for user ID, API URL, and LinkedIn keywords.
- [ ] Send parsed posts to the Mini App approval queue.
- [ ] Prepare approved LinkedIn comment action.

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
