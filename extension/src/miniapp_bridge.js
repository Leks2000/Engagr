(() => {
  const SOURCE = 'ENGAGR_MINI_APP'

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data || {}
    if (data.source !== SOURCE || data.type !== 'ENGAGR_MINI_APP_CONTEXT') return

    chrome.runtime.sendMessage({
      type: 'ENGAGR_SYNC_MINI_APP_CONTEXT',
      payload: data.payload || {},
    })
  })
})()
