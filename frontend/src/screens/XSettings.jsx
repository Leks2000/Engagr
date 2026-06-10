/**
 * XSettings.jsx — Step 10: X / Twitter screen
 *
 * Features:
 *  - Trend discovery with category tabs (All / Tech / AI / Startup / Crypto)
 *  - Inline reply generation → approval queue
 *  - Thread drafting for trending topics
 *  - X settings: keywords, tone, daily limits
 *  - Extension bridge status (X posting is manual via browser)
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api, userId } from '../App'

// ─────────────────────────────────────────────────────────────────
// i18n
// ─────────────────────────────────────────────────────────────────

const T = {
  en: {
    title: 'X / Twitter',
    subtitle: 'Trends · Replies · Threads',
    tabAll: 'All',
    tabTech: 'Tech',
    tabAI: 'AI',
    tabStartup: 'Startup',
    tabCrypto: 'Crypto',
    trending: 'Trending on X',
    refresh: 'Refresh',
    loading: 'Loading trends...',
    noTrends: 'No trends found. Refresh to try again.',
    generateReply: 'Generate Reply',
    draftThread: 'Draft Thread',
    savingToQueue: 'Saving...',
    savedToQueue: 'Saved to queue ✓',
    copyReply: 'Copy',
    copied: 'Copied!',
    variants: 'variants',
    commentAngle: 'Reply angle',
    contentIdea: 'Thread idea',
    settingsTitle: 'X Settings',
    keywordsLabel: 'Keywords',
    keywordsPlaceholder: 'AI, SaaS, startup...',
    toneLabel: 'Tone',
    toneProfessional: 'Professional',
    toneCasual: 'Casual',
    toneWitty: 'Witty',
    dailyLimitReplies: 'Max replies/day',
    dailyLimitThreads: 'Max threads/day',
    saveSettings: 'Save settings',
    settingsSaved: 'Saved ✓',
    replySection: 'Reply to a post',
    pasteUrl: 'Paste X post URL',
    pasteText: 'Paste post text',
    authorLabel: 'Author handle',
    generate: 'Generate AI reply',
    threadSection: 'Draft a thread',
    topicLabel: 'Topic',
    angleLabel: 'Angle',
    topicPlaceholder: 'e.g. LLM context windows',
    anglePlaceholder: 'e.g. Why most teams use them wrong',
    draftBtn: 'Draft thread',
    tweetLabel: 'Tweet',
    postManually: 'Post manually on X',
    stats: 'Your X stats',
    repliesGenerated: 'Replies generated',
    threadsDrafted: 'Threads drafted',
    itemsQueued: 'Items in queue',
    bridgeNote: 'Posting is manual — copy & paste on x.com',
    queueHint: 'Approved items appear in Queue screen',
  },
  ru: {
    title: 'X / Twitter',
    subtitle: 'Тренды · Ответы · Треды',
    tabAll: 'Все',
    tabTech: 'Техника',
    tabAI: 'ИИ',
    tabStartup: 'Стартапы',
    tabCrypto: 'Крипто',
    trending: 'Тренды X',
    refresh: 'Обновить',
    loading: 'Загрузка трендов...',
    noTrends: 'Тренды не найдены. Обновите страницу.',
    generateReply: 'Сгенерировать ответ',
    draftThread: 'Написать тред',
    savingToQueue: 'Сохранение...',
    savedToQueue: 'Сохранено в очередь ✓',
    copyReply: 'Копировать',
    copied: 'Скопировано!',
    variants: 'вариантов',
    commentAngle: 'Угол для ответа',
    contentIdea: 'Идея треда',
    settingsTitle: 'Настройки X',
    keywordsLabel: 'Ключевые слова',
    keywordsPlaceholder: 'ИИ, SaaS, стартап...',
    toneLabel: 'Тон',
    toneProfessional: 'Профессиональный',
    toneCasual: 'Неформальный',
    toneWitty: 'Остроумный',
    dailyLimitReplies: 'Макс. ответов/день',
    dailyLimitThreads: 'Макс. тредов/день',
    saveSettings: 'Сохранить настройки',
    settingsSaved: 'Сохранено ✓',
    replySection: 'Ответить на пост',
    pasteUrl: 'Вставьте URL поста X',
    pasteText: 'Вставьте текст поста',
    authorLabel: 'Аккаунт автора',
    generate: 'Сгенерировать ответ',
    threadSection: 'Написать тред',
    topicLabel: 'Тема',
    angleLabel: 'Угол',
    topicPlaceholder: 'Например: контекстные окна LLM',
    anglePlaceholder: 'Например: почему большинство команд используют их неправильно',
    draftBtn: 'Написать тред',
    tweetLabel: 'Твит',
    postManually: 'Опубликовать вручную на X',
    stats: 'Статистика X',
    repliesGenerated: 'Ответов сгенерировано',
    threadsDrafted: 'Тредов написано',
    itemsQueued: 'В очереди',
    bridgeNote: 'Публикация вручную — скопируй и вставь на x.com',
    queueHint: 'Одобренные элементы появятся на экране Очереди',
  },
}

const getT = (lang) => T[lang] || T.en

// ─────────────────────────────────────────────────────────────────
// Source badge colours
// ─────────────────────────────────────────────────────────────────

const SOURCE_COLORS = {
  x_api: { bg: '#000', text: '#fff', label: 'X API' },
  x_public: { bg: '#1a1a2e', text: '#fff', label: 'X Public' },
  x_curated: { bg: '#1d9bf0', text: '#fff', label: 'X Trending' },
}

const CATEGORY_COLORS = {
  ai: '#7c3aed',
  tech: '#0ea5e9',
  startup: '#10b981',
  crypto: '#f59e0b',
  all: '#6b7280',
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function SourceBadge({ sourceKey }) {
  const c = SOURCE_COLORS[sourceKey] || SOURCE_COLORS.x_curated
  return (
    <span style={{
      background: c.bg, color: c.text,
      fontSize: 10, fontWeight: 700, padding: '2px 7px',
      borderRadius: 99, letterSpacing: 0.3,
    }}>
      {c.label}
    </span>
  )
}

function CategoryTag({ category }) {
  const color = CATEGORY_COLORS[category] || CATEGORY_COLORS.all
  return (
    <span style={{
      background: `${color}22`, color,
      fontSize: 10, fontWeight: 600, padding: '2px 7px',
      borderRadius: 99,
    }}>
      {category?.toUpperCase()}
    </span>
  )
}

function XIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.26 5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────
// Trend card
// ─────────────────────────────────────────────────────────────────

function TrendCard({ trend, language, onSaveToQueue }) {
  const t = getT(language)
  const [expanded, setExpanded] = useState(false)
  const [replyState, setReplyState] = useState(null) // null | 'loading' | {variants, selected}
  const [threadState, setThreadState] = useState(null) // null | 'loading' | {tweets}
  const [savedReply, setSavedReply] = useState(false)
  const [savedThread, setSavedThread] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savingReply, setSavingReply] = useState(false)
  const [savingThread, setSavingThread] = useState(false)

  const handleGenerateReply = async () => {
    setReplyState('loading')
    try {
      const result = await api.post(`/api/x/${userId}/generate-reply`, {
        post_text: trend.comment_angle || trend.title,
        post_author: '',
        post_url: trend.url,
        language,
      })
      setReplyState({
        variants: result.variants || [result.selected_comment],
        selected: result.selected_comment || result.variants?.[0] || '',
      })
    } catch (err) {
      setReplyState({ error: err.message })
    }
  }

  const handleDraftThread = async () => {
    setThreadState('loading')
    try {
      const result = await api.post(`/api/x/${userId}/generate-thread`, {
        topic: trend.title,
        angle: trend.content_idea || trend.comment_angle || `My take on ${trend.title}`,
        language,
        tweet_count: 5,
      })
      setThreadState({ tweets: result.tweets || [] })
    } catch (err) {
      setThreadState({ error: err.message })
    }
  }

  const handleSaveReply = async () => {
    if (!replyState?.selected) return
    setSavingReply(true)
    try {
      await onSaveToQueue({
        type: 'reply',
        post_text: trend.comment_angle || trend.title,
        post_author: '',
        post_url: trend.url,
        comment: replyState.selected,
        topic: trend.title,
      })
      setSavedReply(true)
    } catch { /* ignore */ }
    setSavingReply(false)
  }

  const handleSaveThread = async () => {
    if (!threadState?.tweets?.length) return
    setSavingThread(true)
    try {
      await onSaveToQueue({
        type: 'thread',
        topic: trend.title,
        tweets: threadState.tweets,
      })
      setSavedThread(true)
    } catch { /* ignore */ }
    setSavingThread(false)
  }

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 14,
        padding: '14px 16px',
        marginBottom: 10,
        cursor: 'pointer',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
            <SourceBadge sourceKey={trend.source_key} />
            <CategoryTag category={trend.category} />
            {trend.relevant && (
              <span style={{
                background: '#10b98122', color: '#10b981',
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
              }}>★ For You</span>
            )}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111', marginBottom: 2 }}>
            {trend.title}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Score: {trend.relevance || trend.score}
          </div>
        </div>
        <div style={{ color: '#9ca3af', fontSize: 18, marginLeft: 4 }}>
          {expanded ? '▲' : '▼'}
        </div>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f3f4f6' }}>

              {/* Angles */}
              {trend.comment_angle && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 3 }}>
                    💬 {t.commentAngle}
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                    {trend.comment_angle}
                  </div>
                </div>
              )}
              {trend.content_idea && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 3 }}>
                    🧵 {t.contentIdea}
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                    {trend.content_idea}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={handleGenerateReply}
                  disabled={replyState === 'loading'}
                  style={{
                    background: replyState && replyState !== 'loading' ? '#e0f2fe' : '#1d9bf0',
                    color: replyState && replyState !== 'loading' ? '#0ea5e9' : '#fff',
                    border: 'none', borderRadius: 8,
                    padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {replyState === 'loading' ? '...' : `💬 ${t.generateReply}`}
                </button>
                <button
                  onClick={handleDraftThread}
                  disabled={threadState === 'loading'}
                  style={{
                    background: threadState && threadState !== 'loading' ? '#f3e8ff' : '#7c3aed',
                    color: threadState && threadState !== 'loading' ? '#7c3aed' : '#fff',
                    border: 'none', borderRadius: 8,
                    padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {threadState === 'loading' ? '...' : `🧵 ${t.draftThread}`}
                </button>
                <a
                  href={trend.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    background: '#f3f4f6', color: '#374151',
                    borderRadius: 8, padding: '7px 14px',
                    fontSize: 12, fontWeight: 600, textDecoration: 'none',
                  }}
                  onClick={e => e.stopPropagation()}
                >
                  🔗 Open
                </a>
              </div>

              {/* Reply result */}
              {replyState && replyState !== 'loading' && !replyState.error && (
                <div style={{
                  background: '#f0f9ff', border: '1px solid #bae6fd',
                  borderRadius: 10, padding: 12, marginBottom: 10,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0ea5e9', marginBottom: 6 }}>
                    💬 AI Reply
                    {replyState.variants?.length > 1 && (
                      <span style={{ color: '#6b7280', fontWeight: 400, marginLeft: 6 }}>
                        {replyState.variants.length} {t.variants}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.5, marginBottom: 8 }}>
                    {replyState.selected}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleCopy(replyState.selected)}
                      style={{
                        background: '#0ea5e9', color: '#fff',
                        border: 'none', borderRadius: 7, padding: '6px 12px',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {copied ? t.copied : `📋 ${t.copyReply}`}
                    </button>
                    <button
                      onClick={handleSaveReply}
                      disabled={savingReply || savedReply}
                      style={{
                        background: savedReply ? '#d1fae5' : '#10b981',
                        color: savedReply ? '#059669' : '#fff',
                        border: 'none', borderRadius: 7, padding: '6px 12px',
                        fontSize: 11, fontWeight: 600, cursor: savedReply ? 'default' : 'pointer',
                      }}
                    >
                      {savingReply ? t.savingToQueue : savedReply ? t.savedToQueue : '→ Queue'}
                    </button>
                  </div>
                </div>
              )}

              {/* Thread result */}
              {threadState && threadState !== 'loading' && !threadState.error && (
                <div style={{
                  background: '#faf5ff', border: '1px solid #e9d5ff',
                  borderRadius: 10, padding: 12, marginBottom: 10,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 8 }}>
                    🧵 Thread draft
                  </div>
                  {threadState.tweets.map((tweet, i) => (
                    <div key={i} style={{
                      background: '#fff', borderRadius: 8, padding: '8px 10px',
                      marginBottom: 6, fontSize: 12, color: '#1f2937', lineHeight: 1.5,
                      border: '1px solid #f3e8ff',
                    }}>
                      <span style={{ fontSize: 10, color: '#9ca3af', marginRight: 6 }}>
                        {t.tweetLabel} {i + 1}/{threadState.tweets.length}
                      </span>
                      {tweet}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => handleCopy(threadState.tweets.join('\n\n---\n\n'))}
                      style={{
                        background: '#7c3aed', color: '#fff',
                        border: 'none', borderRadius: 7, padding: '6px 12px',
                        fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {copied ? t.copied : `📋 ${t.copyReply}`}
                    </button>
                    <button
                      onClick={handleSaveThread}
                      disabled={savingThread || savedThread}
                      style={{
                        background: savedThread ? '#d1fae5' : '#10b981',
                        color: savedThread ? '#059669' : '#fff',
                        border: 'none', borderRadius: 7, padding: '6px 12px',
                        fontSize: 11, fontWeight: 600, cursor: savedThread ? 'default' : 'pointer',
                      }}
                    >
                      {savingThread ? t.savingToQueue : savedThread ? t.savedToQueue : '→ Queue'}
                    </button>
                  </div>
                </div>
              )}

              {(replyState?.error || threadState?.error) && (
                <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>
                  {replyState?.error || threadState?.error}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────

const TABS = ['all', 'tech', 'ai', 'startup', 'crypto']

export default function XSettings({ language = 'en' }) {
  const t = getT(language)

  // Trends state
  const [tab, setTab] = useState('all')
  const [trends, setTrends] = useState([])
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)

  // Stats
  const [stats, setStats] = useState(null)

  // Settings
  const [xSettings, setXSettings] = useState({
    keywords: [],
    tone: 'professional',
    daily_limit_replies: 10,
    daily_limit_threads: 3,
    auto_scan: true,
    connected: false,
    handle: '',
  })
  const [kwInput, setKwInput] = useState('')
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)

  // Manual reply
  const [replyUrl, setReplyUrl] = useState('')
  const [replyText, setReplyText] = useState('')
  const [replyAuthor, setReplyAuthor] = useState('')
  const [replyResult, setReplyResult] = useState(null)
  const [replyLoading, setReplyLoading] = useState(false)
  const [replyCopied, setReplyCopied] = useState(false)

  // Thread section
  const [threadTopic, setThreadTopic] = useState('')
  const [threadAngle, setThreadAngle] = useState('')
  const [threadResult, setThreadResult] = useState(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadCopied, setThreadCopied] = useState(false)

  // Active section
  const [activeSection, setActiveSection] = useState('trends') // trends | reply | thread | settings

  const loadTrends = useCallback(async (refresh = false) => {
    setLoading(true)
    try {
      const data = await api.get(`/api/x/${userId}/trends?limit=25${refresh ? '&refresh=1' : ''}`)
      setTrends(data.trends || [])
      setLastRefresh(new Date())
    } catch (err) {
      console.error('X trends error:', err)
    }
    setLoading(false)
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const data = await api.get(`/api/x/${userId}/stats`)
      setStats(data)
    } catch { /* ignore */ }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const data = await api.get(`/api/x/${userId}/settings`)
      setXSettings(prev => ({ ...prev, ...data }))
      setKwInput((data.keywords || []).join(', '))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadTrends()
    loadStats()
    loadSettings()
  }, [loadTrends, loadStats, loadSettings])

  const filteredTrends = tab === 'all'
    ? trends
    : trends.filter(t => t.category === tab)

  const handleSaveToQueue = async (payload) => {
    await api.post(`/api/x/${userId}/save-to-queue`, payload)
    loadStats()
  }

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    try {
      const keywords = kwInput.split(/[,\n]+/).map(k => k.trim()).filter(Boolean)
      await api.put(`/api/x/${userId}/settings`, { ...xSettings, keywords })
      setXSettings(prev => ({ ...prev, keywords }))
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } catch { /* ignore */ }
    setSavingSettings(false)
  }

  const handleGenerateManualReply = async () => {
    if (!replyText) return
    setReplyLoading(true)
    setReplyResult(null)
    try {
      const result = await api.post(`/api/x/${userId}/generate-reply`, {
        post_text: replyText,
        post_author: replyAuthor,
        post_url: replyUrl,
        language,
      })
      setReplyResult(result)
    } catch (err) {
      setReplyResult({ error: err.message })
    }
    setReplyLoading(false)
  }

  const handleGenerateThread = async () => {
    if (!threadTopic) return
    setThreadLoading(true)
    setThreadResult(null)
    try {
      const result = await api.post(`/api/x/${userId}/generate-thread`, {
        topic: threadTopic,
        angle: threadAngle,
        language,
        tweet_count: 5,
      })
      setThreadResult(result)
    } catch (err) {
      setThreadResult({ error: err.message })
    }
    setThreadLoading(false)
  }

  const handleCopyManualReply = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setReplyCopied(true)
      setTimeout(() => setReplyCopied(false), 1500)
    })
  }

  const handleCopyThread = (tweets) => {
    navigator.clipboard.writeText(tweets.join('\n\n---\n\n')).then(() => {
      setThreadCopied(true)
      setTimeout(() => setThreadCopied(false), 1500)
    })
  }

  const sectionBtnStyle = (active) => ({
    background: active ? '#000' : '#f3f4f6',
    color: active ? '#fff' : '#374151',
    border: 'none', borderRadius: 10,
    padding: '8px 14px', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.15s',
  })

  return (
    <div style={{ padding: '16px 16px 32px', maxWidth: 480, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff',
        }}>
          <XIcon size={20} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#111' }}>{t.title}</h1>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>{t.subtitle}</p>
        </div>
      </div>

      {/* Bridge note */}
      <div style={{
        background: '#fffbeb', border: '1px solid #fde68a',
        borderRadius: 10, padding: '8px 12px', marginTop: 10, marginBottom: 16,
        fontSize: 12, color: '#92400e',
      }}>
        ⚠️ {t.bridgeNote}. {t.queueHint}.
      </div>

      {/* Stats bar */}
      {stats && (
        <div style={{
          display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap',
        }}>
          {[
            { label: t.repliesGenerated, value: stats.replies_generated },
            { label: t.threadsDrafted, value: stats.threads_drafted },
            { label: t.itemsQueued, value: stats.items_queued },
          ].map(({ label, value }) => (
            <div key={label} style={{
              flex: '1 1 80px', background: '#fff', border: '1px solid #e5e7eb',
              borderRadius: 10, padding: '8px 10px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#111' }}>{value || 0}</div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Section switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'trends', label: '🔥 Trends' },
          { id: 'reply', label: '💬 Reply' },
          { id: 'thread', label: '🧵 Thread' },
          { id: 'settings', label: '⚙️ Settings' },
        ].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)} style={sectionBtnStyle(activeSection === s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ─── TRENDS SECTION ─── */}
      {activeSection === 'trends' && (
        <>
          {/* Tab filter */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
            {TABS.map(tabId => (
              <button
                key={tabId}
                onClick={() => setTab(tabId)}
                style={{
                  background: tab === tabId ? '#000' : '#f3f4f6',
                  color: tab === tabId ? '#fff' : '#374151',
                  border: 'none', borderRadius: 20,
                  padding: '5px 14px', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {t[`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`] || tabId}
              </button>
            ))}
            <button
              onClick={() => loadTrends(true)}
              disabled={loading}
              style={{
                background: '#f3f4f6', color: '#374151',
                border: 'none', borderRadius: 20,
                padding: '5px 14px', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', marginLeft: 'auto',
              }}
            >
              {loading ? '...' : `↻ ${t.refresh}`}
            </button>
          </div>

          {loading && (
            <div style={{ textAlign: 'center', color: '#6b7280', padding: 32, fontSize: 14 }}>
              {t.loading}
            </div>
          )}

          {!loading && filteredTrends.length === 0 && (
            <div style={{ textAlign: 'center', color: '#6b7280', padding: 32, fontSize: 14 }}>
              {t.noTrends}
            </div>
          )}

          <AnimatePresence>
            {filteredTrends.map(trend => (
              <TrendCard
                key={trend.id}
                trend={trend}
                language={language}
                onSaveToQueue={handleSaveToQueue}
              />
            ))}
          </AnimatePresence>
        </>
      )}

      {/* ─── REPLY SECTION ─── */}
      {activeSection === 'reply' && (
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 12 }}>
            💬 {t.replySection}
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <input
              placeholder={t.pasteUrl}
              value={replyUrl}
              onChange={e => setReplyUrl(e.target.value)}
              style={{
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px',
                fontSize: 13, outline: 'none', background: '#fff', color: '#111',
              }}
            />
            <input
              placeholder={t.authorLabel}
              value={replyAuthor}
              onChange={e => setReplyAuthor(e.target.value)}
              style={{
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px',
                fontSize: 13, outline: 'none', background: '#fff', color: '#111',
              }}
            />
            <textarea
              placeholder={t.pasteText}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              rows={4}
              style={{
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px',
                fontSize: 13, outline: 'none', background: '#fff', color: '#111',
                resize: 'vertical', fontFamily: 'inherit',
              }}
            />
          </div>

          <button
            onClick={handleGenerateManualReply}
            disabled={!replyText || replyLoading}
            style={{
              background: replyText && !replyLoading ? '#1d9bf0' : '#e5e7eb',
              color: replyText && !replyLoading ? '#fff' : '#9ca3af',
              border: 'none', borderRadius: 10, padding: '10px 20px',
              fontSize: 14, fontWeight: 700, cursor: replyText ? 'pointer' : 'default',
              width: '100%', marginBottom: 12,
            }}
          >
            {replyLoading ? '...' : `💬 ${t.generate}`}
          </button>

          {replyResult && !replyResult.error && (
            <div style={{
              background: '#f0f9ff', border: '1px solid #bae6fd',
              borderRadius: 10, padding: 14,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#0ea5e9', marginBottom: 8 }}>AI Reply</div>
              <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.6, marginBottom: 10 }}>
                {replyResult.selected_comment || replyResult.variants?.[0]}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleCopyManualReply(replyResult.selected_comment || replyResult.variants?.[0])}
                  style={{
                    background: '#1d9bf0', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {replyCopied ? t.copied : `📋 ${t.copyReply}`}
                </button>
                <button
                  onClick={() => handleSaveToQueue({
                    type: 'reply',
                    post_text: replyText,
                    post_author: replyAuthor,
                    post_url: replyUrl,
                    comment: replyResult.selected_comment || replyResult.variants?.[0],
                  })}
                  style={{
                    background: '#10b981', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  → Queue
                </button>
              </div>
            </div>
          )}
          {replyResult?.error && (
            <div style={{ fontSize: 12, color: '#ef4444' }}>{replyResult.error}</div>
          )}
        </div>
      )}

      {/* ─── THREAD SECTION ─── */}
      {activeSection === 'thread' && (
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 12 }}>
            🧵 {t.threadSection}
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <input
              placeholder={t.topicPlaceholder}
              value={threadTopic}
              onChange={e => setThreadTopic(e.target.value)}
              style={{
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px',
                fontSize: 13, outline: 'none', background: '#fff', color: '#111',
              }}
            />
            <input
              placeholder={t.anglePlaceholder}
              value={threadAngle}
              onChange={e => setThreadAngle(e.target.value)}
              style={{
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px',
                fontSize: 13, outline: 'none', background: '#fff', color: '#111',
              }}
            />
          </div>

          <button
            onClick={handleGenerateThread}
            disabled={!threadTopic || threadLoading}
            style={{
              background: threadTopic && !threadLoading ? '#7c3aed' : '#e5e7eb',
              color: threadTopic && !threadLoading ? '#fff' : '#9ca3af',
              border: 'none', borderRadius: 10, padding: '10px 20px',
              fontSize: 14, fontWeight: 700, cursor: threadTopic ? 'pointer' : 'default',
              width: '100%', marginBottom: 12,
            }}
          >
            {threadLoading ? '...' : `🧵 ${t.draftBtn}`}
          </button>

          {threadResult && !threadResult.error && (
            <div style={{
              background: '#faf5ff', border: '1px solid #e9d5ff',
              borderRadius: 10, padding: 14,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 10 }}>
                Thread: {threadResult.topic}
              </div>
              {threadResult.tweets?.map((tweet, i) => (
                <div key={i} style={{
                  background: '#fff', borderRadius: 8, padding: '8px 10px',
                  marginBottom: 6, fontSize: 12, color: '#1f2937', lineHeight: 1.5,
                  border: '1px solid #f3e8ff',
                }}>
                  <span style={{ fontSize: 10, color: '#9ca3af', marginRight: 6 }}>
                    {t.tweetLabel} {i + 1}/{threadResult.tweets.length}
                  </span>
                  {tweet}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => handleCopyThread(threadResult.tweets)}
                  style={{
                    background: '#7c3aed', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {threadCopied ? t.copied : `📋 ${t.copyReply}`}
                </button>
                <button
                  onClick={() => handleSaveToQueue({
                    type: 'thread',
                    topic: threadTopic,
                    tweets: threadResult.tweets,
                  })}
                  style={{
                    background: '#10b981', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  → Queue
                </button>
              </div>
            </div>
          )}
          {threadResult?.error && (
            <div style={{ fontSize: 12, color: '#ef4444' }}>{threadResult.error}</div>
          )}
        </div>
      )}

      {/* ─── SETTINGS SECTION ─── */}
      {activeSection === 'settings' && (
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 14 }}>
            ⚙️ {t.settingsTitle}
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Handle */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                @handle
              </label>
              <input
                placeholder="@yourhandle"
                value={xSettings.handle || ''}
                onChange={e => setXSettings(p => ({ ...p, handle: e.target.value }))}
                style={{
                  width: '100%', border: '1px solid #e5e7eb', borderRadius: 8,
                  padding: '9px 12px', fontSize: 13, outline: 'none',
                  background: '#fff', color: '#111', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Keywords */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                🔑 {t.keywordsLabel}
              </label>
              <textarea
                placeholder={t.keywordsPlaceholder}
                value={kwInput}
                onChange={e => setKwInput(e.target.value)}
                rows={2}
                style={{
                  width: '100%', border: '1px solid #e5e7eb', borderRadius: 8,
                  padding: '9px 12px', fontSize: 13, outline: 'none',
                  background: '#fff', color: '#111', resize: 'none',
                  fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Tone */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
                🎭 {t.toneLabel}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['professional', 'casual', 'witty'].map(tone => (
                  <button
                    key={tone}
                    onClick={() => setXSettings(p => ({ ...p, tone }))}
                    style={{
                      flex: 1, background: xSettings.tone === tone ? '#111' : '#f3f4f6',
                      color: xSettings.tone === tone ? '#fff' : '#374151',
                      border: 'none', borderRadius: 8, padding: '8px 10px',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {tone === 'professional' ? t.toneProfessional : tone === 'casual' ? t.toneCasual : t.toneWitty}
                  </button>
                ))}
              </div>
            </div>

            {/* Daily limits */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  💬 {t.dailyLimitReplies}
                </label>
                <input
                  type="number" min={0} max={50}
                  value={xSettings.daily_limit_replies || 10}
                  onChange={e => setXSettings(p => ({ ...p, daily_limit_replies: Number(e.target.value) }))}
                  style={{
                    width: '100%', border: '1px solid #e5e7eb', borderRadius: 8,
                    padding: '9px 12px', fontSize: 13, outline: 'none',
                    background: '#fff', color: '#111', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  🧵 {t.dailyLimitThreads}
                </label>
                <input
                  type="number" min={0} max={10}
                  value={xSettings.daily_limit_threads || 3}
                  onChange={e => setXSettings(p => ({ ...p, daily_limit_threads: Number(e.target.value) }))}
                  style={{
                    width: '100%', border: '1px solid #e5e7eb', borderRadius: 8,
                    padding: '9px 12px', fontSize: 13, outline: 'none',
                    background: '#fff', color: '#111', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              style={{
                background: settingsSaved ? '#10b981' : '#111',
                color: '#fff', border: 'none', borderRadius: 10,
                padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                width: '100%',
              }}
            >
              {settingsSaved ? t.settingsSaved : savingSettings ? '...' : t.saveSettings}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
