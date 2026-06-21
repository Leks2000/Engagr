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
 *  - AUTO EXECUTION: polls approved tasks and executes actions (Phase 1.3-1.5)
 */

import { recorder } from './recorder.js'

const DEFAULT_SETTINGS = {
  miniAppUrl: 'http://localhost:5173',
  apiBaseUrl: 'https://engagr-production.up.railway.app',
  telegramUserId: '',
  aiProvider: 'groq',
  autoOpenLinkedIn: true,
  autoScanLinkedIn: true,
  autoScanReddit: true,
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

// ─── Auto Execution (Phase 1.3-1.5) ────────────────────────

// ─── Daily Limits (Phase 2.4) ────────────────────────────────

const DAILY_LIMITS = {
  linkedin_comments: 15,
  linkedin_likes: 5,
  linkedin_connects: 5,
  reddit_comments: 15,
  reddit_upvotes: 5,
  x_replies: 15,
  x_likes: 5,
  x_follows: 5,
}

// Track daily counts in memory (reset at midnight UTC)
let dailyCounts = {}
let dailyCountsDate = new Date().toISOString().split('T')[0]

function resetDailyCountsIfNeeded() {
  const today = new Date().toISOString().split('T')[0]
  if (today !== dailyCountsDate) {
    dailyCounts = {}
    dailyCountsDate = today
  }
}

function incrementDailyCount(actionType) {
  resetDailyCountsIfNeeded()
  dailyCounts[actionType] = (dailyCounts[actionType] || 0) + 1
}

function getDailyCount(actionType) {
  resetDailyCountsIfNeeded()
  return dailyCounts[actionType] || 0
}

function checkDailyLimit(actionType) {
  const limit = DAILY_LIMITS[actionType]
  if (!limit) return true // No limit defined
  const current = getDailyCount(actionType)
  return current < limit
}

/**
 * Execute approved tasks automatically.
 * Called after polling to process any pending approved tasks.
 * Supports action chains with delays between steps (Phase 2.3).
 * Enforces daily limits (Phase 2.4).
 */
// ── Execution state (prevents double-execution across polls) ────
// `task.execution` is a backend field set to "extension" (the executor), NOT a
// running-state flag — so the old guard `task.execution === 'executing'` never
// matched and the same approved task could be executed twice by overlapping
// polls. We track in-flight IDs in memory instead.
const inFlightTasks = new Set()

// ── Retry with backoff ───────────────────────────────────────────
// On a failed chain we wait an increasing delay, then reset the task to
// "approved" so the next poll re-executes it. Caps at MAX_RETRIES.
const MAX_RETRIES = 2
const RETRY_BACKOFF_MS = [60000, 180000] // 1 min, 3 min
const retryCounts = new Map()

async function executeApprovedTasks(tasks) {
  const settings = await chrome.storage.sync.get(['apiBaseUrl', 'jwtToken', 'telegramUserId'])
  const { apiBaseUrl, jwtToken, telegramUserId } = settings
  const baseUrl = (apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, '')

  for (const task of tasks) {
    if (task.status !== 'approved') continue
    if (inFlightTasks.has(task.id)) continue // already being processed
    inFlightTasks.add(task.id)

    const platform = task.platform || 'linkedin'
    const postUrl = task.post_url || ''

    if (!postUrl) {
      console.debug('[Engagr] Skipping task without post_url:', task.id)
      recorder.recordStep({ taskId: task.id, platform, action: 'noop', step: 'skip', status: 'info', detail: 'no post_url' })
      continue
    }

    // Build action chain from task or use default single action
    const actionChain = task.action_chain || [{ type: task.action || 'comment', comment: task.selected_comment || task.comment || '' }]

    console.log(`[Engagr] Executing task ${task.id}: ${platform} (${actionChain.length} actions)`)
    recorder.recordStep({ taskId: task.id, platform, action: actionChain.map(a => a.type).join('+'), step: 'execution_start', status: 'start', detail: `${actionChain.length} action(s)` })

    // Mark as executing
    await updateTaskStatus(task.id, 'executing', baseUrl, jwtToken, telegramUserId)
    recorder.recordStep({ taskId: task.id, platform, step: 'status_executing', status: 'info' })

    let allSucceeded = true
    let lastError = ''

    // Execute each action in the chain with delays (Phase 2.3)
    for (let i = 0; i < actionChain.length; i++) {
      const actionStep = actionChain[i]

      // 2.4: Check daily limit before executing
      const limitKey = {
        'comment': `${platform}_comments`,
        'reply': `${platform}_replies`,
        'like': `${platform}_likes`,
        'upvote': `${platform}_upvotes`,
        'connect': `${platform}_connects`,
        'follow': `${platform}_follows`,
      }[actionStep.type] || `${platform}_comments`

      if (!checkDailyLimit(limitKey)) {
        console.warn(`[Engagr] Daily limit reached for ${limitKey} (${getDailyCount(limitKey)}/${DAILY_LIMITS[limitKey]}). Skipping action.`)
        lastError = `Daily limit reached for ${actionStep.type}`
        // Don't fail the whole chain, just skip this action
        continue
      }

      console.log(`[Engagr] Task ${task.id} step ${i + 1}/${actionChain.length}: ${actionStep.type}`)

      try {
        let result = null

        if (platform === 'linkedin') {
          result = await executeLinkedInAction(actionStep, task)
        } else if (platform === 'x') {
          result = await executeXAction(actionStep, task)
        } else if (platform === 'reddit') {
          result = await executeRedditAction(actionStep, task)
        }

        if (result?.ok) {
          // Increment daily count on success
          incrementDailyCount(limitKey)
          console.log(`[Engagr] ${limitKey}: ${getDailyCount(limitKey)}/${DAILY_LIMITS[limitKey]}`)
          recorder.recordStep({ taskId: task.id, platform, action: actionStep.type, step: `step_${i + 1}_done`, status: 'success', detail: result.note || 'ok' })
        } else {
          allSucceeded = false
          lastError = result?.error || 'Action failed'
          console.warn(`[Engagr] Task ${task.id} step ${actionStep.type} failed:`, lastError)
          recorder.recordStep({ taskId: task.id, platform, action: actionStep.type, step: `step_${i + 1}_failed`, status: 'error', detail: lastError })
        }
      } catch (err) {
        allSucceeded = false
        lastError = err.message
        console.error(`[Engagr] Task ${task.id} step ${actionStep.type} error:`, err.message)
        recorder.recordStep({ taskId: task.id, platform, action: actionStep.type, step: `step_${i + 1}_error`, status: 'error', detail: err.message })
      }

      // Delay between actions in chain (30-180 seconds) - Phase 2.3
      if (i < actionChain.length - 1) {
        const delay = 30000 + Math.random() * 150000
        console.log(`[Engagr] Waiting ${Math.round(delay / 1000)}s before next action`)
        await new Promise(r => setTimeout(r, delay))
      }
    }

    // Report final status
    if (allSucceeded) {
      await reportExecutionStatus(task, 'published', baseUrl, jwtToken, telegramUserId)
      // Clear retry state on success
      retryCounts.delete(task.id)
      console.log(`[Engagr] Task ${task.id} completed successfully`)
      recorder.recordStep({ taskId: task.id, platform, step: 'published', status: 'success', detail: 'comment sent' })
    } else {
      const attempts = (retryCounts.get(task.id) || 0) + 1
      if (attempts <= MAX_RETRIES) {
        retryCounts.set(task.id, attempts)
        console.warn(`[Engagr] Task ${task.id} failed (attempt ${attempts}/${MAX_RETRIES + 1}): ${lastError} — retrying in ${RETRY_BACKOFF_MS[attempts - 1] / 1000}s`)
        await reportExecutionStatus(task, 'failed', baseUrl, jwtToken, telegramUserId, `${lastError} (will retry ${attempts}/${MAX_RETRIES})`, attempts)
        // Release the in-flight lock so the scheduled retry can run
        inFlightTasks.delete(task.id)
        // After backoff, reset to approved so the next poll re-executes it
        setTimeout(async () => {
          await updateTaskStatus(task.id, 'approved', baseUrl, jwtToken, telegramUserId)
          console.log(`[Engagr] Task ${task.id} reset to approved for retry`)
        }, RETRY_BACKOFF_MS[attempts - 1])
      } else {
        // Max retries exhausted — terminal failure
        retryCounts.delete(task.id)
        await reportExecutionStatus(task, 'failed', baseUrl, jwtToken, telegramUserId, `${lastError} (max retries exhausted)`, attempts)
        console.warn(`[Engagr] Task ${task.id} failed permanently after ${attempts} attempts:`, lastError)
        recorder.recordStep({ taskId: task.id, platform, step: 'failed_terminal', status: 'error', detail: `${lastError} (after ${attempts} attempts)` })
      }
    }

    // Delay between tasks (30-180 seconds)
    const delay = 30000 + Math.random() * 150000
    console.log(`[Engagr] Waiting ${Math.round(delay / 1000)}s before next task`)
    await new Promise(r => setTimeout(r, delay))

    // Release the in-flight lock for this task
    inFlightTasks.delete(task.id)
  }
}

/**
 * Execute a single LinkedIn action.
 */
async function executeLinkedInAction(actionStep, task) {
  const postUrl = task.post_url
  const actionType = actionStep.type

  // Find or create LinkedIn tab
  const tab = await findOrCreateTab(postUrl, ['https://www.linkedin.com/*'])
  if (!tab?.id) return { ok: false, error: 'Could not open LinkedIn tab' }

  // Wait for page to load
  await new Promise(r => setTimeout(r, 3000))

  // Inject action scripts if needed
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/linkedin_actions.js'],
    })
    await new Promise(r => setTimeout(r, 500))
  } catch (e) {
    // Script might already be injected
  }

  if (actionType === 'comment') {
    // Probe the comment-box selector against the live DOM (fire-and-forget,
    // debounced, never blocks the action) so self-healing can catch drift.
    maybeProbeActionSelector(tab.id, 'linkedin', 'comment', postUrl)
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'ENGAGR_PREPARE_COMMENT',
      payload: { url: postUrl, comment: actionStep.comment || '' },
    })

    if (result?.ok) {
      // Auto-submit — probe the post-button selector too, since it is the
      // other half of the comment flow and the most common silent-break point.
      maybeProbeActionSelector(tab.id, 'linkedin', 'post_button', postUrl)
      await new Promise(r => setTimeout(r, 1000))
      const postResult = await chrome.tabs.sendMessage(tab.id, {
        type: 'ENGAGR_AUTO_SUBMIT_COMMENT',
        payload: {},
      })
      return postResult || result
    }
    return result
  }

  if (actionType === 'like') {
    maybeProbeActionSelector(tab.id, 'linkedin', 'like', postUrl)
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'ENGAGR_LIKE_POST',
      payload: { url: postUrl },
    })
  }

  if (actionType === 'connect') {
    maybeProbeActionSelector(tab.id, 'linkedin', 'connect', postUrl)
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'ENGAGR_PREPARE_CONNECT',
      payload: { url: postUrl, message: actionStep.message || '' },
    })
  }

  return { ok: false, error: `Unknown LinkedIn action: ${actionType}` }
}

