// The entry stylesheets go into index.html as <style> instead of <link rel="stylesheet"> (build only). Measured
// 2026-11-08 on a production build (Chromium, phone viewport, gzip like nginx, cold cache, median of 7): first
// contentful paint 1 040 -> 320 ms on Slow 4G (150 ms RTT, 1.6 Mbit/s) and 244 -> 96 ms on a fast line, because the
// first paint no longer waits for a second request; 10 routes at 1440 and 390 px were pixel-identical to the <link>
// build. The cost is about 26 kB more gzip in index.html on a full page load that is not served by the service worker
// (index.html is no-cache; a repeat visit normally comes from the precache).
// Production CSP allows it: `style-src 'self' 'unsafe-inline'` (deploy/nginx.conf). The CSS only uses absolute
// url(/fonts/...) references, so moving it into the document does not change what they resolve to; a relative url()
// would, so the plugin refuses to inline a stylesheet that has one. The asset files stay in dist (precache, old links).
// Lazy route chunks keep their own CSS files. Each <style> is followed by a marker <link> (see inlineEntryCss). No
// dependency.
import type { Plugin } from 'vite'

const LINK_RE = /<link rel="stylesheet"(?: crossorigin)? href="\/(assets\/[^"]+\.css)">/g

/** Replaces every entry <link rel="stylesheet"> whose file is in `assets` with an inline <style>. */
export function inlineEntryCss(html: string, assets: Record<string, string>): string {
  return html.replace(LINK_RE, (tag, file: string) => {
    const css = assets[file]
    if (css === undefined) return tag
    if (/url\(\s*(?!['"]?(?:[a-z][a-z0-9+.-]*:|\/|#))/i.test(css)) throw new Error(`inline-css: ${file} has a relative url(); inlining would change what it points to`)
    if (css.includes('</style')) throw new Error(`inline-css: ${file} contains "</style"`)
    // The disabled, non-matching <link> is a marker, never applied and not render-blocking (Chromium and Firefox do not
    // even fetch a disabled stylesheet): Vite's preload helper skips a CSS dependency of a lazy chunk when the document
    // already has a <link rel="stylesheet"> with that URL, and without it it would load the same file a second time,
    // appended after the lazy route's own CSS (a changed cascade order).
    return `<style>${css}</style><link rel="stylesheet" href="/${file}" media="not all" disabled>`
  })
}

export function inlineCssPlugin(): Plugin {
  return {
    name: 'mintradar-inline-entry-css',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const assets: Record<string, string> = {}
        for (const [name, out] of Object.entries(ctx.bundle ?? {})) {
          if (out.type === 'asset' && name.endsWith('.css')) assets[name] = String(out.source)
        }
        return inlineEntryCss(html, assets)
      },
    },
  }
}
