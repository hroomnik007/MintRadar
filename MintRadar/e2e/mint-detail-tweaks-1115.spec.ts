import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Mint Detail tweaks (2026-11-15): "Details ›" under the strip's Reliability Score only in the mobile panel layout,
// "Show my latency" turns into "Your latency: N ms" in place (the strip keeps its height), and the NIP-87 row drops
// "stored when first seen" (found) and "checked {time}" (not found).

const ALPHA = MOCK_MINTS[0]!.url
const CORS = { 'access-control-allow-origin': '*' }
// The dev server's CSP has connect-src 'self' (production allows https:), which blocks the browser's own fetch to the
// mint; bypassed here so the mocked /v1/info answers and the button gets a number.
test.use({ bypassCSP: true })

async function open(page: Page, width: number, known?: Record<string, unknown>) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  if (known) await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => m.url === ALPHA ? { ...m, ...known } : m) }))
  await resize(page, width, width < 769 ? 844 : 900)
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await layoutReady(page)
}

for (const width of [1440, 1024, 769]) {
  test(`${width}px: the strip's Reliability Score tile has no "Details ›" row`, async ({ page }) => {
    await open(page, width)
    const tile = page.getByTestId('md-summary-score')
    await expect(tile).toBeVisible()
    await expect(tile.locator('.md-sc-score-link')).toBeHidden()
    await expect(tile).toContainText('High Reliability')
  })
}

test('700px (mobile panel layout): the Reliability Score tile keeps "Details ›"', async ({ page }) => {
  await open(page, 700)
  await expect(page.getByTestId('md-summary-score').locator('.md-sc-score-link')).toBeVisible()
  await expect(page.getByTestId('md-summary-score').locator('.md-sc-score-link')).toHaveText('Details ›')
})

test('390px: the compact Reliability tile keeps "Details ›"', async ({ page }) => {
  await open(page, 390)
  await expect(page.locator('.md-sc-reliability .md-sc-reliability-link')).toBeVisible()
})

for (const width of [1440, 1200, 1024, 769, 390, 320]) {
  test(`${width}px: "Show my latency" becomes "Your latency: N ms" in the same button, the strip does not grow`, async ({ page }) => {
    await open(page, width)
    // A slow answer (over a second): the longest usual result, four digits.
    // (The browser fetch is cross-origin: the answer needs the CORS header to be readable.)
    await page.route('**/v1/info', async r => { await new Promise(res => setTimeout(res, 1100)); await r.fulfill({ headers: CORS, json: { name: 'Mint', nuts: {} } }) })
    const strip = page.locator('.md-summary')
    const btn = page.locator('.latency-test-btn')
    await expect(btn).toHaveText('Show my latency')
    const before = await strip.boundingBox()
    const btnBefore = await btn.boundingBox()
    await btn.click()
    await expect(btn).toHaveText(/^Your latency: \d{4} ms$/, { timeout: 6000 })
    await expect(page.getByText(/Your latency:/)).toHaveCount(1)
    const after = await strip.boundingBox()
    const btnAfter = await btn.boundingBox()
    expect(Math.abs(after!.height - before!.height), 'strip height').toBeLessThan(0.5)
    expect(Math.abs(btnAfter!.y - btnBefore!.y), 'button top').toBeLessThan(0.5)
    expect(Math.abs(btnAfter!.height - btnBefore!.height), 'button height').toBeLessThan(0.5)
    // The result stays inside its tile.
    const fits = await btn.evaluate(b => { const t = b.closest('.md-sc')!.getBoundingClientRect(); const r = b.getBoundingClientRect(); return r.right <= t.right + 0.5 && b.scrollWidth <= b.clientWidth + 1 })
    expect(fits, 'button inside the tile').toBe(true)
    // A click on the result measures again.
    await page.unroute('**/v1/info')
    await page.route('**/v1/info', r => r.fulfill({ headers: CORS, json: { name: 'Mint', nuts: {} } }))
    await btn.click()
    await expect(btn).toHaveText(/^Your latency: \d+ ms$/, { timeout: 6000 })
  })
}

test('an unreachable mint: "Unreachable" in the button, the reason for screen readers', async ({ page }) => {
  await open(page, 390)
  await page.route('**/v1/info', r => r.fulfill({ status: 503, headers: CORS, body: '' }))
  const btn = page.locator('.latency-test-btn')
  await btn.click()
  await expect(btn).toHaveText('Unreachable (HTTP 503)')
  await expect(btn.locator('.sr-only')).toHaveText(' (HTTP 503)')
})

test('NIP-87 found: "event dated …" without "stored when first seen"', async ({ page }) => {
  await open(page, 1440, { nostrAnnounceId: 'e'.repeat(64), nostrAnnouncePubkey: 'a'.repeat(64), nostrAnnounceD: 'alpha', nostrAnnouncedAt: '2026-11-01T10:00:00.000Z', nostrCheckedAt: '2026-11-15T10:00:00.000Z' })
  const row = page.getByTestId('md-nip87')
  await expect(row).toContainText('NIP-87 announcement (kind:38172) · event dated 1 Nov 2026')
  await expect(row).not.toContainText('stored when first seen')
  await expect(row).not.toContainText('checked')
})

test('NIP-87 not found: only "No NIP-87 announcement seen on our relays", no "checked {time}"', async ({ page }) => {
  await open(page, 1440, { nostrAnnouncedAt: null, nostrCheckedAt: new Date(Date.now() - 5 * 60_000).toISOString() })
  const row = page.getByTestId('md-nip87')
  await expect(row).toHaveText('No NIP-87 announcement seen on our relays')
  await expect(page.getByTestId('md-nip87-checked')).toHaveCount(0)
})
