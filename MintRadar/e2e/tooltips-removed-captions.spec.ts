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
    await expect(page.locator('.nhi-gauge-wrap')).toBeVisible()

    const tile = page.locator('.stat-card').filter({ hasText: 'average uptime' })
    await expect(tile).toHaveCount(1)
    await expect(triggers(tile)).toHaveCount(0)
    await expect(tile.locator('.stat-note')).toHaveText(avgUptimeCaption())
    await expect(tile.locator('.stat-note')).toHaveText(`of mints not offline for ${DEGRADED_AFTER_HOURS}h+`)
    expect(avgUptimeCaption().length).toBeLessThanOrEqual(32)

    const head = page.locator('.stats-nhi-panel .stats-panel-head')
    await expect(triggers(head)).toHaveCount(0)
    await expect(head.locator('.stats-panel-desc')).toHaveText(nhiSubtitle())
    await expect(head.locator('.stats-panel-desc')).toHaveText('Weighted from five factors.')

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}

test('the gauge opens the breakdown dialog from the keyboard (Tab to the gauge, Enter) and by click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/stats')
  await expect(page.locator('.nhi-gauge-wrap')).toBeVisible()

  let reached = false
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => document.activeElement?.classList.contains('nhi-wrap') ?? false)
  }
  expect(reached, 'the gauge is reachable with Tab').toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.locator('.nhi-gauge-wrap').click()
  await expect(page.getByRole('dialog')).toBeVisible()
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
    await expect(tile.locator('.md-sc-sub')).toContainText(`server · ${PROBE_LOCATION}`)
    await expect(tile.locator('.latency-test-btn')).toHaveText('Show my latency')
    // the second ⓘ, next to the button, stays
    await expect(triggers(tile)).toHaveCount(1)

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })
}

for (const width of [1440, 768]) {
  test(`Mint Detail at ${width}px: the Reliability Score card header has no tooltip, one muted line says it is not solvency`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 })
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    const panel = page.locator('.md-reliability-panel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.md-panel-title')).toHaveText('Reliability Score')
    await expect(triggers(panel.locator('.md-panel-title').locator('xpath=..'))).toHaveCount(0)
    const note = panel.locator('.rb-scope-note')
    await expect(note).toHaveCount(1)
    await expect(note).toHaveText('Operational health, not solvency.')
    await expect(note).toBeVisible()
    // the note sits inside the card, below the badge, above the breakdown rows
    const [badge, noteBox, row] = await Promise.all([
      panel.locator('.reliability-wrap').boundingBox(), note.boundingBox(), panel.locator('.rb-row').first().boundingBox(),
    ])
    expect(noteBox!.y).toBeGreaterThanOrEqual(badge!.y + badge!.height - 1)
    expect(noteBox!.y + noteBox!.height).toBeLessThanOrEqual(row!.y + 1)
    // the weights of the five components stay visible as row labels
    for (const l of ['Uptime (40%)', 'Audit reliability (25%)', 'NUT Support (15%)', 'Version (15%)', 'Contact (5%)']) await expect(panel.getByText(l)).toBeVisible()
  })
}
