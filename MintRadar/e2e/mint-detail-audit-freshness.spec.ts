import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

type Page = import('@playwright/test').Page

const ALPHA = MOCK_MINTS[0]!.url
const H = 3_600_000
const D = 24 * H
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const SHOTS = process.env.AUDIT_SHOTS_DIR

async function gotoAudit(page: Page, over: Record<string, unknown>) {
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, ...over } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-tab', { hasText: 'Audit' }).click()
  await expect(page.locator('.md-audit-collapsible, .md-audit-header').first()).toBeVisible()
}
const shot = async (page: Page, name: string) => {
  if (!SHOTS) return
  const w = page.viewportSize()!.width
  await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true })
}
// audit.8333.space fields (Audit tab) + the cashu.info 7-day window that feeds the Reliability Score row
const base = { auditNMints: 1000, auditNMelts: 500, auditRecentTotal: 100, auditRecentErrors: 2, auditCzTotal: 100, auditCzBlamed: 2 }

if (process.env.AUDIT_W) test.use({ viewport: { width: Number(process.env.AUDIT_W), height: 900 } })

// The row's age rule is the stored cashu.info detail's own (auditCzFetchedAt): note above 24 h, neutral after 168 h.
// The audit.8333.space ages (auditCheckedAt / auditSyncedAt) no longer touch the row.
test.describe('Audit data freshness', () => {
  test('fresh detail: scored text, no note, no Last checked tile, no copper notice', async ({ page }) => {
    await gotoAudit(page, { ...base, auditCheckedAt: ago(3 * H), auditSyncedAt: ago(2 * H), auditCzFetchedAt: ago(2 * H) })
    await expect(page.locator('.audit-summary-cell', { hasText: 'Last checked' })).toHaveCount(0)
    await expect(page.locator('.audit-summary-cell', { hasText: "Auditor's last check" })).toHaveCount(0)
    await expect(page.locator('.audit-summary-cell', { hasText: 'MintRadar last synced' })).toHaveCount(0)
    await expect(page.locator('.audit-stale-notice')).toHaveCount(0)
    await expect(page.locator('.rb-row-detail')).toHaveCount(0)
    await expect(page.locator('.rb-row-note')).toHaveCount(0)
    await shot(page, 'fresh')
  })

  test('detail 5 days old: still scored, quiet "data 5 days old" note, no copper notice', async ({ page }) => {
    await gotoAudit(page, { ...base, auditCheckedAt: ago(3 * H), auditSyncedAt: ago(2 * H), auditCzFetchedAt: ago(5 * D + H) })
    await expect(page.locator('.audit-stale-notice')).toHaveCount(0)
    await expect(page.locator('.rb-row-detail')).toHaveCount(0)
    await expect(page.locator('.rb-row-note').first()).toHaveText('data 5 days old')
    await shot(page, 'detail-5d')
  })

  test('detail 30 hours old: note says "data 1 day old"', async ({ page }) => {
    await gotoAudit(page, { ...base, auditCzFetchedAt: ago(30 * H) })
    await expect(page.locator('.rb-row-note').first()).toHaveText('data 1 day old')
  })

  test('detail older than 7 days: neutral text, no note', async ({ page }) => {
    await gotoAudit(page, { ...base, auditCzFetchedAt: ago(8 * D) })
    await expect(page.locator('.rb-row-detail').first()).toHaveText('Audit data older than 7 days: neutral')
    await expect(page.locator('.rb-row-note')).toHaveCount(0)
    await shot(page, 'detail-8d')
  })

  test('fewer than 10 swaps: "Not enough audit data yet" neutral text', async ({ page }) => {
    await gotoAudit(page, { ...base, auditCzTotal: 9, auditCzBlamed: 0, auditCzFetchedAt: ago(2 * H) })
    await expect(page.locator('.rb-row-detail').first()).toHaveText('Not enough audit data yet (fewer than 10 swaps in the last 7 days): neutral')
  })

  test('stale audit.8333.space data does not touch the score row (no note, scored text)', async ({ page }) => {
    await gotoAudit(page, { ...base, auditCheckedAt: ago(10 * D + H), auditSyncedAt: ago(2 * D), auditCzFetchedAt: ago(2 * H) })
    await expect(page.locator('.audit-stale-notice')).toHaveCount(0)
    await expect(page.locator('.rb-row-detail')).toHaveCount(0)
    await expect(page.locator('.rb-row-note')).toHaveCount(0)
    await shot(page, 'auditor-old')
  })

  test('no audit data: no notices, no breakdown note, neutral text, existing empty Audit tab text', async ({ page }) => {
    await gotoAudit(page, { auditNMints: null, auditNMelts: null, auditRecentTotal: null, auditRecentErrors: null, auditCheckedAt: null, auditSyncedAt: null, auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null })
    await expect(page.getByText('No audit data available for this mint.')).toBeVisible()
    await expect(page.locator('.audit-stale-notice')).toHaveCount(0)
    await expect(page.locator('.rb-row-note')).toHaveCount(0)
    await expect(page.locator('.rb-row-detail').first()).toHaveText('No cashu.info audit data: neutral')
    await shot(page, 'no-data')
  })
})
