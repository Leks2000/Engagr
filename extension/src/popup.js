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

async function renderActiveTab() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ENGAGR_GET_ACTIVE_TAB' })
    const url = response?.tab?.url || ''
    const isLinkedIn = /^https?:\/\/(www\.)?linkedin\.com\//i.test(url)
    elements.activeTabLabel.textContent = isLinkedIn ? 'LinkedIn tab detected' : 'Ready for LinkedIn workflows'
  } catch {
    elements.activeTabLabel.textContent = 'Ready for LinkedIn workflows'
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

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings()
  renderSettings(settings)
  await renderActiveTab()
  await checkConnection(settings)
})
