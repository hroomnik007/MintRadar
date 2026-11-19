import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { ALPHA_PATH, auditCzResponse, czSwapList, gotoAuditTab, NO_8333, disableMotion } from './fixtures/auditCz'
import { resize, layoutReady } from './fixtures/settle'

// UI/UX audit of 2026-11-15, Mint Detail: the Version history (since 2026-11-19 the What happened timeline) and Audit tables at the widths where the left column is
// narrow, tab deep links on a hash-only change, the Uptime 24h tile before its query answers, the QR title and NUT tiles.

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const versionHistory = {
  history: [
    { version: 'cdk-mintd/0.18.3', firstSeenAt: daysAgo(8) },
    { version: 'cdk-mintd/0.17.7', firstSeenAt: daysAgo(40) },
    { version: 'Nutshell/0.20.3', firstSeenAt: daysAgo(90) },
  ],
  latestGlobalVersion: 'cdk-mintd/0.18.3',
}

const ok = { kind: 'ok', durationMs: 1000 }
const melt = { kind: 'melt', status: 'failed', stage: 'melt', error: 'melt failed', durationMs: 500 }

async function open(page: import('@playwright/test').Page, hash = '') {
  await disableMotion(page)
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/version-history**', r => r.fulfill({ json: versionHistory }))
  await page.goto(ALPHA_PATH + hash)
  await expect(page.locator('.md-tabs')).toBeVisible()
}

// The software changes are rows of the "What happened" timeline since the 2026-11-19 redesign (it was a three-column
// Version history table whose To column was cut at narrow widths).
for (const width of [700, 860, 1000, 1100, 1440, 390]) {
  test(`What happened at ${width}px: the newest version is shown whole`, async ({ page }) => {
    await resize(page, width, 900)
    await open(page, '#history')
    const rows = page.locator('.md-events > .md-ev-software')
    await expect(rows).toHaveCount(3)
    await layoutReady(page)
    const m = await rows.first().evaluate(r => {
      const text = r.querySelector('.md-ev-text') as HTMLElement
      return { cut: text.scrollWidth > text.clientWidth + 1, over: r.scrollWidth > r.clientWidth + 1 }
    })
    expect(m.cut, 'version text cut').toBe(false)
    expect(m.over, 'row wider than its panel').toBe(false)
    await expect(rows.first()).toContainText('0.18.3')
  })
}

for (const width of [800, 900, 1000]) {
  // The Audit tab has the full width since the 2026-11-19 redesign (the side column is on Overview only).
  test(`Audit swap list at ${width}px: fits its box without a sideways scroll`, async ({ page }) => {
    await resize(page, width, 900)
    await gotoAuditTab(page, { alpha: { ...NO_8333 }, cz: auditCzResponse({ swaps: czSwapList([ok, ok, melt, ok, ok]) }) })
    await expect(page.locator('.audit-swaps-table tbody tr').first()).toBeVisible()
    await layoutReady(page)
    const m = await page.locator('.audit-swaps-table-wrap').evaluate(w => ({ sw: w.scrollWidth, cw: w.clientWidth }))
    expect(m.sw).toBeLessThanOrEqual(m.cw)
  })
}

test('Audit swap list at 1440px: all seven columns', async ({ page }) => {
  await resize(page, 1440, 900)
  await gotoAuditTab(page, { alpha: { ...NO_8333 }, cz: auditCzResponse({ swaps: czSwapList([ok, ok, melt, ok, ok]) }) })
  await expect(page.locator('.audit-swaps-table thead th:visible')).toHaveText(['When', 'Direction', 'Other mint', 'Amount', 'Fee', 'Duration', 'Result'])
})

test('a hash-only change on the same mint page switches the tab', async ({ page }) => {
  await open(page, '#history')
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(() => { window.location.hash = '#audit' })
  await expect(page.getByRole('tab', { name: 'Audit' })).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(() => { window.location.hash = '#nuts' })
  await expect(page.getByRole('tab', { name: 'NUTs' })).toHaveAttribute('aria-selected', 'true')
  // a click still writes its own hash
  await page.getByRole('tab', { name: 'Reviews' }).click()
  await expect(page).toHaveURL(/#reviews$/)
})

test('Uptime 24h tile: the list value and "loading checks…" while the 24 h history is pending, never "0 / 0 checks"', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/history**', async route => {
    const u = new URL(route.request().url())
    if (u.searchParams.get('period') === '24h') await held
    await route.fallback()
  })
  await page.goto(ALPHA_PATH)
  const tile = page.locator('.md-sc', { has: page.locator('.md-sc-label', { hasText: 'Uptime 24h' }) })
  await expect(tile.getByTestId('md-uptime-24h-checks')).toHaveText('loading checks…')
  const alpha = MOCK_KNOWN_MINTS[0]!
  await expect(tile.locator('.md-sc-value')).toHaveText(`${alpha.uptimePct24h}%`)
  await expect(tile).not.toContainText('0 / 0')
  release()
  await expect(tile.getByTestId('md-uptime-24h-checks')).toHaveText('12 / 12 checks')
  await expect(tile.locator('.md-sc-value')).toHaveText('99%')
})

test('390px: the Mint QR dialog title wraps instead of being cut', async ({ page }) => {
  await resize(page, 390, 844)
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, name: 'A Rather Long Community Mint Name' } : m))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.goto(ALPHA_PATH)
  await page.getByRole('button', { name: 'Mint QR' }).click()
  const title = page.locator('.qr-modal-title')
  await expect(title).toContainText('to wallet')
  const m = await title.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, right: el.getBoundingClientRect().right }))
  expect(m.sw).toBeLessThanOrEqual(m.cw)
  expect(m.right).toBeLessThanOrEqual(390)
})

for (const width of [900, 360]) {
  test(`NUT tiles at ${width}px: descriptions are not cut`, async ({ page }) => {
    await resize(page, width, 900)
    await open(page, '#nuts')
    await expect(page.locator('.nut-card').first()).toBeVisible()
    await layoutReady(page)
    const cut = await page.locator('.nut-desc').evaluateAll(els => els
      .filter(e => (e as HTMLElement).scrollHeight > (e as HTMLElement).clientHeight + 1 || (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1)
      .map(e => e.textContent))
    expect(cut).toEqual([])
  })
}
