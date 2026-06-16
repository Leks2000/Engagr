/**
 * popup.js — Engagr WebBridge popup logic
 *
 * Handles:
 *  - Connection status & authentication
 *  - Task polling display with badge
 *  - LinkedIn feed scanning & AI comments
 *  - X/Twitter feed scanning & AI comments
 *  - Platform tab switching
 *  - Extension login flow
 */

const DEFAULT_SETTINGS = {
  miniAppUrl: 'http://localhost:5173',
  apiBaseUrl: 'https://engagr-production.up.railway.app',
  telegramUserId: '',
  aiProvider: 'groq',
  jwtToken: '',
  linkedinKeywords: [],
}

// ─── DOM References ───────────────────────────────────────

const $ = (sel) => document.querySelector(sel)
const elements = {
  // Header
  activeTabLabel: $('#activeTabLabel'),
  statusPill: $('#statusPill'),
  statusText: $('#statusText'),
  heroTitle: $('#heroTitle'),
  heroSubtitle: $('#heroSubtitle'),
  checkButton: $('#checkButton'),
  pollTasksButton: $('#pollTasksButton'),
  // Auth
  authInfo: $('#authInfo'),
  syncedUserId: $('#syncedUserId'),
  authMethod: $('#authMethod'),
  syncedKeywords: $('#syncedKeywords'),
  syncSummary: $('#syncSummary'),
  loginSection: $('#loginSection'),
  loginCodeInput: $('#loginCodeInput'),
  loginButton: $('#loginButton'),
  loginError: $('#loginError'),
  // Tabs
  platformTabs: $('#platformTabs'),
  taskBadge: $('#taskBadge'),
  // Tasks panel
  tasksPanel: $('#tasksPanel'),
  actionsStatus: $('#actionsStatus'),
  actionsCount: $('#actionsCount'),
  approvedActions: $('#approvedActions'),
  // LinkedIn panel
  linkedinPanel: $('#linkedinPanel'),
  scanLinkedInButton: $('#scanLinkedInButton'),
  parserStatus: $('#parserStatus'),
  parserCount: $('#parserCount'),
  parsedPosts: $('#parsedPosts'),
  // X panel
  xPanel: $('#xPanel'),
  scanXButton: $('#scanXButton'),
  xStatus: $('#xStatus'),
  xCount: $('#xCount'),
  parsedTweets: $('#parsedTweets'),
  // Reddit panel
  redditPanel: $('#redditPanel'),
  scanRedditButton: $('#scanRedditButton'),
  redditStatus: $('#redditStatus'),
  redditCount: $('#redditCount'),
  parsedRedditPosts: $('#parsedRedditPosts'),
  // Footer
  lastPollTime: $('#lastPollTime'),
}

// ─── State ────────────────────────────────────────────────

let activePanel = 'tasks'
let pendingTasks = []
let parsedLinkedInPosts = []
let parsedXTweets = []
let parsedRedditPosts = []

// ─── Utilities ────────────────────────────────────────────

function normalizeUrl(value, fallback = DEFAULT_SETTINGS.apiBaseUrl) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  try {
    return new URL(trimmed).toString().replace(/\/$/, '')
  } catch {
    return trimmed
  }
}

async function loadSettings() {
  const keys = Object.keys(DEFAULT_SETTINGS)
  const stored = await chrome.storage.sync.get(keys)
  return { ...DEFAULT_SETTINGS, ...stored }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function maskUserId(userId) {
  const v = String(userId || '').trim()
  if (!v) return 'Not synced'
  if (v.length <= 4) return v
  return `${v.slice(0, 2)}...${v.slice(-3)}`
}

function timeAgo(isoStr) {
  if (!isoStr) return '—'
  const diff = Date.now() - new Date(isoStr).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return `${Math.floor(diff / 3600000)}h ago`
}

function apiUrl(path, settings) {
  return `${normalizeUrl(settings.apiBaseUrl)}${path}`
}

async function fetchJson(url, options = {}) {
  const settings = await loadSettings()
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }

  if (settings.jwtToken) {
    headers['Authorization'] = `Bearer ${settings.jwtToken}`
  }

  const resp = await fetch(url, { ...options, headers })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || `API ${resp.status}`)
  return data
}

