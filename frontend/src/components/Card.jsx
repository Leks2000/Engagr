import { useState } from 'react'

export default function Card({ item, onApprove, onEdit, onSkip, onRegenerate, onSelectVariant, onGenerateInvite, language = 'en' }) {
  const [copied, setCopied] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteMsg, setInviteMsg] = useState(null)
  const [inviteCopied, setInviteCopied] = useState(false)

  const isLinkedIn = item.platform === 'linkedin'
  const platformColor = isLinkedIn ? '#0A66C2' : '#FF4500'
  const platformBg = isLinkedIn ? '#eff6ff' : '#fff5f2'

  const authorName = item.author_name || item.author || ''
  const initials = authorName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  const variants = item.comment_variants || []
  const selectedComment = item.selected_comment || item.comment || ''

  const isSimulated = item._simulated
  const hasInteraction = item.has_previous_interaction

  const cardLabels = {
    en: {
      originalPost: 'Original Post', aiVariants: 'AI Comment Variants', viewPost: 'View post',
      simTag: 'Simulated', post: 'Post', edit: 'Edit', skip: 'Skip', regen: 'Regen',
      copyComment: 'Copy & Open', copied: 'Copied!', like: 'Like', invite: 'Invite',
      inviteTitle: 'Connection Invite', inviteCopy: 'Copy Invite', inviteCopied: 'Copied!',
      humanScore: 'Human', interactionHint: 'Previous contact',
    },
    ru: {
      originalPost: 'Исходный пост', aiVariants: 'Варианты AI-комментариев', viewPost: 'Открыть',
      simTag: 'Симуляция', post: 'Отправить', edit: 'Изменить', skip: 'Пропустить', regen: 'Обновить',
      copyComment: 'Копировать и открыть', copied: 'Скопировано!', like: 'Лайк', invite: 'Инвайт',
      inviteTitle: 'Заявка в друзья', inviteCopy: 'Копировать', inviteCopied: 'Скопировано!',
      humanScore: 'Человек', interactionHint: 'Уже общались',
    },
    es: {
      originalPost: 'Post original', aiVariants: 'Variantes de IA', viewPost: 'Ver',
      simTag: 'Simulado', post: 'Publicar', edit: 'Editar', skip: 'Saltar', regen: 'Regenerar',
      copyComment: 'Copiar y abrir', copied: 'Copiado!', like: 'Me gusta', invite: 'Invitar',
      inviteTitle: 'Solicitud de conexion', inviteCopy: 'Copiar', inviteCopied: 'Copiado!',
      humanScore: 'Humano', interactionHint: 'Contacto previo',
    },
    de: {
      originalPost: 'Originalpost', aiVariants: 'KI-Kommentare', viewPost: 'Offnen',
      simTag: 'Simuliert', post: 'Posten', edit: 'Bearbeiten', skip: 'Uberspringen', regen: 'Neu',
      copyComment: 'Kopieren & offnen', copied: 'Kopiert!', like: 'Gefallt mir', invite: 'Einladen',
      inviteTitle: 'Verbindungsanfrage', inviteCopy: 'Kopieren', inviteCopied: 'Kopiert!',
      humanScore: 'Mensch', interactionHint: 'Fruherer Kontakt',
    },
  }
  const L = cardLabels[language] || cardLabels.en

  // Copy comment to clipboard and open post URL
  const handleCopyAndOpen = async () => {
    const textToCopy = selectedComment || item.comment || ''
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = textToCopy
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }

    // Open post URL after a short delay
    setTimeout(() => {
      const url = item.post_url
      if (!url || url.includes('sim')) return
      // Try Telegram deep link first (for mobile)
      if (window.Telegram?.WebApp?.openLink) {
        window.Telegram.WebApp.openLink(url)
      } else {
        window.open(url, '_blank')
      }
    }, 300)

    // Also trigger the approve callback to track it
    if (onApprove) onApprove()
  }

  // Open post for liking
  const handleLike = () => {
    const url = item.post_url
    if (!url || url.includes('sim')) return
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url)
    } else {
      window.open(url, '_blank')
    }
  }

  // Generate and copy invite message
  const handleGenerateInvite = async () => {
    if (onGenerateInvite) {
      setInviteLoading(true)
      try {
        const result = await onGenerateInvite(item)
        setInviteMsg(result)
      } catch {}
      setInviteLoading(false)
    }
  }

  const handleCopyInvite = async () => {
    if (!inviteMsg?.message) return
    try {
      await navigator.clipboard.writeText(inviteMsg.message)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = inviteMsg.message
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2000)
    }

    // Open author profile (construct LinkedIn profile URL from name if available)
    setTimeout(() => {
      const url = item.post_url
      if (!url || url.includes('sim')) return
      if (window.Telegram?.WebApp?.openLink) {
        window.Telegram.WebApp.openLink(url)
      } else {
        window.open(url, '_blank')
      }
    }, 300)
  }

  const handleOpenPost = () => {
    const url = item.post_url
    if (!url || url.includes('sim')) return
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div
      className="queue-card"
      style={{ borderLeft: `4px solid ${platformColor}` }}
    >
      {/* Header: Platform + Author */}
      <div className="queue-card-header">
        <div className="queue-card-author">
          <div className="queue-card-avatar" style={{ background: platformColor }}>
            {initials}
          </div>
          <div>
            <span className="queue-card-name">{authorName || 'Unknown'}</span>
            <div className="flex items-center gap-2 mt-0.5">
              {item.reactions_count > 0 && (
                <span className="queue-card-reactions">
                  {item.reactions_count} reactions
                </span>
              )}
              {item.humanness_score && item.humanness_score < 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' }}>
                  {L.humanScore}: {Math.round(item.humanness_score * 100)}%
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasInteraction && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
              {L.interactionHint}
            </span>
          )}
          {isSimulated && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}>
              {L.simTag}
            </span>
          )}
          <span className={`badge badge-${item.platform}`}>
            {isLinkedIn ? 'LinkedIn' : 'Reddit'}
          </span>
        </div>
      </div>

      {/* Post Excerpt */}
      <div className="queue-card-excerpt">
        <p style={{ fontWeight: 600, marginBottom: 6 }}>Original post context</p>
        {item.post_text && (
          <p style={{ marginBottom: 8, opacity: 0.9 }}>
            {item.post_text.length > 280 ? `${item.post_text.slice(0, 280)}…` : item.post_text}
          </p>
        )}
        <p>{item.post_excerpt || item.excerpt || ''}</p>
      </div>

      {/* View Post Link */}
      {item.post_url && !item.post_url.includes('sim') && (
        <button className="queue-card-link" onClick={handleOpenPost} style={{ color: platformColor }}>
          {L.viewPost} &rarr;
        </button>
      )}

      {/* Comment Variants */}
      {variants.length > 0 ? (
        <div className="queue-card-variants">
          <div className="queue-card-variants-label">
            <span>{L.aiVariants}</span>
            {item.post_language && item.user_language && item.post_language !== item.user_language && (
              <span className="queue-card-lang-badge">
                {item.post_language.toUpperCase()} &rarr; {item.user_language.toUpperCase()}
              </span>
            )}
          </div>
          {variants.map((variant, idx) => (
            <label
              key={idx}
              className={`queue-card-variant ${selectedComment === variant ? 'selected' : ''}`}
              onClick={() => onSelectVariant && onSelectVariant(item.id, idx)}
              style={selectedComment === variant ? { borderColor: platformColor, background: platformBg, boxShadow: `0 0 0 1px ${platformColor}` } : {}}
            >
              <input
                type="radio"
                name={`variant-${item.id}`}
                checked={selectedComment === variant}
                onChange={() => onSelectVariant && onSelectVariant(item.id, idx)}
                style={{ accentColor: platformColor }}
              />
              <span className="queue-card-variant-text">{variant}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="queue-card-comment" style={{ background: platformBg, borderColor: isLinkedIn ? '#bfdbfe' : '#fed7c3' }}>
          <span className="queue-card-comment-icon">💬</span>
          <span>{selectedComment}</span>
        </div>
      )}

      {/* Language Badges */}
      {item.post_language && (
        <div className="queue-card-meta">
          <span className="queue-card-lang" style={{ background: platformBg, borderColor: isLinkedIn ? '#bfdbfe' : '#fed7c3', color: platformColor }}>
            Post: {item.post_language.toUpperCase()}
          </span>
          {item.user_language && item.post_language !== item.user_language && (
            <span className="queue-card-lang">
              You: {item.user_language.toUpperCase()}
            </span>
          )}
        </div>
      )}

      {/* ═══ SEMI-AUTO ACTION BUTTONS (Copy-to-Clipboard workflow) ═══ */}
      <div className="queue-card-actions-semi">
        {/* Primary: Copy & Open */}
        <button
          className="queue-btn-primary"
          onClick={handleCopyAndOpen}
          style={{ background: platformColor, color: '#fff' }}
        >
          {copied ? `✅ ${L.copied}` : `💬 ${L.copyComment}`}
        </button>

        {/* Secondary actions row */}
        <div className="queue-card-actions-row">
          <button className="queue-btn-secondary" onClick={handleLike} title="Like post">
            👍 {L.like}
          </button>
          <button
            className="queue-btn-secondary"
            onClick={handleGenerateInvite}
            disabled={inviteLoading}
            title="Generate invite"
            style={hasInteraction ? { border: '1.5px solid #fbbf24' } : {}}
          >
            {inviteLoading ? '...' : `🤝 ${L.invite}`}
          </button>
          <button className="queue-btn-secondary" onClick={onEdit} title="Edit comment">
            ✏️ {L.edit}
          </button>
          <button className="queue-btn-secondary" onClick={onRegenerate} title="Regenerate">
            🔄 {L.regen}
          </button>
          <button className="queue-btn-secondary queue-btn-skip-small" onClick={onSkip} title="Skip">
            ✕
          </button>
        </div>
      </div>

      {/* Invite Message (expanded when generated) */}
      {inviteMsg && (
        <div className="queue-card-invite" style={{ borderColor: platformColor }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold" style={{ color: platformColor }}>{L.inviteTitle}</span>
            <span className="text-[10px]" style={{ color: '#94a3b8' }}>{inviteMsg.char_count}/300</span>
          </div>
          <p className="text-sm mb-2" style={{ color: '#334155', lineHeight: 1.5 }}>{inviteMsg.message}</p>
          {inviteMsg.variants && inviteMsg.variants.length > 1 && (
            <div className="space-y-1 mb-2">
              {inviteMsg.variants.slice(1).map((v, i) => (
                <p key={i} className="text-xs px-2 py-1.5 rounded" style={{ background: '#f8fafc', color: '#64748b', cursor: 'pointer' }}
                   onClick={() => setInviteMsg({ ...inviteMsg, message: v, char_count: v.length })}
                >
                  {v}
                </p>
              ))}
            </div>
          )}
          <button
            className="queue-btn-primary w-full"
            onClick={handleCopyInvite}
            style={{ background: platformColor, color: '#fff' }}
          >
            {inviteCopied ? `✅ ${L.inviteCopied}` : `📋 ${L.inviteCopy}`}
          </button>
        </div>
      )}
    </div>
  )
}
