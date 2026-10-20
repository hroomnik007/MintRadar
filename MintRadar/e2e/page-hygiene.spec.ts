import { test, expect, type Page } from '@playwright/test'
import { AUDIT_ROUTES, loadRoute } from './fixtures/pageAudit'
import { layoutReady, networkQuiet, trackRequests } from './fixtures/settle'

// What a visitor's browser would complain about on every main route, at phone widths, against mocks only:
//   no console errors or warnings (no allow-list: the console must be empty), no uncaught page errors, no failed request and no
//   response with status >= 400 (the icon proxy answers 204 for an icon it cannot serve), no securitypolicyviolation, no horizontal
//   overflow, no element wider than the viewport, no visible text with "undefined", "NaN", "null", "[object", "{{" or "Infinity",
//   every <img> loaded (a mint icon the proxy answers 204 for falls back to the monogram), and no request to a host other than the
//   app: anything else is aborted AND fails the test.

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 320, height: 640 }] as const
const APP_ORIGIN = 'http://localhost:5173'

// Relay websocket warnings would show up as console messages too: the relays are mocked here (routeWebSocket answers EOSE to every
// REQ), so one appearing is a regression to look at, not noise.

const BAD_TEXT = /undefined|NaN|\bnull\b|\[object|\{\{|Infinity/
// /for-wallets documents the API: "null" is a word of its contract there ("null when unknown"), so on that route only the
// other placeholders are looked for. Code blocks (pre / code) quote source text and are never looked at.
const BAD_TEXT_DOC_API = /undefined|NaN|\[object|\{\{|Infinity/

async function guardNetwork(page: Page, strangers: string[]) {
  // Page routes (the mocks) win over this one; it only sees what the mocks did not handle.
  await page.context().route(url => !url.href.startsWith(APP_ORIGIN) && !/^(data|blob|about):/.test(url.href), route => {
    strangers.push(route.request().url())
    return route.abort('blockedbyclient')
  })
}

for (const vp of VIEWPORTS) {
  for (const route of AUDIT_ROUTES) {
    test(`${route.id} at ${vp.width}x${vp.height}: clean console, no failed requests, no overflow, no placeholder text`, async ({ page }) => {
      const problems: string[] = []
      const strangers: string[] = []
      const badResponses: string[] = []
      const failed: string[] = []
      const unmocked: string[] = []
      const iconRequests: string[] = []

      await page.addInitScript(() => {
        const w = window as unknown as { __csp: string[] }
        w.__csp = []
        document.addEventListener('securitypolicyviolation', e => { w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`) })
      })
      page.on('console', m => {
        if (m.type() !== 'error' && m.type() !== 'warning') return
        problems.push(`console ${m.type()}: ${m.text().slice(0, 200)} (${m.location().url})`)
      })
      page.on('request', r => { if (r.url().includes('/api/mint/icon')) iconRequests.push(r.url()) })
      page.on('pageerror', e => { problems.push(`page error: ${e.message}`) })
      page.on('requestfailed', r => { failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`) })
      page.on('response', r => {
        if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`)
      })
      await guardNetwork(page, strangers)
      trackRequests(page)
      await page.setViewportSize(vp)
      // The lowest-priority route (registered first): an /api request no mock handles is reported, not sent to the dev proxy.
      await page.route('**/api/**', r => { unmocked.push(new URL(r.request().url()).pathname); return r.fulfill({ status: 501, json: { error: 'no mock' } }) })
      await page.route('**/api/mint/icon**', r => r.fulfill({ status: 204 }))
      await loadRoute(page, route)
      await networkQuiet(page)
      await layoutReady(page)

      const dom = await page.evaluate(() => {
        const root = document.documentElement
        const visible = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
        const desc = (e: Element) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`
        // Inside its own horizontal scroller (a code block, a table wrapper) an element may be wider than the viewport.
        const inScroller = (e: Element) => { for (let p = e.parentElement; p && p !== root; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && p.getBoundingClientRect().right <= root.clientWidth + 1) return true } return false }
        const wide = Array.from(document.body.querySelectorAll('*')).filter(e => visible(e) && !e.closest('svg') && e.getBoundingClientRect().right > root.clientWidth + 1 && !inScroller(e)).map(desc)
        const texts: string[] = []
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement
          if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || el.closest('pre, code') || !visible(el)) continue
          const t = (n.textContent ?? '').trim()
          if (t) texts.push(t)
        }
        const imgs = Array.from(document.images).filter(visible).map(i => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0, desc: desc(i) }))
        return {
          overflow: root.scrollWidth - root.clientWidth,
          wide: wide.slice(0, 8),
          texts,
          imgs,
          csp: (window as unknown as { __csp: string[] }).__csp,
          monograms: document.querySelectorAll('[role=img][aria-label$="mint icon placeholder"]').length,
          iconImgs: document.querySelectorAll('img[src*="/api/mint/icon"]').length,
        }
      })

      expect(unmocked, 'API requests that no mock handles').toEqual([])
      expect(problems, 'console errors / warnings / page errors').toEqual([])
      expect(strangers, 'requests to a host other than the app (aborted)').toEqual([])
      expect(badResponses, 'responses with status >= 400').toEqual([])
      expect(failed, 'failed requests').toEqual([])
      expect(dom.csp, 'securitypolicyviolation events').toEqual([])
      expect(dom.overflow, 'horizontal overflow (scrollWidth - clientWidth)').toBeLessThanOrEqual(0)
      expect(dom.wide, 'elements wider than the viewport').toEqual([])
      expect(dom.texts.filter(t => (route.id === 'for-wallets' ? BAD_TEXT_DOC_API : BAD_TEXT).test(t)), 'visible text with a placeholder value').toEqual([])
      expect(dom.imgs.filter(i => !i.ok), 'images that did not load').toEqual([])
      // The mocked icon proxy answers 204 No Content (what the real one does for an icon it cannot serve; a 404 would print a console
      // error on every request): a mint icon must have been replaced by the monogram, not left as a broken <img>.
      expect(dom.iconImgs, 'no broken icon <img> is left behind').toBe(0)
      // The 204 path must really have been exercised: these two states show mints that claim an icon.
      if (route.id === 'home' || route.id === 'mint-icon') expect(iconRequests.length, 'the icon proxy was asked').toBeGreaterThan(0)
      if (route.id === 'home' || route.id === 'mint-icon') expect(dom.monograms, 'the mint icons show the monogram fallback').toBeGreaterThan(0)
    })
  }
}
