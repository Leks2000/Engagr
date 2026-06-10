const DEFAULT_SETTINGS = {
  miniAppUrl: 'http://localhost:5173',
  apiBaseUrl: 'https://engagr-production.up.railway.app',
  telegramUserId: '',
  aiProvider: 'groq',
  autoOpenLinkedIn: true,
  lastConnectionCheck: null,
}

const elements = {
  activeTabLabel: document.querySelector('#activeTabLabel'),
  statusPill: document.querySelector('#statusPill'),
  statusText: document.querySelector('#statusText'),
  heroTitle: document.querySelector('#heroTitle'),
  heroSubtitle: document.querySelector('#heroSubtitle'),
  miniAppUrl: document.querySelector('#miniAppUrl'),
  apiBaseUrl: document.querySelector('#apiBaseUrl'),
  telegramUserId: document.querySelector('#telegramUserId'),
  aiProvider: document.querySelector('#aiProvider'),
  autoOpenLinkedIn: document.querySelector('#autoOpenLinkedIn'),
  saveButton: document.querySelector('#saveButton'),
  checkButton: document.querySelector('#checkButton'),
  scanLinkedInButton: document.querySelector('#scanLinkedInButton'),
  parserStatus: document.querySelector('#parserStatus'),
  parserCount: document.querySelector('#parserCount'),
  parsedPosts: document.querySelector('#parsedPosts'),
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

async function saveSettings() {
  const settings = {
    miniAppUrl: normalizeUrl(elements.miniAppUrl.value),
    apiBaseUrl: normalizeUrl(elements.apiBaseUrl.value, DEFAULT_SETTINGS.apiBaseUrl),
    telegramUserId: elements.telegramUserId.value.trim(),
    aiProvider: elements.aiProvider.value,
    autoOpenLinkedIn: elements.autoOpenLinkedIn.checked,
  }

  await chrome.storage.sync.set(settings)
  await checkConnection(settings)
}

function renderSettings(settings) {
  elements.miniAppUrl.value = settings.miniAppUrl
  elements.apiBaseUrl.value = settings.apiBaseUrl
  elements.telegramUserId.value = settings.telegramUserId
  elements.aiProvider.value = settings.aiProvider
  elements.autoOpenLinkedIn.checked = Boolean(settings.autoOpenLinkedIn)
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
    ? `Parsed ${posts.length} post${posts.length === 1 ? '' : 's'}${parsedAt ? ' from current feed.' : '.'}`
    : 'Scan the open LinkedIn feed for posts.'

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

async function generateAiComment(index) {
  const settings = await loadSettings()
  const userId = settings.telegramUserId.trim()

  if (!userId) {
    elements.parserStatus.textContent = 'Set Telegram user ID before generating AI comments.'
    return
  }

  const stored = await chrome.storage.local.get(['linkedinParsedPosts', 'linkedinParsedAt'])
  const posts = stored.linkedinParsedPosts || []
  const item = posts[index]
  if (!item) return

  elements.parserStatus.textContent = item.aiComment ? 'Regenerating AI comment…' : 'Generating AI comment…'

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
    elements.parserStatus.textContent = previousComment ? 'AI comment regenerated.' : 'AI comment generated.'
  } catch (error) {
    elements.parserStatus.textContent = error.message || 'AI comment generation failed.'
  }
}

async function scanLinkedInFeed() {
  elements.scanLinkedInButton.disabled = true
  elements.parserStatus.textContent = 'Scanning active LinkedIn tab…'

  try {
    const tab = await getActiveTab()
    if (!tab?.id || !isLinkedInUrl(tab.url)) {
      elements.parserStatus.textContent = 'Open LinkedIn feed first, then scan again.'
      renderParsedPosts([])
      return
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'ENGAGR_PARSE_LINKEDIN_FEED' })
    const posts = Array.isArray(response?.posts) ? response.posts : []
    const parsedAt = response?.parsedAt || new Date().toISOString()

    await saveParsedPosts(posts, parsedAt)

    if (!posts.length) {
      elements.parserStatus.textContent = 'No feed posts found yet. Scroll LinkedIn and scan again.'
    }
  } catch {
    elements.parserStatus.textContent = 'Parser is not ready. Reload the LinkedIn tab and try again.'
  } finally {
    elements.scanLinkedInButton.disabled = false
  }
}

async function checkConnection(settings = null) {
  const current = settings || await loadSettings()
  const miniAppUrl = normalizeUrl(current.miniAppUrl)

  setStatus('checking', 'Checking Mini App', 'Looking for your Engagr control center')

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(miniAppUrl, {
      method: 'GET',
      mode: 'no-cors',
      signal: controller.signal,
    })
    clearTimeout(timeout)

    await chrome.storage.sync.set({
      miniAppUrl,
      lastConnectionCheck: new Date().toISOString(),
    })

    setStatus('online', 'Desktop client connected', response ? 'Browser assistant is ready' : 'Mini App endpoint reached')
  } catch {
    setStatus('offline', 'Mini App not reachable', 'Start the Mini App or update the URL')
  }
}

elements.saveButton.addEventListener('click', saveSettings)
elements.checkButton.addEventListener('click', () => checkConnection())
elements.scanLinkedInButton.addEventListener('click', scanLinkedInFeed)
elements.parsedPosts.addEventListener('click', (event) => {
  const button = event.target.closest('[data-generate-index]')
  if (!button) return
  generateAiComment(Number(button.dataset.generateIndex))
})

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings()
  renderSettings(settings)
  await renderActiveTab()
  await loadParsedPosts()
  await checkConnection(settings)
})
