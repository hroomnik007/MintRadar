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
        // Update check for pages that stay open: when the page becomes visible again (at most once per 30 min) and
        // once per hour while it is visible. sw.js is served no-cache, so this is one revalidation request, nothing
        // else. One listener and one timer per page, never re-created. A failed check is silent.
        const MIN_GAP_MS = 30 * 60 * 1000
        const HOURLY_MS = 60 * 60 * 1000
        let lastCheck = Date.now() // register() itself has just fetched sw.js
        const check = () => {
          lastCheck = Date.now()
          try {
            Promise.resolve(reg.update()).catch(() => {})
          } catch {
            // ignore: a failed update check must never surface
          }
        }
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible' && Date.now() - lastCheck >= MIN_GAP_MS) check()
        })
        setInterval(() => {
          if (document.visibilityState === 'visible') check()
        }, HOURLY_MS)
      })
  })
}
