import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'

// Task A1 fix 1: the NUT count in the Mint Detail header is the number the NUTs tab and the score use: tracked NUTs that the
// mint declares as supported (`supported: false` and null are not support; untracked NUTs such as 13, 21, 22 do not count).
// Object.keys(info.nuts).length used to count every key, so the header jumped (4 -> 8) when the live data arrived.

const ALPHA = MOCK_MINTS[0]!.url
const DECLARED = {
  '4': { methods: [] }, '5': { methods: [] }, '7': { supported: true }, '12': { supported: true },
  '8': { supported: false }, '9': null, '10': { supported: false }, '14': null,
  '13': { supported: true }, '21': { mint: true }, '22': { mint: true },
}

test('the header NUT count equals the NUTs tab before and after the live data arrives', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  // The stored side: the backend counts tracked + declared-as-supported NUTs (prober.ts) = 4 here.
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, nutCount: 4, nutsLimits: DECLARED } : m))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let arrived!: () => void
  const reached = new Promise<void>(resolve => { arrived = resolve })
  await page.route('**/api/mint/probe**', async route => {
    arrived()
    await gate
    await route.fulfill({ json: {
      url: ALPHA, online: true, latencyMs: 40, info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts: DECLARED }, keysets: null, checkedAt: new Date().toISOString(),
    } })
  })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await reached

  const header = page.locator('.md-summary .md-sc-value.green')
  const tabSummary = page.locator('.nut-summary-line strong')
  await expect(header).toHaveText('4')
  await page.locator('.md-tab', { hasText: 'NUTs' }).click()
  await expect(tabSummary).toHaveText('4')
  await expect(header).toHaveText('4')

  release()
  await expect(page.getByText('Nutshell/0.16.0').first()).toBeVisible()
  // Live data in: the tab and the header still agree (4 of 14 known NUTs; 11 keys were declared in all).
  await expect(tabSummary).toHaveText('4')
  await expect(page.locator('.nut-summary-line')).toContainText('4 of 14 known NUTs supported')
  await expect(header).toHaveText('4')
})
