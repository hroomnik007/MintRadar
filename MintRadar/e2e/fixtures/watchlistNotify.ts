import { expect, type Page, type Route } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { installApiMocks, MOCK_KNOWN_MINTS } from './mocks'

// Shared setup for the Watchlist notification specs: a logged-in user (real key) whose kind:10003 watchlist
// holds the mock mints, a mocked /api/notifications/* with per-mint behaviours, and IndexedDB flag seeding.

export const KNOWN = MOCK_KNOWN_MINTS.slice(0, 4).map(m => ({ ...m, online: true, degraded: false, latencyMs: 120, reliabilityScore: 80, uptimePct24h: 97 }))
export const URLS = KNOWN.map(m => m.url)
export const [ALPHA, BRAVO, CHARLIE, DELTA] = URLS as [string, string, string, string]
export const NAME: Record<string, string> = Object.fromEntries(KNOWN.map(m => [m.url, m.name!]))

const sk = generateSecretKey()
const pk = getPublicKey(sk)

export type Mode = 'ok' | '500' | '429' | 'abort' | 'gate'
export interface Api {
  calls: { path: string; body: Record<string, unknown> }[]
  mode: Mode
  byUrl: Record<string, Mode>
  release: () => void
}

export async function mockNotifyApi(page: Page): Promise<Api> {
  let release!: () => void
  let gate = new Promise<void>(r => { release = r })
  const api: Api = { calls: [], mode: 'ok', byUrl: {}, release: () => { release(); gate = new Promise<void>(r => { release = r }) } }
  await page.route('**/api/notifications/**', async (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
    api.calls.push({ path: new URL(route.request().url()).pathname.split('/').pop()!, body })
    const mode = api.byUrl[String(body['mintUrl'])] ?? api.mode
    if (mode === 'gate') await gate
    if (mode === '500') return route.fulfill({ status: 500, json: { error: 'Internal server error' } })
    if (mode === '429') return route.fulfill({ status: 429, json: { error: 'Too many requests. Try again later.' } })
    if (mode === 'abort') return route.abort('failed')
    return route.fulfill({ json: { success: true } })
  })
  return api
}

export interface Seed { url: string; down: boolean; up: boolean; confirmed: boolean }

/** A logged-in user (real key) whose kind:10003 watchlist holds `urls`; flags are then written to IndexedDB. */
export async function openWatchlist(page: Page, opts: { urls?: string[]; seed?: Seed[]; size?: { width: number; height: number } } = {}) {
  const { urls = URLS, seed = [], size = { width: 1440, height: 900 } } = opts
  const ev = finalizeEvent({ kind: 10003, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(urls) }, sk)
  await page.addInitScript(({ pubkey, npub }) => {
    const w = window as unknown as { __rejectSign?: boolean; nostr: unknown }
    w.nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (event: Record<string, unknown>) => {
        if (w.__rejectSign) throw new Error('User rejected')
        return { ...event, id: 'f'.repeat(64), pubkey, sig: '0'.repeat(128) }
      },
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
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
  await page.setViewportSize(size)
  await page.goto('/watchlist')
  await expect(page.locator('.wl-grid .mint-card')).toHaveCount(urls.length)
  await expect(page.locator('.wl-grid .notify-strip')).toHaveCount(urls.length)
  await seedFlags(page, seed)
}

export async function seedFlags(page: Page, seed: Seed[]) {
  if (!seed.length) return
  await page.evaluate(async (rows) => {
    const path = '/src/db/index.ts'
    const { db } = await import(/* @vite-ignore */ path)
    for (const r of rows) {
      await db.watchlist.update(r.url, { notifyOnDown: r.down, notifyOnUp: r.up, ...(r.confirmed ? { notifyConfirmedAt: new Date() } : {}) })
    }
  }, seed)
}

export const card = (page: Page, url: string) => page.locator('.wl-grid .mint-card', { has: page.locator('.card-name', { hasText: NAME[url]! }) })
export const down = (page: Page, url: string) => card(page, url).getByRole('button', { name: `Notify when ${NAME[url]} goes down` })
export const up = (page: Page, url: string) => card(page, url).getByRole('button', { name: `Notify when ${NAME[url]} is back up` })
export const msg = (page: Page, url: string) => card(page, url).locator('.notify-strip-msg')
export const flags = (page: Page, url: string) => page.evaluate(async (u) => {
  const path = '/src/db/index.ts'
  const { db } = await import(/* @vite-ignore */ path)
  const e = await db.watchlist.get(u)
  return e ? { down: e.notifyOnDown, up: e.notifyOnUp, confirmed: !!e.notifyConfirmedAt } : null
}, url)
export const subscribeCalls = (api: Api) => api.calls.filter(c => c.path === 'subscribe')
export const unsubscribeCalls = (api: Api) => api.calls.filter(c => c.path === 'unsubscribe')
