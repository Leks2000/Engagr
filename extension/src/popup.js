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

const elements = {
  activeTabLabel: document.querySelector('#activeTabLabel'),
  statusPill: document.querySelector('#statusPill'),
  statusText: document.querySelector('#statusText'),
  heroTitle: document.querySelector('#heroTitle'),
  heroSubtitle: document.querySelector('#heroSubtitle'),
  checkButton: document.querySelector('#checkButton'),
  scanLinkedInButton: document.querySelector('#scanLinkedInButton'),
  parserStatus: document.querySelector('#parserStatus'),
  parserCount: document.querySelector('#parserCount'),
  parsedPosts: document.querySelector('#parsedPosts'),
  syncSummary: document.querySelector('#syncSummary'),
  syncedUserId: document.querySelector('#syncedUserId'),
  syncedKeywords: document.querySelector('#syncedKeywords'),
}

const storageKeys = Object.keys(DEFAULT_SETTINGS)

function normalizeUrl(value, fallback = DEFAULT_SETTINGS.miniAppUrl) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback

  try {
    return new URL(trimmed).toString().replace(/\/$/, '')
  } catch {
    return trimmed
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(storageKeys)
  return { ...DEFAULT_SETTINGS, ...stored }
}

function maskUserId(userId) {
  const value = String(userId || '').trim()
  if (!value) return 'Not synced'
  if (value.length <= 4) return value
  return `${value.slice(0, 2)}…${value.slice(-3)}`
}

function renderSettings(settings) {
  const keywords = Array.isArray(settings.linkedinKeywords) ? settings.linkedinKeywords.filter(Boolean) : []
  elements.syncedUserId.textContent = maskUserId(settings.telegramUserId)
  elements.syncedKeywords.textContent = keywords.length ? keywords.slice(0, 5).join(', ') : 'No LinkedIn keywords selected'
  elements.syncSummary.textContent = settings.telegramUserId
    ? `Synced automatically${settings.lastMiniAppSync ? ` · ${new Date(settings.lastMiniAppSync).toLocaleTimeString()}` : ''}`
    : 'Open Engagr Mini App once and the bridge will connect automatically.'
}

function setStatus(state, title, subtitle) {
  elements.statusPill.classList.toggle('is-checking', state === 'checking')
  elements.statusPill.classList.toggle('is-offline', state === 'offline')
  elements.statusText.textContent = state === 'online' ? 'Connected' : state === 'offline' ? 'Offline' : 'Checking'
  elements.heroTitle.textContent = title
  elements.heroSubtitle.textContent = subtitle
}

async function getActiveTab() {
  const response = await chrome.runtime.sendMessage({ type: 'ENGAGR_GET_ACTIVE_TAB' })
  return response?.tab || null
}

function isLinkedInUrl(url) {
  return /^https?:\/\/(www\.)?linkedin\.com\//i.test(url || '')
}

