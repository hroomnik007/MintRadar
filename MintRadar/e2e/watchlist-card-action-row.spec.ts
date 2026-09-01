import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Regression: the Latency + Down/Up/Unwatch row on a Watchlist card must lay
// out identically no matter how many digits the latency value has. It used to
// sit side-by-side with the latency block (justify-content: space-between), so
// a wider value ("10450 ms" vs "88 ms") shifted the action cluster's wrap
// point and some cards wrapped the buttons onto 2-3 rows while others didn't.

const LAT = [88, 411, 2336, 10450] // 2..5 digits
const KNOWN = MOCK_KNOWN_MINTS.slice(0, 4).map((m, i) => ({
  ...m, online: true, degraded: false, latencyMs: LAT[i], trustScore: 80, uptimePct24h: 97,
}))

test('action row is consistent across latency digit counts', async ({ page }) => {
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
      return [...document.querySelectorAll('.wl-grid .mint-card')].map(card => {
        const cb = card.querySelector('.card-bottom') as HTMLElement
        const aw = cb.children[1] as HTMLElement
        const tops = new Set([...aw.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().top)))
        return { cbH: Math.round(cb.getBoundingClientRect().height), btnRows: tops.size }
      })
    })
    const cbHeights = new Set(perCard.map(c => c.cbH))
    const btnRowCounts = new Set(perCard.map(c => c.btnRows))
    expect(cbHeights.size, `card-bottom heights at ${w}px: ${JSON.stringify(perCard)}`).toBe(1)
    expect(btnRowCounts.size, `button-row counts at ${w}px: ${JSON.stringify(perCard)}`).toBe(1)
    expect(btnRowCounts.has(1), `buttons should be one row at ${w}px: ${JSON.stringify(perCard)}`).toBe(true)
  }
})