/**
 * Execute a single X/Twitter action.
 */
async function executeXAction(actionStep, task) {
  const postUrl = task.post_url
  const actionType = actionStep.type

  // Find or create X tab
  const tab = await findOrCreateTab(postUrl, ['https://x.com/*', 'https://twitter.com/*'])
  if (!tab?.id) return { ok: false, error: 'Could not open X tab' }

  // Wait for page to load
  await new Promise(r => setTimeout(r, 3000))

  // Inject action scripts if needed
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/x_actions.js'],
    })
    await new Promise(r => setTimeout(r, 500))
  } catch (e) {
    // Script might already be injected
  }

  if (actionType === 'reply') {
    maybeProbeActionSelector(tab.id, 'x', 'reply', postUrl)
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'ENGAGR_PREPARE_X_REPLY',
      payload: { url: postUrl, comment: actionStep.comment || '' },
    })

    if (result?.ok) {
      // Auto-submit — probe the reply submit button selector too.
      maybeProbeActionSelector(tab.id, 'x', 'post_button', postUrl)
      await new Promise(r => setTimeout(r, 1000))
      const submitResult = await chrome.tabs.sendMessage(tab.id, {
        type: 'ENGAGR_AUTO_SUBMIT_X_REPLY',
        payload: {},
      })
      return submitResult || result
    }
    return result
  }

  if (actionType === 'like') {
    maybeProbeActionSelector(tab.id, 'x', 'like', postUrl)
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'ENGAGR_LIKE_X_TWEET',
      payload: { url: postUrl },
    })
  }

  if (actionType === 'follow') {
    maybeProbeActionSelector(tab.id, 'x', 'follow', postUrl)
    return await chrome.tabs.sendMessage(tab.id, {
      type: 'ENGAGR_FOLLOW_X_USER',
      payload: { url: postUrl },
    })
  }

  return { ok: false, error: `Unknown X action: ${actionType}` }
}

