import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Every Dashboard view (card grid, list table) uses the shared container edges: the content box of
// .dashboard-controls (search row) and .dash-status (stats strip), i.e. --dash-chrome-max minus --page-pad.
// The list wrapper once kept the app shell's old 1400px width and overshot the page content by ~58px per side.

const base = MOCK_KNOWN_MINTS[0]
const mk = (over: Record<string, unknown>) => ({ ...base, online: true, archived: false, degraded: false, ...over })
const LONG = 'The Extraordinarily Long Named Community Cashu Mint of Satoshi Nakamoto Memorial Foundation and Friends Club'
const FIXTURE = [
  ...MOCK_KNOWN_MINTS,
  mk({ url: 'https://same.host.example', name: 'same.host.example' }),        // name == hostname: no second line
  mk({ url: 'https://noname.host.example', name: null }),                     // no name: hostname only
  mk({ url: 'https://long.mint.example', name: LONG }),
  mk({ url: `https://long-subdomain-label-for-testing-${'a'.repeat(30)}.example.com`, name: 'Longhost' }),
  mk({ url: 'https://off.mint.example', name: 'Offline Mint', online: false, latencyMs: null }),
]

async function open(page: Page, width: number, view: 'cards' | 'list') {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: FIXTURE }))
  await page.addInitScript(v => localStorage.setItem('mintRadar_viewMode', v), view)
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/?testmints=show&status=all')
  await expect(page.locator(view === 'list' ? '.mint-list-row' : '.mint-card').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

/** Left/right edges of the content box (border box minus padding). */
async function edges(page: Page, selector: string) {
  return page.locator(selector).first().evaluate(el => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) }
  })
}

for (const width of [1920, 1536, 1440, 1280, 1100]) {
  for (const [view, target] of [['list', '.mint-list-table-wrap'], ['cards', '.mint-grid']] as const) {
    test(`Dashboard ${view} view lines up with the search row and stats strip at ${width}px`, async ({ page }) => {
      await open(page, width, view)
      const t = await edges(page, target)
      for (const ref of ['.dashboard-controls', '.dash-status']) {
        const e = await edges(page, ref)
        expect(Math.abs(t.left - e.left), `${target} left vs ${ref}`).toBeLessThanOrEqual(1)
        expect(Math.abs(t.right - e.right), `${target} right vs ${ref}`).toBeLessThanOrEqual(1)
      }
      if (view === 'list') {
        // The table itself fills the wrapper and never sticks out of it.
        const table = await edges(page, '.mint-list-table')
        expect(table.left).toBeGreaterThanOrEqual(t.left - 1)
        expect(table.right).toBeLessThanOrEqual(t.right + 1)
      }
    })
  }
}

for (const width of [900, 768, 390]) {
  test(`Dashboard list view does not widen the page at ${width}px; the table fits or scrolls inside its wrapper`, async ({ page }) => {
    await open(page, width, 'list')
    const m = await page.evaluate(() => {
      const w = document.querySelector('.mint-list-table-wrap') as HTMLElement
      const t = document.querySelector('.mint-list-table') as HTMLElement
      return {
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        overflowX: getComputedStyle(w).overflowX, wrapW: w.clientWidth, tableW: t.getBoundingClientRect().width,
        wrapR: w.getBoundingClientRect().right,
      }
    })
    expect(m.sw).toBeLessThanOrEqual(m.cw)
    expect(m.wrapR).toBeLessThanOrEqual(width)
    if (m.tableW > m.wrapW + 1) expect(m.overflowX).toBe('auto') // scrolls inside the wrapper
  })
}

for (const width of [1440, 390]) {
  test(`Dashboard list rows all have the same height at ${width}px (with and without a hostname line)`, async ({ page }) => {
    await open(page, width, 'list')
    const rows = page.locator('.mint-list-row')
    // Fixture holds rows with a second line and rows without one (name == hostname, no name).
    expect(await page.locator('.mint-list-url').count()).toBeGreaterThan(0)
    expect(await page.locator('.mint-list-url').count()).toBeLessThan(await rows.count())
    const heights = await rows.evaluateAll(rs => rs.map(r => r.getBoundingClientRect().height))
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(0.5)
  })
}
