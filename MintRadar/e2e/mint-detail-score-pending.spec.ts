import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { frames, layoutReady, networkQuiet, resize, trackRequests } from './fixtures/settle'

// Task F3: a mint WITHOUT a stored score gets its score computed in the page from the 24 h uptime. Until that history has arrived
// (or when its request failed) the page used to compute it with uptime 0 and show 31, then replace it by the real 71. Now every
// place that shows the score shows a neutral placeholder ("—", aria-label "Score not available yet") in the same box instead.
// A mint with a stored score is not affected. The 24 h history is held at the mock and released by the test.

const ALPHA = 'https://alpha.mint.example'
const NUTS = { '4': {}, '5': {}, '10': { supported: true } }
const PLACEHOLDER = '—'
const SHIFT_LIMIT = 0.02

type History = 'held' | 'ok' | 'fail'

interface Opened { release: () => void; reached: Promise<void>; historyRequests: () => number }

async function open(page: Page, o: { stored: number | null; history: History; size: [number, number] }): Promise<Opened> {
  trackRequests(page)
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __obs: PerformanceObserver }
    w.__cls = 0
    w.__obs = new PerformanceObserver(list => {
      for (const e of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) if (!e.hadRecentInput) w.__cls += e.value
    })
    w.__obs.observe({ type: 'layout-shift', buffered: true })
  })
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  const fetchedAt = new Date(Date.now() - 5 * 60_000).toISOString()
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, lastCheckedAt: fetchedAt, nutsLimits: NUTS, reliabilityScore: o.stored } : m))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.route('**/api/mint/probe**', r => r.fulfill({ json: {
    url: ALPHA, online: true, latencyMs: 40, info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts: NUTS }, keysets: null, checkedAt: fetchedAt,
  } }))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let arrived!: () => void
  const reached = new Promise<void>(resolve => { arrived = resolve })
  let count = 0
  await page.route('**/api/mints/history**', async route => {
    if (new URL(route.request().url()).searchParams.get('period') !== '24h' || o.history === 'ok') return route.fallback()
    count++
    arrived()
    if (o.history === 'fail') return route.fulfill({ status: 500, json: { error: 'Internal server error' } })
    await gate
    return route.fallback()
  })
  await resize(page, o.size[0], o.size[1])
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  return { release, reached, historyRequests: () => count }
}

const gaugeNum = (page: Page) => page.locator('.md-reliability-panel .gauge-num')
const badge = (page: Page) => page.locator('.md-reliability-panel .reliability-badges > span').first()
const uptimeScore = (page: Page) => page.locator('.md-reliability-panel .rb-row-score').first()
// Top and height of the boxes that hold the score: the placeholder must take exactly the space the number takes.
const BOXES_DESKTOP = ['.md-reliability-panel .reliability-wrap', '.md-reliability-panel .gauge-wrap', '.md-reliability-panel .reliability-badges', '.md-reliability-panel .rb-scope-note']
const BOXES_PHONE = ['.md-sc-reliability', '.md-sc-reliability-donut', '.md-sc-reliability-meta']
const boxes = (page: Page, selectors: string[]): Promise<number[][]> =>
  page.evaluate(sels => sels.map(sel => { const r = document.querySelector(sel)!.getBoundingClientRect(); return [r.y, r.height].map(v => Math.round(v * 10) / 10) }), selectors)
const shiftTotal = (page: Page): Promise<number> =>
  page.evaluate(() => { const w = window as unknown as { __cls: number; __obs: PerformanceObserver }; w.__obs.takeRecords(); return w.__cls })

