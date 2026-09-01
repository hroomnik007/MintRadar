import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// Trust Score Movers panel loading UX (Stats page). Regression guard for the
// bug where the panel showed "No data yet" (the genuinely-empty state) for the
// full ~2.5s the request was in flight, and again on every 7d↔30d toggle —
// same bug-pattern the Community rating tile had. Expected now: a skeleton
// while loading, previous rows kept (dimmed) across a period switch, and
// "No data yet" only if a settled query truly produced nothing.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test('shows a skeleton while loading and never flashes "No data yet" on load or toggle', async ({ page }) => {
  let delayMs = 1500
  // Override the default (instant) trust-movers mock with a controllable delay
  // and distinct data per period. Registered after installApiMocks so it wins.
  await page.route('**/api/stats/trust-movers**', async route => {
    const period = new URL(route.request().url()).searchParams.get('period') === '30d' ? '30d' : '7d'
    await new Promise(r => setTimeout(r, delayMs))
    const body = period === '30d'
      ? { period, risers: [{ url: 'https://d30.example', name: 'ThirtyDay Riser', delta: 20 }], fallers: [] }
      : { period, risers: [{ url: 'https://d7.example', name: 'SevenDay Riser', delta: 10 }], fallers: [] }
    await route.fulfill({ json: body })
  })

  await page.goto('/stats')
  const panel = page.locator('.stats-movers-panel')
  await panel.scrollIntoViewIfNeeded()

  // While the request is in flight: skeleton present, "No data yet" absent.
  await expect(panel.locator('.stats-movers-skeleton').first()).toBeVisible()
  await expect(panel.getByText('No data yet')).toHaveCount(0)

  // Once it resolves: real rows, skeleton gone.
  await expect(panel.getByText('SevenDay Riser')).toBeVisible()
  await expect(panel.locator('.stats-movers-skeleton')).toHaveCount(0)

  // Toggle to 30d — previous rows stay visible (dimmed), never a skeleton or
  // "No data yet", until the new period's data arrives.
  delayMs = 800
  await panel.getByRole('button', { name: '30d' }).click()
  await expect(panel.getByText('SevenDay Riser')).toBeVisible()
  await expect(panel.locator('.stats-movers-skeleton')).toHaveCount(0)
  await expect(panel.getByText('No data yet')).toHaveCount(0)

  await expect(panel.getByText('ThirtyDay Riser')).toBeVisible()
  await expect(panel.getByText('SevenDay Riser')).toHaveCount(0)
})
