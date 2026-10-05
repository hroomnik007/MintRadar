import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Same stale-tab simulation as chunk-load-recovery.spec.ts: the Stats page is a lazy chunk
// (src/routerLazy.tsx), in dev served as /src/pages/Stats.tsx; aborting it mimics a hashed chunk
// that a deploy removed.
const STATS_CHUNK = /\/src\/pages\/Stats\.tsx/

const H = 3_600_000
const D = 24 * H
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Independent of src/utils/auditFreshness.ts: "27 Sep 2026" in UTC.
const utcDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Not found page', () => {
  test('an unknown route shows the Page not found page with title and noindex', async ({ page }) => {
    await page.goto('/nope-missing')

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page).toHaveTitle('Page not found | MintRadar')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    // it is not the error screen for real failures
    await expect(page.getByText(/This page couldn.t load\./)).toHaveCount(0)
  })

  test('its Dashboard link goes to the Dashboard', async ({ page }) => {
    await page.goto('/nope-missing')
    await page.locator('.not-found-links').getByRole('link', { name: 'Dashboard' }).click()

    await expect.poll(() => new URL(page.url()).pathname).toBe('/')
    await expect(page.getByRole('heading', { level: 1, name: /Cashu Mints Reliability Score/ })).toBeAttached()
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0)
  })

  test('its About link goes to About', async ({ page }) => {
    await page.goto('/nope-missing')
    await page.locator('.not-found-links').getByRole('link', { name: 'About' }).click()

    await expect.poll(() => new URL(page.url()).pathname).toBe('/about')
    await expect(page.getByRole('heading', { level: 1, name: 'About MintRadar' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0)
  })

  test('a real chunk failure still shows the existing error screen, not Page not found', async ({ page }) => {
    await page.route(STATS_CHUNK, route => route.abort())

    await page.goto('/')
    await page.getByRole('link', { name: 'Stats' }).click()

    await expect(page.getByText(/This page couldn.t load\./)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0)
  })
})

test.describe('Watchlist empty state', () => {
  test('the "Go to Dashboard" button navigates to the Dashboard', async ({ page }) => {
    await loginAs(page)
    await page.goto('/watchlist')
    await expect(page.getByText('No mints watched yet')).toBeVisible()

    await page.getByRole('button', { name: 'Go to Dashboard' }).click()

    await expect.poll(() => new URL(page.url()).pathname).toBe('/')
    await expect(page.getByRole('heading', { level: 1, name: /Cashu Mints Reliability Score/ })).toBeAttached()
    await expect(page.getByPlaceholder(/Search mints/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0)
  })
})

// The newest auditCheckedAt across all mints decides; every row is given an age here, the newest one is
// `newestAgeMs`, the others are older.
async function gotoStats(page: import('@playwright/test').Page, newestAgeMs: number) {
  const rows = MOCK_KNOWN_MINTS.map((m, i) => ({ ...m, auditCheckedAt: ago(newestAgeMs + i * 5 * D) }))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.goto('/stats')
  await expect(page.getByText('Mints Tracked')).toBeVisible()
}

test.describe('Stats audit note', () => {
  test('appears with the date when the newest audit check is older than 7 days, and links to /about', async ({ page }) => {
    const newest = ago(8 * D)
    await gotoStats(page, 8 * D)

    const note = page.locator('.stats-audit-note')
    await expect(note).toBeVisible()
    await expect(note).toContainText(`audit.8333.space has had no new data since ${utcDate(newest)}.`)

    const about = note.getByRole('link', { name: 'About' })
    await expect(about).toHaveAttribute('href', '/about')
    await about.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/about')
  })

  test('does not appear when the newest audit check is 1 day old', async ({ page }) => {
    await gotoStats(page, 1 * D)
    await expect(page.locator('.stats-audit-note')).toHaveCount(0)
  })

  test('does not appear just inside the 7-day limit (6 days)', async ({ page }) => {
    await gotoStats(page, 6 * D)
    await expect(page.locator('.stats-audit-note')).toHaveCount(0)
  })

  test('the wording does not claim that audit.cashu.cz is current', async ({ page }) => {
    const newest = ago(9 * D)
    await gotoStats(page, 9 * D)

    const note = page.locator('.stats-audit-note')
    await expect(note).toHaveText(
      `audit.8333.space has had no new data since ${utcDate(newest)}. ` +
      'The audit part of the Reliability Score uses its last values. ' +
      'Data from audit.cashu.cz is shown on the Audit tab of each mint when available. See About.',
    )
    await expect(note).not.toContainText(/\bis current\b|up to date|\bfresh\b|\bup-to-date\b/i)
  })
})
