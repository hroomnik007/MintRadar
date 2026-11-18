import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// Mobile navbar (2026-11-18 redesign, phase 2): row 1 = logo (left), the menu button and the auth section (right);
// the page links are a menu under the bar, opened by the menu button. Desktop layout: one row (below).

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

for (const width of [320, 375, 390]) {
  test.describe(`mobile ${width}px`, () => {
    test.use({ viewport: { width, height: 780 }, hasTouch: true, isMobile: true })

    test('logged out: logo, menu button and Log in on one row; the links are behind the menu', async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await page.goto('/')

      const menu = page.getByRole('button', { name: 'Menu' })
      await sameRow(page, '.nav-logo', '.navbar-auth')
      await sameRow(page, '.nav-logo', '.navbar-menu-btn')
      await expect(page.locator('.navbar-login-btn')).toBeVisible()
      await expect(menu).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('.navbar-tabs')).toBeHidden()
      await noHorizontalOverflow(page, width)

      // Open: six links, one per row, under the bar; the current page in copper.
      await menu.tap()
      const close = page.getByRole('button', { name: 'Close menu' })
      await expect(close).toHaveAttribute('aria-expanded', 'true')
      const links = page.locator('.navbar-tabs a')
      await expect(links).toHaveText(['Mints', 'Watchlist', 'Stats', 'Tools', 'Wallets', 'Learn'])
      const boxes = await links.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { top: r.top, h: r.height } }))
      const auth = (await page.locator('.navbar-auth').boundingBox())!
      expect(boxes[0]!.top).toBeGreaterThan(auth.y + auth.height - 1)
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.top).toBeGreaterThan(boxes[i - 1]!.top + 30)
      for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(44)
      await expect(links.first()).toHaveClass(/active/)
      await noHorizontalOverflow(page, width)
      await page.locator('.navbar-inner').screenshot({ path: `test-results/navbar-out-${width}.png` })

      // A link opens its page and closes the menu.
      await page.getByRole('link', { name: 'Stats', exact: true }).tap()
      await expect(page).toHaveURL(/\/stats$/)
      await expect(page.locator('.navbar-tabs')).toBeHidden()
      await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false')
    })

    test('logged in: logo, menu button and account chip on one row', async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await loginAs(page, 'satoshinakamoto_longhandle_2009') // worst case for width
      await page.goto('/')
      await page.waitForSelector('.navbar-profile')

      await sameRow(page, '.nav-logo', '.navbar-auth')
      await sameRow(page, '.nav-logo', '.navbar-menu-btn')
      // The chip is avatar + chevron only (the name lives in the account panel)
      await expect(page.locator('.navbar-username')).toBeHidden()
      await expect(page.locator('.navbar-profile .navbar-chevron')).toBeVisible()
      await expect(page.locator('.navbar-profile')).toHaveAttribute('aria-label', /^Account: /)
      await noHorizontalOverflow(page, width)
      await page.locator('.navbar-inner').screenshot({ path: `test-results/navbar-in-${width}.png` })
    })
  })
}

test('phone menu: Escape closes it and gives the focus back, a tap outside closes it', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 390, height: 780 })
  await page.goto('/')
  const menu = page.locator('.navbar-menu-btn')
  await menu.click()
  await expect(page.locator('.navbar-tabs')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.navbar-tabs')).toBeHidden()
  await expect(menu).toBeFocused()
  await menu.click()
  await expect(page.locator('.navbar-tabs')).toBeVisible()
  await page.mouse.click(200, 700)
  await expect(page.locator('.navbar-tabs')).toBeHidden()
})

test.describe('desktop unchanged', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('single row, chip shows avatar + name + chevron', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page, 'peter.bliznak')
    await page.goto('/')
    await page.waitForSelector('.navbar-profile')

    await sameRow(page, '.nav-logo', '.navbar-tabs', 10)
    await sameRow(page, '.nav-logo', '.navbar-auth', 10)
    await expect(page.locator('.navbar-username')).toBeVisible()
    await expect(page.locator('.navbar-profile .navbar-chevron')).toBeVisible()
  })
})
