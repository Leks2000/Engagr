import { useState } from 'react'
import ControlCenter from './ControlCenter'
import LinkedInSettings from './LinkedInSettings'
import RedditSettings from './RedditSettings'
import IdeasEngine from './IdeasEngine'

const TABS = [
  { id: 'control', label: 'Control' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'extension', label: 'Extension' },
  { id: 'limits', label: 'Limits' },
  { id: 'advanced', label: 'Advanced' },
]

export default function Settings({ userId, settings, language = 'en', onSettingsUpdate, onNavigate }) {
  const [tab, setTab] = useState('control')
  const sessionActive = settings?.session_active !== false
  const li = settings?.linkedin || {}
  const rd = settings?.reddit || {}
  const x = settings?.x || {}

  const updateSession = () => onSettingsUpdate?.({ session_active: !sessionActive })
  const handleNavigate = (target) => {
    if (['linkedin', 'reddit', 'extension', 'limits', 'advanced'].includes(target)) {
      setTab(target)
      return
    }
    if (target === 'ideas' || target === 'x') {
      setTab('advanced')
      return
    }
    if (target === 'memory') {
      onNavigate?.('profile')
      return
    }
    if (target === 'queue') {
      onNavigate?.('queue')
      return
    }
    onNavigate?.(target)
  }

  return (
    <div className="animate-fade-in settings-screen">
      <div className="px-5 pt-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              Platforms, extension connection, pause/resume, control center, and daily limits.
            </p>
          </div>
          <button className="btn btn-sm" type="button" onClick={updateSession}>
            {sessionActive ? 'Pause' : 'Resume'}
          </button>
        </div>

        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
          {TABS.map(item => (
            <button
              key={item.id}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all"
              style={tab === item.id
                ? { background: '#0f172a', color: '#fff', border: '1px solid #0f172a' }
                : { background: '#fff', color: '#64748b', border: '1px solid #e2e8f0' }}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'control' && (
        <ControlCenter
          userId={userId}
          settings={settings}
          language={language}
          onSettingsUpdate={onSettingsUpdate}
          onNavigate={handleNavigate}
        />
      )}

      {tab === 'linkedin' && (
        <LinkedInSettings userId={userId} settings={settings} onSettingsUpdate={onSettingsUpdate} />
      )}

      {tab === 'reddit' && (
        <RedditSettings userId={userId} settings={settings} onSettingsUpdate={onSettingsUpdate} />
      )}

      {tab === 'extension' && (
        <div className="px-5">
          <ControlCenter
            userId={userId}
            settings={settings}
            language={language}
            onSettingsUpdate={onSettingsUpdate}
            onNavigate={handleNavigate}
          />
        </div>
      )}

      {tab === 'limits' && (
        <div className="px-5 space-y-3 pb-6">
          <LimitCard title="LinkedIn" rows={[
            ['Comments/day', li.comments_per_day ?? 5],
            ['Hard daily comments', li.daily_comment_hard_limit ?? 10],
            ['Likes/day', li.likes_per_day ?? 5],
            ['Connect range', Array.isArray(li.people_add_range) ? li.people_add_range.join('–') : '1–3'],
          ]} />
          <LimitCard title="Reddit" rows={[
            ['Comments/day', rd.comments_per_day ?? 5],
            ['Upvotes/day', rd.upvotes_per_day ?? 5],
          ]} />
          <LimitCard title="X" rows={[
            ['Replies/day', x.daily_limit_replies ?? 15],
            ['Likes/day', x.daily_limit_likes ?? 5],
            ['Follows/day', x.daily_limit_follows ?? 5],
          ]} />
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Edit platform-specific limits in the LinkedIn, Reddit, and X sections. Publishing still requires explicit approval.
          </p>
        </div>
      )}

      {tab === 'advanced' && (
        <div className="px-5 pb-6">
          <div className="card mb-4">
            <p className="text-sm font-semibold mb-1">Advanced</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Ideas Engine is intentionally removed from the main navigation until the core post → Feed → variants → approve → extension flow is stable.
            </p>
          </div>
          <IdeasEngine userId={userId} language={language} />
        </div>
      )}
    </div>
  )
}

function LimitCard({ title, rows }) {
  return (
    <div className="card">
      <p className="text-sm font-semibold mb-3">{title}</p>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--color-muted)' }}>{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
