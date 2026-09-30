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
const cell = (page: Page, label: string) => page.locator('.audit-summary-strip .audit-summary-cell', { hasText: label })
const base = { auditNMints: 1000, auditNMelts: 500, auditRecentTotal: 100, auditRecentErrors: 2 }

// AUDIT_W (optional) only exists for taking screenshots at a given width.
if (process.env.AUDIT_W) test.use({ viewport: { width: Number(process.env.AUDIT_W), height: 900 } })

test.describe('Audit data freshness', () => {
  test('fresh data: two labelled times, no notice, no breakdown note', async ({ page }) => {
    await gotoAudit(page, { ...base, auditCheckedAt: ago(3 * H), auditSyncedAt: ago(2 * H) })
    await expect(cell(page, "Auditor's last check").locator('.audit-summary-value')).toHaveText('3h ago')
    await expect(cell(page, 'MintRadar last synced').locator('.audit-summary-value')).toHaveText('2h ago')
    await expect(page.locator('.audit-stale-notice')).toHaveCount(0)
    await expect(page.locator('.rb-row-note')).toHaveCount(0)
    await shot(page, 'fresh')
  })

  test('auditor data 10 days old: notice (a) and breakdown note', async ({ page }) => {
    await gotoAudit(page, { ...base, auditCheckedAt: ago(10 * D + H), auditSyncedAt: ago(2 * H) })
    await expect(cell(page, "Auditor's last check").locator('.audit-summary-value')).toHaveText('10d ago')
    const notices = page.locator('.audit-stale-notice')
    await expect(notices).toHaveCount(1)
    await expect(notices.first()).toHaveText('This audit data is 10 days old and still counts toward the Reliability Score.')
    await expect(page.locator('.rb-row-note').first()).toHaveText('data 10 days old')
    await expect(page.locator('.rb-row-note').first()).toHaveAttribute('title', /Two times apply/)
    await shot(page, 'auditor-old')
  })

  test('MintRadar sync 2 days old: notice (b) only', async ({ page }) => {
    const synced = ago(2 * D)
    await gotoAudit(page, { ...base, auditCheckedAt: ago(3 * H), auditSyncedAt: synced })
    const notices = page.locator('.audit-stale-notice')
    await expect(notices).toHaveCount(1)
    await expect(notices.first()).toHaveText(/^MintRadar has not refreshed audit data since \d{1,2} \w{3} \d{4}, \d{2}:\d{2} UTC\.$/)
    await expect(notices.first()).not.toContainText(/outage|down/i)
    await expect(page.locator('.rb-row-note').first()).toHaveText('sync 48h old')
    await shot(page, 'sync-stale')
  })

  test('no audit data: no notices, no breakdown note, existing empty text', async ({ page }) => {
    await gotoAudit(page, { auditNMints: null, auditNMelts: null, auditRecentTotal: null, auditRecentErrors: null, auditCheckedAt: null, auditSyncedAt: null })
    await expect(page.getByText('No audit data available for this mint.')).toBeVisible()
    await expect(page.locator('.audit-stale-notice')).toHaveCount(0)
    await expect(page.locator('.rb-row-note')).toHaveCount(0)
    await shot(page, 'no-data')
  })
})
