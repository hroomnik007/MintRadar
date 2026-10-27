import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, probePayload } from './fixtures/mocks'

// An archived mint's detail page (2026-10-27): no "Mint QR" (its dialog is "Add … to wallet"), no "Open in Cashu.me"
// and no "Outdated" version pill — the Archived state, the version text and the history stay. A mint that is only
// offline (not archived) keeps Mint QR and the pill. Bravo runs Nutshell/0.15.0 against a 0.20 latest = outdated.
const BRAVO = 'https://bravo.mint.example'
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

async function open(page: Page, archived: boolean) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({
    json: MOCK_KNOWN_MINTS.map(m => m.url === BRAVO
      ? { ...m, online: false, degraded: true, archived, lastOnlineAt: ago(60), offlineSince: ago(60), latencyMs: null }
      : m),
  }))
  await page.route('**/api/mint/probe**', r => {
    const u = new URL(r.request().url()).searchParams.get('url') ?? ''
    const p = probePayload(u)
    r.fulfill({ json: u === BRAVO ? { ...p, online: false, latencyMs: null } : p })
  })
  await page.goto('/mint/bravo.mint.example')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bravo Mint')
}

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${vp.width}px`, () => {
    test.use({ viewport: vp })

    test('archived: no Mint QR, Cashu.me or Outdated; Archived and history stay', async ({ page }) => {
      await open(page, true)
      await expect(page.locator('.md-status-inline.archived')).toHaveText(/Archived/)
      await expect(page.locator('.md-sc-value', { hasText: 'Nutshell/0.15.0' })).toBeVisible()
      await expect(page.getByRole('button', { name: /Mint QR/ })).toHaveCount(0)
      await expect(page.getByRole('link', { name: /Cashu\.me/ })).toHaveCount(0)
      await expect(page.locator('.md-outdated-pill')).toHaveCount(0)
      await expect(page.locator('.md-compare-btn')).toBeVisible()
      await page.locator('.md-tab', { hasText: 'History' }).click()
      await expect(page.locator('.md-tab.active')).toHaveText('History')
    })

    test('offline but not archived: Mint QR and Outdated stay', async ({ page }) => {
      await open(page, false)
      await expect(page.locator('.md-status-inline.archived')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Mint QR/ })).toBeVisible()
      await expect(page.getByRole('link', { name: /Cashu\.me/ })).toBeVisible()
      await expect(page.locator('.md-outdated-pill')).toHaveText('Outdated')
    })
  })
}
