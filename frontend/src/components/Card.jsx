export default function Card({ item, onApprove, onEdit, onSkip, onRegenerate, onSelectVariant, language = 'en' }) {
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

  const handleOpenPost = () => {
    const url = item.post_url
    if (!url || url.includes('sim')) return
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const cardLabels = {
    en: { originalPost: 'Original Post', aiVariants: 'AI Comment Variants', viewPost: 'View post →', simTag: '⚡ Simulated', post: '✅ Post', edit: '✏️ Edit', skip: '❌ Skip', regen: '🔄' },
    ru: { originalPost: 'Исходный пост', aiVariants: 'Варианты AI-комментариев', viewPost: 'Открыть пост →', simTag: '⚡ Симуляция', post: '✅ Отправить', edit: '✏️ Изменить', skip: '❌ Пропустить', regen: '🔄' },
    es: { originalPost: 'Post original', aiVariants: 'Variantes de IA', viewPost: 'Ver post →', simTag: '⚡ Simulado', post: '✅ Publicar', edit: '✏️ Editar', skip: '❌ Saltar', regen: '🔄' },
    de: { originalPost: 'Originalpost', aiVariants: 'KI-Kommentare', viewPost: 'Post öffnen →', simTag: '⚡ Simuliert', post: '✅ Posten', edit: '✏️ Bearbeiten', skip: '❌ Überspringen', regen: '🔄' },
  }
  const L = cardLabels[language] || cardLabels.en

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
            {item.reactions_count > 0 && (
              <span className="queue-card-reactions">
                👍 {item.reactions_count} reactions
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Original Post Context */}
      {(item.post_text || item.post_excerpt || item.excerpt) && (
        <div className="queue-card-excerpt" style={{ background: platformBg, borderColor: isLinkedIn ? '#bfdbfe' : '#fed7c3' }}>
          <p style={{ fontWeight: 700, marginBottom: 6, color: platformColor, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {L.originalPost}
          </p>
          {item.post_text ? (
            <p style={{ marginBottom: 0, opacity: 0.9 }}>
              {item.post_text.length > 300 ? `${item.post_text.slice(0, 300)}…` : item.post_text}
            </p>
          ) : (
            <p>{item.post_excerpt || item.excerpt || ''}</p>
          )}
        </div>
      )}

      {/* View Post Link */}
      {item.post_url && !item.post_url.includes('sim') && (
        <button className="queue-card-link" onClick={handleOpenPost} style={{ color: platformColor }}>
          {L.viewPost}
        </button>
      )}

      {/* Comment Variants */}
      {variants.length > 0 ? (
        <div className="queue-card-variants">
          <div className="queue-card-variants-label">
            <span>{L.aiVariants}</span>
            {item.post_language && item.user_language && item.post_language !== item.user_language && (
              <span className="queue-card-lang-badge">
                {item.post_language.toUpperCase()} → {item.user_language.toUpperCase()}
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

      {/* Action Buttons */}
      <div className="queue-card-actions">
        <button className="queue-btn queue-btn-approve" onClick={onApprove} title="Post comment">
          {L.post}
        </button>
        <button className="queue-btn queue-btn-edit" onClick={onEdit} title="Edit comment">
          {L.edit}
        </button>
        <button className="queue-btn queue-btn-skip" onClick={onSkip} title="Skip this post">
          {L.skip}
        </button>
        <button className="queue-btn queue-btn-regen" onClick={onRegenerate} title="Regenerate">
          {L.regen}
        </button>
      </div>
    </div>
  )
}
