if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let refreshing = false

    // Attach before register() so controllerchange is never missed
    navigator.serviceWorker.addEventListener('controllerchange', () => {
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
