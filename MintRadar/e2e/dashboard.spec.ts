import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  // ?status=all opts out of the new online-only default view so these
  // long-standing assertions still see the full 4-mint fixture set
  // (incl. the offline Charlie Mint). The default view itself is covered
  // by dashboard-default-view.spec.ts.
  await page.goto('/?status=all')
  // Wait for the mocked mint list to render.
  await expect(page.locator('.mint-card')).toHaveCount(4)
})

test.describe('Dashboard', () => {
  test('loads and lists the known mints', async ({ page }) => {
    await expect(page.locator('.card-name', { hasText: 'Alpha Mint' })).toBeVisible()
    await expect(page.locator('.card-name', { hasText: 'Delta Mint' })).toBeVisible()
    // The compact ".dash-status" line reflects the mocked data: 3 of the 4
    // mocked mints are online (Alpha, Bravo, Delta; Charlie is offline).
    const status = page.locator('.dash-status')
    await expect(status.locator('.dash-status-item').first()).toContainText('3 online mints')
    await expect(status.locator('.dash-status-item').nth(1)).toContainText('4 tracked mints')
  })

  test('search filters the mint list', async ({ page }) => {
    const search = page.getByPlaceholder(/Search mints/)
    await search.fill('alpha')

    await expect(page.locator('.mint-card')).toHaveCount(1)
    await expect(page.locator('.card-name', { hasText: 'Alpha Mint' })).toBeVisible()
    await expect(page.locator('.card-name', { hasText: 'Bravo Mint' })).toHaveCount(0)

    // Clearing the query restores the full list.
    await search.fill('')
    await expect(page.locator('.mint-card')).toHaveCount(4)
  })

  test('filter panel opens and closes', async ({ page }) => {
    const filterBtn = page.getByRole('button', { name: 'Filters', exact: true })
    await expect(page.locator('.filter-panel')).toHaveCount(0)

    await filterBtn.click()
    await expect(page.locator('.filter-panel')).toBeVisible()

    await filterBtn.click()
    await expect(page.locator('.filter-panel')).toHaveCount(0)
  })

  test('status filter narrows the list to offline / online mints', async ({ page }) => {
    const filterBtn = page.locator('.filter-btn')
    const apply = page.getByRole('button', { name: /^Show \d+ of \d+ mints$/ })

    // Offline → only Charlie Mint (the single offline mock mint).
    await filterBtn.click()
    await page.getByRole('radio', { name: 'Offline' }).check()
    await apply.click()
    await expect(page.locator('.mint-card')).toHaveCount(1)
    await expect(page.locator('.card-name', { hasText: 'Charlie Mint' })).toBeVisible()

    // Online → the remaining three, Charlie gone.
    await filterBtn.click()
    await page.getByRole('radio', { name: 'Online' }).check()
    await apply.click()
    await expect(page.locator('.mint-card')).toHaveCount(3)
    await expect(page.locator('.card-name', { hasText: 'Charlie Mint' })).toHaveCount(0)

    // Back to All → full list restored.
    await filterBtn.click()
    await page.getByRole('radio', { name: 'All' }).check()
    await apply.click()
    await expect(page.locator('.mint-card')).toHaveCount(4)
  })

  test('sorting reorders the mints', async ({ page }) => {
    const names = page.locator('.mint-grid .card-name')
    // The active sort button appends an arrow (e.g. "Name ↑"), so target by class + substring.
    const sortBtn = (label: string) => page.locator('.sort-btn', { hasText: label })

    // Default sort is now Reliability Score desc: Alpha 92, Delta 78, Bravo 55, Charlie offline → 0.
    await expect(names).toHaveText(['Alpha Mint', 'Delta Mint', 'Bravo Mint', 'Charlie Mint'])

    // Switching to Name resets to ascending; clicking it again toggles to descending.
    await sortBtn('Name').click()
    await expect(names).toHaveText(['Alpha Mint', 'Bravo Mint', 'Charlie Mint', 'Delta Mint'])
    await sortBtn('Name').click()
    await expect(names).toHaveText(['Delta Mint', 'Charlie Mint', 'Bravo Mint', 'Alpha Mint'])
  })

  test('"Most reviewed" sorts by reviewCount desc, with 0/null last', async ({ page }) => {
    const names = page.locator('.mint-grid .card-name')
    const sortBtn = (label: string) => page.locator('.sort-btn', { hasText: label })

    // Fixture reviewCount: Alpha 12, Charlie 4, Delta 3, Bravo 0 — Bravo must
    // sort last regardless of its (null) average rating.
    await sortBtn('Most reviewed').click()
    await expect(names).toHaveText(['Alpha Mint', 'Charlie Mint', 'Delta Mint', 'Bravo Mint'])
  })

  test('clicking a mint card opens its detail page', async ({ page }) => {
    await page.locator('.card-name', { hasText: 'Alpha Mint' }).click()

    await expect(page).toHaveURL(/\/mint\/https%3A%2F%2Falpha\.mint\.example/)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()
  })

  test('"Rating" sorts by the confidence-adjusted average; the displayed stars and counts do not change', async ({ page }) => {
    const mk = (name: string, over: Record<string, unknown>) => ({
      ...MOCK_KNOWN_MINTS[0], url: `https://${name.toLowerCase()}.rating.example`, name: `${name} Mint`,
      online: true, degraded: false, reliabilityScore: 80, reviewCount: 0, reviewAvgRating: null, reviewRatedCount: null, reviewWeightedRating: null,
      ...over,
    })
    // 5.0 x1 -> 3.75, 4.8 x83 -> 4.73, 5.0 x3 -> 4.06, none -> last. (The old raw order would be One, Three, Many, None.)
    const rows = [
      mk('One', { reviewCount: 1, reviewAvgRating: 5.0, reviewRatedCount: 1, reviewWeightedRating: 4.99 }),
      mk('Many', { reviewCount: 90, reviewAvgRating: 4.8, reviewRatedCount: 83, reviewWeightedRating: 4.5 }),
      mk('Three', { reviewCount: 3, reviewAvgRating: 5.0, reviewRatedCount: 3, reviewWeightedRating: 4.98 }),
      mk('None', {}),
    ]
    await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)
    await page.locator('.sort-btn', { hasText: 'Rating' }).click()
    await expect(page.locator('.mint-grid .card-name')).toHaveText(['Many Mint', 'Three Mint', 'One Mint', 'None Mint'])
    // What the card shows is the real average and the count of all reviews, as before.
    const many = page.locator('.mint-card', { hasText: 'Many Mint' })
    await expect(many.locator('.card-reliability-rating-val')).toHaveText('4.8')
    await expect(many.locator('.card-reliability-rating-n')).toHaveText('(90)')
  })
})

