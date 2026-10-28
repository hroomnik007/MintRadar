import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, probePayload, MOCK_KNOWN_MINTS, MOCK_MINTS, MOCK_STATS, TEST_PUBKEY_HEX } from './fixtures/mocks'

// An API failure is never presented as a mint state. With /api/mints/known failing (500, network error, or a
// slow response that then fails) Mint Detail, the Watchlist and Home show ONE error state with a "Try again"
// button; no card reads "offline", no page says "Not a tracked mint", and the header strip does not claim
// "0 online mints". "Try again" refetches and the page recovers once the mock turns healthy.

const ERROR_TEXT = 'Could not load the mint list. Please try again.'
const DETAIL = `/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`
const WATCHED = [MOCK_MINTS[0]!.url, MOCK_MINTS[1]!.url, MOCK_MINTS[2]!.url]

type Mode = '500' | 'abort' | 'slow500' | 'ok'

/** `slow500` answers only when `letThrough()` is called (never by a timer); `arrived()` says a request is waiting at the mock. */
function slowGate() {
  let letThrough!: () => void
  const gate = new Promise<void>(done => { letThrough = done })
  let arrived = false
  return { gate, letThrough, arrived: () => arrived, mark: () => { arrived = true } }
}
type Slow = ReturnType<typeof slowGate>

async function setup(page: Page, mode: { current: Mode }, slow?: Slow) {
  await mockRelays(page)
  await installApiMocks(page)
  await loginAs(page)
  await page.unroute('**/api/mints/known')
  await page.route('**/api/mints/known', async r => {
    if (mode.current === 'abort') return r.abort('failed')
    if (mode.current === 'slow500') { slow?.mark?.(); await slow?.gate; return r.fulfill({ status: 500, json: { error: 'secret-internal-detail' } }) }
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
      const slow = slowGate()
      await setup(page, mode, slow)
      if (pg.prepare) await pg.prepare(page)
      mode.current = failure
      await page.goto(pg.path)

      const alert = page.getByRole('alert')
      if (failure === 'slow500') {
        // While the answer is still on its way the page shows no error yet; then the answer arrives (500).
        // On Home the header strip shows dashes (never "0 online mints") and no mint state exists meanwhile.
        await expect.poll(slow.arrived, { message: 'the slow request is waiting at the mock' }).toBe(true)
        await expect(alert).toHaveCount(0)
        if (pg.id === 'Home') {
          await expect(page.locator('.dash-status')).toBeVisible()
          await expectNoMintState(page)
        }
        slow.letThrough()
      }
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

// The live probe (/api/mint/probe) is a second call on Mint Detail. When OUR API fails it, the page keeps
// rendering from the stored mint (status, score, name) and says the live data could not be loaded; it never
// turns the failure into an "offline" state, and Try again recovers once the mock is healthy.
test('Mint Detail: a failing live probe shows a retryable note and keeps the stored status', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  let healthy = false
  await page.route('**/api/mint/probe**', route => {
    if (healthy) {
      const target = new URL(route.request().url()).searchParams.get('url') ?? ''
      return route.fulfill({ json: probePayload(target) })
    }
    return route.fulfill({ status: 500, json: { error: 'secret-internal-detail' } })
  })
  await page.goto(DETAIL)
  await expect(page.locator('.md-tabs')).toBeVisible({ timeout: 15_000 })
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Could not load the live mint data. Please try again.', { timeout: 20_000 })
  await expect(page.locator('body')).not.toContainText('secret-internal-detail')
  await expect(page.locator('body')).not.toContainText('Loading live mint data')
  await expect(page.locator('body')).not.toContainText(/mint unreachable/i)
  healthy = true
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 20_000 })
})

test('Home: while the list is pending the header strip shows dashes (never "0 online"), then the counts', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.unroute('**/api/mints/known')
  let letThrough!: () => void
  const held = new Promise<void>(done => { letThrough = done })
  let arrived = false
  await page.route('**/api/mints/known', async r => {
    arrived = true
    await held
    await r.fulfill({ json: MOCK_KNOWN_MINTS })
  })
  await page.goto('/')
  await expect.poll(() => arrived, { message: 'the request is waiting at the mock' }).toBe(true)
  const strip = page.locator('.dash-status')
  await expect(strip).toHaveText(/^\s*—\s*online mints\s*—\s*tracked mints\s*last checked —\s*$/)
  await expect(page.locator('body')).not.toContainText(/\b0 (online|tracked) mints/i)
  letThrough()
  await expect(page.locator('.mint-grid .mint-card').first()).toBeVisible({ timeout: 15_000 })
  await expect(strip).not.toContainText('—')
  await expect(strip.locator('b').first()).toHaveText(/^[1-9]\d*$/)
  await expect(strip.locator('b').nth(1)).toHaveText(String(MOCK_KNOWN_MINTS.length))
})

test('Mint Detail: a slow successful list shows a quiet Loading… (not an error) and then the page', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.unroute('**/api/mints/known')
  let letThrough!: () => void
  const held = new Promise<void>(done => { letThrough = done })
  await page.route('**/api/mints/known', async r => {
    await held
    await r.fulfill({ json: MOCK_KNOWN_MINTS })
  })
  await page.goto(DETAIL)
  await expect(page.getByRole('status')).toContainText('Loading…')
  await expect(page.getByRole('alert')).toHaveCount(0)
  letThrough()
  await expect(page.locator('.md-tabs')).toBeVisible({ timeout: 15_000 })
})

// The Stats page owns its data (/api/stats). A failure there shows the same
// error state (fixed sentence + "Try again"), never a raw error text, and "Try again" recovers once the mock is healthy.
const OWN_DATA_PAGES = [
  { id: 'Stats', path: '/stats', route: '**/api/stats', text: 'Could not load the statistics. Please try again.', ready: '.nhi-gauge-wrap', ok: MOCK_STATS },
]

for (const pg of OWN_DATA_PAGES) {
  for (const failure of ['500', 'abort'] as const) {
    test(`${pg.id}: ${failure} shows the error state with Try again, and Try again recovers`, async ({ page }) => {
      test.setTimeout(60_000)
      await mockRelays(page)
      await installApiMocks(page)
      let healthy = false
      await page.route(pg.route, r => {
        if (healthy) return r.fulfill({ json: pg.ok })
        if (failure === 'abort') return r.abort('failed')
        return r.fulfill({ status: 500, json: { error: 'secret-internal-detail' } })
      })
      await page.goto(pg.path)

      const alert = page.getByRole('alert')
      await expect(alert).toContainText(pg.text, { timeout: 20_000 })
      await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible()
      await expect(page.locator('body')).not.toContainText('secret-internal-detail')
      await expect(page.locator('body')).not.toContainText('Failed to load')

      healthy = true
      await alert.getByRole('button', { name: 'Try again' }).click()
      await expect(page.locator(pg.ready).first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  }
}
