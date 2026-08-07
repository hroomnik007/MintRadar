import { test, expect, devices } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

/**
 * Regression guard for the white focus ring that appeared around a chart's plot
 * area when tapping it on mobile.
 *
 * Recharts renders its internal z-index layers as `<g tabindex="-1">` inside the
 * chart `<svg>`. Chrome focuses such an element on tap and paints its default
 * two-tone focus ring (outline: auto — white outer, dark inner, rounded corners)
 * around the `<g>`'s box. Two earlier fixes targeted `.recharts-surface` (the
 * `<svg>`) and `-webkit-tap-highlight-color` and therefore never matched.
 *
 * The assertion is on computed styles rather than a screenshot so it stays
 * deterministic in CI.
 */
test.use({ ...devices['Pixel 7'] })

test('tapping a chart paints no focus outline on any element under the finger', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)

  const now = Date.now()
  await page.route('**/api/stats/trust-trend**', route => route.fulfill({
    json: {
      trend: Array.from({ length: 30 }, (_, i) => ({
        date: new Date(now - (29 - i) * 86_400_000).toISOString().slice(0, 10),
        avgTrust: 60 + (i % 20),
      })),
      periodDays: 30,
      daysOfDataAvailable: 30,
      earliestCheckedAt: new Date(now - 30 * 86_400_000).toISOString(),
    },
  }))

  await page.goto('/stats')
  const chart = page.locator('.recharts-surface').first()
  await chart.waitFor({ state: 'visible' })
  await page.locator('.stats-panel').filter({ has: chart }).scrollIntoViewIfNeeded()

  const box = (await chart.boundingBox())!
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)

  await page.touchscreen.tap(x, y)

  // Walk the whole ancestor chain under the tap point and collect anything that
  // would paint a ring — this is what makes the test blind to WHICH element
  // recharts happens to focus, so a future recharts refactor can't slip past it.
  const ringed = await page.evaluate(({ x, y }) => {
    const out: string[] = []
    for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (cs.outlineStyle !== 'none') {
        out.push(`${el.tagName.toLowerCase()} outline=${cs.outline}`)
      }
    }
    return out
  }, { x, y })

  expect(ringed).toEqual([])

  // The tap must still activate the tooltip — the ring is gone, the chart is not.
  await expect(page.locator('.recharts-tooltip-wrapper')).toBeVisible()
})

test('keyboard focus on the chart still shows the accent ring', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/stats/trust-trend**', route => route.fulfill({
    json: {
      trend: [{ date: '2026-01-01', avgTrust: 70 }, { date: '2026-01-02', avgTrust: 80 }],
      periodDays: 30, daysOfDataAvailable: 30, earliestCheckedAt: '2026-01-01T00:00:00.000Z',
    },
  }))

  await page.goto('/stats')
  await page.locator('.recharts-surface').first().waitFor({ state: 'visible' })

  const style = await page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('.recharts-surface')!
    svg.focus()
    return getComputedStyle(svg).outline
  })

  expect(style).toContain('solid')
  expect(style).not.toContain('none')
})
