/**
 * Shared test fixtures: mock queue items + a helper to install a mock backend
 * on a Playwright page so the harness runs fully offline.
 *
 * The mock mirrors the real Engagr API surface the Mini App calls:
 *   GET  /api/settings/<id>           → onboarding + language
 *   PUT  /api/settings/<id>           → persist language
 *   GET  /api/queue/<id>?status=all   → feed items
 *   POST /api/queue/<id>/<itemId>/regenerate → AI variants
 *   POST /api/queue/<id>/<itemId>/select     → pick variant
 *   POST /api/queue/<id>/<itemId>/approve    → approve
 *   POST /api/queue/<id>/<itemId>/skip       → skip
 *   POST /api/queue/<id>/<itemId>/decline    → decline
 *   POST /api/queue/<id>/translate-all       → no-op (mock already translated)
 */

export const USER_ID = 'e2e_user'

export const pendingItem = {
  id: 'item-pending-1',
  platform: 'linkedin',
  action: 'comment',
  status: 'pending',
  author: 'Jane Doe',
  author_name: 'Jane Doe',
  post_text: 'We just shipped our new AI search feature — it cuts research time by 40%.',
  post_excerpt: 'We just shipped our new AI search feature — it cuts research time by 40%.',
  post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:123/',
  post_language: 'en',
  user_language: 'en',
  comment_variants: [
    'Congrats on the launch! The 40% time saving is huge for research teams.',
    'This is a big deal — faster research means faster decisions. Well done.',
    'Love seeing AI applied to real workflow pain. How did you measure the 40%?',
  ],
  selected_comment: 'Congrats on the launch! The 40% time saving is huge for research teams.',
  comment: 'Congrats on the launch! The 40% time saving is huge for research teams.',
  translations: null,
  post_text_translated: null,
  has_media: false,
  media: [],
  created_at: '2026-06-19T10:00:00.000Z',
}

export const newPostItem = {
  id: 'item-new-1',
  platform: 'x',
  action: 'comment',
  status: 'new_post',
  author: '@devnews',
  author_name: '@devnews',
  post_text: 'Breaking: new JS framework promises zero-config SSR with edge rendering.',
  post_excerpt: 'Breaking: new JS framework promises zero-config SSR with edge rendering.',
  post_url: 'https://x.com/devnews/status/999',
  post_language: 'en',
  user_language: 'en',
  comment_variants: [],
  selected_comment: '',
  comment: '',
  translations: null,
  post_text_translated: null,
  has_media: false,
  media: [],
  created_at: '2026-06-19T11:00:00.000Z',
}

export const mediaItem = {
  id: 'item-media-1',
  platform: 'reddit',
  action: 'comment',
  status: 'pending',
  author: 'u/poster',
  author_name: 'u/poster',
  post_text: 'Check out this sunset from the trail today 🌅',
  post_excerpt: 'Check out this sunset from the trail today 🌅',
  post_url: 'https://www.reddit.com/r/EarthPorn/comments/abc/',
  post_language: 'en',
  user_language: 'en',
  comment_variants: ['Stunning colors! Where exactly was this taken?'],
  selected_comment: 'Stunning colors! Where exactly was this taken?',
  comment: 'Stunning colors! Where exactly was this taken?',
  translations: null,
  post_text_translated: null,
  has_media: true,
  media: [
    { type: 'image', url: 'https://placehold.co/600x400/png' },
  ],
  created_at: '2026-06-19T12:00:00.000Z',
}

/**
 * Install a fully-mocked backend on the given page. `items` is the queue list
 * the feed will see. Mutations (select/approve/skip/decline) update an
 * in-memory store so subsequent GET /api/queue reflects the new status.
 */
