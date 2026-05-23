import { useState, useEffect, useCallback } from 'react'
import { api } from '../App'
import Card from '../components/Card'

const QUEUE_I18N = {
  en: {
    title: 'Review Queue', pending: 'pending', emptyTitle: 'Nothing to review yet',
    emptyHint: 'Run a session from Dashboard to generate AI comments.',
    refresh: 'Refresh', updating: 'Updating', last: 'Updated',
    approveAll: '✅ Approve All', skipAll: '❌ Skip All', simulate: '⚡ Simulate',
    all: 'All', linkedin: 'LinkedIn', reddit: 'Reddit',
    editingComment: 'Editing comment', save: '💾 Save', cancel: 'Cancel',
  },
  ru: {
    title: 'Очередь', pending: 'ожидает', emptyTitle: 'Нет комментариев на проверку',
    emptyHint: 'Запустите сессию на главной, чтобы сгенерировать AI-комментарии.',
    refresh: 'Обновить', updating: 'Обновление', last: 'Обновлено',
    approveAll: '✅ Одобрить все', skipAll: '❌ Пропустить все', simulate: '⚡ Симуляция',
    all: 'Все', linkedin: 'LinkedIn', reddit: 'Reddit',
    editingComment: 'Редактирование', save: '💾 Сохранить', cancel: 'Отмена',
  },
  es: {
    title: 'Cola de revisión', pending: 'pendientes', emptyTitle: 'Nada para revisar',
    emptyHint: 'Ejecuta una sesión para generar comentarios de IA.',
    refresh: 'Actualizar', updating: 'Actualizando', last: 'Actualizado',
    approveAll: '✅ Aprobar todo', skipAll: '❌ Saltar todo', simulate: '⚡ Simular',
    all: 'Todos', linkedin: 'LinkedIn', reddit: 'Reddit',
    editingComment: 'Editando', save: '💾 Guardar', cancel: 'Cancelar',
  },
  de: {
    title: 'Prüfwarteschlange', pending: 'ausstehend', emptyTitle: 'Nichts zu prüfen',
    emptyHint: 'Starte eine Sitzung um KI-Kommentare zu erzeugen.',
    refresh: 'Aktualisieren', updating: 'Aktualisiert', last: 'Zuletzt',
    approveAll: '✅ Alle genehmigen', skipAll: '❌ Alle überspringen', simulate: '⚡ Simulieren',
    all: 'Alle', linkedin: 'LinkedIn', reddit: 'Reddit',
    editingComment: 'Bearbeiten', save: '💾 Speichern', cancel: 'Abbrechen',
  },
}

// Simulated log messages for demo/simulate mode
const SIM_LOGS = [
  '[{time}] 🔍 Поиск постов по ключевому слову #{kw}...',
  '[{time}] 📄 Найден пост от {author}. Анализируем контекст...',
  '[{time}] 🤖 Генерируем экспертный комментарий ({tone})...',
  '[{time}] ⏳ Добавлен случайный интервал задержки (3 мин)...',
  '[{time}] ✅ Комментарий добавлен в очередь на проверку.',
]

