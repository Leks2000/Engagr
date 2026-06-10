import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../App'

const DASH_I18N = {
  en: {
    title: 'Dashboard', subtitle: "Today · Engagement performance",
    runSession: 'Run LinkedIn', runReddit: 'Run Reddit', running: 'Running...', active: 'Active', paused: 'Paused',
    connectLinkedIn: 'Connect LinkedIn for sessions', connectReddit: 'Add subreddits in Reddit settings',
    comments: 'Comments', likes: 'Likes', added: 'People Added', upvotes: 'Upvotes',
    today: 'Today', nextSessions: 'Next Sessions', totalToday: 'Total Today',
    warmupMode: 'Warm-up Mode', warmupOn: 'ON', warmupOff: 'OFF',
    warmupHint: 'Gradually increases daily activity (+1 every 3 days)',
    warmupDay: 'Day', warmupTarget: 'Target',
    liveLog: 'Live Session Log', noEvents: 'No events yet. Run a session to see activity.',
    approveAll: 'Approve All', skipAll: 'Skip All', simulate: 'Simulate',
    analytics: 'Analytics', weekly: 'Week', monthly: 'Month',
    smartSchedule: 'Smart Schedule', applySchedule: 'Apply',
    bestTime: 'Optimal times', calculating: 'Calculating...',
    totalActions: 'Total Actions', avgPerDay: 'Avg/Day', bestDay: 'Best Day',
    replies: 'Replies', viewReplies: 'View', noReplies: 'No pending replies',
    trendingNews: 'Trending Now',
  },
  ru: {
    title: 'Главная', subtitle: "Сегодня · Эффективность",
    runSession: 'LinkedIn', runReddit: 'Reddit', running: 'Запуск...', active: 'Активно', paused: 'Пауза',
    connectLinkedIn: 'Подключите LinkedIn (li_at)', connectReddit: 'Добавьте сабреддиты в настройках Reddit',
    comments: 'Комментарии', likes: 'Лайки', added: 'Добавлено', upvotes: 'Апвоуты',
    today: 'Сегодня', nextSessions: 'Следующие сессии', totalToday: 'Всего сегодня',
    warmupMode: 'Режим прогрева', warmupOn: 'ВКЛ', warmupOff: 'ВЫКЛ',
    warmupHint: 'Постепенно увеличивает активность (+1 каждые 3 дня)',
    warmupDay: 'День', warmupTarget: 'Цель',
    liveLog: 'Живой лог сессии', noEvents: 'Событий пока нет. Запустите сессию.',
    approveAll: 'Одобрить всё', skipAll: 'Пропустить всё', simulate: 'Симуляция',
    analytics: 'Аналитика', weekly: 'Неделя', monthly: 'Месяц',
    smartSchedule: 'Умное расписание', applySchedule: 'Применить',
    bestTime: 'Оптимальное время', calculating: 'Расчёт...',
    totalActions: 'Всего действий', avgPerDay: 'Сред/день', bestDay: 'Лучший день',
    replies: 'Ответы', viewReplies: 'Смотреть', noReplies: 'Нет ожидающих ответов',
    trendingNews: 'Тренды сейчас',
  },
  es: {
    title: 'Panel', subtitle: "Hoy · Rendimiento",
    runSession: 'Ejecutar', running: 'Ejecutando...', active: 'Activo', paused: 'Pausado',
    comments: 'Comentarios', likes: 'Gustas', added: 'Añadidos', upvotes: 'Votos',
    today: 'Hoy', nextSessions: 'Próximas sesiones', totalToday: 'Total hoy',
    warmupMode: 'Modo calentamiento', warmupOn: 'ON', warmupOff: 'OFF',
    warmupHint: 'Aumenta gradualmente la actividad diaria (+1 cada 3 días)',
    warmupDay: 'Día', warmupTarget: 'Meta',
    liveLog: 'Log en vivo', noEvents: 'Sin eventos. Ejecuta una sesión.',
    approveAll: 'Aprobar todo', skipAll: 'Saltar todo', simulate: 'Simular',
    analytics: 'Analítica', weekly: 'Semana', monthly: 'Mes',
    smartSchedule: 'Horario inteligente', applySchedule: 'Aplicar',
    bestTime: 'Horas óptimas', calculating: 'Calculando...',
    totalActions: 'Total acciones', avgPerDay: 'Prom/día', bestDay: 'Mejor día',
    replies: 'Respuestas', viewReplies: 'Ver', noReplies: 'Sin respuestas pendientes',
    trendingNews: 'Tendencias ahora',
  },
  de: {
    title: 'Übersicht', subtitle: "Heute · Leistung",
    runSession: 'Starten', running: 'Läuft...', active: 'Aktiv', paused: 'Pausiert',
    comments: 'Kommentare', likes: 'Gefällt mir', added: 'Hinzugefügt', upvotes: 'Upvotes',
    today: 'Heute', nextSessions: 'Nächste Sitzungen', totalToday: 'Gesamt heute',
    warmupMode: 'Aufwärm-Modus', warmupOn: 'AN', warmupOff: 'AUS',
    warmupHint: 'Erhöht die tägliche Aktivität schrittweise (+1 alle 3 Tage)',
    warmupDay: 'Tag', warmupTarget: 'Ziel',
    liveLog: 'Live-Sitzungsprotokoll', noEvents: 'Noch keine Ereignisse. Starten Sie eine Sitzung.',
    approveAll: 'Alle genehmigen', skipAll: 'Alle überspringen', simulate: 'Simulieren',
    analytics: 'Analytik', weekly: 'Woche', monthly: 'Monat',
    smartSchedule: 'Intelligenter Zeitplan', applySchedule: 'Anwenden',
    bestTime: 'Optimale Zeiten', calculating: 'Berechnung...',
    totalActions: 'Aktionen gesamt', avgPerDay: 'Durchschn/Tag', bestDay: 'Bester Tag',
    replies: 'Antworten', viewReplies: 'Ansehen', noReplies: 'Keine ausstehenden Antworten',
    trendingNews: 'Trends jetzt',
  },
}

