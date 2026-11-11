import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, scrollToStable } from './fixtures/settle'
import { UPTIME_24H_MAX, UPTIME_30D_MAX, LONGEST_OUTAGE_MAX, OUTAGE_COUNT_MAX } from '../src/utils/reliabilityScore'
import { UPTIME_ROW_LABEL, AUDIT_ROW_LABEL, uptimeRowText } from '../src/utils/tooltipTexts'

// The Uptime row of the Reliability Score breakdown on Mint Detail has the structure of the other four rows: heading
// with its ⓘ, value, points, ONE source line, bar. The four uptime parts (24 h, 30 days, longest outage, number of
// outages) with this mint's figures and points are the text of the row's ⓘ, not a second line under the heading.

const ALPHA = MOCK_MINTS[0]!.url
const MIN = 60_000

const parts = (p: [number, number, number, number]) => ({
  last24h: { points: p[0], max: UPTIME_24H_MAX }, last30d: { points: p[1], max: UPTIME_30D_MAX },
  longestOutage: { points: p[2], max: LONGEST_OUTAGE_MAX }, outageCount: { points: p[3], max: OUTAGE_COUNT_MAX },
})
const breakdown = (p: [number, number, number, number], inputs: Record<string, unknown>) => ({
  uptime: { points: p[0] + p[1] + p[2] + p[3], max: 40 }, uptimeParts: parts(p), uptimeInputs: inputs,
  audit: { points: 25, max: 25 }, nuts: { points: 12, max: 15 }, version: { points: 10, max: 15 }, contact: { points: 5, max: 5 },
  newMintCap: { points: 0, cap: 75 }, sum: 92,
})
/** The values of the live page the change was specified with: 100% / 100%, one outage of 10 min, 40/40. */
const FULL = breakdown([20, 10, 6, 4], { uptime24hPct: 100, uptime30dPct: 100, outageCount30d: 1, longestOutage30dMs: 10 * MIN, ongoingOutage: false })
const FULL_TEXT = 'Last 24 h: 100% of probes succeeded (20 of 20 points). Last 30 days: 100% (10 of 10). Longest outage in 30 days: 10 min (6 of 6). Outages in 30 days: 1 (4 of 4).'
const NO_OUTAGE = breakdown([20, 10, 6, 4], { uptime24hPct: 100, uptime30dPct: 100, outageCount30d: 0, longestOutage30dMs: 0, ongoingOutage: false })
const NO_OUTAGE_TEXT = 'Last 24 h: 100% of probes succeeded (20 of 20 points). Last 30 days: 100% (10 of 10). No outage in the last 30 days (6 of 6). Outages in 30 days: 0 (4 of 4).'
/** A record from before methodology 7: no uptimeParts. */
const OLD = { uptime: { points: 40, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: 12, max: 15 }, version: { points: 10, max: 15 }, contact: { points: 5, max: 5 }, newMintCap: { points: 0, cap: 75 }, sum: 92 }

async function open(page: Page, scoreBreakdown: unknown) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => (m.url === ALPHA ? { ...m, scoreBreakdown } : m)) }))
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await layoutReady(page)
}

const rowIn = (scope: Locator, label: string) => scope.locator('.rb-row').filter({ has: scope.page().locator('.rb-row-label', { hasText: label }) })
/** The text lines between the heading line and the bar. */
const linesUnder = (row: Locator) => row.locator(':scope > :not(.rb-row-top):not(.rb-row-bar)')

/** The one open tooltip, once placed (it exists hidden at left/top 0 first). */
async function placedTooltip(page: Page): Promise<Locator> {
  const tip = page.locator('[role="tooltip"]')
  await expect(tip).toHaveCount(1)
  await expect(tip).toHaveCSS('visibility', 'visible')
  return tip
}

