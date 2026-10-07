import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

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
    let chunkRequests = 0
    await page.route(STATS_CHUNK, route => (++chunkRequests === 1 ? route.abort() : route.continue()))
    const statsDocs: string[] = []
    page.on('request', r => { if (r.resourceType() === 'document' && new URL(r.url()).pathname === '/stats') statsDocs.push(r.url()) })

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
    // exactly one automatic reload, no loop
    await page.waitForTimeout(1500)
    expect(statsDocs).toHaveLength(1)
  })
})
