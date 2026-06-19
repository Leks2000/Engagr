(() => {
  const WAIT_TIMEOUT_MS = 12000
  const WAIT_INTERVAL_MS = 250

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

  function activityIdFromUrl(url) {
    return String(url || '').match(/urn:li:activity:(\d+)/)?.[1] || ''
  }

  function findPostCard(targetUrl) {
    const activityId = activityIdFromUrl(targetUrl)

    if (activityId) {
      const byUrn = document.querySelector(
        `[data-urn*="urn:li:activity:${activityId}"], [data-id*="urn:li:activity:${activityId}"]`
      )
      if (byUrn) return byUrn.closest('.feed-shared-update-v2') || byUrn
    }

    // Single post page: the main update card is the only one rendered.
    const cards = document.querySelectorAll('.feed-shared-update-v2, [data-urn^="urn:li:activity"]')
    if (cards.length === 1) return cards[0]
    if (/\/feed\/update\//.test(window.location.href) && cards.length) return cards[0]

    return null
  }

  function findActionButton(root, patterns) {
    const scope = root || document
    const buttons = [...scope.querySelectorAll('button')]

    return buttons.find((button) => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`.toLowerCase()
      return patterns.some((pattern) => label.includes(pattern))
    }) || null
  }

  function findCommentEditor(root) {
    const scope = root || document
    return (
      scope.querySelector('.comments-comment-box .ql-editor') ||
      scope.querySelector('.comments-comment-texteditor .ql-editor') ||
      scope.querySelector('[contenteditable="true"][role="textbox"]') ||
      scope.querySelector('.ql-editor[contenteditable="true"]')
    )
  }

  function insertEditorText(editor, text) {
    editor.focus()

    // LinkedIn comment boxes use a Quill contenteditable. Setting innerHTML
    // directly often leaves the "Post" button disabled because Quill's
    // internal model is not updated. execCommand('insertText') is the most
    // reliable way to make React/Quill pick up the change, so try it first.
    let injected = false
    try {
      const sel = window.getSelection()
      sel.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      sel.addRange(range)
      // Clear any existing content via selectAll + delete, then insert.
      document.execCommand('selectAll', false, null)
      document.execCommand('insertText', false, text)
      injected = (editor.textContent || '').trim().length > 0
    } catch (e) {
      // fall through to manual DOM injection
    }

    if (!injected) {
      editor.innerHTML = ''
      const paragraph = document.createElement('p')
      paragraph.textContent = text
      editor.appendChild(paragraph)
    }

    // Fire a broad set of events so any framework listener (Quill, React,
    // LinkedIn's own) registers the change and enables the Post button.
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }))
    editor.dispatchEvent(new Event('change', { bubbles: true }))
    editor.dispatchEvent(new Event('blur', { bubbles: true }))

    // Place caret at the end so the user can edit before publishing.
    try {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    } catch (e) {
      /* ignore */
    }
  }

  async function prepareComment(payload) {
    const card = await waitFor(() => findPostCard(payload.url))
    const scope = card || document

    let editor = findCommentEditor(scope)

    if (!editor) {
      const commentButton = findActionButton(scope, ['comment', 'комментар'])
      if (commentButton) {
        commentButton.click()
        editor = await waitFor(() => findCommentEditor(scope))
      }
    }

    if (!editor) {
      return { ok: false, error: 'Comment editor not found. Open the post and try again.' }
    }

    insertEditorText(editor, payload.comment || '')
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' })

    return {
      ok: true,
      prepared: 'comment',
      note: 'Comment inserted. Review the text and click Post yourself.',
    }
  }

  async function likePost(payload) {
    const card = await waitFor(() => findPostCard(payload.url))
    const scope = card || document

    const likeButton = findActionButton(scope, ['like', 'нравится', 'react like'])
    if (!likeButton) {
      return { ok: false, error: 'Like button not found on this page.' }
    }

    const pressed = likeButton.getAttribute('aria-pressed') === 'true'
    if (pressed) {
      return { ok: true, prepared: 'like', alreadyDone: true, note: 'Post is already liked.' }
    }

    likeButton.click()
    return { ok: true, prepared: 'like', note: 'Like reaction sent.' }
  }

  async function prepareConnect(payload) {
    const connectButton = await waitFor(() => findActionButton(document, ['connect', 'установить контакт']))
    if (!connectButton) {
      // Maybe we're already connected — look for "Message"/"Pending" state.
      const messageBtn = findActionButton(document, ['message', 'сообщение'])
      if (messageBtn) {
        return { ok: true, prepared: 'connect', alreadyDone: true, note: 'Already connected.' }
      }
      return { ok: false, error: 'Connect button not found. Open the author profile and try again.' }
    }

    connectButton.scrollIntoView({ behavior: 'smooth', block: 'center' })
    connectButton.click()

    // If an invite note was prepared, drop it into the "Add a note" textarea when present.
    if (payload.message) {
      const addNoteButton = await waitFor(
        () => findActionButton(document, ['add a note', 'добавить заметку']),
        4000
      )
      if (addNoteButton) {
        addNoteButton.click()
        const textarea = await waitFor(
          () => document.querySelector('textarea#custom-message, textarea[name="message"]'),
          4000
        )
        if (textarea) {
          textarea.focus()
          textarea.value = payload.message
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
    }

    // ── Auto-send the connection request ────────────────────────────
    // Click the "Send"/"Add"/"Done" button that appears in the connect dialog.
    const sendButton = await waitFor(
      () => {
        // Prefer an explicit Send button inside the modal; avoid the original
        // Connect button which we already clicked.
        const btns = [...document.querySelectorAll('button')]
          .filter(b => !b.disabled && b !== connectButton)
        return btns.find(b => {
          const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase()
          return ['send', 'add', 'done', 'отправить', 'готово', 'connect', 'send now']
            .some(p => label.includes(p))
        })
      },
      5000
    )

    if (sendButton) {
      sendButton.click()
      await sleep(800)
      return { ok: true, prepared: 'connect', submitted: true, note: 'Connection request sent automatically.' }
    }

    return {
      ok: true,
      prepared: 'connect',
      note: 'Connect dialog opened. Review and send the invite yourself.',
    }
  }

  async function autoSubmitComment() {
    // Find and click the "Post" button in the comment box. Prefer buttons that
    // are NOT disabled (LinkedIn disables Post until the editor has text).
    const submitBtn = (() => {
      const candidates = [...document.querySelectorAll('button')]
      // Exact-text match first (most reliable for the comment composer)
      const exact = candidates.find(btn => {
        const text = (btn.textContent || '').trim().toLowerCase()
        return (text === 'post' || text === 'comment' || text === 'отправить') && !btn.disabled
      })
      if (exact) return exact
      // aria-label fallback
      const labeled = candidates.find(btn => {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase()
        return (label.includes('post comment') || label.includes('submit') || label.includes('отправить')) && !btn.disabled
      })
      return labeled || null
    })()

    if (!submitBtn) {
      // Wait a moment in case the editor is still syncing its model, then retry once.
      await sleep(700)
      const retry = [...document.querySelectorAll('button')].find(btn => {
        const text = (btn.textContent || '').trim().toLowerCase()
        return (text === 'post' || text === 'comment' || text === 'отправить') && !btn.disabled
      })
      if (retry) {
        retry.click()
        await sleep(1200)
        return { ok: true, submitted: true, note: 'Comment posted automatically.' }
      }
      return { ok: false, error: 'Post button not found (or still disabled — comment text may not have registered).' }
    }

    submitBtn.click()
    await sleep(1200)

    // Verify: the comment composer should have cleared or a new comment row appeared.
    const editor = findCommentEditor(document)
    const editorEmpty = editor && (editor.textContent || '').trim().length === 0
    return {
      ok: true,
      submitted: true,
      verified: !!editorEmpty,
      note: editorEmpty ? 'Comment posted automatically.' : 'Post clicked; verify manually.',
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handlers = {
      ENGAGR_PREPARE_COMMENT: prepareComment,
      ENGAGR_LIKE_POST: likePost,
      ENGAGR_PREPARE_CONNECT: prepareConnect,
      ENGAGR_AUTO_SUBMIT_COMMENT: autoSubmitComment,
    }

    const handler = handlers[message?.type]
    if (!handler) return false

    handler(message.payload || {})
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Action failed.' }))

    return true
  })
})()