/**
 * Execute a single Reddit action.
 */
async function executeRedditAction(actionStep, task) {
  const postUrl = task.post_url
  const actionType = actionStep.type

  // Find or create Reddit tab
  const tab = await findOrCreateTab(postUrl, ['https://www.reddit.com/*', 'https://reddit.com/*', 'https://old.reddit.com/*'])
  if (!tab?.id) return { ok: false, error: 'Could not open Reddit tab' }

  // Wait for page to load
  await new Promise(r => setTimeout(r, 3000))

  // Inject reddit_actions.js if not already present (content_script runs on
  // document_idle, but navigating an existing tab via tabs.update does NOT
  // re-inject content scripts, so we inject defensively).
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/reddit_actions.js'],
    })
    await new Promise(r => setTimeout(r, 500))
  } catch (e) {
    // Script might already be injected — continue anyway
  }

  if (actionType === 'comment') {
    maybeProbeActionSelector(tab.id, 'reddit', 'comment', postUrl)
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'ENGAGR_PREPARE_REDDIT_COMMENT',
      payload: { url: postUrl, comment: actionStep.comment || '' },
    })

    if (result?.ok) {
      // Auto-submit — probe the comment submit button selector too.
      maybeProbeActionSelector(tab.id, 'reddit', 'post_button', postUrl)
      await new Promise(r => setTimeout(r, 1000))
      const submitResult = await chrome.tabs.sendMessage(tab.id, {
        type: 'ENGAGR_AUTO_SUBMIT_REDDIT_COMMENT',
        payload: {},
      })
      return submitResult || result
    }
    return result || { ok: false, error: 'Reddit comment prepare returned no result' }
  }

  if (actionType === 'upvote') {
    maybeProbeActionSelector(tab.id, 'reddit', 'upvote', postUrl)
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'ENGAGR_REDDIT_UPVOTE',
      payload: { url: postUrl },
    })
    return result || { ok: false, error: 'Reddit upvote returned no result' }
  }

  return { ok: false, error: `Unknown Reddit action: ${actionType}` }
}



