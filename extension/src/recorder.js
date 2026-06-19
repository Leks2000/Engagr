/**
 * recorder.js — Browser Recorder for the Engagr extension background SW.
 *
 * Appends structured action-log entries to chrome.storage.local so any bug
 * can be traced end-to-end:
 *
 *   12:35  Found post        → 12:35  Generated variants  → 12:36  Approve
 *   → 12:36  Found button     → 12:36  Pressed             → 12:36  Comment sent → Success
 *
 * Entries are capped (MAX_LOG_ENTRIES) and newest-first for cheap popup reads.
 *
 * Exposes a global `recorder` on the service worker and message handlers so the
 * popup can fetch / clear the log:
 *   - ENGAGR_GET_ACTION_LOG   → { entries: [...] }
 *   - ENGAGR_CLEAR_ACTION_LOG → { ok: true }
 */

const MAX_LOG_ENTRIES = 500

const recorder = {
  /**
   * Append a single step to the action log.
   * @param {object} entry
   *   { taskId, platform, step, status, detail }
   *   status: 'start' | 'success' | 'error' | 'info'
   */
  async recordStep(entry) {
    try {
      const record = {
        ts: new Date().toISOString(),
        taskId: entry.taskId || null,
        platform: entry.platform || null,
        action: entry.action || null,
        step: entry.step || '',
        status: entry.status || 'info',
        detail: entry.detail || '',
      }
      const { actionLog = [] } = await chrome.storage.local.get(['actionLog'])
      // newest-first
      const next = [record, ...actionLog].slice(0, MAX_LOG_ENTRIES)
      await chrome.storage.local.set({ actionLog: next })
    } catch (err) {
      console.error('[Engagr Recorder] recordStep failed:', err)
    }
  },

  /** Return the current log (newest-first). */
  async getLog() {
    try {
      const { actionLog = [] } = await chrome.storage.local.get(['actionLog'])
      return actionLog
    } catch (err) {
      console.error('[Engagr Recorder] getLog failed:', err)
      return []
    }
  },

  /** Clear the log. */
  async clear() {
    try {
      await chrome.storage.local.remove(['actionLog'])
    } catch (err) {
      console.error('[Engagr Recorder] clear failed:', err)
    }
  },
}

// Expose for the rest of the background SW (works as a classic script or ES module)
if (typeof self !== 'undefined') self.recorder = recorder
export { recorder }
export default recorder

// ─── Message handlers (popup ↔ recorder) ───────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false

  if (message.type === 'ENGAGR_GET_ACTION_LOG') {
    recorder.getLog().then((entries) => sendResponse({ ok: true, entries }))
    return true
  }

  if (message.type === 'ENGAGR_CLEAR_ACTION_LOG') {
    recorder.clear().then(() => sendResponse({ ok: true }))
    return true
  }

  return false
})

console.debug('[Engagr Recorder] loaded')
