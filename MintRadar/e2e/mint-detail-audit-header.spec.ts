import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const ALPHA = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`
const TOOLTIP_RE = /independent service that repeatedly mints and melts/i

type Page = import('@playwright/test').Page

async function gotoAudit(page: Page, opts: { noAudit?: boolean } = {}) {
  await mockRelays(page)
  await installApiMocks(page)
  if (opts.noAudit) {
    // Registered AFTER installApiMocks so this handler wins.
    const noAudit = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, auditNMints: null } : m))
    await page.route('**/api/mints/known', route => route.fulfill({ json: noAudit }))
  }
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-tab', { hasText: 'Audit' }).click()
}

// ── With audit data ─────────────────────────────────────────────
test.describe('Audit stats heading — with data', () => {
  test('desktop: static heading + ⓘ, collapse toggle hidden', async ({ page }) => {
    await gotoAudit(page)

    const header = page.locator('.md-audit-header-main')
    await expect(header).toBeVisible()
    await expect(header).toContainText('Audit stats')
    await expect(header).toContainText('via audit.8333.space')
    await expect(page.locator('.md-audit-toggle')).toBeHidden()

    await header.locator('.md-audit-info').hover()
    await expect(page.getByText(TOOLTIP_RE)).toBeVisible()

    await page.locator('.md-audit-collapsible').screenshot({ path: 'test-results/audit-header-desktop.png' })
  })

  test.describe('mobile', () => {
    test.use({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true })

    test('mobile heading carries the heading text + ⓘ', async ({ page }) => {
      await gotoAudit(page)

      await expect(page.locator('.md-audit-header-main')).toBeHidden()
      const toggle = page.locator('.md-audit-toggle')
      await expect(toggle).toBeVisible()
      await expect(toggle).toContainText('Audit stats')
      await expect(toggle).toContainText('via audit.8333.space')

      // The ⓘ is present in the heading row and its tooltip text is in the DOM.
      const info = toggle.locator('.md-audit-info')
      await expect(info).toBeVisible()
      await info.tap()
      await expect(page.getByText(TOOLTIP_RE)).toBeVisible()

      // Summary strip is always visible; there is no longer a collapsible body.
      await expect(page.locator('.audit-summary-strip')).toBeVisible()

      await page.locator('.md-audit-collapsible').screenshot({ path: 'test-results/audit-header-mobile.png' })
    })
  })
})

// ── "No audit data" fallback ────────────────────────────────────
test.describe('Audit stats heading — no-data fallback', () => {
  test('desktop: fallback shows the same heading + ⓘ', async ({ page }) => {
    await gotoAudit(page, { noAudit: true })

    const header = page.locator('.md-audit-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('Audit stats')
    await expect(header).toContainText('via audit.8333.space')
    await expect(page.getByText('No audit data available for this mint.')).toBeVisible()

    await header.locator('.md-audit-info').hover()
    await expect(page.getByText(TOOLTIP_RE)).toBeVisible()

    await page.locator('.md-panel', { hasText: 'No audit data' }).screenshot({ path: 'test-results/audit-header-nodata-desktop.png' })
  })

  test.describe('mobile', () => {
    test.use({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true })

    test('fallback heading is visible on mobile too', async ({ page }) => {
      await gotoAudit(page, { noAudit: true })

      const header = page.locator('.md-audit-header')
      await expect(header).toBeVisible()
      await expect(header).toContainText('Audit stats')
      await expect(page.getByText('No audit data available for this mint.')).toBeVisible()

      await page.locator('.md-panel', { hasText: 'No audit data' }).screenshot({ path: 'test-results/audit-header-nodata-mobile.png' })
    })
  })
})
