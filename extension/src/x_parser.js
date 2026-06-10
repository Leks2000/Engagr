/**
 * x_parser.js — Content script for X/Twitter feed parsing.
 * Runs on x.com / twitter.com pages.
 *
 * Extracts tweet data from the feed:
 *  - Author handle & display name
 *  - Tweet text content
 *  - Tweet URL
 *  - Engagement metrics (likes, retweets, replies)
 *  - Media presence
 *
 * Communicates with popup.js via chrome.runtime messages.
 */

;(function () {
  'use strict'

  if (window.__ENGAGR_X_PARSER_LOADED__) return
  window.__ENGAGR_X_PARSER_LOADED__ = true

  const SELECTORS = {
    // Tweet article containers
    tweetArticle: 'article[data-testid="tweet"]',
    // User info within tweet
    userName: '[data-testid="User-Name"]',
    // Tweet text
    tweetText: '[data-testid="tweetText"]',
    // Engagement buttons
    replyButton: '[data-testid="reply"]',
    retweetButton: '[data-testid="retweet"]',
    likeButton: '[data-testid="like"]',
    unlikeButton: '[data-testid="unlike"]',
    // Time element (contains permalink)
    timeElement: 'time',
  }

  /**
   * Extract tweet data from a tweet article element.
   */
  function parseTweetArticle(article) {
    try {
      // Get author info
      const userNameEl = article.querySelector(SELECTORS.userName)
      if (!userNameEl) return null

      // Display name is typically the first span with content
      const displayNameEl = userNameEl.querySelector('span span')
      const displayName = displayNameEl?.textContent?.trim() || ''

      // Handle (@username) - look for links containing @
      const handleLinks = userNameEl.querySelectorAll('a[href^="/"]')
      let handle = ''
      for (const link of handleLinks) {
        const text = link.textContent.trim()
        if (text.startsWith('@')) {
          handle = text
          break
        }
        // Sometimes handle is in nested spans
        const spans = link.querySelectorAll('span')
        for (const span of spans) {
          if (span.textContent.trim().startsWith('@')) {
            handle = span.textContent.trim()
            break
          }
        }
        if (handle) break
      }

      // If no @ handle found, try to extract from href
      if (!handle && handleLinks.length > 0) {
        const href = handleLinks[0].getAttribute('href') || ''
        if (href.startsWith('/') && !href.includes('/') && href.length > 1) {
          handle = `@${href.slice(1)}`
        }
      }

      // Get tweet text
      const tweetTextEl = article.querySelector(SELECTORS.tweetText)
      const tweetText = tweetTextEl?.textContent?.trim() || ''

      if (!tweetText && !displayName) return null

      // Get tweet URL from time element's parent link
      let tweetUrl = ''
      const timeEl = article.querySelector(SELECTORS.timeElement)
      if (timeEl) {
        const timeLink = timeEl.closest('a')
        if (timeLink) {
          const href = timeLink.getAttribute('href') || ''
          if (href.startsWith('/')) {
            tweetUrl = `https://x.com${href}`
          } else if (href.startsWith('http')) {
            tweetUrl = href
          }
        }
      }

      // Get engagement metrics
      const getMetric = (testId) => {
        const btn = article.querySelector(`[data-testid="${testId}"]`)
        if (!btn) return 0
        const ariaLabel = btn.getAttribute('aria-label') || ''
        const match = ariaLabel.match(/(\d[\d,.]*)\s/)
        if (match) {
          return parseInt(match[1].replace(/[,.\s]/g, ''), 10) || 0
        }
        // Try inner span text
        const span = btn.querySelector('span span')
        if (span) {
          const num = parseInt(span.textContent.replace(/[,.\s]/g, ''), 10)
          return isNaN(num) ? 0 : num
        }
        return 0
      }

      const metrics = {
        replies: getMetric('reply'),
        retweets: getMetric('retweet'),
        likes: getMetric('like') || getMetric('unlike'),
      }

      // Check if already liked
      const isLiked = !!article.querySelector(SELECTORS.unlikeButton)

      // Check for media
      const hasMedia = !!(
        article.querySelector('[data-testid="tweetPhoto"]') ||
        article.querySelector('[data-testid="videoPlayer"]') ||
        article.querySelector('[data-testid="card.wrapper"]')
      )

      // Timestamp
      const timestamp = timeEl?.getAttribute('datetime') || ''

      return {
        author: displayName || handle || 'Unknown',
        handle: handle || '',
        post: tweetText,
        url: tweetUrl,
        metrics,
        isLiked,
        hasMedia,
        timestamp,
        platform: 'x',
      }
    } catch (err) {
      console.debug('[Engagr X Parser] Error parsing tweet:', err)
      return null
    }
  }

  /**
   * Parse all visible tweets in the feed.
   */
  function parseXFeed() {
    const articles = document.querySelectorAll(SELECTORS.tweetArticle)
    const tweets = []
    const seen = new Set()

    for (const article of articles) {
      const data = parseTweetArticle(article)
      if (!data || !data.post) continue

      // Dedupe by URL or text hash
      const key = data.url || `${data.handle}:${data.post.slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)

      tweets.push(data)
    }

    return tweets
  }

  /**
   * Find the reply input box for the current tweet detail page.
   */
  function findReplyInput() {
    // On tweet detail page, reply box is a contenteditable div
    const replyBox = document.querySelector('[data-testid="tweetTextarea_0"]')
    return replyBox || null
  }

  // ─── Message Listener ────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false

    if (message.type === 'ENGAGR_PARSE_X_FEED') {
      const tweets = parseXFeed()
      sendResponse({
        ok: true,
        posts: tweets,
        count: tweets.length,
        parsedAt: new Date().toISOString(),
        url: window.location.href,
      })
      return true
    }

    if (message.type === 'ENGAGR_GET_CURRENT_TWEET') {
      // On a tweet detail page, parse the main tweet
      const articles = document.querySelectorAll(SELECTORS.tweetArticle)
      if (articles.length > 0) {
        const mainTweet = parseTweetArticle(articles[0])
        sendResponse({ ok: !!mainTweet, tweet: mainTweet })
      } else {
        sendResponse({ ok: false, error: 'No tweet found on this page' })
      }
      return true
    }

    if (message.type === 'ENGAGR_CHECK_X_PARSER') {
      sendResponse({ ok: true, parser: 'x_parser', version: '0.1.0' })
      return true
    }

    return false
  })

  console.debug('[Engagr X Parser] Loaded on', window.location.href)
})()
