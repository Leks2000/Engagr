import { useState, useEffect, useCallback } from 'react'
import { api } from '../App'
import Card from '../components/Card'

const IS_DEV = import.meta.env.DEV

const QUEUE_I18N = {
  en: {
    title: 'Queue',
    tabNew: 'New', tabReview: 'For Review',
    all: 'All', linkedin: 'LinkedIn', reddit: 'Reddit', x: 'X',
    emptyNewTitle: 'No new posts',
    emptyNewHint: 'Extension will scan LinkedIn / X / Reddit every 15 min when tabs are open.',
    emptyReviewTitle: 'Nothing to review',
    emptyReviewHint: 'New posts with AI variants will appear here.',
    refresh: 'Refresh', updating: 'Updating', last: 'Updated',
    approveAll: '✅ Approve All', skipAll: '❌ Skip All',
    simulate: '⚡ Simulate',
    editingComment: 'Editing comment', save: '💾 Save', cancel: 'Cancel',
    generateReply: '⚡ Generate AI reply',
    generating: 'Generating…',
    generateFailed: 'AI failed, try again',
  },
  ru: {
    title: 'Очередь',
    tabNew: 'Новые', tabReview: 'На проверке',
    all: 'Все', linkedin: 'LinkedIn', reddit: 'Reddit', x: 'X',
    emptyNewTitle: 'Нет новых постов',
    emptyNewHint: 'Расширение сканирует LinkedIn / X / Reddit каждые 15 мин, когда вкладки открыты.',
    emptyReviewTitle: 'Нечего проверять',
    emptyReviewHint: 'Новые посты с AI вариантами будут здесь.',
    refresh: 'Обновить', updating: 'Обновление', last: 'Обновлено',
    approveAll: '✅ Одобрить все', skipAll: '❌ Пропустить все',
    simulate: '⚡ Симуляция',
    editingComment: 'Редактирование', save: '💾 Сохранить', cancel: 'Отмена',
    generateReply: '⚡ Сгенерировать AI ответ',
    generating: 'Генерация…',
    generateFailed: 'AI ошибка, попробуйте ещё',
  },
  es: {
    title: 'Cola',
    tabNew: 'Nuevos', tabReview: 'Para revisar',
    all: 'Todos', linkedin: 'LinkedIn', reddit: 'Reddit', x: 'X',
    emptyNewTitle: 'Sin posts nuevos',
    emptyNewHint: 'La extensión escanea LinkedIn / X / Reddit cada 15 min cuando las pestañas están abiertas.',
    emptyReviewTitle: 'Nada para revisar',
    emptyReviewHint: 'Los posts nuevos con variantes de IA aparecerán aquí.',
    refresh: 'Actualizar', updating: 'Actualizando', last: 'Actualizado',
    approveAll: '✅ Aprobar todo', skipAll: '❌ Saltar todo',
    simulate: '⚡ Simular',
    editingComment: 'Editando', save: '💾 Guardar', cancel: 'Cancelar',
    generateReply: '⚡ Generar respuesta IA',
    generating: 'Generando…',
    generateFailed: 'Error IA, inténtalo de nuevo',
  },
  de: {
    title: 'Warteschlange',
    tabNew: 'Neu', tabReview: 'Zur Prüfung',
    all: 'Alle', linkedin: 'LinkedIn', reddit: 'Reddit', x: 'X',
    emptyNewTitle: 'Keine neuen Posts',
    emptyNewHint: 'Die Erweiterung scannt LinkedIn / X / Reddit alle 15 Min wenn Tabs offen sind.',
    emptyReviewTitle: 'Nichts zu prüfen',
    emptyReviewHint: 'Neue Posts mit KI-Varianten erscheinen hier.',
    refresh: 'Aktualisieren', updating: 'Aktualisiert', last: 'Zuletzt',
    approveAll: '✅ Alle genehmigen', skipAll: '❌ Alle überspringen',
    simulate: '⚡ Simulieren',
    editingComment: 'Bearbeiten', save: '💾 Speichern', cancel: 'Abbrechen',
    generateReply: '⚡ KI-Antwort generieren',
    generating: 'Generiere…',
    generateFailed: 'KI-Fehler, nochmal versuchen',
  },
}