/**
 * Find an existing tab matching patterns or create a new one.
 */
async function findOrCreateTab(url, urlPatterns) {
  // Check for existing tab
  const tabs = await chrome.tabs.query({ url: urlPatterns })
  if (tabs.length > 0) {
    // Update existing tab URL
    await chrome.tabs.update(tabs[0].id, { url, active: true })
    return tabs[0]
  }

  // Create new tab
  return await chrome.tabs.create({ url, active: true })
}

/**
 * Report execution status to backend.
 */
async function reportExecutionStatus(task, status, baseUrl, jwtToken, userId, error = '', retryCount = null) {
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`

    const body = {
      user_id: userId,
      item_id: task.id,
      status,
      error,
      platform: task.platform,
      author: task.author || task.author_name,
      post_url: task.post_url,
      comment: task.selected_comment || task.comment,
    }
    if (status === 'failed' && retryCount !== null) {
      body.retry_count = retryCount
    }

    await fetch(`${baseUrl}/api/extension/execution/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    console.error('[Engagr] Failed to report execution status:', err.message)
  }
}

/**
 * Stage 5 — Self-healing: report a selector probe to the backend.
 *
 * Every time the extension uses a DOM selector for an action (comment box,
 * post button, like button…), it calls this with the node count it found.
 * If a selector fails N times in a row, the backend asks Groq for a
 * replacement and returns it here so the extension can retry immediately.
 *
 * This is fire-and-forget: probe reporting must NEVER block an action or
 * break posting if the backend is unreachable.
 */
