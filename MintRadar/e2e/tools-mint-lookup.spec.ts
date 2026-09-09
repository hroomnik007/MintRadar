import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

const ALPHA = 'https://alpha.mint.example'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/tools')
  await expect(page.getByText('Look up a mint')).toBeVisible()
})

const lookup = (page: import('@playwright/test').Page) =>
  page.locator('#lookup .mint-lookup-input')

test.describe('Tools — Look up a mint', () => {
  test('empty input does nothing', async ({ page }) => {
    await page.locator('#lookup').getByRole('button', { name: 'View mint' }).click()
    await expect(page).toHaveURL(/\/tools$/)
  })

  test('a full https URL opens the tracked mint (same as typing the slug)', async ({ page }) => {
    await lookup(page).fill(ALPHA)
    await page.locator('#lookup').getByRole('button', { name: 'View mint' }).click()

    await expect(page).toHaveURL(u => u.pathname === `/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()
  })

  test('a bare host canonicalises to the tracked mint (Enter submits)', async ({ page }) => {
    await lookup(page).fill('alpha.mint.example')
    await lookup(page).press('Enter')

    await expect(page).toHaveURL(u => u.pathname === `/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()
    await expect(page.locator('.md-not-tracked')).toHaveCount(0)
  })

  test('an unknown host shows the "Not a tracked mint" state', async ({ page }) => {
    await lookup(page).fill('definitely-not-a-real-mint.example')
    await lookup(page).press('Enter')

    await expect(page.locator('.md-not-tracked')).toBeVisible()
    await expect(page.getByText('Not a tracked mint')).toBeVisible()
    await expect(page.locator('.md-tabs')).toHaveCount(0)
  })

  test('#lookup scrolls the card into view', async ({ page }) => {
    await page.goto('/tools#lookup')
    await expect(page.locator('#lookup').getByText('Look up a mint')).toBeInViewport()
  })
})
