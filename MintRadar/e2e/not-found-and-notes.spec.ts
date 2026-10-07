import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// Same stale-tab simulation as chunk-load-recovery.spec.ts: the Stats page is a lazy chunk
// (src/routerLazy.tsx), in dev served as /src/pages/Stats.tsx; aborting it mimics a hashed chunk
// that a deploy removed.
const STATS_CHUNK = /\/src\/pages\/Stats\.tsx/

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

