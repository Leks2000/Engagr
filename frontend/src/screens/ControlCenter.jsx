import { useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'https://engagr-production.up.railway.app'

const I18N = {
  en: {
    title: 'Control Center',
    subtitle: 'Mini App hub for platforms, ideas, and safety settings',
    workspace: 'Workspace',
    comingNext: 'Coming next',
    settings: 'Settings',
    open: 'Open',
    planned: 'Planned',
    ready: 'Ready',
    limited: 'Limited',
    linkedin: 'LinkedIn',
    linkedinText: 'Connection, targeting, daily caps, and warm-up settings.',
    reddit: 'Reddit',
    redditText: 'Subreddits, keywords, discovery, comments, and upvotes.',
    queue: 'Approval Queue',
    queueText: 'Review, edit, regenerate, approve, or skip generated actions.',
    memory: 'My Profile',
    memoryText: 'Project, audience, goals, expertise — personalized AI comments.',
    x: 'X / Twitter',
    xText: 'Trends, reply generation, thread drafts, and X queue workflow.',
    ideas: 'Ideas Engine',
    ideasText: 'AI/dev/startup news collection for content and comment ideas.',
    language: 'Language',
    session: 'Automation session',
    active: 'Active',
    paused: 'Paused',
    userId: 'Telegram user ID',
    extensionTitle: 'Chrome Extension login',
    extensionText: 'Generate a 5-minute code, paste it into Engagr WebBridge on your PC, then click Connect.',
    generateCode: 'Generate login code',
    generating: 'Generating...',
    copy: 'Copy',
    copied: 'Copied',
    codeExpires: 'Expires in 5 minutes. Do not paste your Telegram user ID into the extension.',
    codeError: 'Could not generate code. Check backend connection.',
    safety: 'Safety rules',
    safetyText: 'The current MVP keeps final publishing human-controlled. Use moderate daily limits and review every action before posting.',
    saved: 'Saved',
  },
  ru: {
    title: 'Центр управления',
    subtitle: 'Mini App-хаб для платформ, идей и безопасных настроек',
    workspace: 'Рабочая зона',
    comingNext: 'Следующие модули',
    settings: 'Настройки',
    open: 'Открыть',
    planned: 'Запланировано',
    ready: 'Готово',
    limited: 'Ограничено',
    linkedin: 'LinkedIn',
    linkedinText: 'Подключение, таргетинг, дневные лимиты и прогрев.',
    reddit: 'Reddit',
    redditText: 'Сабреддиты, ключевые слова, discovery, комментарии и апвоуты.',
    queue: 'Очередь согласования',
    queueText: 'Проверка, правка, регенерация, approve или skip AI-действий.',
    memory: 'Мой профиль',
    memoryText: 'Проект, аудитория, цели, экспертиза — персонализация AI.',
    x: 'X / Twitter',
    xText: 'Тренды, генерация ответов, треды и очередь для X.',
    ideas: 'Ideas Engine',
    ideasText: 'Сбор AI/dev/startup новостей для идей контента и комментариев.',
    language: 'Язык',
    session: 'Автоматизация',
    active: 'Активна',
    paused: 'Пауза',
    userId: 'Telegram user ID',
    extensionTitle: 'Вход в Chrome Extension',
    extensionText: 'Сгенерируй код на 5 минут, вставь его в Engagr WebBridge на ПК и нажми Connect.',
    generateCode: 'Сгенерировать код',
    generating: 'Генерирую...',
    copy: 'Копировать',
    copied: 'Скопировано',
    codeExpires: 'Действует 5 минут. Не вставляй Telegram user ID в расширение.',
    codeError: 'Не удалось создать код. Проверь backend.',
    safety: 'Правила безопасности',
    safetyText: 'В текущем MVP финальная публикация остаётся под контролем человека. Используйте умеренные дневные лимиты и проверяйте каждое действие перед публикацией.',
    saved: 'Сохранено',
  },
  es: {
    title: 'Centro de control',
    subtitle: 'Hub Mini App para plataformas, ideas y seguridad',
    workspace: 'Workspace',
    comingNext: 'Próximos módulos',
    settings: 'Ajustes',
    open: 'Abrir',
    planned: 'Planeado',
    ready: 'Listo',
    limited: 'Limitado',
    linkedin: 'LinkedIn',
    linkedinText: 'Conexión, targeting, límites diarios y warm-up.',
    reddit: 'Reddit',
    redditText: 'Subreddits, keywords, discovery, comentarios y votos.',
    queue: 'Cola de aprobación',
    queueText: 'Revisar, editar, regenerar, aprobar o saltar acciones.',
    memory: 'Mi Perfil',
    memoryText: 'Proyecto, audiencia, metas, expertise — comentarios IA personalizados.',
    x: 'X / Twitter',
    xText: 'Tendencias, generación de respuestas, hilos y cola para X.',
    ideas: 'Ideas Engine',
    ideasText: 'Noticias AI/dev/startup para ideas de contenido y comentarios.',
    language: 'Idioma',
    session: 'Sesión de automatización',
    active: 'Activa',
    paused: 'Pausada',
    userId: 'Telegram user ID',
    extensionTitle: 'Inicio de Chrome Extension',
    extensionText: 'Genera un código de 5 minutos, pégalo en Engagr WebBridge en tu PC y pulsa Connect.',
    generateCode: 'Generar código',
    generating: 'Generando...',
    copy: 'Copiar',
    copied: 'Copiado',
    codeExpires: 'Caduca en 5 minutos. No pegues tu Telegram user ID en la extensión.',
    codeError: 'No se pudo generar el código. Revisa el backend.',
    safety: 'Reglas de seguridad',
    safetyText: 'El MVP mantiene la publicación final bajo control humano. Usa límites moderados y revisa cada acción antes de publicar.',
    saved: 'Guardado',
  },
  de: {
    title: 'Kontrollzentrum',
    subtitle: 'Mini-App-Hub für Plattformen, Ideen und Sicherheit',
    workspace: 'Workspace',
    comingNext: 'Als Nächstes',
    settings: 'Einstellungen',
    open: 'Öffnen',
    planned: 'Geplant',
    ready: 'Bereit',
    limited: 'Limitiert',
    linkedin: 'LinkedIn',
    linkedinText: 'Verbindung, Targeting, Tageslimits und Warm-up.',
    reddit: 'Reddit',
    redditText: 'Subreddits, Keywords, Discovery, Kommentare und Upvotes.',
    queue: 'Freigabe-Warteschlange',
    queueText: 'Aktionen prüfen, bearbeiten, neu generieren, freigeben oder überspringen.',
    memory: 'Mein Profil',
    memoryText: 'Projekt, Zielgruppe, Ziele, Expertise — personalisierte KI-Kommentare.',
    x: 'X / Twitter',
    xText: 'Trends, Reply-Generierung, Thread-Entwürfe und X-Warteschlange.',
    ideas: 'Ideas Engine',
    ideasText: 'AI/dev/startup News für Content- und Kommentarideen.',
    language: 'Sprache',
    session: 'Automatisierung',
    active: 'Aktiv',
    paused: 'Pausiert',
    userId: 'Telegram user ID',
    extensionTitle: 'Chrome Extension Login',
    extensionText: 'Erzeuge einen 5-Minuten-Code, füge ihn am PC in Engagr WebBridge ein und klicke Connect.',
    generateCode: 'Login-Code erzeugen',
    generating: 'Wird erzeugt...',
    copy: 'Kopieren',
    copied: 'Kopiert',
    codeExpires: 'Läuft in 5 Minuten ab. Nicht die Telegram user ID in die Extension einfügen.',
    codeError: 'Code konnte nicht erzeugt werden. Backend prüfen.',
    safety: 'Sicherheitsregeln',
    safetyText: 'Im aktuellen MVP bleibt die finale Veröffentlichung menschlich kontrolliert. Nutze moderate Tageslimits und prüfe jede Aktion vor dem Posten.',
    saved: 'Gespeichert',
  },
}

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
]

