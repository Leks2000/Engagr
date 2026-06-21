import { useCallback, useEffect, useState } from 'react'
import { api } from '../App'

/**
 * SelfHealing — Stage 5 selector health panel.
 *
 * Shows:
 *   - summary (healthy / degraded / broken selectors)
 *   - per-selector status with last success/failure timestamps
 *   - pending AI-proposed replacements with Accept / Reject buttons
 *   - recent probe log
 *
 * Reads GET /api/extension/selector/health/<userId>
 * POST /api/extension/selector/proposal/<userId>/<id>/accept|reject
 */
const STATUS_META = {
  healthy:          { label: 'Healthy',         bg: '#dcfce7', color: '#15803d' },
  degraded:         { label: 'Degraded',        bg: '#fef3c7', color: '#92400e' },
  broken:           { label: 'Broken',          bg: '#fee2e2', color: '#b91c1c' },
  healing_proposed: { label: 'Heal proposed',   bg: '#ede9fe', color: '#6d28d9' },
  unknown:          { label: 'Unknown',         bg: '#f1f5f9', color: '#475569' },
}

function fmt(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString() } catch { return ts }
}


function proposalPreview(p) {
  if (p.preview?.match_count != null) return p.preview
  if (!p.html_snippet || !p.new_selector || typeof window === 'undefined') return null
  try {
    const doc = new DOMParser().parseFromString(p.html_snippet, 'text/html')
    return { ok: true, match_count: doc.querySelectorAll(p.new_selector).length }
  } catch (err) {
    return { ok: false, match_count: 0, reason: err.message }
  }
}

