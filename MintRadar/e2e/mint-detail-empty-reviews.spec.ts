import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const MINT_URL = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(MINT_URL)}`
const SHOTS = process.env.REVIEWS_SHOTS_DIR
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

const MIXED: Kind[] = ['rated', 'neither', 'ratedOnly', 'textOnly', 'neither', 'neither']

test.describe('Empty reviews (no rating and no comment) are omitted', () => {
  test('cards and chips exclude empty events; no Show/Hide line', async ({ page }) => {
    await open(page, MIXED)
    await expect(line(page)).toHaveCount(0)
    await expect(cards(page)).toHaveCount(3)
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText('All · 3')
  })

  test('all-empty set shows no cards and no empty-line', async ({ page }) => {
    await open(page, ['neither', 'neither'])
    await expect(line(page)).toHaveCount(0)
    await expect(cards(page)).toHaveCount(0)
    await expect(page.locator('.reviews-all-empty-note')).toHaveCount(0)
  })

  test('5★ still lists rated-only reviews', async ({ page }) => {
    await open(page, MIXED)
    await page.locator('.reviews-filter-chip', { hasText: '5★' }).click()
    await expect(line(page)).toHaveCount(0)
    await expect(cards(page)).toHaveCount(2)
  })
})

test.describe('Audit row without audit data', () => {
  test('breakdown row says "No cashu.info audit data: neutral"; Audit tab text unchanged', async ({ page }) => {
    await open(page, ['rated'], { auditNMints: null, auditNMelts: null, auditRecentTotal: null, auditRecentErrors: null, auditCheckedAt: null, auditSyncedAt: null, auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null })
    const mobile = page.viewportSize()!.width <= 768
    if (mobile) await page.locator('.md-sc-reliability').click()
    const row = page.getByText('No cashu.info audit data: neutral', { exact: true }).locator('visible=true')
    await expect(row.first()).toBeVisible()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/audit-row-${page.viewportSize()!.width}.png` })
    if (mobile) await page.keyboard.press('Escape')
    await page.locator('.md-tab', { hasText: 'Audit' }).click()
    await expect(page.getByText('No audit data available for this mint.')).toBeVisible()
  })
})
