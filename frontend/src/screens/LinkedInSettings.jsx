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
  const [dailyHardLimit, setDailyHardLimit] = useState(li.daily_comment_hard_limit || 10)
  const [tone, setTone] = useState(li.tone || 'friendly')
  const [jitterRange, setJitterRange] = useState(li.session_jitter_minutes || [3, 17])
  const [addRange, setAddRange] = useState(li.people_add_range || [1, 3])
  const [addByKeywords, setAddByKeywords] = useState(li.add_people_by_keywords || false)
  const [addKeywords, setAddKeywords] = useState(li.add_people_keywords || [])
  const [sessionTimes, setSessionTimes] = useState(li.session_times || ['09:00', '14:00', '19:00'])
  const [newTime, setNewTime] = useState('')
  const [ctaTemplates, setCtaTemplates] = useState(li.cta_templates || [])
  const [newCta, setNewCta] = useState('')

  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [showSaved, setShowSaved] = useState(false)
  const saveTimerRef = useRef(null)
  const savedToastTimerRef = useRef(null)

  // Proxy health
  const [proxyHealth, setProxyHealth] = useState(null)

  // Login form
  const [liAt, setLiAt] = useState('')
  const [showCookieForm, setShowCookieForm] = useState(false)
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
        daily_comment_hard_limit: dailyHardLimit,
        tone,
        session_jitter_minutes: jitterRange,
        people_add_range: addRange,
        add_people_by_keywords: addByKeywords,
        add_people_keywords: addKeywords,
        session_times: sessionTimes,
        cta_templates: ctaTemplates,
      },
    })
  }

  const handleConnect = async () => {
    setConnecting(true)
    setLoginError('')
    try {
      const res = await api.get(`/api/linkedin/auth/${uid}`)
      setAuthUrl(res.url)
      setProxyInUse(res.proxy || '')
      setAuthState('waiting')
      window.open(res.url, '_blank', 'noopener,noreferrer')

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
    if (!liAt.trim()) { setLoginError('Please enter your li_at cookie value'); return }
    setConnecting(true); setLoginError('')
    try {
      const res = await api.post('/api/linkedin/cookie', { user_id: uid, li_at: liAt.trim() })
      if (res.connected) {
        setStatus(true)
        setShowCookieForm(false)
        setLiAt('')
        onSettingsUpdate({ linkedin: { ...li, connected: true } })
      } else {
        setLoginError('Cookie is invalid or expired. Please get a fresh li_at from linkedin.com')
      }
    } catch (e) {
      setLoginError('Cookie login failed. Make sure the cookie is valid.')
    }
    setConnecting(false)
  }

  useEffect(() => {
    setStatus(!!(settings?.linkedin?.connected))
  }, [settings])

  useEffect(() => {
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

  // Load proxy health when connected
  useEffect(() => {
    if (!status) { setProxyHealth(null); return }
    const loadProxyHealth = async () => {
      try {
        const data = await api.get(`/api/linkedin/proxy-health/${uid}`)
        setProxyHealth(data)
      } catch {
        setProxyHealth(null)
      }
    }
    loadProxyHealth()
    const interval = setInterval(loadProxyHealth, 30000)
    return () => clearInterval(interval)
  }, [status, uid])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await api.post(`/api/linkedin/disconnect/${uid}`)
      setProfile(null)
      setProxyHealth(null)
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

  const addCtaTemplate = () => {
    if (newCta.trim() && ctaTemplates.length < 5) {
      setCtaTemplates([...ctaTemplates, newCta.trim()])
      setNewCta('')
    }
  }

  const removeCtaTemplate = (idx) => {
    setCtaTemplates(ctaTemplates.filter((_, i) => i !== idx))
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
            daily_comment_hard_limit: dailyHardLimit,
            tone,
            session_jitter_minutes: jitterRange,
            people_add_range: addRange,
            add_people_by_keywords: addByKeywords,
            add_people_keywords: addKeywords,
            session_times: sessionTimes,
            cta_templates: ctaTemplates,
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
  }, [keywords, commentsPerDay, dailyHardLimit, tone, jitterRange, addRange, addByKeywords, addKeywords, sessionTimes, ctaTemplates])

  return (
    <div className="px-5 pt-6 animate-fade-in">
      {authUrl && authUrl !== 'callback' && (
        <div className="oauth-modal-backdrop">
          <div className="oauth-modal animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold">LinkedIn authorization</p>
              <button className="text-sm" onClick={() => { setAuthUrl(''); setConnecting(false); }}>✕</button>
            </div>
            <div className="oauth-hint">LinkedIn opened in browser. Complete login there, then return to this app.</div>
            {!!proxyInUse && <div className="oauth-status">Proxy in use: {proxyInUse}</div>}
            {authState === 'waiting' && <div className="oauth-status">Waiting for LinkedIn callback…</div>}
            {authState === 'success' && <div className="oauth-status">✅ LinkedIn connected successfully.</div>}
            {authState === 'timeout' && <div className="oauth-status oauth-status-error">Still waiting. Finish login in the opened tab and retry if needed.</div>}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">LinkedIn</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Engagement settings</p>
        </div>
        {status ? (
          <span className="text-xs px-2 py-1 rounded" style={{ background: '#e8f5e9', color: 'var(--color-success)' }}>
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
          <div className="card py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0077B5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                  <rect x="2" y="9" width="4" height="12" />
                  <circle cx="4" cy="4" r="2" />
                </svg>
                <div>
                  <span className="text-sm font-medium">LinkedIn Connected</span>
                  {/* Proxy Health Widget */}
                  {proxyHealth?.ok ? (
                    <p className="text-[11px] mt-0.5" style={{ color: proxyHealth.trust_score >= 80 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                      🛡️ Proxy: {proxyHealth.latency_ms}ms · Trust {proxyHealth.trust_score}% ({proxyHealth.status})
                    </p>
                  ) : proxyHealth && !proxyHealth.ok ? (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-danger)' }}>
                      ⚠️ Proxy issue: {proxyHealth.message || 'check connection'}
                    </p>
                  ) : (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      Checking proxy health…
                    </p>
                  )}
                </div>
              </div>
              <button
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ color: 'var(--color-danger)', background: '#fce4ec' }}
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
            {/* Profile card */}
            {profileLoading ? (
              <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>Loading profile...</p>
            ) : profile ? (
              <div className="mt-3 flex items-center gap-3 p-3 rounded-xl" style={{ background: '#f0f7ff', border: '1px solid #bfdbfe' }}>
                {profile.picture_url ? (
                  <img src={profile.picture_url} alt={profile.name || 'LinkedIn'} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: '#0A66C2', color: 'white' }}>
                    {(profile.name || 'LI').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-bold">{profile.name || 'LinkedIn User'}</p>
                  {profile.headline && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{profile.headline}</p>}
                  {profile.email && <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{profile.email}</p>}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="card">
            <p className="text-[11px] mb-4" style={{ color: 'var(--color-muted)' }}>
              Two ways to connect: OAuth (recommended) or paste your <code className="bg-gray-100 px-1 rounded">li_at</code> session cookie.
            </p>

            {loginError && (
              <div className="mb-3 p-2 rounded-lg text-xs" style={{ background: '#fef2f2', color: 'var(--color-danger)', border: '1px solid #fecaca' }}>
                {loginError}
              </div>
            )}

            {/* OAuth Button */}
            <button
              className="w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all mb-3"
              style={{ background: connecting && !showCookieForm ? '#ccc' : '#0077B5', color: '#fff', border: 'none' }}
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting && !showCookieForm ? (
                <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Connecting…</>
              ) : (
                <><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>Connect via OAuth</>
              )}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-2 my-3">
              <div className="flex-1 h-px" style={{ background: '#e5e7eb' }} />
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>or use cookie</span>
              <div className="flex-1 h-px" style={{ background: '#e5e7eb' }} />
            </div>

            {/* Cookie toggle */}
            {!showCookieForm ? (
              <button
                className="w-full py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all"
                style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }}
                onClick={() => setShowCookieForm(true)}
              >
                🍪 Paste li_at cookie
              </button>
            ) : (
              <div className="animate-fade-in">
                <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>
                  Open linkedin.com → DevTools → Application → Cookies → copy value of <code className="bg-gray-100 px-1 rounded">li_at</code>
                </p>
                <textarea
                  className="w-full px-3 py-2 border rounded-xl text-xs outline-none resize-none mb-2"
                  style={{ borderColor: '#e2e8f0', minHeight: 60, fontFamily: 'monospace' }}
                  placeholder="AQEDARx... (your li_at cookie value)"
                  value={liAt}
                  onChange={e => setLiAt(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2.5 rounded-xl font-medium text-sm transition-all"
                    style={{ background: connecting ? '#ccc' : '#0A66C2', color: '#fff', border: 'none' }}
                    onClick={handleCookieConnect}
                    disabled={connecting}
                  >
                    {connecting ? 'Verifying…' : '✓ Connect'}
                  </button>
                  <button
                    className="px-4 py-2.5 rounded-xl font-medium text-sm"
                    style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' }}
                    onClick={() => { setShowCookieForm(false); setLiAt(''); setLoginError('') }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
        <Slider min={1} max={15} value={commentsPerDay} onChange={(v) => { setCommentsPerDay(v) }} />
      </Section>

      <Section title="Hard daily cap" subtitle={`Never more than ${dailyHardLimit} comments/day`}>
        <Slider min={1} max={15} value={dailyHardLimit} onChange={(v) => setDailyHardLimit(v)} />
      </Section>

      {/* Comment Tone */}
      <Section title="Comment tone" subtitle="Persona & tone for AI-generated comments">
        <div className="grid grid-cols-1 gap-2">
          {[
            ['intellectual', '🎓 Интеллектуальный'],
            ['friendly', '😊 Дружелюбный'],
            ['provocative', '🔥 Провокационный (хайп)'],
            ['concise', '✂️ Краткий'],
            ['expert', '⭐ Экспертный'],
          ].map(([value, label]) => (
            <button
              key={value}
              className="text-left px-4 py-3 rounded-xl border text-sm font-medium transition-all"
              onClick={() => setTone(value)}
              style={tone === value
                ? { borderColor: '#0A66C2', color: '#0A66C2', background: '#eff6ff', fontWeight: 600 }
                : { borderColor: '#e5e7eb', color: '#475569', background: '#fff' }}
            >
              {label}
            </button>
          ))}
        </div>
      </Section>

      {/* CTA Templates */}
      <Section title="CTA Templates" subtitle="AI weaves these into every ~10th comment organically">
        <div className="space-y-2 mb-3">
          {ctaTemplates.map((cta, idx) => (
            <div key={idx} className="flex items-start gap-2 p-3 rounded-xl" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <span className="text-xs flex-1" style={{ color: '#475569' }}>{cta}</span>
              <button className="text-xs flex-shrink-0" style={{ color: 'var(--color-danger)' }} onClick={() => removeCtaTemplate(idx)}>✕</button>
            </div>
          ))}
        </div>
        {ctaTemplates.length < 5 && (
          <div className="flex gap-2">
            <input
              className="flex-1 px-3 py-2 border rounded-lg text-sm outline-none"
              style={{ borderColor: '#e2e8f0' }}
              placeholder="e.g. Кстати, мы делаем инструмент для этого..."
              value={newCta}
              onChange={e => setNewCta(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCtaTemplate()}
            />
            <button className="btn btn-sm" onClick={addCtaTemplate}>Add</button>
          </div>
        )}
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
              setAddRange([v, Math.max(v, addRange[1])])
            }} />
          </div>
          <div className="flex-1">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Max</label>
            <Slider min={1} max={5} value={addRange[1]} onChange={(v) => {
              setAddRange([Math.min(addRange[0], v), v])
            }} />
          </div>
        </div>
      </Section>

      {/* Add people by keywords */}
      <Section title="Add people by keywords">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm">Enable keyword-based search</span>
          <Toggle value={addByKeywords} onChange={(v) => { setAddByKeywords(v) }} />
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
              <button className="text-xs" style={{ color: 'var(--color-danger)' }} onClick={() => removeSessionTime(time)}>Remove</button>
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

      {/* Anti-ban randomization */}
      <Section title="Anti-ban randomization" subtitle={`Start each session with random +${jitterRange[0]}…+${jitterRange[1]} min offset`}>
        <div className="flex gap-4 items-center">
          <div className="flex-1">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>From (min)</label>
            <Slider min={0} max={30} value={jitterRange[0]} onChange={(v) => setJitterRange([v, Math.max(v, jitterRange[1])])} />
          </div>
          <div className="flex-1">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>To (min)</label>
            <Slider min={0} max={30} value={jitterRange[1]} onChange={(v) => setJitterRange([Math.min(jitterRange[0], v), v])} />
          </div>
        </div>
      </Section>

      {(saveState === 'saving' || showSaved || profileLoading) && (
        <div className="fixed top-4 right-4 bg-white border rounded-lg px-3 py-2 text-xs shadow">
          {profileLoading ? 'Loading profile...' : saveState === 'saving' ? 'Saving…' : '✓ Saved'}
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
