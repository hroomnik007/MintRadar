import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// Login dialog (2026-11-14): the order of the methods on a phone, nsec always the third row, and "New to Nostr?" with
// app links only (MintRadar never generates a key).

async function openLogin(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Login via Nostr/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}
const titles = (page: Page) => page.locator('.nostr-method-card .nostr-method-title')

test('desktop: Nostr extension, Remote signer, Nostr key (nsec)', async ({ page }) => {
  await openLogin(page)
  await expect(titles(page)).toHaveText(['Nostr extension', 'Remote signer', 'Nostr key (nsec)'])
})

test('"New to Nostr? Get started" opens plain text with app links and generates nothing', async ({ page }) => {
  await openLogin(page)
  const toggle = page.getByRole('button', { name: 'New to Nostr? Get started' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('new-to-nostr')).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const panel = page.getByTestId('new-to-nostr')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Then come back here and sign in')
  const links = panel.getByRole('link')
  await expect(links).toHaveText(['Primal', 'Amber', 'Alby'])
  for (const l of await links.all()) {
    expect(await l.getAttribute('href')).toMatch(/^https:\/\//)
    expect(await l.getAttribute('target')).toBe('_blank')
    expect(await l.getAttribute('rel')).toContain('noopener')
  }
  // Plain text: no button, input or key in it.
  await expect(panel.locator('button, input, textarea')).toHaveCount(0)
  await expect(panel).not.toContainText(/nsec1|npub1|generate/i)
  // The three methods are still there and still work as before.
  await expect(titles(page)).toHaveCount(3)
  // Closing the dialog collapses it again.
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: /Login via Nostr/i }).click()
  await expect(page.getByTestId('new-to-nostr')).toHaveCount(0)
})

test.describe('on a phone', () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  })

  test('Remote signer first, Nostr extension second, Nostr key (nsec) third', async ({ page }) => {
    await openLogin(page)
    await expect(titles(page)).toHaveText(['Remote signer', 'Nostr extension', 'Nostr key (nsec)'])
    // The first row is still the remote signer flow (QR pairing).
    await page.locator('.nostr-method-card').first().click()
    await page.waitForSelector('.nostr-qr-wrap svg')
  })
})
