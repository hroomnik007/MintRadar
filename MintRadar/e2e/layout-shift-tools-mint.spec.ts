import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { frames, layoutReady, networkQuiet, resize, trackRequests } from './fixtures/settle'

// /tools and Mint Detail must not move while they load. The lazy route fallback (App.tsx) and the pending state of Mint
// Detail (`.mint-detail-pending`) are as tall as the viewport, so the footer is already below the fold when the page
// arrives; before Task X it jumped out of view (0.104 on /tools at 390 px, 0.14 on Mint Detail). Rule and numbers:
// docs/claude/stats-dashboard-watchlist-ui.md ("Layout shift rule") and card-and-mint-detail-ui.md.
// What stays and is NOT limited tighter: the About and Get in touch panels of Mint Detail arrive with the live /v1/info
// data of the mint and their size is the mint's (about 0.06 at the fixture), hence the 0.1 budget of the task.

const TOOLS_LIMIT = 0.05
const TOOLS_LIMIT_DESKTOP = 0.02
const MINT_LIMIT = 0.1
const TAB_LIMIT = 0.02

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

async function prepare(page: Page, width: number): Promise<void> {
  trackRequests(page)
  await observeShift(page)
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  await resize(page, width, width >= 1024 ? 900 : 844)
}

for (const [width, limit] of [[390, TOOLS_LIMIT], [1440, TOOLS_LIMIT_DESKTOP]] as const) {
  test(`/tools at ${width}px: layout shift below ${limit}`, async ({ page }) => {
    await prepare(page, width)
    await page.goto('/tools')
    await expect(page.locator('.tool-title').first()).toBeVisible()
    await networkQuiet(page)
    await layoutReady(page)
    await frames(page, 3)
    expect(await shiftTotal(page), `layout shift of /tools at ${width}px`).toBeLessThan(limit)
  })
}

for (const width of [390, 1440]) {
  test(`Mint Detail at ${width}px: layout shift of the load below ${MINT_LIMIT}, tab changes below ${TAB_LIMIT}`, async ({ page }) => {
    await prepare(page, width)
    await page.goto(`/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.locator('.md-panel-title', { hasText: 'About' })).toBeVisible()
    await networkQuiet(page)
    await layoutReady(page)
    await frames(page, 3)
    expect(await shiftTotal(page), `layout shift of the Mint Detail load at ${width}px`).toBeLessThan(MINT_LIMIT)
    for (const tab of ['History', 'NUTs']) {
      const before = await shiftTotal(page)
      await page.locator('.md-tab', { hasText: new RegExp(`^${tab}`) }).click()
      await expect(page.locator('.md-tab.active')).toHaveText(new RegExp(`^${tab}`))
      await networkQuiet(page)
      await layoutReady(page)
      await frames(page, 3)
      expect((await shiftTotal(page)) - before, `layout shift of the ${tab} tab at ${width}px`).toBeLessThan(TAB_LIMIT)
    }
  })
}
