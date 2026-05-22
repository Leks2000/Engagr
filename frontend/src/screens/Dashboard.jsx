import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../App'

const DASH_I18N = {
  en: {
    title: 'Dashboard', subtitle: "Today · Engagement performance",
    runSession: '▶ Run Session', running: 'Running...', active: 'Active', paused: 'Paused',
    comments: 'Comments', likes: 'Likes', added: 'People Added', upvotes: 'Upvotes',
    today: 'Today', nextSessions: 'Next Sessions', totalToday: 'Total Today',
    warmupMode: 'Warm-up Mode', warmupOn: 'ON', warmupOff: 'OFF',
    warmupHint: 'Gradually increases daily activity (+1 every 3 days)',
    warmupDay: 'Day', warmupTarget: 'Target',
    liveLog: 'Live Session Log', noEvents: 'No events yet. Run a session to see activity.',
    approveAll: '✅ Approve All', skipAll: '❌ Skip All', simulate: '⚡ Simulate',
  },
  ru: {
    title: 'Главная', subtitle: "Сегодня · Эффективность",
    runSession: '▶ Запустить', running: 'Запуск...', active: 'Активно', paused: 'Пауза',
    comments: 'Комментарии', likes: 'Лайки', added: 'Добавлено', upvotes: 'Апвоуты',
    today: 'Сегодня', nextSessions: 'Следующие сессии', totalToday: 'Всего сегодня',
    warmupMode: 'Режим прогрева', warmupOn: 'ВКЛ', warmupOff: 'ВЫКЛ',
    warmupHint: 'Постепенно увеличивает активность (+1 каждые 3 дня)',
    warmupDay: 'День', warmupTarget: 'Цель',
    liveLog: 'Живой лог сессии', noEvents: 'Событий пока нет. Запустите сессию.',
    approveAll: '✅ Одобрить всё', skipAll: '❌ Пропустить всё', simulate: '⚡ Симуляция',
  },
  es: {
    title: 'Panel', subtitle: "Hoy · Rendimiento",
    runSession: '▶ Ejecutar', running: 'Ejecutando...', active: 'Activo', paused: 'Pausado',
    comments: 'Comentarios', likes: 'Gustas', added: 'Añadidos', upvotes: 'Votos',
    today: 'Hoy', nextSessions: 'Próximas sesiones', totalToday: 'Total hoy',
    warmupMode: 'Modo calentamiento', warmupOn: 'ON', warmupOff: 'OFF',
    warmupHint: 'Aumenta gradualmente la actividad diaria (+1 cada 3 días)',
    warmupDay: 'Día', warmupTarget: 'Meta',
    liveLog: 'Log en vivo', noEvents: 'Sin eventos. Ejecuta una sesión.',
    approveAll: '✅ Aprobar todo', skipAll: '❌ Saltar todo', simulate: '⚡ Simular',
  },
  de: {
    title: 'Übersicht', subtitle: "Heute · Leistung",
    runSession: '▶ Starten', running: 'Läuft...', active: 'Aktiv', paused: 'Pausiert',
    comments: 'Kommentare', likes: 'Gefällt mir', added: 'Hinzugefügt', upvotes: 'Upvotes',
    today: 'Heute', nextSessions: 'Nächste Sitzungen', totalToday: 'Gesamt heute',
    warmupMode: 'Aufwärm-Modus', warmupOn: 'AN', warmupOff: 'AUS',
    warmupHint: 'Erhöht die tägliche Aktivität schrittweise (+1 alle 3 Tage)',
    warmupDay: 'Tag', warmupTarget: 'Ziel',
    liveLog: 'Live-Sitzungsprotokoll', noEvents: 'Noch keine Ereignisse. Starten Sie eine Sitzung.',
    approveAll: '✅ Alle genehmigen', skipAll: '❌ Alle überspringen', simulate: '⚡ Simulieren',
  },
}

