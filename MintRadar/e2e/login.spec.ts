import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

async function openModal(page: Page) {
  await installApiMocks(page)
  await mockRelays(page)
  await page.goto('/')
  await page.getByRole('button', { name: /Login via Nostr/i }).click()
  await page.waitForSelector('.nostr-modal')
}

test('login modal: generic "Remote signer" method, Amber only as example', async ({ page }) => {
  await openModal(page)
  expect(await page.locator('.nostr-method-title').allTextContents())
    .toEqual(['Nostr extension', 'Nostr key (nsec)', 'Remote signer'])
  const desc = await page.locator('.nostr-method-card', { hasText: 'Remote signer' })
    .locator('.nostr-method-desc').textContent()
  expect(desc).toMatch(/NIP-46/)
  expect(desc).toMatch(/Amber/)
  expect(desc).toMatch(/nsec\.app/)
})

test('remote-signer: pairing QR renders with the patina bg token + generic copy', async ({ page }) => {
  await openModal(page)
  await page.locator('.nostr-method-card', { hasText: 'Remote signer' }).click()
  await expect(page.locator('.nostr-nsec-input')).toHaveAttribute('placeholder', /bunker:\/\//)
  await expect(page.locator('.nostr-qr-btn')).toHaveText('Show pairing QR')

  await page.locator('.nostr-qr-btn').click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  const fills = await page.$$eval('.nostr-qr-wrap svg path', ps => ps.map(p => p.getAttribute('fill')))
  expect(fills).toContain('#17251f') // === var(--surface)
  expect(fills).toContain('#f2f7f4')

  await expect(page.locator('.nostr-qr-btn')).toHaveText('Refresh QR')
  await expect(page.locator('.nostr-qr-hint')).toContainText(/signer app/i)
  await expect(page.locator('.nostr-warn')).toContainText(/remote signer to connect/i)
  const note = await page.locator('.nostr-privacy-note').textContent()
  expect(note).toMatch(/remote signer/i)
  expect(note).toMatch(/Amber, nsec\.app/)
})

test('closing the modal cancels pairing — no dangling QR on reopen', async ({ page }) => {
  await openModal(page)
  await page.locator('.nostr-method-card', { hasText: 'Remote signer' }).click()
  await page.locator('.nostr-qr-btn').click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  await page.keyboard.press('Escape')
  await expect(page.locator('.nostr-modal')).toHaveCount(0)

  await page.getByRole('button', { name: /Login via Nostr/i }).click()
  await page.locator('.nostr-method-card', { hasText: 'Remote signer' }).click()
  await expect(page.locator('.nostr-qr-wrap')).toHaveCount(0)
  await expect(page.locator('.nostr-qr-btn')).toHaveText('Show pairing QR')
})

test('bunker:// paste flow still shows the input + Connect wiring', async ({ page }) => {
  await openModal(page)
  await page.locator('.nostr-method-card', { hasText: 'Remote signer' }).click()
  const connect = page.getByRole('button', { name: /Connect/i })
  await expect(connect).toBeDisabled() // empty input
  await page.locator('.nostr-nsec-input').fill('bunker://abc123?relay=wss://x')
  await expect(connect).toBeEnabled()
})
