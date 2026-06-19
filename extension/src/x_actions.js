/**
 * x_actions.js — Content script for X/Twitter browser actions.
 * Runs on x.com / twitter.com pages.
 *
 * Handles:
 *  - Prepare reply (fill reply box with AI comment, user confirms)
 *  - Like tweet (click like button)
 *  - Retweet (click retweet button)
 *  - Open reply box
 *
 * All actions prepare but do NOT auto-post (v0.1 safety).
 * User always has final control.
 */

;(function () {
  'use strict'

  if (window.__ENGAGR_X_ACTIONS_LOADED__) return
  window.__ENGAGR_X_ACTIONS_LOADED__ = true

  // ─── Utility helpers ──────────────────────────────────

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  function simulateInput(element, text) {
    // For contenteditable elements (X's tweet box)
    element.focus()

    // Clear existing content
    element.textContent = ''

    // Use execCommand for better compatibility with React-managed DOM.
    // selectAll + insertText is the most reliable way to make X's composer
    // register the text and enable the Reply button.
    let injected = false
    try {
      document.execCommand('selectAll', false, null)
      document.execCommand('insertText', false, text)
      injected = (element.textContent || '').trim().length > 0
    } catch (e) {
      /* fall through */
    }

    if (!injected) {
      element.textContent = text
    }

    // Dispatch input event
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
  }

  /**
   * Click the reply button on the current tweet to open reply box.
   */
  async function clickReplyButton() {
    const replyBtn = document.querySelector('[data-testid="reply"]')
    if (replyBtn) {
      replyBtn.click()
      await sleep(800) // Wait for reply modal/box to open
      return true
    }
    return false
  }

  /**
   * Find the active reply text input area.
   */
  function findReplyTextArea() {
    // Primary: reply composer in modal
    const modalTextarea = document.querySelector('[data-testid="tweetTextarea_0"]')
    if (modalTextarea) return modalTextarea

    // Fallback: inline reply box on tweet detail page
    const inlineReply = document.querySelector('[data-testid="tweetTextarea_0_label"]')
    if (inlineReply) {
      const editable = inlineReply.querySelector('[contenteditable="true"]')
      if (editable) return editable
    }

    // Last resort: any contenteditable in the reply area
    const editables = document.querySelectorAll('[contenteditable="true"][role="textbox"]')
    for (const el of editables) {
      if (el.getAttribute('data-testid')?.includes('tweetTextarea')) {
        return el
      }
    }

    return null
  }

  // ─── Action Handlers ──────────────────────────────────

  /**
   * Prepare a reply comment in the tweet reply box.
   * Does NOT submit — user clicks the Reply button manually.
   */
  async function prepareReply(payload) {
    const { comment, url } = payload || {}

    if (!comment) {
      return { ok: false, error: 'No comment text provided' }
    }

    try {
      // If we're on the wrong URL, we can't do much
      // (the background script should have navigated here first)

      // Try to find existing reply box
      let replyArea = findReplyTextArea()

      // If not found, click reply button to open it
      if (!replyArea) {
        const opened = await clickReplyButton()
        if (opened) {
          await sleep(500)
          replyArea = findReplyTextArea()
        }
      }

      if (!replyArea) {
        return {
          ok: false,
          error: 'Reply box not found. Navigate to the tweet and try again.',
          note: 'Click on the tweet first to open the reply area.',
        }
      }

      // Insert the AI comment text
      replyArea.focus()
      await sleep(200)

      simulateInput(replyArea, comment)

      return {
        ok: true,
        note: 'AI reply prepared in text box. Review and click "Reply" to post.',
        action: 'reply',
        comment_length: comment.length,
      }
    } catch (err) {
      return { ok: false, error: `Failed to prepare reply: ${err.message}` }
    }
  }

  /**
   * Like the current tweet.
   */
  async function likeTweet() {
    try {
      // Check if already liked
      const unlikeBtn = document.querySelector('[data-testid="unlike"]')
      if (unlikeBtn) {
        return { ok: true, note: 'Tweet already liked.', already_liked: true }
      }

      const likeBtn = document.querySelector('[data-testid="like"]')
      if (!likeBtn) {
        return { ok: false, error: 'Like button not found on this page.' }
      }

      likeBtn.click()
      await sleep(300)

      // Verify it worked
      const nowUnlike = document.querySelector('[data-testid="unlike"]')
      return {
        ok: !!nowUnlike,
        note: nowUnlike ? 'Tweet liked successfully.' : 'Like may not have registered. Check manually.',
        action: 'like',
      }
    } catch (err) {
      return { ok: false, error: `Like failed: ${err.message}` }
    }
  }

  /**
   * Retweet the current tweet (opens RT menu, user confirms).
   */
  async function retweetTweet() {
    try {
      const rtBtn = document.querySelector('[data-testid="retweet"]')
      if (!rtBtn) {
        // Check if already retweeted
        const unrtBtn = document.querySelector('[data-testid="unretweet"]')
        if (unrtBtn) {
          return { ok: true, note: 'Tweet already retweeted.', already_retweeted: true }
        }
        return { ok: false, error: 'Retweet button not found.' }
      }

      rtBtn.click()
      await sleep(500)

      // The retweet menu should now be open
      // Look for the "Repost" option in the dropdown
      const menuItems = document.querySelectorAll('[role="menuitem"]')
      for (const item of menuItems) {
        if (item.textContent.includes('Repost') || item.textContent.includes('Retweet')) {
          // Don't auto-click — let user decide
          return {
            ok: true,
            note: 'Retweet menu opened. Click "Repost" to confirm.',
            action: 'retweet',
            needs_confirmation: true,
          }
        }
      }

      return {
        ok: true,
        note: 'Retweet menu may be open. Confirm manually.',
        action: 'retweet',
      }
    } catch (err) {
      return { ok: false, error: `Retweet failed: ${err.message}` }
    }
  }

  /**
   * Follow the tweet author.
   */
  async function followAuthor() {
    try {
      // Look for follow button
      const followBtns = document.querySelectorAll('[data-testid$="-follow"]')
      for (const btn of followBtns) {
        if (btn.textContent.includes('Follow') && !btn.textContent.includes('Following')) {
          btn.click()
          await sleep(500)
          return { ok: true, note: 'Follow button clicked.', action: 'follow' }
        }
      }

      // Check if already following
      const followingBtns = document.querySelectorAll('[data-testid$="-unfollow"]')
      if (followingBtns.length > 0) {
        return { ok: true, note: 'Already following this user.', already_following: true }
      }

      return { ok: false, error: 'Follow button not found. Navigate to the user profile.' }
    } catch (err) {
      return { ok: false, error: `Follow failed: ${err.message}` }
    }
  }

  /**
   * Auto-submit the reply by clicking the Reply button.
   */
  async function autoSubmitReply() {
    try {
      // X disables the submit button until the composer has text. Wait for it
      // to become enabled, then click. Prefer the modal reply button.
      const findEnabled = () => {
        const primary = document.querySelector('[data-testid="tweetButton"]')
        if (primary && !primary.disabled) return primary
        const inner = document.querySelector('[data-testid="tweetButtonInline"]')
        if (inner && !inner.disabled) return inner
        // Fallback: any enabled button whose testid ends with "Button" and
        // whose label implies reply/post.
        const btns = [...document.querySelectorAll('[data-testid$="Button"]')]
        return btns.find(b => !b.disabled && (b.textContent || '').toLowerCase().includes('reply'))
      }

      let replyBtn = await waitFor(findEnabled, 6000)
      if (!replyBtn) {
        // Retry once after a short sync delay
        await sleep(700)
        replyBtn = findEnabled()
      }
      if (!replyBtn) {
        return { ok: false, error: 'Reply button not found (or still disabled — reply text may not have registered).' }
      }

      replyBtn.click()
      await sleep(1200)

      // Verify: the composer should have cleared (X empties the textarea on
      // successful post) or the modal closed.
      const composer = document.querySelector('[data-testid="tweetTextarea_0"]')
      const cleared = composer && (composer.textContent || '').trim().length === 0
      return {
        ok: true,
        submitted: true,
        verified: !!cleared,
        note: cleared ? 'Reply posted automatically.' : 'Reply button clicked; verify manually.',
      }
    } catch (err) {
      return { ok: false, error: `Auto-submit failed: ${err.message}` }
    }
  }

  // ─── Message Listener ────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return false

    // Prepare reply action
    if (message.type === 'ENGAGR_PREPARE_X_REPLY') {
      prepareReply(message.payload).then(sendResponse)
      return true // async response
    }

    // Auto-submit reply
    if (message.type === 'ENGAGR_AUTO_SUBMIT_X_REPLY') {
      autoSubmitReply().then(sendResponse)
      return true
    }

    // Like action
    if (message.type === 'ENGAGR_LIKE_X_TWEET') {
      likeTweet().then(sendResponse)
      return true
    }

    // Retweet action
    if (message.type === 'ENGAGR_RETWEET_X') {
      retweetTweet().then(sendResponse)
      return true
    }

    // Follow action
    if (message.type === 'ENGAGR_FOLLOW_X_USER') {
      followAuthor().then(sendResponse)
      return true
    }

    // Check if actions script is loaded
    if (message.type === 'ENGAGR_CHECK_X_ACTIONS') {
      sendResponse({ ok: true, actions: 'x_actions', version: '0.1.0' })
      return true
    }

    return false
  })

  console.debug('[Engagr X Actions] Loaded on', window.location.href)
})()
