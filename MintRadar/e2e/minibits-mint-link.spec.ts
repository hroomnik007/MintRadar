import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// CONTRACT: used by the Minibits wallet; do not break.
// Minibits' Availability card links to https://mintradar.org/mint/{encodeURIComponent(mint.url)}, with mint.url taken
// from GET /api/v1/wallets/mints/{url} (src/services/mintAuditService.ts, AUDIT_SITE_URL:
// https://github.com/minibits-cash/minibits_wallet/blob/eefdfb9e055968135a1a9314b637798500360acd/src/services/mintAuditService.ts).
// The API side of the contract is backend/src/__tests__/integration/wallet-api-minibits-contract.test.ts; this pins
// that the link it builds opens the mint's detail page, for a mint URL with a path like Minibits' own mint.

const MINIBITS = 'https://mint.minibits.cash/Bitcoin'
const link = `/mint/${encodeURIComponent(MINIBITS)}`

test('the Minibits link /mint/{encodeURIComponent(url)} opens that mint\'s detail page', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, url: MINIBITS, name: 'Minibits mint' } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))

  expect(link).toBe('/mint/https%3A%2F%2Fmint.minibits.cash%2FBitcoin')
  await page.goto(link)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await expect(page.getByText('Minibits mint').first()).toBeVisible()
  // The page knows it is this mint's page (and not the not-found fallback).
  await expect.poll(() => page.locator('link[rel="canonical"]').getAttribute('href')).toBe(`https://mintradar.org${link}`)
})
