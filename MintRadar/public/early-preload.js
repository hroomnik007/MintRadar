// Starts the request of the mint list while the app bundle is still downloading (index.html, `async`).
// Only on "/" (Dashboard) and "/mint/:url" (MintDetail, whose description/LCP waits on the same list; it is a lazy
// chunk, so without this the request starts only after index + MintDetail + its nostr/db vendors have run).
// "/mint/nostr/:naddr" (MintNaddr, two segments) does not read it on load and is not matched. The HTML shell is
// shared by every route and the CSP has no inline script (script-src 'self'), so the route check lives in this file instead of in a static <link> in index.html. A preload on a route that never reads
// the list would download it for nothing and print "preloaded but not used" in the console.
// Must match fetchKnownMints (src/hooks/useKnownMints.ts): same URL, same-origin credentials, no headers. `crossorigin`
// is required for as="fetch" even on the same origin; without it the response is not reused and the request goes out
// twice. Plain script, no imports: Vite does not bundle public/, and nginx caches it for a year (the page links it
// as /early-preload.js?v=<hash>, see vite-brand-assets.ts). Pinned by src/__tests__/earlyPreload.test.ts.
(function () {
  var p = location.pathname
  if (p !== '/' && !/^\/mint\/[^/]+\/?$/.test(p)) return
  var link = document.createElement('link')
  link.setAttribute('rel', 'preload')
  link.setAttribute('as', 'fetch')
  link.setAttribute('href', '/api/mints/known')
  link.setAttribute('crossorigin', 'anonymous')
  document.head.appendChild(link)
})()