// Simulated data — only visible in DEV mode (0.5)
function makeSimPost(idx) {
  const authors = ['Александр Иванов', 'Maria Schmidt', 'John Doe', 'Ayasha Redcloud', 'Lena Meyer']
  const texts = [
    'Building in public is the best marketing strategy for B2B SaaS founders. Transparency wins trust and customers.',
    'AI is not replacing developers, it is making us 10x more productive. The future is human+AI collaboration.',
    'The secret to PMF is talking to 100 customers before writing a single line of code.',
    'Cold email still works in 2025 if you personalize at scale. Here is my exact playbook...',
    'Just hit $50k MRR bootstrapped. Here are the 5 growth levers that actually moved the needle.',
  ]
  const platforms = ['linkedin', 'reddit', 'x']
  const now = new Date()
  return {
    id: `sim_${Date.now()}_${idx}`,
    platform: platforms[idx % platforms.length],
    author_name: authors[idx % authors.length],
    post_text: texts[idx % texts.length],
    post_excerpt: texts[idx % texts.length].slice(0, 120),
    post_url: 'https://www.linkedin.com/feed/update/sim',
    reactions_count: Math.floor(Math.random() * 120) + 5,
    comment_variants: [
      `Отличное наблюдение! Именно это мы видим в нашей практике. Полностью согласен.`,
      `Интересная точка зрения. Ключевой фактор здесь — долгосрочная стратегия.`,
      `Спасибо за инсайт! Было бы интересно обсудить детали.`,
    ],
    selected_comment: `Отличное наблюдение! Именно это мы видим в нашей практике.`,
    comment: `Отличное наблюдение!`,
    post_language: 'en',
    user_language: 'ru',
    status: 'pending',
    created_at: now.toISOString(),
    _simulated: true,
  }
}

const PLATFORM_FILTERS = ['all', 'linkedin', 'reddit', 'x']

