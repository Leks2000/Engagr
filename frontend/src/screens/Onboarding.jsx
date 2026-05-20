import { useState, useEffect } from 'react'
import { api } from '../App'

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
]

export default function Onboarding({ userId, onComplete }) {
  const [step, setStep] = useState(0)
  const [language, setLanguage] = useState('en')

  // LinkedIn
  const [liEmail, setLiEmail] = useState('')
  const [liPassword, setLiPassword] = useState('')
  const [liLoading, setLiLoading] = useState(false)
  const [liConnected, setLiConnected] = useState(false)
  const [liError, setLiError] = useState('')

  // Reddit
  const [rdUsername, setRdUsername] = useState('')
  const [rdPassword, setRdPassword] = useState('')
  const [rdLoading, setRdLoading] = useState(false)
  const [rdConnected, setRdConnected] = useState(false)
  const [rdDisplayName, setRdDisplayName] = useState('')
  const [rdError, setRdError] = useState('')

  const handleLanguageSelect = async (lang) => {
    setLanguage(lang)
    try {
      await api.put(`/api/settings/${userId}`, { language: lang })
    } catch (e) {}
    setStep(1)
  }

  // ── LinkedIn Login ──
  const handleLinkedInLogin = async () => {
    if (!liEmail || !liPassword) {
      setLiError('Enter email and password')
      return
    }
    setLiLoading(true)
    setLiError('')
    try {
      const res = await api.post('/api/linkedin/login', {
        user_id: userId,
        email: liEmail,
        password: liPassword,
      })
      if (res.connected) {
        setLiConnected(true)
        setLiPassword('') // clear password from memory
      }
    } catch (e) {
      const msg = e.message || 'Login failed'
      // Try to extract error from API response
      try {
        const resp = await fetch('/api/linkedin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, email: liEmail, password: liPassword }),
        })
        const data = await resp.json()
        setLiError(data.error || msg)
      } catch {
        setLiError(msg)
      }
    }
    setLiLoading(false)
  }

  // ── Reddit Login ──
  const handleRedditLogin = async () => {
    if (!rdUsername || !rdPassword) {
      setRdError('Enter username and password')
      return
    }
    setRdLoading(true)
    setRdError('')
    try {
      const res = await api.post('/api/reddit/login', {
        user_id: userId,
        username: rdUsername,
        password: rdPassword,
      })
      if (res.connected) {
        setRdConnected(true)
        setRdDisplayName(res.username || rdUsername)
        setRdPassword('') // clear password from memory
      }
    } catch (e) {
      const msg = e.message || 'Login failed'
      try {
        const resp = await fetch('/api/reddit/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, username: rdUsername, password: rdPassword }),
        })
        const data = await resp.json()
        setRdError(data.error || msg)
      } catch {
        setRdError(msg)
      }
    }
    setRdLoading(false)
  }

  // ── Finish ──
  const handleFinish = async () => {
    try {
      await api.put(`/api/settings/${userId}`, { onboarding_completed: true })
    } catch (e) {}
    onComplete()
  }

  const handleSkip = async () => {
    try {
      await api.put(`/api/settings/${userId}`, { onboarding_completed: true })
    } catch (e) {}
    onComplete()
  }

  return (
    <div className="min-h-screen flex flex-col px-6 py-8">
      {/* Header */}
      <div className="text-center mb-8 animate-fade-in">
        <h1 className="text-3xl font-bold tracking-tight mb-1">Engagr</h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Automate your social engagement
        </p>
      </div>

      {/* Progress */}
      <div className="flex gap-2 mb-8 justify-center">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="h-1 rounded-full transition-all duration-300"
            style={{
              width: step === i ? 32 : 16,
              background: step >= i ? 'var(--color-text)' : '#ddd',
            }}
          />
        ))}
      </div>

      {/* ── Step 0 — Language ── */}
      {step === 0 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">Choose language</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
            UI language for the app
          </p>
          <div className="space-y-3">
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                className="w-full flex items-center gap-3 p-4 rounded-xl border transition-all hover:bg-gray-50"
                style={{
                  borderColor: language === lang.code ? 'var(--color-text)' : '#eee',
                  borderWidth: language === lang.code ? 2 : 1,
                }}
                onClick={() => handleLanguageSelect(lang.code)}
              >
                <span className="text-2xl">{lang.flag}</span>
                <span className="font-medium">{lang.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 1 — LinkedIn Login ── */}
      {step === 1 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">Connect LinkedIn</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
            We'll securely log in and save your session cookies
          </p>

          {liConnected ? (
            <div className="card text-center py-8 mb-4">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-sm mb-1">LinkedIn Connected!</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Session saved. Your credentials are not stored.
              </p>
            </div>
          ) : (
            <div className="space-y-3 mb-4">
              <div className="card">
                <div className="flex items-start gap-3 mb-4">
                  <span className="text-xl">🔒</span>
                  <div>
                    <p className="font-medium text-sm mb-1">Secure login</p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      Your password is used only once to log in. We save session cookies, not your credentials.
                    </p>
                  </div>
                </div>

                <input
                  type="email"
                  className="w-full px-4 py-3 border rounded-xl text-sm outline-none mb-3"
                  placeholder="LinkedIn email"
                  value={liEmail}
                  onChange={e => setLiEmail(e.target.value)}
                  style={{ borderColor: '#ddd' }}
                  autoComplete="email"
                />
                <input
                  type="password"
                  className="w-full px-4 py-3 border rounded-xl text-sm outline-none"
                  placeholder="Password"
                  value={liPassword}
                  onChange={e => setLiPassword(e.target.value)}
                  style={{ borderColor: '#ddd' }}
                  autoComplete="current-password"
                  onKeyDown={e => e.key === 'Enter' && handleLinkedInLogin()}
                />
              </div>
            </div>
          )}

          {liError && (
            <p className="text-xs mt-2 mb-2" style={{ color: 'var(--color-danger)' }}>{liError}</p>
          )}

          <div className="flex gap-3 mt-6">
            {liConnected ? (
              <button className="btn flex-1" onClick={() => setStep(2)}>
                Continue →
              </button>
            ) : (
              <button
                className="btn flex-1 flex items-center justify-center gap-2"
                onClick={handleLinkedInLogin}
                disabled={liLoading}
                style={{
                  background: liLoading ? '#ccc' : '#0077B5',
                  color: '#fff',
                  border: 'none',
                }}
              >
                {liLoading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Logging in...
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                      <rect x="2" y="9" width="4" height="12" />
                      <circle cx="4" cy="4" r="2" />
                    </svg>
                    Connect LinkedIn
                  </>
                )}
              </button>
            )}
          </div>
          <button
            className="w-full mt-3 text-sm py-2"
            style={{ color: 'var(--color-muted)' }}
            onClick={() => setStep(2)}
          >
            Skip for now
          </button>
        </div>
      )}

      {/* ── Step 2 — Reddit Login ── */}
      {step === 2 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">Connect Reddit</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
            Log in with your Reddit credentials
          </p>

          {rdConnected ? (
            <div className="card text-center py-8 mb-4">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-sm mb-1">Reddit Connected!</p>
              {rdDisplayName && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Logged in as <strong>u/{rdDisplayName}</strong>
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 mb-4">
              <div className="card">
                <div className="flex items-start gap-3 mb-4">
                  <span className="text-xl">🔒</span>
                  <div>
                    <p className="font-medium text-sm mb-1">Secure login</p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      Your password is used only once to create a session. We save cookies, not your credentials.
                    </p>
                  </div>
                </div>

                <input
                  type="text"
                  className="w-full px-4 py-3 border rounded-xl text-sm outline-none mb-3"
                  placeholder="Reddit username"
                  value={rdUsername}
                  onChange={e => setRdUsername(e.target.value)}
                  style={{ borderColor: '#ddd' }}
                  autoComplete="username"
                />
                <input
                  type="password"
                  className="w-full px-4 py-3 border rounded-xl text-sm outline-none"
                  placeholder="Password"
                  value={rdPassword}
                  onChange={e => setRdPassword(e.target.value)}
                  style={{ borderColor: '#ddd' }}
                  autoComplete="current-password"
                  onKeyDown={e => e.key === 'Enter' && handleRedditLogin()}
                />
              </div>
            </div>
          )}

          {rdError && (
            <p className="text-xs mt-2 mb-2" style={{ color: 'var(--color-danger)' }}>{rdError}</p>
          )}

          <div className="flex gap-3 mt-6">
            {rdConnected ? (
              <button className="btn flex-1" onClick={handleFinish}>
                Get Started 🚀
              </button>
            ) : (
              <button
                className="btn flex-1 flex items-center justify-center gap-2"
                onClick={handleRedditLogin}
                disabled={rdLoading}
                style={{
                  background: rdLoading ? '#ccc' : '#FF4500',
                  color: '#fff',
                  border: 'none',
                }}
              >
                {rdLoading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Logging in...
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5.8 11.33c.02.16.03.33.03.5 0 2.55-2.97 4.63-6.63 4.63s-6.63-2.07-6.63-4.63c0-.17.01-.34.03-.5A1.45 1.45 0 013.2 12c0-.81.66-1.47 1.47-1.47.39 0 .74.15 1.01.41 1-.72 2.37-1.18 3.9-1.24l.66-3.12.04-.02 2.15.45c.13-.27.4-.46.72-.46a.82.82 0 01.82.82.82.82 0 01-.82.82.82.82 0 01-.73-.45l-1.93-.41-.59 2.79c1.5.07 2.85.53 3.83 1.24.27-.25.62-.41 1.01-.41.81 0 1.47.66 1.47 1.47 0 .56-.31 1.04-.76 1.29z" />
                    </svg>
                    Connect Reddit
                  </>
                )}
              </button>
            )}
          </div>
          <button
            className="w-full mt-3 text-sm py-2"
            style={{ color: 'var(--color-muted)' }}
            onClick={handleSkip}
          >
            {rdConnected ? 'Continue' : 'Skip for now'}
          </button>
        </div>
      )}
    </div>
  )
}
