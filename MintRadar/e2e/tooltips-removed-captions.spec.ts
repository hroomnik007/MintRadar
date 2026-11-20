import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { avgUptimeCaption, nhiSubtitle, DEGRADED_AFTER_HOURS } from '../src/utils/networkHealthIndex'
import { latencyCaption, PROBE_LOCATION } from '../src/constants/probeLocation'

// Four explanatory tooltips were removed on 2026-10-14 (Latency tile and Reliability Score card header on Mint Detail,
// "Network health index" header and "average uptime" tile on Stats). The facts they stated are visible text now:
// the Latency caption, the average-uptime caption, the gauge hint under the index header, and one muted line in the
// Reliability Score card. The captions are built from the same constants the code computes with.

const ALPHA = MOCK_MINTS[0]!.url
const triggers = (scope: ReturnType<Page['locator']>) => scope.locator('[data-tooltip-trigger]')

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

for (const width of [1440, 768, 390, 320]) {
  test(`Stats at ${width}px: no tooltip trigger on the average-uptime tile or the index header, new captions`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1400 })
    await page.goto('/stats')
    await expect(page.locator('.nhi-readout')).toBeVisible()

    const tile = page.locator('.stat-card').filter({ hasText: 'average uptime' })
    await expect(tile).toHaveCount(1)
    await expect(triggers(tile)).toHaveCount(0)
    // The tile names its window; the panel line says who is left out (2026-11-19 mockup alignment).
    await expect(tile.locator('.stat-note')).toHaveText('last 24 h')
    await expect(page.locator('.stats-panel', { hasText: 'The network right now' }).locator('.stats-panel-desc')).toHaveText(`Mints offline for more than ${DEGRADED_AFTER_HOURS} h are left out of uptime.`)
    expect(avgUptimeCaption().length).toBeLessThanOrEqual(32)

    const head = page.locator('.stats-nhi-panel .stats-panel-head')
    await expect(triggers(head)).toHaveCount(0)
    // "Five factors, weighted." and, from 768 px, "Updated every 5 minutes." (2026-11-19 mockup alignment).
    await expect(head.locator('.stats-panel-desc')).toHaveText(`${nhiSubtitle()} Updated every 5 minutes.`)
    await expect(head.locator('.nhi-refresh')).toBeVisible({ visible: width >= 768 })

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}

// Since the 2026-11-19 redesign the five factors show on phones too (the gauge and its breakdown dialog are gone).
test('on a phone the Network health factors are on the page, no dialog to open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/stats')
  await expect(page.locator('.nhi-readout')).toBeVisible()
  await expect(page.locator('.stats-nhi-panel .nhi-row')).toHaveCount(5)
  await expect(page.locator('.stats-nhi-panel .nhi-row').first()).toBeVisible()
  await expect(page.locator('.nhi-show-details')).toHaveCount(0)
})

for (const width of [1440, 768, 390, 320]) {
  test(`Mint Detail at ${width}px: no tooltip on the Latency tile, caption from PROBE_LOCATION, button label kept`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 })
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()

    const tile = page.locator('.md-sc').filter({ has: page.locator('.latency-test-btn') })
    await expect(tile).toHaveCount(1)
    await expect(tile.locator('.md-sc-label')).toHaveText('Latency')
    await expect(triggers(tile.locator('.md-sc-label'))).toHaveCount(0)
    await expect(tile.locator('.md-sc-sub')).toContainText(latencyCaption())
    await expect(tile.locator('.md-sc-sub')).toContainText(`From ${PROBE_LOCATION}`)
    await expect(tile.locator('.latency-test-btn')).toHaveText('Show my latency')
    // no ⓘ on the tile at all: the one beside the button was removed on 2026-11-08 (it repeated the button's label)
    await expect(triggers(tile)).toHaveCount(0)

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}

for (const width of [1440, 768]) {
  // Since the 2026-11-19 redesign the side card is "How the <score> is made" and the not-solvency line is in the strip's
  // score tile; the card header has no tooltip and the five weights stay visible as row labels.
  test(`Mint Detail at ${width}px: the score card header has no tooltip, the strip says it is not solvency`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 })
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    const panel = page.locator('.md-reliability-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.md-panel-title')).toHaveText(/^How the (\d+|score) is made$/)
    await expect(triggers(panel.locator('.md-panel-h'))).toHaveCount(0)
    await expect(page.getByTestId('md-summary-score')).toContainText('Operational health, not solvency.')
    await expect(page.getByText('Operational health, not solvency.')).toHaveCount(1)
    for (const l of ['Uptime (40%)', 'Audit reliability (25%)', 'NUT Support (15%)', 'Version (15%)', 'Contact (5%)']) await expect(panel.getByText(l)).toBeVisible()
  })
}
