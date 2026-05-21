import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import './index.css'

import Onboarding from './screens/Onboarding'
import Dashboard from './screens/Dashboard'
import LinkedInSettings from './screens/LinkedInSettings'
import RedditSettings from './screens/RedditSettings'
import Queue from './screens/Queue'

const tg = window.Telegram?.WebApp
const userId = tg?.initDataUnsafe?.user?.id?.toString() || 'dev_user'
const API_BASE = import.meta.env.VITE_API_URL || ''

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
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  },
}

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { id: 'linkedin', label: 'LinkedIn', icon: LinkedInIcon },
  { id: 'reddit', label: 'Reddit', icon: RedditIcon },
  { id: 'queue', label: 'Queue', icon: QueueIcon },
]

function App() {
  const [screen, setScreen] = useState('loading')
  const [settings, setSettings] = useState(null)
  const [webAppReady, setWebAppReady] = useState(!window.Telegram?.WebApp)

  useEffect(() => {
    const webApp = window.Telegram?.WebApp
    if (webApp) {
      try { webApp.ready?.(); webApp.expand?.() } catch {}
      setWebAppReady(true)
    } else {
      const timer = setTimeout(() => setWebAppReady(true), 500)
      return () => clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (webAppReady) loadSettings()
  }, [webAppReady, loadSettings])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('linkedin') === 'connected') {
      window.history.replaceState({}, '', '/')
      loadSettings().then(() => setScreen('linkedin'))
    }
  }, [loadSettings])

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.get(`/api/settings/${userId}`)
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

  if (!webAppReady || screen === 'loading') return <div className="flex items-center justify-center min-h-screen"><div className="text-center animate-fade-in"><div className="text-2xl font-bold tracking-tight mb-2">Engagr</div><div className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div></div></div>
  if (screen === 'onboarding') return <Onboarding userId={userId} onComplete={() => { loadSettings(); setScreen('dashboard') }} />

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
            {screen === 'dashboard' && <div className="page-transition"><Dashboard userId={userId} settings={settings} onSettingsUpdate={handleSettingsUpdate} /></div>}
            {screen === 'linkedin' && <div className="page-transition"><LinkedInSettings userId={userId} settings={settings} onSettingsUpdate={handleSettingsUpdate} /></div>}
            {screen === 'reddit' && <div className="page-transition"><RedditSettings userId={userId} settings={settings} onSettingsUpdate={handleSettingsUpdate} /></div>}
            {screen === 'queue' && <div className="page-transition"><Queue userId={userId} /></div>}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-1" style={{ borderColor: '#e5e7eb' }}>
        {NAV_ITEMS.map(item => <button key={item.id} className={`nav-item ${screen === item.id ? 'active' : ''}`} onClick={() => setScreen(item.id)}><item.icon /><span>{item.label}</span></button>)}
      </nav>
      <Analytics />
      <SpeedInsights />
    </div>
  )
}

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round' }
function DashboardIcon() { return <svg viewBox="0 0 24 24" {...base}><path d="M3 13h8V3H3zM13 21h8v-8h-8zM13 3h8v6h-8zM3 21h8v-4H3z"/></svg> }
function LinkedInIcon() { return <svg viewBox="0 0 24 24" {...base}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><path d="M2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg> }
function RedditIcon() { return <svg viewBox="0 0 24 24" {...base}><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M8 17c2.667 1 5.333 1 8 0"/><path d="M5 12c0-3 3-5 7-5s7 2 7 5-3 6-7 6-7-3-7-6Z"/><path d="M15 7l1-4 3 1"/><circle cx="19" cy="10" r="1"/><circle cx="5" cy="10" r="1"/></svg> }
function QueueIcon() { return <svg viewBox="0 0 24 24" {...base}><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg> }

export default App
export { userId }
