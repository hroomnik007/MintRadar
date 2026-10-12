import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// The footer links to the two documentation pages (/methodology, /for-wallets); neither is in the main navigation.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Footer: Methodology and For wallets', () => {
  test('both links are in the footer, in order after About, and are not in the main navigation', async ({ page }) => {
    await page.goto('/')
    const footer = page.locator('footer.app-footer')
    const names = await footer.locator('.app-footer-links a').allInnerTexts()
    expect(names).toEqual(['© 2026 MintRadar.org', 'API', 'About', 'Methodology', 'For wallets'])
    await expect(footer.getByRole('link', { name: 'Methodology' })).toHaveAttribute('href', '/methodology')
    await expect(footer.getByRole('link', { name: 'For wallets' })).toHaveAttribute('href', '/for-wallets')
    await expect(page.locator('.navbar').getByRole('link', { name: /methodology|for wallets/i })).toHaveCount(0)
  })

  test('the links navigate to their pages', async ({ page }) => {
    await page.goto('/')
    await page.locator('footer.app-footer').getByRole('link', { name: 'Methodology' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/methodology')
    await expect(page.getByRole('heading', { level: 1, name: 'How the Reliability Score is computed' })).toBeVisible()
    await page.locator('footer.app-footer').getByRole('link', { name: 'For wallets' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/for-wallets')
    await expect(page.getByRole('heading', { level: 1, name: 'MintRadar for wallets' })).toBeVisible()
  })

  for (const width of [320, 390]) {
    test(`at ${width}px every link is inside the viewport, wraps cleanly and the page does not overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      const footer = page.locator('footer.app-footer')
      await expect(footer).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const links = footer.locator('.app-footer-links a')
      await expect(links).toHaveCount(5)
      const boxes = await links.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, h: r.height } }))
      for (const b of boxes) {
        expect(b.l).toBeGreaterThanOrEqual(0)
        expect(b.r).toBeLessThanOrEqual(width)
        expect(b.h).toBeGreaterThanOrEqual(24)
      }
      // a wrapped row stays centred: the links row is centred on the viewport
      const row = await footer.locator('.app-footer-links').boundingBox()
      expect(Math.abs(row!.x + row!.width / 2 - width / 2)).toBeLessThan(4)
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      expect(m.sw).toBeLessThanOrEqual(m.cw)
    })
  }

  test('touch: each footer link has a 44px tap area and the tap areas of neighbouring rows do not cover another link', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 800 }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto('/')
    const links = page.locator('footer.app-footer .app-footer-links a')
    await expect(links).toHaveCount(5)
    await page.locator('footer.app-footer').scrollIntoViewIfNeeded()
    const areas = await links.evaluateAll(els => els.map(e => {
      const r = e.getBoundingClientRect()
      const before = getComputedStyle(e, '::before')
      const h = parseFloat(before.height)
      const cy = r.top + r.height / 2
      return { text: e.textContent, h, l: r.left - 6, r: r.right + 6, top: cy - h / 2, bottom: cy + h / 2, cl: r.left, cr: r.right, ct: r.top, cb: r.bottom }
    }))
    for (const a of areas) expect(a.h, a.text ?? '').toBe(44)
    // a tap on the centre of a link must hit that link (not the enlarged area of one in another row)
    for (const [i, a] of areas.entries()) {
      const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x!, y!) as HTMLElement | null)?.closest('a')?.textContent ?? null, [(a.cl + a.cr) / 2, (a.ct + a.cb) / 2])
      expect(hit, `link ${i}`).toBe(a.text)
    }
    await context.close()
  })
})
