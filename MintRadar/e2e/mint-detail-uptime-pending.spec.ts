import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { frames, layoutReady, networkQuiet, resize, trackRequests } from './fixtures/settle'

// Task D2 item 3: a mint WITH a stored score has no reason to wait for the 24 h history to show its score, but the Uptime row of
// the breakdown is that history. Until it has arrived (or when its request failed) the row used to show "0%" and "0/40" in red,
// then jump to the real value. Now it shows the placeholder "—" (aria-label "Uptime not available yet") in the same box.
// Same pattern as mint-detail-score-pending.spec.ts (task F3). The history is held at the mock and released by the test; a real
// 0% (a mint that is really down) must still be shown as "0%".

const ALPHA = 'https://alpha.mint.example'
const NUTS = { '4': {}, '5': {}, '10': { supported: true } }
const PLACEHOLDER = '—'
const SHIFT_LIMIT = 0.02

type History = 'held' | 'fail'

const historyOf = (uptimePct: number) => {
  const bucket = new Date(Date.now() - 3_600_000).toISOString()
  return {
    period: '24h',
    segments: [{ bucket, online: uptimePct > 0, latencyMs: uptimePct > 0 ? 50 : null, total: 12, onlineCount: Math.round(uptimePct * 12 / 100), uptimePct, reliabilityScore: 50 }],
    uptimePct, avgLatencyMs: 55, prevUptimePct: 98, prevAvgLatencyMs: 60, earliestCheckedAt: bucket, daysOfDataAvailable: 1, periodDays: 1,
    prevPeriodInsufficientHistory: false, history: [{ online: uptimePct > 0, latencyMs: 50, checkedAt: bucket }],
  }
}

interface Opened { release: () => void; reached: Promise<void>; historyRequests: () => number }

async function open(page: Page, o: { history: History; uptimePct: number; size: [number, number] }): Promise<Opened> {
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
  // A STORED score: the page does not wait for the history to show it.
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, lastCheckedAt: fetchedAt, nutsLimits: NUTS, reliabilityScore: 88 } : m))
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
    if (new URL(route.request().url()).searchParams.get('period') !== '24h') return route.fallback()
    count++
    arrived()
    if (o.history === 'fail') return route.fulfill({ status: 500, json: { error: 'Internal server error' } })
    await gate
    return route.fulfill({ json: historyOf(o.uptimePct) })
  })
  await resize(page, o.size[0], o.size[1])
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  return { release, reached, historyRequests: () => count }
}

const gaugeNum = (page: Page) => page.locator('.md-reliability-panel .gauge-num')
const uptimeRow = (page: Page) => page.locator('.md-reliability-panel .rb-row').first()
const display = (page: Page) => uptimeRow(page).locator('.rb-row-display')
const score = (page: Page) => uptimeRow(page).locator('.rb-row-score')
// The line with the value ('.rb-row-top') is what this task changes. The grey source line below it gains "N checks" when the history
// arrives and may wrap to a second line at 1440px; that is not the value cell and is not covered here.
const BOXES = ['.md-reliability-panel .reliability-wrap', '.md-reliability-panel .rb-row-top']
const boxes = (page: Page): Promise<number[][]> =>
  page.evaluate(sels => sels.map(sel => { const r = document.querySelector(sel)!.getBoundingClientRect(); return [r.y, r.height].map(v => Math.round(v * 10) / 10) }), BOXES)
const shiftTotal = (page: Page): Promise<number> =>
  page.evaluate(() => { const w = window as unknown as { __cls: number; __obs: PerformanceObserver }; w.__obs.takeRecords(); return w.__cls })