export default function Dashboard({ userId: uid, settings, onSettingsUpdate, onNavigate, language = 'en' }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState([])
  const [logExpanded, setLogExpanded] = useState(false)
  const logEndRef = useRef(null)

  const t = DASH_I18N[language] || DASH_I18N.en

  const loadStats = useCallback(async () => {
    try { setStats(await api.get(`/api/stats/${uid}`)) } catch (err) { console.error('Failed to load stats:', err) }
    setLoading(false)
  }, [uid])

  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 30000)
    return () => clearInterval(interval)
  }, [loadStats])

  useEffect(() => {
    const loadLogs = async () => {
      try {
        const data = await api.get(`/api/session/logs/${uid}`)
        setLogs(data?.logs || [])
      } catch {}
    }
    loadLogs()
    const timer = setInterval(loadLogs, 5000)
    return () => clearInterval(timer)
  }, [uid])

  useEffect(() => {
    if (logExpanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, logExpanded])

  const isActive = settings?.session_active !== false
  const toggleSession = async () => {
    try {
      await api.post(`/api/session/${uid}/${isActive ? 'pause' : 'resume'}`)
      onSettingsUpdate({ session_active: !isActive })
    } catch (err) {
      console.error('Failed to toggle session:', err)
    }
  }

  const runSession = async () => {
    setRunning(true)
    try {
      const res = await api.post(`/api/session/run/${uid}`)
      const count = res?.queued || 0
      const msg = count > 0 ? `✅ Added ${count} posts to queue` : '⚠️ No posts found. Check keywords and connection.'
      setToast(msg)
      setTimeout(() => setToast(''), 4000)
      if (count > 0 && onNavigate) {
        setTimeout(() => onNavigate('queue'), 1500)
      }
    } catch (err) {
      setToast('❌ Failed to run session')
      setTimeout(() => setToast(''), 3000)
    }
    setRunning(false)
  }

  // Warm-up mode
  const warmupMode = settings?.linkedin?.warmup_mode || false
  const warmupDay = settings?.linkedin?.warmup_day || 1
  const warmupTarget = settings?.linkedin?.comments_per_day || 5
  const toggleWarmup = async () => {
    try {
      await onSettingsUpdate({
        linkedin: {
          ...settings?.linkedin,
          warmup_mode: !warmupMode,
          warmup_day: warmupMode ? 1 : (settings?.linkedin?.warmup_day || 1),
        }
      })
    } catch {}
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading stats...</div>
    </div>
  )

  const liConnected = settings?.linkedin?.connected
  const rdConnected = settings?.reddit?.connected

  return (
    <div className="px-5 pt-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-run-session"
            onClick={runSession}
            disabled={running}
          >
            {running ? (
              <><span className="spinner-sm" /> {t.running}</>
            ) : t.runSession}
          </button>
          <button className="btn btn-sm" onClick={toggleSession}>
            <span className={`status-dot ${isActive ? 'active' : 'paused'}`}></span>
            {isActive ? t.active : t.paused}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="card mb-4 text-sm toast-msg" style={{
          background: toast.includes('❌') ? '#ffeaea' : toast.includes('⚠️') ? '#fff8e1' : '#e8f5e9',
          color: toast.includes('❌') ? '#c62828' : toast.includes('⚠️') ? '#e65100' : '#1b5e20'
        }}>{toast}</div>
      )}

      {/* Warm-up Mode Card */}
      <div className="card mb-4" style={{ border: warmupMode ? '2px solid #a7f3d0' : '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: warmupMode ? '#d1fae5' : '#f1f5f9' }}>
              <span className="text-lg">{warmupMode ? '🔥' : '❄️'}</span>
            </div>
            <div>
              <p className="text-sm font-semibold">{t.warmupMode}</p>
              <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{t.warmupHint}</p>
            </div>
          </div>
          <button
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: warmupMode ? '#d1fae5' : '#f1f5f9',
              color: warmupMode ? '#065f46' : '#64748b',
              border: warmupMode ? '1.5px solid #6ee7b7' : '1px solid #e2e8f0',
            }}
            onClick={toggleWarmup}
          >
            {warmupMode ? t.warmupOn : t.warmupOff}
          </button>
        </div>
        {warmupMode && (
          <div className="mt-3 pt-3" style={{ borderTop: '1px solid #e2e8f0' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.warmupDay} {warmupDay} · {t.warmupTarget}: {warmupTarget}/day</span>
              <span className="text-xs font-bold" style={{ color: '#065f46' }}>+1 per 3 days</span>
            </div>
            <div className="h-1.5 rounded-full" style={{ background: '#e2e8f0' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min((warmupTarget / 15) * 100, 100)}%`, background: '#10b981' }} />
            </div>
          </div>
        )}
      </div>

      {/* LinkedIn Section */}
      <PlatformSection title="LinkedIn" connected={liConnected} className="mb-4">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label={t.comments} value={stats?.linkedin_comments || 0} max={settings?.linkedin?.comments_per_day || 15} icon={<MessageIcon />} tone="linkedin" />
          <StatCard label={t.likes} value={stats?.linkedin_likes || 0} max={settings?.linkedin?.likes_per_day || 5} icon={<LikeIcon />} tone="linkedin" />
          <StatCard label={t.added} value={stats?.linkedin_adds || 0} max={settings?.linkedin?.people_add_range?.[1] || 5} icon={<UsersIcon />} tone="linkedin" />
        </div>
      </PlatformSection>

      {/* Reddit Section */}
      <PlatformSection title="Reddit" connected={rdConnected} reddit className="mb-4">
        <div className="grid grid-cols-2 gap-3">
          <StatCard label={t.comments} value={stats?.reddit_comments || 0} max={settings?.reddit?.comments_per_day || 15} icon={<MessageIcon />} tone="reddit" />
          <StatCard label={t.upvotes} value={stats?.reddit_upvotes || 0} max={settings?.reddit?.upvotes_per_day || 5} icon={<ArrowUpIcon />} tone="reddit" />
        </div>
      </PlatformSection>

      {/* Summary Card */}
      <div className="card stats-footer card-mount mb-4" style={{ animationDelay: "260ms" }}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>{t.nextSessions}</p>
            <p className="text-sm font-semibold">LinkedIn: {settings?.linkedin?.session_times?.[0] || "--:--"}</p>
            <p className="text-sm font-semibold">Reddit: {settings?.reddit?.session_times?.[0] || "--:--"}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>{t.totalToday}</p>
            <p className="text-2xl font-bold" style={{ color: '#0A66C2' }}>
              {(stats?.linkedin_comments||0)+(stats?.linkedin_likes||0)+(stats?.linkedin_adds||0)+(stats?.reddit_comments||0)+(stats?.reddit_upvotes||0)}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>actions</p>
          </div>
        </div>
      </div>

      {/* Live Terminal Log */}
      <div className="card" style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
            </div>
            <p className="text-xs font-mono font-semibold" style={{ color: '#94a3b8' }}>
              {t.liveLog}
            </p>
          </div>
          <button
            className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ color: '#64748b', background: '#1e293b' }}
            onClick={() => setLogExpanded(!logExpanded)}
          >
            {logExpanded ? '▾' : '▸'}
          </button>
        </div>
        <div
          className="font-mono text-xs overflow-y-auto transition-all"
          style={{
            maxHeight: logExpanded ? 280 : 100,
            minHeight: 60,
            color: '#e2e8f0',
          }}
        >
          {logs.length ? (
            <>
              {logs.slice(-20).map((l, i) => (
                <LogLine key={i} text={l} />
              ))}
              <div ref={logEndRef} />
            </>
          ) : (
            <p style={{ color: '#475569' }}>$ {t.noEvents}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function LogLine({ text }) {
  // Color-code log lines
  let color = '#94a3b8'
  if (text.includes('✅') || text.toLowerCase().includes('success') || text.toLowerCase().includes('posted')) color = '#4ade80'
  else if (text.includes('❌') || text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) color = '#f87171'
  else if (text.includes('⏳') || text.toLowerCase().includes('waiting') || text.toLowerCase().includes('delay')) color = '#fbbf24'
  else if (text.toLowerCase().includes('linkedin')) color = '#60a5fa'
  else if (text.toLowerCase().includes('reddit')) color = '#fb923c'
  else if (text.toLowerCase().includes('generat') || text.toLowerCase().includes('comment')) color = '#a78bfa'

  return <p style={{ color, marginBottom: 2, lineHeight: 1.6 }}>{text}</p>
}

function PlatformSection({ title, connected, children, reddit, className = '' }) {
  const color = reddit ? '#FF4500' : '#0A66C2'
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`badge ${reddit ? 'badge-reddit' : 'badge-linkedin'}`}>{title}</span>
        {connected
          ? <span className="text-xs font-medium" style={{ color: '#10b981' }}>● Connected</span>
          : <span className="text-xs font-medium" style={{ color: '#94a3b8' }}>○ Not connected</span>
        }
      </div>
      {children}
    </div>
  )
}

function StatCard({ label, value, max, icon, tone }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const done = pct >= 100
  const color = tone === 'reddit' ? '#FF4500' : '#0A66C2'
  return (
    <div className="card metric-card card-mount">
      <div className="flex items-start justify-between mb-3">
        <div className="metric-label-wrap">
          <p className="metric-label">{label}</p>
          <p className="metric-meta">Today</p>
        </div>
        <div className="metric-icon" style={{ color }}>{icon}</div>
      </div>
      <div className="flex items-end justify-between mb-2">
        <p className="metric-value">{value}</p>
        <p className="metric-max">of {max}</p>
      </div>
      <div className="metric-progress-bg">
        <div
          className="metric-progress-fill progress-animate"
          style={{ "--target": `${pct}%`, background: done ? 'var(--color-success)' : color }}
        />
      </div>
    </div>
  )
}

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: '1.75', strokeLinecap: 'round', strokeLinejoin: 'round' }
const MessageIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" {...base}><path d="M8 9h8M8 13h5"/><path d="M7 4h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 3v-3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"/></svg>
const LikeIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" {...base}><path d="M7 11v9"/><path d="M7 11h-3v9h3"/><path d="M10 20h7.2a2 2 0 0 0 2-1.7l.8-5A2 2 0 0 0 18 11h-5l.5-3.2a2 2 0 0 0-2-2.3L9 11z"/></svg>
const UsersIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" {...base}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
const ArrowUpIcon = () => <svg viewBox="0 0 24 24" width="18" height="18" {...base}><path d="m12 19 7-7-7-7"/><path d="M5 12h14"/></svg>