export default function SelfHealing({ userId, language = 'en' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await api.get(`/api/extension/selector/health/${userId}`)
      setData(res)
    } catch (err) {
      console.error('selector health load failed', err)
      setError(err.message || 'Failed to load selector health')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const accept = async (proposalId) => {
    setActing(proposalId)
    try {
      await api.post(`/api/extension/selector/proposal/${userId}/${proposalId}/accept`)
      await load()
    } catch (err) {
      setError(err.message || 'Accept failed')
    } finally {
      setActing('')
    }
  }

  const reject = async (proposalId) => {
    setActing(proposalId)
    try {
      await api.post(`/api/extension/selector/proposal/${userId}/${proposalId}/reject`)
      await load()
    } catch (err) {
      setError(err.message || 'Reject failed')
    } finally {
      setActing('')
    }
  }

  const summary = data?.summary || {}
  const selectors = data?.selectors || {}
  const proposals = data?.proposals || []
  const probes = data?.recent_probes || []

  return (
    <div className="px-5 pt-6 animate-fade-in pb-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Selector health</h1>
          <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>
            Self-healing · auto-detect broken selectors + AI proposals
          </p>
        </div>
        <button className="btn btn-sm" onClick={load} disabled={loading}>↻</button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-xl text-sm" style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1, 2].map(i => <div key={i} className="queue-skeleton" />)}</div>
      ) : !data ? (
        <div className="text-center py-14 empty-state">
          <div style={{ fontSize: 40, marginBottom: 12 }}>🩺</div>
          <p className="text-base font-semibold">No selector data yet</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)', maxWidth: 280, margin: '6px auto 0' }}>
            Probes are recorded automatically as the extension runs actions.
          </p>
        </div>
      ) : (
        <>
          {/* ── Summary cards ───────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            <SummaryCard label="Healthy" value={summary.healthy || 0} color="#15803d" bg="#dcfce7" />
            <SummaryCard label="Degraded" value={summary.degraded || 0} color="#92400e" bg="#fef3c7" />
            <SummaryCard label="Broken" value={summary.broken || 0} color="#b91c1c" bg="#fee2e2" />
          </div>

          {/* ── Pending proposals ───────────────────────────────────────── */}
          {proposals.filter(p => p.status === 'pending').length > 0 && (
            <>
              <h2 className="text-sm font-bold mb-2" style={{ color: '#0f172a' }}>AI proposals (pending review)</h2>
              <div className="space-y-2 mb-4">
                {proposals.filter(p => p.status === 'pending').map(p => {
                  const preview = proposalPreview(p)
                  const previewBad = preview && (preview.match_count === 0 || preview.match_count > 3 || preview.ok === false)
                  return (
                  <div key={p.id} className="queue-card" style={{ borderLeft: previewBad ? '4px solid #b91c1c' : '4px solid #7c3aed' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold" style={{ color: '#7c3aed' }}>
                        {p.platform} · {p.action}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: '#ede9fe', color: '#6d28d9' }}>
                        confidence {p.confidence}%
                      </span>
                    </div>
                    <div className="mb-2">
                      <p className="text-[10px] uppercase font-semibold mb-0.5" style={{ color: '#94a3b8' }}>Old (broken)</p>
                      <code className="block text-[11px] px-2 py-1 rounded" style={{ background: '#fee2e2', color: '#b91c1c', wordBreak: 'break-all' }}>
                        {p.old_selector}
                      </code>
                    </div>
                    <div className="mb-2">
                      <p className="text-[10px] uppercase font-semibold mb-0.5" style={{ color: '#94a3b8' }}>Proposed new</p>
                      <code className="block text-[11px] px-2 py-1 rounded" style={{ background: '#ecfdf5', color: '#047857', wordBreak: 'break-all' }}>
                        {p.new_selector}
                      </code>
                    </div>
                    {preview && (
                      <div className="mb-2 px-2 py-1.5 rounded-lg text-[11px]" style={previewBad
                        ? { background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca' }
                        : { background: '#ecfdf5', color: '#047857', border: '1px solid #bbf7d0' }}>
                        Preview on saved HTML: <b>matches {preview.match_count}</b>
                        {preview.reason && <span> · {preview.reason}</span>}
                      </div>
                    )}
                    {p.reason && (
                      <p className="text-[11px] mb-2" style={{ color: '#64748b', fontStyle: 'italic' }}>{p.reason}</p>
                    )}
                    <div className="flex gap-2">
                      <button className="queue-btn-primary flex-1" onClick={() => accept(p.id)} disabled={acting === p.id}
                        style={{ background: '#047857', color: '#fff' }}>
                        {acting === p.id ? '...' : '✓ Accept'}
                      </button>
                      <button className="queue-btn-secondary flex-1" onClick={() => reject(p.id)} disabled={acting === p.id}
                        style={{ color: '#b91c1c', borderColor: '#fecaca' }}>
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            </>
          )}

          {/* ── Per-selector status ─────────────────────────────────────── */}
          <h2 className="text-sm font-bold mb-2" style={{ color: '#0f172a' }}>Selectors</h2>
          {Object.keys(selectors).length === 0 ? (
            <p className="text-xs mb-4" style={{ color: '#94a3b8' }}>No probes recorded yet.</p>
          ) : (
            <div className="space-y-1.5 mb-4">
              {Object.entries(selectors).map(([key, s]) => {
                const meta = STATUS_META[s.status] || STATUS_META.unknown
                return (
                  <div key={key} className="px-3 py-2 rounded-lg" style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold" style={{ color: '#0f172a' }}>{key}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <code className="block text-[11px] px-2 py-1 rounded mb-1" style={{ background: '#f8fafc', color: '#475569', wordBreak: 'break-all' }}>
                      {s.selector}
                    </code>
                    <div className="flex items-center justify-between text-[10px]" style={{ color: '#94a3b8' }}>
                      <span>fails: {s.consecutive_failures || 0}</span>
                      <span>last fail: {fmt(s.last_failure)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Recent probes ───────────────────────────────────────────── */}
          {probes.length > 0 && (
            <>
              <h2 className="text-sm font-bold mb-2" style={{ color: '#0f172a' }}>Recent probes</h2>
              <div className="space-y-1 mb-4">
                {probes.slice(-12).reverse().map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: p.found > 0 ? '#22c55e' : '#ef4444' }} />
                    <span style={{ color: '#475569', minWidth: 70 }}>{p.platform}·{p.action}</span>
                    <span style={{ color: p.found > 0 ? '#047857' : '#b91c1c' }}>{p.found} nodes</span>
                    <span style={{ color: '#94a3b8', marginLeft: 'auto' }}>{fmt(p.at)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color, bg }) {
  return (
    <div className="queue-card text-center" style={{ borderLeft: `4px solid ${color}` }}>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px] mt-0.5" style={{ color }}>{label}</p>
    </div>
  )
}
