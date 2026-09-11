import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

type Page = import('@playwright/test').Page

const ALPHA = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`

// Override Alpha's known-mints payload and open the Audit tab.
async function gotoAudit(page: Page, alphaOverrides: Record<string, unknown>) {
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, ...alphaOverrides } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-tab', { hasText: 'Audit' }).click()
}

// ── Fully audited, enough recent swaps ─────────────────────────
test('fully audited: strip shows Mints / Melts / Recent success rate / Last checked', async ({ page }) => {
  await gotoAudit(page, {
    auditNMints: 1234,
    auditNMelts: 567,
    auditRecentTotal: 100,
    auditRecentErrors: 2,
    auditSyncedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  })

  const strip = page.locator('.audit-summary-strip')
  await expect(strip).toBeVisible()

  const cell = (label: string) => strip.locator('.audit-summary-cell', { hasText: label })
  await expect(cell('Mints').locator('.audit-summary-value')).toHaveText('1,234')
  await expect(cell('Melts').locator('.audit-summary-value')).toHaveText('567')
  // The main number is framed as successes (total - errors), not the error
  // count, so it reads in the same higher-is-better direction as every
  // other "X/Y" ratio in the app (e.g. Online Mints "55/56").
  await expect(cell('Recent success rate').locator('.audit-summary-main')).toHaveText('98 / 100')
  await expect(cell('Recent success rate').locator('.audit-summary-sub')).toHaveText('ok')
  // 2/100 errors = 2% error rate → auditReliabilityColor()'s <=5% bucket → var(--fast) green.
  await expect(cell('Recent success rate').locator('.audit-summary-value')).toHaveCSS('color', 'rgb(92, 201, 163)')
  await expect(cell('Last checked').locator('.audit-summary-value')).toHaveText('3h ago')

  await page.locator('.md-audit-collapsible').screenshot({ path: 'test-results/audit-strip-full.png' })
})

// ── High error rate → red, main number still reads as successes ────
test('high error rate: low success count, red', async ({ page }) => {
  await gotoAudit(page, {
    auditNMints: 1234,
    auditNMelts: 567,
    auditRecentTotal: 100,
    auditRecentErrors: 97,
    auditSyncedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  })

  const recent = page.locator('.audit-summary-strip .audit-summary-cell', { hasText: 'Recent success rate' })
  // 97 errors / 100 → 3 successes / 100, not "97 / 100" — the number always
  // means "how many went right", so a bad mint shows a small number here.
  await expect(recent.locator('.audit-summary-main')).toHaveText('3 / 100')
  await expect(recent.locator('.audit-summary-sub')).toHaveText('ok')
  // 97/100 errors = 97% error rate → auditReliabilityColor()'s >25% bucket → var(--slow) red.
  await expect(recent.locator('.audit-summary-value')).toHaveCSS('color', 'rgb(219, 106, 93)')

  await page.locator('.md-audit-collapsible').screenshot({ path: 'test-results/audit-strip-higherror.png' })
})

// ── Audited but < 3 recent swaps ──────────────────────────────
test('too few recent swaps: Recent success rate cell says "too few to score"', async ({ page }) => {
  await gotoAudit(page, {
    auditRecentTotal: 2,
    auditRecentErrors: 0,
    auditSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  })

  const recent = page.locator('.audit-summary-strip .audit-summary-cell', { hasText: 'Recent success rate' })
  await expect(recent.locator('.audit-summary-main')).toHaveText('2 / 2')
  await expect(recent.locator('.audit-summary-sub')).toHaveText('too few to score')
  // Unknown / too-few state stays grey (var(--text3)).
  await expect(recent.locator('.audit-summary-value')).toHaveCSS('color', 'rgb(154, 173, 164)')

  // Last checked still renders from our own sync time.
  const last = page.locator('.audit-summary-strip .audit-summary-cell', { hasText: 'Last checked' })
  await expect(last.locator('.audit-summary-value')).toHaveText('5 min ago')

  await page.locator('.md-audit-collapsible').screenshot({ path: 'test-results/audit-strip-fewswaps.png' })
})

// ── No recent swap window at all (audited, but /swaps returned nothing) ─
test('no rolling-window sample: Recent success rate cell shows only the sub-text', async ({ page }) => {
  await gotoAudit(page, { auditRecentTotal: null, auditRecentErrors: null })

  const recent = page.locator('.audit-summary-strip .audit-summary-cell', { hasText: 'Recent success rate' })
  // No ratio to show → the "N / 100" main span is omitted entirely.
  await expect(recent.locator('.audit-summary-main')).toHaveCount(0)
  await expect(recent.locator('.audit-summary-value')).toHaveText('no recent swaps')
  await expect(recent.locator('.audit-summary-sub')).toHaveText('no recent swaps')
  await expect(recent.locator('.audit-summary-value')).toHaveCSS('color', 'rgb(154, 173, 164)')
})

// ── Mint not in audit.8333.space at all ───────────────────────
test('not audited: no strip, existing "No audit data" fallback shown', async ({ page }) => {
  await gotoAudit(page, { auditNMints: null })

  await expect(page.locator('.audit-summary-strip')).toHaveCount(0)
  await expect(page.getByText('No audit data available for this mint.')).toBeVisible()
})

// ── auditSyncedAt not yet backfilled → "Last checked" degrades to em dash ─
test('missing auditSyncedAt: Last checked shows an em dash, not a wrong time', async ({ page }) => {
  await gotoAudit(page, { auditSyncedAt: null })

  const last = page.locator('.audit-summary-strip .audit-summary-cell', { hasText: 'Last checked' })
  await expect(last.locator('.audit-summary-value')).toHaveText('—')
})
