import { useState, useEffect, useCallback } from 'react'
import { api } from '../App'

export default function Dashboard({ userId: uid, settings, onSettingsUpdate, onNavigate }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState([])
  const [logsSupported, setLogsSupported] = useState(true)

  const loadStats = useCallback(async () => {
    try { setStats(await api.get(`/api/stats/${uid}`)) } catch (err) { console.error('Failed to load stats:', err) }
    setLoading(false)
  }, [uid])

  useEffect(() => { loadStats(); const interval = setInterval(loadStats, 30000); return () => clearInterval(interval) }, [loadStats])
  useEffect(() => {
    const loadLogs = async () => {
      if (!logsSupported) return
      try {
        const data = await api.get(`/api/session/logs/${uid}`)
        setLogs(data?.logs || [])
      } catch (e) {
        if (String(e?.message || '').includes('404')) setLogsSupported(false)
      }
    }
    loadLogs()
    const timer = setInterval(loadLogs, 5000)
    return () => clearInterval(timer)
  }, [uid, logsSupported])

  const isActive = settings?.session_active !== false
  const toggleSession = async () => {
    try { await api.post(`/api/session/${uid}/${isActive ? 'pause' : 'resume'}`); onSettingsUpdate({ session_active: !isActive }) } catch (err) { console.error('Failed to toggle session:', err) }
  }

  const runSession = async () => {
    setRunning(true)
    try {
      const res = await api.post(`/api/session/run/${uid}`)
      const count = res?.queued || 0
      const msg = `✅ Added ${count} posts to queue`
      setToast(msg)
      setTimeout(() => setToast(''), 4000)
      // Navigate to Queue tab after short delay
      if (count > 0 && onNavigate) {
        setTimeout(() => onNavigate('queue'), 1500)
      }
    } catch (err) {
      setToast('❌ Failed to run session')
      setTimeout(() => setToast(''), 3000)
    }
    setRunning(false)
  }

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading stats...</div></div>

  return (
    <div className="px-5 pt-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold tracking-tight">Dashboard</h1><p className="text-xs" style={{ color: 'var(--color-muted)' }}>Today · Engagement performance</p></div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-run-session"
            onClick={runSession}
            disabled={running}
          >
            {running ? (
              <><span className="spinner-sm" /> Running...</>
            ) : (
              '▶ Run Session'
            )}
          </button>
          <button className="btn btn-sm" onClick={toggleSession}><span className={`status-dot ${isActive ? 'active' : 'paused'}`}></span>{isActive ? 'Active' : 'Paused'}</button>
        </div>
      </div>

      {toast && (
        <div className="card mb-4 text-sm toast-msg" style={{ background: toast.includes('❌') ? '#ffeaea' : '#e8f5e9', color: toast.includes('❌') ? '#c62828' : '#1b5e20' }}>{toast}</div>
      )}

      <PlatformSection title="LinkedIn" connected={settings?.linkedin?.connected} className="mb-4">
        <div className="card mb-3 text-xs">
          Warm-up: {settings?.linkedin?.warmup_mode ? 'ON' : 'OFF'} · Daily target: {settings?.linkedin?.comments_per_day || 5}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Comments" value={stats?.linkedin_comments || 0} max={settings?.linkedin?.comments_per_day || 15} icon={<MessageIcon />} tone="linkedin" />
          <StatCard label="Likes" value={stats?.linkedin_likes || 0} max={settings?.linkedin?.likes_per_day || 5} icon={<LikeIcon />} tone="linkedin" />
          <StatCard label="People Added" value={stats?.linkedin_adds || 0} max={settings?.linkedin?.people_add_range?.[1] || 5} icon={<UsersIcon />} tone="linkedin" />
        </div>
      </PlatformSection>

      <PlatformSection title="Reddit" connected={settings?.reddit?.connected} reddit className="mb-6">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Comments" value={stats?.reddit_comments || 0} max={settings?.reddit?.comments_per_day || 15} icon={<MessageIcon />} tone="reddit" />
          <StatCard label="Upvotes" value={stats?.reddit_upvotes || 0} max={settings?.reddit?.upvotes_per_day || 5} icon={<ArrowUpIcon />} tone="reddit" />
        </div>
      </PlatformSection>

      <div className="card stats-footer card-mount" style={{ animationDelay: "260ms" }}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>Next Sessions</p>
            <p className="text-sm font-semibold">LinkedIn: {settings?.linkedin?.session_times?.[0] || "--:--"}</p>
            <p className="text-sm font-semibold">Reddit: {settings?.reddit?.session_times?.[0] || "--:--"}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>Detailed stats</p>
            <p className="text-sm">Total: {(stats?.linkedin_comments||0)+(stats?.linkedin_likes||0)+(stats?.linkedin_adds||0)+(stats?.reddit_comments||0)+(stats?.reddit_upvotes||0)}</p>
          </div>
        </div>
      </div>
      <div className="card mt-4">
        <p className="text-sm font-semibold mb-2">Live session log</p>
        <div className="text-xs" style={{ maxHeight: 180, overflowY: 'auto', color: 'var(--color-muted)' }}>
          {!logsSupported ? <p>Log endpoint is not available on this backend yet.</p> : logs.length ? logs.slice(-12).map((l, i) => <p key={i}>{l}</p>) : <p>No events yet.</p>}
        </div>
      </div>
    </div>
  )
}

function PlatformSection({ title, connected, children, reddit, className = '' }) {
  return <div className={className}><div className="flex items-center gap-2 mb-3"><span className={`badge ${reddit ? 'badge-reddit' : 'badge-linkedin'}`}>{title}</span>{connected && <span className="text-xs" style={{ color: 'var(--color-success)' }}>Connected</span>}</div>{children}</div>
}

function StatCard({ label, value, max, icon, tone }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const done = pct >= 100
  const color = tone === 'reddit' ? '#FF4500' : '#0A66C2'
  return (
    <div className="card metric-card card-mount">
      <div className="flex items-start justify-between mb-3">
        <div className="metric-label-wrap"><p className="metric-label">{label}</p><p className="metric-meta">Today</p></div>
        <div className="metric-icon" style={{ color }}>{icon}</div>
      </div>
      <div className="flex items-end justify-between mb-2"><p className="metric-value">{value}</p><p className="metric-max">of {max}</p></div>
      <div className="metric-progress-bg"><div className="metric-progress-fill progress-animate" style={{ "--target": `${pct}%`, background: done ? 'var(--color-success)' : color }} /></div>
    </div>
  )
}

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round' }
const MessageIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" {...base}><path d="M8 9h8M8 13h5"/><path d="M7 4h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 3v-3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/></svg>
const LikeIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" {...base}><path d="M7 11v9"/><path d="M7 11h-3v9h3"/><path d="M10 20h7.2a2 2 0 0 0 2-1.7l.8-5A2 2 0 0 0 18 11h-5l.5-3.2a2 2 0 0 0-2-2.3L9 11z"/></svg>
const UsersIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" {...base}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
const ArrowUpIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" {...base}><path d="m12 19 7-7-7-7"/><path d="M5 12h14"/></svg>
