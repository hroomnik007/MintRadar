import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { mockStatsEndpoints, STATS_ENDPOINTS, type StatsEndpoint, type StatsGate } from './fixtures/statsLayout'
import { frames, layoutReady, networkQuiet, resize, trackRequests } from './fixtures/settle'
import { methodologyChangesInWindow, moversMethodologyNote } from '../src/utils/methodologyMarkers'

// /stats must not move while its data arrives: every endpoint is held in turn (released only after the request
// reached the mock) and the layout shift of the page stays far below the "good" threshold. The reserved heights
// (--stats-reserve-* in Stats.css) must also match the LOADED heights of the fixture in e2e/fixtures/statsLayout.ts.
// Rule, measurements and how to re-measure: docs/claude/stats-dashboard-watchlist-ui.md ("Layout shift rule").
// The spec runs with the real date: the board is taller by `note` px while the movers window holds a methodology change.

const CLS_LIMIT = 0.02 // the task's hard limit is 0.05; this is the target
const TOLERANCE = 12 // a reservation may differ from the loaded height by at most this many px

// Loaded heights of the fixture (px), measured with the scratch script described in the docs. `board` is the board WITHOUT the
// movers note; `note` is the height the note adds for the 7d default view (31.25 px at 11.5px type, 32 px on a phone at 12px,
// 50 px at 320 px where it wraps). `note2` is the same for a 7d window that holds two changes (v4 + v5 until 2026-10-28):
// two lines in the desktop card, at 768 and on phones, one line in the 1024 tablet card.
const LOADED: Record<number, { head: number; board: number; nhi: number; stack: number; note: number; note2: number }> = {
  1440: { head: 88.2, board: 1326.5, nhi: 346.2, stack: 618.1, note: 31.25, note2: 48.5 },
  1024: { head: 88.2, board: 1844.7, nhi: 332.7, stack: 618.1, note: 31.25, note2: 31.25 },
  768: { head: 88.2, board: 1615.5, nhi: 274.8, stack: 538.3, note: 31.25, note2: 48.5 },
  390: { head: 96.4, board: 2837.8, nhi: 181.3, stack: 560.8, note: 32, note2: 50 },
  320: { head: 96.4, board: 2983.3, nhi: 181.3, stack: 618.3, note: 50, note2: 50 },
}
const WIDTHS = Object.keys(LOADED).map(Number)

type Scenario = { name: string; held: StatsEndpoint[]; order: StatsEndpoint[][] }
const SCENARIOS: Scenario[] = [
  ...STATS_ENDPOINTS.map(e => ({ name: `${e} held`, held: [e], order: [[e]] })),
  { name: 'all released at once', held: STATS_ENDPOINTS, order: [STATS_ENDPOINTS] },
  { name: 'known arrives last', held: STATS_ENDPOINTS, order: [['stats', 'movers', 'trend'], ['known']] },
]

// What the page shows once an endpoint's data is in.
const RENDERED: Record<StatsEndpoint, string> = {
  stats: '.stats-board-grid',
  known: '.stats-nhi-panel',
  movers: '.stats-movers-panel .stats-top5-row',
  trend: '.stats-trend-panel .recharts-surface',
}

async function observeShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __obs: PerformanceObserver }
    w.__cls = 0
    w.__obs = new PerformanceObserver(list => {
      for (const e of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) if (!e.hadRecentInput) w.__cls += e.value
    })
    w.__obs.observe({ type: 'layout-shift', buffered: true })
  })
}
const shiftTotal = (page: Page): Promise<number> =>
  page.evaluate(() => { const w = window as unknown as { __cls: number; __obs: PerformanceObserver }; w.__obs.takeRecords(); return w.__cls })

async function openStats(page: Page, width: number, held: StatsEndpoint[]): Promise<StatsGate> {
  trackRequests(page)
  await observeShift(page)
  await mockRelays(page)
  await installApiMocks(page)
  const gate = await mockStatsEndpoints(page, held)
  await resize(page, width, width >= 1024 ? 900 : 844)
  await page.goto('/stats')
  return gate
}