// ─── Platform Tab Switching ───────────────────────────────

function switchPanel(panel) {
  activePanel = panel

  // Update tab buttons
  document.querySelectorAll('.platform-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.platform === panel)
  })

  // Show/hide panels
  elements.tasksPanel.hidden = panel !== 'tasks'
  elements.linkedinPanel.hidden = panel !== 'linkedin'
  elements.xPanel.hidden = panel !== 'x'
  elements.redditPanel.hidden = panel !== 'reddit'
}

// ─── Connection Status ────────────────────────────────────

function setStatus(state, title, subtitle) {
  elements.statusPill.classList.toggle('is-checking', state === 'checking')
  elements.statusPill.classList.toggle('is-offline', state === 'offline')
  elements.statusText.textContent =
    state === 'online' ? 'Connected' : state === 'offline' ? 'Offline' : 'Checking'
  elements.heroTitle.textContent = title
  elements.heroSubtitle.textContent = subtitle
}

async function checkConnection() {
  setStatus('checking', 'Checking connection...', 'Verifying backend & auth')

  try {
    const status = await chrome.runtime.sendMessage({ type: 'ENGAGR_GET_STATUS' })

    if (status.connected) {
      setStatus('online', 'Connected to Engagr', `Backend ${status.backendReachable ? 'reachable' : 'unreachable'}`)

      // Show auth info
      elements.authInfo.hidden = false
      elements.loginSection.hidden = true
      elements.syncedUserId.textContent = maskUserId(status.userId)
      elements.authMethod.textContent = status.authenticated ? 'JWT Token' : 'User ID'
      elements.syncSummary.textContent = status.lastSync ? `Synced ${timeAgo(status.lastSync)}` : 'Synced'

      // Update keywords
      const settings = await loadSettings()
      const kw = Array.isArray(settings.linkedinKeywords) ? settings.linkedinKeywords : []
      elements.syncedKeywords.textContent = kw.length ? kw.slice(0, 4).join(', ') : '—'
    } else {
      setStatus('offline', 'Not connected', 'Login required')
      elements.authInfo.hidden = true
      elements.loginSection.hidden = false
    }

    // Update poll time
    elements.lastPollTime.textContent = status.lastPoll ? `Poll: ${timeAgo(status.lastPoll)}` : 'Not polled'
  } catch {
    setStatus('offline', 'Connection error', 'Check your network')
    elements.loginSection.hidden = false
  }
}

// ─── Login Flow ───────────────────────────────────────────

async function handleLogin() {
  const code = elements.loginCodeInput.value.trim()
  if (!code) {
    showLoginError('Please enter a login code.')
    return
  }

  elements.loginButton.disabled = true
  elements.loginButton.textContent = '...'
  elements.loginError.hidden = true

  try {
    const settings = await loadSettings()
    const response = await chrome.runtime.sendMessage({
      type: 'ENGAGR_EXTENSION_LOGIN',
      payload: { code, apiBaseUrl: settings.apiBaseUrl },
    })

    if (response.ok) {
      elements.loginCodeInput.value = ''
      await checkConnection()
      await loadTasks()
    } else {
      showLoginError(response.error || 'Login failed.')
    }
  } catch (err) {
    showLoginError(err.message || 'Network error.')
  }

  elements.loginButton.disabled = false
  elements.loginButton.textContent = 'Connect'
}

function showLoginError(msg) {
  elements.loginError.textContent = msg
  elements.loginError.hidden = false
}

// ─── Tasks Loading ────────────────────────────────────────

async function loadTasks() {
  elements.actionsStatus.textContent = 'Loading approved tasks...'

  try {
    // Trigger poll
    await chrome.runtime.sendMessage({ type: 'ENGAGR_POLL_TASKS' })

    // Read from local storage
    const stored = await chrome.storage.local.get(['pendingTasks', 'lastPollAt'])
    pendingTasks = stored.pendingTasks || []

    renderTasks()
    updateTaskBadge(pendingTasks.length)

    elements.actionsStatus.textContent = pendingTasks.length
      ? `${pendingTasks.length} task${pendingTasks.length === 1 ? '' : 's'} ready for your browser.`
      : 'No approved tasks. Approve items in the Mini App first.'
  } catch (err) {
    elements.actionsStatus.textContent = err.message || 'Failed to load tasks.'
  }
}

