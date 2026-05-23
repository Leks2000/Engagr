import { useState, useEffect } from 'react'
import { api } from '../App'

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
]

export default function Onboarding({ userId, onComplete, onOpenReddit, detectedLanguage = 'en' }) {
  const [step, setStep] = useState(0)
  const [language, setLanguage] = useState(detectedLanguage || 'en')
  const [languageConfirmed, setLanguageConfirmed] = useState(false)
  const [authUrl, setAuthUrl] = useState('')
  const [authState, setAuthState] = useState('idle')
  const [proxyInUse, setProxyInUse] = useState('')

  const [liLoading, setLiLoading] = useState(false)
  const [liConnected, setLiConnected] = useState(false)
  const [liError, setLiError] = useState('')

  const [rdLoading, setRdLoading] = useState(false)
  const [rdConnected, setRdConnected] = useState(false)
  const [rdError, setRdError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('linkedin') === 'connected') {
      setLiConnected(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    const checkConnections = async () => {
      try {
        const data = await api.get(`/api/settings/${userId}`)
        const lang = data?.language || detectedLanguage || 'en'
        setLanguage(lang)
        setLanguageConfirmed(!!data?.language || !!detectedLanguage)
        const linkedinConnected = !!data?.linkedin?.connected
        const redditConnected = !!data?.reddit?.connected
        setLiConnected(linkedinConnected)
        setRdConnected(redditConnected)
        setStep(0)
      } catch (e) {
        // Pre-select detected language even if API fails
        if (detectedLanguage) {
          setLanguage(detectedLanguage)
          setLanguageConfirmed(true)
        }
      }
    }
    checkConnections()
  }, [userId, detectedLanguage])

  const handleLanguageSelect = async (lang) => {
    setLanguage(lang)
    try {
      await api.put(`/api/settings/${userId}`, { language: lang })
      setLanguageConfirmed(true)
    } catch (e) {
      setLanguageConfirmed(true) // Mark confirmed locally even if API fails
    }
  }

  const handleLanguageContinue = () => {
    if (!language) return
    setStep(1)
  }

  // ── LinkedIn OAuth ──
  const handleLinkedInLogin = async () => {
    setLiLoading(true)
    setLiError('')
    try {
      const res = await api.get(`/api/linkedin/auth/${userId}`)
      setAuthUrl(res.url)
      setProxyInUse(res.proxy || '')
      setAuthState('waiting')
      window.open(res.url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setLiError(e.message || 'Failed to start LinkedIn OAuth')
    }
    setLiLoading(false)
  }

  // ── Reddit ──
  const handleRedditLogin = async () => {
    setRdLoading(true)
    setRdError('')
    try {
      await api.put(`/api/settings/${userId}`, { onboarding_completed: true })
      onOpenReddit?.()
    } catch (e) {
      setRdError(e.message || 'Failed to open Reddit settings')
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

  const canFinishNow = liConnected && rdConnected

  useEffect(() => {
    if (!authUrl) return
    const poll = setInterval(async () => {
      try {
        const st = await api.get(`/api/linkedin/check/${userId}`)
        if (st.connected) {
          setLiConnected(true)
          setAuthUrl('')
          setAuthState('success')
          setStep(2)
        }
      } catch {}
    }, 2000)
    return () => clearInterval(poll)
  }, [authUrl, userId])

  const langLabels = {
    en: { chooseTitle: 'Choose language', chooseSubtitle: 'App UI language', continue: 'Continue →', skip: 'Skip for now', connect: 'Connect via LinkedIn', getStarted: 'Get Started 🚀' },
    ru: { chooseTitle: 'Выберите язык', chooseSubtitle: 'Язык интерфейса', continue: 'Продолжить →', skip: 'Пропустить', connect: 'Подключить LinkedIn', getStarted: 'Начать 🚀' },
    es: { chooseTitle: 'Elige idioma', chooseSubtitle: 'Idioma de la interfaz', continue: 'Continuar →', skip: 'Saltar', connect: 'Conectar LinkedIn', getStarted: '¡Empezar 🚀' },
    de: { chooseTitle: 'Sprache wählen', chooseSubtitle: 'App-Sprache', continue: 'Weiter →', skip: 'Überspringen', connect: 'LinkedIn verbinden', getStarted: 'Loslegen 🚀' },
  }
  const L = langLabels[language] || langLabels.en

  return (
    <div className="min-h-screen flex flex-col px-6 py-8" style={{ background: '#f8fafc' }}>
      {authUrl && (
        <div className="oauth-modal-backdrop">
          <div className="oauth-modal animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">LinkedIn authorization</p>
              <button className="text-sm" onClick={() => setAuthUrl('')}>✕</button>
            </div>
            <div className="oauth-hint">LinkedIn opened in browser. Complete login there, then return to this app.</div>
            {!!proxyInUse && <div className="oauth-status">Proxy in use: {proxyInUse}</div>}
            {authState === 'waiting' && <div className="oauth-status">⏳ Waiting for LinkedIn callback…</div>}
            {authState === 'success' && <div className="oauth-status">✅ LinkedIn connected successfully.</div>}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="text-center mb-8 animate-fade-in">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0A66C2, #FF4500)' }}>
          <span className="text-2xl font-bold text-white">E</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-1">Engagr</h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Automate your social engagement</p>
      </div>

      {/* Progress */}
      <div className="flex gap-2 mb-8 justify-center">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: step === i ? 40 : 16,
              background: step >= i ? '#0A66C2' : '#e2e8f0',
            }}
          />
        ))}
      </div>

      {/* ── Step 0 — Language ── */}
      {step === 0 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">{L.chooseTitle}</h2>
          {detectedLanguage && (
            <div className="flex items-center gap-1 mb-3 text-xs px-2 py-1 rounded-lg w-fit" style={{ background: '#eff6ff', color: '#0A66C2', border: '1px solid #bfdbfe' }}>
              🤖 Auto-detected: {LANGUAGES.find(l => l.code === detectedLanguage)?.label || detectedLanguage}
            </div>
          )}
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>{L.chooseSubtitle}</p>
          <div className="space-y-3">
            {LANGUAGES.map(lang => (
              <button
                key={lang.code}
                className="w-full flex items-center gap-3 p-4 rounded-xl border transition-all hover:bg-gray-50"
                style={{
                  borderColor: language === lang.code ? '#0A66C2' : '#e5e7eb',
                  borderWidth: language === lang.code ? 2 : 1,
                  background: language === lang.code ? '#eff6ff' : '#fff',
                }}
                onClick={() => handleLanguageSelect(lang.code)}
              >
                <span className="text-2xl">{lang.flag}</span>
                <span className="font-medium flex-1 text-left">{lang.label}</span>
                {language === lang.code && (
                  <span style={{ color: '#0A66C2' }}>✓</span>
                )}
              </button>
            ))}
          </div>
          <button
            className="btn w-full mt-6"
            onClick={handleLanguageContinue}
            style={{
              background: language ? '#0A66C2' : '#e2e8f0',
              color: language ? '#fff' : '#94a3b8',
              border: 'none',
              cursor: language ? 'pointer' : 'not-allowed',
            }}
            disabled={!language}
          >
            {L.continue}
          </button>
        </div>
      )}

      {/* ── Step 1 — LinkedIn Login ── */}
      {step === 1 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">Connect LinkedIn</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>Connect your LinkedIn account to start commenting</p>

          {liConnected ? (
            <div className="card text-center py-8 mb-4" style={{ border: '2px solid #a7f3d0' }}>
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-sm mb-1">LinkedIn Connected!</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Session saved. Your credentials are not stored.
              </p>
            </div>
          ) : (
            <div className="card mb-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#eff6ff' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0A66C2" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
                    <rect x="2" y="9" width="4" height="12"/>
                    <circle cx="4" cy="4" r="2"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold">LinkedIn OAuth</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Secure — password never stored</p>
                </div>
              </div>
              {liError && (
                <p className="text-xs mb-3 p-2 rounded-lg" style={{ color: 'var(--color-danger)', background: '#fef2f2', border: '1px solid #fecaca' }}>{liError}</p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {liConnected ? (
              <button className="btn flex-1" style={{ background: '#0A66C2', color: '#fff', border: 'none' }} onClick={() => setStep(2)}>
                {L.continue}
              </button>
            ) : (
              <button
                className="btn flex-1 flex items-center justify-center gap-2"
                onClick={handleLinkedInLogin}
                disabled={liLoading}
                style={{ background: liLoading ? '#ccc' : '#0077B5', color: '#fff', border: 'none' }}
              >
                {liLoading ? (
                  <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Logging in...</>
                ) : (
                  <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>{L.connect}</>
                )}
              </button>
            )}
          </div>
          <button className="w-full mt-3 text-sm py-2" style={{ color: 'var(--color-muted)' }} onClick={() => setStep(2)}>
            {L.skip}
          </button>
        </div>
      )}

      {/* ── Step 2 — Reddit Login ── */}
      {step === 2 && (
        <div className="flex-1 animate-slide-up">
          <h2 className="text-lg font-semibold mb-1">Connect Reddit</h2>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>Connect your Reddit account from settings</p>

          {rdConnected ? (
            <div className="card text-center py-8 mb-4" style={{ border: '2px solid #a7f3d0' }}>
              <div className="text-4xl mb-3">✅</div>
              <p className="font-semibold text-sm mb-1">Reddit Connected!</p>
            </div>
          ) : (
            <div className="card mb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#fff5f2' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="#FF4500">
                    <circle cx="12" cy="12" r="10" fill="#FF4500"/>
                    <path fill="white" d="M20 11.4c0-.7-.6-1.3-1.3-1.3-.3 0-.6.1-.9.3-1-.7-2.3-1.1-3.7-1.2l.6-3 2.2.5c0 .5.4.9.9.9s.9-.4.9-.9-.4-.9-.9-.9c-.4 0-.7.2-.8.6l-2.4-.5c-.1 0-.2.1-.2.2l-.7 3.1c-1.4.1-2.7.5-3.7 1.2-.2-.2-.5-.3-.9-.3-.7 0-1.3.6-1.3 1.3 0 .5.3.9.7 1.2v.3c0 2.2 2.6 4 5.8 4s5.8-1.8 5.8-4v-.3c.4-.2.6-.7.6-1.2zm-9.4 1.9c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9zm4.7 2.5c-.6.6-1.6.9-2.7.9-1.1 0-2.1-.3-2.7-.9-.1-.1-.1-.3 0-.4.1-.1.3-.1.4 0 .5.5 1.3.7 2.3.7s1.8-.2 2.3-.7c.1-.1.3-.1.4 0 .1.1.1.3 0 .4zm-.3-1.6c-.5 0-.9-.4-.9-.9s.4-.9.9-.9.9.4.9.9-.4.9-.9.9z"/>
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold">Reddit</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Configure in Reddit settings</p>
                </div>
              </div>
            </div>
          )}

          {rdError && (
            <p className="text-xs mt-2 mb-2 p-2 rounded-lg" style={{ color: 'var(--color-danger)', background: '#fef2f2', border: '1px solid #fecaca' }}>{rdError}</p>
          )}

          <div className="flex gap-3 mt-4">
            {canFinishNow ? (
              <button className="btn flex-1" style={{ background: '#0A66C2', color: '#fff', border: 'none' }} onClick={handleFinish}>
                {L.getStarted}
              </button>
            ) : (
              <button
                className="btn flex-1 flex items-center justify-center gap-2"
                onClick={handleRedditLogin}
                disabled={rdLoading}
                style={{ background: rdLoading ? '#ccc' : '#FF4500', color: '#fff', border: 'none' }}
              >
                {rdLoading ? (
                  <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Opening...</>
                ) : (
                  <>Open Reddit Settings</>
                )}
              </button>
            )}
          </div>
          <button className="w-full mt-3 text-sm py-2" style={{ color: 'var(--color-muted)' }} onClick={handleSkip}>
            {canFinishNow ? L.continue : L.skip}
          </button>
        </div>
      )}
    </div>
  )
}
