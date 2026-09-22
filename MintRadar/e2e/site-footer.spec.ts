import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Site footer', () => {
  test('renders open source, vuln report, API and Learn links on Dashboard', async ({ page }) => {
    await page.goto('/')

    const footer = page.locator('footer.app-footer')
    await expect(footer).toBeVisible()

    await expect(footer.getByRole('link', { name: /MintRadar.*open source/ })).toHaveAttribute(
      'href',
      'https://github.com/hroomnik007/MintRadar',
    )
    await expect(footer.getByRole('link', { name: /Nostr DM for vuln reports/ })).toHaveAttribute(
      'href',
      /njump\.me\/npub1/,
    )
    await expect(footer.getByRole('link', { name: 'API' })).toHaveAttribute(
      'href',
      'https://github.com/hroomnik007/MintRadar/blob/main/docs/API.md',
    )
    const learnLink = footer.getByRole('link', { name: 'Learn' })
    await expect(learnLink).toHaveAttribute('href', '/learn')

    await expect(footer.getByText('Reliability is a health signal, not solvency.')).toBeVisible()
    await expect(footer.getByText('No cookies. No analytics.')).toBeVisible()
  })

  test('survives mobile viewport (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/')

    const footer = page.locator('footer.app-footer')
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('link', { name: 'API' })).toBeVisible()
    await expect(footer.getByText('No cookies. No analytics.')).toBeVisible()
  })

  test('is present on other routes too (not a Dashboard-only element)', async ({ page }) => {
    await page.goto('/watchlist')
    await expect(page.locator('footer.app-footer')).toBeVisible()
  })
})
