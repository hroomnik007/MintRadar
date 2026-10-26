import { expect, type Page } from '@playwright/test'

// Shared checks of the two static documentation pages (/methodology, /for-wallets).

export const DOC_WIDTHS = [320, 390, 768, 1440] as const

/** Records the host of every request and WebSocket the page makes (the app's own origin is allowed). */
export function recordHosts(page: Page): { hosts: () => string[] } {
  const hosts = new Set<string>()
  page.on('request', r => { try { hosts.add(new URL(r.url()).host) } catch { /* data: and blob: URLs have no host */ } })
  page.on('websocket', ws => { try { hosts.add(new URL(ws.url()).host) } catch { /* ignore */ } })
  return { hosts: () => [...hosts] }
}

export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready) // text widths settle once the web fonts are in
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(m.sw, `${label}: page scrollWidth ${m.sw} vs clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw)
}

/** Every scroll box (table wrapper, code block) of the page lies inside the viewport. */
export async function expectBoxesInsideViewport(page: Page, selector: string, width: number): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right } }))
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(-0.5)
    expect(b.right).toBeLessThanOrEqual(width + 0.5)
  }
}

/** Internal links of `main` resolve to a real page; in-page hash links point at an existing id. */
export async function expectLinksValid(page: Page): Promise<void> {
  const hrefs = await page.locator('main a[href]').evaluateAll(els => els.map(a => (a as HTMLAnchorElement).getAttribute('href') ?? ''))
  const origin = new URL(page.url()).origin
  const paths = new Set<string>()
  for (const href of hrefs) {
    if (href.startsWith('#')) {
      expect(await page.locator(`[id="${href.slice(1)}"]`).count(), href).toBe(1)
    } else if (href.startsWith('/')) {
      const u = new URL(href, origin)
      if (u.hash) expect(await page.locator(`[id="${u.hash.slice(1)}"]`).count(), href).toBeGreaterThan(0)
      paths.add(u.pathname)
    }
  }
  for (const p of paths) {
    if (p === new URL(page.url()).pathname) continue
    const res = await page.request.get(origin + p)
    expect(res.status(), p).toBe(200)
  }
}

/** Every external link opens in a new tab with rel noopener noreferrer. */
export async function expectExternalLinksSafe(page: Page): Promise<void> {
  const origin = new URL(page.url()).origin
  const links = await page.locator('a[href^="http"]').evaluateAll(els => els.map(a => ({
    href: (a as HTMLAnchorElement).href, target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '',
  })))
  for (const l of links) {
    if (l.href.startsWith(origin)) continue
    expect(l.target, l.href).toBe('_blank')
    expect(l.rel.split(/\s+/), l.href).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  }
}

/**
 * Starting at the top of `main`, Tab reaches every rendered link, button and scroll box of `main` in DOM order, and each focused
 * element shows a focus indicator.
 */
export async function expectKeyboardOrder(page: Page): Promise<void> {
  const expected = await page.evaluate(() => {
    const main = document.querySelector('main')!
    // Controls that are not rendered (display: none, e.g. the phone-only
    // "On this page" toggle on desktop) are not tab stops.
    const items = Array.from(main.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'))
      .filter(el => el.getClientRects().length > 0)
    items.forEach((el, i) => el.setAttribute('data-tab-index', String(i)))
    main.setAttribute('tabindex', '-1')
    main.focus()
    return items.length
  })
  expect(expected).toBeGreaterThan(5)
  for (let i = 0; i < expected; i++) {
    await page.keyboard.press('Tab')
    const got = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return null
      const cs = getComputedStyle(el)
      const outlined = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      return { index: el.getAttribute('data-tab-index'), focusVisible: el.matches(':focus-visible'), visible: outlined || cs.boxShadow !== 'none' }
    })
    expect(got, `Tab press ${i + 1}`).not.toBeNull()
    expect(got!.index, `Tab press ${i + 1} is the ${i}th control of main`).toBe(String(i))
    expect(got!.focusVisible, `control ${i} :focus-visible`).toBe(true)
    expect(got!.visible, `control ${i} has a visible focus indicator`).toBe(true)
  }
}
