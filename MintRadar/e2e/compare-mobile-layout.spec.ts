import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { cmpRowIds, cmpValues } from './fixtures/compare'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/?status=all')
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
    reliabilityScore: 66,
    reviewCount: 0,
    reviewAvgRating: null,
    reviewWeightedRating: null,
  }
  await page.route('**/api/mints/known', route => route.fulfill({ json: [...MOCK_KNOWN_MINTS, extra] }))
  await page.reload()
  await expect(page.locator('.mint-card')).toHaveCount(5)
}

async function openCompare(page: Page, otherMintNames: string[]) {
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  await expect(page.getByText(/^Compare with /)).toBeVisible()
  for (const name of otherMintNames) {
    await page.locator('.md-picker-item', { hasText: name }).click()
  }
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText(/^Compare [2-4] mints$/)).toBeVisible()
}

// Since the Compare redesign (2026-11-28) phones get the same layout as the desktop: mint cards on top and every row's
// values in one column per mint, inside the modal. Nothing scrolls sideways, neither the page nor a region of the modal.
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

      // One card and one value column per mint; no old table or grid; nothing wider than the modal.
      await expect(page.locator('table.cmp-m-table, .cmp-grid')).toHaveCount(0)
      await expect(page.locator('[data-testid="cmp-card"]')).toHaveCount(scenario.count)
      expect(await cmpValues(page, 'nut-count')).toHaveLength(scenario.count)
      const { sw, cw } = await modal.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }))
      expect(sw).toBeLessThanOrEqual(cw + 1)
      const mBox = (await modal.boundingBox())!
      const outside = await page.locator('.cx-val, [data-testid="cmp-card"]').evaluateAll((els, right) => els.filter(e => e.getBoundingClientRect().right > right + 0.5).length, mBox.x + mBox.width)
      expect(outside).toBe(0)
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

  // The folded History panel at the bottom is reachable by scrolling the modal.
  const modal = page.locator('.cmp-modal')
  await modal.evaluate(el => el.scrollTo(0, el.scrollHeight))
  await expect(page.locator('details.cx-fold > summary', { hasText: 'History' })).toBeVisible()
})

