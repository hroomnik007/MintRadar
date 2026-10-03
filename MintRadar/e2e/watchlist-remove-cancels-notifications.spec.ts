import { test, expect } from '@playwright/test'
import {
  ALPHA, BRAVO, NAME, mockNotifyApi, openWatchlist, card, down, up, flags, subscribeCalls, unsubscribeCalls,
} from './fixtures/watchlistNotify'

// Removing a watched mint (star) cancels its server subscription once when one may exist. The removal itself
// never waits for or depends on that request.

const star = (page: import('@playwright/test').Page, url: string) => card(page, url).getByRole('button', { name: `Remove ${NAME[url]} from watchlist` })
const notice = (page: import('@playwright/test').Page) => page.locator('.watchlist-notice')
const NOTICE_ALPHA = `Couldn't turn off notifications for ${NAME[ALPHA]}. They stop within 30 days.`

test.describe('Watchlist — removing a mint cancels its notifications', () => {
  test('notifications on: exactly one unsubscribe; both off: none', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: true, confirmed: true }] })
    await star(page, ALPHA).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
    await expect.poll(() => unsubscribeCalls(api).length).toBe(1)
    expect(unsubscribeCalls(api)[0]!.body).toEqual({ mintUrl: ALPHA })
    await expect(notice(page)).toHaveCount(0)

    // Bravo has both pills off (never confirmed): removing it sends nothing at all.
    await star(page, BRAVO).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(2)
    await page.waitForTimeout(600)
    expect(api.calls).toHaveLength(1)
  })

  test('a pill turned on and then off again (confirmed off): removal sends nothing', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    const before = api.calls.length // subscribe + unsubscribe from the toggles
    await star(page, ALPHA).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
    await page.waitForTimeout(600)
    expect(api.calls).toHaveLength(before)
  })

  test('a legacy local flag that was never confirmed may have a server row: one unsubscribe', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: true, confirmed: false }] })
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false') // shown as off...
    await star(page, ALPHA).click()
    await expect.poll(() => unsubscribeCalls(api).length).toBe(1) // ...but the old login sync may have subscribed it
  })

  test('the removal never waits for the request', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: false, confirmed: true }] })
    api.mode = 'gate'
    await star(page, ALPHA).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3) // gone while the unsubscribe is still pending
    await expect.poll(() => unsubscribeCalls(api).length).toBe(1)
    expect(await flags(page, ALPHA)).toBeNull()
    api.release()
  })

  for (const [mode, label] of [['500', 'HTTP 500'], ['429', 'HTTP 429'], ['abort', 'network error']] as const) {
    test(`a failing request (${label}) shows a dismissible notice and the mint is still removed`, async ({ page }) => {
      const api = await mockNotifyApi(page)
      await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: true, confirmed: true }] })
      api.mode = mode
      await star(page, ALPHA).click()
      await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
      await expect(notice(page)).toHaveText(`${NOTICE_ALPHA}×`)
      await expect(notice(page)).toHaveAttribute('role', 'status')
      await expect(page.locator('.wl-grid .mint-card', { hasText: NAME[ALPHA]! })).toHaveCount(0)
      await notice(page).getByRole('button', { name: 'Dismiss' }).click()
      await expect(notice(page)).toHaveCount(0)
    })
  }

  test('a signer that rejects shows the notice, sends nothing, and the mint is still removed', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: true, confirmed: true }] })
    await page.evaluate(() => { (window as unknown as { __rejectSign: boolean }).__rejectSign = true })
    await star(page, ALPHA).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
    await expect(notice(page)).toContainText(NOTICE_ALPHA)
    expect(api.calls).toHaveLength(0)
  })

  test('removing and re-adding the mint starts with both pills off and sends no subscribe', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: true, confirmed: true }] })
    await star(page, ALPHA).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
    await expect.poll(() => unsubscribeCalls(api).length).toBe(1)

    await page.getByRole('link', { name: 'Dashboard' }).click()
    const dashStar = page.locator('.mint-card', { has: page.locator('.card-name', { hasText: NAME[ALPHA]! }) }).getByRole('button', { name: `Add ${NAME[ALPHA]} to watchlist` })
    await dashStar.click()
    await page.getByRole('link', { name: 'Watchlist' }).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(4)
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    await expect(up(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
    await page.waitForTimeout(500)
    expect(subscribeCalls(api)).toHaveLength(0)
  })

  test('removing from the Dashboard card cancels too, and the notice shows there', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: false, confirmed: true }] })
    api.mode = '500'
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await page.locator('.mint-card', { has: page.locator('.card-name', { hasText: NAME[ALPHA]! }) })
      .getByRole('button', { name: `Remove ${NAME[ALPHA]} from watchlist` }).click()
    await expect.poll(() => unsubscribeCalls(api).length).toBe(1)
    await expect(notice(page)).toContainText(NOTICE_ALPHA)
  })

  test('removing while a toggle request is still running cancels after it (order kept)', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    api.mode = 'gate'
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toBeDisabled()
    await star(page, ALPHA).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
    await page.waitForTimeout(300)
    expect(api.calls.map(c => c.path)).toEqual(['subscribe']) // the unsubscribe queues behind it
    api.mode = 'ok'
    api.release()
    await expect.poll(() => api.calls.map(c => c.path)).toEqual(['subscribe', 'unsubscribe'])
  })
})
