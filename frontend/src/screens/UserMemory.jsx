import { useState, useEffect, useCallback } from 'react'
import { api } from '../App'
import TagInput from '../components/TagInput'

const I18N = {
  en: {
    title: 'My Profile',
    subtitle: 'Personalize AI comments with your context',
    projectName: 'Project / Product name',
    projectNameHint: 'e.g. Engagr, MyStartup',
    projectDesc: 'What does it do? (1-2 sentences)',
    projectDescHint: 'e.g. AI-powered LinkedIn engagement automation',
    audience: 'Target audience',
    audienceHint: 'e.g. SaaS founders, indie hackers, growth marketers',
    goals: 'Engagement goals',
    goalsHint: 'e.g. Build thought leadership, get beta users, network with founders',
    uniqueValue: 'Your unique expertise / value',
    uniqueValueHint: 'e.g. 10 years in ML, built 3 startups to exit',
    expertise: 'Expertise areas',
    expertiseHint: 'Add topics you know well',
    toneKeywords: 'Comment style keywords',
    toneKeywordsHint: 'e.g. witty, data-driven, concise',
    avoidTopics: 'Avoid mentioning',
    avoidTopicsHint: 'Topics or words to never include',
    personalContext: 'Personal note for AI',
    personalContextHint: 'Any extra context that helps generate better comments',
    commentStyle: 'Comment style notes',
    commentStyleHint: 'e.g. Always add a question at the end, prefer short sentences',
    save: 'Save Profile',
    saving: 'Saving...',
    saved: 'Profile saved!',
    clear: 'Reset',
    clearConfirm: 'Reset all profile data?',
    configured: 'Configured',
    notConfigured: 'Not configured yet',
    howItWorks: 'How it works',
    howItWorksText: 'Your profile context is injected into AI prompts when generating comments. The AI will write as someone with your expertise and goals, without explicitly mentioning your product.',
  },
  ru: {
    title: 'Мой профиль',
    subtitle: 'Персонализируйте AI-комментарии вашим контекстом',
    projectName: 'Проект / Продукт',
    projectNameHint: 'напр. Engagr, MyStartup',
    projectDesc: 'Что он делает? (1-2 предложения)',
    projectDescHint: 'напр. AI-автоматизация LinkedIn-вовлечения',
    audience: 'Целевая аудитория',
    audienceHint: 'напр. SaaS-фаундеры, инди-хакеры, growth-маркетологи',
    goals: 'Цели вовлечения',
    goalsHint: 'напр. Стать thought leader, найти бета-юзеров',
    uniqueValue: 'Ваша уникальная экспертиза',
    uniqueValueHint: 'напр. 10 лет в ML, 3 стартапа до exit',
    expertise: 'Области экспертизы',
    expertiseHint: 'Темы, в которых вы разбираетесь',
    toneKeywords: 'Стиль комментариев',
    toneKeywordsHint: 'напр. остроумный, аналитичный, краткий',
    avoidTopics: 'Не упоминать',
    avoidTopicsHint: 'Темы или слова, которые не использовать',
    personalContext: 'Заметка для AI',
    personalContextHint: 'Дополнительный контекст для лучших комментариев',
    commentStyle: 'Заметки о стиле',
    commentStyleHint: 'напр. Всегда добавлять вопрос в конце',
    save: 'Сохранить профиль',
    saving: 'Сохранение...',
    saved: 'Профиль сохранён!',
    clear: 'Сбросить',
    clearConfirm: 'Сбросить все данные профиля?',
    configured: 'Настроен',
    notConfigured: 'Ещё не настроен',
    howItWorks: 'Как это работает',
    howItWorksText: 'Контекст профиля добавляется в AI-промпты при генерации комментариев. AI будет писать как человек с вашей экспертизой и целями, не упоминая продукт напрямую.',
  },
  es: {
    title: 'Mi Perfil',
    subtitle: 'Personaliza comentarios de IA con tu contexto',
    projectName: 'Proyecto / Producto',
    projectNameHint: 'ej. Engagr, MiStartup',
    projectDesc: 'Que hace? (1-2 oraciones)',
    projectDescHint: 'ej. Automatizacion de engagement en LinkedIn con IA',
    audience: 'Audiencia objetivo',
    audienceHint: 'ej. Fundadores SaaS, indie hackers',
    goals: 'Objetivos de engagement',
    goalsHint: 'ej. Construir liderazgo, conseguir beta users',
    uniqueValue: 'Tu expertise unica',
    uniqueValueHint: 'ej. 10 anos en ML, 3 startups',
    expertise: 'Areas de expertise',
    expertiseHint: 'Temas que dominas',
    toneKeywords: 'Estilo de comentarios',
    toneKeywordsHint: 'ej. ingenioso, basado en datos',
    avoidTopics: 'No mencionar',
    avoidTopicsHint: 'Temas a evitar',
    personalContext: 'Nota personal para IA',
    personalContextHint: 'Contexto extra para mejores comentarios',
    commentStyle: 'Notas de estilo',
    commentStyleHint: 'ej. Siempre terminar con pregunta',
    save: 'Guardar',
    saving: 'Guardando...',
    saved: 'Guardado!',
    clear: 'Resetear',
    clearConfirm: 'Resetear todos los datos del perfil?',
    configured: 'Configurado',
    notConfigured: 'No configurado',
    howItWorks: 'Como funciona',
    howItWorksText: 'Tu perfil se inyecta en los prompts de IA al generar comentarios. La IA escribira como alguien con tu expertise sin mencionar tu producto.',
  },
  de: {
    title: 'Mein Profil',
    subtitle: 'KI-Kommentare mit deinem Kontext personalisieren',
    projectName: 'Projekt / Produkt',
    projectNameHint: 'z.B. Engagr, MeinStartup',
    projectDesc: 'Was macht es? (1-2 Satze)',
    projectDescHint: 'z.B. KI-gesteuerte LinkedIn-Engagement-Automatisierung',
    audience: 'Zielgruppe',
    audienceHint: 'z.B. SaaS-Grunder, Indie-Hacker',
    goals: 'Engagement-Ziele',
    goalsHint: 'z.B. Thought Leadership aufbauen, Beta-User finden',
    uniqueValue: 'Deine Expertise',
    uniqueValueHint: 'z.B. 10 Jahre ML, 3 Startups',
    expertise: 'Expertenbereiche',
    expertiseHint: 'Themen, die du gut kennst',
    toneKeywords: 'Kommentar-Stil',
    toneKeywordsHint: 'z.B. witzig, datenbasiert, kurz',
    avoidTopics: 'Nicht erwahnen',
    avoidTopicsHint: 'Themen die vermieden werden sollen',
    personalContext: 'Personliche Notiz fur KI',
    personalContextHint: 'Extra Kontext fur bessere Kommentare',
    commentStyle: 'Stil-Hinweise',
    commentStyleHint: 'z.B. Immer mit Frage enden',
    save: 'Speichern',
    saving: 'Speichert...',
    saved: 'Gespeichert!',
    clear: 'Zurucksetzen',
    clearConfirm: 'Alle Profildaten zurucksetzen?',
    configured: 'Konfiguriert',
    notConfigured: 'Noch nicht konfiguriert',
    howItWorks: 'So funktioniert es',
    howItWorksText: 'Dein Profilkontext wird in KI-Prompts injiziert. Die KI schreibt als jemand mit deiner Expertise, ohne dein Produkt direkt zu nennen.',
  },
}

