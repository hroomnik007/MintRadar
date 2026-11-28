import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, probePayload } from './fixtures/mocks'

// One status rule for the site and the wallet API (2026-10-27, utils/mintStatus.ts). A mint the API calls
// `degraded` (lnpay: no successful probe for days) read "Offline" on its Mint detail page while the card said
// "Degraded". Now the Mint detail pill, the card dot, the list view and Compare all say "Degraded".
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

    test('a degraded mint reads "Degraded" on Mint detail and on its card', async ({ page }) => {
      await setup(page, { degraded: true, liveOnline: false })
      await page.goto('/mint/charlie.mint.example')
      const pill = page.locator('.md-status-inline')
      await expect(pill).toHaveText('Degraded')
      await expect(pill).toHaveAttribute('data-status', 'degraded')
      await expect(pill).toHaveClass(/offline/)
      await page.goto('/?status=all')
      const card = page.locator('.mint-card', { hasText: 'Charlie Mint' })
      // Said once since the 2026-11-19 redesign: the state word in the card foot (no separate badge, no dot tooltip).
      await expect(card.locator('.card-state')).toHaveText('Degraded')
      await expect(card.locator('.card-hdr-badge')).toHaveCount(0)
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
  // The list shows a status dot before the name since the 2026-11-19 redesign; the word is read out with it.
  await expect(row.locator('.mint-list-status')).toHaveText('Degraded')
  await expect(page.locator('.mint-list-row', { hasText: 'Alpha Mint' }).locator('.mint-list-status')).toHaveText('Online')

  await page.goto('/mint/charlie.mint.example')
  await page.getByRole('button', { name: /Compare/ }).first().click()
  await page.locator('.md-picker-item', { hasText: 'Alpha Mint' }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText(/^Compare [2-4] mints$/)).toBeVisible()
  // Since the 2026-11-28 redesign the status is the dot after each card's name; its word is shown when the mint is
  // not online and read out (sr-only) when it is.
  const cards = page.locator('[data-testid="cmp-card"]')
  await expect(cards.filter({ hasText: 'Charlie Mint' }).locator('.cx-status-word')).toHaveText('Degraded')
  await expect(cards.filter({ hasText: 'Charlie Mint' }).locator('.cx-dot-degraded')).toHaveCount(1)
  await expect(cards.filter({ hasText: 'Alpha Mint' }).locator('.cx-name .sr-only')).toHaveText('Online')
})