function makeSimPost(idx) {
  const authors = ['Александр Иванов', 'Maria Schmidt', 'John Doe', 'Ayasha Redcloud', 'Lena Meyer']
  const kws = ['saas', 'startup', 'ai', 'founder', 'product']
  const texts = [
    'Building in public is the best marketing strategy for B2B SaaS founders. Transparency wins trust and customers.',
    'AI is not replacing developers, it is making us 10x more productive. The future is human+AI collaboration.',
    'The secret to PMF is talking to 100 customers before writing a single line of code.',
    'Cold email still works in 2025 if you personalize at scale. Here is my exact playbook...',
    'Just hit $50k MRR bootstrapped. Here are the 5 growth levers that actually moved the needle.',
  ]
  const tones = ['expert', 'friendly', 'concise', 'intellectual', 'provocative']
  const now = new Date()
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return {
    id: `sim_${Date.now()}_${idx}`,
    platform: idx % 3 === 2 ? 'reddit' : 'linkedin',
    author_name: authors[idx % authors.length],
    post_text: texts[idx % texts.length],
    post_excerpt: texts[idx % texts.length].slice(0, 120),
    post_url: 'https://www.linkedin.com/feed/update/sim',
    reactions_count: Math.floor(Math.random() * 120) + 5,
    comment_variants: [
      `Отличное наблюдение! Именно это мы видим в нашей практике — ${texts[idx % texts.length].slice(0, 60)}... Полностью согласен с вашим подходом.`,
      `Интересная точка зрения. На мой взгляд, ключевой фактор здесь — это долгосрочная стратегия, а не тактические шаги.`,
      `Спасибо за инсайт! Мы как раз решаем похожую задачу в нашем проекте — было бы интересно обсудить детали.`,
    ],
    selected_comment: `Отличное наблюдение! Именно это мы видим в нашей практике. Полностью согласен с вашим подходом.`,
    comment: `Отличное наблюдение!`,
    post_language: 'en',
    user_language: 'ru',
    status: 'pending',
    created_at: now.toISOString(),
    _simulated: true,
  }
}

