import { useState } from 'react'

/**
 * MediaPreview — shows the first image (or video thumbnail) of a post inline
 * in the Mini App card, so the user sees the post media without leaving
 * Telegram. Additional attachments are surfaced as a small "+N more" hint.
 *
 * Props:
 *   media: [{ type: 'image'|'video', url, thumbnail? }]  (from parsers)
 *   color: platform accent color for the border
 */
export default function MediaPreview({ media, color = '#0A66C2' }) {
  const [failed, setFailed] = useState(false)
  if (!Array.isArray(media) || media.length === 0) return null

  // Pick the best preview URL: first image url, else a video thumbnail, else video poster.
  let previewUrl = ''
  let isVideo = false
  for (const m of media) {
    if (!m || typeof m !== 'object') continue
    if (m.type === 'image' && m.url) { previewUrl = m.url; isVideo = false; break }
    if (m.type === 'video') {
      if (m.thumbnail) { previewUrl = m.thumbnail; isVideo = true; break }
      if (m.url) { previewUrl = m.url; isVideo = true; break }
    }
  }
  if (!previewUrl || failed) return null

  const extra = media.length - 1

  return (
    <div
      className="media-preview"
      style={{
        position: 'relative',
        marginBottom: 10,
        borderRadius: 10,
        overflow: 'hidden',
        border: `1px solid ${color}22`,
        background: '#f8fafc',
      }}
    >
      <img
        src={previewUrl}
        alt="post media"
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ display: 'block', width: '100%', maxHeight: 240, objectFit: 'cover' }}
      />
      {isVideo && (
        <span
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          ▶ Video
        </span>
      )}
      {extra > 0 && (
        <span
          style={{
            position: 'absolute',
            right: 8,
            top: 8,
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          +{extra}
        </span>
      )}
    </div>
  )
}
