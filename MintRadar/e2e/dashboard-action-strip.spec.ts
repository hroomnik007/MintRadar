import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Dashboard newcomer action strip', () => {
  test('desktop shows three actions', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    const strip = page.locator('.dash-actions')
    await expect(strip.locator('.dash-action')).toHaveCount(3)
    await expect(strip.getByRole('button', { name: 'Browse mints' })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Help me pick' })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'I have a token' })).toBeVisible()
  })

  test('mobile hides Browse mints, keeps the other two', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await expect(page.getByRole('button', { name: 'Browse mints' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Help me pick' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'I have a token' })).toBeVisible()
  })

  test('Help me pick lands on /tools#pick with the wizard in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await page.getByRole('button', { name: 'Help me pick' }).click()
    await expect(page).toHaveURL(/\/tools#pick$/)

    const wizard = page.locator('#pick')
    await expect(wizard.getByText('Best Mint for Me')).toBeInViewport()
  })

  test('I have a token lands on /tools#token with the inspector in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await page.getByRole('button', { name: 'I have a token' }).click()
    await expect(page).toHaveURL(/\/tools#token$/)

    const inspector = page.locator('#token')
    await expect(inspector.getByText('Token Inspector')).toBeInViewport()
  })
})
