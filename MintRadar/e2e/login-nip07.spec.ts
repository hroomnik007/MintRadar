import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

const PK = '2'.repeat(64)

// Inject a window.nostr NIP-07 mock (NOT logged in — no persisted session).
// `mode` controls whether getPublicKey resolves or rejects.
async function injectExtension(page: Page, mode: 'ok' | 'reject') {
  await page.addInitScript(({ PK, mode }) => {
    ;(window as unknown as { nostr: unknown }).nostr = {
      getPublicKey: async () => {
        if (mode === 'reject') throw new Error('User rejected the request')
        return PK
      },
      signEvent: async (e: Record<string, unknown>) => ({ ...e, id: 'f'.repeat(64), pubkey: PK, sig: '0'.repeat(128) }),
      nip04: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
      nip44: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
    }
  }, { PK, mode })
}

async function openModal(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Login via Nostr/i }).click()
  await page.waitForSelector('.nostr-modal')
}

const extCard = (page: Page) => page.locator('.nostr-method-card', { hasText: 'Nostr extension' })

test('extension available: clicking the card logs in with no Connect click', async ({ page }) => {
  await injectExtension(page, 'ok')
  await openModal(page)

  await extCard(page).click()
  // no focused view with a Connect button — it just connects
  await expect(page.locator('.nostr-modal')).toHaveCount(0, { timeout: 5000 })
  await expect(page.locator('.navbar-profile')).toBeVisible()
  await expect(page.locator('.navbar-method-badge')).toHaveText('Extension')
})

test('extension missing: clicking the card shows the install guidance, no silent failure', async ({ page }) => {
  await openModal(page) // no injectExtension → window.nostr undefined

  await extCard(page).click()
  await expect(page.locator('.nostr-warn')).toContainText(/No Nostr extension detected/i)
  await expect(page.getByRole('link', { name: /Install Alby/i })).toBeVisible()
  await expect(page.locator('.nostr-modal')).toBeVisible()
  // recovery affordances present; Connect is disabled with no extension
  await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Back/i })).toBeVisible()
})

test('extension rejects the request: focused view surfaces the error with a Retry', async ({ page }) => {
  await injectExtension(page, 'reject')
  await openModal(page)

  await extCard(page).click()
  await expect(page.locator('.nostr-auth-error')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.nostr-modal')).toBeVisible()
  await expect(page.getByRole('button', { name: /Retry/i })).toBeVisible()
})
