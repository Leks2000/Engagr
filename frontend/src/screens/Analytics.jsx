import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../App'

/**
 * Analytics — Stage 4 engagement funnel.
 *
 *   N found → M published → K declined/failed → CTR → AI cost → action history
 *
 * Reads GET /api/analytics/funnel/<userId>?days=7 and renders:
 *   - 4 funnel stage cards (Found / Published / Declined+Failed / CTR)
 *   - per-platform breakdown
 *   - daily mini-chart (found vs published)
 *   - AI cost panel
 *   - recent action history table with status badges
 *
 * The user picks the window (1 / 7 / 30 days) via the segmented control.
 */
const STATUS_META = {
  new_post:  { label: 'New',        bg: '#dbeafe', color: '#1d4ed8' },
  pending:   { label: 'Pending',    bg: '#fef3c7', color: '#92400e' },
  approved:  { label: 'Approved',   bg: '#dcfce7', color: '#15803d' },
  executing: { label: 'Executing',  bg: '#ede9fe', color: '#6d28d9' },
  published: { label: 'Published',  bg: '#ecfdf5', color: '#047857' },
  failed:    { label: 'Failed',     bg: '#fee2e2', color: '#b91c1c' },
  declined:  { label: 'Declined',   bg: '#fce7f3', color: '#be185d' },
  skipped:   { label: 'Skipped',    bg: '#f1f5f9', color: '#64748b' },
}

const PLATFORM_LABELS = { x: 'X', reddit: 'Reddit', linkedin: 'LinkedIn' }
const PLATFORM_COLORS = { linkedin: '#0A66C2', reddit: '#FF4500', x: '#111827' }

function pct(n) {
  if (n == null || isNaN(n)) return '0%'
  return `${Math.round(n * 100)}%`
}

function fmtCost(usd) {
  if (!usd) return '$0.00'
  if (usd < 0.01) return `<$0.01`
  return `$${Number(usd).toFixed(2)}`
}

