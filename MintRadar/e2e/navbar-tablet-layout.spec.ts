import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// One-row navbar between the 640px two-row breakpoint and the width where it fits naturally
// (AppShell.css, "One-row navbar between ..."). The logged-out Login button and the wider
// logged-in profile chip used to push every page past the viewport (72px at 768px).

const PAGES = [
  { name: 'Dashboard', path: '/' },
  { name: 'Tools', path: '/tools' },
  { name: 'Mint Detail', path: '/mint/alpha.mint.example' },
]

for (const loggedIn of [false, true]) {
  for (const width of [667, 768, 844]) {
    for (const { name, path } of PAGES) {
      test(`no horizontal overflow: ${name} at ${width}px, ${loggedIn ? 'logged in' : 'logged out'}`, async ({ page }) => {
        await mockRelays(page)
        await installApiMocks(page)
        if (loggedIn) await loginAs(page)
        await page.setViewportSize({ width, height: 800 })
        await page.goto(path)
        await expect(page.locator('.navbar-inner')).toBeVisible()
        await expect(page.locator('.navbar-auth')).toBeVisible()
        await page.evaluate(() => document.fonts.ready) // text widths settle once the webfonts are in
        const de = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
        expect(de.sw).toBeLessThanOrEqual(de.cw)
        // Still one row: the navbar keeps its single-row height.
        const h = await page.locator('.navbar-inner').evaluate(e => e.getBoundingClientRect().height)
        expect(h).toBeLessThanOrEqual(56)
      })
    }
  }
}

test('login button keeps the accessible name "Login via Nostr" at 768px', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 768, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Login via Nostr/ })).toBeVisible()
  await expect(page.locator('.navbar-login-btn')).toHaveAccessibleName(/Login via Nostr/)
})

test('login button shows just "Login" at 700px but keeps the name "Login via Nostr"', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 700, height: 800 })
  await page.goto('/')
  await expect(page.locator('.navbar-login-btn')).toHaveAccessibleName(/Login via Nostr/)
  const w = await page.locator('.navbar-login-btn').evaluate(e => e.getBoundingClientRect().width)
  expect(w).toBeLessThan(100) // short form; the full button is ~144px
})

test('home link keeps its name and title when the wordmark is hidden (680px)', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 680, height: 800 })
  await page.goto('/')
  await expect(page.locator('.nav-logo')).toHaveAccessibleName(/MintRadar/)
  await expect(page.locator('.nav-logo')).toHaveAttribute('title', 'MintRadar')
  const w = await page.locator('.nav-logo').evaluate(e => e.getBoundingClientRect().width)
  expect(w).toBeLessThan(40) // icon only
})
