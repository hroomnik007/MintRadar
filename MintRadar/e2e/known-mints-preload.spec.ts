import { test, expect, type Request } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { flush } from './fixtures/settle'

// The mint list request is started at HTML parse time by /early-preload.js (a preload, on "/" and "/mint/:url" only) and the app's own
// fetch must reuse it: one request per page load, not two. Mocked API; counts come from the browser's request events.

const KNOWN = /\/api\/mints\/known(\?|$)/

function trackKnown(page: import('@playwright/test').Page): Request[] {
  const seen: Request[] = []
  page.on('request', r => { if (KNOWN.test(r.url())) seen.push(r) })
  return seen
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('known-mints preload', () => {
  test('"/" issues exactly one /api/mints/known request, started by the preload', async ({ page }) => {
    const seen = trackKnown(page)
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await flush(page)
    expect(seen.map(r => r.url())).toHaveLength(1)
    await expect(page.locator('head link[rel="preload"][as="fetch"][href="/api/mints/known"][crossorigin="anonymous"]')).toHaveCount(1)
  })

  test('"/" with a query string still issues one request', async ({ page }) => {
    const seen = trackKnown(page)
    await page.goto('/?q=alpha')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await flush(page)
    expect(seen).toHaveLength(1)
  })

  test('a mint detail page issues exactly one /api/mints/known request, started by the preload', async ({ page }) => {
    const seen = trackKnown(page)
    await page.goto(`/mint/${encodeURIComponent('https://alpha.mint.example')}`)
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()
    await flush(page)
    expect(seen).toHaveLength(1)
    await expect(page.locator('head link[rel="preload"][as="fetch"][href="/api/mints/known"][crossorigin="anonymous"]')).toHaveCount(1)
  })

  test('/mint/nostr/<naddr> (two segments, MintNaddr) adds no preload', async ({ page }) => {
    await page.goto('/mint/nostr/not-an-naddr')
    await expect(page.getByTestId('naddr-error')).toBeVisible()
    await page.waitForLoadState('load')
    await expect(page.locator('head link[rel="preload"]')).toHaveCount(0)
  })

  for (const route of ['/about', '/methodology', '/wallets', '/learn']) {
    test(`${route} adds no preload and requests no mint list`, async ({ page }) => {
      const seen = trackKnown(page)
      await page.goto(route)
      await expect(page.locator('h1').first()).toBeVisible()
      // `load` waits for async scripts, so early-preload.js has run by now.
      await page.waitForLoadState('load')
      await flush(page)
      await expect(page.locator('head link[rel="preload"]')).toHaveCount(0)
      expect(seen).toHaveLength(0)
    })
  }

  test('client-side navigation to a page that reads the list does not add a second request', async ({ page }) => {
    const seen = trackKnown(page)
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await page.getByRole('link', { name: 'Stats' }).first().click()
    await expect(page).toHaveURL(/\/stats$/)
    await flush(page)
    // The list is cached for five minutes (staleTime): the preload is consumed once, the Stats page reuses the query.
    expect(seen).toHaveLength(1)
  })
})
