const DEFAULT_SETTINGS = {
  miniAppUrl: 'http://localhost:5173',
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

function normalizeUrl(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return DEFAULT_SETTINGS.miniAppUrl

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
    telegramUserId: elements.telegramUserId.value.trim(),
    aiProvider: elements.aiProvider.value,
    autoOpenLinkedIn: elements.autoOpenLinkedIn.checked,
  }

  await chrome.storage.sync.set(settings)
  await checkConnection(settings)
}

function renderSettings(settings) {
  elements.miniAppUrl.value = settings.miniAppUrl
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

function renderParsedPosts(posts = [], parsedAt = null) {
  elements.parserCount.textContent = String(posts.length)
  elements.parsedPosts.hidden = posts.length === 0
  elements.parserStatus.textContent = posts.length
    ? `Parsed ${posts.length} post${posts.length === 1 ? '' : 's'}${parsedAt ? ' from current feed.' : '.'}`
    : 'Scan the open LinkedIn feed for posts.'

  elements.parsedPosts.innerHTML = posts.slice(0, 5).map((item) => `
    <article class="parsed-post-card">
      <strong>${escapeHtml(item.author || 'Unknown author')}</strong>
      <p>${escapeHtml(item.post || '')}</p>
      <a href="${escapeHtml(item.url || '#')}" target="_blank" rel="noreferrer">Open post</a>
    </article>
  `).join('')
}

async function loadParsedPosts() {
  const stored = await chrome.storage.local.get(['linkedinParsedPosts', 'linkedinParsedAt'])
  renderParsedPosts(stored.linkedinParsedPosts || [], stored.linkedinParsedAt || null)
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

    await chrome.storage.local.set({
      linkedinParsedPosts: posts,
      linkedinParsedAt: parsedAt,
    })

    renderParsedPosts(posts, parsedAt)

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

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings()
  renderSettings(settings)
  await renderActiveTab()
  await loadParsedPosts()
  await checkConnection(settings)
})
