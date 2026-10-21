import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { flush } from './fixtures/settle'

// The idle warm-up of the Stats page (its chunk + /api/stats) must not compete with the mint list and the icons: on "/" it
// starts after the first mint card has rendered. The hover/focus/touch warm-up of the Stats tab is unchanged, and a route
// that never asks for the list still gets the idle warm-up. Mocked API; the list is held at the mock until the test lets it go.

const STATS_CHUNK = /\/(src\/pages\/Stats\.tsx|assets\/Stats-[^/]+\.js)(\?|$)/
const STATS_DATA = /\/api\/stats(\?|$)/
const isStatsWarmup = (url: string) => STATS_CHUNK.test(url) || STATS_DATA.test(url)

function trackStatsRequests(page: Page): string[] {
  const seen: string[] = []
  page.on('request', r => { if (isStatsWarmup(r.url())) seen.push(r.url()) })
  return seen
}

/** Resolves after `n` idle callbacks have run in the page: the moments the old app-start warm-up used. */
const idleMoments = (page: Page, n: number) =>
  page.evaluate(async count => {
    for (let i = 0; i < count; i++) await new Promise<void>(done => (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(() => done()))
  }, n)

async function holdKnown(page: Page) {
  let arrived!: () => void
  const requestReachedMock = new Promise<void>(resolve => { arrived = resolve })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/mints/known', async route => {
    arrived()
    await gate
    await route.fulfill({ json: MOCK_KNOWN_MINTS })
  })
  return { requestReachedMock, release }
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.addInitScript(() => {
    const w = window as unknown as { __cardAt: number | null }
    w.__cardAt = null
    const mo = new MutationObserver(() => {
      if (w.__cardAt === null && document.querySelector('.mint-card')) w.__cardAt = performance.now()
    })
    mo.observe(document, { childList: true, subtree: true })
  })
})

test.describe('Stats idle warm-up order', () => {
  test('"/": nothing of Stats is requested while the list is pending; it starts after the first mint card is in the DOM', async ({ page }) => {
    const seen = trackStatsRequests(page)
    const held = await holdKnown(page)
    await page.goto('/')
    await held.requestReachedMock
    // Several idle moments pass with the list pending: the warm-up used to start at the first of them.
    await idleMoments(page, 3)
    await flush(page)
    expect(seen, 'no Stats request while /api/mints/known is pending').toEqual([])

    held.release()
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await expect.poll(() => seen.some(u => STATS_CHUNK.test(u)) && seen.some(u => STATS_DATA.test(u)), { message: 'the warm-up starts after the list' }).toBe(true)

    const times = await page.evaluate(() => {
      const w = window as unknown as { __cardAt: number | null }
      const start = (re: string) => performance.getEntriesByType('resource').filter(e => new RegExp(re).test(e.name)).map(e => e.startTime)
      return { card: w.__cardAt, chunk: start('/(src/pages/Stats\\.tsx|assets/Stats-[^/]+\\.js)'), data: start('/api/stats(\\?|$)') }
    })
    expect(times.card).not.toBeNull()
    expect(times.chunk.length).toBeGreaterThan(0)
    expect(times.data.length).toBeGreaterThan(0)
    expect(Math.min(...times.chunk), 'Stats chunk starts after the first card').toBeGreaterThanOrEqual(times.card as number)
    expect(Math.min(...times.data), '/api/stats starts after the first card').toBeGreaterThanOrEqual(times.card as number)
  })

  test('hovering the Stats tab still warms the Stats page at once, while the list is pending', async ({ page }) => {
    const seen = trackStatsRequests(page)
    const held = await holdKnown(page)
    await page.goto('/')
    await held.requestReachedMock
    await idleMoments(page, 2)
    expect(seen).toEqual([])
    await page.getByRole('link', { name: 'Stats' }).first().hover()
    await expect.poll(() => seen.some(u => STATS_CHUNK.test(u)) && seen.some(u => STATS_DATA.test(u)), { message: 'hover warm-up' }).toBe(true)
    held.release()
  })

  test('a route that never asks for the list still gets the idle warm-up (after the fallback delay)', async ({ page }) => {
    const seen = trackStatsRequests(page)
    await page.goto('/about')
    await expect(page.locator('h1').first()).toBeVisible()
    await idleMoments(page, 3)
    expect(seen, 'not at app start').toEqual([])
    await expect.poll(() => seen.some(u => STATS_CHUNK.test(u)), { message: 'fallback warm-up', timeout: 15_000 }).toBe(true)
  })

  test('/stats itself is not delayed: its data is requested while the list is pending', async ({ page }) => {
    const seen = trackStatsRequests(page)
    const held = await holdKnown(page)
    await page.goto('/stats')
    await held.requestReachedMock
    await expect.poll(() => seen.some(u => STATS_DATA.test(u)), { message: '/api/stats without waiting for the list' }).toBe(true)
    held.release()
  })
})
