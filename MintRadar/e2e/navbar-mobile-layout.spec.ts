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

    test('logged in: logo + account chip on one row, links below', async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await loginAs(page, 'satoshinakamoto_longhandle_2009') // worst case for width
      await page.goto('/')
      await page.waitForSelector('.navbar-profile')

      await sameRow(page, '.nav-logo', '.navbar-auth')
      // Two-row layout: the chip is avatar + chevron only (name lives in the account panel)
      await expect(page.locator('.navbar-username')).toBeHidden()
      await expect(page.locator('.navbar-profile .navbar-chevron')).toBeVisible()
      await expect(page.locator('.navbar-profile')).toHaveAttribute('aria-label', /^Account: /)
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

// All six links stay on ONE row on phones (no lone "Learn" on a second row), also logged in with
// the Watchlist count badge (which only renders for a logged-in user with watched mints). The badge
// is injected into the DOM with a 3-digit count as the worst case.
for (const width of [360, 375, 390, 412, 430]) {
  test(`tab links stay on one row at ${width}px, logged in with a Watchlist badge`, async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page)
    await page.setViewportSize({ width, height: 780 })
    await page.goto('/')
    await page.waitForSelector('.navbar-profile')
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => {
      const a = document.querySelector('a[href="/watchlist"]')!
      const s = document.createElement('span')
      s.className = 'nav-tab-badge'
      s.textContent = '123'
      a.appendChild(s)
    })
    const tops = await page.locator('.navbar-tabs a').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)))
    expect(tops).toHaveLength(6)
    expect(new Set(tops).size).toBe(1)
  })
}
