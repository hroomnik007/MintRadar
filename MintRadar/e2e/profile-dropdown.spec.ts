import { test, expect, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, loginAs, TEST_PUBKEY_HEX } from './fixtures/mocks'

const EXPECTED_NPUB = nip19.npubEncode(TEST_PUBKEY_HEX)

const cases = [
  { method: 'nip07', badge: 'Extension' },
  { method: 'nsec', badge: 'nsec' },
  { method: 'remote-signer', badge: 'Remote signer' },
] as const

async function setup(page: Page, method: 'nip07' | 'nsec' | 'remote-signer' = 'nip07', name = 'peter.bliznak') {
  await mockRelays(page)
  await installApiMocks(page)
  await loginAs(page, name, method)
  await page.goto('/')
  await page.waitForSelector('.navbar-profile')
}
const chip = (page: Page) => page.locator('.navbar-profile')
const panel = (page: Page) => page.locator('#navbar-account-panel')

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800, isMobile: false },
  { name: 'mobile', width: 390, height: 780, isMobile: true },
]) {
  test.describe(`account panel — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile, hasTouch: viewport.isMobile })

    for (const c of cases) {
      test(`${c.method}: badge "${c.badge}" + npub copies the full value`, async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await setup(page, c.method)
        await expect(panel(page)).toBeHidden()
        await chip(page).click()
        await expect(panel(page)).toBeVisible()
        await expect(page.locator('.navbar-method-badge')).toHaveText(c.badge)
        expect(await page.locator('.navbar-method-badge').evaluate(e => e.classList.contains('navbar-method-badge--nsec'))).toBe(c.method === 'nsec')

        const npub = page.locator('.navbar-npub')
        await expect(npub).toContainText(/^npub1.+….+$/)
        await npub.click()
        await expect(npub).toHaveText('Copied')
        await expect(page.locator('.navbar-account-sr')).toHaveText('npub copied')
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(EXPECTED_NPUB)
        await expect(npub).toContainText(/^npub1.+….+$/, { timeout: 4000 }) // reverts after ~1.5s

        await page.getByRole('button', { name: 'Log out' }).click()
        await expect(page.locator('.navbar-login-btn')).toBeVisible()
      })
    }
  })
}

test.describe('account panel — behaviour', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('chip is a disclosure button (aria-expanded/aria-controls, no menu role); click toggles', async ({ page }) => {
    await setup(page)
    await expect(chip(page)).toHaveAttribute('aria-controls', 'navbar-account-panel')
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('[role="menu"]')).toHaveCount(0)
    await chip(page).click()
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(panel(page)).toBeVisible()
    await chip(page).click()
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(panel(page)).toBeHidden()
  })

  test('chip shows avatar + name + chevron, no badge/npub/Disconnect outside the panel', async ({ page }) => {
    await setup(page, 'nip07', 'E2E Tester')
    await expect(page.locator('.navbar-profile .navbar-avatar')).toBeVisible()
    await expect(page.locator('.navbar-profile .navbar-username')).toHaveText('E2E Tester')
    await expect(page.locator('.navbar-profile .navbar-chevron')).toBeVisible()
    await expect(page.locator('.navbar-profile .navbar-method-badge')).toHaveCount(0)
    await expect(page.getByText('Disconnect')).toHaveCount(0)
  })

  test('Escape closes and returns focus to the chip', async ({ page }) => {
    await setup(page)
    await chip(page).click()
    await page.getByRole('button', { name: 'Log out' }).focus()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(chip(page)).toBeFocused()
  })

  test('outside pointerdown closes', async ({ page }) => {
    await setup(page)
    await chip(page).click()
    await expect(panel(page)).toBeVisible()
    await page.mouse.click(40, 500)
    await expect(panel(page)).toBeHidden()
  })

  test('clicking inside the panel (non-button area) does not close it', async ({ page }) => {
    await setup(page)
    await chip(page).click()
    await page.locator('.navbar-account-name').click()
    await expect(panel(page)).toBeVisible()
  })

  test('route change closes', async ({ page }) => {
    await setup(page)
    await chip(page).click()
    await page.locator('.nav-tab', { hasText: 'Stats' }).click()
    await expect(page).toHaveURL(/\/stats/)
    await expect(panel(page)).toBeHidden()
  })

  test('Tab out of the panel closes it', async ({ page }) => {
    await setup(page)
    await chip(page).click()
    await page.getByRole('button', { name: 'Log out' }).focus()
    await page.keyboard.press('Tab')
    await expect(panel(page)).toBeHidden()
  })

  test('Log out closes the panel and logs out', async ({ page }) => {
    await setup(page)
    await chip(page).click()
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page.locator('.navbar-login-btn')).toBeVisible()
    await expect(page.locator('.navbar-profile')).toHaveCount(0)
  })

  test('denied/unavailable clipboard shows "Copy failed" and does not throw', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await setup(page)
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }) })
    await chip(page).click()
    await page.locator('.navbar-npub').click()
    await expect(page.locator('.navbar-npub')).toHaveText('Copy failed')
    await expect(page.locator('.navbar-npub')).toContainText(/^npub1/, { timeout: 4000 })
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }) })
    await page.locator('.navbar-npub').click()
    await expect(page.locator('.navbar-npub')).toHaveText('Copy failed')
    expect(errors).toEqual([])
  })

  test('closing the panel resets "Copied" (timer cleaned up)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await setup(page)
    await chip(page).click()
    await page.locator('.navbar-npub').click()
    await expect(page.locator('.navbar-npub')).toHaveText('Copied')
    await page.keyboard.press('Escape')
    await chip(page).click()
    await expect(page.locator('.navbar-npub')).toContainText(/^npub1/)
  })

  test('long display name wraps/ellipsizes in the panel without overflowing it', async ({ page }) => {
    await setup(page, 'nip07', 'Q'.repeat(80))
    await chip(page).click()
    const m = await page.locator('#navbar-account-panel').evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth }))
    expect(m.sw).toBeLessThanOrEqual(m.cw)
  })

  test('panel sits above page content on every page', async ({ page }) => {
    await setup(page)
    for (const path of ['/', '/stats', '/tools', '/wallets', '/learn', '/watchlist', '/mint/alpha.mint.example']) {
      await page.goto(path)
      await chip(page).waitFor()
      await chip(page).click()
      const top = await page.evaluate(() => {
        const p = document.getElementById('navbar-account-panel')!.getBoundingClientRect()
        const probes = [[p.left + p.width / 2, p.top + 20], [p.left + p.width / 2, p.bottom - 10], [p.left + 10, p.bottom - 10]]
        return probes.map(([x, y]) => !!document.elementFromPoint(x!, y!)?.closest('#navbar-account-panel'))
      })
      expect(top, path).toEqual([true, true, true])
    }
  })
})

// Panel fully inside the viewport, and opening it moves nothing else.
for (const width of [320, 390, 768, 1440]) {
  test(`panel stays inside the viewport and shifts nothing at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await setup(page, 'nsec', 'satoshinakamoto_longhandle_2009')
    await page.evaluate(() => document.fonts.ready)
    const sel = '.navbar-inner, .nav-logo, .navbar-tabs, .navbar-auth, .navbar-profile, .dashboard, .mint-grid'
    const snap = () => page.evaluate((s) => [...document.querySelectorAll(s)].map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height] }), sel)
    const before = await snap()
    await chip(page).click()
    await expect(panel(page)).toBeVisible()
    const box = await panel(page).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    if (width <= 640) {
      expect(width - (box!.x + box!.width)).toBeCloseTo(12, 0)
      expect(box!.width).toBeLessThanOrEqual(244)
    } else {
      expect(box!.width).toBeCloseTo(264, 0)
    }
    expect(await snap()).toEqual(before)
    const de = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(de).toBeLessThanOrEqual(0)
  })
}

test('navbar stays on one row from 641px with the new chip (logged in, long name)', async ({ page }) => {
  await setup(page, 'nip07', 'Q'.repeat(80))
  await page.evaluate(() => document.fonts.ready)
  for (const width of [641, 700, 806, 807, 902, 903, 996, 997, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 })
    const m = await page.evaluate(() => ({ h: document.querySelector('.navbar-inner')!.getBoundingClientRect().height, sw: document.documentElement.scrollWidth - document.documentElement.clientWidth }))
    expect(m.h, `${width}px`).toBeLessThanOrEqual(56)
    expect(m.sw, `${width}px`).toBeLessThanOrEqual(0)
  }
})
