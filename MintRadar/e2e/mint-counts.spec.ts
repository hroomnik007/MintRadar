import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_STATS } from './fixtures/mocks'

// 49 online (2 of them test mints) + 38 degraded + 2 archived + 1 offline <24h = 90.
const base = MOCK_KNOWN_MINTS[0]
const mk = (i: number, over: Record<string, unknown>) => ({
  ...base, url: `https://m${i}.mint.example`, name: `Mint ${String(i).padStart(2, '0')}`,
  online: true, degraded: false, archived: false, reliabilityScore: 60 + (i % 30), ...over,
})
const mints = [
  ...Array.from({ length: 47 }, (_, i) => mk(i, {})),
  mk(47, { url: 'https://testnut.cashu.space', name: 'Testnut A' }),
  mk(48, { url: 'https://nofee.testnut.cashu.space', name: 'Testnut B' }),
  ...Array.from({ length: 38 }, (_, i) => mk(50 + i, { online: false, degraded: true, reliabilityScore: 10 })),
  mk(90, { online: false, reliabilityScore: 30 }),
  mk(91, { online: false, degraded: true, archived: true, reliabilityScore: null, latencyMs: null, iconUrl: null, version: null, uptimePct24h: null, nutCount: null, nutsLimits: null }),
  mk(92, { online: false, degraded: true, archived: true, reliabilityScore: null, latencyMs: null, iconUrl: null, version: null, uptimePct24h: null, nutCount: null, nutsLimits: null }),
]

async function setup(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: mints }))
  await page.route('**/api/stats', r => r.fulfill({ json: { ...MOCK_STATS, totalMints: 90, onlineMints: 49, offlineMints: 41 } }))
}
const footer = (page: Page) => page.locator('.grid-showing-note')
const banner = (page: Page) => page.locator('.degraded-note')

test.describe('Mint counts agree everywhere', () => {
  test('default view: 49 online, 90 tracked, footer 49 of 90, banner 41, Show → 90 of 90', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await setup(page)
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    const status = page.locator('.dash-status')
    await expect(status).toContainText('49 online mints')
    await expect(status).toContainText('90 tracked mints')
    await expect(footer(page)).toHaveText('Showing 49 of 90')
    await expect(banner(page)).toContainText('41 mints hidden (offline 24h+)')

    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Show 49 of 90 mints' })).toBeVisible()

    await banner(page).click()
    await expect(footer(page)).toHaveText('Showing 90 of 90')
    await expect(page.locator('.mint-card')).toHaveCount(90)
    await expect(status).toContainText('49 online mints')
    // Archived cards render without NaN/undefined and without console errors.
    for (const n of ['Mint 91', 'Mint 92']) {
      const card = page.locator('.mint-card', { hasText: n })
      await expect(card).toBeVisible()
      await expect(card).not.toContainText(/NaN|undefined|null/)
      await expect(card).not.toContainText('Archived')
    }
    expect(errors).toEqual([])
  })

  test('user filters do not inflate the banner; footer follows the current result', async ({ page }) => {
    await setup(page)
    await page.goto('/?testmints=hide')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await expect(footer(page)).toHaveText('Showing 47 of 90')
    await expect(banner(page)).toContainText('41 mints hidden')

    await page.goto('/?reliability=80')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await expect(banner(page)).toContainText('41 mints hidden')

    await page.goto('/?status=offline')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await expect(footer(page)).toHaveText('Showing 41 of 90')
    await expect(banner(page)).toHaveCount(0)
  })

  test('Stats page uses the same 90 and 49', async ({ page }) => {
    await setup(page)
    await page.goto('/stats')
    const tile = page.locator('.stat-card', { hasText: 'mints online' })
    await expect(tile.locator('.stat-value')).toHaveText('49')
    await expect(tile.locator('.stat-note')).toHaveText('of 90 tracked')
  })
})
