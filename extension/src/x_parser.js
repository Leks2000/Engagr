/**
 * x_parser.js — Content script for X/Twitter feed parsing.
 * Runs on x.com / twitter.com pages.
 *
 * Fixed: X is a SPA — tweets may not be in DOM when the content script
 * first fires. We now wait (MutationObserver + polling) until tweets appear
 * before trying to parse, and return an async response to the background.
 */

;(function () {
  'use strict'

  if (window.__ENGAGR_X_PARSER_LOADED__) return
  window.__ENGAGR_X_PARSER_LOADED__ = true

  const READY_TIMEOUT_MS = 8000
  const RETRY_INTERVAL_MS = 400
  const MAX_TWEETS = 15

  const SELECTORS = {
    tweetArticle: 'article[data-testid="tweet"]',
    userName: '[data-testid="User-Name"]',
    tweetText: '[data-testid="tweetText"]',
    replyButton: '[data-testid="reply"]',
    retweetButton: '[data-testid="retweet"]',
    likeButton: '[data-testid="like"]',
    unlikeButton: '[data-testid="unlike"]',
    timeElement: 'time',
  }

  // ── SPA readiness ─────────────────────────────────────────

  function hasTweets() {
    return document.querySelectorAll(SELECTORS.tweetArticle).length > 0
  }

  function waitForTweets() {
    return new Promise((resolve) => {
      if (hasTweets()) { resolve(true); return }

      const started = Date.now()

      const timer = setInterval(() => {
        if (hasTweets() || Date.now() - started > READY_TIMEOUT_MS) {
          clearInterval(timer)
          observer.disconnect()
          resolve(hasTweets())
        }
      }, RETRY_INTERVAL_MS)

      const observer = new MutationObserver(() => {
        if (hasTweets()) {
          clearInterval(timer)
          observer.disconnect()
          resolve(true)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
  }

  // ── Tweet parsing ─────────────────────────────────────────

  function parseTweetArticle(article) {
    try {
      const userNameEl = article.querySelector(SELECTORS.userName)
      if (!userNameEl) return null

      const displayNameEl = userNameEl.querySelector('span span')
      const displayName = displayNameEl?.textContent?.trim() || ''

      const handleLinks = userNameEl.querySelectorAll('a[href^="/"]')
      let handle = ''
      for (const link of handleLinks) {
        const text = link.textContent.trim()
        if (text.startsWith('@')) { handle = text; break }
        const spans = link.querySelectorAll('span')
        for (const span of spans) {
          if (span.textContent.trim().startsWith('@')) { handle = span.textContent.trim(); break }
        }
        if (handle) break
      }

      if (!handle && handleLinks.length > 0) {
        const href = handleLinks[0].getAttribute('href') || ''
        if (href.startsWith('/') && href.split('/').length === 2 && href.length > 1) {
          handle = `@${href.slice(1)}`
        }
      }

      const tweetTextEl = article.querySelector(SELECTORS.tweetText)
      const tweetText = tweetTextEl?.textContent?.trim() || ''

      if (!tweetText && !displayName) return null

      let tweetUrl = ''
      const timeEl = article.querySelector(SELECTORS.timeElement)
      if (timeEl) {
        const timeLink = timeEl.closest('a')
        if (timeLink) {
          const href = timeLink.getAttribute('href') || ''
          tweetUrl = href.startsWith('/') ? `https://x.com${href}` : (href.startsWith('http') ? href : '')
        }
      }

      const getMetric = (testId) => {
        const btn = article.querySelector(`[data-testid="${testId}"]`)
        if (!btn) return 0
        const ariaLabel = btn.getAttribute('aria-label') || ''
        const match = ariaLabel.match(/(\d[\d,.]*)\s/)
        if (match) return parseInt(match[1].replace(/[,.\s]/g, ''), 10) || 0
        const span = btn.querySelector('span span')
        if (span) { const num = parseInt(span.textContent.replace(/[,.\s]/g, ''), 10); return isNaN(num) ? 0 : num }
        return 0
      }

      const metrics = {
        replies: getMetric('reply'),
        retweets: getMetric('retweet'),
        likes: getMetric('like') || getMetric('unlike'),
      }

      const isLiked = !!article.querySelector(SELECTORS.unlikeButton)

      // ── Media extraction (images + videos) ───────────────────────────────
      const media = []
      const seenMedia = new Set()
      const abs = (src) => { if (!src) return ''; const r = String(src).split(' ')[0].split(',')[0]; try { return new URL(r, window.location.origin).toString() } catch (_) { return r.startsWith('http') ? r : '' } }

      // Photos
      article.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => {
        const url = abs(img.getAttribute('src') || img.getAttribute('srcset') || '')
        if (url && !seenMedia.has(url)) { seenMedia.add(url); media.push({ type: 'image', url }) }
      })
      // Video player: prefer the video src, fall back to poster image
      const vidEl = article.querySelector('[data-testid="videoPlayer"] video')
      if (vidEl) {
        const src = abs(vidEl.getAttribute('src') || vidEl.querySelector('source')?.getAttribute('src') || '')
        const poster = abs(vidEl.getAttribute('poster') || '')
        const key = src || poster
        if (key && !seenMedia.has(key)) {
          seenMedia.add(key)
          media.push({ type: 'video', url: src, thumbnail: poster })
        }
      }
      // Animated GIF / looped video without the videoPlayer testid
      article.querySelectorAll('video[poster]').forEach((v) => {
        const src = abs(v.getAttribute('src') || '')
        const poster = abs(v.getAttribute('poster') || '')
        const key = src || poster
        if (key && !seenMedia.has(key)) { seenMedia.add(key); media.push({ type: 'video', url: src, thumbnail: poster }) }
      })

      const hasMedia = media.length > 0 ||
        !!article.querySelector('[data-testid="card.wrapper"]')
      const timestamp = timeEl?.getAttribute('datetime') || ''

      return {
        author: displayName || handle || 'Unknown',
        handle: handle || '',
        post: tweetText,
        url: tweetUrl,
        metrics,
        isLiked,
        hasMedia,
        media,
        timestamp,
        platform: 'x',
      }
    } catch (err) {
      console.debug('[Engagr X Parser] Error parsing tweet:', err)
      return null
    }
  }

  function parseXFeed() {
    const articles = document.querySelectorAll(SELECTORS.tweetArticle)
    const tweets = []
    const seen = new Set()

    for (const article of articles) {
      const data = parseTweetArticle(article)
      if (!data || !data.post) continue
      const key = data.url || `${data.handle}:${data.post.slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)
      tweets.push(data)
      if (tweets.length >= MAX_TWEETS) break
    }
    return tweets
  }

  // ── Message Listener ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false

    if (message.type === 'ENGAGR_PARSE_X_FEED') {
      waitForTweets().then((ready) => {
        const tweets = parseXFeed()
        sendResponse({
          ok: true,
          ready,
          posts: tweets,
          count: tweets.length,
          parsedAt: new Date().toISOString(),
          url: window.location.href,
        })
      })
      return true  // async sendResponse
    }

    if (message.type === 'ENGAGR_GET_CURRENT_TWEET') {
      waitForTweets().then((ready) => {
        const articles = document.querySelectorAll(SELECTORS.tweetArticle)
        if (articles.length > 0) {
          const mainTweet = parseTweetArticle(articles[0])
          sendResponse({ ok: !!mainTweet, ready, tweet: mainTweet })
        } else {
          sendResponse({ ok: false, ready: false, error: 'No tweet found on this page' })
        }
      })
      return true
    }

    if (message.type === 'ENGAGR_CHECK_X_PARSER') {
      sendResponse({ ok: true, parser: 'x_parser', version: '0.2.0' })
      return true
    }

    return false
  })

  console.debug('[Engagr X Parser] Loaded on', window.location.href)
})()
