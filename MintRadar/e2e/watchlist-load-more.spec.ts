import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { installApiMocks, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// A watchlist longer than one page (20 cards) must load the rest while scrolling, no matter WHEN the list
// arrives relative to the loading skeleton. The pagination observer used to attach only if the sentinel
// existed when the list changed — a list that arrived while the skeleton was still up left it unattached
// for good ("Showing 20 of 60" forever).

const N = 60
const sk = generateSecretKey()
const pk = getPublicKey(sk)
const URLS = Array.from({ length: N }, (_, i) => `https://m${String(i).padStart(2, '0')}.mint.example`)
const KNOWN = MOCK_KNOWN_MINTS.slice(0, 4).map(m => ({ ...m, online: true, degraded: false }))

interface Relay { delayMs: number; remote: string[] | null }

async function setup(page: Page, relay: Relay, opts: { knownDelayMs?: number } = {}) {
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
    const isWatchlist = filter?.kinds?.includes(10003) ?? false
    setTimeout(() => {
      if (isWatchlist && relay.remote) {
        const ev = finalizeEvent({ kind: 10003, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(relay.remote) }, sk)
        ws.send(JSON.stringify(['EVENT', subId, ev]))
      }
      ws.send(JSON.stringify(['EOSE', subId]))
    }, isWatchlist ? relay.delayMs : 0)
  }))
  await installApiMocks(page)
  await page.route('**/api/mints/known', async r => {
    if (opts.knownDelayMs) await new Promise(res => setTimeout(res, opts.knownDelayMs))
    await r.fulfill({ json: KNOWN })
  })
  await page.setViewportSize({ width: 1440, height: 700 })
}

/** Put the 60-mint list into IndexedDB (owned by the test user), as a returning visitor would have it. */
async function seedIndexedDb(page: Page) {
  await page.goto('/')
  await expect(page.locator('.navbar-profile')).toBeVisible()
  await page.evaluate(async ({ urls, owner }) => {
    const path = '/src/db/index.ts'
    const { db } = await import(/* @vite-ignore */ path)
    await db.watchlist.clear()
    await db.watchlist.bulkPut(urls.map((url: string) => ({ url, addedAt: new Date(), notifyOnDown: false, notifyOnUp: false })))
    await db.meta.put({ key: 'watchlistOwner', value: owner })
  }, { urls: URLS, owner: pk })
}

async function scrollUntilAllLoaded(page: Page) {
  await expect.poll(async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    return page.locator('.wl-grid .mint-card').count()
  }, { timeout: 20000, intervals: [200, 300, 500] }).toBe(N)
  await expect(page.locator('.wl-showing')).toHaveCount(0)
}

test.describe(`Watchlist with ${N} mints loads every card`, () => {
  test('the list comes from IndexedDB while the sync skeleton is still showing', async ({ page }) => {
    const relay: Relay = { delayMs: 0, remote: null }
    await setup(page, relay)
    await seedIndexedDb(page)
    relay.delayMs = 2500 // the relay answers late → syncStatus stays "pending" (skeleton) while Dexie already holds the list
    await page.goto('/watchlist')
    await expect(page.locator('.skeleton-card').first()).toBeVisible()
    await expect(page.locator('.wl-grid .mint-card').first()).toBeVisible({ timeout: 10000 })
    await scrollUntilAllLoaded(page)
  })

  test('the list is ready before the known-mints skeleton ends', async ({ page }) => {
    const relay: Relay = { delayMs: 0, remote: null }
    await setup(page, relay, { knownDelayMs: 2500 })
    await seedIndexedDb(page)
    await page.goto('/watchlist')
    await expect(page.locator('.skeleton-card').first()).toBeVisible()
    await expect(page.locator('.wl-grid .mint-card').first()).toBeVisible({ timeout: 10000 })
    await scrollUntilAllLoaded(page)
  })

  test('the list comes from the relay (empty IndexedDB)', async ({ page }) => {
    await setup(page, { delayMs: 0, remote: URLS })
    await page.goto('/watchlist')
    await expect(page.locator('.wl-grid .mint-card').first()).toBeVisible({ timeout: 10000 })
    await scrollUntilAllLoaded(page)
  })
})
