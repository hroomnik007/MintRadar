// M5 (UI/UX report 2026-11-22): a Mint Detail link with a tab hash (#reviews, #audit …) on a phone, where the tabs sit
// at the bottom edge of the first screen, scrolls the tabs up under the navbar once the tab has loaded, so its content
// is on screen. A desktop (tabs in the first screen), a plain link and #overview stay at the top, and any input before
// the scroll cancels it.
import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

const URL = `/mint/${encodeURIComponent('https://alpha.mint.example')}`

for (const [w, h] of [[390, 844], [390, 700], [320, 640]] as const) {
  test(`${w}x${h}: #reviews puts the tabs right under the navbar`, async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.setViewportSize({ width: w, height: h })
    await page.goto(`${URL}#reviews`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    const navH = await page.locator('.navbar').evaluate(e => e.getBoundingClientRect().height)
    await expect.poll(async () => (await page.locator('.md-tabs').boundingBox())!.y).toBeGreaterThanOrEqual(navH - 1)
    // Under the navbar in the upper third — or, when the page below is too short to scroll that far, scrolled to the end.
    await expect.poll(async () => {
      const top = (await page.locator('.md-tabs').boundingBox())!.y
      const atEnd = await page.evaluate(() => Math.abs(window.scrollY - (document.documentElement.scrollHeight - window.innerHeight)) <= 1 && window.scrollY > 0)
      return top <= navH + h / 3 + 1 || atEnd
    }).toBe(true)
  })
}

test('no hash: the page stays at the top', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(URL)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('1440px: the tabs are in the first screen already, nothing scrolls', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${URL}#reviews`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await expect(page.getByRole('tab', { name: /Reviews/ })).toHaveAttribute('aria-selected', 'true')
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})

test('390px: a touch before the scroll cancels it (the page never moves under the visitor)', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${URL}#reviews`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  // In the same task as the tabs showing: before the 250 ms quiet wait can end.
  await page.evaluate(() => window.dispatchEvent(new Event('pointerdown')))
  await page.waitForTimeout(800)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
})
