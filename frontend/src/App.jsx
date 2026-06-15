import { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './index.css'

import Onboarding from './screens/Onboarding'
import Feed from './screens/Feed'
import Queue from './screens/Queue'
import Settings from './screens/Settings'
import UserMemory from './screens/UserMemory'

const tg = window.Telegram?.WebApp
const urlParams = new URLSearchParams(window.location.search)
const userIdFromQuery = urlParams.get('user_id')
const userIdFromStorage = window.localStorage.getItem('engagr_user_id')
const userId = tg?.initDataUnsafe?.user?.id?.toString() || userIdFromQuery || userIdFromStorage || 'dev_user'
window.localStorage.setItem('engagr_user_id', userId)
const API_BASE = import.meta.env.VITE_API_URL || 'https://engagr-production.up.railway.app'

// Auto-detect language from Telegram user settings
const SUPPORTED_LANGS = ['en', 'ru', 'es', 'de']
function detectTelegramLanguage() {
  // Primary: Telegram language_code from initDataUnsafe
  const tgLang = tg?.initDataUnsafe?.user?.language_code || ''
  if (tgLang) {
    const base = tgLang.split('-')[0].toLowerCase()
    if (SUPPORTED_LANGS.includes(base)) return base
  }
  // Secondary: navigator.language
  const navLang = (navigator.language || navigator.userLanguage || 'en').split('-')[0].toLowerCase()
  return SUPPORTED_LANGS.includes(navLang) ? navLang : 'en'
}

export const detectedLanguage = detectTelegramLanguage()

export const api = {
  async get(path) {
    const res = await fetch(`${API_BASE}${path}`)
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  },
  async put(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  },
  async post(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    })
    let body = {}
    try { body = await res.json() } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error(body.error || body.message || `API error: ${res.status}`)
      err.status = res.status
      err.body = body
      throw err
    }
    return body
  },
}

export const translations = {
  en: {
    feed: 'Feed', queue: 'Queue', settings: 'Settings', profile: 'Profile',
    loading: 'Loading...', appName: 'Engagr',
  },
  ru: {
    feed: 'Feed', queue: 'Очередь', settings: 'Настройки', profile: 'Профиль',
    loading: 'Загрузка...', appName: 'Engagr',
  },
  es: {
    feed: 'Feed', queue: 'Cola', settings: 'Ajustes', profile: 'Perfil',
    loading: 'Cargando...', appName: 'Engagr',
  },
  de: {
    feed: 'Feed', queue: 'Warteschlange', settings: 'Einstellungen', profile: 'Profil',
    loading: 'Laden...', appName: 'Engagr',
  },
}

const NAV_ITEMS = [
  { id: 'feed', labelKey: 'feed', icon: FeedIcon },
  { id: 'queue', labelKey: 'queue', icon: QueueIcon },
  { id: 'settings', labelKey: 'settings', icon: SettingsIcon },
  { id: 'profile', labelKey: 'profile', icon: ProfileIcon },
]

// ── Extension bridge state (shared across screens) ──────────────────────
export const ExtensionContext = {
  isPresent: false,
  lastSync: null,
}

