import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/')
  await expect(page.locator('.mint-card')).toHaveCount(4)
})

// The compare picker only offers ONLINE mints as candidates (Dashboard.tsx /
// MintDetail.tsx both filter `m.online === true`), and the shared fixture set
// has only 3 online mints (Alpha/Bravo/Delta — Charlie is offline). To reach
// a real 4-mint comparison, register one extra online mint on top of the
// shared fixtures, local to this test file only.
async function addExtraOnlineMint(page: Page) {
  const extra = {
    ...MOCK_KNOWN_MINTS[0],
    url: 'https://echo.mint.example',
    name: 'Echo Mint',
    trustScore: 66,
    reviewCount: 0,
    reviewAvgRating: null,
    reviewWeightedRating: null,
  }
  await page.route('**/api/mints/known', route => route.fulfill({ json: [...MOCK_KNOWN_MINTS, extra] }))
  await page.reload()
  await expect(page.locator('.mint-card')).toHaveCount(5)
}

async function openCompare(page: Page, otherMintNames: string[]) {
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button', { hasText: 'Compare' }).click()
  await expect(page.getByText('Compare with...')).toBeVisible()
  for (const name of otherMintNames) {
    await page.locator('.md-picker-item', { hasText: name }).click()
  }
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
}

// The comparison grid used to be a side-by-side table (mint = column) that
// only ever relied on `overflow-x: auto` on narrow viewports — it never
// actually fit, so the modal spilled past the screen edge. This checks the
// mobile stacked/tabbed layout instead: no horizontal page overflow, the
// header stays usable, and every mint's data is reachable via tabs.
const viewports = [
  { width: 375, height: 800, label: '375px' },
  { width: 390, height: 844, label: '390px' },
  { width: 480, height: 900, label: '480px' },
]

const scenarios = [
  { count: 2, others: ['Delta Mint'], needsExtraMint: false },
  { count: 3, others: ['Delta Mint', 'Bravo Mint'], needsExtraMint: false },
  { count: 4, others: ['Delta Mint', 'Bravo Mint', 'Echo Mint'], needsExtraMint: true },
]

for (const vp of viewports) {
  for (const scenario of scenarios) {
    test(`Compare modal fits ${vp.label} viewport with ${scenario.count} mints, no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      if (scenario.needsExtraMint) await addExtraOnlineMint(page)
      await openCompare(page, scenario.others)

      const modal = page.locator('.cmp-modal')
      await expect(modal).toBeVisible()

      // The whole page must never scroll sideways — no content spilling past
      // the viewport edge (the original bug).
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(scrollWidth).toBeLessThanOrEqual(vp.width + 1)

      // The modal itself must stay within the viewport bounds.
      const box = await modal.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(-1)
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1)

      // Header stays visible and functional (not covered by content below it).
      const header = page.locator('.cmp-modal-header')
      await expect(header).toBeVisible()
      const closeBtn = header.locator('button')
      await expect(closeBtn).toBeVisible()
      const closeBox = await closeBtn.boundingBox()
      const headerBox = await header.boundingBox()
      expect(closeBox).not.toBeNull()
      expect(headerBox).not.toBeNull()
      // The close button's center must land inside the header's own box —
      // i.e. nothing else is stacked on top of it.
      const centerX = closeBox!.x + closeBox!.width / 2
      const centerY = closeBox!.y + closeBox!.height / 2
      const elAtCenter = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return el ? el.closest('.cmp-modal-header') !== null : false
      }, { x: centerX, y: centerY })
      expect(elAtCenter).toBe(true)
      void headerBox

      // Stacked/tabbed layout: one tab per mint, no side-by-side grid.
      const tabs = page.locator('.cmp-mobile-tab')
      await expect(tabs).toHaveCount(scenario.count)
      await expect(page.locator('.cmp-grid')).toHaveCount(0)

      // Each tab's mint data is reachable and swaps the visible stack.
      for (let i = 0; i < scenario.count; i++) {
        await tabs.nth(i).click()
        await expect(tabs.nth(i)).toHaveClass(/active/)
        const stack = page.locator('.cmp-mobile-stack')
        await expect(stack).toBeVisible()
        // Trust Score row (or Community Rating fallback) is always present.
        await expect(stack.locator('.cmp-mobile-lbl', { hasText: 'Trust Score' })).toBeVisible()

        const stackScrollWidth = await stack.evaluate(el => el.scrollWidth)
        const stackClientWidth = await stack.evaluate(el => el.clientWidth)
        expect(stackScrollWidth).toBeLessThanOrEqual(stackClientWidth + 1)
      }
    })
  }
}

test('mobile Compare modal is scrollable within the viewport (no page-level horizontal scroll)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 })
  await addExtraOnlineMint(page)
  await openCompare(page, ['Delta Mint', 'Bravo Mint', 'Echo Mint'])

  // Body must not permit horizontal scrolling.
  const canScrollX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(canScrollX).toBe(false)

  // But the modal content itself must be reachable via vertical scroll —
  // the "Software Version History" section at the bottom should be visible
  // after scrolling the modal.
  const modal = page.locator('.cmp-modal')
  await modal.evaluate(el => el.scrollTo(0, el.scrollHeight))
  await expect(page.getByText('Software Version History')).toBeVisible()
})
