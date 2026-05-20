import { useState, useEffect, useRef } from 'react'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [redditConnected, setRedditConnected] = useState(false)
  const [redditUsername, setRedditUsername] = useState('')
  const pollRef = useRef(null)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleLanguageSelect = async (lang) => {
    setLanguage(lang)
    try {
      await api.put(`/api/settings/${userId}`, { language: lang })
    } catch (e) {}
    setStep(1)
  }

  const handleRedditOAuth = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.post('/api/reddit/auth-url', { user_id: userId })
      const authUrl = data.url

      // Open Reddit OAuth in a new window
      const popup = window.open(authUrl, 'reddit_oauth', 'width=600,height=700')

      // Poll for connection status
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.get(`/api/reddit/status/${userId}`)
          if (status.connected) {
            clearInterval(pollRef.current)
            pollRef.current = null
            setRedditConnected(true)
            setRedditUsername(status.username || '')
            setLoading(false)
            if (popup && !popup.closed) popup.close()
          }
        } catch (e) {}
      }, 2000)

      // Also stop polling after 5 minutes
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
          setLoading(false)
        }
      }, 300000)

    } catch (e) {
      setError('Failed to start Reddit OAuth. Server may not be configured.')
      setLoading(false)
    }
  }

  const handleSkip = () => {
    onComplete()
  }

  const handleFinish = () => {
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

      {/* Step 0 — Language */}
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

      {/* Step 1 — LinkedIn */}
      {step === 1 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">Connect LinkedIn</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
            LinkedIn uses browser cookies for authentication
          </p>

          <div className="card mb-4">
            <div className="flex items-start gap-3">
              <span className="text-xl">💻</span>
              <div>
                <p className="font-medium text-sm mb-1">Run on your server:</p>
                <code className="text-xs px-2 py-1 rounded" style={{ background: '#f0f0f0' }}>
                  python backend/setup.py
                </code>
                <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
                  Opens a browser window to log in to LinkedIn. Cookies are saved for automated sessions.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-8">
            <button className="btn flex-1" onClick={() => setStep(2)}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Reddit OAuth */}
      {step === 2 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">Connect Reddit</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
            Log in to your Reddit account via OAuth
          </p>

          {redditConnected ? (
            <div className="card text-center py-8 mb-4">
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-sm mb-1">Reddit Connected!</p>
              {redditUsername && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Logged in as <strong>u/{redditUsername}</strong>
                </p>
              )}
            </div>
          ) : (
            <div className="card mb-4">
              <div className="flex items-start gap-3">
                <span className="text-xl">🤖</span>
                <div>
                  <p className="font-medium text-sm mb-1">One-click connection</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Click below to authorize Engagr with your Reddit account. 
                    No credentials are stored — we use secure OAuth tokens.
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs mt-3" style={{ color: 'var(--color-danger)' }}>{error}</p>
          )}

          <div className="flex gap-3 mt-6">
            {redditConnected ? (
              <button
                className="btn flex-1"
                onClick={handleFinish}
              >
                Get Started 🚀
              </button>
            ) : (
              <button
                className="btn flex-1"
                onClick={handleRedditOAuth}
                disabled={loading}
                style={{
                  background: loading ? '#ccc' : '#FF4500',
                  color: '#fff',
                  border: 'none',
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Waiting for authorization...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5.8 11.33c.02.16.03.33.03.5 0 2.55-2.97 4.63-6.63 4.63s-6.63-2.07-6.63-4.63c0-.17.01-.34.03-.5A1.45 1.45 0 013.2 12c0-.81.66-1.47 1.47-1.47.39 0 .74.15 1.01.41 1-.72 2.37-1.18 3.9-1.24l.66-3.12.04-.02 2.15.45c.13-.27.4-.46.72-.46a.82.82 0 01.82.82.82.82 0 01-.82.82.82.82 0 01-.73-.45l-1.93-.41-.59 2.79c1.5.07 2.85.53 3.83 1.24.27-.25.62-.41 1.01-.41.81 0 1.47.66 1.47 1.47 0 .56-.31 1.04-.76 1.29z" />
                    </svg>
                    Connect via Reddit
                  </span>
                )}
              </button>
            )}
          </div>
          <button
            className="w-full mt-3 text-sm py-2"
            style={{ color: 'var(--color-muted)' }}
            onClick={handleSkip}
          >
            Skip for now
          </button>
        </div>
      )}
    </div>
  )
}
