import { test, expect, type Locator, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { installApiMocks, mockRelays, probePayload, MOCK_MINTS } from './fixtures/mocks'
import { ATTESTATION_NPUB } from '../src/constants/healthAssertionPage'
import { ATTESTATION_PUBKEY_HEX } from '../src/utils/healthAssertionConstants'

// Every copy button the app has: the clipboard holds EXACTLY the expected string, a visible confirmation shows, and it goes
// back to normal by itself (waited for with an auto-retrying expect, never a sleep). Already covered elsewhere, not repeated
// here: the account menu's npub (profile-dropdown.spec.ts), the Mint Detail share link under the mint name (mint-detail.spec.ts),
// the pairing link in the login dialog (login.spec.ts), the keyset id (mint-detail-keysets.spec.ts).
// The Watchlist and the Methodology page have no copy button (checked at the end: if one is added it needs a test).

const ALPHA = MOCK_MINTS[0]!.url
const MINT_PUBKEY = '02' + 'ab'.repeat(32)
const SECOND_URL = 'https://alpha-mirror.mint.example'
const EMAIL = 'ops@alpha.example'
const TWITTER = '@alpha_mint'
const reviewerSk = generateSecretKey()
const reviewerPk = getPublicKey(reviewerSk)
const REVIEW_ID = 'ab'.repeat(32)

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mint/probe**', route => {
    const p = probePayload(ALPHA)
    return route.fulfill({
      json: {
        ...p,
        info: {
          ...p.info,
          pubkey: MINT_PUBKEY,
          urls: [ALPHA, SECOND_URL],
          contact: [{ method: 'email', info: EMAIL }, { method: 'twitter', info: TWITTER }, { method: 'nostr', info: nip19.npubEncode(reviewerPk) }],
        },
      },
    })
  })
  await page.route('**/api/mints/nostr-reviews**', route => route.fulfill({
    json: [{ id: REVIEW_ID, pubkey: reviewerPk, content: 'Works well for small amounts.', rating: 5, createdAt: Math.floor(Date.now() / 1000) - 3600, source: 'nostr' }],
  }))
})

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** Clicks a button that swaps its copy icon for a check mark, and waits for it to swap back. */
async function expectIconCopy(page: Page, button: Locator, expected: string) {
  await expect(button.locator('svg.lucide-check'), 'idle: no confirmation yet').toHaveCount(0)
  await button.click()
  await expect(button.locator('svg.lucide-check'), 'confirmation shows').toHaveCount(1)
  expect(await clipboard(page)).toBe(expected)
  await expect(button.locator('svg.lucide-check'), 'confirmation goes away by itself').toHaveCount(0)
}

async function openMint(page: Page) {
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
}

test.describe('Mint Detail copy buttons', () => {
  test('public key: the full hex key', async ({ page }) => {
    await openMint(page)
    const row = page.locator('.md-info-row', { has: page.locator('.md-info-label', { hasText: 'Public key' }) })
    await expectIconCopy(page, row.locator('button'), MINT_PUBKEY)
  })

  test('URLs: each row copies its own URL', async ({ page }) => {
    await openMint(page)
    const rows = page.locator('.md-info-row', { has: page.locator('.md-info-label', { hasText: 'URLs' }) }).locator('button')
    await expect(rows).toHaveCount(2)
    // FINDING (application, not fixed here): these buttons show no confirmation at all (the state is set but the icon is never
    // swapped), so only the clipboard is asserted. See docs/claude/e2e-conventions.md, "Findings".
    for (const [i, expected] of [ALPHA, SECOND_URL].entries()) {
      await rows.nth(i).click()
      await expect.poll(() => clipboard(page), { message: `URL row ${i} copies its URL` }).toBe(expected)
    }
  })

  test('contacts: email, twitter and nostr copy their value', async ({ page }) => {
    await openMint(page)
    const card = (type: string) => page.locator('.md-contact-card', { has: page.locator('.md-contact-type', { hasText: type }) }).locator('button')
    await expectIconCopy(page, card('Email'), EMAIL)
    await expectIconCopy(page, card('Twitter'), TWITTER)
    await expectIconCopy(page, card('Nostr'), nip19.npubEncode(reviewerPk))
  })

  test('reviews: the reviewer npub and the link to the review', async ({ page }) => {
    await openMint(page)
    await page.locator('.md-tab', { hasText: 'Reviews' }).click()
    const npub = page.getByRole('button', { name: 'Copy reviewer npub' })
    await expectIconCopy(page, npub, nip19.npubEncode(reviewerPk))
    const link = page.getByRole('button', { name: 'Copy link to this review' })
    await expectIconCopy(page, link, `${new URL(page.url()).origin}/mint/${encodeURIComponent(ALPHA)}#review-${REVIEW_ID}`)
  })

  test('QR dialog: the mint URL, the button says Copied and goes back to Copy', async ({ page }) => {
    await openMint(page)
    await page.locator('.md-quick-btn', { hasText: 'Mint QR' }).click()
    const copy = page.locator('.qr-modal-copy')
    await expect(copy).toHaveText('Copy')
    await copy.click()
    await expect(copy).toHaveText('Copied')
    expect(await clipboard(page)).toBe(ALPHA)
    await expect(copy).toHaveText('Copy')
  })
})

