import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// Three layout fixes (CLAUDE.md, "Layout overflow fixes (2026-09-30)"):
//  1. Dashboard toolbar: .submit-btn pushed the page sideways at 901–990px (row needs 991px on one line).
//  2. Dashboard .sort-segment: 351px minimum width overflowed at ≤360px.
//  3. Navbar: a long display name is clamped with an ellipsis from 641px up.

async function overflow(page: Page) {
  await page.evaluate(() => document.fonts.ready) // text widths settle once the webfonts are in
  return page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
}

async function openDashboard(page: Page, width: number, opts: { loggedIn: boolean; view?: 'cards' | 'list'; name?: string }) {
  await mockRelays(page)
  await installApiMocks(page)
  if (opts.loggedIn) await loginAs(page, opts.name)
  await page.addInitScript(v => localStorage.setItem('mintRadar_viewMode', v), opts.view ?? 'cards')
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/')
  await expect(page.locator('.dashboard-controls')).toBeVisible()
  await expect(page.locator('.navbar-inner')).toBeVisible()
}

for (const width of [360, 950, 990]) {
  for (const view of ['cards', 'list'] as const) {
    for (const loggedIn of [false, true]) {
      test(`Dashboard: no horizontal overflow at ${width}px, ${view} view, ${loggedIn ? 'logged in' : 'logged out'}`, async ({ page }) => {
        await openDashboard(page, width, { loggedIn, view })
        const de = await overflow(page)
        expect(de.sw).toBeLessThanOrEqual(de.cw)
        // The Submit button stays in the toolbar, fully inside the viewport.
        const box = await page.locator('.submit-btn').boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      })
    }
  }
}

test('Dashboard: Filters panel open does not add overflow at 950px', async ({ page }) => {
  await openDashboard(page, 950, { loggedIn: false })
  await page.locator('.filter-btn').click()
  await expect(page.locator('.filter-panel')).toBeVisible()
  const de = await overflow(page)
  expect(de.sw).toBeLessThanOrEqual(de.cw)
})

for (const width of [320, 340, 360]) {
  test(`Dashboard: no overflow at ${width}px and every sort option is reachable`, async ({ page }) => {
    await openDashboard(page, width, { loggedIn: false })
    const de = await overflow(page)
    expect(de.sw).toBeLessThanOrEqual(de.cw)
    const buttons = page.locator('.sort-btn')
    await expect(buttons).toHaveCount(5)
    // The active option is scrolled into view inside the segment (the default, "Reliability Score", is the last).
    const active = await page.locator('.sort-btn.active').boundingBox()
    expect(active!.x).toBeGreaterThanOrEqual(0)
    expect(active!.x + active!.width).toBeLessThanOrEqual(width)
    // Each option can be scrolled to and clicked, and becomes the active one.
    for (const i of [0, 1, 2, 3, 4]) {
      const b = buttons.nth(i)
      await b.scrollIntoViewIfNeeded()
      const box = await b.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      await b.click()
      await expect(b).toHaveClass(/active/)
    }
    const after = await overflow(page)
    expect(after.sw).toBeLessThanOrEqual(after.cw)
  })
}

const LONG_NAME = 'Q'.repeat(80)

for (const width of [641, 700, 806, 807, 850, 902, 903, 950, 996, 997, 1100, 1280, 1440]) {
  test(`Navbar: 80-character display name stays on one row without overflow at ${width}px`, async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page, LONG_NAME)
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/tools')
    await expect(page.locator('.navbar-auth')).toBeVisible()
    const de = await overflow(page)
    expect(de.sw).toBeLessThanOrEqual(de.cw)
    const h = await page.locator('.navbar-inner').evaluate(e => e.getBoundingClientRect().height)
    expect(h).toBeLessThanOrEqual(56)
    // Full name stays available: on the chip everywhere, on the name element itself once it is shown (≥807px).
    await expect(page.locator('.navbar-profile')).toHaveAttribute('title', LONG_NAME)
    if (width >= 807) {
      const name = page.locator('.navbar-username')
      await expect(name).toHaveAttribute('title', LONG_NAME)
      const m = await name.evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth, ov: getComputedStyle(e).textOverflow, ws: getComputedStyle(e).whiteSpace }))
      expect(m.sw).toBeGreaterThan(m.cw) // truncated
      expect(m.ov).toBe('ellipsis')
      expect(m.ws).toBe('nowrap')
    }
  })
}

test('Navbar: a normal display name is not truncated at 1280px', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await loginAs(page, 'E2E Tester')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/tools')
  const name = page.locator('.navbar-username')
  await expect(name).toHaveText('E2E Tester')
  const m = await name.evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  expect(m.sw).toBeLessThanOrEqual(m.cw)
})
