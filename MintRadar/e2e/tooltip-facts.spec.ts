import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { CLIENT_LATENCY_BUTTON_LABEL, latencyCaption } from '../src/constants/probeLocation'

// The Stats tooltips of the Network Health Index rows state what the code computes; their texts are built from
// constants (src/utils/networkHealthIndex.ts); this checks what the browser shows: weights and the advanced-feature
// list. The header, average-uptime and Latency tooltips were removed 2026-10-14 (e2e/tooltips-removed-captions.spec.ts).

const ALPHA = MOCK_MINTS[0]!.url
const tip = (page: Page) => page.getByRole('tooltip')

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Stats breakdown-row tooltips state what is computed', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 })
    await page.goto('/stats')
    await expect(page.locator('.nhi-gauge-wrap')).toBeVisible()
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
    await expect(tip(page)).toContainText('P2PK, DLEQ, HTLCs, WebSocket, clear auth, blind auth, BOLT12, on-chain')
    await expect(tip(page)).not.toContainText(/Nostr backup|blinded/i)
    await expect(tip(page)).toContainText('A feature no mint offers counts as 0%')
  })
})

test('Mint Detail Latency tile: the caption names the probe location and the button keeps its label', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()

  const label = (await page.locator('.latency-test-btn').innerText()).trim()
  expect(label).toBe(CLIENT_LATENCY_BUTTON_LABEL)
  expect(label).toBe('Show my latency')
  const tile = page.locator('.md-sc').filter({ has: page.locator('.latency-test-btn') })
  await expect(tile.locator('.md-sc-sub')).toContainText(latencyCaption())
  await expect(tile.locator('.md-sc-sub')).toContainText('server · Nuremberg')
})
