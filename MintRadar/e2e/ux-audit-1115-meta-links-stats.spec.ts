import { test, expect, type Page } from '@playwright/test'
import * as nip19 from 'nostr-tools/nip19'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS, MOCK_MINTS, TEST_PUBKEY_HEX } from './fixtures/mocks'
import { networkQuiet } from './fixtures/settle'

// UI/UX audit fixes, meta, links and Stats (2026-11-15): the not-tracked / invalid mint pages have their own title, the
// manifest-style mobile meta is present, the NIP-87 announcement link carries relay hints, watchlist sync logs nothing,
// and the movers' methodology note sits above the rows.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test('a /mint/ address that is not tracked gets the "Mint not found" title, also after in-app navigation', async ({ page }) => {
  await page.goto('/stats')
  await expect(page).toHaveTitle(/Stats/i)
  await page.evaluate(() => { history.pushState(null, '', '/mint/' + encodeURIComponent('https://nope.example')); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.locator('.md-not-tracked-title')).toBeVisible()
  await expect(page).toHaveTitle('Mint not found | MintRadar')
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
})

test('index.html has both the standard and the Apple mobile web app meta', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
})

test('the NIP-87 announcement link is an nevent with relay hints, the author and kind 38172', async ({ page }) => {
  const ALPHA = MOCK_MINTS[0]!.url
  const id = 'e'.repeat(64), author = 'a'.repeat(64)
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => m.url === ALPHA
    ? { ...m, nostrAnnounceId: id, nostrAnnouncePubkey: author, nostrAnnounceD: 'alpha', nostrAnnouncedAt: '2026-11-01T10:00:00.000Z', nostrCheckedAt: '2026-11-15T10:00:00.000Z' }
    : m) }))
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  const link = page.getByTestId('md-nip87').locator('a').first()
  await expect(link).toBeVisible()
  const href = (await link.getAttribute('href'))!
  expect(href.startsWith('https://njump.me/nevent1')).toBe(true)
  const d = nip19.decode(href.replace('https://njump.me/', ''))
  if (d.type !== 'nevent') throw new Error(d.type)
  expect(d.data.id).toBe(id)
  expect(d.data.author).toBe(author)
  expect(d.data.kind).toBe(38172)
  expect(d.data.relays!.length).toBeGreaterThan(0)
  expect(d.data.relays!.every(r => r.startsWith('wss://'))).toBe(true)
})

// The sync debug lines are dev-build only now (import.meta.env.DEV, dropped from the production bundle); none of them,
// in any build, carries the signed-in pubkey.
test('watchlist sync never writes the signed-in pubkey to the console', async ({ page }) => {
  const logs: string[] = []
  page.on('console', m => { if (m.type() === 'log') logs.push(m.text()) })
  await loginAs(page)
  await page.goto('/watchlist')
  await expect(page.locator('.wl-empty, .wl-grid').first()).toBeVisible()
  await expect.poll(() => logs.some(l => l.startsWith('sync: complete'))).toBe(true)
  expect(logs.filter(l => l.includes(TEST_PUBKEY_HEX.slice(0, 8)))).toEqual([])
})

async function openStats(page: Page, width: number) {
  // The note is on the 7d view only since 2026-11-26: a date whose 7 days hold v2 and v3.
  await page.clock.setFixedTime(new Date('2026-10-09T12:00:00Z'))
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/stats')
  await networkQuiet(page)
}
for (const width of [1440, 390]) {
  test(`${width}px: the movers' methodology note sits under the panel head, above the Risers list`, async ({ page }) => {
    await openStats(page, width)
    const panel = page.locator('.stats-movers-panel')
    const note = panel.locator('.stats-movers-note')
    await expect(note).toBeVisible()
    await expect(note).toHaveAttribute('role', 'note')
    const [headB, noteB, risersB] = await Promise.all([
      panel.locator('.stats-panel-head').boundingBox(), note.boundingBox(), panel.locator('.stats-movers-section-label.up').boundingBox(),
    ])
    expect(noteB!.y).toBeGreaterThanOrEqual(headB!.y + headB!.height - 0.5)
    expect(noteB!.y + noteB!.height).toBeLessThanOrEqual(risersB!.y + 0.5)
  })
}
