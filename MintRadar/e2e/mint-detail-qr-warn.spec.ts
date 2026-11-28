import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Mint QR (owner, 2026-11-28, Q4): one amber sentence above the code only for a test mint or a mint that did not answer
// its last check; a healthy mint gets nothing extra.

const TESTNUT = 'https://testnut.cashu.space'

async function openQr(page: Page, url: string) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: [...MOCK_KNOWN_MINTS, { ...MOCK_KNOWN_MINTS[0]!, url: TESTNUT, name: 'Testnut' }] }))
  await page.goto(`/mint/${encodeURIComponent(url)}`)
  await page.locator('.md-quick-btn', { hasText: 'Mint QR' }).click()
  await expect(page.getByRole('dialog', { name: /Add to wallet/ })).toBeVisible()
}

test('a healthy mint: no sentence above the code', async ({ page }) => {
  await openQr(page, 'https://alpha.mint.example')
  await expect(page.locator('.qr-modal-code-frame svg')).toBeVisible()
  await expect(page.getByTestId('qr-modal-warn')).toHaveCount(0)
})

test('a test mint: "Test mint: its ecash has no value." above the code', async ({ page }) => {
  await openQr(page, TESTNUT)
  const warn = page.getByTestId('qr-modal-warn')
  await expect(warn).toHaveText('Test mint: its ecash has no value.')
  const order = await page.evaluate(() => {
    const w = document.querySelector('.qr-modal-warn')!.getBoundingClientRect()
    const c = document.querySelector('.qr-modal-code')!.getBoundingClientRect()
    return w.bottom <= c.top
  })
  expect(order, 'the sentence is above the code').toBe(true)
})

test('a mint that did not answer its last check: the offline sentence', async ({ page }) => {
  await openQr(page, 'https://charlie.mint.example')
  await expect(page.getByTestId('qr-modal-warn')).toHaveText('This mint did not answer its last check.')
})
