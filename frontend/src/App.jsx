import { useState, useEffect, useCallback, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './index.css'

import Onboarding from './screens/Onboarding'
import Dashboard from './screens/Dashboard'
import LinkedInSettings from './screens/LinkedInSettings'
import RedditSettings from './screens/RedditSettings'
import Queue from './screens/Queue'
import ControlCenter from './screens/ControlCenter'
import UserMemory from './screens/UserMemory'
import IdeasEngine from './screens/IdeasEngine'
import XSettings from './screens/XSettings'

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
    dashboard: 'Dashboard', linkedin: 'LinkedIn', reddit: 'Reddit', queue: 'Queue', more: 'More',
    loading: 'Loading...', appName: 'Engagr',
  },
  ru: {
    dashboard: 'Главная', linkedin: 'LinkedIn', reddit: 'Reddit', queue: 'Очередь', more: 'Ещё',
    loading: 'Загрузка...', appName: 'Engagr',
  },
  es: {
    dashboard: 'Panel', linkedin: 'LinkedIn', reddit: 'Reddit', queue: 'Cola', more: 'Más',
    loading: 'Cargando...', appName: 'Engagr',
  },
  de: {
    dashboard: 'Übersicht', linkedin: 'LinkedIn', reddit: 'Reddit', queue: 'Warteschlange', more: 'Mehr',
    loading: 'Laden...', appName: 'Engagr',
  },
}

const NAV_ITEMS = [
  { id: 'dashboard', labelKey: 'dashboard', icon: DashboardIcon },
  { id: 'linkedin', labelKey: 'linkedin', icon: LinkedInIcon },
  { id: 'reddit', labelKey: 'reddit', icon: RedditIcon },
  { id: 'queue', labelKey: 'queue', icon: QueueIcon },
  { id: 'more', labelKey: 'more', icon: MoreIcon },
]

// ── Extension bridge state (shared across screens) ──────────────────────
export const ExtensionContext = {
  isPresent: false,
  lastSync: null,
}

function App() {
  const [screen, setScreen] = useState('loading')
  const [settings, setSettings] = useState(null)
  const [extensionPresent, setExtensionPresent] = useState(false)
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
      setScreen(data?.onboarding_completed ? 'dashboard' : 'onboarding')
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
        setExtensionPresent(true)
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
      loadSettings().then(() => setScreen('linkedin'))
    }
    // Deep link: ?screen=queue opens Queue tab directly
    const screenParam = params.get('screen')
    if (screenParam && ['dashboard', 'queue', 'linkedin', 'reddit', 'more', 'memory', 'ideas', 'x'].includes(screenParam)) {
      window.history.replaceState({}, '', '/')
      setScreen(screenParam)
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
            {screen === 'dashboard' && <div className="page-transition"><Dashboard userId={userId} settings={settings} onSettingsUpdate={handleSettingsUpdate} onNavigate={setScreen} language={language} extensionPresent={extensionPresent} /></div>}
            {screen === 'linkedin' && <div className="page-transition"><LinkedInSettings userId={userId} settings={settings} onSettingsUpdate={handleSettingsUpdate} /></div>}
            {screen === 'reddit' && <div className="page-transition"><RedditSettings userId={userId} settings={settings} onSettingsUpdate={handleSettingsUpdate} /></div>}
            {screen === 'queue' && <div className="page-transition"><Queue userId={userId} language={language} /></div>}
            {screen === 'memory' && <div className="page-transition"><UserMemory userId={userId} language={language} /></div>}
            {screen === 'ideas' && <div className="page-transition"><IdeasEngine userId={userId} language={language} /></div>}
            {screen === 'x' && <div className="page-transition"><XSettings language={language} /></div>}
            {screen === 'more' && <div className="page-transition"><ControlCenter userId={userId} settings={settings} language={language} onSettingsUpdate={handleSettingsUpdate} onNavigate={setScreen} /></div>}
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
function DashboardIcon() { return <svg viewBox="0 0 24 24" {...base}><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 5-5"/></svg> }
function LinkedInIcon() { return <svg viewBox="0 0 24 24" {...base}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><path d="M2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg> }
function RedditIcon() { return <svg viewBox="0 0 24 24" {...base}><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M8 17c2.667 1 5.333 1 8 0"/><path d="M5 12c0-3 3-5 7-5s7 2 7 5-3 6-7 6-7-3-7-6Z"/><path d="M15 7l1-4 3 1"/><circle cx="19" cy="10" r="1"/><circle cx="5" cy="10" r="1"/></svg> }
function QueueIcon() { return <svg viewBox="0 0 24 24" {...base}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/><path d="M9 12h6"/><path d="M9 16h6"/></svg> }
function MoreIcon() { return <svg viewBox="0 0 24 24" {...base}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg> }

export default App
export { userId }
