import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

type Page = import('@playwright/test').Page

// Alpha Mint's URL is swapped for a real TEST_MINT_URLS entry (see
// src/constants/testMints.ts) so isTestMint() fires and the Test mint
// badge renders. Other fields are overridden per-scenario to exercise
// different combinations of the remaining badges.
const TEST_MINT_URL = 'https://testnut.cashu.space'

async function gotoWithAlphaAsTestMint(page: Page, overrides: Record<string, unknown>) {
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, url: TEST_MINT_URL, ...overrides } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.goto('/?testmints=show')
}

// The Test mint badge lives inline with the RELIABILITY label (either the
// scored or n/a variant) so it never adds its own full-width row, and never
// appears in the pill row or the name-row header slot.
async function expectTestMintBadgeInReliabilityRow(page: Page) {
  const card = page.locator('.mint-card', { hasText: 'Alpha Mint' })
  await expect(card).toBeVisible()

  const badge = card.locator('.card-reliability-badge-test-mint')
  await expect(badge).toBeVisible()
  await expect(badge).toContainText('Test mint')

  await expect(card.locator('.card-pills .card-hdr-test-mint')).toHaveCount(0)
  await expect(card.locator('.card-name-row .card-hdr-test-mint')).toHaveCount(0)
  await expect(card.locator('.card-name-row .card-hdr-badges')).toHaveCount(0)
}

test.describe('MintCard — Test mint badge lives in the RELIABILITY row', () => {
  test('with all other badges present (version, NUTs, unit, uptime, reliability, rating)', async ({ page }) => {
    await gotoWithAlphaAsTestMint(page, {
      version: 'Nutshell/0.16.0',
      nutCount: 12,
      units: ['sat'],
      uptimePct24h: 99,
      reliabilityScore: 92,
      reviewCount: 12,
      reviewAvgRating: 4.2,
    })
    await expectTestMintBadgeInReliabilityRow(page)
  })

  test('without Community Rating badge', async ({ page }) => {
    await gotoWithAlphaAsTestMint(page, {
      version: 'Nutshell/0.16.0',
      nutCount: 12,
      units: ['sat'],
      uptimePct24h: 99,
      reliabilityScore: 92,
      reviewCount: 0,
      reviewAvgRating: null,
    })
    await expectTestMintBadgeInReliabilityRow(page)
  })

  test('with only version and NUT count badges (Reliability n/a)', async ({ page }) => {
    await gotoWithAlphaAsTestMint(page, {
      version: 'Nutshell/0.16.0',
      nutCount: 12,
      units: null,
      uptimePct24h: null,
      reliabilityScore: null,
      reviewCount: 0,
      reviewAvgRating: null,
    })
    await expectTestMintBadgeInReliabilityRow(page)
  })
})

test('New badge stays in the pill row; Test mint badge sits in the RELIABILITY row when both apply', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) =>
    i === 0 ? { ...m, url: TEST_MINT_URL, discoveredAt: new Date().toISOString() } : m,
  )
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.goto('/?testmints=show')

  const card = page.locator('.mint-card', { hasText: 'Alpha Mint' })
  await expect(card.locator('.card-pills .card-hdr-new')).toHaveText('New')
  await expect(card.locator('.card-pills .card-hdr-test-mint')).toHaveCount(0)
  await expect(card.locator('.card-reliability-badge-test-mint')).toContainText('Test mint')
})

test('non-test mints never show the Test mint badge', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/?testmints=show')
  const card = page.locator('.mint-card', { hasText: MOCK_MINTS[0]!.name })
  await expect(card.getByText('Test mint')).toHaveCount(0)
})
