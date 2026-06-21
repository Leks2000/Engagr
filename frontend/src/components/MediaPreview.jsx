import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../App'

/**
 * MediaPreview — renders a post's image/video attachments inline in the
 * Telegram Mini App card.
 *
 * Why a proxy? Social CDN hosts (media.licdn.com, pbs.twimg.com,
 * preview.redd.it) block hotlinking by Referer. When the Mini App webview
 * loads <img src="…cdn…"> directly the CDN returns 403 and the image fails
 * silently. We route every asset through the backend /api/media/proxy
 * endpoint, which fetches it server-side with a permissive Referer and
 * streams it back with permissive CORS + long cache headers.
 *
 * UX: instead of vanishing on error (the old behaviour), we show a compact
 * "media unavailable — retry" chip so the user always understands what
 * happened, plus a one-tap retry that re-fetches through the proxy.
 *
 * Props:
 *   media: [{ type: 'image'|'video', url, thumbnail? }]  (from parsers)
 *   color: platform accent color for the border / accents
 */
export default function MediaPreview({ media, color = '#0A66C2' }) {
  // Which attachment is currently shown (gallery support)
  const [index, setIndex] = useState(0)
  // Failed set keyed by the *proxied* url so a retry can target one asset
  const [failed, setFailed] = useState({})
  const [retryNonce, setRetryNonce] = useState(0)

  const items = useMemo(() => {
    if (!Array.isArray(media)) return []
    return media
      .map(m => (m && typeof m === 'object') ? m : null)
      .filter(Boolean)
      .slice(0, 6)
  }, [media])

  // Clamp index when media changes (e.g. after feed reload)
  useEffect(() => { if (index > items.length - 1) setIndex(0) }, [items.length, index])

  if (items.length === 0) return null

  // Build a proxied URL for a raw asset. We only proxy http(s) URLs from
  // social CDNs; relative or empty URLs are skipped.
  const proxied = (rawUrl) => {
    if (!rawUrl || typeof rawUrl !== 'string') return ''
    if (!/^https?:\/\//i.test(rawUrl)) return ''
    return `${API_BASE}/api/media/proxy?url=${encodeURIComponent(rawUrl)}`
  }

  const current = items[Math.min(index, items.length - 1)] || items[0]
  // Prefer an image; videos fall back to their poster/thumbnail as a still.
  const rawPreview = current.type === 'image'
    ? (current.url || current.thumbnail || '')
    : (current.thumbnail || current.url || '')
  const previewUrl = proxied(rawPreview)
  const isVideo = current.type === 'video'
  const key = previewUrl || index
  const isFailed = !!failed[key]

  const handleErr = () => setFailed(f => ({ ...f, [key]: true }))
  const retry = () => { setFailed(f => { const n = { ...f }; delete n[key]; return n }); setRetryNonce(n => n + 1) }

  return (
    <div
      className="media-preview"
      style={{
        position: 'relative',
        marginBottom: 10,
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${color}22`,
        background: '#f1f5f9',
      }}
    >
      {/* Skeleton placeholder shown until the image decodes; never blank */}
      {!isFailed && (
        <div
          className="media-skeleton"
          style={{
            position: 'absolute',
            inset: 0,
            minHeight: 140,
            background: 'linear-gradient(90deg,#eef2f7 25%,#e2e8f0 37%,#eef2f7 63%)',
            backgroundSize: '200% 100%',
            animation: 'mediaShimmer 1.4s ease-in-out infinite',
          }}
        />
      )}

      {isFailed ? (
        // Graceful fallback: instead of disappearing, explain + offer retry.
        <div
          className="media-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            minHeight: 120,
            padding: '16px 12px',
            color: '#64748b',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: 22 }}>🖼️</span>
          <span style={{ fontSize: 11, fontWeight: 600 }}>Media unavailable</span>
          <button
            onClick={retry}
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: color,
              background: 'transparent',
              border: `1px solid ${color}55`,
              borderRadius: 999,
              padding: '3px 10px',
              cursor: 'pointer',
            }}
          >
            ↻ Retry
          </button>
        </div>
      ) : (
        <img
          key={`${key}-${retryNonce}`}
          src={previewUrl}
          alt="post media"
          loading="lazy"
          decoding="async"
          onLoad={e => {
            // Hide the skeleton once the image is ready
            const sk = e.currentTarget.parentElement?.querySelector('.media-skeleton')
            if (sk) sk.style.display = 'none'
            e.currentTarget.style.opacity = 1
          }}
          onError={handleErr}
          style={{
            display: 'block',
            width: '100%',
            maxHeight: 280,
            objectFit: 'cover',
            opacity: 0,
            transition: 'opacity 0.25s ease',
          }}
        />
      )}

      {/* Video badge */}
      {isVideo && !isFailed && (
        <span style={{
          position: 'absolute', left: 8, bottom: 8,
          background: 'rgba(0,0,0,0.65)', color: '#fff',
          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
        }}>
          ▶ Video
        </span>
      )}

      {/* Gallery dots + counter when more than one attachment */}
      {items.length > 1 && (
        <div style={{
          position: 'absolute', right: 8, top: 8,
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'rgba(0,0,0,0.55)', borderRadius: 999, padding: '3px 8px',
        }}>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 600 }}>
            {index + 1}/{items.length}
          </span>
        </div>
      )}

      {/* Gallery nav (prev / next) */}
      {items.length > 1 && !isFailed && (
        <>
          {index > 0 && (
            <button
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              style={navBtnStyle('left')}
              aria-label="Previous media"
            >‹</button>
          )}
          {index < items.length - 1 && (
            <button
              onClick={() => setIndex(i => Math.min(items.length - 1, i + 1))}
              style={navBtnStyle('right')}
              aria-label="Next media"
            >›</button>
          )}
        </>
      )}
    </div>
  )
}

function navBtnStyle(side) {
  return {
    position: 'absolute',
    [side]: 6,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 26,
    height: 26,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    fontSize: 16,
    lineHeight: '24px',
    textAlign: 'center',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }
}
