import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Compare modal: per metric row the better value is accent-coloured with a small "BEST" pill (utils/compareBest.ts).
// Rows with a direction only (Reliability Score, Uptime 24h / 30 days higher, Latency lower); no tag on equal values,
// on a tie at the top, or while any value is missing / pending. No overall winner.
// Latency (2026-11-15): the tag is on the "Latency (your browser)" row, measured from the browser when Compare opens;
// the server's "Latency (last check)" row never gets one. The dev CSP blocks real mint fetches, so /v1/info is answered
// in the page after a per-mint delay (null = HTTP 500, "no answer").

const ALPHA = 'https://alpha.mint.example', BRAVO = 'https://bravo.mint.example', DELTA = 'https://delta.mint.example'
const UPTIME_30D: Record<string, number> = { [ALPHA]: 99.5, [BRAVO]: 99.5, [DELTA]: 97 }
// The exact share too: Compare shows it cut down to one decimal (review 2026-11-27), the rounded one is only its fallback.
const KNOWN = MOCK_KNOWN_MINTS.map(m => ({ ...m, uptimePct30d: UPTIME_30D[m.url] ?? null, uptimePct30dExact: UPTIME_30D[m.url] ?? null }))
const ROWS = ['reliability', 'uptime', 'uptime-30d', 'browser-latency'] as const
// Browser latency delays (ms): Alpha fastest, then Delta, then Bravo; DELTA_DOWN: Delta does not answer.
const BROWSER_MS: Record<string, number | null> = { alpha: 30, bravo: 400, delta: 160 }
const DELTA_DOWN: Record<string, number | null> = { ...BROWSER_MS, delta: null }
// Delta online but without a stored score, a latency or a 30-day figure (not available: no tag in those rows).
const KNOWN_MISSING = KNOWN.map(m => (m.url === DELTA ? { ...m, reliabilityScore: null, latencyMs: null, uptimePct30d: null, uptimePct30dExact: null } : m))

interface Opts { uptime24h: Record<string, number>; hold?: Promise<void>; known?: typeof KNOWN; browser?: Record<string, number | null> }
async function openCompare(page: Page, size: [number, number], others: string[], o: Opts) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: o.known ?? KNOWN }))
  await page.addInitScript((d: Record<string, number | null>) => {
    const real = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const m = /^https:\/\/([a-z]+)\.mint\.example\/v1\/info$/.exec(url)
      if (!m) return real(input, init)
      const delay = d[m[1]!] ?? null
      if (delay === null) return Promise.resolve(new Response('{}', { status: 500 }))
      return new Promise<Response>(resolve => setTimeout(() => resolve(new Response('{}', { status: 200 })), delay))
    }
  }, o.browser ?? BROWSER_MS)
  await page.route('**/api/mints/history**', async route => {
    const u = new URL(route.request().url())
    const url = u.searchParams.get('url')!
    if (u.searchParams.get('period') === '24h' && o.hold) await o.hold
    route.fulfill({ json: { period: '24h', segments: [], uptimePct: o.uptime24h[url] ?? null, avgLatencyMs: null, prevUptimePct: null, prevAvgLatencyMs: null, earliestCheckedAt: null, daysOfDataAvailable: 1, periodDays: 1, prevPeriodInsufficientHistory: false } })
  })
  await page.setViewportSize({ width: size[0], height: size[1] })
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  for (const name of others) await page.locator('.md-picker-item', { hasText: name }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
}

const phoneOf = (size: [number, number]) => size[0] <= 768
const names = async (page: Page, phone: boolean) => (phone
  ? await page.locator('table.cmp-m-table thead th.cmp-m-mint .cmp-m-mint-name').allInnerTexts()
  : await page.locator('.cmp-grid .cmp-val.cmp-row-mint > div > div:first-child').allInnerTexts()).map(t => t.trim())
const cells = (page: Page, phone: boolean, id: string) => phone
  ? page.locator(`table.cmp-m-table tbody tr[data-row="${id}"] td`)
  : page.locator(`.cmp-grid .cmp-val[data-row="${id}"]`)
/** Name of the mint whose cell in row `id` has the tag, or null; fails when more than one cell has it. */
async function bestOf(page: Page, phone: boolean, id: string): Promise<string | null> {
  const flags = await cells(page, phone, id).evaluateAll(els => els.map(e => e.querySelectorAll('.cmp-best').length))
  expect(flags.every(n => n <= 1), `${id}: at most one tag per cell`).toBe(true)
  expect(flags.filter(n => n === 1).length, `${id}: at most one tag per row`).toBeLessThanOrEqual(1)
  const i = flags.indexOf(1)
  return i === -1 ? null : (await names(page, phone))[i]!
}

