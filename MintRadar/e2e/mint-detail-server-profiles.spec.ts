import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import { installApiMocks, MOCK_MINTS } from './fixtures/mocks'

// Reviewer names from the server-side profile index (GET /api/mints/nostr-reviews: authorName, authorNip05)
// are only a fallback: the browser's own kind:0 result wins, NIP-05 is a claim unless verified, text only.
const MINT_URL = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(MINT_URL)}`
const now = Math.floor(Date.now() / 1000)

const keys = Array.from({ length: 4 }, () => generateSecretKey())
const [serverOnly, bothSources, hostile, verifiedClaim] = keys.map(k => getPublicKey(k)) as [string, string, string, string]

const review = (pubkey: string, i: number, extra: Record<string, string>) => ({
  id: `evt-${i}`.padEnd(64, '0'), pubkey, content: `Review ${i}`, rating: 5, createdAt: now - i * 60, source: 'nostr', ...extra,
})

const REVIEWS = [
  review(serverOnly, 0, { authorName: 'Server Sally', authorNip05: 'sally@example.com' }),
  review(bothSources, 1, { authorName: 'Server Name', authorNip05: 'server@example.com' }),
  review(hostile, 2, { authorName: '<img src=x onerror="window.__xss=1"><b>bold</b>', authorNip05: 'x<script>@example.com' }),
  review(verifiedClaim, 3, { authorName: 'Vera', authorNip05: 'vera@example.com' }),
]

async function mockRelays(page: Page): Promise<void> {
  const browserProfile = finalizeEvent({ kind: 0, created_at: now, tags: [], content: JSON.stringify({ name: 'Browser Bob' }) }, keys[1]!)
  await page.routeWebSocket(/^wss:\/\//, ws => {
    ws.onMessage(message => {
      let parsed: unknown
      try { parsed = JSON.parse(typeof message === 'string' ? message : message.toString()) } catch { return }
      if (!Array.isArray(parsed)) return
      const [verb, subId, filter] = parsed as [string, string, { kinds?: number[]; authors?: string[] } | undefined]
      if (verb === 'EVENT') { ws.send(JSON.stringify(['OK', (parsed[1] as { id?: string }).id ?? '', true, ''])); return }
      if (verb !== 'REQ') return
      if (filter?.kinds?.includes(0) && filter.authors?.includes(bothSources)) ws.send(JSON.stringify(['EVENT', subId, browserProfile]))
      ws.send(JSON.stringify(['EOSE', subId]))
    })
  })
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/nostr-reviews**', route => route.fulfill({ json: REVIEWS }))
  await page.route('**/api/nip05/verify**', route => {
    const q = new URL(route.request().url()).searchParams
    return route.fulfill({ json: { verified: q.get('name') === 'vera' } })
  })
    await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-tab', { hasText: 'Reviews' }).click()
  await expect(page.locator('.review-card').first()).toBeVisible({ timeout: 15_000 })
})

const card = (page: Page, pubkey: string) => page.locator('.review-card', { has: page.locator('.review-author-npub', { hasText: npubEncode(pubkey).slice(0, 10) }) })

test.describe('Mint Detail: reviewer names from the server profile index', () => {
  test('a reviewer with only a server profile gets the name, a claimed NIP-05 and the npub fragment', async ({ page }) => {
    const c = card(page, serverOnly)
    await expect(c.locator('.review-author-name-text')).toContainText('Server Sally')
    await expect(c.locator('.review-author-nip05-claimed')).toHaveText('claimed NIP-05: sally@example.com')
    await expect(c.locator('.review-author-nip05')).toHaveCount(0)
    await expect(c.locator('.review-author-npub')).toContainText(npubEncode(serverOnly).slice(0, 10))
    await expect(c.locator('.review-avatar-fallback')).toHaveText('S')
  })

  test('a reviewer the browser found a profile for keeps the browser name', async ({ page }) => {
    const c = card(page, bothSources)
    await expect(c.locator('.review-author-name-text')).toContainText('Browser Bob')
    await expect(c.locator('.review-author-name-text')).not.toContainText('Server Name')
    await expect(c.locator('.review-author-nip05-claimed')).toHaveCount(0)
  })

  test('hostile profile text renders as text only', async ({ page }) => {
    const c = card(page, hostile)
    const name = c.locator('.review-author-name-text')
    await expect(name).toContainText('<img src=x onerror="window.__xss=1"><b>bold</b>')
    await expect(name.locator('img, b, script')).toHaveCount(0)
    await expect(c.locator('.review-author-nip05-claimed')).toHaveText('claimed NIP-05: x<script>@example.com')
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  })

  test('a NIP-05 shows as verified (no "claimed") only after the existing verification confirms it', async ({ page }) => {
    const c = card(page, verifiedClaim)
    await expect(c.locator('.review-author-nip05')).toHaveText('vera@example.com')
    await expect(c.locator('.review-author-nip05-claimed')).toHaveCount(0)
  })

  test('server names count as named for the Hide anon filter', async ({ page }) => {
    await expect(page.locator('.reviews-filter-chip', { hasText: 'Hide anon' })).toHaveText('Hide anon · 0')
  })
})
