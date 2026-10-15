import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { flush } from './fixtures/settle'

// The Stats page is a lazy chunk (src/routerLazy.tsx). In dev the chunk is
// served as /src/pages/Stats.tsx; aborting that request mimics a stale tab
// whose hashed chunk was removed by a deploy.
const STATS_CHUNK = /\/src\/pages\/Stats\.tsx/

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Lazy chunk load failure', () => {
  test('reloads once automatically and the page then works', async ({ page }) => {
    // A stale tab: the chunk is gone for as long as this document lives and is back as soon as the page has been reloaded
    // (a reload fetches the fresh index.html). Not "the first request fails": the app also asks for the Stats chunk once when
    // the pointer reaches the Stats link (prefetch), and whether Chromium then remembers that failure for the later import()
    // differs between versions (Playwright 1.64's Chromium asks again and succeeds, with no error and no reload).
    let staleDocument = true
    await page.route(STATS_CHUNK, route => (staleDocument ? route.abort() : route.continue()))
    const statsDocs: string[] = []
    page.on('request', r => {
      if (r.resourceType() === 'document' && new URL(r.url()).pathname === '/stats') { statsDocs.push(r.url()); staleDocument = false }
    })

    await page.goto('/')
    await page.getByRole('link', { name: 'Stats' }).click()

    await expect(page.locator('.stats-now-panel')).toBeVisible()
    expect(statsDocs).toHaveLength(1)
    await expect(page.getByText(/couldn.t load/)).toHaveCount(0)
  })

  test('shows the friendly error with a Reload button when the chunk stays missing', async ({ page }) => {
    await page.route(STATS_CHUNK, route => route.abort())
    const statsDocs: string[] = []
    page.on('request', r => { if (r.resourceType() === 'document' && new URL(r.url()).pathname === '/stats') statsDocs.push(r.url()) })

    await page.goto('/')
    await page.getByRole('link', { name: 'Stats' }).click()

    await expect(page.getByText(/This page couldn.t load\./)).toBeVisible()
    await expect(page.getByText('The app was probably updated.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(page.getByText(/Hey developer|Unexpected Application Error/)).toHaveCount(0)
    // exactly one automatic reload, no loop: the error screen is the end of the recovery logic; nothing it queued is still on its way
    await flush(page)
    expect(statsDocs).toHaveLength(1)
  })
})