test.describe('Mint Detail score without a stored score', () => {
  test('(1) 1440px: the history is held back: placeholder, no number; after it arrives the score is 71', async ({ page }) => {
    const m = await open(page, { stored: null, history: 'held', size: [1440, 900] })
    await m.reached
    await expect(gaugeNum(page)).toBeVisible()
    await expect(gaugeNum(page)).toHaveText(PLACEHOLDER)
    await expect(gaugeNum(page)).toHaveAttribute('aria-label', 'Score not available yet')
    await expect(page.getByRole('img', { name: 'Score not available yet' })).toHaveCount(1)
    await expect(badge(page)).toHaveText('Not available yet')
    await expect(badge(page)).not.toContainText('Reliability')
    // the Uptime row is the part computed from the missing history: no "0%" and no "0/40" either
    await expect(page.locator('.md-reliability-panel .rb-row-display').first()).toHaveText(PLACEHOLDER)
    await expect(uptimeScore(page)).toHaveText(`${PLACEHOLDER}/40`)
    await expect(page.locator('.md-reliability-panel')).not.toContainText(/\b31\b/)
    // the History tab's "Average reliability" tile is the mean of the chart period's segment scores (92 in the mock),
    // not the current score: it does not wait for the held 24 h history (data audit 2026-10-25)
    await page.locator('.md-tab', { hasText: /^History/ }).click()
    await expect(page.locator('.md-hist-fig', { hasText: 'Average reliability' }).locator('.md-hist-fig-value')).toHaveText('92')

    m.release()
    await expect(page.locator('.md-hist-fig', { hasText: 'Average reliability' }).locator('.md-hist-fig-value')).toHaveText('92')
    await page.locator('.md-tab', { hasText: /^Overview/ }).click()
    await expect(gaugeNum(page)).toHaveText('71')
    await expect(gaugeNum(page)).not.toHaveAttribute('aria-label', /.+/)
    await expect(badge(page)).toHaveText('High Reliability')
    await expect(uptimeScore(page)).toHaveText('40/40')
  })

  test('(1) 390px: the compact tile and the breakdown dialog show the placeholder, then 71', async ({ page }) => {
    const m = await open(page, { stored: null, history: 'held', size: [390, 844] })
    await m.reached
    const tile = page.locator('.md-sc-reliability-num')
    await expect(tile).toHaveText(PLACEHOLDER)
    await expect(tile).toHaveAttribute('aria-label', 'Score not available yet')
    await expect(page.locator('.md-sc-reliability-badge')).toHaveText('Not available yet')
    await page.locator('.md-sc-reliability').click()
    const dialog = page.getByRole('dialog', { name: 'Reliability Score Breakdown' })
    await expect(dialog.locator('.rb-hero-score')).toHaveText(PLACEHOLDER)
    await expect(dialog.locator('.rb-row-score').first()).toHaveText(`${PLACEHOLDER}/40`)
    m.release()
    await expect(dialog.locator('.rb-hero-score')).toHaveText('71')
    await expect(dialog.locator('.rb-row-score').first()).toHaveText('40/40')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(tile).toHaveText('71')
  })

  test('(2) the history request fails: placeholder, no number, no page error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    const m = await open(page, { stored: null, history: 'fail', size: [1440, 900] })
    await m.reached
    // the query retries once; look at the state after the retry has failed too
    await expect.poll(() => m.historyRequests(), { message: 'the failed request is retried', timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    await networkQuiet(page)
    await frames(page, 3)
    await expect(gaugeNum(page)).toHaveText(PLACEHOLDER)
    await expect(gaugeNum(page)).toHaveAttribute('aria-label', 'Score not available yet')
    await expect(badge(page)).toHaveText('Not available yet')
    await expect(uptimeScore(page)).toHaveText(`${PLACEHOLDER}/40`)
    await expect(page.locator('.md-reliability-panel')).not.toContainText(/\b(31|71)\b/)
    expect(errors, 'no uncaught page error').toEqual([])
  })

  test('(3) a mint with a stored score shows it at once, with the history still held back', async ({ page }) => {
    const m = await open(page, { stored: 88, history: 'held', size: [1440, 900] })
    await m.reached
    await expect(gaugeNum(page)).toHaveText('88')
    await expect(gaugeNum(page)).not.toHaveAttribute('aria-label', /.+/)
    await expect(badge(page)).toHaveText('High Reliability')
    await expect(page.getByRole('img', { name: 'Score not available yet' })).toHaveCount(0)
    m.release()
    await expect(gaugeNum(page)).toHaveText('88')
  })

  for (const size of [[390, 844], [1440, 900]] as const) {
    test(`(4) ${size[0]}x${size[1]}: layout shift from the placeholder to the score is at most ${SHIFT_LIMIT}`, async ({ page }) => {
      const m = await open(page, { stored: null, history: 'held', size: [...size] })
      await m.reached
      const num = size[0] >= 1024 ? gaugeNum(page) : page.locator('.md-sc-reliability-num')
      await expect(num).toHaveText(PLACEHOLDER)
      await layoutReady(page)
      const selectors = size[0] >= 1024 ? BOXES_DESKTOP : BOXES_PHONE
      const placeholderBoxes = await boxes(page, selectors)
      // Only what the arrival of the history does is measured: the first paint (fonts) is not its doing.
      await shiftTotal(page)
      await page.evaluate(() => { (window as unknown as { __cls: number }).__cls = 0 })
      m.release()
      await expect(num).toHaveText('71')
      await networkQuiet(page)
      await layoutReady(page)
      await frames(page, 3)
      expect(await shiftTotal(page), `layout shift when the score replaces the placeholder at ${size[0]}px`).toBeLessThanOrEqual(SHIFT_LIMIT)
      expect(await boxes(page, selectors), 'the boxes that hold the score keep their top and height').toEqual(placeholderBoxes)
    })
  }
})
