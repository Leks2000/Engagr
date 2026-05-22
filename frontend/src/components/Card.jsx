export default function Card({ item, onApprove, onEdit, onSkip, onRegenerate, onSelectVariant, language = 'en' }) {
  const isLinkedIn = item.platform === 'linkedin'
  const platformColor = isLinkedIn ? '#0A66C2' : '#FF4500'

  // Get initials for avatar fallback
  const authorName = item.author_name || item.author || ''
  const initials = authorName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  const variants = item.comment_variants || []
  const selectedComment = item.selected_comment || item.comment || ''

  const handleOpenPost = () => {
    const url = item.post_url
    if (!url) return
    if (window.Telegram?.WebApp?.openLink) {
      window.Telegram.WebApp.openLink(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <div className="queue-card" style={{ borderLeft: `3px solid ${platformColor}` }}>
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
                👍 {item.reactions_count}
              </span>
            )}
          </div>
        </div>
        <span className={`badge badge-${item.platform}`}>
          {isLinkedIn ? 'LinkedIn' : 'Reddit'}
        </span>
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
      {item.post_url && (
        <button className="queue-card-link" onClick={handleOpenPost}>
          View post →
        </button>
      )}

      {/* Comment Variants */}
      {variants.length > 0 ? (
        <div className="queue-card-variants">
          <div className="queue-card-variants-label">
            <span>AI Comment Variants</span>
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
            >
              <input
                type="radio"
                name={`variant-${item.id}`}
                checked={selectedComment === variant}
                onChange={() => onSelectVariant && onSelectVariant(item.id, idx)}
              />
              <span className="queue-card-variant-text">{variant}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="queue-card-comment">
          <span className="queue-card-comment-icon">💬</span>
          <span>{selectedComment}</span>
        </div>
      )}

      {/* Language Badge */}
      {item.post_language && (
        <div className="queue-card-meta">
          <span className="queue-card-lang">
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
          ✅ Post
        </button>
        <button className="queue-btn queue-btn-edit" onClick={onEdit} title="Edit comment">
          ✏️ Edit
        </button>
        <button className="queue-btn queue-btn-skip" onClick={onSkip} title="Skip this post">
          ❌ Skip
        </button>
        <button className="queue-btn queue-btn-regen" onClick={onRegenerate} title="Regenerate">
          🔄
        </button>
      </div>
    </div>
  )
}
