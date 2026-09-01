import { test, expect } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, loginAs, TEST_PUBKEY_HEX } from './fixtures/mocks'

const EXPECTED_NPUB = nip19.npubEncode(TEST_PUBKEY_HEX)

const cases = [
  { method: 'nip07', badge: 'Extension' },
  { method: 'nsec', badge: 'nsec' },
  { method: 'remote-signer', badge: 'Remote signer' },
] as const

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800, isMobile: false },
  { name: 'mobile', width: 390, height: 780, isMobile: true },
]) {
  test.describe(`profile dropdown — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile, hasTouch: viewport.isMobile })

    for (const c of cases) {
      test(`${c.method}: badge "${c.badge}" + npub copies full value`, async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await mockRelays(page)
        await installApiMocks(page)
        await loginAs(page, 'peter.bliznak', c.method)
        await page.goto('/')
        await page.waitForSelector('.navbar-profile')

        await expect(page.locator('.navbar-method-badge')).toHaveText(c.badge)

        const npub = page.locator('.navbar-npub')
        await expect(npub).toContainText(/^npub1.+….+$/)
        await npub.click()
        await expect(npub).toHaveText('Copied')
        const clip = await page.evaluate(() => navigator.clipboard.readText())
        expect(clip).toBe(EXPECTED_NPUB)

        // Disconnect still works, unchanged
        await expect(page.locator('.navbar-disconnect-btn')).toHaveAttribute('aria-label', 'Disconnect')
        await page.locator('.navbar-disconnect-btn').click()
        await expect(page.locator('.navbar-login-btn')).toBeVisible()
      })
    }
  })
}
