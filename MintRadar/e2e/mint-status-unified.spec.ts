import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, probePayload } from './fixtures/mocks'

// One status rule for the site and the wallet API (2026-10-27, utils/mintStatus.ts). A mint the API calls
// `degraded` (lnpay: no successful probe for days) read "Offline" on its Mint detail page while the card said
// "Offline 24h+". Now the Mint detail pill, the card dot, the list view and Compare all say "Offline 24h+".
// A successful live probe from the page is newer than the snapshot and still wins ("Online").
const CH = 'https://charlie.mint.example'
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

async function setup(page: Page, opts: { degraded: boolean; liveOnline?: boolean }) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({
    json: MOCK_KNOWN_MINTS.map(m => m.url === CH
      ? { ...m, online: false, degraded: opts.degraded, lastOnlineAt: ago(3), offlineSince: ago(3), uptimePct24h: 0 }
      : m),
  }))
  if (opts.liveOnline !== undefined) {
    await page.route('**/api/mint/probe**', r => {
      const u = new URL(r.request().url()).searchParams.get('url') ?? ''
      const p = probePayload(u)
      r.fulfill({ json: u === CH ? { ...p, online: opts.liveOnline } : p })
    })
  }
}

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${vp.width}px`, () => {
    test.use({ viewport: vp })

    test('a degraded mint reads "Offline 24h+" on Mint detail and on its card', async ({ page }) => {
      await setup(page, { degraded: true, liveOnline: false })
      await page.goto('/mint/charlie.mint.example')
      const pill = page.locator('.md-status-inline')
      await expect(pill).toHaveText('Offline 24h+')
      await expect(pill).toHaveAttribute('data-status', 'degraded')
      await expect(pill).toHaveClass(/offline/)
      await page.goto('/?status=all')
      const card = page.locator('.mint-card', { hasText: 'Charlie Mint' })
      await expect(card.locator('.card-hdr-badge')).toHaveText('Offline 24h+')
      await expect(card.locator('.status-dot')).toHaveAttribute('title', 'Offline 24h+')
    })

    test('an offline mint under the degraded rule still reads "Offline"', async ({ page }) => {
      await setup(page, { degraded: false, liveOnline: false })
      await page.goto('/mint/charlie.mint.example')
      await expect(page.locator('.md-status-inline')).toHaveText('Offline')
      await expect(page.locator('.md-status-inline')).toHaveAttribute('data-status', 'offline')
    })

    test('a successful live probe is newer than the snapshot: Online', async ({ page }) => {
      await setup(page, { degraded: true, liveOnline: true })
      await page.goto('/mint/charlie.mint.example')
      await expect(page.locator('.md-status-inline')).toHaveText('Online')
    })
  })
}

test('list view and Compare use the same word for a degraded mint', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await setup(page, { degraded: true, liveOnline: false })
  await page.goto('/?status=all')
  await page.locator('.view-toggle-btn[title="List view"]').click()
  const row = page.locator('.mint-list-row', { hasText: 'Charlie Mint' })
  await expect(row.locator('td').nth(1)).toHaveText('● Offline 24h+')
  await expect(page.locator('.mint-list-row', { hasText: 'Alpha Mint' }).locator('td').nth(1)).toHaveText('● Online')

  await page.goto('/mint/charlie.mint.example')
  await page.getByRole('button', { name: /Compare/ }).first().click()
  await page.locator('.md-picker-item', { hasText: 'Alpha Mint' }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
  const cells = page.locator('.cmp-lbl', { hasText: /^Status$/ }).locator('xpath=following-sibling::div[contains(@class,"cmp-val")]')
  await expect(cells.filter({ hasText: 'Offline 24h+' })).toHaveCount(1)
  await expect(cells.filter({ hasText: 'Online' })).toHaveCount(1)
})
