import { test, expect } from '@playwright/test'
import { NO_8333, auditCzResponse, czDetail, gotoAuditTab } from './fixtures/auditCz'
import { layoutReady, resize } from './fixtures/settle'

type Page = import('@playwright/test').Page

// Audit tab, cashu.info view: "Deposits (mint)" and "Withdrawals (melt)" rows (src/components/AuditDirections.tsx).
// Facts of the stored 7-day window split by direction; the score keeps using the combined number.

const rows = (page: Page) => page.getByTestId('audit-directions').locator('.md-info-row')
const row = (page: Page, dir: 'mint' | 'melt') => page.getByTestId('audit-directions').locator(`[data-direction="${dir}"]`)

const czOnly = (cz: unknown) => ({ alpha: { ...NO_8333 }, cz })

test('both directions: attempts, failures, window, source and sync time; deposits first', async ({ page }) => {
  await gotoAuditTab(page, czOnly(auditCzResponse()))
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, 'mint').locator('.md-info-label')).toHaveText('Deposits (mint)')
  await expect(row(page, 'melt').locator('.md-info-label')).toHaveText('Withdrawals (melt)')
  // asDest (62 attempts, 6 failed) is the deposit side, asSource (64, 13) the withdrawal side
  await expect(row(page, 'mint').locator('.md-info-value')).toHaveText('62 attempts, 6 failures · 7 days · cashu.info · synced 10 min ago')
  await expect(row(page, 'melt').locator('.md-info-value')).toHaveText('64 attempts, 13 failures · 7 days · cashu.info · synced 10 min ago')
  await expect(row(page, 'mint').locator('span[title]')).toHaveAttribute('title', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/)
})

test('one muted sentence: the score uses the combined number, these rows are the same data split', async ({ page }) => {
  await gotoAuditTab(page, czOnly(auditCzResponse()))
  await expect(page.getByTestId('audit-directions').locator('.audit-cz-muted')).toHaveText('The Reliability Score uses the combined number. These rows are the same data split by direction.')
})

test('a very small sample is shown as it is, and nothing is coloured to judge it', async ({ page }) => {
  const cz = auditCzResponse({ detail: czDetail({ swaps7d: { all: { total: 11, success: 9, failed: 2 }, asSource: { total: 10, success: 10, failed: 0 }, asDest: { total: 1, success: 0, failed: 1 }, errorsBlamed: 1 } }) })
  await gotoAuditTab(page, czOnly(cz))
  await expect(row(page, 'mint').locator('.md-info-value')).toContainText('1 attempt, 1 failure')
  // one constant colour: a direction with 100% failures looks like any other row
  const color = (dir: 'mint' | 'melt') => row(page, dir).locator('.md-info-value').evaluate(e => getComputedStyle(e).color)
  expect(await color('mint')).toBe(await color('melt'))
})

test('a direction without numbers says "No data from cashu.info"', async ({ page }) => {
  const cz = auditCzResponse({ detail: czDetail({ swaps7d: { all: { total: 30, success: 30, failed: 0 }, asSource: { total: 30, success: 30, failed: 0 }, errorsBlamed: 0 } }) })
  await gotoAuditTab(page, czOnly(cz))
  await expect(row(page, 'mint').locator('.md-info-value')).toHaveText('No data from cashu.info')
  await expect(row(page, 'melt').locator('.md-info-value')).toContainText('30 attempts, 0 failures')
})

test('no swaps block at all: both rows say no data', async ({ page }) => {
  const cz = auditCzResponse({ detail: czDetail({ swaps7d: undefined }) })
  await gotoAuditTab(page, czOnly(cz))
  await expect(rows(page).locator('.md-info-value')).toHaveText(['No data from cashu.info', 'No data from cashu.info'])
})

test('the existing tiles are unchanged next to the rows', async ({ page }) => {
  await gotoAuditTab(page, czOnly(auditCzResponse()))
  await expect(page.locator('.audit-cz-tiles [data-tile="melts"] .audit-summary-value')).toHaveText('51 / 64')
  await expect(page.locator('.audit-cz-tiles [data-tile="mints"] .audit-summary-value')).toHaveText('56 / 62')
})

for (const [w, h] of [[1440, 900], [768, 1024], [390, 844], [320, 640]] as const) {
  test(`layout at ${w}px: inside the panel, no overflow, 12px floor on phones`, async ({ page }) => {
    await resize(page, w, h)
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await expect(rows(page)).toHaveCount(2)
    await layoutReady(page)
    const m = await page.getByTestId('audit-directions').evaluate(panel => {
      const pr = panel.getBoundingClientRect()
      const out: string[] = []
      const small: string[] = []
      for (const el of panel.querySelectorAll<HTMLElement>('*')) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1)) out.push(String(el.className || el.tagName))
        if ([...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim()) && parseFloat(getComputedStyle(el).fontSize) < 12) small.push(String(el.className || el.tagName))
      }
      return { out, small, docOverflow: document.documentElement.scrollWidth - window.innerWidth }
    })
    expect(m.out).toEqual([])
    expect(m.docOverflow).toBeLessThanOrEqual(0)
    if (w <= 480) expect(m.small).toEqual([])
  })
}
