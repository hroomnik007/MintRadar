import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Mint Detail (2026-11-14): the Reliability Score is the first figure of the strip. Since the 2026-11-19 redesign it is at
// every width (phones: across the first row); the phone's donut tile is gone and "How it is made" opens the breakdown.

const ALPHA = MOCK_MINTS[0]!.url // Alpha Mint, Reliability 92

async function open(page: Page, width: number, height = 900) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  // Two rated reviews (5 and 4): the tile shows "4.5" with stars, a decimal like the one that used to split.
  await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({ json: [
    { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), content: 'good', rating: 5, createdAt: 1_700_000_000, source: 'nostr' },
    { id: 'c'.repeat(64), pubkey: 'd'.repeat(64), content: 'ok', rating: 4, createdAt: 1_700_000_100, source: 'nostr' },
  ] }))
  await resize(page, width, height)
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await layoutReady(page)
}

for (const width of [1440, 1200, 1024, 900, 769, 390, 320]) {
  test(`${width}px: the score is the first tile of the strip, one row of figures does not break a value`, async ({ page }) => {
    await open(page, width)
    const tile = page.getByTestId('md-summary-score')
    await expect(tile).toBeVisible()
    await expect(page.locator('.md-summary > .md-sc').first()).toHaveAttribute('data-testid', 'md-summary-score')
    await expect(tile.locator('.md-sc-value')).toHaveText('92')
    await expect(tile).toContainText('Reliability Score')
    await expect(tile).toContainText('High Reliability')
    await expect(page.locator('.md-sc-reliability')).toHaveCount(0)
    // No tile is wider than its cell and the page does not scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const version = page.locator('.md-sc-software .md-strip-code')
    // One line: shorter than two lines of its own font size ("Nutshell/0.16.0" used to break inside the word at 900-1199px).
    const oneLine = await version.evaluate(el => el.getBoundingClientRect().height < parseFloat(getComputedStyle(el).fontSize) * 2)
    expect(oneLine).toBe(true)
    // The community rating (two reviews, 4.5) stays "4.5" on one line, the stars on the same line next to it
    // (2026-11-18: overflow-wrap: anywhere split "4.7" into "4." / "7" with the stars on two rows at 1440px).
    const ratingNum = page.locator('.md-summary .md-sc-rating-num')
    await expect(ratingNum).toHaveText('4.5')
    const rating = await ratingNum.evaluate(el => {
      const stars = el.parentElement!.querySelector('.md-sc-stars')!.getBoundingClientRect()
      const num = el.getBoundingClientRect()
      return { numOneLine: num.height < parseFloat(getComputedStyle(el).fontSize) * 2, starsBeside: stars.left >= num.right && stars.top < num.bottom }
    })
    expect(rating).toEqual({ numOneLine: true, starsBeside: true })
  })
}

for (const width of [1440, 390]) {
  test(`${width}px: "How it is made" opens the breakdown dialog (click and keyboard)`, async ({ page }) => {
    await open(page, width, width < 769 ? 844 : 900)
    const link = page.getByTestId('md-summary-score').getByRole('button', { name: 'How it is made' })
    await link.click()
    const dialog = page.getByRole('dialog', { name: 'Reliability Score Breakdown' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.rb-hero-score')).toHaveText('92')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
  })
}