async function loaded(page: Page): Promise<void> {
  await expect(page.locator('.stats-nhi-panel')).toBeVisible()
  await expect(page.locator('.stats-movers-panel .stats-top5-row').first()).toBeVisible()
  await networkQuiet(page)
  await layoutReady(page)
  await frames(page, 3)
}

const px = (value: string): number => parseFloat(value)
const heightOf = async (page: Page, selector: string): Promise<number> => (await page.locator(selector).boundingBox())!.height
const topOf = async (page: Page, selector: string): Promise<number> => (await page.locator(selector).boundingBox())!.y + await page.evaluate(() => scrollY)

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    for (const scenario of SCENARIOS) {
      test(`layout shift stays below ${CLS_LIMIT}: ${scenario.name}`, async ({ page }) => {
        const gate = await openStats(page, width, scenario.held)
        for (const endpoint of scenario.held) await gate.reached(endpoint)
        await frames(page, 3) // the page is painted in its waiting state before anything is released
        for (const group of scenario.order) {
          for (const endpoint of group) gate.release(endpoint)
          for (const endpoint of group) await expect(page.locator(RENDERED[endpoint]).first()).toBeVisible()
          await frames(page, 3)
        }
        await loaded(page)
        const shift = await shiftTotal(page)
        expect(shift, `layout shift of ${scenario.name} at ${width}px`).toBeLessThan(CLS_LIMIT)
      })
    }

    test('the reserved heights match the loaded heights and the loading screen takes the loaded place', async ({ page }) => {
      const expected = LOADED[width]!
      // The same condition as the page's: the default window (7d) holds a methodology change (one, or two right after a
      // change that followed another within a week).
      const changes7 = methodologyChangesInWindow(7)
      const noteHeight = moversMethodologyNote(changes7) === '' ? 0 : changes7.length >= 2 ? expected.note2 : expected.note
      const gate = await openStats(page, width, ['stats'])
      await gate.reached('stats')
      await frames(page, 3)
      // Loading screen: the header and the block that becomes the board.
      const headWaiting = await heightOf(page, '.page-head')
      const boardReserve = px(await page.locator('.stats-loading').evaluate(el => getComputedStyle(el).minHeight))
      const loadingTop = await topOf(page, '.stats-loading')
      const loadingBox = (await page.locator('.stats-loading').boundingBox())!
      gate.release('stats')
      await loaded(page)

      const boardBox = (await page.locator('.stats-board-grid').boundingBox())!
      const nhiReserve = px(await page.locator('.stats-board-grid').evaluate(el => getComputedStyle(el, '::before').minHeight))
      const stackReserve = px(await page.locator('.stats-stack').evaluate(el => getComputedStyle(el).minHeight))

      // The loaded page is what the table says (a drift means: re-measure, see the docs).
      expect(await heightOf(page, '.page-head'), 'loaded page header').toBeCloseTo(expected.head, -0.6)
      expect(await heightOf(page, '.stats-nhi-panel'), 'loaded Network health index').toBeCloseTo(expected.nhi, -0.6)
      expect(await heightOf(page, '.stats-stack'), 'loaded stack').toBeCloseTo(expected.stack, -0.6)
      expect(boardBox.height, 'loaded board').toBeCloseTo(expected.board + noteHeight, -0.6)

      // Each reservation is within TOLERANCE of the loaded height: not missing, not leaving a big empty space.
      for (const [name, reserve, height] of [
        ['header', headWaiting, expected.head],
        ['Network health index', nhiReserve, expected.nhi],
        ['stack', stackReserve, expected.stack],
      ] as const) {
        expect(reserve, `${name} reservation (${reserve}px) against the loaded ${height}px`).toBeLessThanOrEqual(height + TOLERANCE)
        expect(reserve, `${name} reservation (${reserve}px) against the loaded ${height}px`).toBeGreaterThanOrEqual(height - TOLERANCE)
      }
      // The board reservation is the smallest loaded height of its width band (one value per grid layout): never taller
      // than the board, and tall enough to keep the footer below the fold while /api/stats is pending.
      expect(boardReserve, 'board reservation against the loaded board').toBeLessThanOrEqual(expected.board + noteHeight + TOLERANCE)
      expect(boardReserve, 'board reservation keeps the footer below the fold').toBeGreaterThan(page.viewportSize()!.height)

      // The block that waits is where the board will be, as wide and as tall.
      expect(Math.abs(loadingTop - await topOf(page, '.stats-board-grid')), 'top of the waiting block against the board').toBeLessThanOrEqual(2)
      expect(Math.abs(loadingBox.x - boardBox.x), 'left edge').toBeLessThanOrEqual(2)
      expect(Math.abs(loadingBox.width - boardBox.width), 'width').toBeLessThanOrEqual(2)
      expect(loadingBox.height - boardBox.height, 'the waiting block is not taller than the board').toBeLessThanOrEqual(TOLERANCE)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 'no horizontal overflow').toBeLessThanOrEqual(0)
    })

    test('with /api/mints/known pending, the stack and the cards after it already stand where they will', async ({ page }) => {
      const expected = LOADED[width]!
      const gate = await openStats(page, width, ['known'])
      await gate.reached('known')
      await frames(page, 3)
      const during = {
        stack: await heightOf(page, '.stats-stack'),
        stackTop: await topOf(page, '.stats-stack'),
        nutTop: await topOf(page, '.stats-nut-panel'),
      }
      gate.release('known')
      await loaded(page)
      const after = {
        stack: await heightOf(page, '.stats-stack'),
        stackTop: await topOf(page, '.stats-stack'),
        nutTop: await topOf(page, '.stats-nut-panel'),
      }
      expect(during.stack, 'stack height while waiting, against the loaded height').toBeGreaterThanOrEqual(expected.stack - TOLERANCE)
      expect(after.stack - during.stack, 'the stack does not grow when the data arrives').toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(after.stackTop - during.stackTop), 'top of the stack').toBeLessThanOrEqual(2)
      expect(Math.abs(after.nutTop - during.nutTop), 'top of NUT coverage').toBeLessThanOrEqual(2)
    })
  })
}

