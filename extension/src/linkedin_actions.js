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

    // Quill-style contenteditable used by LinkedIn comment boxes.
    editor.innerHTML = ''
    const paragraph = document.createElement('p')
    paragraph.textContent = text
    editor.appendChild(paragraph)

    editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    editor.dispatchEvent(new Event('change', { bubbles: true }))

    // Place caret at the end so the user can edit before publishing.
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
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

    return {
      ok: true,
      prepared: 'connect',
      note: 'Connect dialog opened. Review and send the invite yourself.',
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handlers = {
      ENGAGR_PREPARE_COMMENT: prepareComment,
      ENGAGR_LIKE_POST: likePost,
      ENGAGR_PREPARE_CONNECT: prepareConnect,
    }

    const handler = handlers[message?.type]
    if (!handler) return false

    handler(message.payload || {})
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Action failed.' }))

    return true
  })
})()
