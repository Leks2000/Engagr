import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../App'
import Card from '../components/Card'

const STATUSES = ['all', 'new_post', 'pending', 'approved', 'executing', 'published', 'failed', 'skipped']
const PLATFORMS = ['all', 'x', 'reddit', 'linkedin']

const STATUS_META = {
  new_post:  { label: 'New post',        bg: '#dbeafe', color: '#1d4ed8' },
  pending:   { label: 'Pending review',  bg: '#fef3c7', color: '#92400e' },
  approved:  { label: 'Approved',        bg: '#dcfce7', color: '#15803d' },
  executing: { label: 'Executing',       bg: '#ede9fe', color: '#6d28d9' },
  published: { label: 'Published',       bg: '#ecfdf5', color: '#047857' },
  failed:    { label: 'Failed',          bg: '#fee2e2', color: '#b91c1c' },
  skipped:   { label: 'Skipped',         bg: '#f1f5f9', color: '#64748b' },
}

const PLATFORM_LABELS = { x: 'X', reddit: 'Reddit', linkedin: 'LinkedIn' }

function platformColor(platform) {
  if (platform === 'linkedin') return '#0A66C2'
  if (platform === 'reddit')   return '#FF4500'
  if (platform === 'x' || platform === 'twitter') return '#111827'
  return '#6366f1'
}

function formatDate(value) {
  if (!value) return '—'
  try { return new Date(value).toLocaleString() } catch { return value }
}

