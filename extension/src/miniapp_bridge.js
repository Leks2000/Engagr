/**
 * miniapp_bridge.js — Content script injected into the Mini App page.
 *
 * WHY THIS FILE EXISTS:
 *   Chrome extensions cannot be directly detected by web pages.
 *   The Mini App runs in a browser tab (or Telegram WebView). To bridge the gap,
 *   this content script is injected into the Mini App page via manifest.json
 *   `content_scripts` matching the Mini App URL patterns.
 *
 * HOW THE BRIDGE WORKS (full flow):
 *   1. Mini App loads → this script is injected automatically by Chrome.
 *   2. This script fires ENGAGR_BRIDGE_READY into window (postMessage).
 *      Mini App listens for this message to know the extension is present.
 *   3. When settings load, Mini App fires ENGAGR_MINI_APP_CONTEXT (postMessage).
 *      This script relays it to background.js via chrome.runtime.sendMessage.
 *   4. background.js saves userId + keywords to chrome.storage.sync.
 *   5. Popup.js reads from chrome.storage.sync — gets userId + keywords.
 *   6. On LinkedIn, popup triggers PARSE_LINKEDIN_FEED → content script parses.
 *   7. Parsed posts + AI comments → sent to backend /api/extension/linkedin/queue.
 *   8. Approved queue items returned to popup → popup sends OPEN_AND_PREPARE to background.
 *   9. background.js opens LinkedIn tab → sends action message to linkedin_actions.js.
 *
 * WHY THE BRIDGE MAY NOT WORK (common failure points):
 *   - Mini App NOT opened in Chrome (e.g. Telegram Desktop/Mobile WebView = no extension).
 *   - Extension not installed or not enabled.
 *   - Mini App URL doesn't match content_scripts "matches" patterns in manifest.json.
 *     → Check manifest.json host_permissions and content_scripts matches.
 *   - Mini App fires postMessage BEFORE this script is ready (race condition).
 *     → Fixed: this script fires ENGAGR_BRIDGE_READY to signal readiness.
 *   - Mini App doesn't re-fire context after receiving BRIDGE_READY.
 *     → App.jsx now listens for BRIDGE_READY and re-fires context immediately.
 *   - CORS / CSP issues blocking chrome.runtime.sendMessage in some contexts.
 *
 * TELEGRAM WEBVIEW NOTE:
 *   When Mini App is opened inside Telegram (not in a Chrome browser tab),
 *   there is NO extension running. The bridge will never fire ENGAGR_BRIDGE_READY.
 *   This is expected. The Mini App should gracefully handle extension=absent state.
 */

;(() => {
  const SOURCE_FROM_APP = 'ENGAGR_MINI_APP'
  const SOURCE_FROM_EXT = 'ENGAGR_EXTENSION'

  // ── 1. Signal readiness to Mini App ──────────────────────────────────────
  //   Fire immediately and again after a small delay to handle race conditions
  //   where the Mini App React app hasn't mounted its listener yet.
  function signalReady() {
    window.postMessage(
      {
        source: SOURCE_FROM_EXT,
        type: 'ENGAGR_BRIDGE_READY',
        payload: { version: '0.5.0' },
      },
      '*',
    )
  }

  signalReady()
  setTimeout(signalReady, 300)
  setTimeout(signalReady, 1000) // extra retry for slow React hydration

  // ── 2. Listen for Mini App context messages ───────────────────────────────
  window.addEventListener('message', (event) => {
    // Security: only accept messages from the same frame
    if (event.source !== window) return

    const data = event.data || {}
    if (data.source !== SOURCE_FROM_APP) return

    if (data.type === 'ENGAGR_MINI_APP_CONTEXT') {
      // Relay context (userId, apiBaseUrl, keywords) to background service worker
      chrome.runtime.sendMessage(
        {
          type: 'ENGAGR_SYNC_MINI_APP_CONTEXT',
          payload: data.payload || {},
        },
        (response) => {
          if (chrome.runtime.lastError) {
            // Background not ready — ignore silently
            return
          }

          // Confirm back to Mini App that sync succeeded
          window.postMessage(
            {
              source: SOURCE_FROM_EXT,
              type: 'ENGAGR_CONTEXT_SYNCED',
              payload: { ok: response?.ok || false },
            },
            '*',
          )
        },
      )
    }

    if (data.type === 'ENGAGR_PING') {
      // Health check from Mini App
      window.postMessage(
        {
          source: SOURCE_FROM_EXT,
          type: 'ENGAGR_PONG',
          payload: { ts: Date.now() },
        },
        '*',
      )
    }
  })
})()
