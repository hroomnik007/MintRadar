import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// Software in Use → SoftwareModal drill-down (version list → mint list).
// Replaced the inline accordion that used to expand inside the panel; these
// tests pin the two levels, the back step, and that closing works from either
// level. Fixture data yields one software (Nutshell) with 3 online mints on
// versions 0.20.0 / 0.16.0 / 0.15.0 (see e2e/fixtures/mocks.ts).

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/stats')
  await expect(page.getByText('Software in Use')).toBeVisible()
})

const swRow = (page: import('@playwright/test').Page) => page.locator('.sw-row', { hasText: 'Nutshell' })
const modal = (page: import('@playwright/test').Page) => page.locator('.nut-modal')

test('clicking a software row opens the version list in a modal', async ({ page }) => {
  await expect(modal(page)).toHaveCount(0)

  await swRow(page).click()

  await expect(modal(page)).toBeVisible()
  await expect(modal(page).locator('.nut-modal-title')).toHaveText('Nutshell')
  await expect(modal(page).getByText('3 versions')).toBeVisible()

  // All three versions, each with its freshness badge
  for (const v of ['0.20.0', '0.16.0', '0.15.0']) {
    await expect(modal(page).locator('.nut-modal-row', { hasText: v })).toBeVisible()
  }
  await expect(modal(page).locator('.sw-badge').first()).toHaveText('latest')
})

test('clicking a version drills down to the mint list in the same modal', async ({ page }) => {
  await swRow(page).click()
  await modal(page).locator('.nut-modal-row', { hasText: '0.20.0' }).click()

  // Still exactly one modal — drill-down, not a second modal stacked on top
  await expect(modal(page)).toHaveCount(1)
  await expect(modal(page).locator('.nut-modal-title')).toHaveText('Nutshell 0.20.0')
  await expect(modal(page).getByText('1 mint', { exact: true })).toBeVisible()
  await expect(modal(page).getByText('Delta Mint')).toBeVisible()
  await expect(modal(page).getByText('Sorted by Trust Score')).toBeVisible()
  await expect(modal(page).getByText('1 online · 0 offline')).toBeVisible()
})

test('back button returns to the version list without closing the modal', async ({ page }) => {
  await swRow(page).click()
  await modal(page).locator('.nut-modal-row', { hasText: '0.16.0' }).click()
  await expect(modal(page).locator('.nut-modal-title')).toHaveText('Nutshell 0.16.0')

  await modal(page).locator('.nut-modal-back').click()

  await expect(modal(page)).toBeVisible()
  await expect(modal(page).locator('.nut-modal-title')).toHaveText('Nutshell')
  await expect(modal(page).getByText('3 versions')).toBeVisible()
  await expect(modal(page).locator('.nut-modal-back')).toHaveCount(0)
})

test('closes from the version-list level', async ({ page }) => {
  await swRow(page).click()
  await expect(modal(page)).toBeVisible()

  await modal(page).locator('.nut-modal-close').click()
  await expect(modal(page)).toHaveCount(0)
})

test('closes from the mint-list level, from both ✕ and overlay click', async ({ page }) => {
  // ✕ while drilled down
  await swRow(page).click()
  await modal(page).locator('.nut-modal-row', { hasText: '0.20.0' }).click()
  await expect(modal(page).locator('.nut-modal-title')).toHaveText('Nutshell 0.20.0')
  await modal(page).locator('.nut-modal-close').click()
  await expect(modal(page)).toHaveCount(0)

  // Overlay click while drilled down
  await swRow(page).click()
  await modal(page).locator('.nut-modal-row', { hasText: '0.20.0' }).click()
  await expect(modal(page).locator('.nut-modal-title')).toHaveText('Nutshell 0.20.0')
  await page.locator('.nut-modal-overlay').click({ position: { x: 5, y: 5 } })
  await expect(modal(page)).toHaveCount(0)
})

test('reopening after a drill-down starts back at the version list', async ({ page }) => {
  await swRow(page).click()
  await modal(page).locator('.nut-modal-row', { hasText: '0.20.0' }).click()
  await modal(page).locator('.nut-modal-close').click()

  await swRow(page).click()
  await expect(modal(page).locator('.nut-modal-title')).toHaveText('Nutshell')
})

test('the Software in Use panel height is unaffected by opening the modal', async ({ page }) => {
  const panel = page.locator('.stats-panel', { hasText: 'Software in Use' }).first()
  const before = (await panel.boundingBox())!.height

  await swRow(page).click()
  await expect(modal(page)).toBeVisible()
  const whileOpen = (await panel.boundingBox())!.height

  await modal(page).locator('.nut-modal-close').click()
  await expect(modal(page)).toHaveCount(0)
  const after = (await panel.boundingBox())!.height

  expect(whileOpen).toBe(before)
  expect(after).toBe(before)
})
