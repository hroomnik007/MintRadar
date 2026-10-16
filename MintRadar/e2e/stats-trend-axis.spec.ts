import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { trendPayload, emptyTrendPayload, trendDaysOf } from './fixtures/trendSeries'
import { resize, frames, flush, networkQuiet, trackRequests } from './fixtures/settle'

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
  1440: { 30: [9, 11], 90: [11, 14] },
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
        await panel.getByRole('button', { name: '90d', exact: true }).click()
        // The summary line names the period of the data on screen: 90d is rendered (it may come from the prefetch).
        await expect(panel.locator('.trend-summary-label').filter({ hasText: '90d High' })).toHaveCount(1)
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
      // Mobile (up to 768px): 7, 14 or 28 days; desktop also 2 or 3.
      expect(width <= 768 ? [7, 14, 28] : [2, 3, 7, 14, 28]).toContain(gaps[0])
      for (const g of gaps) expect(Math.abs(g - gaps[0]!)).toBeLessThanOrEqual(1)
    })
  }
}

// ── Loading ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Loading never looks like empty: the previous chart stays (dimmed) while the other period loads, "No data yet" is only
// for a successful empty response, a failed request shows the load error, the other period is prefetched after the
// first success and a period that was loaded once is shown without a request.

type Days = 30 | 90
interface TrendMock {
  requests: Days[]
  /** Resolves once a request for `days` has reached the mock (and is being held, if it is held). */
  reached(days: Days): Promise<void>
  /** Answers the held request for `days`; waits until it has reached the mock. */
  release(days: Days): Promise<void>
  setStatus(days: Days, status: number): void
  setEmpty(days: Days, empty: boolean): void
}

async function mockTrend(page: Page, opts: { hold?: Days[] } = {}): Promise<TrendMock> {
  const requests: Days[] = []
  const held = new Set<Days>(opts.hold ?? [])
  const waiting = new Map<Days, () => void>()
  const status = new Map<Days, number>()
  const empty = new Set<Days>()
  await page.route('**/api/stats/reliability-trend**', async route => {
    const days = trendDaysOf(route.request().url())
    requests.push(days)
    if (held.has(days)) await new Promise<void>(resolve => { waiting.set(days, resolve) })
    const code = status.get(days)
    if (code !== undefined && code !== 200) { await route.fulfill({ status: code, json: { error: 'Internal server error' } }); return }
    await route.fulfill({ json: empty.has(days) ? emptyTrendPayload(days) : trendPayload(days) })
  })
  return {
    requests,
    reached: days => expect.poll(() => requests.includes(days), { message: `a ${days}d request reached the mock` }).toBe(true),
    release: async days => {
      await expect.poll(() => waiting.has(days), { message: `the ${days}d request is waiting at the mock` }).toBe(true)
      held.delete(days)
      waiting.get(days)!()
      waiting.delete(days)
    },
    setStatus: (days, code) => { status.set(days, code) },
    setEmpty: (days, isEmpty) => { if (isEmpty) empty.add(days); else empty.delete(days) },
  }
}

async function openStats(page: Page, width = 1440): Promise<void> {
  trackRequests(page)
  await mockRelays(page)
  await installApiMocks(page)
  await resize(page, width, 900)
}

async function openTrend(page: Page) {
  await page.goto('/stats')
  const panel = page.locator('.stats-trend-panel')
  await panel.scrollIntoViewIfNeeded()
  return panel
}

