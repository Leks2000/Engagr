/**
 * reddit_actions.js — Content script for Reddit browser actions.
 * Runs on reddit.com pages (new Reddit / shreddit and old Reddit).
 *
 * Handles:
 *  - Prepare comment (open comment box + fill AI text)
 *  - Auto-submit comment (click the Comment / Reply button)
 *  - Upvote (click the upvote arrow / button)
 *
 * Message protocol (mirrors linkedin_actions.js / x_actions.js):
 *  - ENGAGR_PREPARE_REDDIT_COMMENT   { payload: { url, comment } }
 *  - ENGAGR_AUTO_SUBMIT_REDDIT_COMMENT
 *  - ENGAGR_REDDIT_UPVOTE            { payload: { url } }
 *  - ENGAGR_CHECK_REDDIT_ACTIONS
 */

;(function () {
  'use strict'

  if (window.__ENGAGR_REDDIT_ACTIONS_LOADED__) return
  window.__ENGAGR_REDDIT_ACTIONS_LOADED__ = true

  const WAIT_TIMEOUT_MS = 12000
  const WAIT_INTERVAL_MS = 250

  // ─── Utility helpers ──────────────────────────────────

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function waitFor(getter, timeout = WAIT_TIMEOUT_MS) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeout) {
      const value = getter()
      if (value) return value
      await sleep(WAIT_INTERVAL_MS)
    }
    return null
  }

  function isOldReddit() {
    return (
      document.querySelector('#header-img[alt="reddit"]') !== null ||
      document.querySelector('.reddit-header-small') !== null ||
      document.body.classList.contains('reddit') ||
      window.location.hostname === 'old.reddit.com'
    )
  }

  function postIdFromUrl(url) {
    return String(url || '').match(/\/comments\/([a-z0-9]+)/i)?.[1] || ''
  }

  // ─── New Reddit (shreddit) helpers ────────────────────

  /**
   * On a comments page the comment composer is rendered near the top.
   * Returns the contenteditable / textarea used to type a top-level comment.
   */
  function findNewRedditCommentEditor() {
    // shreddit-comment-composer (2024 redesign) — richtext or markdown
    const composer = document.querySelector(
      'shreddit-composer, shreddit-comment-composer, [data-testid="comment-composer"]'
    )
    if (composer) {
      const editor =
        composer.querySelector('[contenteditable="true"], .ql-editor, [role="textbox"]') ||
        composer.querySelector('textarea')
      if (editor) return editor
    }

    // Classic new Reddit composer
    return (
      document.querySelector('[contenteditable="true"][data-lexical-editor]') ||
      document.querySelector('.CommentBox .ql-editor[contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('textarea[name="body"], textarea[placeholder*="comment" i]') ||
      null
    )
  }

  /**
   * The "Add a comment" trigger that opens the composer on new Reddit.
   */
  function findAddCommentTrigger() {
    return (
      document.querySelector('[data-testid="comment-composer"] button') ||
      document.querySelector('shreddit-post [slot="add-comment"]') ||
      [...document.querySelectorAll('button')].find((b) => {
        const t = (b.textContent || '').trim().toLowerCase()
        return t === 'add a comment' || t === 'add comment' || t === 'view full post'
      }) ||
      null
    )
  }

  /**
   * The submit button for posting a top-level comment on new Reddit.
   */
  function findNewRedditSubmitButton() {
    return (
      document.querySelector('faceplate-tracker[noun="submit_comment"] button') ||
      document.querySelector('button[type="submit"][data-testid="comment-submit"]') ||
      document.querySelector('shreddit-composer button[type="submit"]') ||
      document.querySelector('shreddit-comment-composer button[type="submit"]') ||
      [...document.querySelectorAll('button')].find((b) => {
        const t = (b.textContent || '').trim().toLowerCase()
        return t === 'comment' || t === 'reply' || t === 'post comment'
      }) ||
      null
    )
  }

  /**
   * The upvote control on a comments page (new Reddit / shreddit).
   * Returns the upvote arrow button (not already upvoted).
   */
  function findNewRedditUpvoteButton() {
    // shreddit-post vote button (aria-pressed false means not yet upvoted)
    const voteBtn = document.querySelector(
      'shreddit-post [aria-label*="upvote" i], shreddit-post button[name="upvote"]'
    )
    if (voteBtn) {
      const pressed = voteBtn.getAttribute('aria-pressed')
      if (pressed === 'true') return { already: true, button: voteBtn }
      return { already: false, button: voteBtn }
    }

    // Classic new Reddit upvote arrow
    const arrow = document.querySelector(
      '[data-testid="up-button"], button[aria-label="upvote" i], .vote-button .up'
    )
    if (arrow) {
      const pressed = arrow.getAttribute('aria-pressed')
      if (pressed === 'true') return { already: true, button: arrow }
      return { already: false, button: arrow }
    }
    return null
  }

  // ─── Old Reddit helpers ───────────────────────────────

  function findOldRedditCommentEditor() {
    // On a comments page the main reply form
    return (
      document.querySelector('textarea[name="text"]') ||
      document.querySelector('.usertext-edit textarea') ||
      null
    )
  }

  function findOldRedditSubmitButton() {
    return (
      document.querySelector('.usertext-edit button[type="submit"]') ||
      document.querySelector('button.save') ||
      null
    )
  }

  function findOldRedditUpvoteButton(postId) {
    // arrow up on the post thing — .arrow.up contains the post id in the parent
    const things = document.querySelectorAll('.thing.link, .thing')
    for (const thing of things) {
      const id = thing.getAttribute('data-fullname') || ''
      if (postId && id !== postId) continue
      const up = thing.querySelector('.arrow.up:not(.upmod)')
      if (up) return { already: false, button: up }
      const upmod = thing.querySelector('.arrow.upmod')
      if (upmod) return { already: true, button: upmod }
    }
    return null
  }

  // ─── Input simulation ─────────────────────────────────

  function setTextContentEditable(el, text) {
    el.focus()
    el.textContent = ''
    // execCommand gives best compatibility with React/Lit-managed DOM
    try {
      document.execCommand('insertText', false, text)
    } catch (_) {
      el.textContent = text
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function setTextarea(el, text) {
    el.focus()
    el.value = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // ─── Action handlers ──────────────────────────────────

  /**
   * Prepare a top-level comment on the current Reddit post.
   * Opens the composer if needed and fills it with the AI text.
   */
  async function prepareComment(payload) {
    const { comment } = payload || {}
    if (!comment) return { ok: false, error: 'No comment text provided' }

    try {
      const old = isOldReddit()

      if (old) {
        let editor = findOldRedditCommentEditor()
        if (!editor) {
          // Need to open the reply form on old reddit
          const replyBtn =
            document.querySelector('.thing.link .buttons a[href*="comment"]') ||
            document.querySelector('a[href*="/submit"]')
          if (replyBtn) {
            replyBtn.click()
            await sleep(600)
          }
          editor = await waitFor(findOldRedditCommentEditor, 4000)
        }
        if (!editor) return { ok: false, error: 'Old Reddit comment box not found.' }
        setTextarea(editor, comment)
        return {
          ok: true,
          note: 'Comment prepared. Review and click Comment to post.',
          action: 'comment',
          comment_length: comment.length,
        }
      }

      // New Reddit / shreddit
      let editor = findNewRedditCommentEditor()
      if (!editor) {
        const trigger = findAddCommentTrigger()
        if (trigger) {
          trigger.click()
          await sleep(700)
        }
        editor = await waitFor(findNewRedditCommentEditor, 6000)
      }

      if (!editor) {
        return {
          ok: false,
          error: 'Reddit comment box not found. Navigate to the post comments page and try again.',
        }
      }

      if (editor.tagName && editor.tagName.toLowerCase() === 'textarea') {
        setTextarea(editor, comment)
      } else {
        setTextContentEditable(editor, comment)
      }

      return {
        ok: true,
        note: 'Comment prepared. Review and click Comment to post.',
        action: 'comment',
        comment_length: comment.length,
      }
    } catch (err) {
      return { ok: false, error: `Failed to prepare comment: ${err.message}` }
    }
  }

  /**
   * Auto-submit the prepared comment by clicking the Comment button.
   */
  async function autoSubmitComment() {
    try {
      const old = isOldReddit()
      const btn = old
        ? await waitFor(findOldRedditSubmitButton, 4000)
        : await waitFor(findNewRedditSubmitButton, 6000)

      if (!btn) {
        return { ok: false, error: 'Comment submit button not found. Please click Comment manually.' }
      }

      btn.click()
      await sleep(1500)

      return { ok: true, submitted: true, note: 'Comment posted automatically.' }
    } catch (err) {
      return { ok: false, error: `Auto-submit failed: ${err.message}` }
    }
  }

  /**
   * Upvote the current post.
   */
  async function upvotePost(payload) {
    const { url } = payload || {}
    const postId = postIdFromUrl(url)
    try {
      const old = isOldReddit()
      const found = old
        ? findOldRedditUpvoteButton(postId)
        : findNewRedditUpvoteButton()

      if (!found) {
        return { ok: false, error: 'Upvote button not found on this page.' }
      }
      if (found.already) {
        return { ok: true, note: 'Post already upvoted.', already_upvoted: true, action: 'upvote' }
      }

      found.button.click()
      await sleep(500)
      return { ok: true, note: 'Upvote clicked.', action: 'upvote' }
    } catch (err) {
      return { ok: false, error: `Upvote failed: ${err.message}` }
    }
  }

  // ─── Message listener ─────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false

    if (message.type === 'ENGAGR_PREPARE_REDDIT_COMMENT') {
      prepareComment(message.payload).then(sendResponse)
      return true
    }

    if (message.type === 'ENGAGR_AUTO_SUBMIT_REDDIT_COMMENT') {
      autoSubmitComment().then(sendResponse)
      return true
    }

    if (message.type === 'ENGAGR_REDDIT_UPVOTE') {
      upvotePost(message.payload).then(sendResponse)
      return true
    }

    if (message.type === 'ENGAGR_CHECK_REDDIT_ACTIONS') {
      sendResponse({ ok: true, actions: 'reddit_actions', version: '0.1.0' })
      return true
    }

    return false
  })

  console.debug('[Engagr Reddit Actions] Loaded on', window.location.href, '| oldReddit:', isOldReddit())
})()
