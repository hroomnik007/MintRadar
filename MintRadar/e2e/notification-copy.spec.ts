import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS } from './fixtures/mocks'
import { mockNotifyApi, openWatchlist } from './fixtures/watchlistNotify'

// Notifications are opt-in, so no text may promise automatic ones. This scans every place that talks about them
// (Watchlist page, logged-out gate, empty state, both watch-login modals, the Watchlist meta description) for a
// "you'll get / you will get …" promise and for "get notified".

const PROMISE = /\b(you['’]ll|you will)\s+get\b[^.]{0,80}\b(notif|message|alert)/i
const GET_NOTIFIED = /\bget notified\b|\bnotifies you\b|\bthe moment\b/i
const OPTIONAL = /optional/i

async function expectNoPromise(page: Page, selector: string) {
  const text = await page.locator(selector).first().innerText()
  expect(text.length, `${selector} has text`).toBeGreaterThan(20)
  expect(text, `${selector}: "you'll get …" promise`).not.toMatch(PROMISE)
  expect(text, `${selector}: "get notified"`).not.toMatch(GET_NOTIFIED)
  return text
}

const metaDescription = (page: Page) => page.evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '')

test.describe('Notification copy matches the opt-in behaviour', () => {
  test('Watchlist page: explainer is the optional wording; no promise anywhere on the page or in the meta description', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page)
    const text = await expectNoPromise(page, '.watchlist-page')
    expect(text).toContain('Optional: turn on Nostr DMs for a watched mint. You get one message when it goes down and one when it comes back (at most one of each per hour), even if this tab is closed. Your Nostr client must support private messages.')
    const meta = await metaDescription(page)
    expect(meta).toMatch(OPTIONAL)
    expect(meta).not.toMatch(GET_NOTIFIED)
    expect(meta).not.toMatch(PROMISE)
  })

  test('empty Watchlist state', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page)
    await page.goto('/watchlist')
    await expect(page.getByText('No mints watched yet')).toBeVisible()
    const text = await expectNoPromise(page, '.wl-empty')
    expect(text).toMatch(/Turn on Nostr DMs per mint/)
  })

  test('logged-out Watchlist gate', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto('/watchlist')
    await expect(page.locator('.wl-login-gate')).toBeVisible()
    const text = await expectNoPromise(page, '.wl-login-gate')
    expect(text).toMatch(OPTIONAL)
  })

  test('watch-login modal on a Dashboard card', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto('/?status=all')
    await page.locator('.mint-card .card-star').first().click()
    const dialog = page.getByRole('dialog', { name: 'Watch this mint' })
    await expect(dialog).toBeVisible()
    const text = await dialog.innerText()
    expect(text).not.toMatch(PROMISE)
    expect(text).not.toMatch(GET_NOTIFIED)
    expect(text).toMatch(OPTIONAL)
  })

  test('watch-login modal on Mint Detail', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto(`/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`)
    await page.locator('.md-watch-star-hero').click()
    // (this modal has no dialog role)
    const dialog = page.locator('.rv-modal', { hasText: 'Watch this mint' })
    await expect(dialog).toBeVisible()
    const text = await dialog.innerText()
    expect(text).not.toMatch(PROMISE)
    expect(text).not.toMatch(GET_NOTIFIED)
    expect(text).toMatch(OPTIONAL)
  })

  test('the scanner itself catches the old wording', () => {
    expect("Your list syncs over Nostr and you'll get a message if this mint goes offline").toMatch(PROMISE)
    expect("you'll get alerts if status changes.").toMatch(PROMISE)
    expect('you will get a notification when').toMatch(PROMISE)
    expect('get notified the moment one goes offline').toMatch(GET_NOTIFIED)
    expect('You get one message when it goes down and one when it comes back').not.toMatch(PROMISE)
  })
})