function renderTasks() {
  elements.actionsCount.textContent = String(pendingTasks.length)
  elements.approvedActions.hidden = pendingTasks.length === 0

  if (!pendingTasks.length) {
    elements.approvedActions.innerHTML = ''
    return
  }

  elements.approvedActions.innerHTML = pendingTasks.slice(0, 8).map((item, index) => {
    const platform = item.platform || 'linkedin'
    const action = item.action || 'comment'
    const comment = item.selected_comment || item.comment || ''
    const excerpt = item.post_excerpt || item.post_text?.slice(0, 120) || item.topic || ''

    return `
      <article class="task-card">
        <div style="display:flex;gap:4px;margin-bottom:4px;">
          <span class="action-badge ${action}">${actionLabel(action)}</span>
          <span class="platform-badge ${platform}">${platform === 'x' ? 'X' : 'LinkedIn'}</span>
        </div>
        <strong>${escapeHtml(item.author || item.topic || 'Task')}</strong>
        <p>${escapeHtml(excerpt)}</p>
        ${comment ? `<div class="ai-comment"><span>AI ${action === 'thread' ? 'Thread' : 'Comment'}</span><p>${escapeHtml(comment.slice(0, 200))}</p></div>` : ''}
        <div class="post-actions">
          <button type="button" class="mini-action" data-primary="true" data-execute-task="${index}">Open & Prepare</button>
          <button type="button" class="mini-action" data-done="true" data-complete-task="${index}">Done ✓</button>
          <button type="button" class="mini-action" data-dismiss-task="${index}">Skip</button>
        </div>
      </article>
    `
  }).join('')
}

function actionLabel(action) {
  if (action === 'like') return 'Like'
  if (action === 'thread') return 'Thread'
  if (action === 'reply') return 'Reply'
  if (action === 'connect') return 'Connect'
  if (action === 'follow') return 'Follow'
  return 'Comment'
}

function updateTaskBadge(count) {
  elements.taskBadge.textContent = String(count)
  elements.taskBadge.hidden = count === 0
}

async function executeTask(index) {
  const task = pendingTasks[index]
  if (!task) return

  const url = task.post_url || ''
  if (!url) {
    elements.actionsStatus.textContent = 'This task has no URL. Dismiss and retry.'
    return
  }

  elements.actionsStatus.textContent = 'Opening page and preparing action...'

  const actionMessage = buildActionMessage(task)

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'ENGAGR_OPEN_AND_PREPARE',
      payload: { url, actionMessage },
    })

    elements.actionsStatus.textContent = response?.ok
      ? response.note || 'Action prepared! Finish it manually in the tab.'
      : response?.error || 'Could not prepare action. Do it manually.'
  } catch {
    elements.actionsStatus.textContent = 'Could not reach page. Try manually.'
  }
}

function buildActionMessage(task) {
  const platform = task.platform || 'linkedin'
  const action = task.action || 'comment'
  const comment = task.selected_comment || task.comment || ''

  if (platform === 'x') {
    if (action === 'like') return { type: 'ENGAGR_LIKE_X_TWEET' }
    if (action === 'reply') return { type: 'ENGAGR_PREPARE_X_REPLY', payload: { comment, url: task.post_url } }
    return { type: 'ENGAGR_PREPARE_X_REPLY', payload: { comment, url: task.post_url } }
  }

  // LinkedIn
  if (action === 'like') return { type: 'ENGAGR_LIKE_POST', payload: { url: task.post_url } }
  if (action === 'connect') return { type: 'ENGAGR_PREPARE_CONNECT', payload: { url: task.post_url, message: comment } }
  return { type: 'ENGAGR_PREPARE_COMMENT', payload: { url: task.post_url, comment } }
}

async function completeTask(index) {
  const task = pendingTasks[index]
  if (!task) return

  try {
    await chrome.runtime.sendMessage({
      type: 'ENGAGR_UPDATE_TASK_STATUS',
      payload: { taskId: task.id, status: 'completed' },
    })
    pendingTasks.splice(index, 1)
    renderTasks()
    updateTaskBadge(pendingTasks.length)
    elements.actionsStatus.textContent = 'Task marked as completed.'
  } catch (err) {
    elements.actionsStatus.textContent = err.message || 'Failed to update task.'
  }
}