for (const size of [[1440, 900], [390, 844]] as [number, number][]) {
  const phone = phoneOf(size)

  test(`${size[0]}px: higher score and lower latency win; equal 24h uptime and a tie at the top of 30 days get no tag`, async ({ page }) => {
    // Alpha 92 / 50ms, Bravo 55 / 300ms, Delta 78 / 120ms; 24h: 100 / 100 / 98; 30 days: 99.5 / 99.5 / 97.
    await openCompare(page, size, ['Bravo Mint', 'Delta Mint'], { uptime24h: { [ALPHA]: 100, [BRAVO]: 100, [DELTA]: 98 } })
    await expect(cells(page, phone, 'uptime').first()).toContainText('100%')
    await expect(cells(page, phone, 'browser-latency').filter({ hasText: 'measuring' })).toHaveCount(0)
    expect(await bestOf(page, phone, 'reliability')).toBe('Alpha Mint')
    expect(await bestOf(page, phone, 'browser-latency')).toBe('Alpha Mint')
    expect(await bestOf(page, phone, 'uptime')).toBeNull()
    expect(await bestOf(page, phone, 'uptime-30d')).toBeNull()
    // No tag on rows without a direction.
    expect(await page.locator('.cmp-best').count()).toBe(2)
    // The pill: "BEST" in the accent colour on the soft green fill; the value beside it is accent too.
    const tag = cells(page, phone, 'browser-latency').filter({ has: page.locator('.cmp-best') }).locator('.cmp-best')
    await expect(tag).toHaveText(/best/i)
    const s = await tag.evaluate(el => {
      const c = getComputedStyle(el), probe = document.createElement('span')
      probe.style.color = 'var(--accent)'; probe.style.background = 'var(--green-soft)'
      el.parentElement!.appendChild(probe)
      const p = getComputedStyle(probe)
      const out = { color: c.color, bg: c.backgroundColor, upper: c.textTransform, size: parseFloat(c.fontSize), accent: p.color, soft: p.backgroundColor, value: getComputedStyle(el.parentElement!).color }
      probe.remove()
      return out
    })
    expect(s.color).toBe(s.accent)
    expect(s.bg).toBe(s.soft)
    expect(s.upper).toBe('uppercase')
    expect(s.value).toBe(s.accent)
    if (phone) expect(s.size).toBeGreaterThanOrEqual(12)
    // A losing value keeps its own colour (not accent).
    // The server's last-check row has no tag at all.
    expect(await bestOf(page, phone, 'latency')).toBeNull()
    const loser = cells(page, phone, 'latency').filter({ hasText: '300ms' })
    const lose = await (phone ? loser.locator('span').first() : loser).evaluate(el => getComputedStyle(el).color)
    expect(lose).not.toBe(s.accent)
  })

  test(`${size[0]}px: two mints, a clear 24h and 30-day winner; no tag while the 24h uptime is still loading`, async ({ page }) => {
    let release!: () => void
    const hold = new Promise<void>(r => { release = r })
    await openCompare(page, size, ['Delta Mint'], { uptime24h: { [ALPHA]: 98, [DELTA]: 99.9 }, hold })
    await expect(cells(page, phone, 'uptime-30d').first()).toContainText('99.5%')
    expect(await bestOf(page, phone, 'uptime')).toBeNull()
    expect(await bestOf(page, phone, 'uptime-30d')).toBe('Alpha Mint')
    release()
    await expect(cells(page, phone, 'uptime').filter({ hasText: '99.9%' })).toHaveCount(1)
    await expect.poll(() => bestOf(page, phone, 'uptime')).toBe('Delta Mint')
    expect(await bestOf(page, phone, 'reliability')).toBe('Alpha Mint')
    await expect.poll(() => bestOf(page, phone, 'browser-latency')).toBe('Alpha Mint')
  })

  test(`${size[0]}px: a missing value (score, latency, 30 days shown as —) means no tag in those rows`, async ({ page }) => {
    await openCompare(page, size, ['Delta Mint'], { uptime24h: { [ALPHA]: 99, [DELTA]: 12 }, known: KNOWN_MISSING, browser: DELTA_DOWN })
    await expect(cells(page, phone, 'uptime').filter({ hasText: '12%' })).toHaveCount(1)
    await expect(cells(page, phone, 'browser-latency').filter({ hasText: 'no answer' })).toHaveCount(1)
    expect(await bestOf(page, phone, 'reliability')).toBeNull()
    expect(await bestOf(page, phone, 'browser-latency')).toBeNull()
    expect(await bestOf(page, phone, 'uptime-30d')).toBeNull()
    expect(await bestOf(page, phone, 'uptime')).toBe('Alpha Mint')
  })
}

for (const width of [390, 320]) {
  test(`${width}px: the tags do not widen the page or leave their cell`, async ({ page }) => {
    await openCompare(page, [width, 844], ['Bravo Mint', 'Delta Mint'], { uptime24h: { [ALPHA]: 100, [BRAVO]: 97, [DELTA]: 98 } })
    // Reliability, browser latency, 24h uptime: Alpha; 30 days: Alpha and Bravo tie at the top (no tag).
    await expect(page.locator('.cmp-best')).toHaveCount(3)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const out = await page.locator('.cmp-best').evaluateAll(els => els.filter(e => {
      const r = e.getBoundingClientRect(), td = e.closest('td')!.getBoundingClientRect()
      return r.left < td.left - 0.5 || r.right > td.right + 0.5
    }).length)
    expect(out).toBe(0)
  })
}

test('1440px: three mints with one missing value: every row with a tag has exactly one, and no overall winner is marked', async ({ page }) => {
  await openCompare(page, [1440, 900], ['Bravo Mint', 'Delta Mint'], { uptime24h: { [ALPHA]: 99, [BRAVO]: 80, [DELTA]: 95 }, known: KNOWN_MISSING, browser: DELTA_DOWN })
  await expect(cells(page, false, 'uptime').filter({ hasText: '80%' })).toHaveCount(1)
  await expect(cells(page, false, 'browser-latency').filter({ hasText: 'no answer' })).toHaveCount(1)
  for (const id of ROWS) await bestOf(page, false, id)
  expect(await bestOf(page, false, 'uptime')).toBe('Alpha Mint')
  // Delta has no score or 30-day figure and does not answer the browser: those rows have no tag.
  expect(await bestOf(page, false, 'reliability')).toBeNull()
  expect(await bestOf(page, false, 'browser-latency')).toBeNull()
  expect(await bestOf(page, false, 'uptime-30d')).toBeNull()
  // Nothing on the mint header row.
  expect(await page.locator('.cmp-row-mint .cmp-best').count()).toBe(0)
})