async function renderActiveTab() {
  try {
    const tab = await getActiveTab()
    elements.activeTabLabel.textContent = isLinkedInUrl(tab?.url) ? 'LinkedIn tab detected' : 'Ready for LinkedIn workflows'
  } catch {
    elements.activeTabLabel.textContent = 'Ready for LinkedIn workflows'
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function selectedComment(item) {
  return item?.aiComment?.selected_comment || item?.aiComment?.variants?.[0] || ''
}

function renderParsedPosts(posts = [], parsedAt = null) {
  elements.parserCount.textContent = String(posts.length)
  elements.parsedPosts.hidden = posts.length === 0
  elements.parserStatus.textContent = posts.length
    ? `Parsed ${posts.length} relevant post${posts.length === 1 ? '' : 's'}${parsedAt ? ' from current feed.' : '.'}`
    : 'Open LinkedIn; Engagr will scan using Mini App settings.'

  elements.parsedPosts.innerHTML = posts.slice(0, 5).map((item, index) => {
    const comment = selectedComment(item)
    const variants = item?.aiComment?.variants || []

    return `
      <article class="parsed-post-card">
        <strong>${escapeHtml(item.author || 'Unknown author')}</strong>
        <p>${escapeHtml(item.post || '')}</p>
        ${comment ? `<div class="ai-comment"><span>AI comment</span><p>${escapeHtml(comment)}</p></div>` : ''}
        ${variants.length > 1 ? `<div class="variant-count">${variants.length} variants ready</div>` : ''}
        <div class="post-actions">
          <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noreferrer">Open post</a>
          <button type="button" class="mini-action" data-generate-index="${index}">${comment ? 'Regenerate' : 'Generate AI'}</button>
        </div>
      </article>
    `
  }).join('')
}

async function loadParsedPosts() {
  const stored = await chrome.storage.local.get(['linkedinParsedPosts', 'linkedinParsedAt'])
  renderParsedPosts(stored.linkedinParsedPosts || [], stored.linkedinParsedAt || null)
}

async function saveParsedPosts(posts, parsedAt = new Date().toISOString()) {
  await chrome.storage.local.set({
    linkedinParsedPosts: posts,
    linkedinParsedAt: parsedAt,
  })
  renderParsedPosts(posts, parsedAt)
}

function apiUrl(path, settings) {
  return `${normalizeUrl(settings.apiBaseUrl, DEFAULT_SETTINGS.apiBaseUrl)}${path}`
}

async function getJson(url) {
  const response = await fetch(url)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `API error: ${response.status}`)
  return data
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`)
  }

  return data
}

async function refreshMiniAppSettings(settings) {
  const userId = settings.telegramUserId.trim()
  if (!userId) return settings

  try {
    const data = await getJson(apiUrl(`/api/settings/${encodeURIComponent(userId)}`, settings))
    const linkedinKeywords = Array.isArray(data?.linkedin?.keywords) ? data.linkedin.keywords : settings.linkedinKeywords
    const next = {
      linkedinKeywords,
      aiProvider: settings.aiProvider || DEFAULT_SETTINGS.aiProvider,
    }
    await chrome.storage.sync.set(next)
    return { ...settings, ...next }
  } catch {
    return settings
  }
}

function filterByKeywords(posts, keywords) {
  const normalized = (keywords || [])
    .map((keyword) => String(keyword || '').trim().toLowerCase())
    .filter(Boolean)

  if (!normalized.length) return posts

  return posts.filter((post) => {
    const text = `${post.author || ''} ${post.post || ''}`.toLowerCase()
    return normalized.some((keyword) => text.includes(keyword))
  })
}

async function generateAiComment(index, { silent = false } = {}) {
  const settings = await loadSettings()
  const userId = settings.telegramUserId.trim()

  if (!userId) {
    if (!silent) elements.parserStatus.textContent = 'Open the Mini App once so the bridge can sync your Telegram user ID.'
    return false
  }

  const stored = await chrome.storage.local.get(['linkedinParsedPosts', 'linkedinParsedAt'])
  const posts = stored.linkedinParsedPosts || []
  const item = posts[index]
  if (!item) return false

  if (!silent) elements.parserStatus.textContent = item.aiComment ? 'Regenerating AI comment…' : 'Generating AI comment…'

  try {
    const previousComment = selectedComment(item)
    const endpoint = previousComment
      ? `/api/extension/linkedin/regenerate/${encodeURIComponent(userId)}`
      : `/api/extension/linkedin/comment/${encodeURIComponent(userId)}`
    const data = await postJson(apiUrl(endpoint, settings), {
      author: item.author,
      post: item.post,
      url: item.url,
      previous_comment: previousComment,
      provider: settings.aiProvider,
    })

    posts[index] = {
      ...item,
      aiComment: {
        variants: data.variants || [data.comment].filter(Boolean),
        selected_comment: data.selected_comment || data.comment || data.variants?.[0] || '',
        post_language: data.post_language || 'en',
        provider: data.provider || settings.aiProvider,
      },
    }

    await saveParsedPosts(posts, stored.linkedinParsedAt || new Date().toISOString())
    if (!silent) elements.parserStatus.textContent = previousComment ? 'AI comment regenerated.' : 'AI comment generated.'
    return true
  } catch (error) {
    if (!silent) elements.parserStatus.textContent = error.message || 'AI comment generation failed.'
    return false
  }
}

async function generateMissingComments(limit = 3) {
  const stored = await chrome.storage.local.get(['linkedinParsedPosts'])
  const posts = stored.linkedinParsedPosts || []
  const indexes = posts
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !selectedComment(item))
    .slice(0, limit)
    .map(({ index }) => index)

  for (const index of indexes) {
    await generateAiComment(index, { silent: true })
  }
}


async function enqueueReadyPosts(limit = 3) {
  const settings = await loadSettings()
  const userId = settings.telegramUserId.trim()
  if (!userId) return { queued: 0, skipped: 0 }

  const stored = await chrome.storage.local.get(['linkedinParsedPosts', 'linkedinQueuedPostKeys'])
  const alreadyQueued = new Set(stored.linkedinQueuedPostKeys || [])
  const posts = (stored.linkedinParsedPosts || [])
    .filter((post) => selectedComment(post))
    .filter((post) => !alreadyQueued.has(post.url || `${post.author}:${post.post?.slice(0, 120)}`))
    .slice(0, limit)

  if (!posts.length) return { queued: 0, skipped: 0 }

  const data = await postJson(apiUrl(`/api/extension/linkedin/queue/${encodeURIComponent(userId)}`, settings), { posts })
  for (const post of posts) {
    alreadyQueued.add(post.url || `${post.author}:${post.post?.slice(0, 120)}`)
  }
  await chrome.storage.local.set({ linkedinQueuedPostKeys: [...alreadyQueued] })
  return data
}


async function scanLinkedInFeed({ auto = false } = {}) {
  elements.scanLinkedInButton.disabled = true
  elements.parserStatus.textContent = auto ? 'Auto-scanning LinkedIn with Mini App settings…' : 'Scanning active LinkedIn tab…'

  try {
    let settings = await loadSettings()
    settings = await refreshMiniAppSettings(settings)
    renderSettings(settings)

    const tab = await getActiveTab()
    if (!tab?.id || !isLinkedInUrl(tab.url)) {
      elements.parserStatus.textContent = settings.telegramUserId
        ? 'Open LinkedIn feed/search; Engagr will use your Mini App keywords.'
        : 'Open Engagr Mini App once to auto-sync, then open LinkedIn.'
      renderParsedPosts([])
      return
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'ENGAGR_PARSE_LINKEDIN_FEED' })
    const parsedPosts = Array.isArray(response?.posts) ? response.posts : []
    const posts = filterByKeywords(parsedPosts, settings.linkedinKeywords)
    const parsedAt = response?.parsedAt || new Date().toISOString()

    await saveParsedPosts(posts, parsedAt)

    if (!posts.length) {
      elements.parserStatus.textContent = settings.linkedinKeywords?.length
        ? `No posts matched: ${settings.linkedinKeywords.slice(0, 3).join(', ')}. Scroll/search LinkedIn and scan again.`
        : 'No feed posts found yet. Add keywords in Mini App or scroll LinkedIn and scan again.'
      return
    }

    await generateMissingComments(3)
    const queueResult = await enqueueReadyPosts(3)
    elements.parserStatus.textContent = queueResult.queued > 0
      ? `Queued ${queueResult.queued} post${queueResult.queued === 1 ? '' : 's'} for Mini App approval.`
      : `Ready: ${posts.length} matched post${posts.length === 1 ? '' : 's'} from Mini App settings.`
  } catch {
    elements.parserStatus.textContent = 'Parser is not ready. Reload the LinkedIn tab and try again.'
  } finally {
    elements.scanLinkedInButton.disabled = false
  }
}

async function checkConnection(settings = null) {
  let current = settings || await loadSettings()
  current = await refreshMiniAppSettings(current)
  renderSettings(current)
  const miniAppUrl = normalizeUrl(current.miniAppUrl)

  setStatus('checking', 'Checking Mini App sync', 'Looking for your Engagr Mini App context')

  if (!current.telegramUserId) {
    setStatus('offline', 'Mini App not synced', 'Open Engagr Mini App once; no extension form is needed')
    return
  }

  try {
    await chrome.storage.sync.set({
      miniAppUrl,
      lastConnectionCheck: new Date().toISOString(),
    })

    setStatus('online', 'Synced with Mini App', 'Browser bridge is using your Telegram settings')
  } catch {
    setStatus('offline', 'Mini App sync unavailable', 'Open Engagr Mini App and try again')
  }
}

elements.checkButton.addEventListener('click', () => checkConnection().then(() => scanLinkedInFeed({ auto: true })))
elements.scanLinkedInButton.addEventListener('click', () => scanLinkedInFeed())
elements.parsedPosts.addEventListener('click', (event) => {
  const button = event.target.closest('[data-generate-index]')
  if (!button) return
  generateAiComment(Number(button.dataset.generateIndex))
})

document.addEventListener('DOMContentLoaded', async () => {
  let settings = await loadSettings()
  settings = await refreshMiniAppSettings(settings)
  renderSettings(settings)
  await renderActiveTab()
  await loadParsedPosts()
  await checkConnection(settings)

  const tab = await getActiveTab().catch(() => null)
  if (settings.autoScanLinkedIn && isLinkedInUrl(tab?.url)) {
    await scanLinkedInFeed({ auto: true })
  }
})
