import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Reviews tab (Task Y L): a review whose author key the mint itself lists as a Nostr contact (and that is not an operator review)
// carries the neutral label "Key listed as this mint's contact". The server sets `listedAsContact` per review from the stored
// contacts; the label never changes a count, an average or a filter. Wording of the operator rule on the public pages.

const MINT_URL = MOCK_MINTS[0]!.url
const LABEL = "Key listed as this mint's contact"
const now = Math.floor(Date.now() / 1000)
const hex = (c: string) => c.repeat(64)

const REVIEWS = [
  { id: 'e1', pubkey: hex('a'), content: 'Works for me, small amounts only.', rating: 5, createdAt: now - 60, source: 'nostr', listedAsContact: true },
  { id: 'e2', pubkey: hex('b'), content: 'Slow melts in the evening.', rating: 3, createdAt: now - 120, source: 'nostr', listedAsContact: false },
  { id: 'e3', pubkey: hex('c'), content: 'No problems so far.', rating: 4, createdAt: now - 180, source: 'nostr', listedAsContact: false },
]

async function open(page: Page, width: number, height: number, reviews: unknown[] = REVIEWS) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({ json: reviews }))
  await resize(page, width, height)
  await page.goto(`/mint/${encodeURIComponent(MINT_URL)}`)
  await page.getByRole('button', { name: 'Reviews', exact: true }).click()
  await expect(page.locator('.review-card')).toHaveCount(reviews.length)
  await layoutReady(page)
}

const card = (page: Page, id: string) => page.locator(`#review-${id}`)

for (const [width, height] of [[1440, 900], [390, 844], [320, 640]] as const) {
  test(`one labelled review among three @ ${width}px: the label is on that review only, 12px or more, wraps, no overflow`, async ({ page }) => {
    await open(page, width, height)
    await expect(page.locator('.review-contact-label')).toHaveCount(1)
    await expect(card(page, 'e1').locator('.review-contact-label')).toHaveText(LABEL)
    await expect(card(page, 'e2').locator('.review-contact-label')).toHaveCount(0)
    await expect(card(page, 'e3').locator('.review-contact-label')).toHaveCount(0)

    const m = await card(page, 'e1').evaluate(c => {
      const label = c.querySelector('.review-contact-label') as HTMLElement
      const cr = c.getBoundingClientRect(), lr = label.getBoundingClientRect()
      const cs = getComputedStyle(label)
      return {
        fontPx: parseFloat(cs.fontSize),
        insideCard: lr.left >= cr.left - 0.5 && lr.right <= cr.right + 0.5,
        fitsItsBox: label.scrollWidth <= label.clientWidth + 1,
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
        lines: Math.round(lr.height / parseFloat(cs.lineHeight)),
      }
    })
    expect(m.fontPx).toBeGreaterThanOrEqual(12)
    expect(m.insideCard).toBe(true)
    expect(m.fitsItsBox).toBe(true)
    expect(m.docOverflow).toBeLessThanOrEqual(0)
    if (width === 320) expect(m.lines).toBeGreaterThanOrEqual(1) // it may wrap onto a second line, never clipped
  })
}

test('the label changes no count, average or filter: chips and list are the same with and without a flag', async ({ page }) => {
  await open(page, 390, 844)
  const chips = async () => (await page.locator('.reviews-filter-chip').allTextContents()).map(t => t.trim())
  const flagged = await chips()
  expect(flagged).toEqual(['All · 3', '5★ · 1', 'Critical · 0', 'Hide anon · 3'])
  const tile = (await page.locator('.md-sc', { hasText: 'Community rating' }).innerText()).replace(/\s+/g, ' ')

  const page2 = await page.context().newPage()
  await open(page2, 390, 844, REVIEWS.map(r => ({ ...r, listedAsContact: false })))
  await expect(page2.locator('.review-contact-label')).toHaveCount(0)
  expect((await page2.locator('.reviews-filter-chip').allTextContents()).map(t => t.trim())).toEqual(flagged)
  expect((await page2.locator('.md-sc', { hasText: 'Community rating' }).innerText()).replace(/\s+/g, ' ')).toBe(tile)

  // a filter that keeps the flagged review keeps its label; one that drops it drops it with the review
  await page.getByRole('button', { name: /^5★/ }).click()
  await expect(page.locator('.review-card')).toHaveCount(1)
  await expect(page.locator('.review-contact-label')).toHaveCount(1)
  await page.getByRole('button', { name: /^Critical/ }).click()
  await expect(page.locator('.review-contact-label')).toHaveCount(0)
})

test('a response without the field (an older cache) shows no label and no error', async ({ page }) => {
  await open(page, 390, 844, REVIEWS.map(r => { const copy: Record<string, unknown> = { ...r }; delete copy['listedAsContact']; return copy }))
  await expect(page.locator('.review-contact-label')).toHaveCount(0)
})

test('the label carries no verdict wording', async ({ page }) => {
  await open(page, 390, 844)
  const text = await page.locator('.review-contact-label').innerText()
  expect(text).not.toMatch(/\b(operator|owner|trusted|verified|fake|suspicious|safe|biased|conflict)\b/i)
})

test.describe('the operator rule is described as it works', () => {
  const SENTENCE = "Reviews from a key that is both listed as the mint's Nostr contact and the author of the mint's NIP-87 announcement"

  test('Methodology and About say contact AND announcement, and that a contact-only key is counted and labelled', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto('/methodology')
    const meth = page.locator('main')
    await expect(meth).toContainText(SENTENCE)
    await expect(meth).toContainText(`carries the neutral label "${LABEL}"`)
    await expect(meth).not.toContainText(/written by a mint.s own operator/i)
    await page.goto('/about')
    const about = page.locator('main')
    await expect(about).toContainText(SENTENCE)
    await expect(about).toContainText('A review from a key the mint lists only as a contact is counted and carries a neutral label.')
    await expect(about).not.toContainText(/written by a mint.s own operator/i)
  })

  test('the /for-wallets field table describes operatorCount by the same rule', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto('/for-wallets')
    const row = page.locator('tr', { hasText: 'reviews.operatorCount' })
    await expect(row).toContainText("Reviews from a key that is both listed as the mint's Nostr contact and the author of its NIP-87 announcement")
    await expect(page.locator('main')).not.toContainText("mint's own operator")
  })
})
