import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Regression 1: the Latency + Down/Up/Unwatch row on a Watchlist card must lay
// out identically no matter how many digits the latency value has — a wider
// value ("10450 ms" vs "88 ms") must not shift the buttons' wrap point so that
// some cards wrap onto more lines than others.
//
// Regression 2: the action buttons live in `.card-bottom-main` and must wrap
// *within* that column. They must never ride over the reserved right-hand
// `.card-trust` column (the Trust number / stars).

const LAT = [88, 411, 2336, 10450] // 2..5 digits
const KNOWN = MOCK_KNOWN_MINTS.slice(0, 4).map((m, i) => ({
  ...m, online: true, degraded: false, latencyMs: LAT[i], trustScore: 80, uptimePct24h: 97,
}))

test('action row is consistent across latency digit counts and never covers Trust', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
  await loginAs(page)

  await page.goto('/')
  await page.waitForSelector('.mint-card')
  const watch = page.getByRole('button', { name: 'Watch', exact: true })
  for (let want = 3; want >= 0; want--) {
    await watch.first().click()
    await expect(watch).toHaveCount(want)
  }
  await page.getByRole('link', { name: 'Watchlist' }).click()
  await expect(page.locator('.wl-grid .mint-card')).toHaveCount(4)

  // Sweep the widths where card width lands in the sensitive ~300-340px band.
  for (const w of [700, 720, 1080, 1100, 1300, 1390]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.waitForTimeout(80)
    const perCard = await page.evaluate(() => {
      const intersects = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      return [...document.querySelectorAll('.wl-grid .mint-card')].map(card => {
        const main = card.querySelector('.card-bottom-main') as HTMLElement
        const trust = card.querySelector('.card-trust') as HTMLElement
        const trustFig = (card.querySelector('.card-trust-score') ??
          card.querySelector('.card-trust-na')) as HTMLElement
        const btns = [...main.querySelectorAll('button')]
        const tops = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)))
        const tr = trustFig.getBoundingClientRect()
        return {
          btnRows: tops.size,
          coversTrust: btns.some(b => intersects(b.getBoundingClientRect(), tr)),
          mainClearsTrust: main.getBoundingClientRect().right <= Math.ceil(trust.getBoundingClientRect().left) + 1,
        }
      })
    })

    const btnRowCounts = new Set(perCard.map(c => c.btnRows))
    // Consistency: every card wraps its buttons onto the same number of rows,
    // regardless of its latency-value digit count.
    expect(btnRowCounts.size, `button-row counts at ${w}px: ${JSON.stringify(perCard)}`).toBe(1)
    // No button's box overlaps the Trust number, and the main area stays left
    // of the Trust column entirely.
    for (const c of perCard) {
      expect(c.coversTrust, `a button covers Trust at ${w}px: ${JSON.stringify(perCard)}`).toBe(false)
      expect(c.mainClearsTrust, `main area overruns Trust column at ${w}px: ${JSON.stringify(perCard)}`).toBe(true)
    }
  }
})
