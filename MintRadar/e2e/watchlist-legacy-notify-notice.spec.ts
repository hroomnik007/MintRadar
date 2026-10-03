import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'
import {
  KNOWN, ALPHA, BRAVO, CHARLIE, NAME, mockNotifyApi, openWatchlist, card, down, up, flags,
} from './fixtures/watchlistNotify'

// One-time Watchlist notice for users whose old, never-confirmed "on" flags now show as off.

const TEXT = 'Notifications are now confirmed with the server before they show as on. The ones you had turned on before are shown as off. Turn them on again for the mints you want.'
const notice = (page: Page) => page.locator('.wl-legacy-notice')
const SHOTS = process.env['SHOTS']

const LEGACY = [{ url: ALPHA, down: true, up: true, confirmed: false }]

test.describe('Watchlist — notice about notifications that were switched off', () => {
  test('a legacy unconfirmed on flag: notice visible (role=status), above the explainer and cards; no request is made', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: LEGACY })
    await expect(notice(page)).toHaveText(`${TEXT}×`)
    await expect(notice(page)).toHaveAttribute('role', 'status')
    await expect(page.locator('[role="alert"]')).toHaveCount(0)
    const n = (await notice(page).boundingBox())!
    expect(n.y + n.height).toBeLessThanOrEqual((await page.locator('.wl-notify-explainer').boundingBox())!.y + 1)
    expect(n.y + n.height).toBeLessThanOrEqual((await page.locator('.wl-grid').boundingBox())!.y + 1)
    // the legacy mint shows as off
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    await page.waitForTimeout(500)
    expect(api.calls).toHaveLength(0) // showing it asks for no signature and sends nothing
  })

  test('dismissing stores the dismissal: it stays gone after a reload', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: LEGACY })
    await notice(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(notice(page)).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.wl-grid .notify-strip')).toHaveCount(4)
    await expect(notice(page)).toHaveCount(0)
    expect(await flags(page, ALPHA)).toEqual({ down: true, up: true, confirmed: false }) // data untouched
    expect(api.calls).toHaveLength(0)
  })

  test('a dismissal of another account does not hide it for this one', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page, { seed: LEGACY })
    await page.evaluate(async () => {
      const path = '/src/db/index.ts'
      const { db } = await import(/* @vite-ignore */ path)
      await db.meta.put({ key: 'legacyNotifyNoticeDismissed:' + 'a'.repeat(64), value: '1' })
    })
    await page.reload()
    await expect(notice(page)).toBeVisible()
  })

  test('no legacy flags: no notice (new rows, and confirmed rows)', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: BRAVO, down: true, up: false, confirmed: true }] })
    await expect(page.locator('.wl-grid .notify-strip')).toHaveCount(4)
    await expect(notice(page)).toHaveCount(0)
  })

  test('a new mint that is added and toggled never triggers it', async ({ page }) => {
    await mockNotifyApi(page)
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
    await loginAs(page)
    await page.goto('/')
    await page.waitForSelector('.mint-card')
    await page.locator('.mint-card', { hasText: NAME[ALPHA]! }).locator('.card-star').click()
    await page.getByRole('link', { name: 'Watchlist' }).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(1)
    await expect(notice(page)).toHaveCount(0)
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    await up(page, ALPHA).click()
    await expect(up(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    await expect(notice(page)).toHaveCount(0)
  })

  test('it disappears by itself once the user has re-enabled every legacy mint', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page, { seed: [
      { url: ALPHA, down: true, up: true, confirmed: false },
      { url: CHARLIE, down: true, up: false, confirmed: false },
    ] })
    await expect(notice(page)).toBeVisible()
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    await expect(notice(page)).toBeVisible() // Charlie is still a legacy mint
    await up(page, CHARLIE).click() // any confirmed toggle on that mint confirms its row
    await expect(up(page, CHARLIE)).toHaveAttribute('aria-pressed', 'true')
    await expect(notice(page)).toHaveCount(0)
    // and it does not come back after a reload (nothing was dismissed, there is simply nothing to warn about)
    await page.reload()
    await expect(page.locator('.wl-grid .notify-strip')).toHaveCount(4)
    await expect(notice(page)).toHaveCount(0)
  })

  test('it disappears when the legacy mint is removed from the watchlist', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page, { seed: LEGACY })
    await expect(notice(page)).toBeVisible()
    await card(page, ALPHA).getByRole('button', { name: `Remove ${NAME[ALPHA]} from watchlist` }).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
    await expect(notice(page)).toHaveCount(0)
  })

  test('no horizontal overflow at 320, 360, 390, 768 and 1440px with the notice showing', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page, { seed: LEGACY })
    await expect(notice(page)).toBeVisible()
    for (const width of [320, 360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(100)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${width}px`).toBeLessThanOrEqual(0)
      const b = (await notice(page).boundingBox())!
      expect(b.x, `left edge at ${width}px`).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width, `right edge at ${width}px`).toBeLessThanOrEqual(width)
      const g = (await page.locator('.wl-grid').boundingBox())!
      expect(Math.abs(b.x - g.x), `aligned with the grid at ${width}px`).toBeLessThanOrEqual(1)
    }
  })

  for (const [width, height] of [[1440, 700], [390, 800]] as const) {
    test(`screenshot ${width}px`, async ({ page }) => {
      test.skip(!SHOTS, 'set SHOTS=<dir> to write screenshots')
      await mockNotifyApi(page)
      await openWatchlist(page, { size: { width, height }, seed: [
        { url: ALPHA, down: true, up: true, confirmed: false },
        { url: BRAVO, down: true, up: false, confirmed: true },
      ] })
      await expect(notice(page)).toBeVisible()
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/legacy-notice-${width}.png` })
    })
  }
})
