import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Dashboard newcomer action strip', () => {
  // Since the 2026-11-19 redesign the row holds the status box and the two actions (the "We score how it runs…"
  // explainer is gone: the page description says what the page is for).
  test('desktop: the status box and the two actions share one row above the search bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    const strip = page.locator('.dash-actions')
    await expect(strip.locator('.dash-action')).toHaveCount(2)
    await expect(strip.getByRole('button', { name: 'Find a mint' })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Inspect a token' })).toBeVisible()
    await expect(page.locator('.grid-score-explainer')).toHaveCount(0)

    const chipsBox = await strip.boundingBox()
    const statusBox = await page.locator('.dash-status').boundingBox()
    const searchBox = await page.getByPlaceholder(/Search mints/).boundingBox()
    if (!chipsBox || !statusBox || !searchBox) throw new Error('missing layout boxes')

    // status and actions on the same row (vertical overlap), the actions to the right
    expect(statusBox.y).toBeLessThan(chipsBox.y + chipsBox.height)
    expect(chipsBox.y).toBeLessThan(statusBox.y + statusBox.height)
    expect(chipsBox.x).toBeGreaterThan(statusBox.x + statusBox.width - 1)
    // the whole row is above the search bar
    expect(chipsBox.y + chipsBox.height).toBeLessThanOrEqual(searchBox.y + 1)
    expect(statusBox.y + statusBox.height).toBeLessThanOrEqual(searchBox.y + 1)
  })

  test('mobile: the two actions sit side by side below the status box', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    const pick = page.getByRole('button', { name: 'Find a mint' })
    const token = page.getByRole('button', { name: 'Inspect a token' })
    await expect(pick).toBeVisible()
    await expect(token).toBeVisible()

    const pickBox = await pick.boundingBox()
    const tokenBox = await token.boundingBox()
    const statusBox = await page.locator('.dash-status').boundingBox()
    const searchBox = await page.getByPlaceholder(/Search mints/).boundingBox()
    if (!pickBox || !tokenBox || !statusBox || !searchBox) throw new Error('missing layout boxes')

    // two actions side by side
    expect(tokenBox.x).toBeGreaterThan(pickBox.x + pickBox.width - 1)
    expect(Math.abs(pickBox.y - tokenBox.y)).toBeLessThan(2)
    // below the status box, above the search
    expect(pickBox.y).toBeGreaterThan(statusBox.y + statusBox.height - 1)
    expect(pickBox.y + pickBox.height).toBeLessThanOrEqual(searchBox.y + 1)
  })

  test('Find a mint lands on /tools#pick with the wizard in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await page.getByRole('button', { name: 'Find a mint' }).click()
    await expect(page).toHaveURL(/\/tools#pick$/)

    await expect(page.locator('#pick').getByText('Find a mint for me')).toBeInViewport()
  })

  test('Inspect a token lands on /tools#token with the inspector in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await page.getByRole('button', { name: 'Inspect a token' }).click()
    await expect(page).toHaveURL(/\/tools#token$/)

    await expect(page.locator('#token').getByText('Token Inspector')).toBeInViewport()
  })
})
