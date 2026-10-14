import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

// The Stats tooltips (Network Health Index header, its rows, the average-uptime tile) and the
// Mint Detail Latency tooltip state what the code computes. Their texts are built from constants
// (src/utils/networkHealthIndex.ts, src/constants/probeLocation.ts); this checks what the browser
// shows: weights, the advanced-feature list, and the real "Show my latency" button label.

const ALPHA = MOCK_MINTS[0]!.url
const tip = (page: Page) => page.locator('.audit-tooltip')

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Stats tooltips state what is computed', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 })
    await page.goto('/stats')
    await expect(page.locator('.nhi-gauge-wrap')).toBeVisible()
  })

  test('Network health index header: components with weights, the online set, no Dashboard-grid claim', async ({ page }) => {
    await page.locator('.nhi-title-row svg').first().hover()
    await expect(tip(page)).toContainText('online mints 30, Reliability Score 25, software diversity 15, advanced NUTs 15, network stability 15')
    await expect(tip(page)).toContainText('not offline for 24h or more')
    await expect(tip(page)).not.toContainText(/dashboard/i)
  })

  test('breakdown rows: each row tooltip matches the row it explains', async ({ page }) => {
    const rows = page.locator('.stats-nhi-panel').getByText(/^(Online mints|Avg\. Reliability Score|Advanced feature adoption)$/)
    await expect(rows).toHaveCount(3)

    await rows.nth(0).locator('xpath=..').locator('svg').hover()
    await expect(tip(page)).toContainText(/\d+ of 30 points: the share of online mints among all mints not offline for 24h or more/)
    await expect(tip(page)).not.toContainText(/dashboard/i)

    await page.mouse.move(0, 0)
    await rows.nth(1).locator('xpath=..').locator('svg').hover()
    await expect(tip(page)).toContainText('An online mint without a score counts as 0')

    await page.mouse.move(0, 0)
    await rows.nth(2).locator('xpath=..').locator('svg').hover()
    await expect(tip(page)).toContainText('P2PK, DLEQ, HTLCs, WebSocket, clear auth, blind auth, BOLT12, Nostr backup, pay-to-blinded-key, on-chain')
    await expect(tip(page)).toContainText('A feature no mint offers counts as 0%')
  })

  test('average uptime tile: says which mints are averaged and how missing data is treated', async ({ page }) => {
    await page.locator('.smc-label-info').filter({ hasText: 'average uptime' }).locator('svg').hover()
    await expect(tip(page)).toContainText('all mints not offline for 24h or more')
    await expect(tip(page)).toContainText('not counted as 0%')
    await expect(tip(page)).not.toContainText(/dashboard/i)
  })
})

test('Mint Detail Latency tooltip names the real button label', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()

  const label = (await page.locator('.latency-test-btn').innerText()).trim()
  expect(label).toBe('Show my latency')

  await page.locator('.md-sc-label').filter({ hasText: 'Latency' }).first().locator('svg').hover()
  const t = tip(page).filter({ hasText: 'Measured from our server' })
  await expect(t).toContainText(`"${label}" measures from your device`)
  await expect(t).toContainText('Measured from our server in Nuremberg at the last probe.')
  await expect(t).not.toContainText(/Click|, DE/)
})
