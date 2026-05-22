import { useState, useEffect, useMemo, useRef } from 'react'
import { api, userId } from '../App'
import Toggle from '../components/Toggle'
import TagInput from '../components/TagInput'
import Slider from '../components/Slider'

export default function LinkedInSettings({ userId: propUserId, settings, onSettingsUpdate }) {
  const li = settings?.linkedin || {}
  const uid = propUserId || userId

  const [keywords, setKeywords] = useState(li.keywords || [])
  const [commentsPerDay, setCommentsPerDay] = useState(li.comments_per_day || 5)
  const [likesPerDay] = useState(li.likes_per_day || 5)
  const [addRange, setAddRange] = useState(li.people_add_range || [1, 3])
  const [addByKeywords, setAddByKeywords] = useState(li.add_people_by_keywords || false)
  const [addKeywords, setAddKeywords] = useState(li.add_people_keywords || [])
  const [sessionTimes, setSessionTimes] = useState(li.session_times || ['09:00', '14:00', '19:00'])
  const [newTime, setNewTime] = useState('')
  const [dirty, setDirty] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [showSaved, setShowSaved] = useState(false)
  const saveTimerRef = useRef(null)
  const savedToastTimerRef = useRef(null)
    
  // Login form
  const [liAt, setLiAt] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [status, setStatus] = useState(li.connected || settings?.linkedin?.connected)
  const [authUrl, setAuthUrl] = useState('')
  const [authState, setAuthState] = useState('idle')
  const [proxyInUse, setProxyInUse] = useState(li.proxy_url || '')
  const authPollRef = useRef(null)
  const authPollTimeoutRef = useRef(null)

  const save = () => {
    onSettingsUpdate({
      linkedin: {
        ...li,
        connected: status,
        keywords,
        comments_per_day: commentsPerDay,
        people_add_range: addRange,
        add_people_by_keywords: addByKeywords,
        add_people_keywords: addKeywords,
        session_times: sessionTimes,
      },
    })
    setDirty(false)
  }

  const markDirty = () => setDirty(true)

  const handleConnect = async () => {
    setConnecting(true)
    setLoginError('')
    try {
      const res = await api.get(`/api/linkedin/auth/${uid}`)
      setAuthUrl(res.url)
      setProxyInUse(res.proxy || '')
      setAuthState('waiting')
      window.open(res.url, '_blank', 'noopener,noreferrer')
      
      // Poll status every 2 sec until connected
      authPollRef.current = setInterval(async () => {
        try {
          const st = await api.get(`/api/linkedin/check/${uid}`)
          if (st.connected) {
            clearInterval(authPollRef.current)
            setStatus(true)
            setAuthUrl('')
            setAuthState('success')
            setConnecting(false)
            const refreshed = await api.get(`/api/linkedin/status/${uid}`)
            setStatus(!!refreshed.connected)
            onSettingsUpdate({ linkedin: { ...li, connected: !!refreshed.connected } })
          }
        } catch {}
      }, 2000)
  
      // Stop after 2 minutes if not connected
      authPollTimeoutRef.current = setTimeout(() => {
        clearInterval(authPollRef.current)
        setConnecting(false)
        setAuthState('timeout')
      }, 120000)
  
    } catch (e) {
      setLoginError(e.message || 'Failed to start OAuth')
      setConnecting(false)
    }
  }
  const handleCookieConnect = async () => {
    if (!liAt) { setLoginError('Enter li_at cookie'); return }
    setConnecting(true); setLoginError('')
    try {
      const res = await api.post('/api/linkedin/cookie', { user_id: uid, li_at: liAt })
      if (res.connected) { setStatus(true); onSettingsUpdate({ linkedin: { ...li, connected: true } }) }
    } catch (e) { setLoginError('Cookie login failed') }
    setConnecting(false)
  }

  useEffect(() => {
    setStatus(!!(settings?.linkedin?.connected))
  }, [settings])

  useEffect(() => {
    // Sync connection after OAuth callback return (app may be reopened with stale local state).
    const params = new URLSearchParams(window.location.search)
    const fromLinkedInCallback = params.get('linkedin') === 'connected'
    const syncStatus = async () => {
      try {
        if (fromLinkedInCallback) {
          setAuthState('waiting')
          setAuthUrl('callback')
        }
        const st = await api.get(`/api/linkedin/status/${uid}`)
        if (st.connected) {
          setStatus(true)
          setAuthState('success')
          setAuthUrl('')
          onSettingsUpdate({ linkedin: { ...li, connected: true } })
        } else if (fromLinkedInCallback) {
          setAuthState('timeout')
        }
      } catch {
        if (fromLinkedInCallback) setAuthState('timeout')
      }
    }
    syncStatus()
  }, [uid])

  useEffect(() => () => {
    if (authPollRef.current) clearInterval(authPollRef.current)
    if (authPollTimeoutRef.current) clearTimeout(authPollTimeoutRef.current)
  }, [])

  useEffect(() => {
    const loadProfile = async () => {
      if (!status) {
        setProfile(null)
        return
      }
      setProfileLoading(true)
      try {
        const data = await api.get(`/api/linkedin/profile/${uid}`)
        setProfile(data?.connected ? data : null)
      } catch {
        setProfile(null)
      } finally {
        setProfileLoading(false)
      }
    }
    loadProfile()
  }, [status, uid])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await api.post(`/api/linkedin/disconnect/${uid}`)
      setProfile(null)
      onSettingsUpdate({
        linkedin: {
          ...li,
          connected: false,
        },
      })
    } catch (e) {}
    setDisconnecting(false)
  }

  const addSessionTime = () => {
    if (newTime && sessionTimes.length < 3 && !sessionTimes.includes(newTime)) {
      setSessionTimes([...sessionTimes, newTime].sort())
      setNewTime('')
    }
  }

  const removeSessionTime = (time) => {
    setSessionTimes(sessionTimes.filter(t => t !== time))
  }

  const derivedKeywords = useMemo(() => {
    const source = `${profile?.headline || ''} ${profile?.industry || ''}`.toLowerCase()
    if (!source.trim()) return []
    const map = ['startup', 'developer', 'engineering', 'product', 'tech', 'marketing', 'sales', 'founder', 'ai', 'saas']
    const out = map.filter((k) => source.includes(k)).slice(0, 5)
    if (!out.length && source.includes('full stack')) return ['startup', 'developer', 'engineering', 'product', 'tech']
    return out
  }, [profile])

  useEffect(() => {
    if (!settings) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      setSaveState('saving')
      try {
        await onSettingsUpdate({
          linkedin: {
            ...li,
            connected: status,
            keywords,
            comments_per_day: commentsPerDay,
            people_add_range: addRange,
            add_people_by_keywords: addByKeywords,
            add_people_keywords: addKeywords,
            session_times: sessionTimes,
          },
        })
        setSaveState('saved')
        setShowSaved(true)
        if (savedToastTimerRef.current) clearTimeout(savedToastTimerRef.current)
        savedToastTimerRef.current = setTimeout(() => setShowSaved(false), 2000)
      } catch (e) {
        setSaveState('idle')
      }
    }, 1000)
    return () => clearTimeout(saveTimerRef.current)
  }, [keywords, commentsPerDay, addRange, addByKeywords, addKeywords, sessionTimes])

  return (
    <div className="px-5 pt-6 animate-fade-in">
      {authUrl && (
        <div className="oauth-modal-backdrop">
          <div className="oauth-modal animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">LinkedIn authorization</p>
              <button className="text-sm" onClick={() => setAuthUrl('')}>✕</button>
            </div>
            <div className="oauth-hint">LinkedIn opened in browser. Complete login there, then return to this app.</div>
            {!!proxyInUse && <div className="oauth-status">Proxy in use: {proxyInUse}</div>}
            {authState === 'waiting' && <div className="oauth-status">Waiting for LinkedIn callback…</div>}
            {authState === 'success' && <div className="oauth-status">LinkedIn connected successfully.</div>}
            {authState === 'timeout' && <div className="oauth-status oauth-status-error">Still waiting. Finish login in the opened tab and retry if needed.</div>}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">LinkedIn</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Engagement settings</p>
        </div>
        {status ? (          <span className="text-xs px-2 py-1 rounded" style={{ background: '#e8f5e9', color: 'var(--color-success)' }}>
            ● Connected
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded" style={{ background: '#fff3e0', color: 'var(--color-warning)' }}>
            Not connected
          </span>
        )}
      </div>

      {/* Account Section */}
      <Section title="Account" subtitle={status ? 'Session active' : 'Connect your LinkedIn account'}>
        {status ? (
          <div className="card flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0077B5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                <rect x="2" y="9" width="4" height="12" />
                <circle cx="4" cy="4" r="2" />
              </svg>
              <div>
                <span className="text-sm font-medium">LinkedIn Connected</span>
                {profileLoading ? (
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading profile...</p>
                ) : profile ? (
                  <div className="mt-2 flex items-center gap-3">
                    {profile.picture_url ? (
                      <img src={profile.picture_url} alt={profile.name || "LinkedIn"} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#e3f2fd", color: "#0A66C2" }}>
                        {(profile.name || "LI").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-bold">{profile.name || "LinkedIn User"}</p>
                      <p className="text-xs" style={{ color: "var(--color-muted)" }}>{profile.headline || ""}</p>
                      <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>{profile.email || ""}</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <button
              className="text-xs px-3 py-1.5 rounded-lg mt-3"
              style={{ color: 'var(--color-danger)', background: '#fce4ec' }}
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="card">
            <p className="text-[11px] mb-4" style={{ color: 'var(--color-muted)' }}>
              We auto-select a working US proxy for LinkedIn auth and reuse it for next sessions.
            </p>
            <div className="flex items-start gap-3 mb-4">
              <span aria-hidden="true" style={{ color: '#0A66C2' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
              <div>
                <p className="font-medium text-sm mb-1">Secure login</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Your password is used once to create a session. Only cookies are saved.</p>
              </div>
            </div>
            {loginError && (
              <p className="text-xs mb-3" style={{ color: 'var(--color-danger)' }}>{loginError}</p>
            )}
            <button
              className="w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all"
              style={{
                background: connecting ? '#ccc' : '#0077B5',
                color: '#fff',
                border: 'none',
              }}
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? (
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
                  Connect via LinkedIn
                </>
              )}
            </button>
          </div>
        )}
      </Section>

      {/* Keywords */}
      <Section title="Keywords" subtitle="Posts matching these keywords will be targeted">
        <TagInput
          tags={keywords}
          onChange={(tags) => { setKeywords(tags) }}
          placeholder="Add keyword..."
        />
        {!!derivedKeywords.length && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {derivedKeywords.map((k) => (
              <button key={k} className="text-xs px-2 py-1 rounded-full border" onClick={() => !keywords.includes(k) && setKeywords([...keywords, k])}>
                + {k}
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* Comments per day */}
      <Section title="Comments per day" subtitle={`${commentsPerDay} comments`}>
        <Slider
          min={1}
          max={15}
          value={commentsPerDay}
          onChange={(v) => { setCommentsPerDay(v) }}
        />
      </Section>

      {/* Likes per day */}
      <Section title="Likes per day" subtitle="Fixed at 5 (maximum safe limit)">
        <div className="card text-center py-3">
          <span className="text-2xl font-bold">5</span>
          <span className="text-xs block" style={{ color: 'var(--color-muted)' }}>per day (fixed)</span>
        </div>
      </Section>

      {/* People to add */}
      <Section title="People to add per day" subtitle={`Random ${addRange[0]}–${addRange[1]} per day`}>
        <div className="flex gap-4 items-center">
          <div className="flex-1">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Min</label>
            <Slider min={1} max={5} value={addRange[0]} onChange={(v) => {
              const newRange = [v, Math.max(v, addRange[1])]
              setAddRange(newRange)
            }} />
          </div>
          <div className="flex-1">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Max</label>
            <Slider min={1} max={5} value={addRange[1]} onChange={(v) => {
              const newRange = [Math.min(addRange[0], v), v]
              setAddRange(newRange)
            }} />
          </div>
        </div>
      </Section>

      {/* Add people by keywords */}
      <Section title="Add people by keywords">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm">Enable keyword-based search</span>
          <Toggle
            value={addByKeywords}
            onChange={(v) => { setAddByKeywords(v) }}
          />
        </div>
        {addByKeywords && (
          <TagInput
            tags={addKeywords}
            onChange={(tags) => { setAddKeywords(tags) }}
            placeholder="Add search keyword..."
          />
        )}
      </Section>

      {/* Session times */}
      <Section title="Session times" subtitle={`${sessionTimes.length}/3 time slots (UTC)`}>
        <div className="space-y-2 mb-3">
          {sessionTimes.map(time => (
            <div key={time} className="card flex items-center justify-between py-3">
              <span className="text-sm font-medium">{time}</span>
              <button
                className="text-xs"
                style={{ color: 'var(--color-danger)' }}
                onClick={() => removeSessionTime(time)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {sessionTimes.length < 3 && (
          <div className="flex gap-2">
            <input
              type="time"
              className="flex-1 px-3 py-2 border rounded-lg text-sm outline-none"
              value={newTime}
              onChange={e => setNewTime(e.target.value)}
              style={{ borderColor: '#ddd' }}
            />
            <button className="btn btn-sm" onClick={addSessionTime}>Add</button>
          </div>
        )}
      </Section>

      {(saveState === 'saving' || showSaved || profileLoading) && (
        <div className="fixed top-4 right-4 bg-white border rounded-lg px-3 py-2 text-xs shadow">
          {profileLoading ? 'Loading profile...' : saveState === 'saving' ? 'Saving…' : 'Saved ✓'}
        </div>
      )}
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      {subtitle && <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>{subtitle}</p>}
      {children}
    </div>
  )
}