async function dismissTask(index) {
  const task = pendingTasks[index]
  if (!task) return

  try {
    await chrome.runtime.sendMessage({
      type: 'ENGAGR_UPDATE_TASK_STATUS',
      payload: { taskId: task.id, status: 'dismissed' },
    })
    pendingTasks.splice(index, 1)
    renderTasks()
    updateTaskBadge(pendingTasks.length)
    elements.actionsStatus.textContent = 'Task dismissed.'
  } catch (err) {
    elements.actionsStatus.textContent = err.message || 'Failed to dismiss.'
  }
}

// ─── LinkedIn Scanning ────────────────────────────────────

async function scanLinkedInFeed() {
  elements.scanLinkedInButton.disabled = true
  elements.parserStatus.textContent = 'Scanning LinkedIn feed...'

  try {
    const tab = await getActiveTab()
    if (!tab?.id || !isLinkedInUrl(tab.url)) {
      elements.parserStatus.textContent = 'Open a LinkedIn page first, then scan.'
      return
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'ENGAGR_PARSE_LINKEDIN_FEED' })
    parsedLinkedInPosts = Array.isArray(response?.posts) ? response.posts : []

    renderLinkedInPosts()

    if (parsedLinkedInPosts.length > 0) {
      elements.parserStatus.textContent = `Found ${parsedLinkedInPosts.length} post(s). Pushing to Telegram...`
      // Push to backend so Telegram gets the cards
      await chrome.runtime.sendMessage({ type: 'ENGAGR_SCAN_FEED' })
      elements.parserStatus.textContent = `${parsedLinkedInPosts.length} post(s) found & sent to Telegram.`
    } else {
      elements.parserStatus.textContent = 'No posts found. Scroll the LinkedIn feed and try again.'
    }
  } catch (err) {
    elements.parserStatus.textContent = `Error: ${err.message || 'Parser not ready. Reload LinkedIn tab.'}`
  } finally {
    elements.scanLinkedInButton.disabled = false
  }
}

function renderLinkedInPosts() {
  elements.parserCount.textContent = String(parsedLinkedInPosts.length)
  elements.parsedPosts.hidden = parsedLinkedInPosts.length === 0

  elements.parsedPosts.innerHTML = parsedLinkedInPosts.slice(0, 5).map((item, idx) => `
    <article class="parsed-post-card">
      <strong>${escapeHtml(item.author || 'Unknown')}</strong>
      <p>${escapeHtml(item.post || '')}</p>
      <div class="post-actions">
        <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noreferrer">Open</a>
        <button type="button" class="mini-action" data-generate-li="${idx}">Generate AI</button>
      </div>
    </article>
  `).join('')
}

// ─── X/Twitter Scanning ───────────────────────────────────

async function scanXFeed() {
  elements.scanXButton.disabled = true
  elements.xStatus.textContent = 'Scanning X/Twitter feed...'

  try {
    const tab = await getActiveTab()
    if (!tab?.id || !isXUrl(tab.url)) {
      elements.xStatus.textContent = 'Open X/Twitter first, then scan.'
      return
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'ENGAGR_PARSE_X_FEED' })
    parsedXTweets = Array.isArray(response?.posts) ? response.posts : []

    renderXTweets()

    if (parsedXTweets.length > 0) {
      elements.xStatus.textContent = `Found ${parsedXTweets.length} tweet(s). Pushing to Telegram...`
      await chrome.runtime.sendMessage({ type: 'ENGAGR_SCAN_FEED' })
      elements.xStatus.textContent = `${parsedXTweets.length} tweet(s) found & sent to Telegram.`
    } else {
      elements.xStatus.textContent = 'No tweets found. Scroll the X feed and try again.'
    }
  } catch (err) {
    elements.xStatus.textContent = `Error: ${err.message || 'Parser not ready. Reload X tab.'}`
  } finally {
    elements.scanXButton.disabled = false
  }
}

// ─── Reddit Scanning ──────────────────────────────────────

