import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../App'
import Card from '../components/Card'

const STATUSES = ['all', 'new_post', 'pending', 'approved', 'executing', 'published', 'failed', 'skipped']
const PLATFORMS = ['all', 'x', 'reddit', 'linkedin']

const STATUS_META = {
  new_post: { label: 'New post', bg: '#dbeafe', color: '#1d4ed8' },
  pending: { label: 'Pending review', bg: '#fef3c7', color: '#92400e' },
  approved: { label: 'Approved', bg: '#dcfce7', color: '#15803d' },
  executing: { label: 'Executing', bg: '#ede9fe', color: '#6d28d9' },
  published: { label: 'Published', bg: '#ecfdf5', color: '#047857' },
  failed: { label: 'Failed', bg: '#fee2e2', color: '#b91c1c' },
  skipped: { label: 'Skipped', bg: '#f1f5f9', color: '#64748b' },
}

const PLATFORM_LABELS = { x: 'X', reddit: 'Reddit', linkedin: 'LinkedIn' }

function platformColor(platform) {
  if (platform === 'linkedin') return '#0A66C2'
  if (platform === 'reddit') return '#FF4500'
  if (platform === 'x' || platform === 'twitter') return '#111827'
  return '#6366f1'
}

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export default function Feed({ userId, language = 'en' }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [generatingIds, setGeneratingIds] = useState(new Set())
  const [errorById, setErrorById] = useState({})
  const [lastUpdated, setLastUpdated] = useState(null)

  const loadFeed = useCallback(async () => {
    if (!loading) setRefreshing(true)
    try {
      const data = await api.get(`/api/queue/${userId}?status=all`)
      setItems(Array.isArray(data) ? data : [])
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Failed to load feed:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [loading, userId])

  useEffect(() => {
    loadFeed()
    const interval = setInterval(loadFeed, 15000)
    return () => clearInterval(interval)
  }, [loadFeed])

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(STATUSES.map(status => [status, status === 'all' ? items.length : 0]))
    const byPlatform = Object.fromEntries(PLATFORMS.map(platform => [platform, platform === 'all' ? items.length : 0]))
    for (const item of items) {
      if (byStatus[item.status] !== undefined) byStatus[item.status] += 1
      if (byPlatform[item.platform] !== undefined) byPlatform[item.platform] += 1
    }
    return { byStatus, byPlatform }
  }, [items])

  const visibleItems = items.filter(item => {
    const statusOk = statusFilter === 'all' || item.status === statusFilter
    const platformOk = platformFilter === 'all' || item.platform === platformFilter
    return statusOk && platformOk
  })

  const patchItem = (itemId, updates) => {
    setItems(current => current.map(item => item.id === itemId ? { ...item, ...updates } : item))
  }

  const handleGenerateReply = async (itemId) => {
    setGeneratingIds(prev => new Set(prev).add(itemId))
    setErrorById(prev => ({ ...prev, [itemId]: '' }))
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/regenerate`)
      patchItem(itemId, {
        status: 'pending',
        comment: result.comment,
        selected_comment: result.comment,
        comment_variants: result.variants || [],
        post_language: result.post_language,
      })
    } catch (err) {
      console.error('Generate reply failed:', err)
      setErrorById(prev => ({ ...prev, [itemId]: 'AI generation failed. Try again.' }))
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }

  const handleSelectVariant = async (itemId, variantIndex) => {
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/select`, { variant_index: variantIndex })
      patchItem(itemId, { comment: result.comment, selected_comment: result.comment })
    } catch (err) {
      console.error('Select variant failed:', err)
    }
  }

  const handleApprove = async (itemId, actions = {}) => {
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/approve`, actions)
      patchItem(itemId, {
        status: 'approved',
        execution: result.execution || 'extension',
        action_chain: result.action_chain || [],
        approved_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('Approve failed:', err)
      setErrorById(prev => ({ ...prev, [itemId]: err.message || 'Approve failed' }))
    }
  }

  const handleSkip = async (itemId) => {
    try {
      await api.post(`/api/queue/${userId}/${itemId}/skip`)
      patchItem(itemId, { status: 'skipped', skipped_at: new Date().toISOString() })
    } catch (err) {
      console.error('Skip failed:', err)
    }
  }

  const handleRegenerate = async (itemId) => {
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/regenerate`)
      patchItem(itemId, {
        comment: result.comment,
        selected_comment: result.comment,
        comment_variants: result.variants || [],
      })
    } catch (err) {
      console.error('Regenerate failed:', err)
    }
  }

  const handleEdit = async (item) => {
    const current = item.selected_comment || item.comment || ''
    const next = window.prompt('Edit selected comment before approval:', current)
    if (!next || next.trim() === current.trim()) return
    try {
      await api.post(`/api/queue/${userId}/${item.id}/edit`, { comment: next.trim() })
      patchItem(item.id, { comment: next.trim(), selected_comment: next.trim() })
    } catch (err) {
      console.error('Edit failed:', err)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 px-5 pt-6">
        {[1, 2, 3].map(i => <div key={i} className="queue-skeleton" />)}
      </div>
    )
  }

  return (
    <div className="px-5 pt-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Feed</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            Unified post feed from X, Reddit, and LinkedIn. Choose a variant and approve before the extension acts.
          </p>
          <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>
            {refreshing ? 'Updating…' : `Updated: ${lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}`}
          </p>
        </div>
        <button className="btn btn-sm" onClick={loadFeed} disabled={refreshing}>↻ Refresh</button>
      </div>

      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        {STATUSES.map(status => {
          const meta = status === 'all' ? { label: 'All', bg: '#eef2ff', color: '#4f46e5' } : STATUS_META[status]
          const active = statusFilter === status
          return (
            <button
              key={status}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all"
              style={active ? { background: meta.color, color: '#fff', border: `1px solid ${meta.color}` } : { background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }}
              onClick={() => setStatusFilter(status)}
            >
              {meta.label}{counts.byStatus[status] ? ` (${counts.byStatus[status]})` : ''}
            </button>
          )
        })}
      </div>

      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {PLATFORMS.map(platform => {
          const active = platformFilter === platform
          const color = platform === 'all' ? '#6366f1' : platformColor(platform)
          return (
            <button
              key={platform}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all"
              style={active ? { background: color, color: '#fff', border: `1px solid ${color}` } : { background: '#fff', color: '#64748b', border: '1px solid #e2e8f0' }}
              onClick={() => setPlatformFilter(platform)}
            >
              {platform === 'all' ? 'All platforms' : PLATFORM_LABELS[platform]}{counts.byPlatform[platform] ? ` (${counts.byPlatform[platform]})` : ''}
            </button>
          )
        })}
      </div>

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
              {item.status === 'pending' ? (
                <>
                  {errorById[item.id] && <p className="text-xs mb-2" style={{ color: 'var(--color-danger)' }}>{errorById[item.id]}</p>}
                  <Card
                    item={item}
                    onApprove={(actions) => handleApprove(item.id, actions)}
                    onEdit={() => handleEdit(item)}
                    onSkip={() => handleSkip(item.id)}
                    onRegenerate={() => handleRegenerate(item.id)}
                    onSelectVariant={handleSelectVariant}
                    language={language}
                  />
                </>
              ) : (
                <FeedPostCard
                  item={item}
                  error={errorById[item.id]}
                  isGenerating={generatingIds.has(item.id)}
                  onGenerate={() => handleGenerateReply(item.id)}
                  onSkip={() => handleSkip(item.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || 'Unknown', bg: '#f1f5f9', color: '#475569' }
  return (
    <span className="text-[10px] px-2 py-1 rounded-full font-semibold" style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  )
}

function FeedPostCard({ item, error, isGenerating, onGenerate, onSkip }) {
  const color = platformColor(item.platform)
  const author = item.author_name || item.author || 'Unknown'
  const text = item.post_text || item.post_excerpt || item.excerpt || ''
  const variants = item.comment_variants || []
  const selected = item.selected_comment || item.comment || ''
  const platformLabel = PLATFORM_LABELS[item.platform] || item.platform || 'Platform'

  return (
    <div className="queue-card" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="queue-card-header">
        <div className="queue-card-author">
          <div className="queue-card-avatar" style={{ background: color }}>{author.slice(0, 2).toUpperCase()}</div>
          <div>
            <span className="queue-card-name">{author}</span>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`badge badge-${item.platform}`}>{platformLabel}</span>
              <StatusBadge status={item.status} />
              <span className="text-[10px]" style={{ color: '#94a3b8' }}>{formatDate(item.created_at)}</span>
            </div>
          </div>
        </div>
        {item.status === 'new_post' && <button className="text-xs text-gray-400 hover:text-red-400 px-2 py-1" onClick={onSkip}>✕</button>}
      </div>

      <div className="queue-card-excerpt mt-2">
        <p style={{ fontWeight: 600, marginBottom: 6 }}>Post</p>
        <p>{text.length > 360 ? `${text.slice(0, 360)}…` : text}</p>
      </div>

      {variants.length > 0 && (
        <div className="queue-card-variants">
          <div className="queue-card-variants-label"><span>Generated reply variants</span></div>
          {variants.map((variant, idx) => (
            <div key={`${item.id}-${idx}`} className={`queue-card-variant ${selected === variant ? 'selected' : ''}`}>
              <span className="text-[11px] font-semibold" style={{ color }}>{`Variant ${idx + 1}`}</span>
              <span className="queue-card-variant-text">{variant}</span>
            </div>
          ))}
        </div>
      )}

      {selected && variants.length === 0 && (
        <div className="queue-card-comment" style={{ borderColor: color, background: '#f8fafc' }}>
          <span className="queue-card-comment-icon">💬</span>
          <span>{selected}</span>
        </div>
      )}

      {item.status === 'new_post' && (
        <div className="mt-3">
          {error && <p className="text-xs mb-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}
          <button className="w-full py-2.5 rounded-xl text-sm font-semibold" style={{ background: isGenerating ? '#e2e8f0' : color, color: isGenerating ? '#64748b' : '#fff' }} onClick={onGenerate} disabled={isGenerating}>
            {isGenerating ? 'Generating…' : 'Generate variants'}
          </button>
        </div>
      )}
    </div>
  )
}
