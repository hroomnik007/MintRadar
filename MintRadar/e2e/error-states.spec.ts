import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS, MOCK_MINTS, TEST_PUBKEY_HEX } from './fixtures/mocks'

// An API failure is never presented as a mint state. With /api/mints/known failing (500, network error, or a
// slow response that then fails) Mint Detail, the Watchlist and Home show ONE error state with a "Try again"
// button; no card reads "offline", no page says "Not a tracked mint", and the header strip does not claim
// "0 online mints". "Try again" refetches and the page recovers once the mock turns healthy.

const ERROR_TEXT = 'Could not load the mint list. Please try again.'
const DETAIL = `/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`
const WATCHED = [MOCK_MINTS[0]!.url, MOCK_MINTS[1]!.url, MOCK_MINTS[2]!.url]

type Mode = '500' | 'abort' | 'slow500' | 'ok'

async function setup(page: Page, mode: { current: Mode }) {
  await mockRelays(page)
  await installApiMocks(page)
  await loginAs(page)
  await page.unroute('**/api/mints/known')
  await page.route('**/api/mints/known', async r => {
    if (mode.current === 'abort') return r.abort('failed')
    if (mode.current === 'slow500') { await new Promise(res => setTimeout(res, 2500)); return r.fulfill({ status: 500, json: { error: 'secret-internal-detail' } }) }
    if (mode.current === '500') return r.fulfill({ status: 500, json: { error: 'secret-internal-detail' } })
    return r.fulfill({ json: MOCK_KNOWN_MINTS })
  })
}

async function seedWatchlist(page: Page) {
  await page.goto('/')
  await expect(page.locator('.navbar-profile')).toBeVisible()
  await page.evaluate(async ({ urls, owner }) => {
    const path = '/src/db/index.ts'
    const { db } = await import(/* @vite-ignore */ path)
    await db.watchlist.clear()
    await db.watchlist.bulkPut(urls.map((url: string) => ({ url, addedAt: new Date(), notifyOnDown: false, notifyOnUp: false })))
    await db.meta.put({ key: 'watchlistOwner', value: owner })
  }, { urls: WATCHED, owner: TEST_PUBKEY_HEX })
}

async function expectNoMintState(page: Page) {
  const body = page.locator('body')
  await expect(body).not.toContainText(/not a tracked mint/i)
  await expect(body).not.toContainText(/0 online mints/i)
  await expect(page.locator('.mint-card')).toHaveCount(0)
  await expect(page.locator('.status-dot')).toHaveCount(0)
  await expect(body).not.toContainText('secret-internal-detail')
}

const PAGES: { id: string; path: string; ready: string; prepare?: (p: Page) => Promise<void> }[] = [
  { id: 'Mint Detail', path: DETAIL, ready: '.md-tabs' },
  { id: 'Watchlist', path: '/watchlist', ready: '.wl-grid .mint-card', prepare: seedWatchlist },
  { id: 'Home', path: '/', ready: '.mint-grid .mint-card' },
]

for (const pg of PAGES) {
  for (const failure of ['500', 'abort', 'slow500'] as const) {
    test(`${pg.id}: ${failure} shows the error state, no mint state, and Try again recovers`, async ({ page }) => {
      test.setTimeout(60_000)
      const mode = { current: 'ok' as Mode }
      await setup(page, mode)
      if (pg.prepare) await pg.prepare(page)
      mode.current = failure
      await page.goto(pg.path)

      const alert = page.getByRole('alert')
      await expect(alert).toContainText(ERROR_TEXT, { timeout: 20_000 })
      await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible()
      await expectNoMintState(page)

      mode.current = 'ok'
      await alert.getByRole('button', { name: 'Try again' }).click()
      await expect(page.locator(pg.ready).first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  }
}

test('Mint Detail: a slow successful list shows a quiet Loading… (not an error) and then the page', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.unroute('**/api/mints/known')
  await page.route('**/api/mints/known', async r => {
    await new Promise(res => setTimeout(res, 2500))
    await r.fulfill({ json: MOCK_KNOWN_MINTS })
  })
  await page.goto(DETAIL)
  await expect(page.getByRole('status')).toContainText('Loading…')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.md-tabs')).toBeVisible({ timeout: 15_000 })
})
