import { useState, useEffect } from 'react'
import { api, userId } from '../App'
import TagInput from '../components/TagInput'
import Slider from '../components/Slider'

export default function RedditSettings({ userId: propUserId, settings, onSettingsUpdate }) {
  const rd = settings?.reddit || {}
  const uid = propUserId || userId

  const [subreddits, setSubreddits] = useState(rd.subreddits || [])
  const [keywords, setKeywords] = useState(rd.keywords || [])
  const [commentsPerDay, setCommentsPerDay] = useState(rd.comments_per_day || 5)
  const [upvotesPerDay, setUpvotesPerDay] = useState(rd.upvotes_per_day || 5)
  const [sessionTimes, setSessionTimes] = useState(rd.session_times || ['09:00', '14:00', '19:00'])
  const [newTime, setNewTime] = useState('')
  const [dirty, setDirty] = useState(false)

  // Login form
  const [redditSession, setRedditSession] = useState('')
  const [tokenV2, setTokenV2] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [status, setStatus] = useState(rd.connected)
  const [showSuccess, setShowSuccess] = useState(false)

  const markDirty = () => setDirty(true)

  const save = () => {
    onSettingsUpdate({
      reddit: {
        ...rd,
        subreddits,
        keywords,
        comments_per_day: commentsPerDay,
        upvotes_per_day: upvotesPerDay,
        session_times: sessionTimes,
      },
    })
    setDirty(false)
  }

  const handleConnect = async () => {
    if (!redditSession || !tokenV2) {
      setLoginError('Enter reddit_session and token_v2')
      return
    }
    setConnecting(true)
    setLoginError('')
    try {
      const res = await api.post('/api/reddit/cookie', {
        user_id: uid,
        reddit_session: redditSession,
        token_v2: tokenV2,
      })
      if (res.connected) {
        setTokenV2('')
        setShowSuccess(true)
        onSettingsUpdate({
          reddit: {
            ...rd,
            connected: true,
            reddit_username: res.username || rd.reddit_username,
          },
        })
      }
    } catch (e) {
      try {
        const resp = await fetch('/api/reddit/cookie', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: uid, reddit_session: redditSession, token_v2: tokenV2 }),
        })
        const data = await resp.json()
        setLoginError(data.error || 'Login failed')
      } catch {
        setLoginError(e.message || 'Login failed')
      }
    }
    setConnecting(false)
  }

  useEffect(() => { (async () => { try { const st = await api.get(`/api/reddit/check/${uid}`); setStatus(!!st.connected) } catch {} })() }, [uid])

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await api.post(`/api/reddit/disconnect/${uid}`)
      onSettingsUpdate({
        reddit: {
          ...rd,
          connected: false,
          reddit_username: '',
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
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>Your Reddit account is connected.</p>
            <button className="btn w-full" onClick={() => setShowSuccess(false)}>Continue</button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Reddit</h1>
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

      {/* Connection Card */}
      <Section title="Account" subtitle={rd.connected ? `Logged in as u/${rd.reddit_username || '...'}` : 'Connect your Reddit account'}>
        {status ? (
          <div className="card flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#FF4500">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5.8 11.33c.02.16.03.33.03.5 0 2.55-2.97 4.63-6.63 4.63s-6.63-2.07-6.63-4.63c0-.17.01-.34.03-.5A1.45 1.45 0 013.2 12c0-.81.66-1.47 1.47-1.47.39 0 .74.15 1.01.41 1-.72 2.37-1.18 3.9-1.24l.66-3.12.04-.02 2.15.45c.13-.27.4-.46.72-.46a.82.82 0 01.82.82.82.82 0 01-.82.82.82.82 0 01-.73-.45l-1.93-.41-.59 2.79c1.5.07 2.85.53 3.83 1.24.27-.25.62-.41 1.01-.41.81 0 1.47.66 1.47 1.47 0 .56-.31 1.04-.76 1.29z" />
              </svg>
              <span className="text-sm font-medium">u/{rd.reddit_username || '...'}</span>
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
        ) : (
          <div className="card">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-xl">🛡️</span>
              <div>
                <p className="font-medium text-sm mb-1">Secure login</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  Your password is used once to create a session. Only cookies are saved.
                </p>
              </div>
            </div>
            <input
              type="text"
              className="w-full px-4 py-3 border rounded-xl text-sm outline-none mb-3"
              placeholder="reddit_session"
              value={redditSession}
              onChange={e => setRedditSession(e.target.value)}
              style={{ borderColor: '#ddd' }}
              autoComplete="username"
            />
            <input
              type="password"
              className="w-full px-4 py-3 border rounded-xl text-sm outline-none mb-3"
              placeholder="token_v2"
              value={tokenV2}
              onChange={e => setTokenV2(e.target.value)}
              style={{ borderColor: '#ddd' }}
              autoComplete="current-password"
              onKeyDown={e => e.key === 'Enter' && handleConnect()}
            />
            {loginError && (
              <p className="text-xs mb-1" style={{ color: 'var(--color-danger)' }}>{loginError}</p>
            )}
            <p className="text-[11px] mb-3" style={{ color: 'var(--color-muted)' }}>
              Open reddit.com in browser → F12 → Application → Cookies → copy reddit_session and token_v2
            </p>
            <button
              className="w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all"
              style={{
                background: connecting ? '#ccc' : '#FF4500',
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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5.8 11.33c.02.16.03.33.03.5 0 2.55-2.97 4.63-6.63 4.63s-6.63-2.07-6.63-4.63c0-.17.01-.34.03-.5A1.45 1.45 0 013.2 12c0-.81.66-1.47 1.47-1.47.39 0 .74.15 1.01.41 1-.72 2.37-1.18 3.9-1.24l.66-3.12.04-.02 2.15.45c.13-.27.4-.46.72-.46a.82.82 0 01.82.82.82.82 0 01-.82.82.82.82 0 01-.73-.45l-1.93-.41-.59 2.79c1.5.07 2.85.53 3.83 1.24.27-.25.62-.41 1.01-.41.81 0 1.47.66 1.47 1.47 0 .56-.31 1.04-.76 1.29z" />
                  </svg>
                  Connect Reddit
                </>
              )}
            </button>
          </div>
        )}
      </Section>

      {/* Subreddits */}
      <Section title="Subreddits" subtitle="Target subreddits for engagement">
        <TagInput
          tags={subreddits}
          onChange={(tags) => { setSubreddits(tags); markDirty() }}
          placeholder="Add subreddit (e.g. webdev)..."
          prefix="r/"
        />
      </Section>

      {/* Keywords */}
      <Section title="Keywords" subtitle="Filter posts by these keywords">
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

      {/* Upvotes per day */}
      <Section title="Upvotes per day" subtitle={`${upvotesPerDay} upvotes`}>
        <Slider
          min={1}
          max={15}
          value={upvotesPerDay}
          onChange={(v) => { setUpvotesPerDay(v); markDirty() }}
        />
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
