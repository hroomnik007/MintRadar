import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Owner, 2026-11-28: "Last check 51 min ago" stayed until a reload. The mint list is fetched again every 5 minutes (the
// probe rhythm) in the background: the time updates in place, the page is not reloaded and nothing else is disturbed.

const T0 = new Date('2026-11-28T18:00:00Z').getTime()

test('the "Last check" time follows the probes without a reload', async ({ page }) => {
  await page.clock.install({ time: T0 })
  await mockRelays(page)
  await installApiMocks(page)
  let calls = 0
  await page.route('**/api/mints/known', route => {
    calls++
    // first answer: probed 20 min before T0; later answers: probed 1 min before "now"
    const at = calls === 1 ? T0 - 20 * 60_000 : T0 + 4 * 60_000
    route.fulfill({ json: MOCK_KNOWN_MINTS.map(m => ({ ...m, lastCheckedAt: new Date(at).toISOString() })) })
  })
  await page.goto('/')
  const time = page.locator('.dash-status-time')
  await expect(time).toHaveText('20 min ago')
  const cards = await page.locator('.mint-card').count()
  await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true })
  const scrollTarget = page.locator('.mint-card').last()
  await scrollTarget.scrollIntoViewIfNeeded()
  const scrolled = await page.evaluate(() => scrollY)

  await page.clock.fastForward(5 * 60_000 + 1_000)
  await expect.poll(() => calls).toBeGreaterThanOrEqual(2)
  await expect(time).toHaveText('1 min ago')
  // the same page: no reload, the same cards, the scroll position kept
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
  await expect(page.locator('.mint-card')).toHaveCount(cards)
  expect(await page.evaluate(() => scrollY)).toBe(scrolled)
})
