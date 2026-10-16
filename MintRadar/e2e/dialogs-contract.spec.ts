import { test, expect, type Locator, type Page } from '@playwright/test'
import { CASES, setupPage, type ModalCase } from './fixtures/dialogCases'
import { flush, layoutReady } from './fixtures/settle'

// The geometry and scroll rules of every modal dialog (the list is fixtures/dialogCases.ts, shared with
// modal-dialog-semantics.spec.ts, which owns role / aria-modal / name / focus in / Tab trap / Escape / focus return /
// outside click; modal-consistency.spec.ts owns "login and watch-login look the same from every page"). Per dialog and viewport:
//   - the close button is a real target: at least 32 x 32 CSS px, inside the viewport and the dialog, and the point at its
//     centre hits the button itself (nothing clips or covers it);
//   - the dialog fits the viewport (its box lies inside it); when its content is taller than the box, the box scrolls inside
//     itself instead of spilling over the viewport;
//   - a wheel event over the backdrop does not scroll the page behind (the page IS scrollable: a spacer makes sure of it).
// Viewports: 1440x900 and 320x640 for all, plus 390x844 for login. A dialog that only exists on a phone-sized viewport
// (its case says so) is checked at 320x640 and at its own size.

const DESKTOP = { width: 1440, height: 900 }
const SMALL = { width: 320, height: 640 }
const PHONE = { width: 390, height: 844 }

function viewportsOf(c: ModalCase) {
  const own = c.viewport
  if (own) return own.width <= SMALL.width ? [SMALL] : [own, SMALL]
  return c.id === 'Login modal' ? [DESKTOP, PHONE, SMALL] : [DESKTOP, SMALL]
}

async function open(page: Page, c: ModalCase, vp: { width: number; height: number }) {
  await setupPage(page, { ...c, viewport: vp })
  // Give the page something to scroll, whatever the mocks put on it: the scroll lock is only tested on a page that can scroll.
  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.setAttribute('data-e2e-spacer', '')
    spacer.style.cssText = 'height:3000px;width:1px;pointer-events:none'
    document.body.appendChild(spacer)
  })
  await layoutReady(page)
  const trigger = c.trigger ? c.trigger(page) : null
  await c.open(page, trigger)
  const dialog = c.dialog(page)
  await expect(dialog).toBeVisible()
  await layoutReady(page)
  return dialog
}

async function viewportBox(page: Page) {
  return page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
}

async function geometry(dialog: Locator, closeSelector: string | null) {
  return dialog.evaluate((d, closeSel) => {
    const r = d.getBoundingClientRect()
    const cs = getComputedStyle(d)
    // A scroller is the dialog itself or the descendant that scrolls its content (the box may clip its body).
    const scrollers = [d, ...Array.from(d.querySelectorAll('*'))].filter(e => {
      const s = getComputedStyle(e)
      return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 1
    })
    let close: { w: number; h: number; l: number; t: number; r: number; b: number; hit: boolean } | null = null
    const btn = closeSel ? d.querySelector(closeSel) : null
    if (btn) {
      const b = btn.getBoundingClientRect()
      const hitEl = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
      close = { w: b.width, h: b.height, l: b.left, t: b.top, r: b.right, b: b.bottom, hit: !!hitEl && (hitEl === btn || btn.contains(hitEl)) }
    }
    return {
      box: { l: r.left, t: r.top, r: r.right, b: r.bottom },
      overflowY: cs.overflowY,
      contentTaller: d.scrollHeight > d.clientHeight + 1,
      scrollers: scrollers.length,
      close,
    }
  }, closeSelector)
}

for (const c of CASES) {
  for (const vp of viewportsOf(c)) {
    test(`${c.id} @ ${vp.width}x${vp.height}`, async ({ page }) => {
      // One navigation per dialog and viewport; the three rules below are checked on the same open dialog.
      const dialog = await open(page, c, vp)
      const { w, h } = await viewportBox(page)
      const g = await geometry(dialog, c.close)

      // The close control is a real target and not clipped.
      expect(g.close, `${c.id}: has a close button (${c.close})`).not.toBeNull()
      const close = g.close!
      expect(close.w, `${c.id}: close button width ${close.w}`).toBeGreaterThanOrEqual(32)
      expect(close.h, `${c.id}: close button height ${close.h}`).toBeGreaterThanOrEqual(32)
      expect(close.l, `${c.id}: close button inside the viewport (left)`).toBeGreaterThanOrEqual(-0.5)
      expect(close.t, `${c.id}: close button inside the viewport (top)`).toBeGreaterThanOrEqual(-0.5)
      expect(close.r, `${c.id}: close button inside the viewport (right)`).toBeLessThanOrEqual(w + 0.5)
      expect(close.b, `${c.id}: close button inside the viewport (bottom)`).toBeLessThanOrEqual(h + 0.5)
      expect(close.l, `${c.id}: close button inside the dialog (left)`).toBeGreaterThanOrEqual(g.box.l - 0.5)
      expect(close.r, `${c.id}: close button inside the dialog (right)`).toBeLessThanOrEqual(g.box.r + 0.5)
      expect(close.hit, `${c.id}: the centre of the close button hits the button (not clipped, not covered)`).toBe(true)

      // The dialog fits the viewport; taller content scrolls inside the box.
      expect(g.box.l, `${c.id}: dialog inside the viewport (left)`).toBeGreaterThanOrEqual(-0.5)
      expect(g.box.t, `${c.id}: dialog inside the viewport (top)`).toBeGreaterThanOrEqual(-0.5)
      expect(g.box.r, `${c.id}: dialog inside the viewport (right) ${g.box.r} of ${w}`).toBeLessThanOrEqual(w + 0.5)
      expect(g.box.b, `${c.id}: dialog inside the viewport (bottom) ${g.box.b} of ${h}`).toBeLessThanOrEqual(h + 0.5)
      if (g.contentTaller) {
        expect(['auto', 'scroll'], `${c.id}: content taller than the dialog box, so the box must scroll (overflow-y ${g.overflowY})`).toContain(g.overflowY)
      }

      // A wheel over the backdrop does not scroll the page behind.
      expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 100), 'the page behind is scrollable (spacer)').toBe(true)
      const before = await page.evaluate(() => window.scrollY)
      // A point outside the dialog box when there is one (the backdrop); on a phone the dialog may fill the screen: then its own surface.
      const box = (await dialog.boundingBox())!
      const outside = { x: 2, y: 2 }
      const onBackdrop = outside.x < box.x || outside.y < box.y
      const at = onBackdrop ? outside : { x: box.x + 2, y: box.y + 2 }
      await page.mouse.move(at.x, at.y)
      await page.mouse.wheel(0, 900)
      await flush(page)
      expect(await page.evaluate(() => window.scrollY), `${c.id}: window.scrollY after a wheel over ${onBackdrop ? 'the backdrop' : 'the dialog edge'}`).toBe(before)
      await page.mouse.wheel(0, -900)
      await flush(page)
      expect(await page.evaluate(() => window.scrollY)).toBe(before)
    })
  }
}