export default function Dashboard({ userId: uid, settings, onSettingsUpdate, onNavigate, language = 'en', extensionPresent = false }) {
  const t = DASH_I18N[language] || DASH_I18N.en
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [runningLi, setRunningLi] = useState(false)
  const [runningRd, setRunningRd] = useState(false)
  const [logs, setLogs] = useState([])
  const [logsSupported, setLogsSupported] = useState(true)
  const [analyticsTab, setAnalyticsTab] = useState('weekly')
  const [weeklyData, setWeeklyData] = useState(null)
  const [monthlyData, setMonthlyData] = useState(null)
  const [smartTimes, setSmartTimes] = useState(null)
  const [smartLoading, setSmartLoading] = useState(false)
  const [replies, setReplies] = useState([])

  const loadStats = useCallback(async () => {
    try { setStats(await api.get(`/api/stats/${uid}`)) } catch (err) { console.error('Failed to load stats:', err) }
    setLoading(false)
  }, [uid])

  useEffect(() => { loadStats(); const interval = setInterval(loadStats, 30000); return () => clearInterval(interval) }, [loadStats])

  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        const [w, m] = await Promise.all([
          api.get(`/api/analytics/${uid}/weekly`),
          api.get(`/api/analytics/${uid}/monthly`),
        ])
        setWeeklyData(w)
        setMonthlyData(m)
      } catch (err) {
        console.error('Analytics load failed:', err)
      }
    }
    loadAnalytics()
  }, [uid])

  useEffect(() => {
    const loadReplies = async () => {
      try {
        const data = await api.get(`/api/replies/${uid}`)
        setReplies(data?.replies || [])
      } catch {
        setReplies([])
      }
    }
    loadReplies()
  }, [uid])

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
    try {
      await api.post(`/api/session/${uid}/${isActive ? 'pause' : 'resume'}`)
      onSettingsUpdate({ session_active: !isActive })
    } catch (err) {
      console.error('Failed to toggle session:', err)
    }
  }

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 4500)
  }

  const runLinkedInSession = async () => {
    setRunningLi(true)
    try {
      const res = await api.post(`/api/session/run/${uid}`)
      const count = res?.queued || 0
      showToast(count > 0 ? `LinkedIn: ${count} in queue` : 'No LinkedIn posts. Check li_at cookie & keywords.')
      if (count > 0 && onNavigate) setTimeout(() => onNavigate('queue'), 1200)
    } catch {
      showToast('LinkedIn session failed')
    }
    setRunningLi(false)
  }

  const runRedditSession = async () => {
    setRunningRd(true)
    try {
      await api.post(`/api/reddit/session/run/${uid}`)
      showToast('Reddit session started — check Telegram for approval cards')
      setTimeout(() => onNavigate?.('queue'), 2000)
    } catch {
      showToast('Reddit session failed')
    }
    setRunningRd(false)
  }

  // Smart Schedule
  const loadSmartSchedule = async () => {
    setSmartLoading(true)
    try {
      const res = await api.get(`/api/smart-schedule/${uid}/linkedin`)
      setSmartTimes(res?.times || null)
    } catch {}
    setSmartLoading(false)
  }

  const applySmartSchedule = async () => {
    try {
      await api.post(`/api/smart-schedule/${uid}/linkedin/apply`)
      setToast('Smart Schedule applied!')
      setTimeout(() => setToast(''), 3000)
    } catch {}
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
  const rdConnected = settings?.reddit?.connected || (settings?.reddit?.subreddits?.length > 0)
  const activeAnalytics = analyticsTab === 'weekly' ? weeklyData : monthlyData
  const chartData = analyticsTab === 'weekly' ? weeklyData?.weekly : monthlyData?.monthly

  return (
    <div className="px-5 pt-6 animate-fade-in">
      {/* Extension bridge status banner */}
      {extensionPresent && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0',
          borderRadius: 10, padding: '6px 12px', marginBottom: 10,
          fontSize: 12, color: '#15803d', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>🔌</span>
          <span>Engagr WebBridge connected — LinkedIn parsing active</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            className="btn btn-sm btn-run-session"
            onClick={runLinkedInSession}
            disabled={runningLi || runningRd}
            title={liConnected ? '' : t.connectLinkedIn}
          >
            {runningLi ? <><span className="spinner-sm" /> {t.running}</> : t.runSession}
          </button>
          <button
            className="btn btn-sm"
            onClick={runRedditSession}
            disabled={runningLi || runningRd}
            style={{ borderColor: '#FF4500', color: '#FF4500' }}
            title={rdConnected ? '' : t.connectReddit}
          >
            {runningRd ? <><span className="spinner-sm" /> …</> : t.runReddit}
          </button>
          <button className="btn btn-sm" onClick={toggleSession}>
            <span className={`status-dot ${isActive ? 'active' : 'paused'}`} />
            {isActive ? t.active : t.paused}
          </button>
        </div>
      </div>

      {(!liConnected || !rdConnected) && (
        <div className="card mb-4 text-xs space-y-1" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
          {!liConnected && <p>⚠️ {t.connectLinkedIn}</p>}
          {!rdConnected && <p>⚠️ {t.connectReddit}</p>}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="card mb-4 text-sm toast-msg" style={{
          background: toast.includes('Failed') ? '#ffeaea' : toast.includes('No posts') ? '#fff8e1' : '#e8f5e9',
          color: toast.includes('Failed') ? '#c62828' : toast.includes('No posts') ? '#e65100' : '#1b5e20'
        }}>{toast}</div>
      )}

      {/* Analytics Section */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 5-5"/>
            </svg>
            <p className="text-sm font-semibold">{t.analytics}</p>
          </div>
          <div className="flex gap-1">
            <button
              className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
              style={analyticsTab === 'weekly' ? { background: '#0A66C2', color: '#fff' } : { background: '#f1f5f9', color: '#64748b' }}
              onClick={() => setAnalyticsTab('weekly')}
            >{t.weekly}</button>
            <button
              className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
              style={analyticsTab === 'monthly' ? { background: '#0A66C2', color: '#fff' } : { background: '#f1f5f9', color: '#64748b' }}
              onClick={() => setAnalyticsTab('monthly')}
            >{t.monthly}</button>
          </div>
        </div>

        {/* Chart */}
        {chartData && chartData.length > 0 ? (
          <div className="mb-3">
            <div className="flex items-end gap-1" style={{ height: 80 }}>
              {(analyticsTab === 'weekly' ? chartData : chartData.filter((_, i) => i % 3 === 0 || i === chartData.length - 1)).map((d, i) => {
                const maxVal = Math.max(...chartData.map(x => x.total), 1)
                const barH = Math.max((d.total / maxVal) * 64, 4)
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full rounded-sm transition-all"
                      style={{ height: barH, background: d.total > 0 ? '#0A66C2' : '#e2e8f0', minWidth: 4, maxWidth: 24, opacity: d.total > 0 ? 0.8 : 0.4 }}
                    />
                    <span className="text-[9px]" style={{ color: '#94a3b8' }}>
                      {analyticsTab === 'weekly' ? d.day_name : ''}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Summary stats */}
            {monthlyData && analyticsTab === 'monthly' && (
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #e2e8f0' }}>
                <div className="text-center">
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.totalActions}</p>
                  <p className="text-lg font-bold">{monthlyData.total_actions}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.avgPerDay}</p>
                  <p className="text-lg font-bold">{monthlyData.avg_per_day}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.bestDay}</p>
                  <p className="text-lg font-bold">{monthlyData.best_day?.total || 0}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No data yet. Activity will appear after sessions.</p>
          </div>
        )}
      </div>

      {/* Smart Schedule */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            <p className="text-sm font-semibold">{t.smartSchedule}</p>
          </div>
          <button
            className="text-xs px-2.5 py-1 rounded-lg font-medium"
            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}
            onClick={loadSmartSchedule}
            disabled={smartLoading}
          >
            {smartLoading ? t.calculating : t.bestTime}
          </button>
        </div>
        <p className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>
          AI analyzes audience activity to find the best posting windows
        </p>
        {smartTimes && (
          <div className="flex items-center gap-2 mt-2">
            <div className="flex gap-2 flex-1">
              {smartTimes.map((time, i) => (
                <span key={i} className="text-xs px-2.5 py-1.5 rounded-lg font-mono font-semibold" style={{ background: '#eff6ff', color: '#0A66C2', border: '1px solid #bfdbfe' }}>
                  {time}
                </span>
              ))}
            </div>
            <button
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: '#0A66C2', color: '#fff' }}
              onClick={applySmartSchedule}
            >
              {t.applySchedule}
            </button>
          </div>
        )}
      </div>

      {/* Nested Replies */}
      {replies.length > 0 && (
        <div className="card mb-4" style={{ border: '1px solid #fde68a', background: '#fffbeb' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#d97706" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <p className="text-sm font-semibold" style={{ color: '#92400e' }}>{t.replies} ({replies.length})</p>
            </div>
          </div>
          {replies.slice(0, 2).map((r, i) => (
            <div key={i} className="text-xs p-2 rounded-lg mb-1" style={{ background: '#fef3c7' }}>
              <span className="font-semibold">{r.author_name}</span> replied: "{(r.latest_reply?.text || '').slice(0, 60)}..."
            </div>
          ))}
          <p className="text-[11px] mt-1" style={{ color: '#92400e' }}>
            People are engaging with your AI comments. Continue the conversation!
          </p>
        </div>
      )}

      <div className="card mb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{t.warmupMode}</p>
            <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{t.warmupHint}</p>
          </div>
          <button
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{
              background: warmupMode ? '#e8f5e9' : '#f1f5f9',
              color: warmupMode ? '#1b5e20' : '#64748b',
              border: `1px solid ${warmupMode ? '#a5d6a7' : '#e2e8f0'}`,
            }}
            onClick={toggleWarmup}
          >
            {warmupMode ? t.warmupOn : t.warmupOff} · {t.warmupDay} {warmupDay} · {t.warmupTarget} {warmupTarget}
          </button>
        </div>
      </div>

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
      <div className="card mt-4 log-panel">
        <p className="text-sm font-semibold mb-2">{t.liveLog}</p>
        <div className="text-xs font-mono" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {!logsSupported ? (
            <p style={{ color: 'var(--color-muted)' }}>Log endpoint unavailable.</p>
          ) : logs.length ? (
            logs.slice(-14).map((l, i) => <LogLine key={i} text={l} />)
          ) : (
            <p style={{ color: 'var(--color-muted)' }}>{t.noEvents}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function LogLine({ text }) {
  let color = '#94a3b8'
  if (text.includes('success') || text.toLowerCase().includes('posted') || text.toLowerCase().includes('complete')) color = '#4ade80'
  else if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) color = '#f87171'
  else if (text.toLowerCase().includes('waiting') || text.toLowerCase().includes('delay')) color = '#fbbf24'
  else if (text.toLowerCase().includes('linkedin')) color = '#60a5fa'
  else if (text.toLowerCase().includes('reddit')) color = '#fb923c'
  else if (text.toLowerCase().includes('generat') || text.toLowerCase().includes('comment')) color = '#a78bfa'

  return <p style={{ color, marginBottom: 2, lineHeight: 1.6 }}>{text}</p>
}

function PlatformSection({ title, connected, children, reddit, className = '' }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`badge ${reddit ? 'badge-reddit' : 'badge-linkedin'}`}>{title}</span>
        {connected
          ? <span className="text-xs font-medium" style={{ color: '#10b981' }}>Connected</span>
          : <span className="text-xs font-medium" style={{ color: '#94a3b8' }}>Not connected</span>
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
