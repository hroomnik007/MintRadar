import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_STATS } from './fixtures/mocks'

// The Network health number (2026-11-19 redesign: a condensed readout and a word, no ring). It is the weighted sum of
// the five factor rows beside it ("<points> of <weight>"), and its colour and word follow the bands of the legend.

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 })
  await mockRelays(page)
  await installApiMocks(page)
})

for (const v of [
  { label: 'low', patch: { avgReliabilityScore: 5, onlineMints: 0, offlineMints: 4 } },
  { label: 'mid', patch: { avgReliabilityScore: 40, onlineMints: 2, offlineMints: 2 } },
  { label: 'high', patch: { avgReliabilityScore: 100, onlineMints: 4, offlineMints: 0 } },
]) {
  test(`Network health: the number is the sum of the factor points and names its band (${v.label})`, async ({ page }) => {
    await page.route('**/api/stats', r => r.fulfill({ json: { ...MOCK_STATS, ...v.patch } }))
    await page.goto('/stats')
    const readout = page.locator('.nhi-readout')
    await expect(readout).toBeVisible()
    const shown = Number((await readout.textContent())!.trim())
    const points = await page.locator('.nhi-row-pts').evaluateAll(els => els.map(e => Number(e.firstChild!.textContent!.trim())))
    expect(points).toHaveLength(5)
    // Each row's points are rounded on their own, so the sum may differ from the rounded total by the rounding of five parts.
    expect(Math.abs(points.reduce((a, b) => a + b, 0) - shown)).toBeLessThanOrEqual(3)
    const word = shown >= 70 ? 'Healthy' : shown >= 40 ? 'Moderate' : 'At risk'
    await expect(page.locator('.nhi-word')).toHaveText(word)
  })
}
