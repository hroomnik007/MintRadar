import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

// Mint Detail's "Version" stat renders an "Outdated" badge from
// `latestGlobalVersion` (GET /api/mints/version-history). That field used to
// be the network-wide highest version string across every mint regardless of
// software; the backend now scopes it to the requested mint's own software
// family (see backend/src/__tests__/integration/version-history.test.ts for
// the server-side coverage of that fix). This spec pins the frontend
// rendering contract: Mint Detail must show/hide the badge purely based on
// whatever correctly-scoped value the API returns, comparing the mint's own
// version against it.

const ALPHA = MOCK_MINTS[0]!.url // https://alpha.mint.example, version 'Nutshell/0.16.0'
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`

function versionStat(page: import('@playwright/test').Page) {
  return page.locator('.md-sc', { has: page.locator('.md-sc-sub', { hasText: 'software' }) })
}

test.describe('Mint Detail — Outdated badge', () => {
  test('shows "Outdated" when the mint is several minor versions behind its own software\'s latest', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/version-history**', route =>
      route.fulfill({ json: { history: [], latestGlobalVersion: 'nutshell/0.20' } }),
    )
    await page.goto(detailPath)
    await expect(page.locator('.md-tabs')).toBeVisible()

    await expect(versionStat(page)).toContainText('Nutshell/0.16.0')
    await expect(versionStat(page).getByText('Outdated')).toBeVisible()
  })

  test('does NOT show "Outdated" when the mint is current for its software', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/version-history**', route =>
      route.fulfill({ json: { history: [], latestGlobalVersion: 'nutshell/0.16' } }),
    )
    await page.goto(detailPath)
    await expect(page.locator('.md-tabs')).toBeVisible()

    await expect(versionStat(page)).toContainText('Nutshell/0.16.0')
    await expect(versionStat(page).getByText('Outdated')).toHaveCount(0)
  })

  test('does NOT show "Outdated" when the backend has no comparable version for this mint\'s software (null latestGlobalVersion)', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/version-history**', route =>
      route.fulfill({ json: { history: [], latestGlobalVersion: null } }),
    )
    await page.goto(detailPath)
    await expect(page.locator('.md-tabs')).toBeVisible()

    await expect(versionStat(page)).toContainText('Nutshell/0.16.0')
    await expect(versionStat(page).getByText('Outdated')).toHaveCount(0)
  })
})
