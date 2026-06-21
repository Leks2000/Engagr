/**
 * reddit_parser.js — Content script for Reddit feed parsing.
 * Runs on reddit.com pages (new and old Reddit).
 *
 * Extracts post data from Reddit feeds:
 *  - Post title & body text
 *  - Author (u/username)
 *  - Subreddit (r/name)
 *  - Post URL
 *  - Score (upvotes)
 *  - Comment count
 *
 * Handles both new Reddit (SPA) and old Reddit (classic).
 * Waits for SPA content to render before parsing.
 */

;(function () {
  'use strict'

  if (window.__ENGAGR_REDDIT_PARSER_LOADED__) return
  window.__ENGAGR_REDDIT_PARSER_LOADED__ = true

  const MAX_POSTS = 12
  const READY_TIMEOUT_MS = 8000
  const RETRY_INTERVAL_MS = 400

  // ── New Reddit (SPA) selectors ────────────────────────────

  const NEW_REDDIT_POST_SELECTORS = [
    // shreddit (2024 redesign)
    'shreddit-post',
    '[data-testid="post-container"]',
    '[data-testid="post-content"]',
    // Classic new Reddit
    'div[data-fullname^="t3_"]',
    '[data-testid^="post-rtjson-content"]',
    '.Post',
    // Feed listing
    '[data-click-id="body"]',
  ]

  // ── Old Reddit selectors ──────────────────────────────────

  const OLD_REDDIT_POST_SELECTOR = '.thing.link:not(.promoted)'

  // ── Helpers ───────────────────────────────────────────────

  function isOldReddit() {
    return document.querySelector('#header-img[alt="reddit"]') !== null ||
           document.querySelector('.reddit-header-small') !== null ||
           document.body.classList.contains('reddit') ||
           window.location.hostname === 'old.reddit.com'
  }

  function isNewReddit() {
    return (
      document.querySelector('shreddit-app') !== null ||
      document.querySelector('[data-testid="subreddit-list"]') !== null ||
      document.querySelector('shreddit-post') !== null ||
      document.querySelector('[slot="post-media-content"]') !== null
    )
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function absUrl(src) {
    if (!src) return ''
    const raw = String(src).split(' ')[0].split(',')[0]
    try { return new URL(raw, window.location.origin).toString() } catch (_) { return raw.startsWith('http') ? raw : '' }
  }

  // ── Media extraction (shared by old + new Reddit) ────────────────────────
  // Pulls up to 6 image / video attachments. Skips subreddit logos / avatars
  // via a small size threshold and an allow-list of gallery/post containers.
  // Also reads lazy-load attributes (data-src, data-delayed-url, data-perf-url,
  // srcset) so the real CDN URL is captured even before the image decodes.
  function imgBestUrl(img) {
    // Prefer the highest-resolution candidate from srcset, then fall back to
    // lazy attributes, then the regular src.
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
      img.getAttribute('data-perf-url') ||
      img.getAttribute('data-img-perf-url') ||
      ''
    )
  }

  function extractMediaFrom(root, isOld) {
    const media = []
    const seen = new Set()
    const push = (m) => { const key = m.url || m.thumbnail || ''; if (key && !seen.has(key)) { seen.add(key); media.push(m) } }

    if (isOld) {
      // Old Reddit: .thumbnail img, gallery img, video embed
      root.querySelectorAll('.thumbnail img, a.thumbnail img').forEach((img) => {
        const url = imgBestUrl(img)
        const rect = img.getBoundingClientRect()
        if (url && rect.width >= 50) push({ type: 'image', url })
      })
      root.querySelectorAll('img.title').forEach((img) => {
        const url = imgBestUrl(img)
        if (url) push({ type: 'image', url })
      })
      // Old Reddit video: <video> inside the thing, or preview.redd.it poster
      root.querySelectorAll('video').forEach((v) => {
        const src = absUrl(v.getAttribute('src') || v.querySelector('source')?.getAttribute('src') || '')
        const poster = absUrl(v.getAttribute('poster') || '')
        push({ type: 'video', url: src, thumbnail: poster })
      })
    } else {
      // New Reddit / shreddit
      root.querySelectorAll('img[data-testid="post-image"], img.post-image, gallery-carousel img, shreddit-post img').forEach((img) => {
        const url = imgBestUrl(img)
        const rect = img.getBoundingClientRect()
        if (url && (rect.width >= 60 || !rect.width)) push({ type: 'image', url })
      })
      root.querySelectorAll('video').forEach((v) => {
        const src = absUrl(v.getAttribute('src') || v.querySelector('source')?.getAttribute('src') || '')
        const poster = absUrl(v.getAttribute('poster') || '')
        push({ type: 'video', url: src, thumbnail: poster })
      })
      // shreddit-gallery / media-preview slot
      root.querySelectorAll('[slot="post-media-content"] img, [data-testid="post-content"] img').forEach((img) => {
        const url = imgBestUrl(img)
        if (url) push({ type: 'image', url })
      })
    }
    // Fallback: og:image meta tag (covers link posts / embeds with no inline img)
    if (media.length === 0) {
      const og = document.querySelector('meta[property="og:image"], meta[name="og:image"]')
      const ogUrl = absUrl(og?.getAttribute('content') || '')
      if (ogUrl) push({ type: 'image', url: ogUrl })
    }
    return media.slice(0, 6)
  }

  // ── Old Reddit parser ─────────────────────────────────────

  function parseOldRedditPost(el) {
    try {
      const titleEl = el.querySelector('a.title')
      const title = normalizeText(titleEl?.textContent)
      if (!title) return null

      const url = titleEl?.href || ''
      const postUrl = url.startsWith('http') ? url : `https://www.reddit.com${url}`

      // Author
      const authorEl = el.querySelector('.author')
      const author = normalizeText(authorEl?.textContent)

      // Subreddit
      const subEl = el.querySelector('.subreddit')
      const subreddit = normalizeText(subEl?.textContent).replace(/^r\//, '')

      // Score
      const scoreEl = el.querySelector('.score.unvoted, .score.likes, .score.dislikes')
      const scoreText = scoreEl?.getAttribute('title') || scoreEl?.textContent || '0'
      const score = parseInt(scoreText.replace(/[^0-9]/g, '')) || 0

      // Comment count
      const commentsEl = el.querySelector('.comments')
      const commentsText = commentsEl?.textContent || '0'
      const comments = parseInt(commentsText.replace(/[^0-9]/g, '')) || 0

      // Self-text (body)
      const selfTextEl = el.querySelector('.usertext-body .md')
      const bodyText = normalizeText(selfTextEl?.textContent)

      const postText = bodyText || title
      const media = extractMediaFrom(el, true)

      return {
        author: author ? `u/${author.replace(/^u\//, '')}` : 'Unknown',
        post: postText,
        title,
        url: postUrl,
        subreddit: subreddit || '',
        score,
        comments,
        media,
        has_media: media.length > 0,
        platform: 'reddit',
      }
    } catch (err) {
      console.debug('[Engagr Reddit Parser] Old Reddit parse error:', err)
      return null
    }
  }

  // ── New Reddit (shreddit) parser ──────────────────────────

  function parseNewRedditPost(el) {
    try {
      // shreddit-post web component
      if (el.tagName && el.tagName.toLowerCase() === 'shreddit-post') {
        const title = normalizeText(el.getAttribute('post-title') || el.querySelector('[slot="title"]')?.textContent)
        if (!title) return null

        const permalink = el.getAttribute('permalink') || ''
        const url = permalink ? `https://www.reddit.com${permalink}` : ''
        const author = el.getAttribute('author') || ''
        const subreddit = el.getAttribute('subreddit-prefixed-name') || el.getAttribute('subreddit') || ''
        const score = parseInt(el.getAttribute('score') || '0') || 0
        const commentCount = parseInt(el.getAttribute('comment-count') || '0') || 0

        // Try to get body text
        const bodyEl = el.querySelector('[slot="post-media-content"] p, .post-content p, [data-adclicklocation="media"] p')
        const bodyText = normalizeText(bodyEl?.textContent)

        const media = extractMediaFrom(el, false)

        return {
          author: author ? `u/${author.replace(/^u\//, '')}` : 'Unknown',
          post: bodyText || title,
          title,
          url,
          subreddit: subreddit.replace(/^r\//, ''),
          score,
          comments: commentCount,
          media,
          has_media: media.length > 0,
          platform: 'reddit',
        }
      }

      // Classic new Reddit post container
      const titleEl = el.querySelector('h3, [data-testid="post-title"], ._eYtD2XCVieq6emjKBH3m')
      const title = normalizeText(titleEl?.textContent)
      if (!title || title.length < 3) return null

      // URL — look for permalink
      let url = ''
      const linkEl = el.querySelector('a[data-click-id="body"], a[href*="/comments/"]')
      if (linkEl) {
        const href = linkEl.getAttribute('href') || ''
        url = href.startsWith('http') ? href : `https://www.reddit.com${href}`
      }

      // Author
      const authorEl = el.querySelector('[data-testid="post_author_link"], a[href^="/user/"]')
      const author = normalizeText(authorEl?.textContent)

      // Subreddit
      const subEl = el.querySelector('[data-testid="subreddit-name"], a[href^="/r/"]')
      const subreddit = normalizeText(subEl?.textContent).replace(/^r\//, '')

      // Score
      const scoreEl = el.querySelector('[data-testid="vote-count"], ._1rZYMD_4xY3gRcSS3p8ODO')
      const scoreText = normalizeText(scoreEl?.textContent) || '0'
      const score = parseInt(scoreText.replace(/[^0-9kK.]/g, '')) || 0

      // Body text
      const bodyEl = el.querySelector('[data-testid="post-content"] p, .RichTextJSON-root p, ._292iotee39Lmt0MkQZ2hPV p')
      const bodyText = normalizeText(bodyEl?.textContent)

      const postText = bodyText || title
      const media = extractMediaFrom(el, false)

      return {
        author: author ? `u/${author.replace(/^u\//, '')}` : 'Unknown',
        post: postText,
        title,
        url,
        subreddit,
        score,
        comments: 0,
        media,
        has_media: media.length > 0,
        platform: 'reddit',
      }
    } catch (err) {
      console.debug('[Engagr Reddit Parser] New Reddit parse error:', err)
      return null
    }
  }

  // ── Main feed parser ──────────────────────────────────────

  function parseRedditFeed() {
    const posts = []
    const seen = new Set()

    if (isOldReddit()) {
      const items = document.querySelectorAll(OLD_REDDIT_POST_SELECTOR)
      for (const el of items) {
        const parsed = parseOldRedditPost(el)
        if (!parsed || !parsed.post) continue
        const key = parsed.url || parsed.title
        if (seen.has(key)) continue
        seen.add(key)
        posts.push(parsed)
        if (posts.length >= MAX_POSTS) break
      }
      return posts
    }

    // New Reddit / shreddit
    const candidates = new Set()
    for (const selector of NEW_REDDIT_POST_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach((el) => candidates.add(el))
      } catch (_) {}
    }

    for (const el of candidates) {
      const parsed = parseNewRedditPost(el)
      if (!parsed || !parsed.post || parsed.post.length < 5) continue
      const key = parsed.url || parsed.title
      if (seen.has(key)) continue
      seen.add(key)
      posts.push(parsed)
      if (posts.length >= MAX_POSTS) break
    }

    return posts
  }

  // ── SPA readiness ─────────────────────────────────────────

  function hasPosts() {
    if (isOldReddit()) return document.querySelectorAll(OLD_REDDIT_POST_SELECTOR).length > 0
    // shreddit or new Reddit
    return (
      document.querySelectorAll('shreddit-post').length > 0 ||
      document.querySelectorAll('[data-testid="post-container"]').length > 0 ||
      document.querySelectorAll('[data-fullname^="t3_"]').length > 0
    )
  }

  function waitForPosts() {
    return new Promise((resolve) => {
      if (hasPosts()) { resolve(true); return }

      const started = Date.now()

      const timer = setInterval(() => {
        if (hasPosts() || Date.now() - started > READY_TIMEOUT_MS) {
          clearInterval(timer)
          observer.disconnect()
          resolve(hasPosts())
        }
      }, RETRY_INTERVAL_MS)

      const observer = new MutationObserver(() => {
        if (hasPosts()) {
          clearInterval(timer)
          observer.disconnect()
          resolve(true)
        }
      })
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true })
    })
  }

  // ── Message handler ───────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false

    if (message.type === 'ENGAGR_PARSE_REDDIT_FEED') {
      waitForPosts().then((ready) => {
        const posts = parseRedditFeed()
        sendResponse({
          ok: true,
          ready,
          posts,
          count: posts.length,
          parsedAt: new Date().toISOString(),
          url: window.location.href,
          isOldReddit: isOldReddit(),
          isNewReddit: isNewReddit(),
        })
      })
      return true  // async sendResponse
    }

    if (message.type === 'ENGAGR_CHECK_REDDIT_PARSER') {
      sendResponse({ ok: true, parser: 'reddit_parser', version: '1.0.0' })
      return true
    }

    return false
  })

  console.debug('[Engagr Reddit Parser] Loaded on', window.location.href, '| oldReddit:', isOldReddit())
})()