/** Samples, on every animation frame, whether "No data yet" is shown or the body is dimmed; read the result with `stop()`. */
async function startSampler(page: Page): Promise<() => Promise<{ noData: boolean; pending: boolean; frames: number }>> {
  await page.evaluate(() => {
    const w = window as unknown as { __sample: { noData: boolean; pending: boolean; frames: number; on: boolean } }
    w.__sample = { noData: false, pending: false, frames: 0, on: true }
    const tick = (): void => {
      const s = w.__sample
      if (!s.on) return
      const panel = document.querySelector('.stats-trend-panel')
      if (panel?.textContent?.includes('No data yet')) s.noData = true
      if (panel?.querySelector('.stats-trend-body.is-pending')) s.pending = true
      s.frames++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  return () => page.evaluate(() => {
    const s = (window as unknown as { __sample: { noData: boolean; pending: boolean; frames: number; on: boolean } }).__sample
    s.on = false
    return { noData: s.noData, pending: s.pending, frames: s.frames }
  })
}

const chartPath = (panel: ReturnType<Page['locator']>) => panel.locator('.stats-trend-body .recharts-area-curve')

test('first load: the loading note, never "No data yet"; the chart appears when the response does', async ({ page }) => {
  await openStats(page)
  const mock = await mockTrend(page, { hold: [30] })
  const panel = await openTrend(page)
  await mock.reached(30)
  await expect(panel.getByRole('status')).toHaveText('Loading…')
  await expect(panel.getByText('No data yet')).toHaveCount(0)
  await mock.release(30)
  await expect(chartPath(panel)).toHaveCount(1)
  await expect(panel.getByRole('status')).toHaveCount(0)
})

for (const width of [1440, 768, 390, 320]) {
  test(`${width}px: while 90d loads the 30d chart stays, dimmed; "No data yet" never appears; 90d renders with its own ticks`, async ({ page }) => {
    await openStats(page, width)
    const mock = await mockTrend(page, { hold: [90] })
    const panel = await openTrend(page)
    await expect(chartPath(panel)).toHaveCount(1)
    const before30 = await stableTicks(page)
    await mock.reached(90) // the prefetch asked for it; the click below waits on the same request
    const sampled = await startSampler(page)

    await panel.getByRole('button', { name: '90d', exact: true }).click()
    await expect(panel.getByRole('button', { name: '90d', exact: true })).toHaveClass(/active/)
    const body = panel.locator('.stats-trend-body')
    await expect(body).toHaveClass(/is-pending/)
    await expect(chartPath(panel)).toHaveCount(1)
    await expect(panel.getByText('No data yet')).toHaveCount(0)
    await expect.poll(() => body.evaluate(el => getComputedStyle(el).opacity), { message: 'dimmed to 0.5 once the opacity transition ended' }).toBe('0.5')
    expect(await body.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
    expect((await stableTicks(page)).map(t => t.text)).toEqual(before30.map(t => t.text))

    await mock.release(90)
    await expect(body).not.toHaveClass(/is-pending/)
    await expect(panel.getByText('No data yet')).toHaveCount(0)
    const after = await sampled()
    expect(after.pending, 'the dimmed state was observed while the request was held').toBe(true)
    expect(after.noData, '"No data yet" was never rendered').toBe(false)
    expect(after.frames).toBeGreaterThan(2)

    const ticks = await stableTicks(page)
    expect(ticks.at(-1)!.text).toBe(NEWEST_LABEL)
    expect(ticks.map(t => t.text)).not.toEqual(before30.map(t => t.text))
    await expect(panel.locator('.trend-summary-label').filter({ hasText: '90d High' })).toHaveCount(1)
  })
}

test('a successful but empty 90d response says "No data yet"', async ({ page }) => {
  await openStats(page)
  const mock = await mockTrend(page)
  mock.setEmpty(90, true)
  const panel = await openTrend(page)
  await expect(chartPath(panel)).toHaveCount(1)
  await panel.getByRole('button', { name: '90d', exact: true }).click()
  await expect(panel.getByText('No data yet')).toBeVisible()
  await expect(chartPath(panel)).toHaveCount(0)
})

test('a failed 90d request shows the load error with Try again, never "No data yet"', async ({ page }) => {
  await openStats(page)
  const mock = await mockTrend(page)
  mock.setStatus(90, 500)
  const panel = await openTrend(page)
  await expect(chartPath(panel)).toHaveCount(1)
  await panel.getByRole('button', { name: '90d', exact: true }).click()
  const alert = panel.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(panel.getByText('No data yet')).toHaveCount(0)
  mock.setStatus(90, 200)
  const before = mock.requests.length
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(chartPath(panel)).toHaveCount(1)
  expect(mock.requests.length).toBeGreaterThan(before)
  expect((await stableTicks(page)).at(-1)!.text).toBe(NEWEST_LABEL)
})

test('the other period is prefetched after the first load, and the toggle is then instant in both directions with no new request', async ({ page }) => {
  await openStats(page)
  const mock = await mockTrend(page)
  const panel = await openTrend(page)
  await expect(chartPath(panel)).toHaveCount(1)
  await mock.reached(90) // issued without a click
  await expect.poll(() => mock.requests.length, { message: 'both periods were requested' }).toBe(2)
  await flush(page)

  const ticks30 = (await stableTicks(page)).map(t => t.text)
  const sampled = await startSampler(page)
  await panel.getByRole('button', { name: '90d', exact: true }).click()
  const body = panel.locator('.stats-trend-body')
  // Same task as the click: the 90d chart is already there, nothing is dimmed and no loading note is shown.
  expect(await body.evaluate(el => el.classList.contains('is-pending'))).toBe(false)
  await expect(panel.getByRole('status')).toHaveCount(0)
  const ticks90 = (await stableTicks(page)).map(t => t.text)
  expect(ticks90).not.toEqual(ticks30)
  expect(ticks90.at(-1)).toBe(NEWEST_LABEL)

  await panel.getByRole('button', { name: '30d', exact: true }).click()
  expect(await body.evaluate(el => el.classList.contains('is-pending'))).toBe(false)
  expect((await stableTicks(page)).map(t => t.text)).toEqual(ticks30)
  await flush(page)
  const end = await sampled()
  expect(end.pending).toBe(false)
  expect(end.noData).toBe(false)
  expect(mock.requests, 'one request per period, nothing more').toEqual([30, 90])
})

test('no layout shift while switching: the chart container keeps its height and the page does not move', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number }
    w.__cls = 0
    new PerformanceObserver(list => {
      for (const e of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) if (!e.hadRecentInput) w.__cls += e.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await openStats(page)
  const mock = await mockTrend(page, { hold: [90] })
  const panel = await openTrend(page)
  await expect(chartPath(panel)).toHaveCount(1)
  await mock.reached(90)
  await stableTicks(page)
  const body = panel.locator('.stats-trend-body')
  const heightBefore = (await body.boundingBox())!.height
  await page.evaluate(() => { (window as unknown as { __cls: number }).__cls = 0 })

  await panel.getByRole('button', { name: '90d', exact: true }).click()
  await expect(body).toHaveClass(/is-pending/)
  await frames(page, 3)
  expect((await body.boundingBox())!.height, 'height while loading').toBe(heightBefore)
  await mock.release(90)
  await expect(body).not.toHaveClass(/is-pending/)
  await stableTicks(page)
  expect((await body.boundingBox())!.height, 'height after loading').toBe(heightBefore)
  await frames(page, 3)
  const shift = await page.evaluate(() => (window as unknown as { __cls: number }).__cls)
  expect(shift).toBeLessThan(0.01)
})
