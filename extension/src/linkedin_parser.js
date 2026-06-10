(() => {
  const MAX_POSTS = 12

  const POST_SELECTORS = [
    '[data-urn^="urn:li:activity"]',
    '[data-id^="urn:li:activity"]',
    '[data-urn*="urn:li:activity"]',
    '[data-id*="urn:li:activity"]',
    '.feed-shared-update-v2',
  ]

  const AUTHOR_SELECTORS = [
    '.update-components-actor__name span[aria-hidden="true"]',
    '.update-components-actor__name',
    '.feed-shared-actor__name span[aria-hidden="true"]',
    '.feed-shared-actor__name',
    '.update-components-actor__title span[aria-hidden="true"]',
    '.update-components-actor__title',
    '[data-test-id="main-feed-activity-card__actor-name"]',
  ]

  const TEXT_SELECTORS = [
    '[data-test-id="main-feed-activity-card__commentary"]',
    '.update-components-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-text',
    '.break-words',
  ]

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/…see more$/i, '')
      .replace(/see more$/i, '')
      .trim()
  }

  function queryText(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector)
      const text = normalizeText(node?.innerText || node?.textContent)
      if (text) return text
    }

    return ''
  }

  function getActivityUrn(card) {
    const directUrn = card.getAttribute('data-urn') || card.getAttribute('data-id') || ''
    if (directUrn.includes('urn:li:activity')) return directUrn

    const urnNode = card.querySelector('[data-urn*="urn:li:activity"], [data-id*="urn:li:activity"]')
    return urnNode?.getAttribute('data-urn') || urnNode?.getAttribute('data-id') || ''
  }

  function activityIdFromUrn(urn) {
    return String(urn || '').match(/urn:li:activity:(\d+)/)?.[1] || ''
  }

  function normalizeLinkedInUrl(href) {
    if (!href) return ''

    try {
      const url = new URL(href, window.location.origin)
      url.hash = ''

      if (url.hostname.endsWith('linkedin.com')) {
        return url.toString()
      }
    } catch {
      return ''
    }

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
    return activityId ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/` : window.location.href
  }

  function cleanAuthor(author) {
    return normalizeText(author)
      .replace(/^View\s+/, '')
      .replace(/'s profile$/, '')
      .replace(/\s+Follow$/, '')
      .trim()
  }

  function parseCard(card) {
    const urn = getActivityUrn(card)
    const author = cleanAuthor(queryText(card, AUTHOR_SELECTORS))
    const post = queryText(card, TEXT_SELECTORS)
    const url = findPostUrl(card, urn)

    if (!post || post.length < 8) return null

    return {
      author: author || 'Unknown author',
      post,
      url,
    }
  }

  function getCandidateCards() {
    const cards = new Set()

    for (const selector of POST_SELECTORS) {
      document.querySelectorAll(selector).forEach((node) => cards.add(node))
    }

    return [...cards]
      .map((node) => node.closest('.feed-shared-update-v2') || node)
      .filter((node, index, list) => node && list.indexOf(node) === index)
  }

  function parseLinkedInFeed() {
    const seen = new Set()
    const posts = []

    for (const card of getCandidateCards()) {
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'ENGAGR_PARSE_LINKEDIN_FEED') return false

    const posts = parseLinkedInFeed()
    sendResponse({ ok: true, posts, parsedAt: new Date().toISOString() })
    return false
  })
})()