export default function Queue({ userId, language = 'en' }) {
  // 0.2 — two main tabs: new_post vs pending
  const [tab, setTab] = useState('review')  // 'new' | 'review'
  const [platformFilter, setPlatformFilter] = useState('all')
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [simulating, setSimulating] = useState(false)
  // 0.3 — per-item AI generation state
  const [generatingIds, setGeneratingIds] = useState(new Set())
  const [generateErrors, setGenerateErrors] = useState({})

  const t = QUEUE_I18N[language] || QUEUE_I18N.en

  // Split by status
  const newPosts    = queue.filter(i => i.status === 'new_post')
  const pendingList = queue.filter(i => i.status === 'pending')

  const activeList = (tab === 'new' ? newPosts : pendingList)
    .filter(i => platformFilter === 'all' ? true : i.platform === platformFilter)

  // Per-platform counts for filter tabs
  const counts = (list) => ({
    all:      list.length,
    linkedin: list.filter(i => i.platform === 'linkedin').length,
    reddit:   list.filter(i => i.platform === 'reddit').length,
    x:        list.filter(i => i.platform === 'x').length,
  })
  const activeCounts = counts(tab === 'new' ? newPosts : pendingList)

  // ── Data loading ─────────────────────────────────────
  const loadQueue = useCallback(async () => {
    if (!loading) setRefreshing(true)
    try {
      // 0.1 — fetch new_post + pending together
      const data = await api.get(`/api/queue/${userId}?status=new_post,pending`)
      setQueue(prev => {
        // Keep local simulated items that haven't been removed
        const simItems = prev.filter(i => i._simulated)
        const realItems = Array.isArray(data) ? data : []
        const filtered = simItems.filter(s => !realItems.find(r => r.id === s.id))
        return [...realItems, ...filtered]
      })
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Failed to load queue:', err)
    }
    setLoading(false)
    setRefreshing(false)
  }, [userId])

  useEffect(() => {
    loadQueue()
    const interval = setInterval(loadQueue, 15000)
    return () => clearInterval(interval)
  }, [loadQueue])

  // ── 0.3 — Generate AI reply for new_post items ───────
  const handleGenerateReply = async (itemId) => {
    const item = queue.find(i => i.id === itemId)
    if (!item) return

    setGeneratingIds(prev => new Set(prev).add(itemId))
    setGenerateErrors(prev => ({ ...prev, [itemId]: null }))

    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/regenerate`)
      // After successful generation, backend sets status to pending
      // Reload to get updated item
      await loadQueue()
      // Switch to review tab so user sees the generated item
      setTab('review')
    } catch (err) {
      console.error('Generate AI reply error:', err)
      setGenerateErrors(prev => ({ ...prev, [itemId]: true }))
    } finally {
      setGeneratingIds(prev => {
        const next = new Set(prev)
        next.delete(itemId)
        return next
      })
    }
  }

  // ── Queue actions ─────────────────────────────────────
  const handleApprove = async (itemId) => {
    const item = queue.find(i => i.id === itemId)
    if (item?._simulated) { setQueue(q => q.filter(i => i.id !== itemId)); return }
    try {
      await api.post(`/api/queue/${userId}/${itemId}/approve`)
      setQueue(q => q.filter(i => i.id !== itemId))
    } catch (err) { console.error('Approve error:', err) }
  }

  const handleSkip = async (itemId) => {
    const item = queue.find(i => i.id === itemId)
    if (item?._simulated) { setQueue(q => q.filter(i => i.id !== itemId)); return }
    try {
      await api.post(`/api/queue/${userId}/${itemId}/skip`)
      setQueue(q => q.filter(i => i.id !== itemId))
    } catch (err) { console.error('Skip error:', err) }
  }

  const handleApproveAll = async () => {
    setBulkLoading(true)
    for (const item of [...activeList]) {
      if (item._simulated) { setQueue(q => q.filter(i => i.id !== item.id)); continue }
      try {
        await api.post(`/api/queue/${userId}/${item.id}/approve`)
        setQueue(q => q.filter(i => i.id !== item.id))
      } catch {}
    }
    setBulkLoading(false)
  }

  const handleSkipAll = async () => {
    setBulkLoading(true)
    for (const item of [...activeList]) {
      if (item._simulated) { setQueue(q => q.filter(i => i.id !== item.id)); continue }
      try {
        await api.post(`/api/queue/${userId}/${item.id}/skip`)
        setQueue(q => q.filter(i => i.id !== item.id))
      } catch {}
    }
    setBulkLoading(false)
  }

  const handleRegenerate = async (itemId) => {
    const item = queue.find(i => i.id === itemId)
    if (item?._simulated) {
      setQueue(q => q.map(i => i.id === itemId
        ? { ...i, comment: i.comment_variants[Math.floor(Math.random() * i.comment_variants.length)] }
        : i))
      return
    }
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/regenerate`)
      setQueue(q => q.map(i => i.id === itemId
        ? { ...i, comment: result.comment, selected_comment: result.comment }
        : i))
    } catch (err) { console.error('Regenerate error:', err) }
  }

  const handleSelectVariant = async (itemId, variantIndex) => {
    const item = queue.find(i => i.id === itemId)
    if (item?._simulated) {
      const variant = item.comment_variants[variantIndex]
      setQueue(q => q.map(i => i.id === itemId ? { ...i, selected_comment: variant, comment: variant } : i))
      return
    }
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/select`, { variant_index: variantIndex })
      setQueue(q => q.map(i => i.id === itemId
        ? { ...i, comment: result.comment, selected_comment: result.comment }
        : i))
    } catch (err) { console.error('Select variant error:', err) }
  }

  const handleEdit = (item) => { setEditingId(item.id); setEditText(item.selected_comment || item.comment) }

  const handleEditSave = async () => {
    if (!editingId || !editText.trim()) return
    const item = queue.find(i => i.id === editingId)
    if (item?._simulated) {
      setQueue(q => q.map(i => i.id === editingId
        ? { ...i, comment: editText.trim(), selected_comment: editText.trim() }
        : i))
      setEditingId(null); setEditText(''); return
    }
    try {
      await api.post(`/api/queue/${userId}/${editingId}/edit`, { comment: editText.trim() })
      setQueue(q => q.map(i => i.id === editingId
        ? { ...i, comment: editText.trim(), selected_comment: editText.trim() }
        : i))
      setEditingId(null); setEditText('')
    } catch (err) { console.error('Edit error:', err) }
  }

  const handleGenerateInvite = async (item) => {
    try {
      return await api.post(`/api/invite/${userId}/generate`, {
        author_name: item.author_name || item.author || '',
        post_text: item.post_text || item.post_excerpt || '',
        post_topic: '',
      })
    } catch {
      return { message: `Hi ${(item.author_name || 'there').split(' ')[0]}! Your post resonated with me. Let's connect!`, char_count: 60, variants: [] }
    }
  }

  // DEV simulate (0.5 — hidden in production)
  const handleSimulate = () => {
    if (!IS_DEV) return
    setSimulating(true)
    setTimeout(() => {
      setQueue(q => [...[0, 1, 2].map(i => makeSimPost(i)), ...q])
      setSimulating(false)
    }, 800)
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
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">🗂️ {t.title}</h1>
          <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>
            {refreshing ? `⏳ ${t.updating}…` : `${t.last}: ${lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Dev-only simulate button */}
          {IS_DEV && (
            <button
              className="text-xs px-2.5 py-1 rounded-lg font-medium"
              style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}
              onClick={handleSimulate}
              disabled={simulating}
            >
              {simulating ? '⏳' : t.simulate}
            </button>
          )}
          <button className="btn btn-sm" onClick={loadQueue} disabled={refreshing}>
            {refreshing ? '⏳' : '↻'} {t.refresh}
          </button>
        </div>
      </div>

      {/* 0.2 — Tab switcher: New / For Review */}
      <div className="flex gap-1 mb-3 p-1 rounded-xl" style={{ background: '#f1f5f9' }}>
        {[
          { key: 'new',    label: t.tabNew,    count: newPosts.length },
          { key: 'review', label: t.tabReview, count: pendingList.length },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            className="flex-1 text-sm font-medium py-1.5 rounded-lg transition-all"
            style={tab === key
              ? { background: '#fff', color: '#0f172a', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }
              : { color: '#64748b' }
            }
            onClick={() => setTab(key)}
          >
            {label}
            {count > 0 && (
              <span
                className="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  background: tab === key
                    ? (key === 'new' ? '#dbeafe' : '#dcfce7')
                    : '#e2e8f0',
                  color: tab === key
                    ? (key === 'new' ? '#1d4ed8' : '#15803d')
                    : '#94a3b8',
                }}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 0.4 — Platform filter: All / LinkedIn / Reddit / X */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-0.5">
        {PLATFORM_FILTERS.map(key => {
          const cnt = activeCounts[key]
          const labels = { all: t.all, linkedin: 'LinkedIn', reddit: 'Reddit', x: 'X' }
          const colors = {
            linkedin: { active: '#0A66C2', bg: '#eff6ff' },
            reddit:   { active: '#FF4500', bg: '#fff5f2' },
            x:        { active: '#000000', bg: '#f1f5f9' },
            all:      { active: '#6366f1', bg: '#eef2ff' },
          }
          const c = colors[key]
          const isActive = platformFilter === key
          return (
            <button
              key={key}
              onClick={() => setPlatformFilter(key)}
              className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all"
              style={isActive
                ? { background: c.active, color: '#fff', border: `1px solid ${c.active}` }
                : { background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0' }
              }
            >
              {labels[key]}{cnt > 0 ? ` (${cnt})` : ''}
            </button>
          )
        })}
      </div>

      {/* Bulk actions — only for review tab */}
      {tab === 'review' && activeList.length > 1 && (
        <div className="flex gap-2 mb-4">
          <button
            className="btn btn-sm flex-1"
            style={{ background: '#f0fdf4', color: '#15803d', borderColor: '#bbf7d0' }}
            onClick={handleApproveAll}
            disabled={bulkLoading}
          >
            {t.approveAll}
          </button>
          <button
            className="btn btn-sm flex-1"
            style={{ background: '#fff5f5', color: '#dc2626', borderColor: '#fecaca' }}
            onClick={handleSkipAll}
            disabled={bulkLoading}
          >
            {t.skipAll}
          </button>
        </div>
      )}

      {/* Empty state */}
      {activeList.length === 0 ? (
        <div className="text-center py-14 empty-state">
          <div className="empty-illu" style={{ fontSize: 38, marginBottom: 12 }}>
            {tab === 'new' ? '📡' : '🧾'}
          </div>
          <p className="text-base font-semibold mb-1">
            {tab === 'new' ? t.emptyNewTitle : t.emptyReviewTitle}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-muted)', maxWidth: 260, margin: '0 auto' }}>
            {tab === 'new' ? t.emptyNewHint : t.emptyReviewHint}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeList.map((item, i) => (
            <div key={item.id} className="animate-slide-up" style={{ animationDelay: `${i * 50}ms` }}>

              {/* 0.3 — new_post card with Generate button */}
              {item.status === 'new_post' ? (
                <NewPostCard
                  item={item}
                  onGenerate={() => handleGenerateReply(item.id)}
                  onSkip={() => handleSkip(item.id)}
                  isGenerating={generatingIds.has(item.id)}
                  hasError={!!generateErrors[item.id]}
                  t={t}
                />
              ) : editingId === item.id ? (
                <div className="queue-card" style={{ borderLeft: `3px solid ${platformColor(item.platform)}` }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`badge badge-${item.platform}`}>{item.platform}</span>
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.editingComment}</span>
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
                    <button className="btn btn-sm flex-1" onClick={handleEditSave}>{t.save}</button>
                    <button
                      className="btn btn-sm flex-1"
                      onClick={() => { setEditingId(null); setEditText('') }}
                      style={{ color: 'var(--color-muted)', borderColor: '#ddd' }}
                    >
                      {t.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <Card
                  item={item}
                  onApprove={() => handleApprove(item.id)}
                  onEdit={() => handleEdit(item)}
                  onSkip={() => handleSkip(item.id)}
                  onRegenerate={() => handleRegenerate(item.id)}
                  onSelectVariant={handleSelectVariant}
                  onGenerateInvite={handleGenerateInvite}
                  language={language}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Helper
function platformColor(platform) {
  if (platform === 'linkedin') return '#0A66C2'
  if (platform === 'reddit')   return '#FF4500'
  if (platform === 'x')        return '#000000'
  return '#6366f1'
}

// 0.3 — Card for new_post items (no AI yet)
function NewPostCard({ item, onGenerate, onSkip, isGenerating, hasError, t }) {
  const color = platformColor(item.platform)
  const author = item.author_name || item.author || 'Unknown'
  const initials = author.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  const platformLabel = { linkedin: 'LinkedIn', reddit: 'Reddit', x: 'X' }[item.platform] || item.platform

  return (
    <div className="queue-card" style={{ borderLeft: `4px solid ${color}`, opacity: 0.92 }}>
      {/* Header */}
      <div className="queue-card-header">
        <div className="queue-card-author">
          <div className="queue-card-avatar" style={{ background: color }}>{initials}</div>
          <div>
            <span className="queue-card-name">{author}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`badge badge-${item.platform}`}>{platformLabel}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}>
                new
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onSkip}
          className="text-xs text-gray-400 hover:text-red-400 transition-colors px-2 py-1"
          title="Skip"
        >
          ✕
        </button>
      </div>

      {/* Post text */}
      <div className="queue-card-excerpt mt-2">
        <p style={{ fontWeight: 600, marginBottom: 4, fontSize: 11, color: '#94a3b8' }}>Post</p>
        <p style={{ opacity: 0.9 }}>
          {(item.post_text || '').length > 280
            ? `${(item.post_text || '').slice(0, 280)}…`
            : item.post_text}
        </p>
      </div>

      {/* Generate button */}
      <div className="mt-3">
        {hasError && (
          <p className="text-xs mb-1.5" style={{ color: '#ef4444' }}>{t.generateFailed}</p>
        )}
        <button
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{
            background: isGenerating ? '#e2e8f0' : color,
            color: isGenerating ? '#94a3b8' : '#fff',
            opacity: isGenerating ? 0.7 : 1,
          }}
          onClick={onGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="spinner-sm" style={{ borderColor: '#94a3b8', borderTopColor: 'transparent' }} />
              {t.generating}
            </span>
          ) : t.generateReply}
        </button>
      </div>
    </div>
  )
}