// ─── Feed Screen ────────────────────────────────────────────────
export default function Feed({ userId, language = 'en' }) {
  const [items, setItems]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [generatingIds, setGeneratingIds]   = useState(new Set())
  const [errorById, setErrorById]           = useState({})
  const [lastUpdated, setLastUpdated]       = useState(null)
  const [editingId, setEditingId]           = useState(null)
  const [editText, setEditText]             = useState('')
  // Track which items are "expanded" to show full Card in feed
  const [expandedIds, setExpandedIds]   = useState(new Set())
  const loadingRef = useRef(loading)
  loadingRef.current = loading
  // Track item IDs that are currently being mutated (generating/selecting/approving)
  // so background polling does NOT overwrite their in-flight local state.
  const pendingMutationsRef = useRef(new Set())

  const loadFeed = useCallback(async (force = false) => {
    if (!loadingRef.current) setRefreshing(true)
    try {
      const data = await api.get(`/api/queue/${userId}?status=all`)
      if (Array.isArray(data)) {
        setItems(current => {
          // Merge: keep local in-flight state for items currently being mutated
          const byId = Object.fromEntries(current.map(i => [i.id, i]))
          return data.map(serverItem => {
            const localItem = byId[serverItem.id]
            // If this item is being mutated locally, keep local version
            if (localItem && pendingMutationsRef.current.has(serverItem.id)) {
              return localItem
            }
            return serverItem
          })
        })
      }
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Failed to load feed:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId])

  useEffect(() => {
    loadFeed()
    const interval = setInterval(() => loadFeed(), 15000)
    return () => clearInterval(interval)
  }, [loadFeed])

  const counts = useMemo(() => {
    const byStatus   = Object.fromEntries(STATUSES.map(s  => [s,  s  === 'all' ? items.length : 0]))
    const byPlatform = Object.fromEntries(PLATFORMS.map(p => [p, p === 'all' ? items.length : 0]))
    for (const item of items) {
      if (byStatus[item.status]     !== undefined) byStatus[item.status]     += 1
      if (byPlatform[item.platform] !== undefined) byPlatform[item.platform] += 1
    }
    return { byStatus, byPlatform }
  }, [items])

  const visibleItems = items.filter(item => {
    const statusOk   = statusFilter   === 'all' || item.status   === statusFilter
    const platformOk = platformFilter === 'all' || item.platform === platformFilter
    return statusOk && platformOk
  })

  const patchItem = (itemId, updates) => {
    setItems(current => current.map(item => item.id === itemId ? { ...item, ...updates } : item))
  }

  // ── Generate variants for new_post ──────────────────────────
  const handleGenerateReply = async (itemId) => {
    setGeneratingIds(prev => new Set(prev).add(itemId))
    setErrorById(prev => ({ ...prev, [itemId]: '' }))
    // Lock this item against polling overwrites while mutation is in flight
    pendingMutationsRef.current.add(itemId)
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/regenerate`)
      const variants = result.variants || []
      const comment = result.comment || (variants.length > 0 ? variants[0] : '')
      patchItem(itemId, {
        status: 'pending',
        comment,
        selected_comment: comment,
        comment_variants: variants,
        post_language: result.post_language,
      })
      // Expand the card so user sees variants immediately
      setExpandedIds(prev => new Set(prev).add(itemId))
    } catch (err) {
      console.error('Generate reply failed:', err)
      setErrorById(prev => ({ ...prev, [itemId]: err.message || 'AI generation failed. Try again.' }))
    } finally {
      setGeneratingIds(prev => { const n = new Set(prev); n.delete(itemId); return n })
      // Release mutation lock after a short delay so UI renders before polling can overwrite
      setTimeout(() => pendingMutationsRef.current.delete(itemId), 3000)
    }
  }

  // ── Select variant ────────────────────────────────────────
  const handleSelectVariant = async (itemId, variantIndex) => {
    // Optimistic local update first — don't wait for server round-trip
    setItems(current => current.map(item => {
      if (item.id !== itemId) return item
      const variants = item.comment_variants || []
      const selected = variants[variantIndex] ?? item.selected_comment ?? item.comment ?? ''
      return { ...item, comment: selected, selected_comment: selected }
    }))
    pendingMutationsRef.current.add(itemId)
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/select`, { variant_index: variantIndex })
      // Confirm with server response (comment_variants preserved from local state)
      patchItem(itemId, { comment: result.comment, selected_comment: result.comment })
    } catch (err) {
      console.error('Select variant failed:', err)
      setErrorById(prev => ({ ...prev, [itemId]: 'Failed to select variant.' }))
    } finally {
      setTimeout(() => pendingMutationsRef.current.delete(itemId), 3000)
    }
  }

  // ── Approve ───────────────────────────────────────────────
  const handleApprove = async (itemId, actions = {}) => {
    pendingMutationsRef.current.add(itemId)
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/approve`, actions)
      patchItem(itemId, {
        status: result.status || 'approved',
        execution: result.execution || 'extension',
        action_chain: result.action_chain || [],
        approved_at: new Date().toISOString(),
      })
      // Collapse the card after approval
      setExpandedIds(prev => { const n = new Set(prev); n.delete(itemId); return n })
    } catch (err) {
      console.error('Approve failed:', err)
      setErrorById(prev => ({ ...prev, [itemId]: err.message || 'Approve failed' }))
    } finally {
      setTimeout(() => pendingMutationsRef.current.delete(itemId), 3000)
    }
  }

  // ── Skip ──────────────────────────────────────────────────
  const handleSkip = async (itemId) => {
    try {
      await api.post(`/api/queue/${userId}/${itemId}/skip`)
      patchItem(itemId, { status: 'skipped', skipped_at: new Date().toISOString() })
      setExpandedIds(prev => { const n = new Set(prev); n.delete(itemId); return n })
    } catch (err) {
      console.error('Skip failed:', err)
    }
  }

  // ── Regenerate ────────────────────────────────────────────
  const handleRegenerate = async (itemId) => {
    pendingMutationsRef.current.add(itemId)
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/regenerate`)
      const variants = result.variants || []
      const comment = result.comment || (variants.length > 0 ? variants[0] : '')
      patchItem(itemId, {
        status: 'pending',
        comment,
        selected_comment: comment,
        comment_variants: variants,
        post_language: result.post_language,
      })
    } catch (err) {
      console.error('Regenerate failed:', err)
      setErrorById(prev => ({ ...prev, [itemId]: 'Regenerate failed.' }))
    } finally {
      setTimeout(() => pendingMutationsRef.current.delete(itemId), 3000)
    }
  }

  // ── Edit ──────────────────────────────────────────────────
  const handleEdit = (item) => {
    setEditingId(item.id)
    setEditText(item.selected_comment || item.comment || '')
  }

  const handleEditSave = async () => {
    if (!editingId || !editText.trim()) return
    try {
      await api.post(`/api/queue/${userId}/${editingId}/edit`, { comment: editText.trim() })
      patchItem(editingId, { comment: editText.trim(), selected_comment: editText.trim() })
      setEditingId(null); setEditText('')
    } catch (err) {
      console.error('Edit failed:', err)
    }
  }

  // ── Loading skeleton ──────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-3 px-5 pt-6">
        {[1, 2, 3].map(i => <div key={i} className="queue-skeleton" />)}
      </div>
    )
  }

  const pendingCount = items.filter(i => i.status === 'pending' || i.status === 'new_post').length

  return (
    <div className="px-5 pt-6 animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Feed</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Unified post feed from X, Reddit, and LinkedIn. Select a variant and approve before the extension acts.
          </p>
          <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>
            {refreshing ? 'Updating…' : `Updated: ${lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}`}
          </p>
        </div>
        <button className="btn btn-sm" onClick={loadFeed} disabled={refreshing}>↻ Refresh</button>
      </div>

      {/* ── Action-needed banner ───────────────────────────────── */}
      {pendingCount > 0 && (
        <div className="mb-3 px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
          style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
          <span>⚡</span>
          <span>{pendingCount} post{pendingCount !== 1 ? 's' : ''} awaiting your approval</span>
        </div>
      )}

      {/* ── Status filter ──────────────────────────────────────── */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {STATUSES.map(status => {
          const meta   = status === 'all' ? { label: 'All', bg: '#eef2ff', color: '#4f46e5' } : STATUS_META[status]
          const active = statusFilter === status
          return (
            <button
              key={status}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all"
              style={active
                ? { background: meta.color, color: '#fff', border: `1px solid ${meta.color}` }
                : { background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }}
              onClick={() => setStatusFilter(status)}
            >
              {meta.label}{counts.byStatus[status] > 0 ? ` (${counts.byStatus[status]})` : ''}
            </button>
          )
        })}
      </div>

      {/* ── Platform filter ────────────────────────────────────── */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {PLATFORMS.map(platform => {
          const active = platformFilter === platform
          const color  = platform === 'all' ? '#6366f1' : platformColor(platform)
          return (
            <button
              key={platform}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all"
              style={active
                ? { background: color, color: '#fff', border: `1px solid ${color}` }
                : { background: '#fff', color: '#64748b', border: '1px solid #e2e8f0' }}
              onClick={() => setPlatformFilter(platform)}
            >
              {platform === 'all' ? 'All platforms' : PLATFORM_LABELS[platform]}
              {counts.byPlatform[platform] > 0 ? ` (${counts.byPlatform[platform]})` : ''}
            </button>
          )
        })}
      </div>

      {/* ── Empty state ────────────────────────────────────────── */}
      {visibleItems.length === 0 ? (
        <div className="text-center py-14 empty-state">
          <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
          <p className="text-base font-semibold mb-1">No posts in Feed</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)', maxWidth: 280, margin: '0 auto' }}>
            Open social tabs with the extension connected. New posts will appear here with their execution status.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleItems.map((item, index) => (
            <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${index * 35}ms` }}>

              {/* ── Edit inline overlay ─────────────────────────── */}
              {editingId === item.id ? (
                <div className="queue-card" style={{ borderLeft: `4px solid ${platformColor(item.platform)}` }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`badge badge-${item.platform}`}>{PLATFORM_LABELS[item.platform] || item.platform}</span>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Editing comment</span>
                  </div>
                  {item.post_text && (
                    <div className="queue-card-excerpt mb-3">
                      <p>{item.post_text.length > 200 ? `${item.post_text.slice(0, 200)}…` : item.post_text}</p>
                    </div>
                  )}
                  <textarea
                    className="w-full px-3 py-2 border rounded-lg text-sm outline-none resize-none"
                    style={{ borderColor: '#ddd', minHeight: 80 }}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    autoFocus
                  />
                  <div className="flex gap-2 mt-3">
                    <button className="btn btn-sm flex-1" onClick={handleEditSave}>💾 Save</button>
                    <button className="btn btn-sm flex-1"
                      style={{ color: 'var(--color-muted)', borderColor: '#ddd' }}
                      onClick={() => { setEditingId(null); setEditText('') }}>
                      Cancel
                    </button>
                  </div>
                </div>

              /* ── new_post: show compact card + Generate button ─ */
              ) : item.status === 'new_post' ? (
                <NewPostCard
                  item={item}
                  error={errorById[item.id]}
                  isGenerating={generatingIds.has(item.id)}
                  onGenerate={() => handleGenerateReply(item.id)}
                  onSkip={() => handleSkip(item.id)}
                />

              /* ── pending: show full Card with variants + Approve ─ */
              ) : item.status === 'pending' ? (
                <>
                  {errorById[item.id] && (
                    <p className="text-xs mb-2" style={{ color: 'var(--color-danger)' }}>{errorById[item.id]}</p>
                  )}
                  <Card
                    item={item}
                    onApprove={actions  => handleApprove(item.id, actions)}
                    onEdit={() => handleEdit(item)}
                    onSkip={() => handleSkip(item.id)}
                    onRegenerate={() => handleRegenerate(item.id)}
                    onSelectVariant={handleSelectVariant}
                    language={language}
                  />
                </>

              /* ── approved / executing / published / failed / skipped ─ */
              ) : (
                <StatusPostCard
                  item={item}
                  onSkip={item.status === 'failed' ? () => handleSkip(item.id) : undefined}
                  onRegenerate={item.status === 'failed' ? () => handleRegenerate(item.id) : undefined}
                  onExpand={() => setExpandedIds(prev => {
                    const n = new Set(prev)
                    n.has(item.id) ? n.delete(item.id) : n.add(item.id)
                    return n
                  })}
                  expanded={expandedIds.has(item.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── StatusBadge ────────────────────────────────────────────────
function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || 'Unknown', bg: '#f1f5f9', color: '#475569' }
  return (
    <span className="text-[10px] px-2 py-1 rounded-full font-semibold"
      style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  )
}

// ─── NewPostCard ─────────────────────────────────────────────────
// Shown for status=new_post items — compact with "Generate variants" CTA
function NewPostCard({ item, error, isGenerating, onGenerate, onSkip }) {
  const color  = platformColor(item.platform)
  const author = item.author_name || item.author || 'Unknown'
  const text   = item.post_text || item.post_excerpt || item.excerpt || ''
  const label  = PLATFORM_LABELS[item.platform] || item.platform || 'Platform'

  return (
    <div className="queue-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="queue-card-header">
        <div className="queue-card-author">
          <div className="queue-card-avatar" style={{ background: color }}>
            {author.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <span className="queue-card-name">{author}</span>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`badge badge-${item.platform}`}>{label}</span>
              <StatusBadge status="new_post" />
              <span className="text-[10px]" style={{ color: '#94a3b8' }}>{formatDate(item.created_at)}</span>
            </div>
          </div>
        </div>
        <button className="text-xs text-gray-400 hover:text-red-400 px-2 py-1" onClick={onSkip}>✕</button>
      </div>

      <div className="queue-card-excerpt mt-2">
        <p style={{ fontWeight: 600, marginBottom: 6, fontSize: 11, color: '#94a3b8' }}>Post</p>
        <p>{text.length > 300 ? `${text.slice(0, 300)}…` : text}</p>
      </div>

      {item.post_url && !item.post_url.includes('sim') && (
        <a
          href={item.post_url} target="_blank" rel="noopener noreferrer"
          className="queue-card-link text-xs" style={{ color }}>
          View post →
        </a>
      )}

      <div className="mt-3">
        {error && <p className="text-xs mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}
        <button
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{
            background: isGenerating ? '#e2e8f0' : color,
            color: isGenerating ? '#64748b' : '#fff',
            opacity: isGenerating ? 0.8 : 1,
          }}
          onClick={onGenerate}
          disabled={isGenerating}
        >
          {isGenerating
            ? <span className="flex items-center justify-center gap-2">
                <span className="spinner-sm" style={{ borderColor: '#94a3b8', borderTopColor: 'transparent' }} />
                Generating…
              </span>
            : '⚡ Generate reply variants'}
        </button>
      </div>
    </div>
  )
}

// ─── StatusPostCard ───────────────────────────────────────────────
// Shown for approved / executing / published / failed / skipped items
// Compact by default; expands to show comment details
function StatusPostCard({ item, onSkip, onRegenerate, onExpand, expanded }) {
  const color  = platformColor(item.platform)
  const author = item.author_name || item.author || 'Unknown'
  const text   = item.post_text || item.post_excerpt || item.excerpt || ''
  const label  = PLATFORM_LABELS[item.platform] || item.platform || 'Platform'
  const comment = item.selected_comment || item.comment || ''

  return (
    <div className="queue-card" style={{ borderLeft: `4px solid ${color}`, opacity: item.status === 'skipped' ? 0.65 : 1 }}>
      <div className="queue-card-header">
        <div className="queue-card-author">
          <div className="queue-card-avatar" style={{ background: color }}>
            {author.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <span className="queue-card-name">{author}</span>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`badge badge-${item.platform}`}>{label}</span>
              <StatusBadge status={item.status} />
              <span className="text-[10px]" style={{ color: '#94a3b8' }}>{formatDate(item.created_at)}</span>
            </div>
          </div>
        </div>
        <button
          className="text-xs px-2 py-1 rounded-lg"
          style={{ color: '#64748b', border: '1px solid #e2e8f0' }}
          onClick={onExpand}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <>
          <div className="queue-card-excerpt mt-2">
            <p style={{ fontWeight: 600, marginBottom: 6, fontSize: 11, color: '#94a3b8' }}>Post</p>
            <p>{text.length > 300 ? `${text.slice(0, 300)}…` : text}</p>
          </div>

          {comment && (
            <div className="queue-card-comment mt-2" style={{ borderColor: color, background: '#f8fafc' }}>
              <span className="queue-card-comment-icon">💬</span>
              <span>{comment}</span>
            </div>
          )}

          {item.post_url && !item.post_url.includes('sim') && (
            <a
              href={item.post_url} target="_blank" rel="noopener noreferrer"
              className="queue-card-link text-xs" style={{ color }}>
              View post →
            </a>
          )}

          {/* Actions for failed items */}
          {item.status === 'failed' && (
            <div className="flex gap-2 mt-3">
              {onRegenerate && (
                <button className="btn btn-sm flex-1" onClick={onRegenerate}>🔄 Retry</button>
              )}
              {onSkip && (
                <button className="btn btn-sm flex-1"
                  style={{ color: 'var(--color-muted)', borderColor: '#ddd' }}
                  onClick={onSkip}>
                  ✕ Dismiss
                </button>
              )}
            </div>
          )}

          {/* Timestamps */}
          <div className="mt-2 space-y-0.5">
            {item.approved_at && (
              <p className="text-[10px]" style={{ color: '#94a3b8' }}>
                Approved: {formatDate(item.approved_at)}
              </p>
            )}
            {item.published_at && (
              <p className="text-[10px]" style={{ color: '#94a3b8' }}>
                Published: {formatDate(item.published_at)}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
