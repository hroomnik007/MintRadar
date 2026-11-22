// Mint card hover lift (owner, 2026-11-22, after cashu.info): 2px up with a shadow on a mouse hover; nothing on touch
// or with reduced motion.
import { test, expect } from '@playwright/test'
import { installApiMocks } from './fixtures/mocks'

const card = (page: import('@playwright/test').Page) => page.locator('.mint-card').first()
const lift = (page: import('@playwright/test').Page) => card(page).evaluate(e => getComputedStyle(e).translate)

test('a mouse hover lifts the card 2px and adds a shadow', async ({ page }) => {
  await installApiMocks(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(card(page)).toBeVisible()
  const rest = await card(page).evaluate(e => getComputedStyle(e).boxShadow)
  await card(page).locator('.card-name').hover()
  await expect.poll(() => lift(page)).toBe('0px -2px')
  expect(await card(page).evaluate(e => getComputedStyle(e).boxShadow)).not.toBe(rest)
})

test('reduced motion: no lift', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installApiMocks(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(card(page)).toBeVisible()
  await card(page).locator('.card-name').hover()
  await page.waitForTimeout(200)
  expect(await lift(page)).toBe('none')
})

test.describe('touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('no lift on a touch screen (a tapped card would stay lifted)', async ({ page }) => {
    await installApiMocks(page)
    await page.goto('/')
    await expect(card(page)).toBeVisible()
    expect(await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)).toBe(false)
    await card(page).locator('.card-name').hover() // :hover applies, the media query does not
    await page.waitForTimeout(200)
    expect(await lift(page)).toBe('none')
  })
})