async function reportSelectorProbe(platform, action, selector, found, baseUrl, jwtToken, userId, htmlSnippet = '', url = '') {
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`
    await fetch(`${baseUrl}/api/extension/selector/probe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: userId,
        platform,
        action,
        selector,
        found,
        html_snippet: (htmlSnippet || '').slice(0, 4000),
        url,
        at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    console.debug('[Engagr] selector probe report skipped:', err.message)
  }
}

/**
 * Wrap a querySelectorAll probe so the found-count is reported to the
 * self-healing system. Returns the NodeList so callers can use it directly.
 */
async function probeSelector(tabId, platform, action, selector, baseUrl, jwtToken, userId, url = '') {
  let found = 0
  let snippet = ''
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        try {
          const nodes = document.querySelectorAll(sel)
          const first = nodes[0]
          return {
            found: nodes.length,
            snippet: first ? first.outerHTML.slice(0, 4000) : document.body ? document.body.outerHTML.slice(0, 2000) : '',
          }
        } catch (e) {
          return { found: 0, snippet: '' }
        }
      },
      args: [selector],
    })
    found = result?.found || 0
    snippet = result?.snippet || ''
  } catch (e) {
    found = 0
  }
  // Report async, do not await — never block the action
  reportSelectorProbe(platform, action, selector, found, baseUrl, jwtToken, userId, snippet, url)
  return found
}

/**
 * Primary CSS selector each action relies on, keyed by `platform:action`.
 * These are the selectors most likely to silently drift when a platform
 * redesigns — they are what the self-healing system probes before every
 * action so a breakage is caught (and Groq-healed) instead of failing the
 * post silently. Only the *primary* selector is probed (the fallback chain
 * in *_actions.js still runs for the actual click); probing every fallback
 * would spam the backend and drown the signal.
 */
const ACTION_SELECTORS = {
  'linkedin:comment':     '.comments-comment-box .ql-editor',
  'linkedin:post_button': 'button[type="button"][aria-disabled="false"]',
  'linkedin:like':        'button[aria-label*="Like" i]',
  'linkedin:connect':     'button[aria-label*="Connect" i]',
  'x:reply':              '[data-testid="reply"]',
  'x:post_button':        '[data-testid="tweetButton"]',
  'x:like':               '[data-testid="like"]',
  'x:follow':             '[data-testid$="-follow"]',
  'reddit:comment':       '[contenteditable="true"][role="textbox"]',
  'reddit:post_button':   'button[type="submit"][data-testid="comment-submit"]',
  'reddit:upvote':        '[data-testid="upvote"]',
}

/**
 * Debounce map: { "<platform>:<action>" -> lastProbeAtMs }.
 * One probe per platform:action per PROBE_THROTTLE_MS, so rapid actions
 * (e.g. back-to-back likes) don't fire a probe on every single click and
 * hammer the backend / SelfHealing log. The throttle is short enough that a
 * real breakage is reported within a minute, but long enough to dedupe a
 * burst of the same action.
 */
const PROBE_THROTTLE_MS = 60_000
const _probeLastAt = new Map()

function _shouldProbe(platform, action) {
  const key = `${platform}:${action}`
  const now = Date.now()
  const last = _probeLastAt.get(key) || 0
  if (now - last < PROBE_THROTTLE_MS) return false
  _probeLastAt.set(key, now)
  return true
}

/**
 * Read { baseUrl, jwtToken, userId } from extension storage once and cache
 * briefly so we don't hit chrome.storage on every action. The probe helpers
 * need these to authenticate the POST /api/extension/selector/probe call.
 */
