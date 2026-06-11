/**
 * background.js — Engagr WebBridge Service Worker
 *
 * Handles:
 *  - Extension settings management
 *  - JWT token storage & refresh
 *  - Task polling from backend (every 30s when authenticated)
 *  - Badge notifications for pending tasks
 *  - Tab management for LinkedIn & X actions
 *  - Mini App context synchronization
 *  - Connection status tracking
 *  - AUTO FEED SCAN via chrome.alarms every 15 minutes (Sprint 1)
 */

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
  // Auth
  jwtToken: '',
  tokenIssuedAt: null,
  // Polling
  pollInterval: 30, // seconds
  lastPollAt: null,
  pendingTaskCount: 0,
  // Auto-scan
  autoScanIntervalMinutes: 15,
  lastAutoScanAt: null,
}

// ─── Initialization ───────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS))
  const next = { ...DEFAULT_SETTINGS }

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (stored[key] !== undefined) {
      next[key] = stored[key]
    }
  }

  await chrome.storage.sync.set(next)

  // Set up task polling alarm (every 30s)
  chrome.alarms.create('engagr-poll-tasks', { periodInMinutes: 0.5 })

  // Set up feed auto-scan alarm (every 15 min)
  chrome.alarms.create('engagr-feed-scan', { periodInMinutes: 15 })

  // Set initial badge
  updateBadge(0)
  console.log('[Engagr] Extension installed. Auto-scan alarm set for every 15 minutes.')
})

// ─── Alarm-based Task Polling & Feed Auto-Scan ────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'engagr-poll-tasks') {
    await pollTasks()
  }
  if (alarm.name === 'engagr-feed-scan') {
    await autoScanFeed()
  }
})

/**
 * Poll backend for pending tasks and update badge.
 */
async function pollTasks() {
  try {
    const settings = await chrome.storage.sync.get(['apiBaseUrl', 'telegramUserId', 'jwtToken'])
    const { apiBaseUrl, telegramUserId, jwtToken } = settings

    if (!telegramUserId && !jwtToken) {
      updateBadge(0)
      return
    }

    const baseUrl = (apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '')
    const headers = { 'Content-Type': 'application/json' }

    // Prefer JWT auth, fall back to userId param
    let url = `${baseUrl}/api/tasks?status=approved&limit=20`
    if (jwtToken) {
      headers['Authorization'] = `Bearer ${jwtToken}`
    } else if (telegramUserId) {
      url += `&userId=${encodeURIComponent(telegramUserId)}`
    }

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) })

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired — clear it
        await chrome.storage.sync.set({ jwtToken: '', pendingTaskCount: 0 })
        updateBadge(0)
      }
      return
    }

    const data = await response.json()
    const taskCount = data.total || data.tasks?.length || 0

    await chrome.storage.sync.set({
      pendingTaskCount: taskCount,
      lastPollAt: new Date().toISOString(),
    })

    updateBadge(taskCount)

    // Store tasks locally for popup access
    await chrome.storage.local.set({
      pendingTasks: data.tasks || [],
      lastPollAt: new Date().toISOString(),
    })
  } catch (err) {
    // Silently fail — network might be unavailable
    console.debug('[Engagr] Poll failed:', err.message)
  }
}

// ─── Auto Feed Scan ───────────────────────────────────────

/**
 * Auto-scan LinkedIn/X feed and push new posts to backend → Telegram.
 * Called by chrome.alarms every 15 minutes.
 */
async function autoScanFeed() {
  try {
    const settings = await chrome.storage.sync.get([
      'apiBaseUrl', 'telegramUserId', 'jwtToken', 'autoScanLinkedIn', 'lastAutoScanAt',
    ])
    const { apiBaseUrl, telegramUserId, jwtToken, autoScanLinkedIn } = settings

    // Need auth to push posts
    if (!jwtToken && !telegramUserId) {
      console.debug('[Engagr] Auto-scan skipped: not authenticated')
      return
    }

    if (autoScanLinkedIn === false) {
      console.debug('[Engagr] Auto-scan disabled by user settings')
      return
    }

    console.log('[Engagr] Auto-scan started at', new Date().toISOString())

    // Find open LinkedIn tab(s)
    const linkedinTabs = await chrome.tabs.query({
      url: ['https://www.linkedin.com/feed/*', 'https://www.linkedin.com/'],
    })

    // Also check for LinkedIn tabs not just on /feed/
    const allLinkedinTabs = linkedinTabs.length > 0
      ? linkedinTabs
      : await chrome.tabs.query({ url: 'https://www.linkedin.com/*' })

    let scannedPosts = []

    if (allLinkedinTabs.length > 0) {
      // Ask the content script to parse the feed
      for (const tab of allLinkedinTabs.slice(0, 1)) {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, {
            type: 'ENGAGR_PARSE_LINKEDIN_FEED',
          })
          if (result?.ok && Array.isArray(result.posts) && result.posts.length > 0) {
            scannedPosts = result.posts.map((p) => ({ ...p, platform: 'linkedin' }))
            console.log(`[Engagr] Auto-scan got ${scannedPosts.length} LinkedIn posts`)
            break
          }
        } catch (err) {
          console.debug('[Engagr] Could not reach LinkedIn tab:', err.message)
        }
      }
    }

    // Find open X/Twitter tab(s)
    const xTabs = await chrome.tabs.query({
      url: ['https://x.com/*', 'https://twitter.com/*'],
    })

    if (xTabs.length > 0) {
      for (const tab of xTabs.slice(0, 1)) {
        try {
          const result = await chrome.tabs.sendMessage(tab.id, {
            type: 'ENGAGR_PARSE_X_FEED',
          })
          if (result?.ok && Array.isArray(result.posts) && result.posts.length > 0) {
            scannedPosts = [
              ...scannedPosts,
              ...result.posts.map((p) => ({ ...p, platform: 'x' })),
            ]
            console.log(`[Engagr] Auto-scan got ${result.posts.length} X posts`)
            break
          }
        } catch (err) {
          console.debug('[Engagr] Could not reach X tab:', err.message)
        }
      }
    }

    if (scannedPosts.length === 0) {
      console.debug('[Engagr] Auto-scan: no posts found (no open feed tabs?)')
      await chrome.storage.sync.set({ lastAutoScanAt: new Date().toISOString() })
      return
    }

    // Push posts to backend
    await pushPostsToBackend(scannedPosts, settings)

    await chrome.storage.sync.set({ lastAutoScanAt: new Date().toISOString() })
  } catch (err) {
    console.error('[Engagr] Auto-scan error:', err.message)
  }
}