export async function installMockBackend(page, { items = [], language = 'en', proxyFails = false } = {}) {
  // Intercept the media-proxy image request at the network layer. <img src>
  // loading bypasses the window.fetch override below (the browser's image
  // loader does not go through fetch), so we must fulfil it here. When
  // proxyFails is set we simulate the CDN hotlink 403 that MediaPreview's
  // graceful fallback is designed for.
  await page.route('**/api/media/proxy**', async (route) => {
    if (proxyFails) {
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'upstream 403' })
    } else {
      // 1x1 transparent PNG — enough for the <img> to decode successfully.
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
          'base64',
        ),
      })
    }
  })

  // In-memory mutable store scoped to this page
  await page.addInitScript(([storeItems, storeLang, userId, storeProxyFails]) => {
    window.__ENGAGR_MOCK__ = {
      userId,
      settings: { onboarding_completed: true, language: storeLang },
      queue: JSON.parse(JSON.stringify(storeItems)),
      proxyFails: storeProxyFails,
    }

    const match = (url, pattern) => {
      try { return new URL(url, window.location.origin).pathname === pattern } catch { return false }
    }
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    window.__ENGAGR_INSTALL__ = () => {
      // Intercept our own /api calls regardless of origin: the Mini App points
      // API_BASE at the production Railway URL (or a relative path), so a
      // same-origin check would miss the calls. We route by pathname instead.
      const origFetch = window.fetch.bind(window)
      window.fetch = async (input, init) => {
        let urlStr = typeof input === 'string' ? input : (input && input.url)
        if (!urlStr) return origFetch(input, init)
        const m = window.__ENGAGR_MOCK__

        let urlObj
        try { urlObj = new URL(urlStr, window.location.origin) } catch { return origFetch(input, init) }
        // Mock any request whose pathname starts with /api/ — that is the
        // entire Engagr backend surface. External URLs pass through.
        if (!urlObj.pathname.startsWith('/api/')) return origFetch(input, init)
        const path = urlObj.pathname
        const method = (init && init.method) || 'GET'

        // Settings
        if (match(urlStr, `/api/settings/${m.userId}`) && method === 'GET')
          return json(m.settings)
        if (match(urlStr, `/api/settings/${m.userId}`) && method === 'PUT') {
          const body = init && init.body ? JSON.parse(init.body) : {}
          m.settings = { ...m.settings, ...body }
          return json({ ok: true, ...m.settings })
        }

        // Queue GET
        if (match(urlStr, `/api/queue/${m.userId}`) && method === 'GET')
          return json(m.queue)

        // Media proxy: in tests we don't need a real CDN fetch. When
        // proxyFails is set we simulate a hotlink 403 (used by the
        // fallback/regression test); otherwise return a 1x1 PNG so the
        // <img> decodes successfully and MediaPreview shows inline.
        if (path === '/api/media/proxy' && method === 'GET') {
          if (m.proxyFails) return new Response('upstream 403', { status: 502 })
          // 1x1 transparent PNG
          const png = Uint8Array.from(atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
          ), c => c.charCodeAt(0))
          return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
        }

        // translate-all (no-op mock: items already in requested language)
        if (match(urlStr, `/api/queue/${m.userId}/translate-all`) && method === 'POST')
          return json({ ok: true, translated: m.queue.length })

        const itemPathRe = new RegExp(`^/api/queue/${m.userId}/([^/]+)/([^/]+)$`)
        const itemMatch = path.match(itemPathRe)
        if (itemMatch) {
          const [, itemId, action] = itemMatch
          const idx = m.queue.findIndex((i) => i.id === itemId)
          if (idx === -1) return json({ error: 'not found' }, 404)
          const item = m.queue[idx]
          if (action === 'regenerate' && method === 'POST') {
            const variants = [
              'Regenerated take 1 — sharp and on-topic.',
              'Regenerated take 2 — friendly and curious.',
              'Regenerated take 3 — concise and approving.',
            ]
            item.comment_variants = variants
            item.selected_comment = variants[0]
            item.comment = variants[0]
            item.status = 'pending'
            return json({ variants, comment: variants[0], post_language: 'en' })
          }
          if (action === 'select' && method === 'POST') {
            const body = init && init.body ? JSON.parse(init.body) : {}
            const v = item.comment_variants[body.variant_index] || item.comment_variants[0] || ''
            item.selected_comment = v
            item.comment = v
            return json({ comment: v })
          }
          if (action === 'approve' && method === 'POST') {
            item.status = 'approved'
            item.execution = 'extension'
            return json({ status: 'approved', execution: 'extension', action_chain: [] })
          }
          if (action === 'skip' && method === 'POST') {
            item.status = 'skipped'
            return json({ status: 'skipped' })
          }
          if (action === 'decline' && method === 'POST') {
            item.status = 'declined'
            return json({ status: 'declined' })
          }
        }
        return origFetch(input, init)
      }
    }
    // Install as early as possible
    window.__ENGAGR_INSTALL__()
  }, [items, language, USER_ID, proxyFails])
}

/** Convenience: open the app on the Feed screen and wait for it to render. */
export async function openFeed(page) {
  // Append user_id so the Mini App picks our mock identity.
  await page.goto(`/?user_id=${USER_ID}`)
  // The Feed heading is the most stable anchor for "app loaded".
  await page.getByRole('heading', { name: 'Feed', exact: true }).waitFor({ state: 'visible' })
}
