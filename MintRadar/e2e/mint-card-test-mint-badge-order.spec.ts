import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

type Page = import('@playwright/test').Page

// Alpha Mint's URL is swapped for a real TEST_MINT_URLS entry (see
// src/constants/testMints.ts) so isTestMint() fires and the 🧪 Test mint
// badge renders. Other fields are overridden per-scenario to exercise
// different combinations of the remaining badges (version, NUT count,
// unit, uptime, Trust Score, Community Rating).
const TEST_MINT_URL = 'https://testnut.cashu.space'

async function gotoWithAlphaAsTestMint(page: Page, overrides: Record<string, unknown>) {
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, url: TEST_MINT_URL, ...overrides } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.goto('/')
}

// The 🧪 Test mint badge must always be the LAST .card-pill on the card,
// regardless of which other badges are present.
async function expectTestMintBadgeLast(page: Page) {
  const card = page.locator('.mint-card', { hasText: 'Alpha Mint' })
  await expect(card).toBeVisible()
  const pills = card.locator('.card-pill')
  await expect(pills.first()).toBeVisible()
  const count = await pills.count()
  expect(count).toBeGreaterThan(1) // sanity: other badges are actually present
  await expect(pills.nth(count - 1)).toContainText('Test mint')
}

test.describe('MintCard — Test mint badge always last', () => {
  test('with all other badges present (version, NUTs, unit, uptime, trust, rating)', async ({ page }) => {
    await gotoWithAlphaAsTestMint(page, {
      version: 'Nutshell/0.16.0',
      nutCount: 12,
      units: ['sat'],
      uptimePct24h: 99,
      trustScore: 92,
      reviewCount: 12,
      reviewAvgRating: 4.2,
    })
    await expectTestMintBadgeLast(page)
  })

  test('without Community Rating badge', async ({ page }) => {
    await gotoWithAlphaAsTestMint(page, {
      version: 'Nutshell/0.16.0',
      nutCount: 12,
      units: ['sat'],
      uptimePct24h: 99,
      trustScore: 92,
      reviewCount: 0,
      reviewAvgRating: null,
    })
    await expectTestMintBadgeLast(page)
  })

  test('with only version and NUT count badges', async ({ page }) => {
    await gotoWithAlphaAsTestMint(page, {
      version: 'Nutshell/0.16.0',
      nutCount: 12,
      units: null,
      uptimePct24h: null,
      trustScore: null,
      reviewCount: 0,
      reviewAvgRating: null,
    })
    await expectTestMintBadgeLast(page)
  })

  test('with only Community Rating badge among the optional ones', async ({ page }) => {
    await gotoWithAlphaAsTestMint(page, {
      version: null,
      nutCount: 0,
      units: null,
      uptimePct24h: null,
      trustScore: null,
      reviewCount: 5,
      reviewAvgRating: 4.5,
    })
    await expectTestMintBadgeLast(page)
  })
})

test('non-test mints never show the Test mint badge', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/')
  const card = page.locator('.mint-card', { hasText: MOCK_MINTS[0]!.name })
  await expect(card.locator('.card-pill', { hasText: 'Test mint' })).toHaveCount(0)
})