/**
 * Send scanned posts to backend POST /api/extension/posts/push
 * Backend will filter new posts and push them to Telegram.
 */
async function pushPostsToBackend(posts, settings) {
  try {
    const { apiBaseUrl, telegramUserId, jwtToken } = settings
    const baseUrl = (apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '')
    const headers = { 'Content-Type': 'application/json' }

    if (jwtToken) {
      headers['Authorization'] = `Bearer ${jwtToken}`
    }

    const body = {
      posts,
      user_id: telegramUserId || null,
      scanned_at: new Date().toISOString(),
    }

    const response = await fetch(`${baseUrl}/api/extension/posts/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (response.ok) {
      const data = await response.json()
      console.log(`[Engagr] Pushed ${posts.length} posts → backend sent ${data.pushed || 0} new to Telegram`)
    } else {
      console.warn('[Engagr] Push posts failed:', response.status)
    }
  } catch (err) {
    console.error('[Engagr] pushPostsToBackend error:', err.message)
  }
}

/**
 * Update the extension badge with pending task count.
 */
function updateBadge(count) {
  const text = count > 0 ? String(count) : ''
  const color = count > 0 ? '#ef4444' : '#6b7280'

  chrome.action.setBadgeText({ text })
  chrome.action.setBadgeBackgroundColor({ color })

  // Update tooltip
  const title = count > 0
    ? `Engagr WebBridge — ${count} task${count === 1 ? '' : 's'} ready`
    : 'Engagr WebBridge'
  chrome.action.setTitle({ title })
}

// ─── Message Handlers ─────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false

  // Get active tab info
  if (message.type === 'ENGAGR_GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0]
      sendResponse({
        ok: Boolean(tab),
        tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      })
    })
    return true
  }

  // Open URL and prepare action (LinkedIn & X)
  if (message.type === 'ENGAGR_OPEN_AND_PREPARE') {
    handleOpenAndPrepare(message.payload, sendResponse)
    return true
  }

  // Sync Mini App context
  if (message.type === 'ENGAGR_SYNC_MINI_APP_CONTEXT') {
    handleSyncMiniAppContext(message.payload, sendResponse)
    return true
  }

  // Extension login with code
  if (message.type === 'ENGAGR_EXTENSION_LOGIN') {
    handleExtensionLogin(message.payload, sendResponse)
    return true
  }

  // Manual poll trigger
  if (message.type === 'ENGAGR_POLL_TASKS') {
    pollTasks().then(() => sendResponse({ ok: true }))
    return true
  }

  // Manual feed scan trigger
  if (message.type === 'ENGAGR_SCAN_FEED') {
    autoScanFeed().then(() => sendResponse({ ok: true }))
    return true
  }

  // Get connection status
  if (message.type === 'ENGAGR_GET_STATUS') {
    getConnectionStatus().then(sendResponse)
    return true
  }

  // Update task status
  if (message.type === 'ENGAGR_UPDATE_TASK_STATUS') {
    handleUpdateTaskStatus(message.payload, sendResponse)
    return true
  }

  return false
})

// ─── Handler Functions ────────────────────────────────────

async function handleOpenAndPrepare(payload, sendResponse) {
  const targetUrl = String(payload?.url || '').trim()
  const actionMessage = payload?.actionMessage || null

  if (!targetUrl || !actionMessage) {
    sendResponse({ ok: false, error: 'Missing URL or action.' })
    return
  }

  chrome.tabs.create({ url: targetUrl, active: true }, (tab) => {
    if (!tab?.id) {
      sendResponse({ ok: false, error: 'Could not open tab.' })
      return
    }

    const tabId = tab.id
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      chrome.tabs.onUpdated.removeListener(onUpdated)
      sendResponse(result)
    }

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return

      // Give the SPA time to hydrate
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, actionMessage, (response) => {
          if (chrome.runtime.lastError) {
            finish({ ok: false, error: 'Page is not ready. Reload and try again.' })
            return
          }
          finish(response || { ok: false, error: 'No response from page.' })
        })
      }, 2500)
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
    setTimeout(() => finish({ ok: false, error: 'Timed out waiting for page.' }), 30000)
  })
}

async function handleSyncMiniAppContext(payload, sendResponse) {
  const miniAppUrl = typeof payload?.miniAppUrl === 'string' ? payload.miniAppUrl : ''
  const apiBaseUrl = typeof payload?.apiBaseUrl === 'string' ? payload.apiBaseUrl : ''
  const telegramUserId = String(payload?.userId || payload?.telegramUserId || '').trim()
  const linkedinKeywords = Array.isArray(payload?.linkedin?.keywords) ? payload.linkedin.keywords : []

  const updates = {
    ...(miniAppUrl ? { miniAppUrl } : {}),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(telegramUserId ? { telegramUserId } : {}),
    linkedinKeywords,
    lastMiniAppSync: new Date().toISOString(),
  }

  // If we got a token from Mini App, store it
  if (payload?.token) {
    updates.jwtToken = payload.token
    updates.tokenIssuedAt = new Date().toISOString()
  }

  await chrome.storage.sync.set(updates)

  // Immediately poll for tasks after sync
  if (telegramUserId || payload?.token) {
    pollTasks()
  }

  sendResponse({ ok: true })
}

async function handleExtensionLogin(payload, sendResponse) {
  const { code, apiBaseUrl } = payload || {}

  if (!code) {
    sendResponse({ ok: false, error: 'Login code required.' })
    return
  }

  try {
    const baseUrl = (apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '')
    const response = await fetch(`${baseUrl}/api/auth/extension-verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    const data = await response.json()

    if (!response.ok || !data.ok) {
      sendResponse({ ok: false, error: data.error || 'Login failed.' })
      return
    }

    // Save token and user info
    await chrome.storage.sync.set({
      jwtToken: data.token,
      telegramUserId: data.user_id,
      tokenIssuedAt: new Date().toISOString(),
      apiBaseUrl: baseUrl,
    })

    // Start polling
    pollTasks()

    sendResponse({ ok: true, user_id: data.user_id })
  } catch (err) {
    sendResponse({ ok: false, error: err.message || 'Network error.' })
  }
}

async function handleUpdateTaskStatus(payload, sendResponse) {
  const { taskId, status } = payload || {}

  if (!taskId || !status) {
    sendResponse({ ok: false, error: 'taskId and status required.' })
    return
  }

  try {
    const settings = await chrome.storage.sync.get(['apiBaseUrl', 'jwtToken', 'telegramUserId'])
    const baseUrl = (settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '')
    const headers = { 'Content-Type': 'application/json' }

    if (settings.jwtToken) {
      headers['Authorization'] = `Bearer ${settings.jwtToken}`
    }

    const body = { status }
    if (!settings.jwtToken && settings.telegramUserId) {
      body.user_id = settings.telegramUserId
    }

    const response = await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })

    const data = await response.json()
    if (response.ok && data.ok) {
      // Refresh tasks
      pollTasks()
      sendResponse({ ok: true })
    } else {
      sendResponse({ ok: false, error: data.error || 'Update failed.' })
    }
  } catch (err) {
    sendResponse({ ok: false, error: err.message })
  }
}

