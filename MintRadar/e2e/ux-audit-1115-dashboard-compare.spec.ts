import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'

// UI/UX audit fixes, Dashboard and Compare (2026-11-15): unrated / unreviewed / unmeasured mints last in both sort directions,
// two-line mint names, Compare latency measured from the browser (BEST on that row, offline mints not contacted), and a grey
// score badge for a mint that is not online.

const base = MOCK_KNOWN_MINTS[0]!
const mk = (name: string, over: Record<string, unknown>) => ({
  ...base, url: `https://${name.toLowerCase()}.sort.example`, name: `${name} Mint`, online: true, degraded: false, reliabilityScore: 80,
  reviewCount: 0, reviewAvgRating: null, reviewRatedCount: null, reviewWeightedRating: null, latencyMs: null, ...over,
})
const ROWS = [
  mk('Unrated', {}),
  mk('High', { reviewCount: 40, reviewAvgRating: 4.8, reviewRatedCount: 40, latencyMs: 300 }),
  mk('Low', { reviewCount: 30, reviewAvgRating: 3.1, reviewRatedCount: 30, latencyMs: 90 }),
]

async function openDash(page: Page, query: string, view: 'grid' | 'list' = 'grid') {
  if (view === 'list') await page.addInitScript(() => { localStorage.setItem('mintRadar_viewMode', 'list') })
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: ROWS }))
  await page.goto(`/?status=all${query}`)
}

for (const view of ['grid', 'list'] as const) {
  const names = (page: Page) => page.locator(view === 'grid' ? '.mint-grid .card-name' : '.mint-list-name')
  for (const [sort, desc, asc] of [
    ['rating', ['High Mint', 'Low Mint', 'Unrated Mint'], ['Low Mint', 'High Mint', 'Unrated Mint']],
    ['reviewCount', ['High Mint', 'Low Mint', 'Unrated Mint'], ['Low Mint', 'High Mint', 'Unrated Mint']],
    ['latency', ['High Mint', 'Low Mint', 'Unrated Mint'], ['Low Mint', 'High Mint', 'Unrated Mint']],
  ] as const) {
    test(`${view}: sort=${sort} keeps the mint without a value last in both directions`, async ({ page }) => {
      // Latency's default direction is ascending; rating and reviews descending.
      const [first, second] = sort === 'latency' ? [asc, desc] : [desc, asc]
      const flip = sort === 'latency' ? 'desc' : 'asc'
      await openDash(page, `&sort=${sort}`, view)
      await expect(names(page)).toHaveText([...first])
      await page.goto(`/?status=all&sort=${sort}&dir=${flip}`)
      await expect(names(page)).toHaveText([...second])
    })
  }
}

test('390px: a long mint name gets two lines on the card instead of one cut line', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: [mk('Kinda Reckless Cashu Community', { reviewCount: 1, reviewAvgRating: 5 })] }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?status=all')
  const name = page.locator('.card-name').first()
  await expect(name).toBeVisible()
  const m = await name.evaluate(el => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight), sw: el.scrollHeight, ch: el.clientHeight }))
  expect(Math.round(m.h / m.lh)).toBe(2)
  expect(m.sw).toBeLessThanOrEqual(m.ch + 1)
})

test.describe('Compare: latency from the browser', () => {
  async function openCompare(page: Page) {
    await mockRelays(page)
    await installApiMocks(page)
    await page.addInitScript(() => {
      const w = window as unknown as { __hits: string[] }
      w.__hits = []
      const real = window.fetch.bind(window)
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const m = /^https:\/\/([a-z]+)\.mint\.example\/v1\/info$/.exec(url)
        if (!m) return real(input, init)
        w.__hits.push(m[1]!)
        const delay = m[1] === 'alpha' ? 200 : 40
        return new Promise<Response>(resolve => setTimeout(() => resolve(new Response('{}', { status: 200 })), delay))
      }
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    // A ?compare= link with the offline mint first (the picker itself offers online mints only).
    const list = ['charlie', 'alpha', 'delta'].map(n => `https://${n}.mint.example`).join(',')
    await page.goto(`/?status=all&compare=${encodeURIComponent(list)}`)
    await expect(page.getByText('Mint Comparison')).toBeVisible()
  }
  const row = (page: Page, id: string) => page.locator(`.cmp-grid .cmp-val[data-row="${id}"]`)

  test('the row measures online mints only, tags the fastest from the browser, and measures again on request', async ({ page }) => {
    await openCompare(page)
    await expect(page.locator('.cmp-lbl', { hasText: 'Latency (your browser)' })).toBeVisible()
    await expect(row(page, 'browser-latency').filter({ hasText: 'measuring' })).toHaveCount(0)
    // Charlie (first column) is offline: not contacted, shown as "—".
    const texts = await row(page, 'browser-latency').allInnerTexts()
    expect(texts[0]!.trim()).toBe('—')
    const hits = await page.evaluate(() => (window as unknown as { __hits: string[] }).__hits.slice().sort())
    expect(hits).toEqual(['alpha', 'delta'])
    // A missing value (the offline mint) means no tag, as on every other row.
    await expect(row(page, 'browser-latency').locator('.cmp-best')).toHaveCount(0)
    // The server's last-check row never carries the tag.
    await expect(row(page, 'latency').locator('.cmp-best')).toHaveCount(0)
    await page.getByTestId('cmp-remeasure').click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __hits: string[] }).__hits.length)).toBe(4)
  })
})

test('Compare of two online mints: BEST latency goes to the faster mint from the browser, not the server', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.addInitScript(() => {
    const real = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const m = /^https:\/\/([a-z]+)\.mint\.example\/v1\/info$/.exec(url)
      if (!m) return real(input, init)
      const delay = m[1] === 'alpha' ? 300 : 30
      return new Promise<Response>(resolve => setTimeout(() => resolve(new Response('{}', { status: 200 })), delay))
    }
  })
  await page.goto('/?status=all')
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
  await page.locator('.md-picker-confirm').click()
  const cells = page.locator('.cmp-grid .cmp-val[data-row="browser-latency"]')
  await expect(cells.nth(1).locator('.cmp-best')).toHaveCount(1)
  await expect(cells.nth(0).locator('.cmp-best')).toHaveCount(0)
})

test('Mint Detail: a mint that is not online shows its last score badge in grey, not the band colour', async ({ page }) => {
  const ALPHA = MOCK_MINTS[0]!.url
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map(m => (m.url === ALPHA ? { ...m, online: false, offlineSince: new Date(Date.now() - 8 * 86_400_000).toISOString(), latencyMs: null } : m))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.route('**/api/mint/probe**', r => r.fulfill({ json: { url: ALPHA, online: false, latencyMs: null, info: null, keysets: null, checkedAt: new Date().toISOString(), error: 'Mint unreachable' } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  // Since the 2026-11-19 redesign: the strip's score number (the phone donut tile and its badge are gone).
  const badge = page.getByTestId('md-summary-score').locator('.md-sc-value')
  await expect(badge).toBeVisible()
  await expect(page.getByTestId('md-summary-score').locator('.sr-only')).toHaveText(' (last measured score)')
  const c = await badge.evaluate(el => {
    const p = document.createElement('span'); p.style.color = 'var(--text3)'; document.body.append(p)
    const t3 = getComputedStyle(p).color; p.remove(); return { color: getComputedStyle(el).color, t3 }
  })
  expect(c.color).toBe(c.t3)
})
