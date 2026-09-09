import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// An online, non-test mint that supports NUT-04/05 but NOT NUT-09.
const NO_NINE = {
  ...MOCK_KNOWN_MINTS[0],
  url: 'https://no-nine.example',
  name: 'No-Nine Mint',
  online: true,
  degraded: false,
  trustScore: 60,
  nutsLimits: { '4': { methods: [] }, '5': { methods: [] } },
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: [...MOCK_KNOWN_MINTS, NO_NINE] }))
})

test.describe('Stats NUT coverage → Dashboard ?nut filter', () => {
  test('clicking NUT-09 navigates to /?nut=09 and filters out non-supporting mints', async ({ page }) => {
    await page.goto('/stats')
    await expect(page.locator('.stats-nut-row').first()).toBeVisible()

    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()

    await expect(page).toHaveURL(/\/\?nut=09$/)
    await expect(page.locator('.mint-card')).toHaveCount(3) // Alpha / Bravo / Delta
    await expect(page.locator('.card-name', { hasText: 'No-Nine Mint' })).toHaveCount(0)
    await expect(page.locator('.card-name', { hasText: 'Charlie Mint' })).toHaveCount(0) // still offline-hidden

    // Active-filter chip, zero-padded label
    await expect(page.locator('.active-nut-chips .filter-tag', { hasText: 'NUT-09' })).toBeVisible()
  })

  test('dismissing the NUT chip restores the full default view', async ({ page }) => {
    await page.goto('/?nut=09')
    await expect(page.locator('.mint-card')).toHaveCount(3)

    await page.getByRole('button', { name: 'Clear NUT-09 filter' }).click()

    await expect(page).toHaveURL(u => u.pathname === '/' && u.search === '')
    await expect(page.locator('.active-nut-chips')).toHaveCount(0)
    // Default view returns: online + non-test, No-Nine Mint now included.
    await expect(page.locator('.mint-card')).toHaveCount(4)
    await expect(page.locator('.card-name', { hasText: 'No-Nine Mint' })).toBeVisible()
  })

  test('an invalid nut param is ignored, not an empty grid', async ({ page }) => {
    await page.goto('/?nut=99')
    await expect(page.locator('.mint-card')).toHaveCount(4) // full default view
    await expect(page.locator('.active-nut-chips')).toHaveCount(0)
  })

  test('the action strip still works from the ?nut view', async ({ page }) => {
    await page.goto('/?nut=09')
    await expect(page.locator('.mint-card').first()).toBeVisible()

    await page.getByRole('button', { name: 'Help me pick' }).click()
    await expect(page).toHaveURL(/\/tools#pick$/)
    await expect(page.locator('#pick').getByText('Best Mint for Me')).toBeInViewport()
  })
})