export default function Analytics({ userId, language = 'en' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [days, setDays] = useState(7)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await api.get(`/api/analytics/funnel/${userId}?days=${days}`)
      setData(res)
    } catch (err) {
      console.error('funnel load failed', err)
      setError(err.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [userId, days])

  useEffect(() => { load() }, [load])

  const funnel = data?.funnel || {}
  const platforms = data?.platforms || {}
  const daily = data?.daily || []
  const history = data?.action_history || []

  // ── Daily chart scale ───────────────────────────────────────────────────
  const maxDaily = useMemo(() => {
    if (!daily.length) return 1
    return Math.max(1, ...daily.map(d => d.found))
  }, [daily])

  return (
    <div className="px-5 pt-6 animate-fade-in pb-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Analytics</h1>
          <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>
            Engagement funnel · last {days} day{days !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: '#f1f5f9' }}>
          {[1, 7, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
              style={days === d
                ? { background: '#0f172a', color: '#fff' }
                : { background: 'transparent', color: '#64748b' }}
            >
              {d}d
            </button>
          ))}
          <button className="btn btn-sm ml-1" onClick={load} disabled={loading}>↻</button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-xl text-sm" style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="queue-skeleton" />)}
        </div>
      ) : !data ? (
        <div className="text-center py-14 empty-state">
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <p className="text-base font-semibold">No analytics yet</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)', maxWidth: 280, margin: '6px auto 0' }}>
            Once posts flow through the approval loop, the funnel will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* ── Funnel stage cards ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <FunnelCard label="Found" value={funnel.found || 0} icon="📡" color="#4f46e5"
              sub={`${funnel.open || 0} awaiting decision`} />
            <FunnelCard label="Published" value={funnel.published || 0} icon="✅" color="#047857"
              sub={`${funnel.executing || 0} executing`} />
            <FunnelCard label="Declined + Failed" value={(funnel.declined || 0) + (funnel.failed || 0)} icon="✕" color="#b91c1c"
              sub={`${funnel.declined || 0} declined · ${funnel.failed || 0} failed`} />
            <FunnelCard label="CTR" value={pct(funnel.ctr)} icon="📈" color="#0A66C2"
              sub={`success ${pct(funnel.success_rate)}`} />
          </div>

          {/* ── AI cost panel ───────────────────────────────────────────── */}
          <div className="queue-card mb-4" style={{ borderLeft: '4px solid #7c3aed' }}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>AI cost</p>
                <p className="text-2xl font-bold" style={{ color: '#7c3aed' }}>{fmtCost(data.ai_cost_usd)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px]" style={{ color: '#94a3b8' }}>{data.ai_tokens || 0} tokens</p>
                <p className="text-[10px]" style={{ color: '#94a3b8' }}>Groq llama-3.3-70b</p>
              </div>
            </div>
            {data.groq_calls_saved > 0 && (
              <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid #f1f5f9' }}>
                <div>
                  <p className="text-[11px] font-semibold" style={{ color: '#047857' }}>
                    Filter saved {data.groq_calls_saved} Groq calls
                  </p>
                  <p className="text-[10px]" style={{ color: '#94a3b8' }}>
                    Spam / low-relevance / duplicates removed before variant generation
                  </p>
                </div>
                <p className="text-sm font-bold" style={{ color: '#047857' }}>
                  ~{fmtCost(data.groq_cost_saved_usd)} saved
                </p>
              </div>
            )}
          </div>

          {/* ── Per-platform breakdown ──────────────────────────────────── */}
          <h2 className="text-sm font-bold mb-2" style={{ color: '#0f172a' }}>By platform</h2>
          <div className="space-y-2 mb-4">
            {Object.keys(platforms).length === 0 && (
              <p className="text-xs" style={{ color: '#94a3b8' }}>No platform data in this window.</p>
            )}
            {Object.entries(platforms).map(([plat, p]) => {
              const color = PLATFORM_COLORS[plat] || '#6366f1'
              return (
                <div key={plat} className="queue-card" style={{ borderLeft: `4px solid ${color}` }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold" style={{ color: '#0f172a' }}>{PLATFORM_LABELS[plat] || plat}</span>
                    <span className="text-xs font-semibold" style={{ color }}>CTR {pct(p.ctr)}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <MiniStat label="Found" value={p.found} />
                    <MiniStat label="Published" value={p.published} color="#047857" />
                    <MiniStat label="Declined" value={p.declined} color="#be185d" />
                    <MiniStat label="Failed" value={p.failed} color="#b91c1c" />
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Daily chart ─────────────────────────────────────────────── */}
          {daily.length > 0 && (
            <>
              <h2 className="text-sm font-bold mb-2" style={{ color: '#0f172a' }}>Daily</h2>
              <div className="queue-card mb-4">
                <div className="flex items-end gap-2 h-28 mb-2">
                  {daily.map(d => (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full rounded-t-md relative" style={{
                        height: `${(d.found / maxDaily) * 100}%`,
                        background: '#dbeafe',
                        minHeight: 4,
                      }}>
                        <div className="absolute bottom-0 left-0 right-0 rounded-t-md"
                          style={{
                            height: `${d.found > 0 ? (d.published / d.found) * 100 : 0}%`,
                            background: '#047857',
                            minHeight: d.published > 0 ? 4 : 0,
                          }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-[10px]" style={{ color: '#64748b' }}>
                  <span className="flex items-center gap-1"><span style={{ width: 8, height: 8, background: '#dbeafe', borderRadius: 2 }} />Found</span>
                  <span className="flex items-center gap-1"><span style={{ width: 8, height: 8, background: '#047857', borderRadius: 2 }} />Published</span>
                </div>
              </div>
            </>
          )}

          {/* ── Action history ──────────────────────────────────────────── */}
          <h2 className="text-sm font-bold mb-2" style={{ color: '#0f172a' }}>Action history</h2>
          {history.length === 0 ? (
            <p className="text-xs mb-4" style={{ color: '#94a3b8' }}>No actions in this window.</p>
          ) : (
            <div className="space-y-1.5 mb-4">
              {history.map(a => {
                const meta = STATUS_META[a.status] || { label: a.status, bg: '#f1f5f9', color: '#475569' }
                const color = PLATFORM_COLORS[a.platform] || '#6366f1'
                return (
                  <div key={a.id} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color, minWidth: 56 }}>
                      {PLATFORM_LABELS[a.platform] || a.platform}
                    </span>
                    <span className="text-xs flex-1 truncate" style={{ color: '#334155' }}>
                      {a.author || '—'}
                    </span>
                    {a.relevance_score != null && (
                      <span className="text-[10px] flex-shrink-0" style={{ color: '#94a3b8' }}>
                        ★{Number(a.relevance_score).toFixed(1)}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                      style={{ background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────
function FunnelCard({ label, value, icon, color, sub }) {
  return (
    <div className="queue-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#64748b' }}>{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] mt-1" style={{ color: '#94a3b8' }}>{sub}</p>}
    </div>
  )
}

function MiniStat({ label, value, color }) {
  return (
    <div>
      <p className="text-base font-bold" style={{ color: color || '#0f172a' }}>{value}</p>
      <p className="text-[10px]" style={{ color: '#94a3b8' }}>{label}</p>
    </div>
  )
}