test.describe('code blocks (/for-wallets)', () => {
  test('every copy button copies exactly the code shown next to it, and says Copied then Copy', async ({ page }) => {
    await page.goto('/for-wallets')
    const blocks = page.locator('.doc-code')
    await expect(blocks.first()).toBeVisible()
    const n = await blocks.count()
    expect(n, 'the page has code blocks').toBeGreaterThanOrEqual(8)
    for (let i = 0; i < n; i++) {
      const block = blocks.nth(i)
      const shown = (await block.locator('pre code').textContent()) ?? ''
      const button = block.locator('button.doc-copy-btn')
      await expect(button).toHaveText('Copy')
      await button.click()
      await expect(button).toHaveText('Copied')
      expect(await clipboard(page), `code block ${i}: the clipboard equals the text shown`).toBe(shown)
    }
    // The confirmations all run out by themselves (the timers run side by side, so this does not add up to n x 2 s).
    for (let i = 0; i < n; i++) await expect(blocks.nth(i).locator('button.doc-copy-btn'), `code block ${i}: back to Copy`).toHaveText('Copy')
  })

  test('the npub block shows and copies the npub of the attestation key, the hex block the key itself', async ({ page }) => {
    await page.goto('/for-wallets')
    expect(ATTESTATION_NPUB).toBe(nip19.npubEncode(ATTESTATION_PUBKEY_HEX))
    for (const [title, expected] of [
      ['MintRadar Health public key (npub)', nip19.npubEncode(ATTESTATION_PUBKEY_HEX)],
      ['MintRadar Health public key (hex)', ATTESTATION_PUBKEY_HEX],
    ] as const) {
      const button = page.getByRole('button', { name: `Copy: ${title}` })
      await expect(page.getByLabel(title).locator('code')).toHaveText(expected)
      await button.click()
      await expect(button).toHaveText('Copied')
      expect(await clipboard(page)).toBe(expected)
      await expect(button).toHaveText('Copy')
    }
  })

  test('the curl example copies the text of its block', async ({ page }) => {
    await page.goto('/for-wallets')
    const block = page.locator('.doc-code', { has: page.locator('.doc-code-head span', { hasText: /^curl$/ }) }).first()
    const shown = (await block.locator('pre code').textContent()) ?? ''
    expect(shown).toMatch(/^curl /)
    await block.locator('button.doc-copy-btn').click()
    expect(await clipboard(page)).toBe(shown)
  })
})

test.describe('pages without a copy button', () => {
  for (const path of ['/methodology', '/watchlist']) {
    test(`${path} has none (a new one needs a test in this file)`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: /copy/i })).toHaveCount(0)
      await expect(page.locator('.doc-copy-btn')).toHaveCount(0)
    })
  }
})
