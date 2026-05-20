export default function Card({ item, onApprove, onEdit, onSkip, onRegenerate, language = 'en' }) {
  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className={`badge badge-${item.platform}`}>
          {item.platform}
        </span>
        {item.author && (
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            by {item.author}
          </span>
        )}
      </div>

      {/* Post Excerpt */}
      <p className="text-xs leading-relaxed mb-3" style={{ color: '#555' }}>
        {item.post_excerpt}
        {item.post_url && <a href={item.post_url} target="_blank" rel="noreferrer" className="block mt-1 underline">Open post</a>}
      </p>

      {/* Generated Comment */}
      <div
        className="px-3 py-2.5 rounded-lg mb-3 text-sm"
        style={{ background: 'white', border: '1px solid #e5e5e5' }}
      >
        💬 {item.comment}
        <div className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>Language: {language.toUpperCase()}</div>
      </div>

      {/* Scheduled time */}
      {item.created_at && (
        <p className="text-[10px] mb-3" style={{ color: 'var(--color-muted)' }}>
          Created: {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-4 gap-2">
        <button className="btn btn-sm" onClick={onApprove} title="Post">
          ✅
        </button>
        <button className="btn btn-sm" onClick={onEdit} title="Edit">
          ✏️
        </button>
        <button className="btn btn-sm" onClick={onSkip} title="Decline">
          ⛔
        </button>
        <button className="btn btn-sm" onClick={onRegenerate} title="Regenerate">
          🔄
        </button>
      </div>
    </div>
  )
}
