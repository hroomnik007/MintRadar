import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { trendPayload, emptyTrendPayload, trendDaysOf } from './fixtures/trendSeries'
import { resize, networkQuiet } from './fixtures/settle'

// Reliability Score trend: a thin vertical marker, labelled with the version, at each methodology change inside the
// shown period (METHODOLOGY_CHANGES: v2 on 2026-10-08, v3 on 2026-10-09, v4 on 2026-10-21 outside the mock series; v1 is the initial formula, not a change).
// The movers panel adds one muted line when its window holds a change. The mock series ends on 2026-10-16.

async function open(page: Page, width: number, series: (days: 30 | 90) => unknown = trendPayload) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/stats/reliability-trend**', route => route.fulfill({ json: series(trendDaysOf(route.request().url())) }))
  await resize(page, width, 900)
  await page.goto('/stats')
  await networkQuiet(page)
  await page.locator('.stats-trend-panel').scrollIntoViewIfNeeded()
}

for (const width of [1440, 768, 390, 320]) {
  for (const days of [30, 90] as const) {
    test(`markers for v2 and v3 on the ${days}d trend at ${width}px, inside the chart, labels apart`, async ({ page }) => {
      await open(page, width)
      const panel = page.locator('.stats-trend-panel')
      if (days === 90) {
        await panel.getByRole('button', { name: '90d', exact: true }).click()
        await expect(panel.locator('.trend-summary-label').filter({ hasText: '90d High' })).toHaveCount(1)
      }
      const markers = panel.locator('.stats-trend-marker')
      await expect(markers).toHaveCount(2)
      const labels = markers.locator('text')
      await expect(labels).toHaveText(['v2', 'v3'])

      const container = (await panel.locator('.recharts-responsive-container').boundingBox())!
      const boxes = await labels.evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }))
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(container.x)
        expect(b.right).toBeLessThanOrEqual(container.x + container.width)
      }
      const [a, b] = [boxes[0]!, boxes[1]!]
      expect(b.left >= a.right || a.left >= b.right || b.top >= a.bottom || a.top >= b.bottom, 'the v2 and v3 labels do not overlap').toBe(true)

      const lines = markers.locator('line')
      await expect(lines).toHaveCount(2)
      const xs = await lines.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().x))
      expect(xs[1]!, 'v3 is one day right of v2').toBeGreaterThan(xs[0]!)

      // The text alternative names both changes.
      await expect(panel.locator('.sr-only')).toHaveText('Methodology changed to v2 on 8 Oct. Methodology changed to v3 on 9 Oct.')
    })
  }
}

test('no marker when the shown period holds no change, and none on an empty chart', async ({ page }) => {
  await open(page, 1440, days => {
    const p = trendPayload(days, '2026-10-30')
    return { ...p, trend: p.trend.filter(d => d.date > '2026-10-21') } // starts after v4, the newest change
  })
  await expect(page.locator('.stats-trend-panel .recharts-area')).toBeVisible()
  await expect(page.locator('.stats-trend-marker')).toHaveCount(0)
  await expect(page.locator('.stats-trend-panel .sr-only')).toHaveCount(0)
})

test('an empty trend draws no marker', async ({ page }) => {
  await open(page, 1440, emptyTrendPayload)
  await expect(page.getByText('No data yet').first()).toBeVisible()
  await expect(page.locator('.stats-trend-marker')).toHaveCount(0)
})

test.describe('movers note', () => {
  const note = (page: Page) => page.locator('.stats-movers-panel .stats-movers-note')

  test('30d window holds v2 and v3, 7d window holds none', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'))
    await open(page, 1440)
    const panel = page.locator('.stats-movers-panel')
    await expect(note(page)).toHaveCount(0)
    await panel.getByRole('button', { name: '30d', exact: true }).click()
    await expect(note(page)).toHaveText('Includes methodology changes on 8 Oct (v2), 9 Oct (v3).')
    await panel.getByRole('button', { name: '7d', exact: true }).click()
    await expect(note(page)).toHaveCount(0)
  })

  test('a window that holds exactly one change names it in the singular', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-08T12:00:00Z')) // the 7d window ends the day v2 went live; v3 is still ahead
    await open(page, 1440)
    await expect(note(page)).toHaveText('Includes a methodology change on 8 Oct (v2).')
  })

  test('it is a muted line in the size of the panel\'s other muted lines', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'))
    await open(page, 1440)
    await page.locator('.stats-movers-panel').getByRole('button', { name: '30d', exact: true }).click()
    await expect(note(page)).toBeVisible()
    expect(await note(page).evaluate(n => getComputedStyle(n).fontSize)).toBe('11.5px')
  })
})
