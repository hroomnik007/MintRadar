import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const MINT_URL = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(MINT_URL)}`
const SHOTS = process.env.REVIEWS_SHOTS_DIR
// REVIEWS_W (optional) only exists for taking screenshots at a given width.
if (process.env.REVIEWS_W) test.use({ viewport: { width: Number(process.env.REVIEWS_W), height: 900 } })

type Kind = 'rated' | 'ratedOnly' | 'textOnly' | 'neither'
const hex = (n: number) => n.toString(16).padStart(64, '0')
function build(kinds: Kind[]) {
  const now = Math.floor(Date.now() / 1000)
  return kinds.map((k, i) => ({
    id: hex(i + 1), pubkey: hex(1000 + i), source: 'nostr', createdAt: now - i * 60,
    rating: k === 'rated' || k === 'ratedOnly' ? 5 : null,
    content: k === 'rated' ? `Great mint ${i}` : k === 'textOnly' ? `Comment only ${i}` : k === 'neither' ? '   ' : '',
  }))
}
async function open(page: Page, kinds: Kind[], mintOverrides: Record<string, unknown> = {}) {
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, ...mintOverrides } : m))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({ json: build(kinds) }))
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-tab', { hasText: 'Reviews' }).click()
}
const line = (page: Page) => page.locator('.reviews-empty-line')
const cards = (page: Page) => page.locator('.review-card')
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${page.viewportSize()!.width}.png`, fullPage: true })
}

const MIXED: Kind[] = ['rated', 'neither', 'ratedOnly', 'textOnly', 'neither', 'neither']

test.describe('Collapsed reviews without rating or comment', () => {
  test('line shows k, cards hide them, chips keep the total, expand/collapse works', async ({ page }) => {
    await open(page, MIXED)
    await expect(line(page)).toHaveText('3 reviews without a rating or comment · Show')
    await expect(line(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(cards(page)).toHaveCount(3)
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText('All · 6')
    await shot(page, 'collapsed')

    await line(page).click()
    await expect(line(page)).toHaveText('3 reviews without a rating or comment · Hide')
    await expect(line(page)).toHaveAttribute('aria-expanded', 'true')
    // 6 reviews, 5 per page: page 1 shows 5, page 2 the last one.
    await expect(cards(page)).toHaveCount(5)
    await page.getByRole('button', { name: '2', exact: true }).click()
    await expect(cards(page)).toHaveCount(1)
    await page.getByRole('button', { name: '1', exact: true }).click()
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText('All · 6')
    await shot(page, 'expanded')

    await line(page).focus()
    await page.keyboard.press('Enter')
    await expect(cards(page)).toHaveCount(3)
    await expect(line(page)).toContainText('Show')
  })

  test('k = 1 is singular; k = 0 shows no line', async ({ page }) => {
    await open(page, ['rated', 'neither', 'textOnly'])
    await expect(line(page)).toHaveText('1 review without a rating or comment · Show')
    await page.unroute('**/api/mints/nostr-reviews**')
    await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({ json: build(['rated', 'ratedOnly', 'textOnly']) }))
    await page.reload()
    await page.locator('.md-tab', { hasText: 'Reviews' }).click()
    await expect(cards(page)).toHaveCount(3)
    await expect(line(page)).toHaveCount(0)
  })

  test('all reviews empty: only the line and a neutral sentence, list appears after Show', async ({ page }) => {
    await open(page, ['neither', 'neither'])
    await expect(line(page)).toHaveText('2 reviews without a rating or comment · Show')
    await expect(cards(page)).toHaveCount(0)
    await expect(page.locator('.reviews-all-empty-note')).toHaveText('None of these reviews include a rating or a comment.')
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText('All · 2')
    await line(page).click()
    await expect(cards(page)).toHaveCount(2)
    await expect(page.locator('.reviews-all-empty-note')).toHaveCount(0)
  })

  test('5★ and Critical never show the line; All chip total unchanged', async ({ page }) => {
    await open(page, MIXED)
    await page.locator('.reviews-filter-chip', { hasText: '5★' }).click()
    await expect(line(page)).toHaveCount(0)
    await page.locator('.reviews-filter-chip', { hasText: 'Critical' }).click()
    await expect(line(page)).toHaveCount(0)
    await page.locator('.reviews-filter-chip', { hasText: 'All' }).click()
    await expect(line(page)).toBeVisible()
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText('All · 6')
  })

  test('Hide anon on: the line counts empties in the filtered set (anon authors → 0, no line)', async ({ page }) => {
    await open(page, MIXED)
    await page.getByRole('button', { name: /Hide anon/ }).click()
    // No profiles are mocked, so every author is anonymous: nothing left, no line.
    await expect(line(page)).toHaveCount(0)
    await expect(page.getByText('No reviews match this filter.')).toBeVisible()
  })
})

test.describe('Audit row without audit data', () => {
  test('breakdown row says "No audit data available"; Audit tab text unchanged', async ({ page }) => {
    await open(page, ['rated'], { auditNMints: null, auditNMelts: null, auditRecentTotal: null, auditRecentErrors: null, auditCheckedAt: null, auditSyncedAt: null })
    // On mobile the sidebar panel is hidden; the same rows live in the Details modal.
    const mobile = page.viewportSize()!.width <= 768
    if (mobile) await page.locator('.md-sc-reliability').click()
    const row = page.getByText('No audit data available', { exact: true }).locator('visible=true')
    await expect(row.first()).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/audit-row-${page.viewportSize()!.width}.png` })
    if (mobile) await page.keyboard.press('Escape')
    await page.locator('.md-tab', { hasText: 'Audit' }).click()
    await expect(page.getByText('No audit data available for this mint.')).toBeVisible()
  })
})
