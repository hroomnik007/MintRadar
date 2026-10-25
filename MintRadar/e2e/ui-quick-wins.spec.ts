// Stage-1 UI quick wins (2026-10-25): phone "Show all N" cut, the no-results state, refresh vs reset, skip link,
// the Mint Detail h1, archived mints (card, detail, Stats movers) and the bad /mint/nostr link page.
import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

const base = MOCK_KNOWN_MINTS[0]!
// 14 online mints (scores 99..86, so the Reliability default sorts them in this order) + 1 offline one.
const MANY = [
  ...Array.from({ length: 14 }, (_, i) => ({ ...base, url: `https://m${String(i).padStart(2, '0')}.mint.example`, name: `Mint ${String(i).padStart(2, '0')}`, online: true, degraded: false, reliabilityScore: 99 - i })),
  { ...base, url: 'https://off.mint.example', name: 'Offline Mint', online: false, degraded: true, reliabilityScore: 20 },
]
async function routeMany(page: Page) {
  await page.route('**/api/mints/known', r => r.fulfill({ json: MANY }))
}

test.describe('phone: first 10 online mints + "Show all N"', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('collapsed in sort order, expands to all, offline toggle unchanged', async ({ page }) => {
    await routeMany(page)
    await page.goto('/')
    const names = page.locator('.mint-grid .card-name')
    await expect(names).toHaveCount(10)
    await expect(names.first()).toHaveText('Mint 00')
    await expect(names.last()).toHaveText('Mint 09')
    const showAll = page.getByTestId('show-all-mints')
    await expect(showAll).toHaveText('Show all 14')
    // Collapsed: the count is over ONLINE mints, so it matches "Show all 14" instead of the tracked total.
    await expect(page.locator('.grid-showing-note')).toHaveText('Showing 10 of 14 online')

    // The hidden-mints toggle still reveals the offline mint while the online list stays cut.
    await page.locator('.degraded-note').click()
    await expect(page.locator('.card-name', { hasText: 'Offline Mint' })).toBeVisible()
    await expect(page.locator('.mint-grid .card-name', { hasText: /^Mint / })).toHaveCount(10)
    await expect(page.locator('.grid-showing-note')).toHaveText('Showing 10 of 14 online · 1 offline')

    await showAll.click()
    await expect(page.locator('.mint-grid .card-name', { hasText: /^Mint / })).toHaveCount(14)
    await expect(showAll).toHaveCount(0)
    // Expanded: the usual "Showing X of Y" (no "online").
    await expect(page.locator('.grid-showing-note')).toHaveText(/^Showing \d+ of \d+$/)
    // Stays expanded on a reload of the same tab (Back from a mint page needs the same rows).
    await page.reload()
    await expect(page.locator('.mint-grid .card-name', { hasText: /^Mint / })).toHaveCount(14)
  })

  test('a search or a non-default filter shows every result', async ({ page }) => {
    await routeMany(page)
    await page.goto('/?q=mint.example')
    await expect(page.locator('.mint-grid .card-name', { hasText: /^Mint / })).toHaveCount(14)
    await expect(page.getByTestId('show-all-mints')).toHaveCount(0)
    await page.goto('/?reliability=50')
    await expect(page.locator('.mint-grid .card-name', { hasText: /^Mint / })).toHaveCount(14)
    await page.goto('/?status=all')
    await expect(page.locator('.mint-grid .card-name', { hasText: /^Mint / })).toHaveCount(14)
    await expect(page.getByTestId('show-all-mints')).toHaveCount(0)
  })
})

test.describe('tablet and desktop never cut the list', () => {
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
    test(`${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await routeMany(page)
      await page.goto('/')
      await expect(page.locator('.mint-grid .card-name')).toHaveCount(14)
      await expect(page.getByTestId('show-all-mints')).toHaveCount(0)
      // Desktop/tablet copy unchanged.
      await expect(page.locator('.grid-showing-note')).toHaveText(/^Showing 14 of \d+$/)
    })
  }
})

test('no results: names the query, "Clear search" restores the list, Add mint opens the form', async ({ page }) => {
  await page.goto('/?q=zzz-nothing')
  const empty = page.getByTestId('no-mints-match')
  await expect(empty).toContainText('No mints match “zzz-nothing”')
  await empty.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.locator('.mint-card').first()).toBeVisible()
  await expect(page).not.toHaveURL(/[?&]q=/)
  await page.goto('/?q=zzz-nothing')
  await page.getByTestId('no-mints-match').getByRole('button', { name: /Add mint/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('"Refresh mint list" keeps the filters; the panel\'s Reset clears them', async ({ page }) => {
  await page.goto('/?reliability=50')
  await page.getByRole('button', { name: 'Refresh mint list' }).click()
  await expect(page).toHaveURL(/[?&]reliability=50/)
  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page).not.toHaveURL(/[?&]reliability=/)
})

test('skip link: first Tab stop, moves focus to <main>', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.mint-card').first()).toBeVisible()
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main-content')).toBeFocused()
})

test('Mint Detail h1 is just the mint name', async ({ page }) => {
  await page.goto('/mint/alpha.mint.example')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Alpha Mint')
})

test.describe('archived mints', () => {
  const ARCHIVED_URL = 'https://charlie.mint.example'
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/mints/known', r => r.fulfill({
      json: MOCK_KNOWN_MINTS.map(m => (m.url === ARCHIVED_URL ? { ...m, archived: true } : m)),
    }))
  })

  test('card and detail say "Archived"; no "Open in Cashu.me"', async ({ page }) => {
    await page.goto('/?status=all')
    const card = page.locator('.mint-card', { hasText: 'Charlie Mint' })
    await expect(card.locator('.card-hdr-archived')).toHaveText('Archived')
    await page.goto('/mint/charlie.mint.example')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Charlie Mint')
    await expect(page.locator('.md-status-inline.archived')).toHaveText(/Archived/)
    await expect(page.getByRole('link', { name: /Cashu\.me/ })).toHaveCount(0)
  })

  test('Stats movers leave archived mints out', async ({ page }) => {
    await page.route('**/api/stats/reliability-movers**', r => r.fulfill({ json: {
      period: '7d',
      risers: [{ url: ARCHIVED_URL, name: 'Charlie Mint', delta: 15 }, { url: 'https://alpha.mint.example', name: 'Alpha Mint', delta: 12 }],
      fallers: [],
    } }))
    await page.goto('/stats')
    const panel = page.locator('.stats-movers-panel')
    await expect(panel).toContainText('Alpha Mint')
    await expect(panel).not.toContainText('Charlie Mint')
  })
})

test('a bad /mint/nostr link shows an error with "Add a mint", not the Dashboard', async ({ page }) => {
  await page.goto('/mint/nostr/not-an-naddr')
  await expect(page.getByTestId('naddr-error')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mint link not found')
  await expect(page).toHaveURL(/\/mint\/nostr\/not-an-naddr$/)
  await page.getByRole('button', { name: 'Add a mint' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('dialog')).toBeVisible()
})
