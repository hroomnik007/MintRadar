import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Dashboard newcomer action strip', () => {
  test('desktop: three chips and the explainer share one row above the search bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    const strip = page.locator('.dash-actions')
    await expect(strip.locator('.dash-action')).toHaveCount(3)
    await expect(strip.getByRole('button', { name: 'Browse mints' })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Help me pick' })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'I have a token' })).toBeVisible()

    const explainer = page.locator('.grid-score-explainer')
    await expect(explainer).toHaveText('We score how it runs. They score how it went. You pick.')

    const chipsBox = await strip.boundingBox()
    const explBox = await explainer.boundingBox()
    const searchBox = await page.getByPlaceholder(/Search mints/).boundingBox()
    if (!chipsBox || !explBox || !searchBox) throw new Error('missing layout boxes')

    // chips and explainer on the same row (vertical overlap)
    expect(explBox.y).toBeLessThan(chipsBox.y + chipsBox.height)
    expect(chipsBox.y).toBeLessThan(explBox.y + explBox.height)
    // explainer sits to the right of the chips
    expect(explBox.x).toBeGreaterThan(chipsBox.x + chipsBox.width - 1)
    // the whole block is above the search bar
    expect(chipsBox.y + chipsBox.height).toBeLessThanOrEqual(searchBox.y + 1)
    expect(explBox.y + explBox.height).toBeLessThanOrEqual(searchBox.y + 1)

    // full sentence visible — not truncated
    const overflow = await explainer.evaluate((el: HTMLElement) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('mobile: no Browse mints; explainer sits full-width below the two chips', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await expect(page.getByRole('button', { name: 'Browse mints' })).toBeHidden()
    const pick = page.getByRole('button', { name: 'Help me pick' })
    const token = page.getByRole('button', { name: 'I have a token' })
    await expect(pick).toBeVisible()
    await expect(token).toBeVisible()

    const pickBox = await pick.boundingBox()
    const tokenBox = await token.boundingBox()
    const explBox = await page.locator('.grid-score-explainer').boundingBox()
    const searchBox = await page.getByPlaceholder(/Search mints/).boundingBox()
    if (!pickBox || !tokenBox || !explBox || !searchBox) throw new Error('missing layout boxes')

    // two chips side by side
    expect(tokenBox.x).toBeGreaterThan(pickBox.x + pickBox.width - 1)
    expect(Math.abs(pickBox.y - tokenBox.y)).toBeLessThan(2)
    // explainer on its own row below both chips
    expect(explBox.y).toBeGreaterThan(pickBox.y + pickBox.height - 1)
    // search still below the intro block
    expect(explBox.y).toBeLessThan(searchBox.y)
  })

  test('Help me pick lands on /tools#pick with the wizard in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await page.getByRole('button', { name: 'Help me pick' }).click()
    await expect(page).toHaveURL(/\/tools#pick$/)

    await expect(page.locator('#pick').getByText('Best Mint for Me')).toBeInViewport()
  })

  test('I have a token lands on /tools#token with the inspector in view', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await page.getByRole('button', { name: 'I have a token' }).click()
    await expect(page).toHaveURL(/\/tools#token$/)

    await expect(page.locator('#token').getByText('Token Inspector')).toBeInViewport()
  })
})
