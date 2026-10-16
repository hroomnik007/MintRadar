import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS } from './fixtures/mocks'

// Mint Detail header: Back is visually first and the watch star sits in the top-right corner. The DOM order is the
// visual order, so Tab visits Back before the star (F20); the corner position itself is CSS (absolute).

const DETAIL = `/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }] as const

async function open(page: Page, loggedIn: boolean) {
  await mockRelays(page)
  await installApiMocks(page)
  if (loggedIn) await loginAs(page)
  await page.goto(DETAIL)
  await expect(page.locator('.md-tabs')).toBeVisible()
}

for (const vp of VIEWPORTS) {
  for (const loggedIn of [false, true]) {
    test(`${vp.width}px, ${loggedIn ? 'logged in' : 'logged out'}: Tab visits Back, then the star; Back stays left of the star`, async ({ page }) => {
      await page.setViewportSize(vp)
      await open(page, loggedIn)

      const header = page.locator('.md-header')
      const back = header.getByRole('button', { name: 'Back' })
      const star = header.locator('.md-watch-star-hero')
      await expect(back).toBeVisible()
      await expect(star).toBeVisible()

      // Sequential focus starts at the top-left padding of the header; the next two Tab stops are Back and the star.
      await header.click({ position: { x: 2, y: 2 } })
      await page.keyboard.press('Tab')
      await expect(back).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(star).toBeFocused()

      // Visual order unchanged: Back at the left edge, the star in the right-hand corner, level with or above the name row.
      const [h, b, s] = await Promise.all([header.boundingBox(), back.boundingBox(), star.boundingBox()])
      expect(b!.x, 'Back is left of the star').toBeLessThan(s!.x)
      expect(b!.x - h!.x, 'Back near the left edge').toBeLessThan(40)
      expect(h!.x + h!.width - (s!.x + s!.width), 'star near the right edge').toBeLessThan(40)
      expect(b!.y, 'Back is not below the star row').toBeLessThanOrEqual(s!.y + s!.height)
    })
  }
}
