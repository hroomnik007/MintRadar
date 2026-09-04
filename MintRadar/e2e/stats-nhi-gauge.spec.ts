import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_STATS } from './fixtures/mocks'

// The Network Health Index gauge draws its arc with trustDonutArc() (shared with
// the Mint Detail Trust Score gauge). It once carried a spurious
// strokeDashoffset="42.4" that split the arc and made it read ~25% short. These
// tests pin the arc geometry against the number shown in the middle.

const gauge = (page: import('@playwright/test').Page) => page.locator('.nhi-gauge-wrap')
const arc = (page: import('@playwright/test').Page) => page.locator('.nhi-gauge-wrap circle').nth(1)
const CIRCUMFERENCE = 2 * Math.PI * 27

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await mockRelays(page)
  await installApiMocks(page)
})

for (const v of [
  { label: 'low', patch: { avgTrustScore: 5, onlineMints: 0, offlineMints: 4 } },
  { label: 'mid', patch: { avgTrustScore: 40, onlineMints: 2, offlineMints: 2 } },
  { label: 'high', patch: { avgTrustScore: 100, onlineMints: 4, offlineMints: 0 } },
]) {
  test(`NHI gauge arc fills the shown percent (${v.label})`, async ({ page }) => {
    await page.route('**/api/stats', r => r.fulfill({ json: { ...MOCK_STATS, ...v.patch } }))
    await page.goto('/stats')
    await expect(gauge(page)).toBeVisible()

    const shown = Number((await page.locator('.nhi-gauge-num').textContent())!.trim())
    const [filled, gap] = ((await arc(page).getAttribute('stroke-dasharray')) || '').split(' ').map(Number)

    // No dash offset — the arc starts at 12 o'clock purely via rotate(-90).
    expect(await arc(page).getAttribute('stroke-dashoffset')).toBe('0')
    // filled + gap span the whole r=27 circle.
    expect(filled + gap).toBeCloseTo(CIRCUMFERENCE, 1)
    // filled arc == shown percent of the circumference.
    expect(filled / CIRCUMFERENCE).toBeCloseTo(shown / 100, 2)
  })
}
