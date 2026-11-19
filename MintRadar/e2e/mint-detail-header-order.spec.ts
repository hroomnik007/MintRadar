import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS } from './fixtures/mocks'

// Mint Detail header: Back is visually first; since the 2026-11-19 redesign the watch star sits right after the mint name
// and its state (owner, 2026-11-18), no longer in the top-right corner. Tab visits Back before the star (F20).

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
    test(`${vp.width}px, ${loggedIn ? 'logged in' : 'logged out'}: Tab visits Back, then the star; the star follows the name and state`, async ({ page }) => {
      await page.setViewportSize(vp)
      await open(page, loggedIn)

      const header = page.locator('.md-header')
      const back = header.getByRole('button', { name: 'Back' })
      const star = header.locator('.md-dh-star')
      await expect(back).toBeVisible()
      await expect(star).toBeVisible()

      // Back is the header's first control (the header has no padding to click into since the redesign); the next Tab stop is the star.
      const first = await header.evaluate(h => h.querySelector('button, a, [tabindex]')?.getAttribute('aria-label'))
      expect(first).toBe('Back')
      await back.focus()
      await expect(back).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(star).toBeFocused()

      // Back above the name row at the left edge; the star on the name row, right after the state word.
      const name = header.locator('.md-name-h1'), state = header.locator('.md-status-inline')
      const [h, b, s, n, st] = await Promise.all([header.boundingBox(), back.boundingBox(), star.boundingBox(), name.boundingBox(), state.boundingBox()])
      expect(b!.x - h!.x, 'Back near the left edge').toBeLessThan(4)
      expect(b!.y + b!.height, 'Back above the name').toBeLessThanOrEqual(n!.y + 1)
      expect(s!.x, 'star after the state word').toBeGreaterThan(st!.x + st!.width - 1)
      expect(s!.x - (st!.x + st!.width), 'star right next to the state word').toBeLessThan(24)
      expect(Math.abs((s!.y + s!.height / 2) - (st!.y + st!.height / 2)), 'star on the state row').toBeLessThan(6)
    })
  }
}
