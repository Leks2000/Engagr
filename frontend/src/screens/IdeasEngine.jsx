import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api, detectedLanguage } from '../App'

const TRANSLATIONS = {
  en: {
    title: 'Ideas Engine',
    subtitle: 'Content & comment ideas from trending topics',
    tabs: { all: 'All', forYou: 'For You', news: 'News', dev: 'Dev', launches: 'Launches' },
    refresh: 'Refresh',
    refreshing: 'Refreshing...',
    noIdeas: 'No ideas yet. Refresh to fetch trending topics.',
    commentAngle: 'Comment angle',
    contentIdea: 'Content idea',
    generateComment: 'Generate Comment',
    saveToQueue: 'Save to Queue',
    generating: 'Generating...',
    saved: 'Saved!',
    copyComment: 'Copy',
    copied: 'Copied!',
    openLink: 'Open',
    score: 'Score',
    source: 'Source',
    error: 'Failed to load ideas',
    stats: 'Stats',
    totalIdeas: 'Total ideas',
    highRelevance: 'High relevance',
    sources: 'Sources',
    selectPlatform: 'Platform',
  },
  ru: {
    title: 'Движок идей',
    subtitle: 'Идеи для контента и комментариев из трендов',
    tabs: { all: 'Все', forYou: 'Для вас', news: 'Новости', dev: 'Разработка', launches: 'Запуски' },
    refresh: 'Обновить',
    refreshing: 'Обновляю...',
    noIdeas: 'Пока нет идей. Обновите для загрузки трендов.',
    commentAngle: 'Угол комментария',
    contentIdea: 'Идея для контента',
    generateComment: 'Создать комментарий',
    saveToQueue: 'В очередь',
    generating: 'Генерирую...',
    saved: 'Сохранено!',
    copyComment: 'Копировать',
    copied: 'Скопировано!',
    openLink: 'Открыть',
    score: 'Счёт',
    source: 'Источник',
    error: 'Не удалось загрузить идеи',
    stats: 'Статистика',
    totalIdeas: 'Всего идей',
    highRelevance: 'Высокая релевантность',
    sources: 'Источники',
    selectPlatform: 'Платформа',
  },
  es: {
    title: 'Motor de Ideas',
    subtitle: 'Ideas de contenido y comentarios de tendencias',
    tabs: { all: 'Todas', forYou: 'Para ti', news: 'Noticias', dev: 'Dev', launches: 'Lanzamientos' },
    refresh: 'Actualizar',
    refreshing: 'Actualizando...',
    noIdeas: 'Sin ideas aún. Actualiza para cargar tendencias.',
    commentAngle: 'Ángulo de comentario',
    contentIdea: 'Idea de contenido',
    generateComment: 'Generar comentario',
    saveToQueue: 'Guardar en cola',
    generating: 'Generando...',
    saved: '¡Guardado!',
    copyComment: 'Copiar',
    copied: '¡Copiado!',
    openLink: 'Abrir',
    score: 'Puntuación',
    source: 'Fuente',
    error: 'Error al cargar ideas',
    stats: 'Estadísticas',
    totalIdeas: 'Total ideas',
    highRelevance: 'Alta relevancia',
    sources: 'Fuentes',
    selectPlatform: 'Plataforma',
  },
  de: {
    title: 'Ideen-Engine',
    subtitle: 'Content- und Kommentarideen aus Trends',
    tabs: { all: 'Alle', forYou: 'Für dich', news: 'News', dev: 'Dev', launches: 'Launches' },
    refresh: 'Aktualisieren',
    refreshing: 'Aktualisiere...',
    noIdeas: 'Keine Ideen. Aktualisieren um Trends zu laden.',
    commentAngle: 'Kommentarwinkel',
    contentIdea: 'Content-Idee',
    generateComment: 'Kommentar generieren',
    saveToQueue: 'In Warteschlange',
    generating: 'Generiere...',
    saved: 'Gespeichert!',
    copyComment: 'Kopieren',
    copied: 'Kopiert!',
    openLink: 'Öffnen',
    score: 'Punkte',
    source: 'Quelle',
    error: 'Fehler beim Laden der Ideen',
    stats: 'Statistik',
    totalIdeas: 'Ideen gesamt',
    highRelevance: 'Hohe Relevanz',
    sources: 'Quellen',
    selectPlatform: 'Plattform',
  },
}

