;(() => {
  const MAX_POSTS = 12
  const READY_TIMEOUT_MS = 8000   // wait up to 8s for SPA to render
  const RETRY_INTERVAL_MS = 500

  // ── Post-card selectors (LinkedIn 2025) ──────────────────────────────────────
  const POST_SELECTORS = [
    '[data-urn^="urn:li:activity"]',
    '[data-id^="urn:li:activity"]',
    '[data-urn*="urn:li:activity"]',
    '[data-id*="urn:li:activity"]',
    '[data-activity-urn*="urn:li:activity"]',
    '[data-chameleon-result-urn*="urn:li:activity"]',
    '[data-view-name="feed-full-update"]',
    '[data-view-name*="feed-full"]',
    '[data-view-name*="feed-update"]',
    '.feed-shared-update-v2',
    '.fie-impression-container',
    '.occludable-update',
    'div[role="article"]',
    'div[data-finite-scroll-hotspot]',
  ]

  const CARD_CONTAINER_SELECTORS = [
    '.feed-shared-update-v2',
    '.fie-impression-container',
    '.occludable-update',
    '[data-view-name="feed-full-update"]',
    '[data-view-name*="feed-full"]',
    '[data-view-name*="feed-update"]',
    'div[role="article"]',
    'div[data-finite-scroll-hotspot]',
  ]

  const AUTHOR_SELECTORS = [
    '.update-components-actor__name span[aria-hidden="true"]',
    '.update-components-actor__name',
    '.feed-shared-actor__name span[aria-hidden="true"]',
    '.feed-shared-actor__name',
    '.update-components-actor__title span[aria-hidden="true"]',
    '[data-test-id="main-feed-activity-card__actor-name"]',
    'a[href*="/in/"] span[aria-hidden="true"]',
    'a[href*="/company/"] span[aria-hidden="true"]',
    '[class*="actor__name"] span[aria-hidden="true"]',
    '[class*="actor__name"]',
    '[class*="feed-shared-actor"]',
  ]

  const TEXT_SELECTORS = [
    '[data-test-id="main-feed-activity-card__commentary"]',
    '.update-components-update-v2__commentary',
    '.update-components-text',
    '.feed-shared-inline-show-more-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    'span[dir="ltr"]',
    '.break-words',
    '[class*="update-components-text"]',
    '[class*="commentary"]',
    '[class*="feed-shared-text"]',
  ]

  // ── Media selectors (LinkedIn 2025) ──────────────────────────────────────────
  const MEDIA_IMAGE_SELECTORS = [
    '.feed-shared-image img',
    'img.feed-shared-image__image',
    'img.update-components-image__image',
    '.feed-shared-mini-images img',
    '.update-components-article__image img',
    '.feed-shared-article__image img',
    '[data-test-id="feed-shared-image"] img',
    '.feed-shared-update-v2__content img',
  ]
  const MEDIA_VIDEO_SELECTORS = [
    'video.feed-shared-video__video',
    'video[src]',
    '.feed-shared-video',
    '.update-components-video',
    '.feed-shared-og-video',
  ]

  function absUrl(src) {
    if (!src) return ''
    const raw = String(src).split(' ')[0].split(',')[0]
    try { return new URL(raw, window.location.origin).toString() } catch (_) { return raw.startsWith('http') ? raw : '' }
  }

  // Pick the best URL from an <img>, honoring lazy-load attributes and the
  // highest-resolution candidate in srcset. LinkedIn lazy-loads post images
  // via data-delayed-url / data-img-perf-url, so a plain getAttribute('src')
  // often returns a placeholder or an empty string.
  function imgBestUrl(img) {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || ''
    if (srcset) {
      const best = srcset.split(',')
        .map(c => { const [u, w] = c.trim().split(/\s+/); const x = parseFloat((w || '').replace('w', '')) || 0; return { u, x } })
        .sort((a, b) => b.x - a.x)[0]
      if (best && best.u) return absUrl(best.u)
    }
    return absUrl(
      img.getAttribute('src') ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-delayed-url') ||
      img.getAttribute('data-img-perf-url') ||
      img.getAttribute('data-perf-url') ||
      ''
    )
  }

  // Extract up to 6 media attachments (images / videos) from a post card.
  // Avatars and tiny icons are skipped by a size threshold.
  function extractMedia(card) {
    const media = []
    const seen = new Set()
    for (const sel of MEDIA_IMAGE_SELECTORS) {
      try {
        card.querySelectorAll(sel).forEach((img) => {
          if (!isVisible(img)) return
          const url = imgBestUrl(img)
          if (!url || seen.has(url)) return
          const rect = img.getBoundingClientRect()
          if (rect.width < 50 && rect.height < 50) return
          seen.add(url); media.push({ type: 'image', url })
        })
      } catch (_) {}
    }
    for (const sel of MEDIA_VIDEO_SELECTORS) {
      try {
        card.querySelectorAll(sel).forEach((node) => {
          const tag = node.tagName && node.tagName.toLowerCase()
          if (tag === 'video') {
            const src = absUrl(node.getAttribute('src') || node.querySelector('source')?.getAttribute('src') || '')
            const poster = absUrl(node.getAttribute('poster') || '')
            if (src && !seen.has(src)) { seen.add(src); media.push({ type: 'video', url: src, thumbnail: poster }) }
            else if (poster && !seen.has(poster)) { seen.add(poster); media.push({ type: 'video', url: '', thumbnail: poster }) }
          } else {
            const poster = absUrl(node.querySelector('img')?.getAttribute('src') || node.querySelector('img')?.getAttribute('data-delayed-url') || '')
            if (poster && !seen.has(poster)) { seen.add(poster); media.push({ type: 'video', url: '', thumbnail: poster }) }
          }
        })
      } catch (_) {}
    }
    // Fallback: og:image meta tag (covers article/link posts with no inline img)
    if (media.length === 0) {
      const og = card.querySelector('meta[property="og:image"]') || document.querySelector('meta[property="og:image"], meta[name="og:image"]')
      const ogUrl = absUrl(og?.getAttribute('content') || '')
      if (ogUrl) { seen.add(ogUrl); media.push({ type: 'image', url: ogUrl }) }
    }
    return media.slice(0, 6)
  }

  const NON_POST_TEXT_PATTERNS = [
    /^promoted$/i,
    /^show translation$/i,
    /^see translation$/i,
    /^like$/i,
    /^comment$/i,
    /^repost$/i,
    /^send$/i,
    /^follow$/i,
    /^connect$/i,
    /^view profile$/i,
    /^\d+ (connection|follower|like|comment|repost)/i,
  ]

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/…\s*see more$/i, '')
      .replace(/see more$/i, '')
      .trim()
  }

  function isVisible(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') return false
    const rect = node.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function queryText(root, selectors) {
    for (const selector of selectors) {
      try {
        const nodes = [...root.querySelectorAll(selector)]
        for (const node of nodes) {
          if (!isVisible(node)) continue
          const text = normalizeText(node.innerText || node.textContent)
          if (text && text.length >= 8) return text
        }
      } catch (_) {}
    }
    return ''
  }

  function getActivityUrn(card) {
    const attrs = ['data-urn', 'data-id', 'data-activity-urn', 'data-chameleon-result-urn']
    for (const attr of attrs) {
      const value = card.getAttribute(attr) || ''
      if (value.includes('urn:li:activity')) return value
    }
    const urnNode = card.querySelector(
      '[data-urn*="urn:li:activity"], [data-id*="urn:li:activity"], ' +
      '[data-activity-urn*="urn:li:activity"], [data-chameleon-result-urn*="urn:li:activity"]'
    )
    if (urnNode) {
      for (const attr of attrs) {
        const value = urnNode.getAttribute(attr) || ''
        if (value.includes('urn:li:activity')) return value
      }
    }
    const activityLink = card.querySelector('a[href*="urn:li:activity"], a[href*="activity-"]')
    return activityLink?.href || activityLink?.getAttribute('href') || ''
  }

  function activityIdFromUrn(urn) {
    const value = String(urn || '')
    return (
      value.match(/urn:li:activity:(\d+)/)?.[1] ||
      value.match(/activity-(\d+)/)?.[1] ||
      ''
    )
  }

  function normalizeLinkedInUrl(href) {
    if (!href) return ''
    try {
      const url = new URL(href, window.location.origin)
      url.hash = ''
      if (url.hostname.endsWith('linkedin.com')) return url.toString()
    } catch (_) {}
    return ''
  }

  function findPostUrl(card, urn) {
    const permalinkSelectors = [
      'a[href*="/feed/update/"]',
      'a[href*="activity-"]',
      'a[href*="urn:li:activity"]',
      'a[href*="/posts/"]',
    ]
    for (const selector of permalinkSelectors) {
      const links = [...card.querySelectorAll(selector)]
      const found = links
        .map((link) => normalizeLinkedInUrl(link.href || link.getAttribute('href')))
        .find(Boolean)
      if (found) return found
    }
    const activityId = activityIdFromUrn(urn)
    return activityId
      ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
      : window.location.href
  }

  function cleanAuthor(author) {
    return normalizeText(author)
      .replace(/^View\s+/, '')
      .replace(/'s profile$/, '')
      .replace(/\s+Follow$/, '')
      .trim()
  }

  function hasBadTextPattern(text) {
    return NON_POST_TEXT_PATTERNS.some((pattern) => pattern.test(text))
  }

  function textLooksLikePost(text, author) {
    const normalized = normalizeText(text)
    if (normalized.length < 8) return false
    if (hasBadTextPattern(normalized)) return false
    if (author && normalized === cleanAuthor(author)) return false
    if (/^(Like|Comment|Repost|Send|Follow|Connect|View|Share)\s*$/.test(normalized)) return false
    return true
  }

  function findFallbackPostText(card, author) {
    const candidates = []
    for (const node of card.querySelectorAll('span[dir="ltr"]')) {
      if (!isVisible(node)) continue
      const text = normalizeText(node.innerText || node.textContent)
      if (textLooksLikePost(text, author)) candidates.push(text)
    }
    for (const node of card.querySelectorAll('[dir="ltr"], p, div')) {
      if (!isVisible(node)) continue
      const text = normalizeText(node.innerText || node.textContent)
      if (!textLooksLikePost(text, author)) continue
      if (text.includes('Like Comment Repost Send')) continue
      candidates.push(text)
    }
    candidates.sort((a, b) => b.length - a.length)
    return candidates[0] || ''
  }

  function parseCard(card) {
    const urn = getActivityUrn(card)
    const author = cleanAuthor(queryText(card, AUTHOR_SELECTORS))
    let post = queryText(card, TEXT_SELECTORS)
    if (!textLooksLikePost(post, author)) {
      post = findFallbackPostText(card, author)
    }
    const url = findPostUrl(card, urn)
    if (!textLooksLikePost(post, author)) return null
    const media = extractMedia(card)
    return {
      author: author || 'Unknown author',
      post,
      url,
      platform: 'linkedin',
      media,
      has_media: media.length > 0,
    }
  }

  function closestCard(node) {
    for (const selector of CARD_CONTAINER_SELECTORS) {
      const card = node.closest?.(selector)
      if (card) return card
    }
    let el = node.parentElement
    for (let i = 0; i < 10 && el; i++) {
      const rect = el.getBoundingClientRect()
      if (rect.height > 100 && rect.width > 200) return el
      el = el.parentElement
    }
    return node
  }

  function getCandidateCards() {
    const cards = new Set()
    for (const selector of POST_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach((node) => cards.add(closestCard(node)))
      } catch (_) {}
    }
    const arr = [...cards].filter(Boolean)
    return arr.filter((node, _i, list) => {
      return !list.some((other) => other !== node && other.contains(node))
    })
  }

  function parseLinkedInFeed() {
    const seen = new Set()
    const posts = []
    const candidates = getCandidateCards()

    for (const card of candidates) {
      const parsed = parseCard(card)
      if (!parsed) continue
      const key = parsed.url || `${parsed.author}:${parsed.post.slice(0, 120)}`
      if (seen.has(key)) continue
      seen.add(key)
      posts.push(parsed)
      if (posts.length >= MAX_POSTS) break
    }
    return posts
  }

  // ── Feed readiness check ─────────────────────────────────────────────────────
  // LinkedIn is a SPA — posts may not be in DOM when content script first runs.
  // We wait up to READY_TIMEOUT_MS for at least one post-card to appear.

  function hasFeedContent() {
    return getCandidateCards().length > 0
  }

  function waitForFeedContent() {
    return new Promise((resolve) => {
      if (hasFeedContent()) { resolve(true); return }

      const started = Date.now()

      // Polling fallback
      const timer = setInterval(() => {
        if (hasFeedContent() || Date.now() - started > READY_TIMEOUT_MS) {
          clearInterval(timer)
          observer.disconnect()
          resolve(hasFeedContent())
        }
      }, RETRY_INTERVAL_MS)

      // MutationObserver for faster response
      const observer = new MutationObserver(() => {
        if (hasFeedContent()) {
          clearInterval(timer)
          observer.disconnect()
          resolve(true)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
  }

  // ── Message handler ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ENGAGR_PARSE_LINKEDIN_FEED') return false

    waitForFeedContent().then((ready) => {
      const candidates = getCandidateCards()
      const posts = parseLinkedInFeed()
      sendResponse({
        ok: true,
        ready,
        posts,
        count: posts.length,
        candidateCount: candidates.length,
        parsedAt: new Date().toISOString(),
        url: window.location.href,
      })
    })

    return true  // async sendResponse
  })

  console.debug('[Engagr LinkedIn Parser] Loaded on', window.location.href)
})()