// The movers note (a methodology change inside the selected window) makes the board taller; the space is reserved from the same
// condition, so it is there at the first paint exactly when the note is shown, and it equals the note's real height (margin
// + lines, within 1 px) at every width, for 1, 2, 3 and 4 changes. These tests pin the date on purpose: with the real date the
// note disappears from the 7d window a week after a change. METHODOLOGY_CHANGES: v2 on 2026-10-08, v3 on 2026-10-09, v4 on 2026-10-21, v5 on 2026-10-27.
const NOTE_CASES = [
  // `note7` = the note of the default 7d view (what the waiting block and the first paint show), `note` = the note of `period`.
  { name: '7d window holds one change', date: '2026-10-22T12:00:00Z', period: '7d', note7: true, note: true },
  { name: '30d window holds three changes', date: '2026-10-22T12:00:00Z', period: '30d', note7: true, note: true },
  { name: '7d window holds two changes', date: '2026-10-27T12:00:00Z', period: '7d', note7: true, note: true },
  { name: '30d window holds four changes, 7d none', date: '2026-11-05T12:00:00Z', period: '30d', note7: false, note: true },
  { name: '30d window holds three changes, 7d none', date: '2026-11-08T12:00:00Z', period: '30d', note7: false, note: true },
  { name: '30d window holds two changes, 7d none', date: '2026-11-15T12:00:00Z', period: '30d', note7: false, note: true },
  { name: '7d window holds no change', date: '2026-11-05T12:00:00Z', period: '7d', note7: false, note: false },
  { name: '30d window holds no change', date: '2026-12-01T12:00:00Z', period: '30d', note7: false, note: false },
] as const

