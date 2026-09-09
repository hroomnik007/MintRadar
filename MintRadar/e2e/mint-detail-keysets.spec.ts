import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

const ALPHA = 'https://alpha.mint.example'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

async function openNutsTab(page: import('@playwright/test').Page) {
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-tab', { hasText: 'NUTs' }).click()
}

test.describe('Mint Detail — Keysets panel (NUTs tab)', () => {
  test('lists every keyset with active / inactive state and a copy control', async ({ page }) => {
    const KS = [
      { id: '00ad268c4d1f5826', unit: 'sat', active: true },
      { id: '00c074b96c7e2b0e', unit: 'sat', active: false },
      { id: '00ffee11aa22bb33', unit: 'usd', active: true },
    ]
    await page.route('**/api/mint/probe**', route =>
      route.fulfill({ json: {
        url: ALPHA, online: true, latencyMs: 40,
        info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts: { '4': {}, '5': {} } },
        keysets: KS,
        checkedAt: new Date().toISOString(),
      } }))

    await openNutsTab(page)

    const panel = page.locator('.md-panel').filter({ has: page.locator('.md-panel-title', { hasText: 'Keysets' }) })
    await expect(panel).toBeVisible()
    const rows = panel.locator(".md-keyset-row")
    await expect(rows).toHaveCount(3)

    // truncated id + both state badges present
    await expect(panel.getByText('00ad268c…4d1f5826')).toBeVisible()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(2)
    await expect(panel.getByText('Inactive', { exact: true })).toHaveCount(1)

    // copy writes the full id
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await rows.first().getByRole('button', { name: 'Copy full keyset ID' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('00ad268c4d1f5826')
  })

  test('shows the "not available" empty state when the probe returns no keysets', async ({ page }) => {
    await page.route('**/api/mint/probe**', route =>
      route.fulfill({ json: {
        url: ALPHA, online: false, latencyMs: null,
        info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts: { '4': {}, '5': {} } },
        keysets: null,
        checkedAt: new Date().toISOString(),
      } }))

    await openNutsTab(page)

    const panel = page.locator('.md-panel').filter({ has: page.locator('.md-panel-title', { hasText: 'Keysets' }) })
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Keyset data not available.')).toBeVisible()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(0)
  })
})