test.describe('Mint Detail Uptime row with a stored score and a missing 24 h history', () => {
  test('(1) 1440px: held history: the score is shown, the Uptime row is a neutral placeholder; the real value follows', async ({ page }) => {
    const m = await open(page, { history: 'held', uptimePct: 97, size: [1440, 900] })
    await m.reached
    await expect(gaugeNum(page)).toHaveText('88')
    await expect(display(page)).toHaveText(PLACEHOLDER)
    await expect(display(page)).toHaveAttribute('aria-label', 'Uptime not available yet')
    await expect(page.getByRole('img', { name: 'Uptime not available yet' })).toHaveCount(1)
    await expect(score(page)).toHaveText(`${PLACEHOLDER}/40`)
    await expect(display(page)).not.toHaveText('0%')
    // not shown as bad: neither the red of a low value nor the amber
    const colour = await score(page).evaluate(el => getComputedStyle(el).color)
    const text3 = await page.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--text3)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c })
    expect(colour, 'the placeholder has the neutral colour').toBe(text3)
    m.release()
    await expect(display(page)).toHaveText('97%')
    await expect(display(page)).not.toHaveAttribute('aria-label', /.+/)
    await expect(score(page)).toHaveText(/^\d+\/40$/)
    await expect(gaugeNum(page)).toHaveText('88')
  })

  test('(2) 390px: the breakdown dialog shows the placeholder, then the real value', async ({ page }) => {
    const m = await open(page, { history: 'held', uptimePct: 97, size: [390, 844] })
    await m.reached
    await expect(page.locator('.md-sc-reliability-num')).toHaveText('88')
    await page.locator('.md-sc-reliability').click()
    const dialog = page.getByRole('dialog', { name: 'Reliability Score Breakdown' })
    await expect(dialog.locator('.rb-row-display').first()).toHaveText(PLACEHOLDER)
    await expect(dialog.locator('.rb-row-display').first()).toHaveAttribute('aria-label', 'Uptime not available yet')
    await expect(dialog.locator('.rb-row-score').first()).toHaveText(`${PLACEHOLDER}/40`)
    m.release()
    await expect(dialog.locator('.rb-row-display').first()).toHaveText('97%')
  })

  test('(3) a real 0% (a mint that is really down) is still shown as "0%" once it has arrived', async ({ page }) => {
    const m = await open(page, { history: 'held', uptimePct: 0, size: [1440, 900] })
    await m.reached
    await expect(display(page)).toHaveText(PLACEHOLDER)
    m.release()
    await expect(display(page)).toHaveText('0%')
    await expect(display(page)).not.toHaveAttribute('aria-label', /.+/)
    await expect(score(page)).toHaveText('0/40')
  })

  test('(4) the history request fails: placeholder, no "0%", no page error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    const m = await open(page, { history: 'fail', uptimePct: 97, size: [1440, 900] })
    await m.reached
    await expect.poll(() => m.historyRequests(), { message: 'the failed request is retried', timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    await networkQuiet(page)
    await frames(page, 3)
    await expect(gaugeNum(page)).toHaveText('88')
    await expect(display(page)).toHaveText(PLACEHOLDER)
    await expect(score(page)).toHaveText(`${PLACEHOLDER}/40`)
    await expect(display(page)).not.toHaveText('0%')
    expect(errors, 'no uncaught page error').toEqual([])
  })

  for (const size of [[390, 844], [1440, 900]] as const) {
    test(`(5) ${size[0]}x${size[1]}: layout shift when the value replaces the placeholder is at most ${SHIFT_LIMIT}`, async ({ page }) => {
      const m = await open(page, { history: 'held', uptimePct: 97, size: [...size] })
      await m.reached
      if (size[0] < 1024) await page.locator('.md-sc-reliability').click()
      const row = size[0] >= 1024 ? display(page) : page.getByRole('dialog', { name: 'Reliability Score Breakdown' }).locator('.rb-row-display').first()
      await expect(row).toHaveText(PLACEHOLDER)
      await layoutReady(page)
      const rowBox = () => row.evaluate(el => { const r = el.closest('.rb-row-top')!.getBoundingClientRect(); return [r.y, r.height].map(v => Math.round(v * 10) / 10) })
      const before = size[0] >= 1024 ? await boxes(page) : [await rowBox()]
      await shiftTotal(page)
      await page.evaluate(() => { (window as unknown as { __cls: number }).__cls = 0 })
      m.release()
      await expect(row).toHaveText('97%')
      await networkQuiet(page)
      await layoutReady(page)
      await frames(page, 3)
      expect(await shiftTotal(page), `layout shift when the Uptime value replaces the placeholder at ${size[0]}px`).toBeLessThanOrEqual(SHIFT_LIMIT)
      expect(size[0] >= 1024 ? await boxes(page) : [await rowBox()], 'the line with the Uptime value keeps its top and height').toEqual(before)
    })
  }
})
