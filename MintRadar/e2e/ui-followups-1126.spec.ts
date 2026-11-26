import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'
import { auditCzResponse, gotoAuditTab, NO_8333 } from './fixtures/auditCz'

// Owner follow-ups of 2026-11-26:
// 1. The list view shows what the card shows: the last 24 hours (24 hourly bars) and "Uptime 24 h".
// 2. Mint Detail: a "Last 30 days" bar with an outage opens the History tab with that outage marked.
// 3. Audit "Swaps per day": hovering (mouse) or tapping (touch) a column shows its figures and dims the others.

const ALPHA = MOCK_MINTS[0]!.url
const DAY = 86_400_000

test('list view: Last 24 h bars (24 of them) and Uptime 24 h, as on the card', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => m.url === ALPHA ? { ...m, uptimePct24hExact: 98.7, uptimePct30dExact: 91.2 } : m) }))
  await page.addInitScript(() => localStorage.setItem('mintRadar_viewMode', 'list'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const row = page.locator('.mint-list-row', { hasText: 'Alpha Mint' })
  await expect(row.locator('.mint-list-bars [data-testid="uptime-bars"] i')).toHaveCount(24)
  await expect(row.locator('.mint-list-bars [data-testid="uptime-bars"]')).toHaveAttribute('data-unit', 'hour')
  await expect(row.getByTestId('list-uptime-24h')).toHaveText('98.7%')
})

async function openDetail(page: Page, width: number, touch = false) {
  await mockRelays(page)
  await installApiMocks(page)
  const today = Math.floor(Date.now() / DAY) * DAY
  const days: Array<number | null> = Array.from({ length: 30 }, () => 100)
  days[27] = 97.9 // two days before today: one outage of 30 min
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: {
    sinceLastOutageMs: 2 * DAY, avgRecoveryMs: 30 * 60_000, outageCount: 2,
    outages: [
      { startedAt: new Date(today - 2 * DAY + 3_600_000).toISOString(), durationMs: 30 * 60_000 },
      { startedAt: new Date(today - 20 * DAY + 3_600_000).toISOString(), durationMs: 10 * 60_000 },
    ],
  } }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => m.url === ALPHA ? { ...m, uptimeDaily30: days } : m) }))
  if (!touch) await resize(page, width, 900)
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-trace [data-testid="uptime-bars"]')).toBeVisible()
  await layoutReady(page)
}

async function barPoint(page: Page, i: number) {
  const box = (await page.locator('.md-trace [data-testid="uptime-bars"]').boundingBox())!
  return { x: box.x + ((i + 0.5) / 30) * box.width, y: box.y + box.height - 4 }
}

test('1440px: clicking an outage day opens History with that outage marked; a fine day does nothing', async ({ page }) => {
  await openDetail(page, 1440)
  const fine = await barPoint(page, 10)
  await page.mouse.click(fine.x, fine.y)
  await expect(page.locator('.md-tab.active')).toHaveText('Overview')

  const p = await barPoint(page, 27)
  await page.mouse.move(p.x, p.y)
  await expect(page.getByTestId('uptime-day-readout')).toContainText('Click to see it in History')
  await page.mouse.click(p.x, p.y)
  await expect(page.locator('.md-tab.active')).toHaveText('History')
  const marked = page.locator('.md-ev[data-focus="true"]')
  await expect(marked).toHaveCount(1)
  await expect(marked).toContainText('Not answering for 30 min')
  await expect(marked).toBeInViewport()
  // The mark fades after a few seconds (HISTORY_FOCUS_MS, 4 s), it does not stay on.
  await expect(marked).toHaveCount(0, { timeout: 8000 })
  // Picking the day again marks it again; leaving History clears the mark at once.
  await page.locator('.md-trace').scrollIntoViewIfNeeded()
  const again = await barPoint(page, 27)
  await page.mouse.click(again.x, again.y)
  await expect(marked).toHaveCount(1)
  await page.locator('.md-tab', { hasText: 'Overview' }).click()
  await page.locator('.md-tab', { hasText: 'History' }).click()
  await expect(marked).toHaveCount(0)
})

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('390px: the first tap shows the readout with a hint, a second tap opens History', async ({ page }) => {
    await openDetail(page, 390, true)
    const p = await barPoint(page, 27)
    await page.touchscreen.tap(p.x, p.y)
    await expect(page.getByTestId('uptime-day-readout')).toContainText('Tap again to see it in History')
    await expect(page.locator('.md-tab.active')).toHaveText('Overview')
    await page.touchscreen.tap(p.x, p.y)
    await expect(page.locator('.md-tab.active')).toHaveText('History')
    await expect(page.locator('.md-ev[data-focus="true"]')).toContainText('Not answering for 30 min')
  })
})

const dayIso = (back: number) => new Date(Date.now() - back * DAY).toISOString().slice(0, 10)
const daily7d = [6, 5, 4, 3, 2, 1, 0].map(b => ({ day: dayIso(b), ok: b === 0 ? 3 : 2, failed: b === 0 ? 1 : 0, other: 0 }))

test('Swaps per day, mouse: hovering a column shows its figures and dims the others', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoAuditTab(page, { alpha: NO_8333, cz: auditCzResponse({ swaps: [], daily7d }) })
  const days = page.getByTestId('audit-days')
  const tip = page.getByTestId('audit-day-readout')
  await expect(tip).toHaveCount(0)
  await days.locator('.au-day').last().locator('.au-day-col').hover()
  await expect(tip).toContainText('3 succeeded')
  await expect(tip).toContainText('1 failed')
  await expect(days.locator('.au-days')).toHaveAttribute('data-active', 'true')
  const panel = (await page.locator('.md-audit-days').boundingBox())!
  const b = (await tip.boundingBox())!
  expect(b.x + b.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5)
  await page.mouse.move(5, 5)
  await expect(tip).toHaveCount(0)
})

test.describe('Swaps per day, touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('a tap shows the figures, a tap elsewhere hides them', async ({ page }) => {
    await gotoAuditTab(page, { alpha: NO_8333, cz: auditCzResponse({ swaps: [], daily7d }) })
    const col = page.getByTestId('audit-days').locator('.au-day').nth(2)
    await col.scrollIntoViewIfNeeded()
    await col.locator('.au-day-label').tap()
    const tip = page.getByTestId('audit-day-readout')
    await expect(tip).toContainText('2 succeeded')
    await expect(tip).toContainText('0 failed')
    await page.locator('.au-days-title').tap()
    await expect(tip).toHaveCount(0)
  })
})

// The readout with the History hint is wider than the 3-bar edge rule assumed and stuck out of the panel (owner,
// 2026-11-26): it is clamped to the bars' box by measurement, and on narrow screens the hint wraps onto a second line.
for (const width of [1728, 1440, 900, 478, 390, 320]) {
  test(`${width}px: the readout of every bar, hint included, stays inside the panel`, async ({ page }) => {
    await openDetail(page, width)
    const tip = page.getByTestId('uptime-day-readout')
    const panel = (await page.locator('.md-trace').boundingBox())!
    for (const i of [0, 1, 5, 14, 20, 24, 26, 27, 28, 29]) {
      const p = await barPoint(page, i)
      await page.mouse.move(p.x, p.y)
      await expect(tip).toBeVisible()
      const b = (await tip.boundingBox())!
      expect(b.x, `bar ${i}`).toBeGreaterThanOrEqual(panel.x)
      expect(b.x + b.width, `bar ${i}`).toBeLessThanOrEqual(panel.x + panel.width + 0.5)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