test('mobile: "Only differences" hides rows where every mint has the same value', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openCompare(page, ['Delta Mint', 'Bravo Mint'])
  const toggle = page.getByRole('switch', { name: 'Only differences' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  const all = await cmpRowIds(page)
  expect(all.length).toBeGreaterThan(3)
  // Rows whose values read differently across mints must stay visible.
  const differing: string[] = []
  for (const id of all) { const v = await cmpValues(page, id); if (v.some(x => x !== v[0])) differing.push(id) }
  expect(differing.length).toBeGreaterThan(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toBeFocused()
  await expect(page.locator('.cmp-m-status')).toContainText(/rows differ|same value/)
  // No fixture mint has a 30-day figure ("—" for all): that row is equal and hidden.
  await expect(page.locator('.cx-row[data-row="uptime-30d"]')).toHaveCount(0)
  for (const id of differing) await expect(page.locator(`.cx-row[data-row="${id}"]`)).toHaveCount(1)
  expect((await cmpRowIds(page)).length).toBeLessThan(all.length)

  await toggle.press('Space')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect.poll(() => cmpRowIds(page)).toEqual(all)
})

test('desktop: the same layout as on the phone, with the switch off by default', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openCompare(page, ['Delta Mint', 'Bravo Mint'])
  await expect(page.locator('[data-testid="cmp-card"]')).toHaveCount(3)
  await expect(page.locator('table.cmp-m-table, .cmp-grid')).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Only differences' })).toHaveAttribute('aria-checked', 'false')
})

// C7 (owner, 2026-11-28: "I can scroll further down where I only see black"): the screen-reader-only texts far down the
// modal used to stretch the OVERLAY's scroll area (their containing block was the fixed overlay), so the dark page behind
// could be scrolled. Only the modal scrolls now, also with History open, and the modal fits the visible height.
for (const vp of [{ width: 390, height: 664 }, { width: 1440, height: 900 }]) {
  test(`${vp.width}px: only the modal scrolls, the overlay behind it never does (History open)`, async ({ page }) => {
    await page.setViewportSize(vp)
    await openCompare(page, ['Delta Mint'])
    await page.locator('.cx-fold summary', { hasText: 'History' }).click()
    await expect(page.locator('.cx-legend, .cx-note').first()).toBeVisible()
    const m = await page.evaluate(() => {
      const o = document.querySelector('.cmp-overlay')!, d = document.querySelector('.cmp-modal')!
      return { overlayExtra: o.scrollHeight - o.clientHeight, overflow: getComputedStyle(o).overflowY, modalBottom: d.getBoundingClientRect().bottom, vh: innerHeight, modalScrolls: d.scrollHeight > d.clientHeight }
    })
    expect(m.overlayExtra, 'nothing stretches the overlay').toBeLessThanOrEqual(1)
    expect(m.overflow).toBe('hidden')
    expect(m.modalBottom).toBeLessThanOrEqual(m.vh + 0.5)
    expect(m.modalScrolls, 'the long content scrolls inside the modal').toBe(true)
  })
}

// Owner, 2026-11-28: opening "How each score is made" or History scrolls the modal to it (it used to open below the fold
// and nothing moved). The panel then starts right under the sticky header and the name bar.
for (const vp of [{ width: 390, height: 664 }, { width: 1440, height: 900 }]) {
  for (const fold of ['points', 'history'] as const) {
    test(`${vp.width}px: opening the ${fold} panel brings it to the top of the modal`, async ({ page }) => {
      await page.setViewportSize(vp)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openCompare(page, ['Delta Mint', 'Bravo Mint'])
      const panel = page.locator(`.cx-fold[data-fold="${fold}"]`)
      await panel.locator('summary').click()
      await expect.poll(async () => page.evaluate(sel => {
        const m = document.querySelector('.cmp-modal')!, p = document.querySelector(sel)!
        const head = document.querySelector('.cmp-modal-header')!.getBoundingClientRect().bottom
        const key = document.querySelector('.cx-key')!.getBoundingClientRect().height
        const top = p.getBoundingClientRect().top
        // at the top: right under header + name bar (8 px gap), or as far as the modal can scroll
        const atEnd = m.scrollTop + m.clientHeight >= m.scrollHeight - 1
        return (Math.abs(top - (head + key + 8)) <= 4 || atEnd) && m.scrollTop > 0
      }, `.cx-fold[data-fold="${fold}"]`)).toBe(true)
    })
  }
}

// Owner, 2026-11-28: History comes before "How each score is made", and the whole heading row opens a panel (a click at
// the far right of the row works, not only on the words).
for (const vp of [{ width: 390, height: 664 }, { width: 1440, height: 900 }]) {
  test(`${vp.width}px: History first, then the score points; the full row of a heading opens it`, async ({ page }) => {
    await page.setViewportSize(vp)
    await openCompare(page, ['Delta Mint'])
    await expect(page.locator('details.cx-fold > summary')).toHaveText(['History', 'How each score is made'])
    for (const fold of ['history', 'points']) {
      const panel = page.locator(`.cx-fold[data-fold="${fold}"]`)
      const s = (await panel.locator('summary').boundingBox())!
      const p = (await panel.boundingBox())!
      expect(Math.abs(s.width - p.width), 'the summary spans the panel').toBeLessThanOrEqual(2)
      // a click near the right end of the row, far from the words
      await panel.locator('summary').click({ position: { x: s.width - 12, y: s.height / 2 } })
      await expect(panel).toHaveAttribute('open', '')
    }
  })
}

// B1 (review 2026-11-28): the picker's screen-reader-only score words stretched the overlay's scroll area (2285 px of plain
// black under the dialog on a phone). Only the list scrolls now.
for (const vp of [{ width: 390, height: 664 }, { width: 1440, height: 900 }]) {
  test(`${vp.width}px: the Compare with picker's overlay never scrolls`, async ({ page }) => {
    await page.setViewportSize(vp)
    await addExtraOnlineMint(page)
    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
    await expect(page.locator('.md-picker-modal')).toBeVisible()
    const m = await page.evaluate(() => {
      const o = document.querySelector('.cmp-overlay')!, d = document.querySelector('.md-picker-modal')!
      return { extra: o.scrollHeight - o.clientHeight, overflow: getComputedStyle(o).overflowY, bottom: d.getBoundingClientRect().bottom, vh: innerHeight }
    })
    expect(m.extra).toBeLessThanOrEqual(1)
    expect(m.overflow).toBe('hidden')
    expect(m.bottom).toBeLessThanOrEqual(m.vh + 0.5)
  })
}
