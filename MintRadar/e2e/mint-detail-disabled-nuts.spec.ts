// NUT-04 (minting) / NUT-05 (melting) with `disabled: true` in /v1/info (2026-10-27): Mint detail shows them as
// disabled, not supported (header count, NUTs tab), hides the Cashu.me button, and the lists and filters treat them
// as not offered (list view NUT column, ?nuts=4). The Reliability Score NUT row still counts declared NUTs.
import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, probePayload } from './fixtures/mocks'

const DELTA = 'https://delta.mint.example'
type Nuts = Record<string, unknown>
const off = (n: Nuts, keys: string[]): Nuts => ({ ...n, ...Object.fromEntries(keys.map(k => [k, { methods: [], disabled: true }])) })

const nutTileOf = (page: Page) => page.locator('.md-sc', { has: page.locator('.md-sc-label', { hasText: /^NUTs$/ }) })

async function setup(page: Page, keys: string[]) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({
    json: MOCK_KNOWN_MINTS.map(m => m.url === DELTA ? { ...m, nutsLimits: off(m.nutsLimits as Nuts, keys), mintMethods: [], meltMethods: [] } : m),
  }))
  await page.route('**/api/mint/probe**', r => {
    const u = new URL(r.request().url()).searchParams.get('url') ?? ''
    const p = probePayload(u)
    r.fulfill({ json: u === DELTA ? { ...p, info: { ...p.info, nuts: off(p.info.nuts as Nuts, keys) } } : p })
  })
}

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`disabled NUT-04/05 @ ${vp.width}`, () => {
    test.use({ viewport: vp })

    test('Mint detail: header and NUTs tab count them as disabled, Cashu.me is hidden, Mint QR stays', async ({ page }) => {
      await setup(page, ['4', '5'])
      await page.goto('/mint/delta.mint.example')
      const nutTile = nutTileOf(page)
      await expect(nutTile.locator('.md-sc-sub')).toHaveText('supported · 2 disabled')
      await expect(page.getByRole('link', { name: /Cashu\.me/ })).toHaveCount(0)
      await expect(page.locator('.md-quick-btn', { hasText: 'Mint QR' })).toBeVisible()

      await page.locator('.md-tab', { hasText: /^NUTs$/ }).click()
      await expect(page.locator('.nut-summary-line')).toContainText('· 2 disabled')
      for (const nut of ['NUT-04', 'NUT-05']) {
        const card = page.locator('.nut-card', { hasText: nut })
        await expect(card).toHaveClass(/nut-disabled/)
        await expect(card).toContainText('Disabled by operator')
      }
      await expect(page.locator('.nut-card', { hasText: 'NUT-07' })).toHaveClass(/supported/)

      // The modal of a disabled NUT says so (the score still counts the NUT as declared; methodology unchanged).
      await page.locator('.nut-card', { hasText: 'NUT-04' }).click()
      await expect(page.locator('.nm-status')).toHaveText('⊘ Disabled by operator')
    })

    test('only melting switched off: Cashu.me hidden as well, 1 disabled', async ({ page }) => {
      await setup(page, ['5'])
      await page.goto('/mint/delta.mint.example')
      await expect(nutTileOf(page).locator('.md-sc-sub')).toHaveText('supported · 1 disabled')
      await expect(page.getByRole('link', { name: /Cashu\.me/ })).toHaveCount(0)
    })

    test('a mint with nothing switched off keeps Cashu.me and the plain count', async ({ page }) => {
      await setup(page, [])
      await page.goto('/mint/delta.mint.example')
      await expect(nutTileOf(page).locator('.md-sc-sub')).toHaveText('supported')
      await expect(page.getByRole('link', { name: /Cashu\.me/ })).toBeVisible()
    })
  })
}

test.describe('disabled NUT-04/05 in lists and filters', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Dashboard ?nuts=4 drops the mint; the list view NUT column does not count them', async ({ page }) => {
    await setup(page, ['4', '5'])
    await page.goto('/?status=all&nuts=4')
    await expect(page.locator('.mint-card', { hasText: 'Alpha Mint' })).toBeVisible()
    await expect(page.locator('.mint-card', { hasText: 'Delta Mint' })).toHaveCount(0)

    await page.goto('/?status=all')
    await page.locator('.view-toggle-btn[title="List view"]').click()
    const row = page.locator('.mint-list-table tbody tr', { hasText: 'Delta Mint' })
    const delta = MOCK_KNOWN_MINTS.find(m => m.url === DELTA)!
    await expect(row).toContainText(`${(delta.nutCount as number) - 2}/14`)
  })
})
