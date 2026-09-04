import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Watchlist', () => {
  test('shows a login gate when not authenticated', async ({ page }) => {
    await page.goto('/watchlist')

    // Without a Nostr session the watchlist is gated behind login.
    const gate = page.locator('.wl-login-gate')
    await expect(gate.getByRole('heading', { name: 'My Watchlist' })).toBeVisible()
    await expect(gate.getByText(/sync your watchlist across devices/)).toBeVisible()
    await expect(gate.getByRole('button', { name: /Login via Nostr/ })).toBeVisible()
    await expect(gate.getByText(/Your list is stored on Nostr/)).toBeVisible()
    // No watchlist grid is rendered.
    await expect(page.locator('.wl-grid')).toHaveCount(0)
  })

  test('adds a mint from the Dashboard and shows it on the watchlist (logged in)', async ({ page }) => {
    // NOTE: The "+ Watch" control on a Dashboard card only renders for a
    // logged-in user, so this flow requires a (mocked NIP-07) session — see the
    // report. Watchlist data itself is stored locally in IndexedDB.
    await loginAs(page)
    await page.goto('/')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    // The Alpha card now exposes a Watch button (logged in).
    const alphaCard = page.locator('.mint-card', {
      has: page.locator('.card-name', { hasText: 'Alpha Mint' }),
    })
    const watchBtn = alphaCard.getByRole('button', { name: 'Watch', exact: true })
    await expect(watchBtn).toBeVisible()
    await watchBtn.click()

    // The button toggles to "Unwatch" immediately.
    await expect(alphaCard.getByRole('button', { name: 'Unwatch' })).toBeVisible()

    // The watched mint appears on the Watchlist page.
    await page.getByRole('link', { name: 'Watchlist' }).click()
    await expect(page).toHaveURL(/\/watchlist$/)
    await expect(
      page.locator('.wl-grid .card-name', { hasText: 'Alpha Mint' }),
    ).toBeVisible()
  })

  test('watchlist is empty for a freshly logged-in user', async ({ page }) => {
    await loginAs(page)
    await page.goto('/watchlist')

    // Logged in but nothing watched yet → the empty-state message + CTA.
    await expect(page.getByText('No mints watched yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Go to Dashboard' })).toBeVisible()
  })
})
