if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let refreshing = false
    // The very first install has no previous controller: the new worker (skipWaiting + clientsClaim) just takes
    // control of this page. That is not an update, so it must not reload the page (it threw away a click made in the
    // first ~300 ms). Only a controller CHANGE, i.e. a new version replacing one that already controlled the page, reloads.
    let hadController = !!navigator.serviceWorker.controller

    // Attach before register() so controllerchange is never missed
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        hadController = true
        return
      }
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(reg => {
        // Force update check every hour for long-running sessions
        setInterval(() => reg.update(), 60 * 60 * 1000)
      })
  })
}
