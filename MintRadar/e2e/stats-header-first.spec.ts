import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { mockStatsEndpoints } from './fixtures/statsLayout'
import { networkQuiet } from './fixtures/settle'

// /stats paints its header (title + description) from the route fallback, before the Stats chunk has arrived, and the chart
// library (vendor-charts, loaded with the trend chart) never gates anything else on the page. Each chunk is held at the
// route until the test lets it go, and only after its request reached the route.

const STATS_CHUNK = /\/(src\/pages\/Stats\.tsx|assets\/Stats-[^/]+\.js)(\?|$)/
const PLOT_CHUNK = /\/(src\/components\/stats\/ReliabilityTrendPlot\.tsx|assets\/ReliabilityTrendPlot-[^/]+\.js)(\?|$)/
const DESCRIPTION = /How the Cashu mint network is doing right now, measured from Nuremberg\./

async function holdChunk(page: Page, pattern: RegExp) {
  let arrived!: () => void
  const reached = new Promise<void>(resolve => { arrived = resolve })
  let open!: () => void
  const gate = new Promise<void>(resolve => { open = resolve })
  await page.route(pattern, async route => {
    arrived()
    await gate
    await route.continue()
  })
  return { reached, release: () => open() }
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await mockStatsEndpoints(page)
})

test.describe('Stats header first', () => {
  test('the title and the description are on screen while the Stats chunk is still held', async ({ page }) => {
    const held = await holdChunk(page, STATS_CHUNK)
    await page.goto('/stats')
    await held.reached
    await expect(page.getByRole('heading', { level: 1, name: /Network stats/ })).toBeVisible()
    await expect(page.getByText(DESCRIPTION)).toBeVisible()
    await expect(page.locator('.stats-page')).toHaveCount(0)
    await expect(page.locator('h1')).toHaveCount(1)

    held.release()
    await expect(page.locator('.stats-nhi-panel')).toBeVisible()
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.getByText(DESCRIPTION)).toHaveCount(1)
  })

  test('the board and the header do not wait for the chart chunk; its box keeps 120 px', async ({ page }) => {
    // 390 px: below 1280 px the chart box is a fixed 120 px (above, it fills the card in both states alike).
    await page.setViewportSize({ width: 390, height: 844 })
    const held = await holdChunk(page, PLOT_CHUNK)
    await page.goto('/stats')
    await held.reached
    await expect(page.getByRole('heading', { level: 1, name: /Network stats/ })).toBeVisible()
    await expect(page.locator('.stats-nhi-panel')).toBeVisible()
    const body = page.locator('.stats-trend-body')
    await expect(body.getByRole('status')).toHaveText('Loading…')
    expect((await body.boundingBox())!.height).toBe(120)
    await expect(page.locator('.recharts-responsive-container')).toHaveCount(0)

    held.release()
    await expect(page.locator('.recharts-responsive-container')).toBeVisible()
    await networkQuiet(page)
    expect((await body.boundingBox())!.height).toBe(120)
    await expect(page.locator('h1')).toHaveCount(1)
  })
})
