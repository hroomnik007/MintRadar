import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Sticky footer: .app-shell fills the viewport (min-height 100dvh, flex column) and
// .app-content grows (flex: 1 0 auto), so on short routes the footer sits at the bottom
// of the first viewport with no scroll. Page roots (.learn-page, .wallets-page,
// .watchlist-page, .dashboard, …) must NOT carry their own min-height: 100vh — that
// stacked on top of the navbar and always pushed the footer below the fold.

type Page = import('@playwright/test').Page

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

type Rect = { y: number; height: number }

// Waits for the real "layout is final" condition instead of a timeout: web fonts are loaded
// (font-display: swap re-wraps text when they arrive, which moves everything below) and the
// geometry of every element matching the selectors (in order) plus the document height is identical across two consecutive
// animation frames. Returns those rects from that same frame, so values that are compared with
// each other can never come from two different layouts.
async function measureSettled(page: Page, selectors: string[]): Promise<{ rects: Rect[]; scrollH: number }> {
  return page.evaluate(async (sels) => {
    await document.fonts.ready
    const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()))
    const read = () => ({
      rects: sels.flatMap(sel => {
        const els = Array.from(document.querySelectorAll(sel))
        if (els.length === 0) throw new Error(`measureSettled: ${sel} not found`)
        return els.map(el => {
          const b = el.getBoundingClientRect()
          return { y: b.y, height: b.height }
        })
      }),
      scrollH: document.documentElement.scrollHeight,
    })
    let prev = JSON.stringify(read())
    for (let i = 0; i < 300; i++) {
      await frame()
      const cur = read()
      if (JSON.stringify(cur) === prev) return cur
      prev = JSON.stringify(cur)
    }
    throw new Error('measureSettled: layout did not settle within 300 frames')
  }, selectors)
}

async function expectFooterInFirstViewport(page: Page, viewportHeight: number) {
  await expect(page.locator('footer.app-footer')).toBeVisible()
  const { rects: [box], scrollH } = await measureSettled(page, ['footer.app-footer'])
  // Fully inside the first viewport and pinned to its bottom edge.
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight + 1)
  expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewportHeight - 1)
  // No vertical scroll needed.
  expect(scrollH).toBeLessThanOrEqual(viewportHeight)
  return box!
}

test.describe('Sticky footer on short routes', () => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    test(`/learn: footer in first viewport, module cards above it (${vp.width}×${vp.height})`, async ({ page }) => {
      await page.setViewportSize(vp)
      await page.goto('/learn')
      await page.waitForSelector('.learn-card')

      const footerBox = await expectFooterInFirstViewport(page, vp.height)
      const { rects } = await measureSettled(page, ['.learn-card'])
      expect(rects.length).toBeGreaterThan(0)
      for (const b of rects) expect(b.y + b.height).toBeLessThanOrEqual(footerBox.y)
    })
  }

  // /wallets' own content (grid + self-host section + footnote) is ~1240px tall, so it
  // can't fit a 1080px viewport — assert the footer directly follows the content with no
  // empty band (the old per-page min-height: 100vh left ~50px of dead space before it).
  test('/wallets: footer directly follows content, no empty band (1920×1080)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/wallets')
    await page.waitForSelector('.wallets-footnote')
    const { rects: [pageBox, footerBox], scrollH } = await measureSettled(page, ['.wallets-page', 'footer.app-footer'])
    const footerBottom = footerBox!.y + footerBox!.height
    if (pageBox!.y + pageBox!.height + footerBox!.height <= 1080) {
      await expectFooterInFirstViewport(page, 1080)
    } else {
      expect(Math.abs(footerBox!.y - (pageBox!.y + pageBox!.height))).toBeLessThanOrEqual(1)
      expect(Math.abs(scrollH - footerBottom)).toBeLessThanOrEqual(1)
    }
  })

  test('empty /watchlist: footer in first viewport (1440×900)', async ({ page }) => {
    await loginAs(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/watchlist')
    await expect(page.locator('.wl-empty')).toBeVisible()
    await expectFooterInFirstViewport(page, 900)
  })
})

test('Dashboard with many cards: page scrolls and footer stays below the list', async ({ page }) => {
  const many = Array.from({ length: 40 }, (_, i) => {
    const base = MOCK_KNOWN_MINTS[i % MOCK_KNOWN_MINTS.length]!
    return { ...base, url: `https://m${i}.mint.example`, name: `Mint ${String(i).padStart(2, '0')}` }
  })
  await page.route('**/api/mints/known', route => route.fulfill({ json: many }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(40)

  const { rects: [gridBox, footerBox], scrollH } = await measureSettled(page, ['.mint-grid', 'footer.app-footer'])
  expect(scrollH).toBeGreaterThan(900)
  expect(footerBox!.y).toBeGreaterThanOrEqual(gridBox!.y + gridBox!.height)
  expect(footerBox!.y).toBeGreaterThan(900)
})
