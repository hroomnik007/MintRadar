import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { ALPHA_PATH, NO_8333, SWAPS_8333, auditCzResponse, czSwapList } from './fixtures/auditCz'
import { frames, layoutReady, networkQuiet, resize, trackRequests } from './fixtures/settle'

// /tools and Mint Detail must not move while they load. The lazy route fallback (App.tsx) and the pending state of Mint
// Detail (its root, `.mint-detail`, in every state) are as tall as the viewport, so the footer is already below the fold when the page
// arrives; before Task X it jumped out of view (0.104 on /tools at 390 px, 0.14 on Mint Detail). Rule and numbers:
// docs/claude/stats-dashboard-watchlist-ui.md ("Layout shift rule") and card-and-mint-detail-ui.md.
// Task Y M: the root of Mint Detail is at least as tall as the viewport in EVERY state (`.mint-detail { min-height: 100dvh }`), so
// the footer stays below the first screen while the data arrives (each response held in turn) and in the short "Not a tracked
// mint" state. A local reproduction of the live 0.19 (minibits, History, 390 px) did not find a state with the footer in view
// (34 delay profiles on a production build, shifts at most 0.06); the one short state that exists is "Not a tracked mint".
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

// ── Task Y M: the footer stays below the first screen in every state ──────────────────────────────────────────────────────
const footerBelowFold = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.querySelector('footer.app-footer')!.getBoundingClientRect().top >= window.innerHeight)

/** Holds every request matching `pattern` until release(); release() waits until a request has reached the mock. */
function gate(page: Page, pattern: string, answer: (route: import('@playwright/test').Route) => Promise<void>) {
  let waiting = 0
  let open: () => void = () => {}
  const opened = new Promise<void>(r => { open = r })
  const ready = page.route(pattern, async route => { waiting++; await opened; await answer(route) })
  return {
    ready,
    release: async () => { await expect.poll(() => waiting, { message: `a request for ${pattern} reached the mock` }).toBeGreaterThan(0); open() },
  }
}

for (const width of [390, 1440]) {
  test(`Mint Detail at ${width}px: the footer is below the first screen while each response is held in turn, shift below ${MINT_LIMIT}`, async ({ page }) => {
    await prepare(page, width)
    const known = gate(page, '**/api/mints/known', r => r.fallback())
    const probe = gate(page, '**/api/mint/probe**', r => r.fallback())
    const history = gate(page, '**/api/mints/history**', r => r.fallback())
    const reviews = gate(page, '**/api/mints/nostr-reviews**', r => r.fallback())
    await Promise.all([known.ready, probe.ready, history.ready, reviews.ready])
    await page.goto(`/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`)

    // 1. everything pending: the viewport-high page
    await expect(page.locator('.mint-detail')).toBeVisible()
    expect(await footerBelowFold(page), 'pending').toBe(true)
    // 2. the tracked-mint list arrived, the probe, history and reviews did not
    await known.release()
    await expect(page.locator('.md-tabs')).toBeVisible()
    expect(await footerBelowFold(page), 'known only').toBe(true)
    // 3. the probe arrived
    await probe.release()
    await expect(page.locator('.md-panel-title', { hasText: 'About' })).toBeVisible()
    expect(await footerBelowFold(page), 'known + probe').toBe(true)
    // 4. the rest, on the History tab (the chart arrives from its lazy chunk)
    await page.locator('.md-tab', { hasText: /^History/ }).click()
    await history.release()
    await reviews.release()
    await networkQuiet(page)
    await layoutReady(page)
    await frames(page, 3)
    expect(await footerBelowFold(page), 'loaded').toBe(true)
    expect(await shiftTotal(page), `layout shift of the delayed Mint Detail load at ${width}px`).toBeLessThan(MINT_LIMIT)
  })

  test(`Mint Detail at ${width}px: the short "Not a tracked mint" state keeps the footer below the first screen`, async ({ page }) => {
    await prepare(page, width)
    await page.goto(`/mint/${encodeURIComponent('https://nobody.mint.example')}`)
    await expect(page.getByRole('heading', { name: 'Not a tracked mint' })).toBeVisible()
    await layoutReady(page)
    expect(await footerBelowFold(page), 'Not a tracked mint').toBe(true)
    expect(await shiftTotal(page)).toBeLessThan(MINT_LIMIT)
  })
}

// ── Task Z3: a #audit deep link does not move the right column when the audit data arrives ───────────────────────────────
// On a phone the right column (Units and methods) is stacked BELOW the tab. While "Loading audit data…" was a one-line text
// it sat at y 706 of 844, and the audit card (631 to 855 px) pushed it out of the first screen: 0.137 on the live page at
// 390 px (minibits, CDP run with delayed answers), 0.059 on this fixture. `.md-audit-loading { min-height: 480px }` (stacked
// layout only) keeps it under the fold. Docs: card-and-mint-detail-ui.md ("Audit deep link, Task Z3").
const AUDIT_LIMIT = 0.05

test('Mint Detail #audit deep link at 390px: the right column stays below the first screen while the audit data is held, shift below 0.05', async ({ page }) => {
  await prepare(page, 390)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, ...NO_8333 } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.route('**/api/mints/swaps**', route => route.fulfill({ json: SWAPS_8333 }))
  const audit = gate(page, '**/api/mints/audit-cz**', route => route.fulfill({
    json: auditCzResponse({ swaps: czSwapList(Array.from({ length: 12 }, () => ({ kind: 'dest' }))) }),
  }))
  await audit.ready
  await page.goto(`${ALPHA_PATH}#audit`)

  await expect(page.getByRole('status').filter({ hasText: 'Loading audit data…' })).toBeVisible()
  const rightTop = (): Promise<number> => page.evaluate(() => document.querySelector('.md-right')!.getBoundingClientRect().top)
  const viewport = page.viewportSize()!.height
  expect(await rightTop(), 'right column while loading').toBeGreaterThanOrEqual(viewport)

  await audit.release()
  await expect(page.locator('.audit-cz-tiles')).toBeVisible()
  await networkQuiet(page)
  await layoutReady(page)
  await frames(page, 3)
  expect(await rightTop(), 'right column once loaded').toBeGreaterThanOrEqual(viewport)
  expect(await shiftTotal(page), 'layout shift of the #audit deep link at 390px').toBeLessThan(AUDIT_LIMIT)
})
