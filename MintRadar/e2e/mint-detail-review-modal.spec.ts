import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS } from './fixtures/mocks'

const ALPHA = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`

const METHODS = [
  { method: 'nip07', badge: 'Extension' },
  { method: 'nsec', badge: 'nsec' },
  { method: 'remote-signer', badge: 'Remote signer' },
] as const

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

async function openModal(page: Page, method: (typeof METHODS)[number]['method']): Promise<void> {
  await loginAs(page, 'peter.bliznak', method)
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-tab', { hasText: 'Reviews' }).click()
  await page.locator('.reviews-write-btn').click()
  await expect(page.locator('.rv-modal')).toBeVisible()
}

test.describe('Write-a-review modal — phase 1 (rating only)', () => {
  test('shows only the star row + "Choose a rating", no form', async ({ page }) => {
    await openModal(page, 'nip07')

    await expect(page.locator('.rv-star')).toHaveCount(5)
    await expect(page.locator('.rv-rate-label')).toHaveText('Choose a rating')

    // Nothing from phase 2 is mounted yet.
    await expect(page.locator('.rv-signer')).toHaveCount(0)
    await expect(page.locator('.rv-textarea')).toHaveCount(0)
    await expect(page.locator('.rv-btn-submit')).toHaveCount(0)
    await expect(page.locator('.rv-btn-cancel')).toHaveCount(0)
    await expect(page.locator('.rv-permanence-note')).toHaveCount(0)

    await page.locator('.rv-modal').screenshot({ path: 'test-results/review-modal-phase1.png' })
  })

  test('hovering a star fills up to the pointer without committing', async ({ page }) => {
    await openModal(page, 'nip07')
    await page.locator('.rv-star').nth(2).hover()

    await expect(page.locator('.rv-star[data-filled="true"]')).toHaveCount(3)
    // Still phase 1 — hover is a preview only.
    await expect(page.locator('.rv-rate-label')).toHaveText('Choose a rating')
    await expect(page.locator('.rv-textarea')).toHaveCount(0)
  })
})

test.describe('Write-a-review modal — phase 2 (form) per login method', () => {
  for (const { method, badge } of METHODS) {
    test(`${method}: chosen rating + "Signing with ${badge}" + form`, async ({ page }) => {
      await openModal(page, method)

      await page.locator('.rv-star').nth(4).click() // 5 stars

      await expect(page.locator('.rv-rate-label')).toHaveText('5: works great')
      await expect(page.locator('.rv-star[data-filled="true"]')).toHaveCount(5)

      // The new "Signing with X" indicator.
      const signer = page.locator('.rv-signer')
      await expect(signer).toBeVisible()
      await expect(signer.locator('.rv-signer-label')).toHaveText('Signing with')
      await expect(signer.locator('.rv-signer-name')).toHaveText('peter.bliznak')
      await expect(signer.locator('.rv-signer-badge')).toHaveText(badge)

      // Form + renamed CTA + permanence note.
      await expect(page.locator('.rv-textarea')).toHaveAttribute('placeholder', 'What should other people know?')
      await expect(page.locator('.rv-btn-submit')).toHaveText('Sign and publish')
      await expect(page.locator('.rv-permanence-note')).toHaveText('Published permanently to public Nostr relays.')

      await page.locator('.rv-modal').screenshot({ path: `test-results/review-modal-phase2-${method}.png` })
    })

    test(`${method}: sign and publish succeeds and auto-closes`, async ({ page }) => {
      await openModal(page, method)
      await page.locator('.rv-star').nth(3).click() // 4 stars
      await expect(page.locator('.rv-rate-label')).toHaveText('4: solid')

      await page.locator('.rv-textarea').fill('Fast and reliable in my testing.')
      await expect(page.locator('.rv-charcount')).toHaveText('32 / 500 characters')

      await page.locator('.rv-btn-submit').click()
      await expect(page.locator('.rv-msg-success')).toHaveText('✓ Review published!')

      // Auto-close after the 1.5s success window.
      await expect(page.locator('.rv-modal')).toHaveCount(0, { timeout: 3000 })
    })
  }
})

test.describe('Write-a-review modal — rating change + close paths', () => {
  test('clicking a different star updates the label; form stays open', async ({ page }) => {
    await openModal(page, 'nip07')
    await page.locator('.rv-star').nth(4).click()
    await expect(page.locator('.rv-rate-label')).toHaveText('5: works great')

    await page.locator('.rv-star').nth(2).click()
    await expect(page.locator('.rv-rate-label')).toHaveText('3: does the job')
    await expect(page.locator('.rv-textarea')).toBeVisible()
  })

  test('Escape resets back to phase 1 on reopen', async ({ page }) => {
    await openModal(page, 'nip07')
    await page.locator('.rv-star').nth(4).click()
    await page.locator('.rv-textarea').fill('draft text')

    await page.keyboard.press('Escape')
    await expect(page.locator('.rv-modal')).toHaveCount(0)

    await page.locator('.reviews-write-btn').click()
    await expect(page.locator('.rv-rate-label')).toHaveText('Choose a rating')
    await expect(page.locator('.rv-textarea')).toHaveCount(0)
  })

  test('overlay click closes the modal', async ({ page }) => {
    await openModal(page, 'nip07')
    await page.locator('.rv-modal-overlay').click({ position: { x: 5, y: 5 } })
    await expect(page.locator('.rv-modal')).toHaveCount(0)
  })
})

test.describe('Write-a-review modal — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('both phases render on a phone viewport', async ({ page }) => {
    await openModal(page, 'remote-signer')
    await expect(page.locator('.rv-rate-label')).toHaveText('Choose a rating')
    await page.locator('.rv-modal').screenshot({ path: 'test-results/review-modal-mobile-phase1.png' })

    await page.locator('.rv-star').nth(4).click()
    await expect(page.locator('.rv-signer-badge')).toHaveText('Remote signer')
    await expect(page.locator('.rv-btn-submit')).toBeVisible()
    await expect(page.locator('.rv-btn-cancel')).toBeVisible()
    await page.locator('.rv-modal').screenshot({ path: 'test-results/review-modal-mobile-phase2.png' })
  })
})
