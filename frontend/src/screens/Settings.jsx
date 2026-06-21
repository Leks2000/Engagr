import { useState, useEffect, useCallback } from 'react'
import { api } from '../App'
import ControlCenter from './ControlCenter'
import LinkedInSettings from './LinkedInSettings'
import RedditSettings from './RedditSettings'
import XSettings from './XSettings'
import IdeasEngine from './IdeasEngine'

const TABS = [
  { id: 'control',  label: '🔧 Control'  },
  { id: 'linkedin', label: 'LinkedIn'    },
  { id: 'reddit',   label: 'Reddit'      },
  { id: 'x',        label: 'X'           },
  { id: 'limits',   label: 'Limits'      },
  { id: 'advanced', label: 'Advanced'    },
]

export default function Settings({ userId, settings, language = 'en', onSettingsUpdate, onNavigate }) {
  const [tab, setTab] = useState('control')
  const sessionActive = settings?.session_active !== false
  const li = settings?.linkedin || {}
  const rd = settings?.reddit   || {}
  const x  = settings?.x        || {}

  const updateSession = () => onSettingsUpdate?.({ session_active: !sessionActive })

  const handleNavigate = (target) => {
    if (['linkedin', 'reddit', 'x', 'limits', 'advanced'].includes(target)) {
      setTab(target); return
    }
    if (target === 'ideas') { setTab('advanced'); return }
    if (target === 'memory') { onNavigate?.('profile'); return }
    if (target === 'queue')  { onNavigate?.('queue');   return }
    onNavigate?.(target)
  }

  return (
    <div className="animate-fade-in settings-screen">
      <div className="px-5 pt-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Settings</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              Platforms, extension connection, pause/resume, and daily limits.
            </p>
          </div>
          <button className="btn btn-sm" type="button" onClick={updateSession}>
            {sessionActive ? '⏸ Pause' : '▶ Resume'}
          </button>
        </div>

        {/* Session status pill */}
        <div className="mb-4 flex items-center gap-2">
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full"
            style={sessionActive
              ? { background: '#dcfce7', color: '#15803d' }
              : { background: '#fee2e2', color: '#b91c1c' }}
          >
            {sessionActive ? '● Active' : '● Paused'}
          </span>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {sessionActive
              ? 'Extension will scan and process posts.'
              : 'Scanning paused. No posts will be processed.'}
          </span>
        </div>

        {/* Tab pills */}
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

      {/* ── Tab content ─────────────────────────────────────── */}

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

      {tab === 'x' && (
        <XSettings userId={userId} settings={settings} language={language} onSettingsUpdate={onSettingsUpdate} />
      )}

      {tab === 'limits' && (
        <div className="px-5 space-y-3 pb-6">
          <LimitCard title="LinkedIn" rows={[
            ['Comments / day',        li.comments_per_day          ?? 5  ],
            ['Hard daily comments',   li.daily_comment_hard_limit  ?? 10 ],
            ['Likes / day',           li.likes_per_day             ?? 5  ],
            ['Connect range',         Array.isArray(li.people_add_range) ? li.people_add_range.join('–') : '1–3'],
          ]} />
          <LimitCard title="Reddit" rows={[
            ['Comments / day', rd.comments_per_day ?? 5],
            ['Upvotes / day',  rd.upvotes_per_day  ?? 5],
          ]} />
          <LimitCard title="X" rows={[
            ['Replies / day',  x.daily_limit_replies ?? 15],
            ['Likes / day',    x.daily_limit_likes   ?? 5 ],
            ['Follows / day',  x.daily_limit_follows ?? 5 ],
          ]} />
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Edit platform-specific limits in the LinkedIn, Reddit, and X tabs. Every action still requires explicit approval before publishing.
          </p>
        </div>
      )}

      {tab === 'advanced' && (
        <div className="px-5 pb-6">
          <div className="card mb-4">
            <p className="text-sm font-semibold mb-1">⚠️ Advanced / Experimental</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Ideas Engine is here intentionally — it is not part of the main navigation until the core
              post → Feed → variants → approve → extension flow is stable end-to-end.
            </p>
          </div>

          {/* Stage 3/4/5 tooling — reachable from Advanced */}
          <div className="card mb-4">
            <p className="text-sm font-semibold mb-2">🧭 Stage tools</p>
            <div className="flex flex-col gap-2">
              <button className="btn btn-sm text-left" onClick={() => onNavigate?.('analytics')}>
                📊 Analytics funnel — found → published → CTR → AI cost
              </button>
              <button className="btn btn-sm text-left" onClick={() => onNavigate?.('selfhealing')}>
                🩺 Selector health — self-healing + AI proposals
              </button>
            </div>
          </div>

          {/* Stage 3 — relevance filtering controls */}
          <RelevancePanel userId={userId} onSettingsUpdate={onSettingsUpdate} settings={settings} />

          {/* Browser MCP — Playwright tunnel on the user's PC */}
          <McpPanel userId={userId} />

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

// ── Stage 3 — relevance filtering controls ─────────────────────────────────
function RelevancePanel({ userId, onSettingsUpdate, settings }) {
  const [filteringEnabled, setFilteringEnabled] = useState(settings?.filtering_enabled !== false)
  const [minScore, setMinScore] = useState(settings?.min_relevance_score ?? 3.0)
  const [saving, setSaving] = useState(false)

  const save = useCallback(async (enabled, score) => {
    setSaving(true)
    try {
      await api.put(`/api/relevance/${userId}`, {
        filtering_enabled: enabled,
        min_relevance_score: score,
      })
      onSettingsUpdate?.({ filtering_enabled: enabled, min_relevance_score: score })
    } catch (err) {
      console.error('relevance save failed', err)
    } finally {
      setSaving(false)
    }
  }, [userId, onSettingsUpdate])

  return (
    <div className="card mb-4">
      <p className="text-sm font-semibold mb-1">🎯 Relevance filtering (Stage 3)</p>
      <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
        AI relevance score 0–10 + antispam + duplicate detection before a post reaches your Feed.
      </p>

      <div className="flex items-center justify-between mb-3">
        <span className="text-sm">Enable filtering</span>
        <button
          className={`toggle-track ${filteringEnabled ? 'active' : ''}`}
          role="switch"
          aria-checked={filteringEnabled}
          onClick={() => { const v = !filteringEnabled; setFilteringEnabled(v); save(v, minScore) }}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      <div className="mb-2">
        <div className="flex items-center justify-between text-xs mb-1">
          <span style={{ color: 'var(--color-muted)' }}>Min relevance score</span>
          <span className="font-semibold">{Number(minScore).toFixed(1)}</span>
        </div>
        <input
          type="range" min="0" max="10" step="0.5"
          value={minScore}
          onChange={e => setMinScore(parseFloat(e.target.value))}
          onMouseUp={e => save(filteringEnabled, parseFloat(e.target.value))}
          onTouchEnd={e => save(filteringEnabled, parseFloat(e.target.value))}
        />
        <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>
          Posts below this score are dropped. 0 = accept everything, 10 = only perfect matches.
        </p>
      </div>
      {saving && <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>Saving…</p>}
    </div>
  )
}

// ── Browser MCP — Playwright tunnel on the user's PC ───────────────────────
function McpPanel({ userId }) {
  const [status, setStatus] = useState(null)
  const [tools, setTools] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const checkStatus = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const s = await api.get('/api/mcp/status')
      setStatus(s)
      if (s.tunnel_ok) {
        const t = await api.get('/api/mcp/tools')
        setTools(t)
      } else {
        setTools(null)
      }
    } catch (err) {
      setError(err.message || 'MCP status failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { checkStatus() }, [checkStatus])

  return (
    <div className="card mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold">🌐 Browser MCP (Playwright tunnel)</p>
        <button className="btn btn-sm" onClick={checkStatus} disabled={loading}>↻</button>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
        Run on your PC so the Railway backend can drive your real browser for self-healing:
      </p>
      <pre className="text-[10px] p-2 rounded mb-3 overflow-x-auto" style={{ background: '#0f172a', color: '#a5b4fc' }}>
{`npx @playwright/mcp@latest --port 8931
C:\\cloudflared\\cloudflared.exe tunnel --url http://localhost:8931`}
      </pre>
      <p className="text-[11px] mb-3" style={{ color: 'var(--color-muted)' }}>
        Set <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 4 }}>BROWSER_MCP_URL</code> on Railway to your trycloudflare URL.
      </p>

      {error && <p className="text-xs mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {status && (
        <div className="flex items-center gap-2 text-xs mb-2">
          <span style={{
            width: 8, height: 8, borderRadius: 99,
            background: status.tunnel_ok ? '#22c55e' : '#ef4444',
          }} />
          <span style={{ color: status.tunnel_ok ? '#15803d' : '#b91c1c', fontWeight: 600 }}>
            {status.tunnel_ok ? 'Tunnel reachable' : 'Tunnel down'}
          </span>
          <span style={{ color: 'var(--color-muted)', marginLeft: 'auto' }}>
            {status.configured ? 'env' : 'default'}
          </span>
        </div>
      )}
      {status?.tunnel_ok && tools?.ok && (
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {tools.count} tools available · server: {status.server?.name || 'playwright-mcp'}
        </p>
      )}
      {status && !status.tunnel_ok && (
        <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
          {status.error || 'Start the tunnel on your PC, then refresh.'}
        </p>
      )}
    </div>
  )
}
