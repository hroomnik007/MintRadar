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

for (const width of [1280, 768, 700]) {
  test(`login button shows just "Login" (no bolt) and keeps the name "Login via Nostr" at ${width}px`, async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const btn = page.locator('.navbar-login-btn')
    await expect(page.getByRole('button', { name: /Login via Nostr/ })).toBeVisible()
    await expect(btn).toHaveAccessibleName('Login via Nostr')
    expect((await btn.innerText()).trim()).toBe('Login')
    await expect(btn.locator('svg')).toHaveCount(1)
    expect(await btn.textContent()).not.toContain('⚡') // line icon (svg), not the emoji
    const w = await btn.evaluate(e => e.getBoundingClientRect().width)
    expect(w).toBeLessThan(100)
  })
}

// The navbar's inner row must share the page content's left/right edges (same
// --dash-chrome-max width and --page-pad gutter), not just stay inside the viewport.
for (const width of [1920, 1440, 1100]) {
  test(`navbar inner row edges equal the content edges at ${width}px`, async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.locator('.navbar-inner')).toBeVisible()
    await expect(page.locator('.mint-grid')).toBeVisible()
    const edges = await page.evaluate(() => {
      const inner = (sel: string) => {
        const el = document.querySelector(sel)!
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) }
      }
      return { nav: inner('.navbar-inner'), content: inner('.mint-grid') }
    })
    expect(edges.nav.left).toBeCloseTo(edges.content.left, 0)
    expect(edges.nav.right).toBeCloseTo(edges.content.right, 0)
  })
}

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

test('Login button and login modal header use a line icon (svg), no ⚡ character', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  const btn = page.locator('.navbar-login-btn')
  await expect(btn.locator('svg')).toHaveCount(1)
  expect(await btn.textContent()).not.toContain('⚡')
  await expect(btn).toHaveAccessibleName('Login via Nostr')
  await btn.click()
  const badge = page.locator('.nostr-modal-icon')
  await expect(badge.locator('svg')).toHaveCount(1)
  expect(await badge.textContent()).not.toContain('⚡')
  expect(await badge.locator('svg').evaluate(e => e.getAttribute('fill'))).toBe('none')
})

// Right-hand controls match the tab group: equal height and equal top/bottom edges (≥641px),
// and the chip's display name uses the UI font, not monospace.
for (const loggedIn of [false, true]) {
  for (const width of [1920, 1440, 1100, 700]) {
    test(`navbar controls match the tab group height and edges at ${width}px, ${loggedIn ? 'logged in' : 'logged out'}`, async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      if (loggedIn) await loginAs(page, 'E2E Tester')
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await expect(page.locator('.navbar-auth')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const r = await page.evaluate(([sel, authed]) => {
        const b = (s: string) => { const x = document.querySelector(s)!.getBoundingClientRect(); return { top: x.top, bottom: x.bottom, height: x.height } }
        return { nav: b('.navbar-inner'), tabs: b('.navbar-tabs'), ctl: b(sel as string), navH: document.querySelector('.navbar')!.getBoundingClientRect().height,
                 font: authed ? getComputedStyle(document.querySelector('.navbar-username')!).fontFamily : '' }
      }, [loggedIn ? '.navbar-profile' : '.navbar-login-btn', loggedIn] as const)
      expect(r.ctl.height).toBeCloseTo(r.tabs.height, 1)
      expect(r.ctl.top).toBeCloseTo(r.tabs.top, 1)
      expect(r.ctl.bottom).toBeCloseTo(r.tabs.bottom, 1)
      expect(r.tabs.height).toBeCloseTo(43, 1)
      expect(r.navH).toBeCloseTo(51, 1) // navbar height unchanged (50 + 1px border)
      if (loggedIn) {
        expect(r.font).not.toMatch(/mono/i)
        await page.locator('.navbar-profile').click()
        expect(await page.locator('.navbar-account-name').evaluate(e => getComputedStyle(e).fontFamily)).not.toMatch(/mono/i)
        expect(await page.locator('.navbar-npub').evaluate(e => getComputedStyle(e).fontFamily)).toMatch(/mono/i)
      }
    })
  }
}
