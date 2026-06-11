;(() => {
  const MAX_POSTS = 12

  // ── Post-card selectors (LinkedIn 2025) ──────────────────────────────────────
  // LinkedIn changes classes frequently. We use multiple fallbacks from broad to narrow.
  const POST_SELECTORS = [
    // Activity URN attributes — most reliable
    '[data-urn^="urn:li:activity"]',
    '[data-id^="urn:li:activity"]',
    '[data-urn*="urn:li:activity"]',
    '[data-id*="urn:li:activity"]',
    '[data-activity-urn*="urn:li:activity"]',
    '[data-chameleon-result-urn*="urn:li:activity"]',
    // View name attributes — 2024/2025
    '[data-view-name="feed-full-update"]',
    '[data-view-name*="feed-full"]',
    '[data-view-name*="feed-update"]',
    // Classic CSS classes
    '.feed-shared-update-v2',
    '.fie-impression-container',
    '.occludable-update',
    // Generic article/region fallback
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

  // ── Author selectors ─────────────────────────────────────────────────────────
  const AUTHOR_SELECTORS = [
    // 2024-2025 actor component
    '.update-components-actor__name span[aria-hidden="true"]',
    '.update-components-actor__name',
    // Legacy feed-shared actor
    '.feed-shared-actor__name span[aria-hidden="true"]',
    '.feed-shared-actor__name',
    // Title fallback
    '.update-components-actor__title span[aria-hidden="true"]',
    '[data-test-id="main-feed-activity-card__actor-name"]',
    // Profile link text
    'a[href*="/in/"] span[aria-hidden="true"]',
    'a[href*="/company/"] span[aria-hidden="true"]',
    // 2025 redesign candidates
    '[class*="actor__name"] span[aria-hidden="true"]',
    '[class*="actor__name"]',
    '[class*="feed-shared-actor"]',
  ]

  // ── Post text selectors ──────────────────────────────────────────────────────
  const TEXT_SELECTORS = [
    // 2025 new selectors
    '[data-test-id="main-feed-activity-card__commentary"]',
    '.update-components-update-v2__commentary',
    // Common text wrappers
    '.update-components-text',
    '.feed-shared-inline-show-more-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    // Text direction attribute — reliable in 2025
    'span[dir="ltr"]',
    // Generic but works for most
    '.break-words',
    '[class*="update-components-text"]',
    '[class*="commentary"]',
    // Absolute fallback
    '[class*="feed-shared-text"]',
  ]

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
      } catch (_) {
        // ignore invalid selectors
      }
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
    } catch (_) { /* ignore */ }
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
    // Reject pure action/button text
    if (/^(Like|Comment|Repost|Send|Follow|Connect|View|Share)\s*$/.test(normalized)) return false
    return true
  }

  /**
   * Fallback: scan all visible text nodes inside the card,
   * pick the longest one that looks like real post content.
   */
  function findFallbackPostText(card, author) {
    const candidates = []

    // Try span[dir="ltr"] — LinkedIn puts post body there in 2025
    for (const node of card.querySelectorAll('span[dir="ltr"]')) {
      if (!isVisible(node)) continue
      const text = normalizeText(node.innerText || node.textContent)
      if (textLooksLikePost(text, author)) candidates.push(text)
    }

    // General visible text nodes
    for (const node of card.querySelectorAll('[dir="ltr"], p, div')) {
      if (!isVisible(node)) continue
      const text = normalizeText(node.innerText || node.textContent)
      if (!textLooksLikePost(text, author)) continue
      if (text.includes('Like Comment Repost Send')) continue
      candidates.push(text)
    }

    // Sort by length — longest is most likely the post body
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

    return {
      author: author || 'Unknown author',
      post,
      url,
      platform: 'linkedin',
    }
  }

  function closestCard(node) {
    for (const selector of CARD_CONTAINER_SELECTORS) {
      const card = node.closest?.(selector)
      if (card) return card
    }
    // Walk up to find a sufficiently large container
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
      } catch (_) { /* ignore */ }
    }

    // Dedup: if one element is an ancestor of another, keep only the ancestor
    const arr = [...cards].filter(Boolean)
    return arr.filter((node, _i, list) => {
      // Keep node only if no other node in list is an ancestor of it
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

  // ── Message handler ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ENGAGR_PARSE_LINKEDIN_FEED') return false

    const candidates = getCandidateCards()
    const posts = parseLinkedInFeed()

    sendResponse({
      ok: true,
      posts,
      count: posts.length,
      candidateCount: candidates.length,
      parsedAt: new Date().toISOString(),
      url: window.location.href,
    })
    return false
  })
})()
