import { useState, useEffect } from 'react'
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

  // Login form
  const [liAt, setLiAt] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [status, setStatus] = useState(li.connected)

  const save = () => {
    onSettingsUpdate({
      linkedin: {
        ...li,
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
      window.Telegram?.WebApp?.openLink?.(res.url)
    } catch (e) { setLoginError(e.message || 'Failed to start OAuth') }
    setConnecting(false)
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

  useEffect(() => { (async () => { try { const st = await api.get(`/api/linkedin/check/${uid}`); setStatus(!!st.connected) } catch {} })() }, [uid])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await api.post(`/api/linkedin/disconnect/${uid}`)
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
      markDirty()
    }
  }

  const removeSessionTime = (time) => {
    setSessionTimes(sessionTimes.filter(t => t !== time))
    markDirty()
  }

  return (
    <div className="px-5 pt-6 animate-fade-in">
      {showSuccess && (
        <div className="fixed inset-0 bg-black/35 z-50 flex items-center justify-center px-5">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <div className="text-5xl mb-3" style={{ color: 'var(--color-success)' }}>✅</div>
            <h3 className="text-lg font-semibold mb-1">Connected!</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>Your LinkedIn account is connected.</p>
            <button className="btn w-full" onClick={() => setShowSuccess(false)}>Continue</button>
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
      <Section title="Account" subtitle={li.connected ? 'Session active' : 'Connect your LinkedIn account'}>
        {status ? (
          <div className="card flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0077B5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                <rect x="2" y="9" width="4" height="12" />
                <circle cx="4" cy="4" r="2" />
              </svg>
              <span className="text-sm font-medium">LinkedIn Connected</span>
            </div>
            <button
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ color: 'var(--color-danger)', background: '#fce4ec' }}
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
            <p className="text-xs mt-3 mb-2" style={{ color: "var(--color-muted)" }}>Or enter cookie manually:</p>
            <button className="w-full py-2 rounded-xl text-sm" style={{ border: "1px solid #ddd" }} onClick={handleCookieConnect}>Enter cookie manually</button>
          </div>
        ) : (
          <div className="card">
            <div className="flex items-start gap-3 mb-4">
              <span aria-hidden="true" style={{ color: '#0A66C2' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
              <div>
                <p className="font-medium text-sm mb-1">Secure login</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Your password is used once to create a session. Only cookies are saved.</p>
              </div>
            </div>
            <input
              type="text"
              className="w-full px-4 py-3 border rounded-xl text-sm outline-none mb-3"
              placeholder="li_at cookie value"
              value={liAt}
              onChange={e => setLiAt(e.target.value)}
              style={{ borderColor: '#ddd' }}
              autoComplete="email"
            />

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
            <p className="text-xs mt-3 mb-2" style={{ color: "var(--color-muted)" }}>Or enter cookie manually:</p>
            <button className="w-full py-2 rounded-xl text-sm" style={{ border: "1px solid #ddd" }} onClick={handleCookieConnect}>Enter cookie manually</button>
          </div>
        )}
      </Section>

      {/* Keywords */}
      <Section title="Keywords" subtitle="Posts matching these keywords will be targeted">
        <TagInput
          tags={keywords}
          onChange={(tags) => { setKeywords(tags); markDirty() }}
          placeholder="Add keyword..."
        />
      </Section>

      {/* Comments per day */}
      <Section title="Comments per day" subtitle={`${commentsPerDay} comments`}>
        <Slider
          min={1}
          max={15}
          value={commentsPerDay}
          onChange={(v) => { setCommentsPerDay(v); markDirty() }}
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
              markDirty()
            }} />
          </div>
          <div className="flex-1">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Max</label>
            <Slider min={1} max={5} value={addRange[1]} onChange={(v) => {
              const newRange = [Math.min(addRange[0], v), v]
              setAddRange(newRange)
              markDirty()
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
            onChange={(v) => { setAddByKeywords(v); markDirty() }}
          />
        </div>
        {addByKeywords && (
          <TagInput
            tags={addKeywords}
            onChange={(tags) => { setAddKeywords(tags); markDirty() }}
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
            <p className="text-xs mt-3 mb-2" style={{ color: "var(--color-muted)" }}>Or enter cookie manually:</p>
            <button className="w-full py-2 rounded-xl text-sm" style={{ border: "1px solid #ddd" }} onClick={handleCookieConnect}>Enter cookie manually</button>
          </div>
        )}
      </Section>

      {/* Save */}
      {dirty && (
        <div className="fixed bottom-16 left-0 right-0 px-5 pb-4 pt-2 bg-white animate-slide-up">
          <button className="btn w-full" onClick={save}>
            Save Changes
          </button>
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
