import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

const ALPHA = 'https://alpha.mint.example'

const KS = [
  { id: '00ad268c4d1f5826', unit: 'sat', active: true },
  { id: '00c074b96c7e2b0e', unit: 'sat', active: false },
  { id: '00ffee11aa22bb33', unit: 'usd', active: true },
]

function probeWith(keysets: unknown, online = true) {
  return {
    url: ALPHA, online, latencyMs: online ? 40 : null,
    info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts: { '4': {}, '5': {} } },
    keysets,
    checkedAt: new Date().toISOString(),
  }
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

// ── Desktop (≥901px): Keysets lives on the Overview sidebar, not the NUTs tab ──
test.describe('Mint Detail — Keysets panel placement (desktop)', () => {
  test('renders on Overview and NOT on the NUTs tab', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()

    const overviewPanel = page.locator('.md-keysets-at-overview')
    await expect(overviewPanel).toBeVisible()
    await expect(overviewPanel.locator('.md-panel-title', { hasText: 'Keysets' })).toBeVisible()
    await expect(overviewPanel.locator('.md-keyset-row')).toHaveCount(3)
    // the NUTs-tab copy exists in the DOM but is hidden at this breakpoint
    await expect(page.locator('.md-keysets-at-nuts')).toBeHidden()

    await page.locator('.md-tab', { hasText: 'NUTs' }).click()
    await expect(page.locator('.md-keysets-at-nuts')).toBeHidden()
  })

  test('heading carries the keyset explainer as a title tooltip', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    const heading = page.locator('.md-keysets-at-overview .md-panel-title', { hasText: 'Keysets' })
    await expect(heading).toHaveAttribute('title', /Active = used for new tokens/)
  })

  test('lists active / inactive state and copies the full id', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)

    const panel = page.locator('.md-keysets-at-overview')
    await expect(panel.getByText('00ad268c…4d1f5826')).toBeVisible()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(2)
    await expect(panel.getByText('Inactive', { exact: true })).toHaveCount(1)

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await panel.locator('.md-keyset-row').first().getByRole('button', { name: 'Copy full keyset ID' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('00ad268c4d1f5826')
  })

  test('empty state unchanged when the probe returns no keysets', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(null, false) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)

    const panel = page.locator('.md-keysets-at-overview')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Keyset data not available.')).toBeVisible()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(0)
  })
})

// ── Mobile (<901px): Keysets stays on the NUTs tab, not on Overview ──
test.describe('Mint Detail — Keysets panel placement (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  async function openNutsTab(page: import('@playwright/test').Page) {
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await page.locator('.md-tab', { hasText: 'NUTs' }).click()
  }

  test('renders on the NUTs tab and NOT on Overview', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()

    // Overview: the desktop-only sidebar copy is hidden at this breakpoint
    await expect(page.locator('.md-keysets-at-overview')).toBeHidden()

    await page.locator('.md-tab', { hasText: 'NUTs' }).click()
    const panel = page.locator('.md-keysets-at-nuts')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.md-panel-title', { hasText: 'Keysets' })).toBeVisible()
    await expect(panel.locator('.md-keyset-row')).toHaveCount(3)
  })

  test('heading tooltip + active/inactive badges + copy still work', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await openNutsTab(page)

    const panel = page.locator('.md-keysets-at-nuts')
    await expect(panel.locator('.md-panel-title', { hasText: 'Keysets' }))
      .toHaveAttribute('title', /existing tokens may still melt/)
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(2)
    await expect(panel.getByText('Inactive', { exact: true })).toHaveCount(1)

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await panel.locator('.md-keyset-row').first().getByRole('button', { name: 'Copy full keyset ID' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('00ad268c4d1f5826')
  })

  test('empty state unchanged when the probe returns no keysets', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(null, false) }))
    await openNutsTab(page)

    const panel = page.locator('.md-keysets-at-nuts')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Keyset data not available.')).toBeVisible()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(0)
  })
})
