import { useState, useEffect, useCallback } from 'react'
import { api, userId } from '../App'


export default function Dashboard({ userId: uid, settings, onSettingsUpdate }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    try {
      const data = await api.get(`/api/stats/${uid}`)
      setStats(data)
    } catch (err) {
      console.error('Failed to load stats:', err)
    }
    setLoading(false)
  }, [uid])

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [loadStats])

  const isActive = settings?.session_active !== false

  const toggleSession = async () => {
    try {
      if (isActive) {
        await api.post(`/api/session/${uid}/pause`)
      } else {
        await api.post(`/api/session/${uid}/resume`)
      }
      onSettingsUpdate({ session_active: !isActive })
    } catch (err) {
      console.error('Failed to toggle session:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading stats...</div>
      </div>
    )
  }

  return (
    <div className="px-5 pt-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Today's activity</p>
        </div>
        <button
          className="btn btn-sm"
          onClick={toggleSession}
        >
          <span className={`status-dot ${isActive ? 'active' : 'paused'}`}></span>
          {isActive ? 'Active' : 'Paused'}
        </button>
      </div>

      {/* LinkedIn Stats */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="badge badge-linkedin">LinkedIn</span>
          {settings?.linkedin?.connected && (
            <span className="text-xs" style={{ color: 'var(--color-success)' }}>● Connected</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Comments"
            value={stats?.linkedin_comments || 0}
            max={settings?.linkedin?.comments_per_day || 15}
            icon="💬"
            delay={0}
          />
          <StatCard
            label="Likes"
            value={stats?.linkedin_likes || 0}
            max={settings?.linkedin?.likes_per_day || 5}
            icon="👍"
            delay={1}
          />
          <StatCard
            label="People"
            value={stats?.linkedin_adds || 0}
            max={settings?.linkedin?.people_add_range?.[1] || 5}
            icon="🤝"
            delay={2}
          />
        </div>
      </div>

      {/* Reddit Stats */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="badge badge-reddit">Reddit</span>
          {settings?.reddit?.connected && (
            <span className="text-xs" style={{ color: 'var(--color-success)' }}>● Connected</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Comments"
            value={stats?.reddit_comments || 0}
            max={settings?.reddit?.comments_per_day || 15}
            icon="💬"
            delay={3}
          />
          <StatCard
            label="Upvotes"
            value={stats?.reddit_upvotes || 0}
            max={settings?.reddit?.upvotes_per_day || 5}
            icon="🚀"
            delay={4}
          />
        </div>
      </div>

      <div className="card mb-4">
        <h3 className="text-sm font-semibold mb-2">Detailed stats</h3>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Total actions: {(stats?.linkedin_comments||0)+(stats?.linkedin_likes||0)+(stats?.linkedin_adds||0)+(stats?.reddit_comments||0)+(stats?.reddit_upvotes||0)}</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>LinkedIn engagement: {(stats?.linkedin_comments||0)+(stats?.linkedin_likes||0)}</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Reddit engagement: {(stats?.reddit_comments||0)+(stats?.reddit_upvotes||0)}</p>
      </div>

      {/* Session Times */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold mb-3">Next Sessions</h3>
        <div className="space-y-2">
          {settings?.linkedin?.session_times?.map((time, i) => (
            <div key={`li-${i}`} className="card flex items-center justify-between py-3">
              <div className="flex items-center gap-2">
                <span className="badge badge-linkedin" style={{ fontSize: 10, padding: '2px 6px' }}>LI</span>
                <span className="text-sm font-medium">{time}</span>
              </div>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>UTC</span>
            </div>
          ))}
          {settings?.reddit?.session_times?.map((time, i) => (
            <div key={`rd-${i}`} className="card flex items-center justify-between py-3">
              <div className="flex items-center gap-2">
                <span className="badge badge-reddit" style={{ fontSize: 10, padding: '2px 6px' }}>RD</span>
                <span className="text-sm font-medium">{time}</span>
              </div>
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>UTC</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, max, icon, delay }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0

  return (
    <div
      className="card text-center animate-slide-up"
      style={{ animationDelay: `${delay * 80}ms` }}
    >
      <div className="text-xl mb-1">{icon}</div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>
        / {max} {label}
      </div>
      <div className="w-full h-1 rounded-full" style={{ background: '#e5e5e5' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: pct >= 100 ? 'var(--color-success)' : 'var(--color-text)',
          }}
        />
      </div>
    </div>
  )
}
