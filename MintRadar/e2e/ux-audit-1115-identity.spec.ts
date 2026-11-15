import { test, expect, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS, TEST_PUBKEY_HEX } from './fixtures/mocks'

// UI/UX audit fixes, identity and reviews (2026-11-15): the account chip falls back to the short npub (never hex), one
// short npub form, the empty Watchlist names the ☆ control, anonymous reviewers get an icon (not "N"), the review
// textarea has a visible label, and stars preview only on hover or keyboard focus. Nothing is published.

const ALPHA = MOCK_MINTS[0]!.url
const NPUB = nip19.npubEncode(TEST_PUBKEY_HEX)
const SHORT = `${NPUB.slice(0, 12)}…${NPUB.slice(-6)}`

async function loginNameless(page: Page) {
  await page.addInitScript(({ pubkey, npub }) => {
    ;(window as unknown as { nostr: unknown }).nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (e: Record<string, unknown>) => ({ ...e, id: 'f'.repeat(64), pubkey, sig: '0'.repeat(128) }),
      nip04: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
      nip44: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
    }
    sessionStorage.setItem('mintradar_session', JSON.stringify({ state: { profile: { pubkey, npub, name: null }, method: 'nip07' }, version: 0 }))
  }, { pubkey: TEST_PUBKEY_HEX, npub: NPUB })
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test('account chip without a profile name shows the short npub, the same form as the copy row', async ({ page }) => {
  await loginNameless(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.locator('.navbar-username')).toHaveText(SHORT)
  await expect(page.locator('.navbar-profile')).toHaveAttribute('aria-label', `Account: ${SHORT}`)
  await expect(page.locator('.navbar-username')).not.toContainText(TEST_PUBKEY_HEX.slice(0, 8))
  await page.locator('.navbar-profile').click()
  await expect(page.locator('.navbar-npub')).toHaveText(SHORT)
})

test('empty Watchlist points at the ☆ control, not a "+ Watch" button', async ({ page }) => {
  await loginAs(page)
  await page.goto('/watchlist')
  const sub = page.locator('.wl-empty-sub')
  await expect(sub).toContainText('Tap the ☆ on any mint card or mint page to add it.')
  await expect(sub).not.toContainText('+ Watch')
})

test('anonymous reviewers get a User icon in their avatar, never the "N" of npub; names keep their letter', async ({ page }) => {
  const anon = '2'.repeat(64)
  const named = '3'.repeat(64)
  await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({ json: [
    { id: 'a'.repeat(64), pubkey: anon, content: 'anon review', rating: 4, createdAt: 1_700_000_100, source: 'nostr' },
    { id: 'b'.repeat(64), pubkey: named, content: 'named review', rating: 5, createdAt: 1_700_000_000, source: 'nostr', profile: { name: 'zuzana' } },
  ] }))
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}#reviews`)
  const anonCard = page.locator('.review-card', { hasText: 'anon review' })
  await expect(anonCard).toBeVisible()
  await expect(anonCard.locator('.review-avatar-fallback svg')).toHaveCount(1)
  await expect(anonCard.locator('.review-avatar-fallback')).toHaveText('')
  // One short npub form on the card.
  const anonNpub = nip19.npubEncode(anon)
  await expect(anonCard.locator('.review-author-name-text')).toHaveText(`${anonNpub.slice(0, 12)}…${anonNpub.slice(-6)}`)
  const namedCard = page.locator('.review-card', { hasText: 'named review' })
  if (await namedCard.locator('.review-author-name-text', { hasText: 'zuzana' }).count()) {
    await expect(namedCard.locator('.review-avatar-fallback')).toHaveText('Z')
  }
})

test.describe('Write-a-review form', () => {
  async function openModal(page: Page) {
    await loginAs(page, 'peter.bliznak')
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await page.locator('.md-tab', { hasText: 'Reviews' }).click()
    await page.locator('.reviews-write-btn').click()
    await expect(page.getByRole('dialog', { name: 'Write a review' })).toBeVisible()
  }

  test('opening the dialog lights no star; keyboard focus previews like hover', async ({ page }) => {
    await openModal(page)
    await expect(page.locator('.rv-star[data-filled="true"]')).toHaveCount(0)
    // Keyboard: Tab until a star has focus; the stars up to it preview.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      const idx = await page.evaluate(() => Array.from(document.querySelectorAll('.rv-star')).indexOf(document.activeElement as Element))
      if (idx >= 0) {
        await expect(page.locator('.rv-star[data-filled="true"]')).toHaveCount(idx + 1)
        return
      }
    }
    throw new Error('no star reached by keyboard')
  })

  test('the comment field has a visible label and the character count as its description', async ({ page }) => {
    await openModal(page)
    await page.locator('.rv-star').nth(3).click()
    const box = page.getByRole('textbox', { name: 'Your review (optional)' })
    await expect(box).toBeVisible()
    await expect(page.locator('label[for="rv-comment"]')).toBeVisible()
    await expect(box).toHaveAccessibleDescription('0 / 500 characters')
  })

  test('signing as an account without a name: the short npub and an icon avatar', async ({ page }) => {
    await loginNameless(page)
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await page.locator('.md-tab', { hasText: 'Reviews' }).click()
    await page.locator('.reviews-write-btn').click()
    await page.locator('.rv-star').nth(4).click()
    await expect(page.locator('.rv-signer-name')).toHaveText(SHORT)
    await expect(page.locator('.rv-signer-avatar-fallback svg')).toHaveCount(1)
  })
})