export default function ControlCenter({ userId, settings, language = 'en', onSettingsUpdate, onNavigate }) {
  const t = I18N[language] || I18N.en
  const [savingField, setSavingField] = useState('')
  const [extensionCode, setExtensionCode] = useState('')
  const [extensionError, setExtensionError] = useState('')
  const [extensionLoading, setExtensionLoading] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const sessionActive = settings?.session_active !== false

  const workspaceCards = useMemo(() => ([
    {
      id: 'linkedin',
      title: t.linkedin,
      text: t.linkedinText,
      status: settings?.linkedin?.connected ? t.ready : t.limited,
      tone: 'linkedin',
    },
    {
      id: 'reddit',
      title: t.reddit,
      text: t.redditText,
      status: settings?.reddit?.connected || settings?.reddit?.subreddits?.length ? t.ready : t.limited,
      tone: 'reddit',
    },
    {
      id: 'queue',
      title: t.queue,
      text: t.queueText,
      status: t.ready,
      tone: 'queue',
    },
    {
      id: 'memory',
      title: t.memory,
      text: t.memoryText,
      status: t.ready,
      tone: 'memory',
    },
    {
      id: 'ideas',
      title: t.ideas,
      text: t.ideasText,
      status: t.ready,
      tone: 'ideas',
    },
    {
      id: 'x',
      title: t.x,
      text: t.xText,
      status: t.ready,
      tone: 'x',
    },
  ]), [settings, t])

  const save = async (field, payload) => {
    setSavingField(field)
    try {
      await onSettingsUpdate(payload)
    } finally {
      setTimeout(() => setSavingField(''), 700)
    }
  }

  const generateExtensionCode = async () => {
    setExtensionLoading(true)
    setExtensionError('')
    setCodeCopied(false)
    try {
      const response = await fetch(`${API_BASE}/api/auth/extension-login-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.code) throw new Error(body.error || 'code_failed')
      setExtensionCode(body.code)
    } catch {
      setExtensionCode('')
      setExtensionError(t.codeError)
    } finally {
      setExtensionLoading(false)
    }
  }

  const copyExtensionCode = async () => {
    if (!extensionCode) return
    try {
      await navigator.clipboard.writeText(extensionCode)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 1500)
    } catch {
      setExtensionError(extensionCode)
    }
  }

  return (
    <div className="px-5 pt-6 animate-fade-in control-center-screen">
      <div className="flex items-start justify-between mb-6 gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t.title}</h1>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.subtitle}</p>
        </div>
        <span className="text-xs px-2 py-1 rounded" style={{ background: sessionActive ? '#e8f5e9' : '#fff3e0', color: sessionActive ? 'var(--color-success)' : 'var(--color-warning)' }}>
          ● {sessionActive ? t.active : t.paused}
        </span>
      </div>

      <SectionTitle>{t.workspace}</SectionTitle>
      <div className="grid gap-3 mb-5">
        {workspaceCards.map((card) => (
          <button key={card.id} type="button" className={`control-card control-card-${card.tone}`} onClick={() => onNavigate?.(card.id)}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-sm font-semibold">{card.title}</h2>
                <span className="control-status">{card.status}</span>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{card.text}</p>
            </div>
            <span className="control-open">{t.open} →</span>
          </button>
        ))}
      </div>

      <SectionTitle>{t.settings}</SectionTitle>
      <div className="card mb-4 control-settings-card">
        <label className="text-xs font-semibold block mb-2">{t.language}</label>
        <select
          className="control-select"
          value={settings?.language || language}
          onChange={(event) => save('language', { language: event.target.value })}
        >
          {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {savingField === 'language' && <p className="text-xs mt-2" style={{ color: 'var(--color-success)' }}>{t.saved}</p>}
      </div>

      <div className="card mb-4 control-settings-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold">{t.session}</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{sessionActive ? t.active : t.paused}</p>
          </div>
          <button className="btn btn-sm" type="button" onClick={() => save('session', { session_active: !sessionActive })}>
            {sessionActive ? t.paused : t.active}
          </button>
        </div>
        {savingField === 'session' && <p className="text-xs mt-2" style={{ color: 'var(--color-success)' }}>{t.saved}</p>}
      </div>

      <div className="card mb-4 control-settings-card">
        <p className="text-xs font-semibold mb-1">{t.userId}</p>
        <code className="control-user-id">{userId}</code>
      </div>

      <div className="card mb-4 control-settings-card">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-xs font-semibold">🔌 {t.extensionTitle}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{t.extensionText}</p>
          </div>
          <button className="btn btn-sm" type="button" onClick={generateExtensionCode} disabled={extensionLoading}>
            {extensionLoading ? t.generating : t.generateCode}
          </button>
        </div>
        {extensionCode && (
          <div className="extension-code-box">
            <code>{extensionCode}</code>
            <button className="btn btn-sm" type="button" onClick={copyExtensionCode}>{codeCopied ? t.copied : t.copy}</button>
          </div>
        )}
        {extensionCode && <p className="text-xs mt-2" style={{ color: 'var(--color-warning)' }}>{t.codeExpires}</p>}
        {extensionError && <p className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>{extensionError}</p>}
      </div>

      <div className="card mb-6 control-safety-card">
        <p className="text-sm font-semibold mb-1">🛡️ {t.safety}</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{t.safetyText}</p>
      </div>
    </div>
  )
}

function SectionTitle({ children }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] mb-2" style={{ color: 'var(--color-muted)' }}>{children}</p>
}

function RoadmapCard({ title, text, badge }) {
  return (
    <div className="control-card control-card-planned" aria-disabled="true">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="control-status">{badge}</span>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{text}</p>
      </div>
    </div>
  )
}
