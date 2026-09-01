import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// Mobile navbar: row 1 = logo (left) + auth section (right, same row);
// row 2+ = the nav links. Matches the cashumints.space pattern. Desktop
// layout is unchanged.

type Page = import('@playwright/test').Page

async function sameRow(page: Page, a: string, b: string, tol = 20) {
  const ba = await page.locator(a).boundingBox()
  const bb = await page.locator(b).boundingBox()
  expect(ba && bb).toBeTruthy()
  expect(Math.abs(ba!.y - bb!.y)).toBeLessThan(tol)
}

async function noHorizontalOverflow(page: Page, width: number) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(w).toBeLessThanOrEqual(width)
}

for (const width of [375, 390]) {
  test.describe(`mobile ${width}px`, () => {
    test.use({ viewport: { width, height: 780 }, hasTouch: true, isMobile: true })

    test('logged out: logo + Login CTA on one row, links below', async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await page.goto('/')

      await sameRow(page, '.nav-logo', '.navbar-auth')
      await expect(page.locator('.navbar-login-btn')).toBeVisible()
      // links wrap onto a lower row
      const auth = await page.locator('.navbar-auth').boundingBox()
      const tabs = await page.locator('.navbar-tabs').boundingBox()
      expect(tabs!.y).toBeGreaterThan(auth!.y + 5)
      await noHorizontalOverflow(page, width)

      await page.locator('.navbar-inner').screenshot({ path: `test-results/navbar-out-${width}.png` })
    })

    test('logged in: logo + profile chip + icon logout on one row, links below', async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await loginAs(page, 'satoshinakamoto_longhandle_2009') // worst case for width
      await page.goto('/')
      await page.waitForSelector('.navbar-profile')

      await sameRow(page, '.nav-logo', '.navbar-auth')
      // "Disconnect" word is dropped on mobile, the glyph shows, button still named
      await expect(page.locator('.navbar-disconnect-label')).toBeHidden()
      await expect(page.locator('.navbar-disconnect-btn svg')).toBeVisible()
      await expect(page.locator('.navbar-disconnect-btn')).toHaveAttribute('aria-label', 'Disconnect')
      // long display name is clipped, not overflowing
      await noHorizontalOverflow(page, width)

      const tabs = await page.locator('.navbar-tabs').boundingBox()
      const auth = await page.locator('.navbar-auth').boundingBox()
      expect(tabs!.y).toBeGreaterThan(auth!.y + 5)

      await page.locator('.navbar-inner').screenshot({ path: `test-results/navbar-in-${width}.png` })
    })
  })
}

test.describe('desktop unchanged', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('single row, "Disconnect" text kept, no logout glyph', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page, 'peter.bliznak')
    await page.goto('/')
    await page.waitForSelector('.navbar-profile')

    await sameRow(page, '.nav-logo', '.navbar-tabs', 10)
    await sameRow(page, '.nav-logo', '.navbar-auth', 10)
    await expect(page.locator('.navbar-disconnect-label')).toBeVisible()
    await expect(page.locator('.navbar-disconnect-btn svg')).toBeHidden()
  })
})
