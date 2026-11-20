import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Mint Detail "Last 30 days" (owner, 2026-11-20): with a mouse, hovering a daily bar shows that day's date, uptime and,
// when an outage fell on it, the time down. Pinned to the panel near either end; nothing on touch.

const ALPHA = MOCK_MINTS[0]!.url
const DAY = 86_400_000

async function open(page: Page, width: number) {
  await mockRelays(page)
  await installApiMocks(page)
  const today = Math.floor(Date.now() / DAY) * DAY
  const days: Array<number | null> = Array.from({ length: 30 }, () => 100)
  days[27] = 97.9 // three days ago: one outage of 30 min
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: {
    sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 1,
    outages: [{ startedAt: new Date(today - 2 * DAY + 3_600_000).toISOString(), durationMs: 30 * 60_000 }],
  } }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => m.url === ALPHA ? { ...m, uptimeDaily30: days } : m) }))
  await resize(page, width, 900)
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-trace [data-testid="uptime-bars"]')).toBeVisible()
  await layoutReady(page)
}

async function hoverDay(page: Page, i: number) {
  const box = (await page.locator('.md-trace [data-testid="uptime-bars"]').boundingBox())!
  await page.mouse.move(box.x + ((i + 0.5) / 30) * box.width, box.y + box.height - 4)
}

for (const width of [1440, 900]) {
  test(`${width}px: hovering a bar reads that day; an outage day adds the time down; leaving hides it`, async ({ page }) => {
    await open(page, width)
    const tip = page.getByTestId('uptime-day-readout')
    await expect(tip).toHaveCount(0)

    await hoverDay(page, 10)
    await expect(tip).toContainText('100% uptime')
    await expect(tip).not.toContainText('down')

    await hoverDay(page, 27)
    await expect(tip).toContainText('97.9% uptime, down 30 min')

    await hoverDay(page, 29)
    await expect(tip).toContainText('Today,')

    // The readout stays inside the panel at both ends.
    const panel = (await page.locator('.md-trace').boundingBox())!
    for (const i of [0, 29]) {
      await hoverDay(page, i)
      const b = (await tip.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(panel.x)
      expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5)
    }

    await page.mouse.move(5, 5)
    await expect(tip).toHaveCount(0)
  })
}

test('the bars keep one summary sentence for assistive tech', async ({ page }) => {
  await open(page, 1440)
  await expect(page.locator('.md-trace [data-testid="uptime-bars"]')).toHaveAttribute('aria-label', /29 of 30 checked days/)
})
