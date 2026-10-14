import { test, expect, type Page } from '@playwright/test'
import { installTooltipMocks, mintPath, ALPHA, NEW_MINT, OPERATOR_MINT } from './fixtures/tooltipStates'
import { openWatchlist, mockNotifyApi } from './fixtures/watchlistNotify'
import { mockRelays, installApiMocks } from './fixtures/mocks'

// Four explanations that used to live only in a tooltip (or nowhere) are visible text now: the Keysets hint, "Capped
// at 75" under a new mint's score, the Operator note above the reviews, and the More alerts note. Each one shows where it
// belongs, only when it applies, and fits at 320 / 390 / 1440 px without widening the page or being cut.

const VIEWPORTS = [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]

async function expectInside(page: Page, inner: string, outer: string) {
  const [i, o] = await Promise.all([page.locator(inner).first().boundingBox(), page.locator(outer).first().boundingBox()])
  expect(i, inner).not.toBeNull(); expect(o, outer).not.toBeNull()
  expect(i!.x).toBeGreaterThanOrEqual(o!.x - 0.5)
  expect(i!.x + i!.width).toBeLessThanOrEqual(o!.x + o!.width + 0.5)
}
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}px`, () => {
    test.use({ viewport: vp })

    test('Keysets: the explanation is a visible line under the title', async ({ page }) => {
      await installTooltipMocks(page)
      await page.goto(mintPath(ALPHA, vp.width < 901 ? '#nuts' : '#overview'))
      const panel = page.locator(vp.width < 901 ? '.md-keysets-at-nuts' : '.md-keysets-at-overview')
      const hint = panel.locator('.md-panel-hint')
      await expect(hint).toBeVisible()
      await expect(hint).toHaveText('Signing keys per unit. Active keys sign new tokens; tokens from old keys can still be spent.')
      await expect(panel.locator('.md-panel-title [data-tooltip-trigger]')).toHaveCount(0)
      expect(await hint.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
      expect(await noSideScroll(page)).toBe(true)
    })

    test('New mint: "Capped at 75" under the score where the panel shows, the badge tooltip is shorter', async ({ page }) => {
      await installTooltipMocks(page)
      await page.goto(mintPath(NEW_MINT, '#overview'))
      await expect(page.locator('.md-tabs')).toBeVisible()
      const note = page.locator('.rb-new-note')
      if (vp.width > 640) { // the full Reliability Score panel is hidden on phones (the dialog opened from the compact tile has the formula line)
        await expect(note).toHaveText('Capped at 75 for the first 30 days (new mint).')
        await expectInside(page, '.rb-new-note', '.md-reliability-panel')
      } else {
        await expect(note).toBeHidden()
      }
      const badge = page.locator('.md-name [data-tooltip-trigger]', { hasText: 'New' })
      await badge.hover()
      await expect(page.getByRole('tooltip')).toHaveText('Reliability Score capped at 75 for the first 30 days.')
      expect(await noSideScroll(page)).toBe(true)
    })

    test('an older mint has no cap note', async ({ page }) => {
      await installTooltipMocks(page)
      await page.goto(mintPath(ALPHA, '#overview'))
      await expect(page.locator('.md-tabs')).toBeVisible()
      await expect(page.locator('.rb-new-note')).toHaveCount(0)
    })

    test('Reviews: the Operator note is visible text, only when an operator review is listed; the badge has no tooltip', async ({ page }) => {
      await installTooltipMocks(page)
      await page.goto(mintPath(OPERATOR_MINT, '#reviews'))
      await expect(page.locator('.review-operator-badge')).toBeVisible()
      const note = page.locator('.reviews-disclaimer', { hasText: 'Operator:' })
      await expect(note).toHaveText('Operator: a review published by a key the mint lists as its contact that also announced the mint on Nostr.')
      await expect(page.locator('[data-tooltip-trigger] .review-operator-badge')).toHaveCount(0)
      expect(await note.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
      expect(await noSideScroll(page)).toBe(true)
      // the Community Rating tile's tooltip says the Reviews tab still lists it
      await page.locator('.operator-excluded-info').hover()
      await expect(page.getByRole('tooltip')).toContainText('The Reviews tab still lists it, marked Operator.')
    })

    test('Reviews of a mint without an operator review: no Operator note', async ({ page }) => {
      await installTooltipMocks(page)
      await page.goto(mintPath(ALPHA, '#reviews'))
      await expect(page.locator('.reviews-filter-chip').first()).toBeVisible()
      await expect(page.getByText('Operator:')).toHaveCount(0)
    })

    test('Watchlist: the More alerts note shows only while the row is open and stays inside its card', async ({ page }) => {
      await mockRelays(page); await installApiMocks(page); await mockNotifyApi(page)
      await openWatchlist(page, { size: vp })
      const card = page.locator('.wl-grid .mint-card').first()
      await expect(card.locator('.notify-more-note')).toHaveCount(0)
      await card.getByRole('button', { name: /More alerts/ }).click()
      const note = card.locator('.notify-more-note')
      await expect(note).toHaveText("Mint/melt: half or more of the last 7 days' swaps attributed to the mint. Version: 2+ minor versions behind. NUT: NUT-04 or NUT-05 lost. At most one message per 12 h (mint/melt) or 24 h (others).")
      const [n, c] = await Promise.all([note.boundingBox(), card.boundingBox()])
      expect(n!.x).toBeGreaterThanOrEqual(c!.x - 0.5)
      expect(n!.x + n!.width).toBeLessThanOrEqual(c!.x + c!.width + 0.5)
      expect(await note.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true)
      expect(await noSideScroll(page)).toBe(true)
      await card.getByRole('button', { name: /More alerts/ }).click()
      await expect(card.locator('.notify-more-note')).toHaveCount(0)
    })
  })
}
