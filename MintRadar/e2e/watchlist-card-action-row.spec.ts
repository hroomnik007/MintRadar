import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Regression 1: the Latency + Down/Up cluster on a Watchlist card must
// lay out identically no matter how many digits the latency value has — a wider
// value ("10450 ms" vs "88 ms") must not shift the buttons' wrap point so that
// some cards wrap onto more lines than others.
//
// Regression 2: those buttons live in `.card-bottom-main` and must wrap *within*
// that column. They must never ride over the right-hand `.card-reliability` column
// (the Reliability number / stars). There is no Unwatch button on the card — the
// watch star lives in the header.

const LAT = [88, 411, 2336, 10450] // 2..5 digits
const KNOWN = MOCK_KNOWN_MINTS.slice(0, 4).map((m, i) => ({
  ...m, online: true, degraded: false, latencyMs: LAT[i], reliabilityScore: 80, uptimePct24h: 97,
}))

test('action row is consistent across latency digit counts and never covers Reliability', async ({ page }) => {
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
        const reliability = card.querySelector('.card-reliability') as HTMLElement
        const reliabilityFig = (card.querySelector('.card-reliability-score') ??
          card.querySelector('.card-reliability-na')) as HTMLElement
        const btns = [...main.querySelectorAll('button')]
        const tops = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)))
        const tr = reliabilityFig.getBoundingClientRect()
        return {
          btnRows: tops.size,
          coversReliability: btns.some(b => intersects(b.getBoundingClientRect(), tr)),
          mainClearsReliability: main.getBoundingClientRect().right <= Math.ceil(reliability.getBoundingClientRect().left) + 1,
        }
      })
    })

    const btnRowCounts = new Set(perCard.map(c => c.btnRows))
    // Consistency: every card wraps its buttons onto the same number of rows,
    // regardless of its latency-value digit count.
    expect(btnRowCounts.size, `button-row counts at ${w}px: ${JSON.stringify(perCard)}`).toBe(1)
    // No button's box overlaps the Reliability number, and the main area stays left
    // of the Reliability column entirely.
    for (const c of perCard) {
      expect(c.coversReliability, `a button covers Reliability at ${w}px: ${JSON.stringify(perCard)}`).toBe(false)
      expect(c.mainClearsReliability, `main area overruns Reliability column at ${w}px: ${JSON.stringify(perCard)}`).toBe(true)
    }
  }
})