let _authCtxCache = null
let _authCtxAt = 0
async function _authCtx() {
  // Cache 30s — settings rarely change mid-session, and this is called on
  // every action dispatch.
  if (_authCtxCache && Date.now() - _authCtxAt < 30_000) return _authCtxCache
  const s = await chrome.storage.sync.get(['apiBaseUrl', 'jwtToken', 'telegramUserId'])
  _authCtxCache = {
    baseUrl: (s.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, ''),
    jwtToken: s.jwtToken || '',
    userId: s.telegramUserId || '',
  }
  _authCtxAt = Date.now()
  return _authCtxCache
}

/**
 * Fire a self-healing selector probe for `platform:action`, debounced per
 * key and fully fire-and-forget. Called by executeLinkedInAction /
 * executeXAction / executeRedditAction right before the action message is
 * sent to the content script — so the probe runs against the same live DOM
 * the action is about to use, but never blocks or breaks the action.
 *
 * Returns nothing (truly fire-and-forget). Any failure is caught inside.
 */
function maybeProbeActionSelector(tabId, platform, action, url) {
  const selector = ACTION_SELECTORS[`${platform}:${action}`]
  if (!selector) return            // no probe target for this action
  if (!_shouldProbe(platform, action)) return   // debounced
  _authCtx()
    .then(({ baseUrl, jwtToken, userId }) =>
      probeSelector(tabId, platform, action, selector, baseUrl, jwtToken, userId, url)
    )
    .catch((err) => console.debug('[Engagr] probe action selector skipped:', err.message))
}

/**
 * Update task status via API.
 */
