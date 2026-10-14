import { test, expect, type Page } from '@playwright/test'
import { AUDIT_ROUTES, collectStructure, loadRoute, skippedHeadingLevels, type AuditRoute } from './fixtures/pageAudit'
import { layoutReady } from './fixtures/settle'

// Page structure and keyboard order of every main route (plain DOM checks, no accessibility library):
//   one h1; the landmarks main / nav / footer where the layout has them; heading levels that do not skip; every link, button,
//   input, select, textarea, [role=button|tab|switch] has an accessible name; every img has an alt; no duplicate ids; the document
//   language is set; Tab from the top reaches the first interactive element within three stops, the first twelve stops follow
//   the DOM order, each one shows a focus style that differs from its unfocused style, and none is zero-size or hidden.
// Findings that are application issues are listed in docs/claude/e2e-conventions.md ("Findings"). Where the app has a known violation
// the test asserts the CURRENT count as an upper bound (so it can only get better) and says so next to the number.

/** Landmarks per route: [nav landmarks]. The doc pages carry a second nav ("On this page"). main and footer are one everywhere. */
const NAV_COUNT: Record<string, number> = { about: 2, methodology: 2, 'for-wallets': 2 }
/** Known violations (upper bounds). Everything not listed must be 0. */
const KNOWN: Record<string, { unnamedNavs?: number }> = {
  // FINDING F4: the primary <nav> has no accessible name; with a second nav on the page the two cannot be told apart by name.
  about: { unnamedNavs: 1 }, methodology: { unnamedNavs: 1 }, 'for-wallets': { unnamedNavs: 1 },
}

/**
 * FINDING F6 (application, not fixed here): these elements show NO focus indicator when reached with Tab (no outline, no
 * box-shadow, nothing on a pseudo-element or on a card around them). Their focus-style assertion is left out; remove the entry
 * when the app shows focus.
 */
const NO_FOCUS_STYLE: Record<string, string[]> = { tools: ['textarea.token-input'] }

async function navNames(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('nav, [role=navigation]')).map(n => n.getAttribute('aria-label')?.trim() ?? (n.getAttribute('aria-labelledby') ? document.getElementById(n.getAttribute('aria-labelledby')!)?.textContent?.trim() ?? '' : '')))
}

interface Stop { desc: string; w: number; h: number; hidden: boolean; inDomOrder: boolean; focusStyleDiffers: boolean }

/** Presses Tab `n` times from the top of the page and describes every stop. Also reports how many presses the first visible tabbable needed. */
async function tabThrough(page: Page, n: number): Promise<{ stops: Stop[]; firstInteractiveAt: number }> {
  await page.evaluate(() => {
    const tabbable = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    // No transitions: the style read right after the Tab press is the final one, not a frame of a fade.
    const off = document.createElement('style')
    off.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}'
    document.head.appendChild(off)
    // The focus indicator may sit on the element, on its ::before / ::after (stretched card links) or on a card around it
    // (:focus-within): the signature covers the element and up to three ancestors, each with both pseudo-elements.
    const sig = (e: HTMLElement) => {
      const parts: string[] = []
      let n: Element | null = e
      for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
        for (const pseudo of [null, '::before', '::after'] as const) {
          const c = getComputedStyle(n, pseudo)
          parts.push(`${c.outlineStyle}|${c.outlineWidth}|${c.outlineColor}|${c.boxShadow}`)
        }
      }
      return parts.join(';')
    }
    const style = sig
    const w = window as unknown as { __base: Map<Element, string>; __prev: Element | null; __tabbable: HTMLElement[] }
    w.__base = new Map(tabbable.map(e => [e, style(e)]))
    w.__tabbable = tabbable
    w.__prev = null
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.scrollTo(0, 0)
  })
  const stops: Stop[] = []
  let firstInteractiveAt = -1
  for (let i = 1; i <= n; i++) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(() => {
      const w = window as unknown as { __base: Map<Element, string>; __prev: Element | null; __tabbable: HTMLElement[] }
      const el = document.activeElement as HTMLElement
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      const now = (() => {
        const parts: string[] = []
        let n: Element | null = el
        for (let k = 0; k < 4 && n; k++, n = n.parentElement) {
          for (const pseudo of [null, '::before', '::after'] as const) {
            const c = getComputedStyle(n, pseudo)
            parts.push(`${c.outlineStyle}|${c.outlineWidth}|${c.outlineColor}|${c.boxShadow}`)
          }
        }
        return parts.join(';')
      })()
      const firstVisible = w.__tabbable.find(e => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' })
      const id = el.id ? `#${el.id}` : ''
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      const out = {
        desc: `${el.tagName.toLowerCase()}${id}${cls} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`,
        w: r.width, h: r.height,
        hidden: cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0,
        inDomOrder: !w.__prev || !!(w.__prev.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
        focusStyleDiffers: now !== (w.__base.get(el) ?? now),
        isFirstVisible: el === firstVisible,
      }
      w.__prev = el
      return out
    })
    if (stop.isFirstVisible && firstInteractiveAt < 0) firstInteractiveAt = i
    stops.push({ desc: stop.desc, w: stop.w, h: stop.h, hidden: stop.hidden, inDomOrder: stop.inDomOrder, focusStyleDiffers: stop.focusStyleDiffers })
  }
  return { stops, firstInteractiveAt }
}

