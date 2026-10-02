import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Star (watch) and Compare icon buttons carry the mint name in their accessible
// name, so a screen-reader user can tell the identical-looking buttons apart.

const KNOWN = MOCK_KNOWN_MINTS.slice(0, 4).map(m => ({ ...m, online: true, degraded: false }))

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
  await loginAs(page)
})

async function cardNames(page: Page, scope: string): Promise<string[]> {
  const names = await page.locator(`${scope} .mint-card .card-name`).allTextContents()
  return names.map(n => n.trim())
}

test('Dashboard: every star and compare button is named after its mint, and the star flips Add/Remove', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.mint-grid .mint-card')
  const names = await cardNames(page, '.mint-grid')
  expect(names.length).toBe(4)

  for (const name of names) {
    const card = page.locator('.mint-grid .mint-card', { has: page.locator('.card-name', { hasText: name }) })
    const star = card.locator('.card-star')
    const compare = card.locator('.card-compare-btn')
    await expect(star).toHaveAccessibleName(`Add ${name} to watchlist`)
    await expect(star).toHaveAttribute('title', `Add ${name} to watchlist`)
    await expect(star).toHaveAttribute('aria-pressed', 'false')
    await expect(compare).toHaveAccessibleName(`Compare ${name}`)
    await expect(compare).toHaveAttribute('title', `Compare ${name}`)
  }

  const first = page.locator('.mint-grid .mint-card', { has: page.locator('.card-name', { hasText: names[0]! }) }).locator('.card-star')
  await first.click()
  await expect(first).toHaveAccessibleName(`Remove ${names[0]} from watchlist`)
  await expect(first).toHaveAttribute('title', `Remove ${names[0]} from watchlist`)
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await first.click()
  await expect(first).toHaveAccessibleName(`Add ${names[0]} to watchlist`)
  await expect(first).toHaveAttribute('aria-pressed', 'false')
})

test('Watchlist: every star and compare button is named after its mint, and the star flips Remove/Add', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.mint-grid .mint-card')
  const star = page.getByRole('button', { name: /^Add .+ to watchlist$/ })
  for (let want = 3; want >= 0; want--) {
    await star.first().click()
    await expect(star).toHaveCount(want)
  }
  await page.getByRole('link', { name: 'Watchlist' }).click()
  await expect(page.locator('.wl-grid .mint-card')).toHaveCount(4)

  const names = await cardNames(page, '.wl-grid')
  for (const name of names) {
    const card = page.locator('.wl-grid .mint-card', { has: page.locator('.card-name', { hasText: name }) })
    await expect(card.locator('.card-star')).toHaveAccessibleName(`Remove ${name} from watchlist`)
    await expect(card.locator('.card-star')).toHaveAttribute('title', `Remove ${name} from watchlist`)
    await expect(card.locator('.card-star')).toHaveAttribute('aria-pressed', 'true')
    await expect(card.locator('.card-compare-btn')).toHaveAccessibleName(`Compare ${name}`)
  }

  const firstCard = page.locator('.wl-grid .mint-card', { has: page.locator('.card-name', { hasText: names[0]! }) })
  await firstCard.locator('.card-star').click()
  await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
})

test('Mint Detail: the header star is named after the mint and flips Add/Remove', async ({ page }) => {
  await page.goto(`/mint/${encodeURIComponent(KNOWN[0]!.url)}`)
  const star = page.locator('.md-watch-star-hero')
  await expect(star).toBeVisible()
  await expect(star).toHaveAccessibleName('Add Alpha Mint to watchlist')
  await expect(star).toHaveAttribute('title', 'Add Alpha Mint to watchlist')
  await star.click()
  await expect(star).toHaveAccessibleName('Remove Alpha Mint from watchlist')
  await expect(star).toHaveAttribute('aria-pressed', 'true')
})
