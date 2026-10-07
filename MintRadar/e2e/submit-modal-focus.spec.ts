import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// Submit modal focus: initial focus on the field (not the dialog container), focus returned to the
// .submit-btn that opened it on every closing route, deliberate focus moves when switching Single <-> Bulk.
// Regression: the inputs had autoFocus, so useModalFocus recorded the INPUT as the element to restore and
// focus ended on <body> after closing.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/discover', r => r.fulfill({ json: { added: 1, total: 1, results: [{ url: 'https://new.mint.example', success: true, isNew: true }] } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.mint-card').first()).toBeVisible()
})

async function openModal(page: Page) {
  await page.locator('.submit-btn').focus()
  await page.locator('.submit-btn').click()
  await expect(page.locator('.submit-modal')).toBeVisible()
}

test('initial focus is on the Single input, not the dialog container', async ({ page }) => {
  await openModal(page)
  await expect(page.locator('.submit-modal-input')).toBeFocused()
})

test('switching to Bulk focuses the textarea, switching back focuses the input', async ({ page }) => {
  await openModal(page)
  await page.locator('.submit-tab-btn', { hasText: 'Bulk' }).click()
  await expect(page.locator('.bulk-textarea')).toBeFocused()
  await page.locator('.submit-tab-btn', { hasText: 'Single' }).click()
  await expect(page.locator('.submit-modal-input')).toBeFocused()
})

for (const mode of ['single', 'bulk'] as const) {
  const closers: [string, (p: Page) => Promise<void>][] = [
    ['Escape', p => p.keyboard.press('Escape')],
    ['the close button', p => p.locator('.submit-modal-close').click()],
    ['Cancel', p => p.locator('.submit-cancel-btn').click()],
    ['a click outside', p => p.locator('.submit-modal-overlay').click({ position: { x: 5, y: 5 } })],
    ['Close after a successful submit', async p => {
      if (mode === 'single') {
        await p.locator('.submit-modal-input').fill('https://new.mint.example')
        await p.locator('.submit-ok-btn:not([aria-disabled="true"])').click()
      } else {
        await p.locator('.bulk-textarea').fill('https://new.mint.example')
        await p.locator('.submit-ok-btn', { hasText: /^Add \d+ mints?$/ }).click()
      }
      await p.locator('.submit-ok-btn', { hasText: 'Close' }).click()
    }],
  ]
  for (const [name, close] of closers) {
    test(`${mode}: focus returns to the Submit button after ${name}`, async ({ page }) => {
      await openModal(page)
      if (mode === 'bulk') await page.locator('.submit-tab-btn', { hasText: 'Bulk' }).click()
      await close(page)
      await expect(page.locator('.submit-modal')).toHaveCount(0)
      await expect(page.locator('.submit-btn')).toBeFocused()
    })
  }
}