function App() {
  const [screen, setScreen] = useState('loading')
  const [settings, setSettings] = useState(null)
  // Language: from settings or auto-detected from Telegram
  const language = settings?.language || detectedLanguage
  const t = useMemo(() => translations[language] || translations.en, [language])
  const [webAppReady, setWebAppReady] = useState(!window.Telegram?.WebApp)

  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    if (webApp) {
      try {
        webApp.ready?.()
        webApp.expand?.()
        // Set header color to match our theme
        webApp.setHeaderColor?.('#ffffff')
        webApp.setBackgroundColor?.('#f8fafc')
      } catch {}
      setWebAppReady(true)
    } else {
      const timer = setTimeout(() => setWebAppReady(true), 500)
      return () => clearTimeout(timer)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.get(`/api/settings/${userId}`)
      // Auto-set language if not set yet
      if (!data?.language && detectedLanguage) {
        await api.put(`/api/settings/${userId}`, { language: detectedLanguage })
        data.language = detectedLanguage
      }
      setSettings(data)
      setScreen(data?.onboarding_completed ? 'feed' : 'onboarding')
    } catch (err) {
      console.error('Failed to load settings:', err)
      setScreen('onboarding')
    }
  }, [])

  const handleSettingsUpdate = useCallback(async (updates) => {
    try {
      await api.put(`/api/settings/${userId}`, updates)
      setSettings(await api.get(`/api/settings/${userId}`))
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }, [])

  useEffect(() => {
    if (webAppReady) loadSettings()
  }, [webAppReady])
  // ── Extension bridge: listen for BRIDGE_READY signal ──────────────────
  useEffect(() => {
    const handleExtMessage = (event) => {
      if (event.source !== window) return
      const data = event.data || {}
      if (data.source !== 'ENGAGR_EXTENSION') return

      if (data.type === 'ENGAGR_BRIDGE_READY') {
        ExtensionContext.isPresent = true
        // Re-fire context immediately so extension gets userId right after READY
        if (settings) {
          window.postMessage({
            source: 'ENGAGR_MINI_APP',
            type: 'ENGAGR_MINI_APP_CONTEXT',
            payload: {
              userId,
              apiBaseUrl: API_BASE,
              miniAppUrl: window.location.origin,
              language,
              linkedin: settings.linkedin || {},
              reddit: settings.reddit || {},
            },
          }, '*')
        }
      }

      if (data.type === 'ENGAGR_CONTEXT_SYNCED') {
        ExtensionContext.lastSync = new Date().toISOString()
      }
    }

    window.addEventListener('message', handleExtMessage)

    // Ping extension to check if already ready (e.g. page reload)
    window.postMessage({ source: 'ENGAGR_MINI_APP', type: 'ENGAGR_PING' }, '*')

    return () => window.removeEventListener('message', handleExtMessage)
  }, [settings, language])

  // ── Fire context whenever settings change ────────────────────────────────
  useEffect(() => {
    if (!settings) return

    window.postMessage({
      source: 'ENGAGR_MINI_APP',
      type: 'ENGAGR_MINI_APP_CONTEXT',
      payload: {
        userId,
        apiBaseUrl: API_BASE,
        miniAppUrl: window.location.origin,
        language,
        linkedin: settings.linkedin || {},
        reddit: settings.reddit || {},
      },
    }, '*')
  }, [settings, language])


  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('linkedin') === 'connected') {
      window.history.replaceState({}, '', '/')
      loadSettings().then(() => setScreen('settings'))
    }
    // Deep link: ?screen=feed|queue|settings|profile opens the target tab directly.
    const screenParam = params.get('screen')
    const legacyMap = { dashboard: 'feed', linkedin: 'settings', reddit: 'settings', more: 'settings', memory: 'profile', ideas: 'settings', x: 'settings' }
    const mappedScreen = legacyMap[screenParam] || screenParam
    if (mappedScreen && ['feed', 'queue', 'settings', 'profile'].includes(mappedScreen)) {
      window.history.replaceState({}, '', '/')
      setScreen(mappedScreen)
    }
  }, [])

  if (!webAppReady || screen === 'loading') return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: '#f8fafc' }}>
      <div className="text-center animate-fade-in">
        <div className="text-2xl font-bold tracking-tight mb-2">Engagr</div>
        <div className="text-sm" style={{ color: 'var(--color-muted)' }}>{t.loading}</div>
        <div className="mt-4 flex justify-center gap-1">
          {[0,1,2].map(i => (
            <div key={i} className="w-2 h-2 rounded-full" style={{
              background: '#0A66C2',
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`
            }} />
          ))}
        </div>
      </div>
    </div>
  )

  if (screen === 'onboarding') return <Onboarding userId={userId} detectedLanguage={detectedLanguage} onComplete={loadSettings} />

  return (
    <div className="flex flex-col min-h-screen app-shell">
      <main className="flex-1 overflow-y-auto pb-20">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screen}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            {screen === 'feed' && <div className="page-transition"><Feed userId={userId} language={language} /></div>}
            {screen === 'queue' && <div className="page-transition"><Queue userId={userId} language={language} /></div>}
            {screen === 'settings' && <div className="page-transition"><Settings userId={userId} settings={settings} language={language} onSettingsUpdate={handleSettingsUpdate} onNavigate={setScreen} /></div>}
            {screen === 'profile' && <div className="page-transition"><UserMemory userId={userId} language={language} /></div>}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-1" style={{ borderColor: '#e5e7eb' }}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-item ${screen === item.id ? 'active' : ''}`}
            onClick={() => setScreen(item.id)}
          >
            <item.icon />
            <span>{t[item.labelKey] || item.id}</span>
          </button>
        ))}
      </nav>
      <Analytics />
      <SpeedInsights />
    </div>
  )
}

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round' }
function FeedIcon() { return <svg viewBox="0 0 24 24" {...base}><path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h10"/><circle cx="18" cy="19" r="2"/></svg> }
function QueueIcon() { return <svg viewBox="0 0 24 24" {...base}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/><path d="M9 12h6"/><path d="M9 16h6"/></svg> }
function SettingsIcon() { return <svg viewBox="0 0 24 24" {...base}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.1V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.31.36.58.64.76.28.18.61.27.96.24H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z"/></svg> }
function ProfileIcon() { return <svg viewBox="0 0 24 24" {...base}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg> }

export default App
export { userId }