async function getConnectionStatus() {
  const settings = await chrome.storage.sync.get([
    'telegramUserId', 'jwtToken', 'lastMiniAppSync',
    'lastPollAt', 'pendingTaskCount', 'apiBaseUrl',
  ])

  const hasToken = !!settings.jwtToken
  const hasUserId = !!settings.telegramUserId
  const isConnected = hasToken || hasUserId

  let backendReachable = false
  if (isConnected) {
    try {
      const baseUrl = (settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '')
      const resp = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) })
      backendReachable = resp.ok
    } catch {
      backendReachable = false
    }
  }

  return {
    ok: true,
    connected: isConnected,
    authenticated: hasToken,
    backendReachable,
    userId: settings.telegramUserId || null,
    lastSync: settings.lastMiniAppSync || null,
    lastPoll: settings.lastPollAt || null,
    pendingTasks: settings.pendingTaskCount || 0,
  }
}

// ─── Startup ─────────────────────────────────────────────

// Ensure alarms exist on startup (service workers can restart)
chrome.alarms.get('engagr-poll-tasks', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('engagr-poll-tasks', { periodInMinutes: 0.5 })
  }
})

chrome.alarms.get('engagr-feed-scan', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('engagr-feed-scan', { periodInMinutes: 15 })
    console.log('[Engagr] Feed auto-scan alarm registered (15 min interval)')
  }
})

// Initial poll on startup
pollTasks()