for (const route of AUDIT_ROUTES) {
  test.describe(`${route.id} (${route.path})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await loadRoute(page, route as AuditRoute)
      await layoutReady(page)
    })

    test('structure: one h1, landmarks, heading levels, names, alt text, ids, language', async ({ page }) => {
      const s = await collectStructure(page)
      const known = KNOWN[route.id] ?? {}
      expect(s.lang, 'document.documentElement.lang is set').toMatch(/^[a-z]{2}/)
      expect(s.h1, 'exactly one h1').toBe(1)
      expect(s.landmarks.main, 'exactly one main').toBe(1)
      expect(s.landmarks.footer, 'exactly one footer').toBe(1)
      expect(s.landmarks.nav, 'nav landmarks').toBe(NAV_COUNT[route.id] ?? 1)
      // A lone nav needs no name; when there are two, they must be told apart by name.
      const names = await navNames(page)
      if (names.length > 1) expect(names.filter(n => n === '').length, `navs without an accessible name (${JSON.stringify(names)})`).toBeLessThanOrEqual(known.unnamedNavs ?? 0)
      expect(skippedHeadingLevels(s.headingLevels), `heading levels ${s.headingLevels.join('')} do not skip a level`).toEqual([])
      expect(s.unnamed, 'interactive elements without an accessible name').toEqual([])
      expect(s.imagesWithoutAlt, 'img elements without an alt attribute').toEqual([])
      expect(s.duplicateIds, 'duplicate id attributes').toEqual([])
    })

    test('the accessibility tree names every link, button and field too', async ({ page }) => {
      // The same question asked of the browser's own accessibility tree (what a screen reader gets), not of our DOM walk.
      const snapshot = await page.locator('body').ariaSnapshot()
      const unnamed = snapshot.split('\n').filter(l => /^\s*- (link|button|textbox|combobox|checkbox|radio|switch|tab|searchbox|slider|spinbutton|menuitem)(\s*\[[^\]]*\])*:?\s*$/.test(l))
      expect(unnamed, 'nodes of the accessibility tree without a name').toEqual([])
    })

    // A state reached by clicking (route.after) starts Tab from the click point, not from the top: the plain route covers the top.
    if (!route.after) test('Tab: first interactive element within 3 stops, DOM order, visible focus style, nothing hidden', async ({ page }) => {
      const { stops, firstInteractiveAt } = await tabThrough(page, 12)
      expect(firstInteractiveAt, `the first visible interactive element is reached by Tab ${firstInteractiveAt}: ${stops.slice(0, 4).map(s => s.desc).join(' → ')}`).toBeGreaterThan(0)
      expect(firstInteractiveAt, 'the first interactive element is reached within three Tab presses').toBeLessThanOrEqual(3)
      for (const [i, s] of stops.entries()) {
        const at = `stop ${i + 1} ${s.desc}`
        expect(s.hidden, `${at}: not hidden`).toBe(false)
        expect(s.w > 0 && s.h > 0, `${at}: not zero-size (${s.w} x ${s.h})`).toBe(true)
        expect(s.inDomOrder, `${at}: follows the previous stop in the DOM`).toBe(true)
        if (NO_FOCUS_STYLE[route.id]?.some(prefix => s.desc.startsWith(prefix))) continue
        expect(s.focusStyleDiffers, `${at}: its outline or box-shadow differs from the unfocused element`).toBe(true)
      }
    })
  })
}
