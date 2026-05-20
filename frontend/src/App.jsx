import { useState, useEffect, useCallback } from 'react'
import './index.css'

import Onboarding from './screens/Onboarding'
import Dashboard from './screens/Dashboard'
import LinkedInSettings from './screens/LinkedInSettings'
import RedditSettings from './screens/RedditSettings'
import Queue from './screens/Queue'

// ── Telegram WebApp SDK ──────────────────────────────
const tg = window.Telegram?.WebApp
const userId = tg?.initDataUnsafe?.user?.id?.toString() || 'dev_user'

// ── API helpers ──────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || ''

export const api = {
  async get(path) {
    const res = await fetch(`${API_BASE}${path}`)
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  },
  async put(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  },
  async post(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  },
}

// ── Navigation ───────────────────────────────────────
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { id: 'linkedin', label: 'LinkedIn', icon: LinkedInIcon },
  { id: 'reddit', label: 'Reddit', icon: RedditIcon },
  { id: 'queue', label: 'Queue', icon: QueueIcon },
]

function App() {
  const [screen, setScreen] = useState('loading')
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    // Expand Telegram Mini App
    tg?.expand?.()
    tg?.ready?.()

    // Load settings
    loadSettings()
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.get(`/api/settings/${userId}`)
      setSettings(data)
      
      // Check if onboarding was completed
      if (data?.onboarding_completed) {
        setScreen('dashboard')
      } else {
        setScreen('onboarding')
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
      setScreen('onboarding')
    }
  }, [])

  const handleSettingsUpdate = useCallback(async (updates) => {
    try {
      await api.put(`/api/settings/${userId}`, updates)
      const fresh = await api.get(`/api/settings/${userId}`)
      setSettings(fresh)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }, [])

  const handleOnboardingComplete = useCallback(() => {
    loadSettings()
    setScreen('dashboard')
  }, [loadSettings])

  if (screen === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center animate-fade-in">
          <div className="text-2xl font-bold tracking-tight mb-2">Engagr</div>
          <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>
        </div>
      </div>
    )
  }

  if (screen === 'onboarding') {
    return <Onboarding userId={userId} onComplete={handleOnboardingComplete} />
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20">
        {screen === 'dashboard' && (
          <Dashboard 
            userId={userId} 
            settings={settings} 
            onSettingsUpdate={handleSettingsUpdate} 
          />
        )}
        {screen === 'linkedin' && (
          <LinkedInSettings 
            userId={userId} 
            settings={settings} 
            onSettingsUpdate={handleSettingsUpdate} 
          />
        )}
        {screen === 'reddit' && (
          <RedditSettings 
            userId={userId} 
            settings={settings} 
            onSettingsUpdate={handleSettingsUpdate} 
          />
        )}
        {screen === 'queue' && (
          <Queue userId={userId} />
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-1" style={{ borderColor: '#eee' }}>
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-item ${screen === item.id ? 'active' : ''}`}
            onClick={() => setScreen(item.id)}
          >
            <item.icon />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

// ── Icons ────────────────────────────────────────────
function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  )
}

function RedditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5.8 11.33c.02.16.03.33.03.5 0 2.55-2.97 4.63-6.63 4.63s-6.63-2.07-6.63-4.63c0-.17.01-.34.03-.5A1.45 1.45 0 013.2 12c0-.81.66-1.47 1.47-1.47.39 0 .74.15 1.01.41 1-.72 2.37-1.18 3.9-1.24l.66-3.12.04-.02 2.15.45c.13-.27.4-.46.72-.46a.82.82 0 01.82.82.82.82 0 01-.82.82.82.82 0 01-.73-.45l-1.93-.41-.59 2.79c1.5.07 2.85.53 3.83 1.24.27-.25.62-.41 1.01-.41.81 0 1.47.66 1.47 1.47 0 .56-.31 1.04-.76 1.29zM9.2 13.2a.97.97 0 00-.97.97c0 .54.44.97.97.97.54 0 .97-.44.97-.97a.97.97 0 00-.97-.97zm5.6 0a.97.97 0 00-.97.97c0 .54.44.97.97.97.54 0 .97-.44.97-.97a.97.97 0 00-.97-.97zm-4.17 3.21c-.09-.09-.09-.23 0-.32.09-.09.23-.09.32 0 .56.56 1.45.83 2.05.83s1.49-.27 2.05-.83c.09-.09.23-.09.32 0 .09.09.09.23 0 .32-.65.65-1.64.97-2.37.97s-1.72-.32-2.37-.97z" />
    </svg>
  )
}

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

export default App
export { userId }