async function updateTaskStatus(taskId, status, baseUrl, jwtToken, userId) {
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`

    const body = { status }
    if (!jwtToken && userId) body.user_id = userId

    await fetch(`${baseUrl}/api/tasks/${encodeURIComponent(taskId)}/status`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
  } catch (err) {
    console.error('[Engagr] Failed to update task status:', err.message)
  }
}

/**
 * Poll backend for pending tasks and update badge.
 * Also triggers auto-execution of approved tasks (Phase 1.3-1.5).
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
    const tasks = data.tasks || []
    const taskCount = data.total || tasks.length || 0

    await chrome.storage.sync.set({
      pendingTaskCount: taskCount,
      lastPollAt: new Date().toISOString(),
    })

    updateBadge(taskCount)

    // Store tasks locally for popup access
    await chrome.storage.local.set({
      pendingTasks: tasks,
      lastPollAt: new Date().toISOString(),
    })

    // 1.3: Auto-execute approved tasks
    if (tasks.length > 0) {
      // Don't await — run in background to avoid blocking polling
      executeApprovedTasks(tasks).catch(err => {
        console.error('[Engagr] Auto-execution error:', err.message)
      })
    }
  } catch (err) {
    // Silently fail — network might be unavailable
    console.debug('[Engagr] Poll failed:', err.message)
  }
}

// ─── Auto Feed Scan ───────────────────────────────────────

/**
 * Send a message to a tab content script.
 * Falls back to scripting.executeScript injection if the content script
 * hasn't been injected yet (e.g. tab was already open before extension installed).
 */
async function sendMessageToTab(tabId, message, scriptFiles) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, message)
    return result
  } catch (err) {
    // Content script not yet injected — try dynamic injection
    if (chrome.scripting && scriptFiles && scriptFiles.length > 0) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: scriptFiles,
        })
        // Small wait for script to initialise
        await new Promise((r) => setTimeout(r, 600))
        const result2 = await chrome.tabs.sendMessage(tabId, message)
        return result2
      } catch (err2) {
        console.debug('[Engagr] Dynamic inject failed:', err2.message)
      }
    }
    return null
  }
}

/**
 * Auto-scan LinkedIn / X / Reddit feeds and push new posts to backend → Telegram.
 * Called by chrome.alarms every 15 minutes AND via manual ENGAGR_SCAN_FEED message.
 */
async function autoScanFeed() {
  try {
    const settings = await chrome.storage.sync.get([
      'apiBaseUrl', 'telegramUserId', 'jwtToken',
      'autoScanLinkedIn', 'autoScanReddit', 'lastAutoScanAt',
    ])
    const { telegramUserId, jwtToken, autoScanLinkedIn, autoScanReddit } = settings

    // Need auth to push posts
    if (!jwtToken && !telegramUserId) {
      console.debug('[Engagr] Auto-scan skipped: not authenticated')
      return
    }

    console.log('[Engagr] Auto-scan started at', new Date().toISOString())

    let scannedPosts = []

    // ── LinkedIn ────────────────────────────────────────────
    if (autoScanLinkedIn !== false) {
      const linkedinTabs = await chrome.tabs.query({
        url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'],
      })

      for (const tab of linkedinTabs.slice(0, 1)) {
        const result = await sendMessageToTab(
          tab.id,
          { type: 'ENGAGR_PARSE_LINKEDIN_FEED' },
          ['src/linkedin_parser.js', 'src/linkedin_actions.js'],
        )
        if (result?.ok && Array.isArray(result.posts) && result.posts.length > 0) {
          const posts = result.posts.map((p) => ({ ...p, platform: 'linkedin' }))
          scannedPosts = scannedPosts.concat(posts)
          console.log(`[Engagr] LinkedIn: found ${posts.length} posts`)
        } else {
          console.debug('[Engagr] LinkedIn: no posts (tab:', tab.url, 'result:', result?.count, ')')
        }
      }

      if (linkedinTabs.length === 0) {
        console.debug('[Engagr] LinkedIn: no open tabs')
      }
    }

    // ── X / Twitter ─────────────────────────────────────────
    const xTabs = await chrome.tabs.query({
      url: ['https://x.com/*', 'https://twitter.com/*', 'https://www.twitter.com/*'],
    })

    for (const tab of xTabs.slice(0, 1)) {
      const result = await sendMessageToTab(
        tab.id,
        { type: 'ENGAGR_PARSE_X_FEED' },
        ['src/x_parser.js', 'src/x_actions.js'],
      )
      if (result?.ok && Array.isArray(result.posts) && result.posts.length > 0) {
        const posts = result.posts.map((p) => ({ ...p, platform: 'x' }))
        scannedPosts = scannedPosts.concat(posts)
        console.log(`[Engagr] X: found ${posts.length} posts`)
      } else {
        console.debug('[Engagr] X: no posts (tab:', tab.url, 'result:', result?.count, ')')
      }
    }

    if (xTabs.length === 0) {
      console.debug('[Engagr] X: no open tabs')
    }

    // ── Reddit ───────────────────────────────────────────────
    if (autoScanReddit !== false) {
      const redditTabs = await chrome.tabs.query({
        url: [
          'https://www.reddit.com/*',
          'https://reddit.com/*',
          'https://old.reddit.com/*',
        ],
      })

      for (const tab of redditTabs.slice(0, 1)) {
        const result = await sendMessageToTab(
          tab.id,
          { type: 'ENGAGR_PARSE_REDDIT_FEED' },
          ['src/reddit_parser.js'],
        )
        if (result?.ok && Array.isArray(result.posts) && result.posts.length > 0) {
          const posts = result.posts.map((p) => ({ ...p, platform: 'reddit' }))
          scannedPosts = scannedPosts.concat(posts)
          console.log(`[Engagr] Reddit: found ${posts.length} posts`)
        } else {
          console.debug('[Engagr] Reddit: no posts (tab:', tab.url, 'result:', result?.count, ')')
        }
      }

      if (redditTabs.length === 0) {
        console.debug('[Engagr] Reddit: no open tabs')
      }
    }

    if (scannedPosts.length === 0) {
      console.debug('[Engagr] Auto-scan: 0 posts total. Open LinkedIn/X/Reddit feed tabs.')
      await chrome.storage.sync.set({ lastAutoScanAt: new Date().toISOString() })
      return
    }

    console.log(`[Engagr] Auto-scan complete — pushing ${scannedPosts.length} posts to backend`)

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

  // Manual feed scan trigger (LinkedIn + X + Reddit)
  if (message.type === 'ENGAGR_SCAN_FEED') {
    autoScanFeed().then((result) => sendResponse({ ok: true }))
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
