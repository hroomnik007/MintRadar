import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// The Watchlist's "Showing X of Y" line appears only when the list is cut short (X < Y). The Watchlist has
// no filter or search; the only way to show fewer than all is the 20-per-page list.

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const SHOTS = process.env['SHOTS']

const mintUrls = (n: number) => Array.from({ length: n }, (_, i) => `https://m${String(i).padStart(2, '0')}.mint.example`)

async function openWatchlist(page: Page, n: number, size = { width: 1440, height: 700 }) {
  const ev = finalizeEvent({ kind: 10003, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(mintUrls(n)) }, sk)
  await page.addInitScript(({ pubkey, npub }) => {
    ;(window as unknown as { nostr: unknown }).nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (event: Record<string, unknown>) => ({ ...event, id: 'f'.repeat(64), pubkey, sig: '0'.repeat(128) }),
      nip04: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
      nip44: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
    }
    sessionStorage.setItem('mintradar_session', JSON.stringify({ state: { profile: { pubkey, npub, name: 'E2E Tester' }, method: 'nip07' }, version: 0 }))
  }, { pubkey: pk, npub: nip19.npubEncode(pk) })
  await page.routeWebSocket(/^wss:\/\//, ws => ws.onMessage(message => {
    let parsed: unknown
    try { parsed = JSON.parse(String(message)) } catch { return }
    if (!Array.isArray(parsed)) return
    const [verb, subId, filter] = parsed as [string, string, { kinds?: number[] } | undefined]
    if (verb === 'EVENT') { ws.send(JSON.stringify(['OK', (parsed[1] as { id?: string }).id ?? '', true, ''])); return }
    if (verb !== 'REQ') return
    if (filter?.kinds?.includes(10003)) ws.send(JSON.stringify(['EVENT', subId, ev]))
    ws.send(JSON.stringify(['EOSE', subId]))
  }))
  await installApiMocks(page)
  await page.setViewportSize(size)
  await page.goto('/watchlist')
  await expect(page.locator('.wl-grid .mint-card').first()).toBeVisible()
}

test.describe('Watchlist — "Showing X of Y" only when the list is cut short', () => {
  test('equal numbers: no line, no empty block', async ({ page }) => {
    await openWatchlist(page, 3)
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
    await expect(page.locator('.wl-showing')).toHaveCount(0)
    await expect(page.getByText(/Showing \d+ of \d+/)).toHaveCount(0)
    // Nothing is left behind below the page body (no empty element adding space).
    expect(await page.locator('.watchlist-page > *').count()).toBe(2) // h1.sr-only + .wl-body
  })

  test('exactly one full page (20 of 20): no line', async ({ page }) => {
    await openWatchlist(page, 20)
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(20)
    await expect(page.locator('.wl-showing')).toHaveCount(0)
  })

  test('more than a page: the line shows how many of the total are on screen', async ({ page }) => {
    // A short viewport keeps the pagination sentinel well out of view, so the first page stays the only one.
    await openWatchlist(page, 60, { width: 1440, height: 500 })
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(20)
    await expect(page.locator('.wl-showing')).toHaveText('Showing 20 of 60')
  })

  test('the Dashboard keeps its own "Showing X of Y" note', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page)
    await page.goto('/?status=all')
    await expect(page.locator('.grid-showing-note')).toHaveText(/^Showing 4 of 4/)
  })

  for (const [width, height] of [[1440, 500], [390, 800]] as const) {
    test(`screenshot of a cut-short list ${width}px`, async ({ page }) => {
      test.skip(!SHOTS, 'set SHOTS=<dir> to write screenshots')
      await openWatchlist(page, 60, { width, height })
      const line = page.locator('.wl-showing')
      await expect(line).toHaveText('Showing 20 of 60')
      await page.waitForTimeout(400)
      const box = (await line.boundingBox())!
      const y = await page.evaluate(() => window.scrollY)
      await page.screenshot({
        path: `${SHOTS}/watchlist-showing-${width}.png`, fullPage: true,
        clip: { x: 0, y: Math.max(0, box.y + y - 420), width, height: 520 },
      })
    })
  }
})