test.describe('Uptime row of the Reliability Score breakdown: desktop panel', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('no breakdown line: one source line under the heading, like the Audit row; value, points and bar stay', async ({ page }) => {
    await open(page, FULL)
    const panel = page.locator('.md-reliability-panel')
    const uptime = rowIn(panel, UPTIME_ROW_LABEL)
    const audit = rowIn(panel, AUDIT_ROW_LABEL)
    await expect(uptime).toHaveCount(1)
    await expect(audit).toHaveCount(1)
    await expect(uptime.locator('.rb-row-source')).toHaveText(/^our probes from .+ · 24 h · \d+ checks · last probe .+$/)
    await expect(audit.locator('.rb-row-source')).toHaveCount(1)
    await expect(linesUnder(audit)).toHaveCount(1)
    await expect(linesUnder(uptime)).toHaveCount(1)
    await expect(uptime.locator('.rb-row-detail')).toHaveCount(0)
    await expect(uptime).not.toContainText('longest outage')
    await expect(uptime).not.toContainText('20/20')
    await expect(uptime).not.toContainText('1 outage')
    await expect(uptime.locator('.rb-row-display')).toHaveText(/^\d+% · 30d 100%$/)
    await expect(uptime.locator('.rb-row-score')).toHaveText('40/40')
    await expect(uptime.locator('.rb-row-bar')).toHaveCount(1)
    // every row of the panel: at most the source line plus (audit only, while neutral) one explanation
    await expect(panel.locator('.rb-row')).toHaveCount(5)
    await expect(panel.locator('.rb-row-source')).toHaveCount(5)
    await expect(panel.locator('.rb-row-detail')).toHaveCount(0)
  })

  test('the ⓘ carries the four parts with this mint\'s figures and points; name and description wiring as on the other rows', async ({ page }) => {
    await open(page, FULL)
    const panel = page.locator('.md-reliability-panel')
    const trigger = rowIn(panel, UPTIME_ROW_LABEL).locator('.rb-row-label [data-tooltip-trigger]')
    await expect(trigger).toHaveCount(1)
    await expect(trigger).toHaveAccessibleName(`More information about ${UPTIME_ROW_LABEL}`)
    await expect(rowIn(panel, AUDIT_ROW_LABEL).locator('.rb-row-label [data-tooltip-trigger]')).toHaveAccessibleName(`More information about ${AUDIT_ROW_LABEL}`)
    await expect(trigger).not.toHaveAttribute('aria-describedby')
    await trigger.hover()
    const tip = await placedTooltip(page)
    await expect(tip).toHaveText(FULL_TEXT)
    await expect(trigger).toHaveAttribute('aria-describedby', (await tip.getAttribute('id'))!)
    await expect(trigger).toHaveAccessibleDescription(FULL_TEXT)
    // text only: no markup inside the box
    expect(await tip.evaluate(el => el.children.length)).toBe(0)
    // keyboard: Escape closes, Enter and Space toggle, focus stays on the trigger
    await trigger.focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(await placedTooltip(page)).toHaveText(FULL_TEXT)
    await page.keyboard.press('Space')
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('no outage in 30 days', async ({ page }) => {
    await open(page, NO_OUTAGE)
    await rowIn(page.locator('.md-reliability-panel'), UPTIME_ROW_LABEL).locator('.rb-row-label [data-tooltip-trigger]').hover()
    await expect(await placedTooltip(page)).toHaveText(NO_OUTAGE_TEXT)
  })

  test('a stored record without the uptime parts keeps the general explanation and the same row structure', async ({ page }) => {
    await open(page, OLD)
    const uptime = rowIn(page.locator('.md-reliability-panel'), UPTIME_ROW_LABEL)
    await expect(linesUnder(uptime)).toHaveCount(1)
    await uptime.locator('.rb-row-label [data-tooltip-trigger]').hover()
    await expect(await placedTooltip(page)).toHaveText(uptimeRowText())
  })
})

// Up to 640 px the panel is replaced by the compact tile, which opens the same rows in a dialog; at 768 px the panel
// itself is shown.
const DIALOG_MAX_WIDTH = 640
async function openRows(browser: Browser, width: number) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await open(page, FULL)
  if (width > DIALOG_MAX_WIDTH) {
    const panel = page.locator('.md-reliability-panel')
    await expect(panel).toBeVisible()
    return { ctx, page, scope: panel, dialog: null }
  }
  await page.locator('.md-sc-reliability').tap()
  const dialog = page.getByRole('dialog', { name: 'Reliability Score Breakdown' })
  await expect(dialog).toBeVisible()
  await layoutReady(page)
  return { ctx, page, scope: dialog, dialog }
}

for (const width of [320, 390, 768]) {
  test(`${width} px, touch: a tap opens the tooltip inside the viewport; the row does not overflow`, async ({ browser }) => {
    const { ctx, page, scope, dialog } = await openRows(browser, width)
    const uptime = rowIn(scope, UPTIME_ROW_LABEL)
    const audit = rowIn(scope, AUDIT_ROW_LABEL)
    await expect(linesUnder(uptime)).toHaveCount(1)
    await expect(linesUnder(audit)).toHaveCount(1)
    await expect(uptime.locator('.rb-row-detail')).toHaveCount(0)

    const trigger = uptime.locator('.rb-row-label [data-tooltip-trigger]')
    // the same trigger as the other rows: same hit area (the shared component's), same name pattern
    const hit = (await trigger.boundingBox())!
    const auditHit = (await audit.locator('.rb-row-label [data-tooltip-trigger]').boundingBox())!
    expect(hit.width).toBeGreaterThanOrEqual(24)
    expect(hit.height).toBeGreaterThanOrEqual(24)
    expect([hit.width, hit.height]).toEqual([auditHit.width, auditHit.height])
    await expect(trigger).toHaveAccessibleName(`More information about ${UPTIME_ROW_LABEL}`)

    await scrollToStable(trigger)
    await trigger.tap()
    const tip = await placedTooltip(page)
    await expect(tip).toHaveText(FULL_TEXT)
    await expect(trigger).toHaveAttribute('aria-describedby', (await tip.getAttribute('id'))!)
    const box = (await tip.boundingBox())!
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    expect(vp.w).toBe(width)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.w)
    expect(box.y + box.height).toBeLessThanOrEqual(vp.h)
    // the whole text is readable: nothing clipped inside the box
    expect(await tip.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    // in the dialog the tooltip lives inside it (its focus handling), as every tooltip of a dialog does
    expect(await tip.evaluate(el => !!el.closest('[role="dialog"]'))).toBe(dialog !== null)

    // no horizontal overflow: the row, its panel or dialog, the page
    for (const el of [uptime, scope]) expect(await el.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true)
    const rowBox = (await uptime.boundingBox())!
    expect(rowBox.x).toBeGreaterThanOrEqual(0)
    expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(vp.w)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // a second tap closes it; the dialog (when there is one) stays
    await trigger.tap()
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0)
    await expect(scope).toBeVisible()
    await ctx.close()
  })
}
