import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Mint Detail (2026-11-14): the Reliability Score is the first figure of the strip above 640px, as the phone already
// had it; the phone keeps its compact donut tile.

const ALPHA = MOCK_MINTS[0]!.url // Alpha Mint, Reliability 92

async function open(page: Page, width: number, height = 900) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  await resize(page, width, height)
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await layoutReady(page)
}

for (const width of [1440, 1200, 1024, 900, 769]) {
  test(`${width}px: the score is the first tile of the strip, one row of figures does not break a value`, async ({ page }) => {
    await open(page, width)
    const tile = page.getByTestId('md-summary-score')
    await expect(tile).toBeVisible()
    await expect(page.locator('.md-summary > .md-sc').first()).toHaveAttribute('data-testid', 'md-summary-score')
    await expect(tile.locator('.md-sc-value')).toHaveText('92')
    await expect(tile).toContainText('Reliability Score')
    await expect(tile).toContainText('High Reliability')
    await expect(page.locator('.md-sc.md-sc-reliability')).toBeHidden()
    // No tile is wider than its cell and the page does not scroll sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const version = page.locator('.md-summary .md-sc-value.sm span').first()
    // One line: shorter than two lines of its own font size ("Nutshell/0.16.0" used to break inside the word at 900-1199px).
    const oneLine = await version.evaluate(el => el.getBoundingClientRect().height < parseFloat(getComputedStyle(el).fontSize) * 2)
    expect(oneLine).toBe(true)
  })
}

test('1440px: the tile opens the breakdown dialog (click and keyboard)', async ({ page }) => {
  await open(page, 1440)
  const tile = page.getByTestId('md-summary-score')
  await tile.click()
  const dialog = page.getByRole('dialog', { name: 'Reliability Score Breakdown' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.rb-hero-score')).toHaveText('92')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
  await tile.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
})

test('390px: the desktop tile is hidden, the compact donut tile shows the score', async ({ page }) => {
  await open(page, 390, 844)
  await expect(page.getByTestId('md-summary-score')).toBeHidden()
  await expect(page.locator('.md-sc-reliability-num')).toHaveText('92')
})