function isRedditUrl(url) {
  return /^https?:\/\/(www\.|old\.)?reddit\.com\//i.test(url || '')
}

async function scanRedditFeed() {
  elements.scanRedditButton.disabled = true
  elements.redditStatus.textContent = 'Scanning Reddit feed...'

  try {
    const tab = await getActiveTab()
    if (!tab?.id || !isRedditUrl(tab.url)) {
      elements.redditStatus.textContent = 'Open Reddit (reddit.com) first, then scan.'
      return
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'ENGAGR_PARSE_REDDIT_FEED' })
    parsedRedditPosts = Array.isArray(response?.posts) ? response.posts : []

    renderRedditPosts()

    if (parsedRedditPosts.length > 0) {
      elements.redditStatus.textContent = `Found ${parsedRedditPosts.length} post(s). Pushing to Telegram...`
      await chrome.runtime.sendMessage({ type: 'ENGAGR_SCAN_FEED' })
      elements.redditStatus.textContent = `${parsedRedditPosts.length} post(s) found & sent to Telegram.`
    } else {
      elements.redditStatus.textContent = 'No posts found. Scroll the Reddit feed and try again.'
    }
  } catch (err) {
    elements.redditStatus.textContent = `Error: ${err.message || 'Parser not ready. Reload Reddit tab.'}`
  } finally {
    elements.scanRedditButton.disabled = false
  }
}

function renderRedditPosts() {
  elements.redditCount.textContent = String(parsedRedditPosts.length)
  elements.parsedRedditPosts.hidden = parsedRedditPosts.length === 0

  elements.parsedRedditPosts.innerHTML = parsedRedditPosts.slice(0, 5).map((item, idx) => `
    <article class="parsed-post-card">
      <strong>${escapeHtml(item.author || 'Unknown')}</strong>
      ${item.subreddit ? `<span style="font-size:10px;color:#ff4500"> r/${escapeHtml(item.subreddit)}</span>` : ''}
      <p>${escapeHtml(item.title || item.post || '')}</p>
      ${item.score !== undefined ? `<div style="font-size:10px;color:#6b7280;">⬆️${item.score} 💬${item.comments || 0}</div>` : ''}
      <div class="post-actions">
        ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open</a>` : ''}
        <button type="button" class="mini-action" data-generate-reddit="${idx}">Generate AI</button>
      </div>
    </article>
  `).join('')
}

function renderXTweets() {
  elements.xCount.textContent = String(parsedXTweets.length)
  elements.parsedTweets.hidden = parsedXTweets.length === 0

  elements.parsedTweets.innerHTML = parsedXTweets.slice(0, 5).map((item, idx) => `
    <article class="parsed-post-card">
      <strong>${escapeHtml(item.author || item.handle || 'Unknown')} ${item.handle ? `<span style="color:#6b7280;font-weight:400">${escapeHtml(item.handle)}</span>` : ''}</strong>
      <p>${escapeHtml(item.post || '')}</p>
      ${item.metrics ? `<div style="font-size:10px;color:#6b7280;">💬${item.metrics.replies || 0} 🔄${item.metrics.retweets || 0} ❤️${item.metrics.likes || 0}</div>` : ''}
      <div class="post-actions">
        ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open</a>` : ''}
        <button type="button" class="mini-action" data-generate-x="${idx}">Generate Reply</button>
      </div>
    </article>
  `).join('')
}

// ─── Tab Detection ────────────────────────────────────────

async function getActiveTab() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'ENGAGR_GET_ACTIVE_TAB' }, (resp) => {
      resolve(resp?.tab || null)
    })
  })
}

function isLinkedInUrl(url) {
  return /^https?:\/\/(www\.)?linkedin\.com\//i.test(url || '')
}

function isXUrl(url) {
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(url || '')
}

async function detectActiveTab() {
  const tab = await getActiveTab()
  if (isLinkedInUrl(tab?.url)) {
    elements.activeTabLabel.textContent = 'LinkedIn tab detected'
  } else if (isXUrl(tab?.url)) {
    elements.activeTabLabel.textContent = 'X/Twitter tab detected'
  } else if (isRedditUrl(tab?.url)) {
    elements.activeTabLabel.textContent = 'Reddit tab detected'
  } else {
    elements.activeTabLabel.textContent = 'Ready for workflows'
  }
}