const SOURCE_COLORS = {
  HackerNews: '#ff6600',
  TechCrunch: '#0a9e01',
  ProductHunt: '#da552f',
  'Dev.to': '#0a0a0a',
  GitHub: '#6e40c9',
  Reddit: '#ff4500',
}

const SOURCE_ICONS = {
  HackerNews: 'Y',
  TechCrunch: 'TC',
  ProductHunt: 'PH',
  'Dev.to': 'D',
  GitHub: 'GH',
  Reddit: 'R',
}

export default function IdeasEngine({ userId, language }) {
  const t = TRANSLATIONS[language] || TRANSLATIONS.en
  const [ideas, setIdeas] = useState([])
  const [activeTab, setActiveTab] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [generatingId, setGeneratingId] = useState(null)
  const [generatedComments, setGeneratedComments] = useState({})
  const [savedIds, setSavedIds] = useState(new Set())
  const [copiedId, setCopiedId] = useState(null)
  const [stats, setStats] = useState(null)
  const [platform, setPlatform] = useState('linkedin')

  const fetchIdeas = useCallback(async (refresh = false) => {
    try {
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError(null)

      const url = `/api/ideas/${userId}?limit=20${refresh ? '&refresh=1' : ''}`
      const data = await api.get(url)
      setIdeas(data.ideas || [])
    } catch (err) {
      console.error('Failed to fetch ideas:', err)
      setError(t.error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [userId, t.error])

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get(`/api/ideas/${userId}/stats`)
      setStats(data)
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }, [userId])

  useEffect(() => {
    fetchIdeas()
    fetchStats()
  }, [fetchIdeas, fetchStats])

  const handleGenerateComment = async (ideaId) => {
    setGeneratingId(ideaId)
    try {
      const data = await api.post(`/api/ideas/${userId}/generate-comment`, {
        idea_id: ideaId,
        platform,
      })
      setGeneratedComments(prev => ({
        ...prev,
        [ideaId]: data.variants || [],
      }))
    } catch (err) {
      console.error('Failed to generate comment:', err)
    } finally {
      setGeneratingId(null)
    }
  }

  const handleSaveToQueue = async (ideaId, comment) => {
    try {
      await api.post(`/api/ideas/${userId}/save-to-queue`, {
        idea_id: ideaId,
        comment,
        platform,
      })
      setSavedIds(prev => new Set([...prev, ideaId]))
    } catch (err) {
      console.error('Failed to save to queue:', err)
    }
  }

  const handleCopy = (text, ideaId) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(ideaId)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const filteredIdeas = ideas.filter(idea => {
    if (activeTab === 'all') return true
    if (activeTab === 'forYou') return idea.relevance >= 3
    if (activeTab === 'news') return ['HackerNews', 'TechCrunch'].includes(idea.source)
    if (activeTab === 'dev') return idea.source === 'Dev.to'
    if (activeTab === 'launches') return ['ProductHunt', 'GitHub'].includes(idea.source)
    return true
  })

  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{t.subtitle}</p>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="flex gap-3 mb-4 text-xs">
          <div className="px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">
            {stats.total_ideas} {t.totalIdeas?.toLowerCase?.() || 'ideas'}
          </div>
          <div className="px-2.5 py-1 bg-green-50 text-green-700 rounded-full font-medium">
            {stats.high_relevance} {t.highRelevance?.toLowerCase?.() || 'relevant'}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto no-scrollbar">
        {Object.entries(t.tabs).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-all ${
              activeTab === key
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Platform selector + Refresh */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{t.selectPlatform}:</span>
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            className="text-xs border rounded-md px-2 py-1 bg-white"
          >
            <option value="linkedin">LinkedIn</option>
            <option value="reddit">Reddit</option>
          </select>
        </div>
        <button
          onClick={() => fetchIdeas(true)}
          disabled={refreshing}
          className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full font-medium hover:bg-blue-100 disabled:opacity-50 transition-all"
        >
          {refreshing ? t.refreshing : t.refresh}
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="flex gap-1 mb-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-500" style={{
                animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`
              }} />
            ))}
          </div>
          <p className="text-xs text-gray-400">{t.refreshing}</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="text-center py-8">
          <p className="text-sm text-red-500">{error}</p>
          <button onClick={() => fetchIdeas(true)} className="mt-2 text-xs text-blue-600 underline">
            {t.refresh}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredIdeas.length === 0 && (
        <div className="text-center py-12">
          <div className="text-3xl mb-2">💡</div>
          <p className="text-sm text-gray-500">{t.noIdeas}</p>
        </div>
      )}

      {/* Ideas list */}
      {!loading && !error && (
        <div className="space-y-3">
          <AnimatePresence>
            {filteredIdeas.map((idea, index) => (
              <motion.div
                key={idea.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ delay: index * 0.03 }}
                className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm"
              >
                {/* Idea header */}
                <div className="flex items-start gap-2">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                    style={{ backgroundColor: SOURCE_COLORS[idea.source] || '#6b7280' }}
                  >
                    {SOURCE_ICONS[idea.source] || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3
                      className="text-sm font-medium leading-tight cursor-pointer hover:text-blue-700 transition-colors"
                      onClick={() => setExpandedId(expandedId === idea.id ? null : idea.id)}
                    >
                      {idea.title.length > 80 ? idea.title.slice(0, 80) + '...' : idea.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-400">{idea.source}</span>
                      {idea.score > 0 && (
                        <span className="text-[10px] text-gray-400">▲ {idea.score}</span>
                      )}
                      {idea.relevance >= 3 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-600 rounded-full">
                          relevant
                        </span>
                      )}
                    </div>
                  </div>
                  {idea.url && (
                    <a
                      href={idea.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-blue-500 flex-shrink-0"
                    >
                      {t.openLink} ↗
                    </a>
                  )}
                </div>

                {/* Expanded content */}
                <AnimatePresence>
                  {expandedId === idea.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 pt-3 border-t border-gray-50 space-y-2">
                        {/* Comment angle */}
                        <div className="bg-blue-50/50 rounded-lg p-2.5">
                          <p className="text-[10px] font-medium text-blue-700 mb-0.5">{t.commentAngle}</p>
                          <p className="text-xs text-gray-700">{idea.comment_angle}</p>
                        </div>

                        {/* Content idea */}
                        <div className="bg-purple-50/50 rounded-lg p-2.5">
                          <p className="text-[10px] font-medium text-purple-700 mb-0.5">{t.contentIdea}</p>
                          <p className="text-xs text-gray-700">{idea.content_idea}</p>
                        </div>

                        {/* Generate comment button */}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => handleGenerateComment(idea.id)}
                            disabled={generatingId === idea.id}
                            className="flex-1 text-xs py-2 px-3 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50 transition-all"
                          >
                            {generatingId === idea.id ? t.generating : t.generateComment}
                          </button>
                        </div>

                        {/* Generated comments */}
                        {generatedComments[idea.id] && generatedComments[idea.id].length > 0 && (
                          <div className="space-y-2 pt-1">
                            {generatedComments[idea.id].map((comment, ci) => (
                              <div key={ci} className="bg-gray-50 rounded-lg p-2.5 relative group">
                                <p className="text-xs text-gray-800 pr-14">{comment}</p>
                                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleCopy(comment, `${idea.id}-${ci}`)}
                                    className="text-[10px] px-2 py-1 bg-white border rounded shadow-sm hover:bg-gray-50"
                                  >
                                    {copiedId === `${idea.id}-${ci}` ? t.copied : t.copyComment}
                                  </button>
                                  <button
                                    onClick={() => handleSaveToQueue(idea.id, comment)}
                                    disabled={savedIds.has(idea.id)}
                                    className="text-[10px] px-2 py-1 bg-blue-600 text-white rounded shadow-sm hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {savedIds.has(idea.id) ? t.saved : t.saveToQueue}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
