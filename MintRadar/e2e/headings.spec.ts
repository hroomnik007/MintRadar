import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

// Every route state has exactly one h1, including the not-found style ones (unknown Learn module, a mint we
// do not track, an invalid mint URL, the 404 page). The unit twin is src/__tests__/notFoundHeadings.test.tsx.

const ALPHA = encodeURIComponent(MOCK_MINTS[0]!.url)
const STATES: [string, string][] = [
  ['Dashboard', '/'],
  ['Watchlist (logged out)', '/watchlist'],
  ['Stats', '/stats'],
  ['Tools', '/tools'],
  ['About', '/about'],
  ['Methodology', '/methodology'],
  ['For wallets', '/for-wallets'],
  ['Wallets', '/wallets'],
  ['Learn', '/learn'],
  ['Learn module', '/learn/cashu-basics'],
  ['Learn module not found (number)', '/learn/99'],
  ['Learn module not found (slug)', '/learn/not-a-module'],
  ['Mint Detail', `/mint/${ALPHA}`],
  ['Not a tracked mint', `/mint/${encodeURIComponent('https://nope.example')}`],
  ['Invalid mint URL', '/mint/%25E0'],
  ['404 page', '/this/does/not/exist'],
]

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
})

for (const [label, path] of STATES) {
  test(`exactly one h1: ${label}`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('main h1')).toHaveCount(1, { timeout: 10_000 })
    await expect(page.locator('h1')).toHaveCount(1)
    expect(((await page.locator('h1').textContent()) ?? '').trim().length).toBeGreaterThan(0)
  })
}

test('the not-found h1s do not move the visible layout: the title text is still the visible one', async ({ page }) => {
  await page.goto(`/mint/${encodeURIComponent('https://nope.example')}`)
  const h1 = page.locator('h1')
  await expect(h1).toHaveText('Not a tracked mint')
  const m = await h1.evaluate(e => { const cs = getComputedStyle(e); return { size: cs.fontSize, weight: cs.fontWeight, mt: cs.marginTop, mb: cs.marginBottom } })
  expect(m).toEqual({ size: '18px', weight: '700', mt: '0px', mb: '8px' })
})