// ─── Push Generated Post to Queue ────────────────────────
/**
 * After AI reply/comment is generated locally in the popup,
 * push the post + AI variants to the backend queue via
 * POST /api/extension/posts/push so it appears in the Feed.
 *
 * This is the missing link that connects:
 *   Popup AI generation → Backend queue → Feed UI
 */
async function pushGeneratedPostToQueue(settings, { author, post_text, post_url, platform, variants, selected_comment }) {
  try {
    const baseUrl = normalizeUrl(settings.apiBaseUrl)
    const headers = { 'Content-Type': 'application/json' }

    if (settings.jwtToken) {
      headers['Authorization'] = `Bearer ${settings.jwtToken}`
    }

    const body = {
      posts: [
        {
          author: author || 'Unknown',
          post: post_text,
          post_text: post_text,
          url: post_url,
          post_url: post_url,
          platform: platform,
          // Pass already-generated AI variants so backend skips re-generation
          comment_variants: variants,
          selected_comment: selected_comment,
          comment: selected_comment,
        },
      ],
      user_id: settings.telegramUserId || null,
      scanned_at: new Date().toISOString(),
    }

    const resp = await fetch(`${baseUrl}/api/extension/posts/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}))
      console.warn('[Engagr] pushGeneratedPostToQueue failed:', resp.status, err)
    }
  } catch (err) {
    // Non-fatal — popup still shows the generated reply
    console.warn('[Engagr] pushGeneratedPostToQueue error:', err.message)
  }
}

// ─── AI Comment Generation ────────────────────────────────

async function generateLinkedInComment(index) {
  const settings = await loadSettings()
  const userId = settings.telegramUserId
  if (!userId) {
    elements.parserStatus.textContent = 'Connect to Engagr first.'
    return
  }

  const item = parsedLinkedInPosts[index]
  if (!item) return

  elements.parserStatus.textContent = 'Generating AI comment...'

  try {
    const data = await fetchJson(apiUrl(`/api/extension/linkedin/comment/${encodeURIComponent(userId)}`, settings), {
      method: 'POST',
      body: JSON.stringify({
        author: item.author,
        post: item.post,
        url: item.url,
      }),
    })

    const variants = data.variants || (data.comment ? [data.comment] : [])
    const selected = data.selected_comment || data.comment || variants[0] || ''

    parsedLinkedInPosts[index] = {
      ...item,
      aiComment: { variants, selected_comment: selected },
    }
    renderLinkedInPosts()
    elements.parserStatus.textContent = 'AI comment generated. Saving to Feed...'

    // Push post + AI variants to backend queue so it appears in Feed
    await pushGeneratedPostToQueue(settings, {
      author: item.author || '',
      post_text: item.post || '',
      post_url: item.url || '',
      platform: 'linkedin',
      variants,
      selected_comment: selected,
    })

    elements.parserStatus.textContent = 'AI comment generated & saved to Feed.'
  } catch (err) {
    elements.parserStatus.textContent = err.message || 'Generation failed.'
  }
}

async function generateXReply(index) {
  const settings = await loadSettings()
  const userId = settings.telegramUserId
  if (!userId) {
    elements.xStatus.textContent = 'Connect to Engagr first.'
    return
  }

  const item = parsedXTweets[index]
  if (!item) return

  elements.xStatus.textContent = 'Generating AI reply...'

  try {
    const data = await fetchJson(apiUrl(`/api/x/${encodeURIComponent(userId)}/generate-reply`, settings), {
      method: 'POST',
      body: JSON.stringify({
        post_text: item.post,
        post_author: item.handle || item.author,
        post_url: item.url,
        language: 'en',
      }),
    })

    const variants = data.variants || (data.selected_comment ? [data.selected_comment] : [])
    const selected = data.selected_comment || variants[0] || ''

    parsedXTweets[index] = {
      ...item,
      aiReply: { variants, selected_comment: selected },
    }
    renderXTweets()
    elements.xStatus.textContent = 'AI reply generated. Saving to Feed...'

    // Push post + AI variants to backend queue so it appears in Feed
    await pushGeneratedPostToQueue(settings, {
      author: item.author || item.handle || '',
      post_text: item.post || '',
      post_url: item.url || '',
      platform: 'x',
      variants,
      selected_comment: selected,
    })

    elements.xStatus.textContent = 'AI reply generated & saved to Feed.'
  } catch (err) {
    elements.xStatus.textContent = err.message || 'Generation failed.'
  }
}

async function generateRedditComment(index) {
  const settings = await loadSettings()
  const userId = settings.telegramUserId
  if (!userId) {
    elements.redditStatus.textContent = 'Connect to Engagr first.'
    return
  }

  const item = parsedRedditPosts[index]
  if (!item) return

  elements.redditStatus.textContent = 'Generating AI comment...'

  try {
    // Use the LinkedIn comment endpoint (works for any platform)
    const data = await fetchJson(apiUrl(`/api/extension/linkedin/comment/${encodeURIComponent(userId)}`, settings), {
      method: 'POST',
      body: JSON.stringify({
        author: item.author,
        post: item.post || item.title,
        url: item.url,
        platform: 'reddit',
      }),
    })

    const variants = data.variants || (data.comment ? [data.comment] : [])
    const selected = data.selected_comment || data.comment || variants[0] || ''

    parsedRedditPosts[index] = {
      ...item,
      aiComment: { variants, selected_comment: selected },
    }
    renderRedditPosts()
    elements.redditStatus.textContent = 'AI comment generated. Saving to Feed...'

    // Push post + AI variants to backend queue so it appears in Feed
    await pushGeneratedPostToQueue(settings, {
      author: item.author || '',
      post_text: item.post || item.title || '',
      post_url: item.url || '',
      platform: 'reddit',
      variants,
      selected_comment: selected,
    })

    elements.redditStatus.textContent = 'AI comment generated & saved to Feed.'
  } catch (err) {
    elements.redditStatus.textContent = err.message || 'Generation failed.'
  }
}

// Platform tabs
elements.platformTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.platform-tab')
  if (btn?.dataset.platform) {
    switchPanel(btn.dataset.platform)
  }
})

// Check connection
elements.checkButton.addEventListener('click', () => {
  checkConnection()
})

// Poll tasks
elements.pollTasksButton.addEventListener('click', () => {
  loadTasks()
})

// Login
elements.loginButton.addEventListener('click', handleLogin)
elements.loginCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLogin()
})

// LinkedIn scan
elements.scanLinkedInButton.addEventListener('click', scanLinkedInFeed)

// X scan
elements.scanXButton.addEventListener('click', scanXFeed)

// Reddit scan
elements.scanRedditButton.addEventListener('click', scanRedditFeed)

// Task actions (event delegation)
elements.approvedActions.addEventListener('click', (e) => {
  const execBtn = e.target.closest('[data-execute-task]')
  if (execBtn) { executeTask(Number(execBtn.dataset.executeTask)); return }

  const doneBtn = e.target.closest('[data-complete-task]')
  if (doneBtn) { completeTask(Number(doneBtn.dataset.completeTask)); return }

  const dismissBtn = e.target.closest('[data-dismiss-task]')
  if (dismissBtn) { dismissTask(Number(dismissBtn.dataset.dismissTask)); return }
})

// LinkedIn AI generation (event delegation)
elements.parsedPosts.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-generate-li]')
  if (btn) generateLinkedInComment(Number(btn.dataset.generateLi))
})

// X AI generation (event delegation)
elements.parsedTweets.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-generate-x]')
  if (btn) generateXReply(Number(btn.dataset.generateX))
})

// Reddit AI generation (event delegation)
elements.parsedRedditPosts.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-generate-reddit]')
  if (btn) generateRedditComment(Number(btn.dataset.generateReddit))
})

// ─── Initialization ───────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await detectActiveTab()
  await checkConnection()
  await loadTasks()

  // Auto-switch to relevant panel based on active tab
  const tab = await getActiveTab()
  if (isLinkedInUrl(tab?.url)) {
    switchPanel('linkedin')
  } else if (isXUrl(tab?.url)) {
    switchPanel('x')
  } else if (isRedditUrl(tab?.url)) {
    switchPanel('reddit')
  }
})