export default function Queue({ userId, language = 'en' }) {
  const [queue, setQueue] = useState([])
  const [platformFilter, setPlatformFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const t = QUEUE_I18N[language] || QUEUE_I18N.en
  const filteredQueue = queue.filter((item) => platformFilter === 'all' ? true : item.platform === platformFilter)
  const counts = {
    all: queue.length,
    linkedin: queue.filter((i) => i.platform === 'linkedin').length,
    reddit: queue.filter((i) => i.platform === 'reddit').length,
  }

  const loadQueue = useCallback(async () => {
    if (!loading) setRefreshing(true)
    try {
      const data = await api.get(`/api/queue/${userId}`)
      // Keep simulated items that haven't been approved/skipped
      setQueue(prev => {
        const simItems = prev.filter(i => i._simulated)
        const realItems = data || []
        const simIds = new Set(simItems.map(i => i.id))
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

  const handleApprove = async (itemId) => {
    const item = queue.find(i => i.id === itemId)
    if (item?._simulated) {
      setQueue(q => q.filter(i => i.id !== itemId))
      return
    }
    try {
      await api.post(`/api/queue/${userId}/${itemId}/approve`)
      setQueue(q => q.filter(item => item.id !== itemId))
    } catch (err) {
      console.error('Approve error:', err)
    }
  }

  const handleSkip = async (itemId) => {
    const item = queue.find(i => i.id === itemId)
    if (item?._simulated) {
      setQueue(q => q.filter(i => i.id !== itemId))
      return
    }
    try {
      await api.post(`/api/queue/${userId}/${itemId}/skip`)
      setQueue(q => q.filter(item => item.id !== itemId))
    } catch (err) {
      console.error('Skip error:', err)
    }
  }

  const handleApproveAll = async () => {
    setBulkLoading(true)
    const items = [...filteredQueue]
    for (const item of items) {
      if (item._simulated) {
        setQueue(q => q.filter(i => i.id !== item.id))
        continue
      }
      try {
        await api.post(`/api/queue/${userId}/${item.id}/approve`)
        setQueue(q => q.filter(i => i.id !== item.id))
      } catch {}
    }
    setBulkLoading(false)
  }

  const handleSkipAll = async () => {
    setBulkLoading(true)
    const items = [...filteredQueue]
    for (const item of items) {
      if (item._simulated) {
        setQueue(q => q.filter(i => i.id !== item.id))
        continue
      }
      try {
        await api.post(`/api/queue/${userId}/${item.id}/skip`)
        setQueue(q => q.filter(i => i.id !== item.id))
      } catch {}
    }
    setBulkLoading(false)
  }

  const handleSimulate = () => {
    setSimulating(true)
    const newItems = [0, 1, 2].map(i => makeSimPost(i))
    setTimeout(() => {
      setQueue(q => [...newItems, ...q])
      setSimulating(false)
    }, 800)
  }

  const handleRegenerate = async (itemId) => {
    const item = queue.find(i => i.id === itemId)
    if (item?._simulated) {
      // For simulated items, just cycle variants
      setQueue(q => q.map(i => i.id === itemId ? { ...i, comment: i.comment_variants[Math.floor(Math.random() * i.comment_variants.length)] } : i))
      return
    }
    try {
      const result = await api.post(`/api/queue/${userId}/${itemId}/regenerate`)
      setQueue(q => q.map(item =>
        item.id === itemId ? { ...item, comment: result.comment, selected_comment: result.comment } : item
      ))
    } catch (err) {
      console.error('Regenerate error:', err)
    }
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
      setQueue(q => q.map(item =>
        item.id === itemId ? { ...item, comment: result.comment, selected_comment: result.comment } : item
      ))
    } catch (err) {
      console.error('Select variant error:', err)
    }
  }

  const handleEdit = (item) => {
    setEditingId(item.id)
    setEditText(item.selected_comment || item.comment)
  }

  const handleEditSave = async () => {
    if (!editingId || !editText.trim()) return
    const item = queue.find(i => i.id === editingId)
    if (item?._simulated) {
      setQueue(q => q.map(i => i.id === editingId ? { ...i, comment: editText.trim(), selected_comment: editText.trim() } : i))
      setEditingId(null)
      setEditText('')
      return
    }
    try {
      await api.post(`/api/queue/${userId}/${editingId}/edit`, { comment: editText.trim() })
      setQueue(q => q.map(item =>
        item.id === editingId ? { ...item, comment: editText.trim(), selected_comment: editText.trim() } : item
      ))
      setEditingId(null)
      setEditText('')
    } catch (err) {
      console.error('Edit error:', err)
    }
  }

  const handleGenerateInvite = async (item) => {
    try {
      const result = await api.post(`/api/invite/${userId}/generate`, {
        author_name: item.author_name || item.author || '',
        post_text: item.post_text || item.post_excerpt || '',
        post_topic: '',
      })
      return result
    } catch (err) {
      console.error('Invite generation error:', err)
      return { message: `Hi ${(item.author_name || 'there').split(' ')[0]}! Your post resonated with me. Let's connect!`, char_count: 60, variants: [] }
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
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight queue-title-animate">🗂️ {t.title}</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {filteredQueue.length} {t.pending}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>
            {refreshing ? `⏳ ${t.updating}...` : `${t.last}: ${lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}`}
          </p>
        </div>
        <button className="btn btn-sm" onClick={loadQueue} disabled={refreshing}>
          {refreshing ? '⏳' : '↻'} {t.refresh}
        </button>
      </div>
      <div className="flex gap-2 mb-4">
        {[
          ['all', `All (${counts.all})`],
          ['linkedin', `LinkedIn (${counts.linkedin})`],
          ['reddit', `Reddit (${counts.reddit})`],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`queue-filter-btn animate-pop-in ${platformFilter === key ? `is-active is-${key}` : ''}`}
            onClick={() => setPlatformFilter(key)}
            style={{ animationDelay: key === 'all' ? '0ms' : key === 'linkedin' ? '60ms' : '120ms' }}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredQueue.length === 0 ? (
        <div className="text-center py-16 empty-state">
          <div className="empty-illu">🧾✨</div>
          <p className="text-base font-semibold mb-1">{t.emptyTitle}</p>
          <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>{t.emptyHint}</p>
          <button
            className="text-xs font-medium px-4 py-2 rounded-xl transition-all"
            style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}
            onClick={handleSimulate}
            disabled={simulating}
          >
            {simulating ? '⏳ Generating...' : t.simulate}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredQueue.map((item, i) => (
            <div
              key={item.id}
              className="animate-slide-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {editingId === item.id ? (
                <div className="queue-card" style={{ borderLeft: `3px solid ${item.platform === 'reddit' ? '#FF4500' : '#0A66C2'}` }}>
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
