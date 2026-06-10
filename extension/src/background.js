const DEFAULT_SETTINGS = {
  miniAppUrl: 'http://localhost:5173',
  apiBaseUrl: 'https://engagr-production.up.railway.app',
  telegramUserId: '',
  aiProvider: 'groq',
  autoOpenLinkedIn: true,
  autoScanLinkedIn: true,
  lastConnectionCheck: null,
  lastMiniAppSync: null,
  linkedinKeywords: [],
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS))
  const next = { ...DEFAULT_SETTINGS }

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (stored[key] !== undefined) {
      next[key] = stored[key]
    }
  }

  await chrome.storage.sync.set(next)
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ENGAGR_GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0]
      sendResponse({
        ok: Boolean(tab),
        tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      })
    })
    return true
  }

  if (message?.type === 'ENGAGR_SYNC_MINI_APP_CONTEXT') {
    const payload = message.payload || {}
    const miniAppUrl = typeof payload.miniAppUrl === 'string' ? payload.miniAppUrl : ''
    const apiBaseUrl = typeof payload.apiBaseUrl === 'string' ? payload.apiBaseUrl : ''
    const telegramUserId = String(payload.userId || payload.telegramUserId || '').trim()
    const linkedinKeywords = Array.isArray(payload.linkedin?.keywords) ? payload.linkedin.keywords : []

    chrome.storage.sync.set({
      ...(miniAppUrl ? { miniAppUrl } : {}),
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      ...(telegramUserId ? { telegramUserId } : {}),
      linkedinKeywords,
      lastMiniAppSync: new Date().toISOString(),
    }, () => sendResponse({ ok: true }))
    return true
  }

  return false
})
