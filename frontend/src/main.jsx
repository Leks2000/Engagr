import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// ── E2E self-mock (agent-facing Browser MCP test harness) ───────────────────
// The Playwright e2e specs in tests/e2e mock the backend via
// page.addInitScript + page.route — APIs the Browser MCP tunnel does NOT
// expose. To let the /api/mcp/e2e runner drive the SAME spec scenarios
// through the remote browser, the app self-installs an equivalent fetch
// mock when the page is opened with ?e2e=1 (and optionally ?e2e_scenario=).
//
// This is GATED on the query param and completely inert in production:
// normal users never visit ?e2e=1, so window.fetch is untouched. It only
// runs in the Playwright-MCP-driven browser on the user's PC during an
// on-demand e2e run requested from the Mini App.
//
// The mock mirrors tests/e2e/tests/fixtures.js exactly (same USER_ID,
// same queue items, same /api responses) so the runner's assertions are
// faithful to the authored specs.
;(function installE2EMockIfNeeded() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('e2e') !== '1') return
  } catch { return }

  const USER_ID = 'e2e_user'
  const mediaItem = {
    id: 'item-media-1', platform: 'reddit', action: 'comment', status: 'pending',
    author: 'u/poster', author_name: 'u/poster',
    post_text: 'Check out this sunset from the trail today',
    post_excerpt: 'Check out this sunset from the trail today',
    post_url: 'https://www.reddit.com/r/EarthPorn/comments/abc/',
    post_language: 'en', user_language: 'en',
    comment_variants: ['Stunning colors! Where exactly was this taken?'],
    selected_comment: 'Stunning colors! Where exactly was this taken?',
    comment: 'Stunning colors! Where exactly was this taken?',
    translations: null, post_text_translated: null,
    has_media: true, media: [{ type: 'image', url: 'https://placehold.co/600x400/png' }],
    created_at: '2026-06-19T12:00:00.000Z',
  }
  const pendingItem = {
    id: 'item-pending-1', platform: 'linkedin', action: 'comment', status: 'pending',
    author: 'Jane Doe', author_name: 'Jane Doe',
    post_text: 'We just shipped our new AI search feature — it cuts research time by 40%.',
    post_excerpt: 'We just shipped our new AI search feature — it cuts research time by 40%.',
    post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
    post_language: 'en', user_language: 'en',
    comment_variants: [
      'Congrats on the launch! The 40% time saving is huge for research teams.',
      'This is a big deal — faster research means faster decisions. Well done.',
      'Love seeing AI applied to real workflow pain. How did you measure the 40%?',
    ],
    selected_comment: 'Congrats on the launch! The 40% time saving is huge for research teams.',
    comment: 'Congrats on the launch! The 40% time saving is huge for research teams.',
    translations: null, post_text_translated: null,
    has_media: false, media: [], created_at: '2026-06-19T10:00:00.000Z',
  }
  const newPostItem = {
    id: 'item-new-1', platform: 'x', action: 'comment', status: 'new_post',
    author: '@devnews', author_name: '@devnews',
    post_text: 'Breaking: new JS framework promises zero-config SSR with edge rendering.',
    post_excerpt: 'Breaking: new JS framework promises zero-config SSR with edge rendering.',
    post_url: 'https://x.com/devnews/status/999', post_language: 'en', user_language: 'en',
    comment_variants: [], selected_comment: '', comment: '',
    translations: null, post_text_translated: null,
    has_media: false, media: [], created_at: '2026-06-19T11:00:00.000Z',
  }
  const scenario = (() => {
    try { return new URLSearchParams(window.location.search).get('e2e_scenario') || 'feed' }
    catch { return 'feed' }
  })()

  const scenarioItems = {
    feed: [pendingItem, newPostItem],
    media: [mediaItem],
    'media-fail': [mediaItem],
  }
  const store = {
    userId: USER_ID,
    settings: { onboarding_completed: true, language: 'en' },
    queue: JSON.parse(JSON.stringify(scenarioItems[scenario] || scenarioItems.feed)),
    proxyFails: scenario === 'media-fail',
  }

  const match = (url, pattern) => {
    try { return new URL(url, window.location.origin).pathname === pattern } catch { return false }
  }
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const origFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : (input && input.url)
    if (!urlStr) return origFetch(input, init)
    let urlObj
    try { urlObj = new URL(urlStr, window.location.origin) } catch { return origFetch(input, init) }
    if (!urlObj.pathname.startsWith('/api/')) return origFetch(input, init)
    const path = urlObj.pathname
    const method = (init && init.method) || 'GET'

    if (match(urlStr, `/api/settings/${store.userId}`) && method === 'GET') return json(store.settings)
    if (match(urlStr, `/api/settings/${store.userId}`) && method === 'PUT') {
      const body = init && init.body ? JSON.parse(init.body) : {}
      store.settings = { ...store.settings, ...body }
      return json({ ok: true, ...store.settings })
    }
    if (match(urlStr, `/api/queue/${store.userId}`) && method === 'GET') return json(store.queue)
    if (path === '/api/media/proxy' && method === 'GET') {
      if (store.proxyFails) return new Response('upstream 403', { status: 502 })
      const png = Uint8Array.from(atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
      ), c => c.charCodeAt(0))
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    }
    if (match(urlStr, `/api/queue/${store.userId}/translate-all`) && method === 'POST')
      return json({ ok: true, translated: store.queue.length })
    const itemRe = new RegExp(`^/api/queue/${store.userId}/([^/]+)/([^/]+)$`)
    const im = path.match(itemRe)
    if (im) {
      const [, itemId, action] = im
      const idx = store.queue.findIndex((i) => i.id === itemId)
      if (idx === -1) return json({ error: 'not found' }, 404)
      const item = store.queue[idx]
      if (action === 'regenerate' && method === 'POST') {
        const v = ['Regenerated take 1 — sharp and on-topic.', 'Regenerated take 2 — friendly and curious.', 'Regenerated take 3 — concise and approving.']
        item.comment_variants = v; item.selected_comment = v[0]; item.comment = v[0]; item.status = 'pending'
        return json({ variants: v, comment: v[0], post_language: 'en' })
      }
      if (action === 'select' && method === 'POST') {
        const body = init && init.body ? JSON.parse(init.body) : {}
        const v = item.comment_variants[body.variant_index] || item.comment_variants[0] || ''
        item.selected_comment = v; item.comment = v
        return json({ comment: v })
      }
      if (action === 'approve' && method === 'POST') { item.status = 'approved'; item.execution = 'extension'; return json({ status: 'approved', execution: 'extension', action_chain: [] }) }
      if (action === 'skip' && method === 'POST') { item.status = 'skipped'; return json({ status: 'skipped' }) }
      if (action === 'decline' && method === 'POST') { item.status = 'declined'; return json({ status: 'declined' }) }
    }
    return origFetch(input, init)
  }
  // Mark installed so the runner can detect readiness via browser_evaluate.
  window.__ENGAGR_E2E_MOCK__ = true
})()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
