import { useState } from 'react'
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
  const [redditForm, setRedditForm] = useState({
    client_id: '',
    client_secret: '',
    username: '',
    password: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLanguageSelect = async (lang) => {
    setLanguage(lang)
    try {
      await api.put(`/api/settings/${userId}`, { language: lang })
    } catch (e) {}
    setStep(1)
  }

  const handleRedditConnect = async () => {
    setLoading(true)
    setError('')
    try {
      await api.post('/api/onboarding/reddit', {
        user_id: userId,
        ...redditForm,
      })
      onComplete()
    } catch (e) {
      setError('Failed to connect Reddit. Check your credentials.')
    }
    setLoading(false)
  }

  const handleSkip = () => {
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

      {/* Step 2 — Reddit */}
      {step === 2 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">Connect Reddit</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
            Enter your Reddit API credentials
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-muted)' }}>
                Client ID
              </label>
              <input
                type="text"
                className="w-full px-3 py-2.5 border rounded-lg text-sm outline-none focus:border-black transition-colors"
                placeholder="Reddit app client ID"
                value={redditForm.client_id}
                onChange={e => setRedditForm(f => ({ ...f, client_id: e.target.value }))}
                style={{ borderColor: '#ddd' }}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-muted)' }}>
                Client Secret
              </label>
              <input
                type="password"
                className="w-full px-3 py-2.5 border rounded-lg text-sm outline-none focus:border-black transition-colors"
                placeholder="Reddit app client secret"
                value={redditForm.client_secret}
                onChange={e => setRedditForm(f => ({ ...f, client_secret: e.target.value }))}
                style={{ borderColor: '#ddd' }}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-muted)' }}>
                Username
              </label>
              <input
                type="text"
                className="w-full px-3 py-2.5 border rounded-lg text-sm outline-none focus:border-black transition-colors"
                placeholder="Reddit username"
                value={redditForm.username}
                onChange={e => setRedditForm(f => ({ ...f, username: e.target.value }))}
                style={{ borderColor: '#ddd' }}
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--color-muted)' }}>
                Password
              </label>
              <input
                type="password"
                className="w-full px-3 py-2.5 border rounded-lg text-sm outline-none focus:border-black transition-colors"
                placeholder="Reddit password"
                value={redditForm.password}
                onChange={e => setRedditForm(f => ({ ...f, password: e.target.value }))}
                style={{ borderColor: '#ddd' }}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs mt-3" style={{ color: 'var(--color-danger)' }}>{error}</p>
          )}

          <div className="flex gap-3 mt-6">
            <button
              className="btn flex-1"
              onClick={handleRedditConnect}
              disabled={loading}
            >
              {loading ? 'Connecting...' : 'Connect Reddit'}
            </button>
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
