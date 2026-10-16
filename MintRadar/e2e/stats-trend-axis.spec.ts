import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { trendPayload, trendDaysOf } from './fixtures/trendSeries'
import { resize, frames, networkQuiet, trackRequests } from './fixtures/settle'

// Stats "Reliability Score trend": the X axis ticks are chosen by DATE (newest date minus multiples of 7, 14 or 28
// days, at least 64px apart), the newest date is the last label and right aligned, nothing is clipped or overlapping.
// See docs/claude/stats-dashboard-watchlist-ui.md ("Reliability Score trend").

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const NEWEST_LABEL = '16 Oct'

interface Tick { text: string; left: number; right: number }

async function readTicksOnce(page: Page): Promise<Tick[]> {
  return page.locator('.stats-trend-panel .recharts-xAxis-tick-labels text').evaluateAll(nodes =>
    nodes.map(n => { const r = n.getBoundingClientRect(); return { text: n.textContent ?? '', left: r.left, right: r.right } }))
}

/** The labels once they stopped changing: the axis re-picks its ticks when the container reports its width. */
async function stableTicks(page: Page): Promise<Tick[]> {
  let previous = ''
  await expect.poll(async () => {
    await frames(page, 3)
    const now = JSON.stringify(await readTicksOnce(page))
    const same = now === previous && now !== '[]'
    previous = now
    return same
  }, { message: 'the X axis labels are stable' }).toBe(true)
  return readTicksOnce(page)
}

const dayOfLabel = (text: string): number => {
  const [d, m] = text.split(' ')
  return Date.UTC(2026, MONTHS.indexOf(m!), Number(d)) / 86_400_000
}

const EXPECTED_COUNT: Record<number, { 30: [number, number]; 90: [number, number] }> = {
  1440: { 30: [4, 6], 90: [6, 8] },
  768: { 30: [4, 6], 90: [5, 8] },
  390: { 30: [3, 5], 90: [3, 5] },
  320: { 30: [3, 4], 90: [3, 4] },
}

for (const width of [1440, 768, 390, 320]) {
  for (const days of [30, 90] as const) {
    test(`X axis labels at ${width}px, ${days}d: few, apart, inside the chart, newest last, equal date steps`, async ({ page }) => {
      trackRequests(page)
      await mockRelays(page)
      await installApiMocks(page)
      await page.route('**/api/stats/reliability-trend**', route => route.fulfill({ json: trendPayload(trendDaysOf(route.request().url())) }))
      await resize(page, width, 900)
      await page.goto('/stats')
      await networkQuiet(page)
      const panel = page.locator('.stats-trend-panel')
      await panel.scrollIntoViewIfNeeded()
      if (days === 90) {
        const responded = page.waitForResponse(r => r.url().includes('reliability-trend') && r.url().includes('days=90'))
        await panel.getByRole('button', { name: '90d', exact: true }).click()
        await responded
      }
      await expect(panel.getByRole('button', { name: `${days}d`, exact: true })).toHaveClass(/active/)

      const ticks = await stableTicks(page)
      const [min, max] = EXPECTED_COUNT[width]![days]
      expect(ticks.length).toBeGreaterThanOrEqual(min)
      expect(ticks.length).toBeLessThanOrEqual(max)

      // The newest date is the last label (the mock series ends on 2026-10-16).
      expect(ticks.at(-1)!.text).toBe(NEWEST_LABEL)

      // No two labels overlap (gap of at least 8px) and every label is fully inside the chart container.
      const container = (await panel.locator('.recharts-responsive-container').boundingBox())!
      const sorted = [...ticks].sort((a, b) => a.left - b.left)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.left - sorted[i - 1]!.right, `${sorted[i - 1]!.text} → ${sorted[i]!.text}`).toBeGreaterThanOrEqual(8)
      }
      for (const t of ticks) {
        expect(t.left, `${t.text} left edge`).toBeGreaterThanOrEqual(container.x)
        expect(t.right, `${t.text} right edge`).toBeLessThanOrEqual(container.x + container.width)
      }

      // Time spacing is constant: one step of 7, 14 or 28 days, within a day.
      const dayNumbers = ticks.map(t => dayOfLabel(t.text))
      const gaps = dayNumbers.slice(1).map((d, i) => d - dayNumbers[i]!)
      expect([7, 14, 28]).toContain(gaps[0])
      for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(1)
    })
  }
}
