import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

// A failed GET /api/mints/nostr-reviews must not be cached as "0 reviews": the tile falls back
// to the review_count rollup of /api/mints/known and the Reviews tab says the reviews are
// unavailable instead of "No Nostr reviews found". Delta has reviewCount 3 in the mocks.
const DELTA = MOCK_MINTS[3]!.url
const detailPath = `/mint/${encodeURIComponent(DELTA)}`

type Failure = 'http-500' | 'network-error'

for (const failure of ['http-500', 'network-error'] as Failure[]) {
  test(`stored reviews unavailable (${failure}): tile uses the rollup, tab says unavailable`, async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/nostr-reviews**', route =>
      failure === 'http-500' ? route.fulfill({ status: 500, body: 'boom' }) : route.abort('failed'),
    )
    await page.goto(detailPath)

    const tile = page.locator('.md-sc', { has: page.locator('.md-sc-label', { hasText: 'Community rating' }) })
    await expect(tile).toContainText('3')
    await expect(tile).not.toContainText('No reviews yet')

    await page.locator('.md-tab', { hasText: /^Reviews$/ }).click()
    await expect(page.getByText('Reviews are not available right now.')).toBeVisible()
    await expect(page.getByText('No Nostr reviews found')).toHaveCount(0)
  })
}