for (const width of [1440, 1024, 768, 390, 320]) {
  test.describe(`movers note reservation at ${width}px`, () => {
    for (const c of NOTE_CASES) {
      test(`${c.name} (${c.period}, ${c.date.slice(0, 10)}): the reservation is the real height of the note`, async ({ page }) => {
        const expected = LOADED[width]!
        trackRequests(page)
        await observeShift(page)
        await page.clock.setFixedTime(new Date(c.date))
        await mockRelays(page)
        await installApiMocks(page)
        const gate = await mockStatsEndpoints(page, ['stats'])
        await resize(page, width, width >= 1024 ? 900 : 844)
        await page.goto('/stats')
        await gate.reached('stats')
        await frames(page, 3)
        const reserveOf = async (selector: string): Promise<number> => px(await page.locator(selector).evaluate(el => getComputedStyle(el).minHeight))
        const noteReserve = async (): Promise<number> => px(await page.locator('.stats-page').evaluate(el => getComputedStyle(el).getPropertyValue('--stats-reserve-note')))
        // The real height of the note: its box plus its top margin.
        const noteActual = async (): Promise<number> => page.locator('.stats-movers-note').evaluate(el => el.getBoundingClientRect().height + parseFloat(getComputedStyle(el).marginTop))
        const baseBoard = px(await page.locator('.stats-page').evaluate(el => getComputedStyle(el).getPropertyValue('--stats-reserve-board')))
        const waiting = await reserveOf('.stats-loading')
        const reserve7 = await noteReserve()
        // The waiting block reserves the base board plus the note, from the first painted frame, only when the note will be shown
        // (the default view is 7d).
        expect(waiting - baseBoard, 'note space in the waiting block').toBeCloseTo(reserve7, 1)
        if (!c.note7) expect(reserve7, 'no note, no reserved space').toBe(0)
        gate.release('stats')
        await loaded(page)
        if (c.note7) {
          expect(Math.abs(reserve7 - await noteActual()), 'reserved against the real height of the 7d note').toBeLessThanOrEqual(1)
          const board = (await page.locator('.stats-board-grid').boundingBox())!.height
          const note7Height = methodologyChangesInWindow(7, Date.parse(c.date)).length >= 2 ? expected.note2 : expected.note
          expect(board, 'loaded board').toBeCloseTo(expected.board + note7Height, -0.6)
          expect(waiting, 'the waiting block is not taller than the board').toBeLessThanOrEqual(board + TOLERANCE)
          if (width === 1440) expect(board - waiting, 'the waiting block is within TOLERANCE of the board').toBeLessThanOrEqual(TOLERANCE)
        }
        if (c.period === '7d') expect(await shiftTotal(page), `layout shift (${c.name})`).toBeLessThan(CLS_LIMIT)
        if (c.period === '30d') {
          const toggle = page.locator('.stats-movers-panel').getByRole('button', { name: '30d', exact: true })
          await toggle.click()
          await expect(toggle).toHaveClass(/active/)
          await expect(page.locator('.stats-movers-panel .stats-top5-row').first()).toBeVisible()
        }
        await networkQuiet(page)
        await layoutReady(page)
        await expect(page.locator('.stats-movers-note'), 'the note is shown exactly when the window holds a change').toHaveCount(c.note ? 1 : 0)
        const reserve = await noteReserve()
        if (c.note) expect(Math.abs(reserve - await noteActual()), `reserved (${reserve}px) against the real height of the ${c.period} note`).toBeLessThanOrEqual(1)
        else expect(reserve, 'no note, no reserved space').toBe(0)
        const baseMovers = width >= 769 ? 280 : 240
        expect(await reserveOf('.stats-movers-panel'), 'movers card reservation').toBeCloseTo(baseMovers + reserve, 1)
      })
    }
  })
}