export default function UserMemory({ userId, language = 'en' }) {
  const t = I18N[language] || I18N.en

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)

  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [goals, setGoals] = useState('')
  const [uniqueValue, setUniqueValue] = useState('')
  const [expertiseAreas, setExpertiseAreas] = useState([])
  const [toneKeywords, setToneKeywords] = useState([])
  const [avoidTopics, setAvoidTopics] = useState([])
  const [personalContext, setPersonalContext] = useState('')
  const [commentStyleNotes, setCommentStyleNotes] = useState('')

  const loadMemory = useCallback(async () => {
    try {
      const data = await api.get(`/api/user-memory/${userId}`)
      setProjectName(data.project_name || '')
      setProjectDescription(data.project_description || '')
      setTargetAudience(data.target_audience || '')
      setGoals(data.goals || '')
      setUniqueValue(data.unique_value || '')
      setExpertiseAreas(data.expertise_areas || [])
      setToneKeywords(data.tone_keywords || [])
      setAvoidTopics(data.avoid_topics || [])
      setPersonalContext(data.personal_context || '')
      setCommentStyleNotes(data.comment_style_notes || '')
    } catch (err) {
      console.error('Failed to load user memory:', err)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { loadMemory() }, [loadMemory])

  const handleSave = async () => {
    setSaving(true)
    try {
      await api.post(`/api/user-memory/${userId}`, {
        project_name: projectName,
        project_description: projectDescription,
        target_audience: targetAudience,
        goals,
        unique_value: uniqueValue,
        expertise_areas: expertiseAreas,
        tone_keywords: toneKeywords,
        avoid_topics: avoidTopics,
        personal_context: personalContext,
        comment_style_notes: commentStyleNotes,
      })
      setShowSaved(true)
      setTimeout(() => setShowSaved(false), 2500)
    } catch (err) {
      console.error('Failed to save user memory:', err)
    }
    setSaving(false)
  }

  const handleClear = async () => {
    if (!window.confirm(t.clearConfirm)) return
    try {
      await api.post(`/api/user-memory/${userId}`, {
        project_name: '',
        project_description: '',
        target_audience: '',
        goals: '',
        unique_value: '',
        expertise_areas: [],
        tone_keywords: [],
        avoid_topics: [],
        personal_context: '',
        comment_style_notes: '',
      })
      setProjectName('')
      setProjectDescription('')
      setTargetAudience('')
      setGoals('')
      setUniqueValue('')
      setExpertiseAreas([])
      setToneKeywords([])
      setAvoidTopics([])
      setPersonalContext('')
      setCommentStyleNotes('')
    } catch (err) {
      console.error('Failed to clear user memory:', err)
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 px-5 pt-6">
        {[1, 2, 3].map(i => <div key={i} className="queue-skeleton" />)}
      </div>
    )
  }

  const isConfigured = !!(projectName || targetAudience || goals || expertiseAreas.length)

  return (
    <div className="px-5 pt-6 pb-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold tracking-tight">🧠 {t.title}</h1>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{
          background: isConfigured ? '#ecfdf5' : '#fef9c3',
          color: isConfigured ? '#065f46' : '#854d0e',
          border: `1px solid ${isConfigured ? '#a7f3d0' : '#fde68a'}`,
        }}>
          {isConfigured ? t.configured : t.notConfigured}
        </span>
      </div>
      <p className="text-xs mb-5" style={{ color: 'var(--color-muted)' }}>{t.subtitle}</p>

      {/* How it works */}
      <div className="card mb-5" style={{ background: '#f0f9ff', border: '1px solid #bae6fd' }}>
        <p className="text-xs font-semibold mb-1" style={{ color: '#0369a1' }}>{t.howItWorks}</p>
        <p className="text-xs" style={{ color: '#475569' }}>{t.howItWorksText}</p>
      </div>

      {/* Form */}
      <div className="space-y-4">
        {/* Project */}
        <Field label={t.projectName} hint={t.projectNameHint}>
          <input
            type="text"
            className="memory-input"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder={t.projectNameHint}
          />
        </Field>

        <Field label={t.projectDesc} hint={t.projectDescHint}>
          <textarea
            className="memory-input memory-textarea"
            value={projectDescription}
            onChange={e => setProjectDescription(e.target.value)}
            placeholder={t.projectDescHint}
            rows={2}
          />
        </Field>

        {/* Audience & Goals */}
        <Field label={t.audience} hint={t.audienceHint}>
          <input
            type="text"
            className="memory-input"
            value={targetAudience}
            onChange={e => setTargetAudience(e.target.value)}
            placeholder={t.audienceHint}
          />
        </Field>

        <Field label={t.goals} hint={t.goalsHint}>
          <textarea
            className="memory-input memory-textarea"
            value={goals}
            onChange={e => setGoals(e.target.value)}
            placeholder={t.goalsHint}
            rows={2}
          />
        </Field>

        {/* Expertise */}
        <Field label={t.uniqueValue} hint={t.uniqueValueHint}>
          <textarea
            className="memory-input memory-textarea"
            value={uniqueValue}
            onChange={e => setUniqueValue(e.target.value)}
            placeholder={t.uniqueValueHint}
            rows={2}
          />
        </Field>

        <Field label={t.expertise} hint={t.expertiseHint}>
          <TagInput
            tags={expertiseAreas}
            onChange={setExpertiseAreas}
            placeholder={t.expertiseHint}
          />
        </Field>

        {/* Tone & Style */}
        <Field label={t.toneKeywords} hint={t.toneKeywordsHint}>
          <TagInput
            tags={toneKeywords}
            onChange={setToneKeywords}
            placeholder={t.toneKeywordsHint}
          />
        </Field>

        <Field label={t.avoidTopics} hint={t.avoidTopicsHint}>
          <TagInput
            tags={avoidTopics}
            onChange={setAvoidTopics}
            placeholder={t.avoidTopicsHint}
          />
        </Field>

        {/* Extra context */}
        <Field label={t.commentStyle} hint={t.commentStyleHint}>
          <textarea
            className="memory-input memory-textarea"
            value={commentStyleNotes}
            onChange={e => setCommentStyleNotes(e.target.value)}
            placeholder={t.commentStyleHint}
            rows={2}
          />
        </Field>

        <Field label={t.personalContext} hint={t.personalContextHint}>
          <textarea
            className="memory-input memory-textarea"
            value={personalContext}
            onChange={e => setPersonalContext(e.target.value)}
            placeholder={t.personalContextHint}
            rows={3}
          />
        </Field>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6">
        <button
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{ background: '#0A66C2', color: '#fff' }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? t.saving : showSaved ? t.saved : t.save}
        </button>
        <button
          className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
          style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' }}
          onClick={handleClear}
        >
          {t.clear}
        </button>
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs font-semibold block mb-1" style={{ color: '#334155' }}>{label}</label>
      {children}
    </div>
  )
}
