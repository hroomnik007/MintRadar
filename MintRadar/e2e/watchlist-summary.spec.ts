import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { installApiMocks, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Watchlist summary line above the explainer: "<n> mints watched · <n> online · ..." (src/utils/watchlistSummary.ts).
// It counts ALL watched mints, uses the one status rule, and is rendered only together with the normal grid.

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const base = MOCK_KNOWN_MINTS[0]!

type Flags = { online: boolean; degraded?: boolean; archived?: boolean }
const known = (n: string, f: Flags) => ({ ...base, url: `https://${n}.mint.example`, name: `Mint ${n}`, degraded: false, archived: false, ...f })
const url = (n: string) => `https://${n}.mint.example`

// online x2, degraded x1, offline x1, archived x1, plus one watched URL that the known list does not have.
const MIXED_KNOWN = [
  known('a', { online: true }), known('b', { online: true }), known('c', { online: false, degraded: true }),
  known('d', { online: false }), known('e', { online: false, archived: true }),
]
const MIXED_URLS = ['a', 'b', 'c', 'd', 'e', 'x'].map(url)
const MIXED_TEXT = '6 mints watched · 2 online · 1 degraded · 1 offline · 1 archived · 1 not tracked'

const summary = (page: Page) => page.getByTestId('wl-summary')

async function setup(page: Page, opts: { urls: string[]; known: unknown[]; knownMode?: 'ok' | 'hold' | 'fail'; size?: [number, number] }) {
  const ev = finalizeEvent({ kind: 10003, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify(opts.urls) }, sk)
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
  let release: () => void = () => {}
  const held = new Promise<void>(r => { release = r })
  let requested = false
  await page.route('**/api/mints/known', async route => {
    requested = true
    if (opts.knownMode === 'hold') await held
    if (opts.knownMode === 'fail') return route.fulfill({ status: 500, json: { error: 'Internal server error' } })
    return route.fulfill({ json: opts.known })
  })
  const [w, h] = opts.size ?? [1440, 900]
  await page.setViewportSize({ width: w, height: h })
  await page.goto('/watchlist')
  return { release: async () => { await expect.poll(() => requested).toBe(true); release() } }
}

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`${w}px: the mixed fixture reads "${MIXED_TEXT}", above the explainer and the cards`, async ({ page }) => {
    await setup(page, { urls: MIXED_URLS, known: MIXED_KNOWN, size: [w, h] })
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(6)
    await expect(summary(page)).toHaveCount(1)
    await expect(summary(page)).toHaveText(MIXED_TEXT)
    const s = (await summary(page).boundingBox())!
    const e = (await page.locator('.wl-notify-explainer').boundingBox())!
    const g = (await page.locator('.wl-grid').boundingBox())!
    expect(s.y + s.height).toBeLessThanOrEqual(e.y + 1)
    expect(e.y + e.height).toBeLessThanOrEqual(g.y + 1)
    // Muted, no link, no tooltip, no live region, text floor.
    await expect(summary(page).locator('a, button, svg, img, [title]')).toHaveCount(0)
    expect(await summary(page).getAttribute('aria-live')).toBeNull()
    const size = await summary(page).evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(w <= 767 ? 12 : 11.5)
    expect(s.x + s.width).toBeLessThanOrEqual(w)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test('all online and a single mint: only the segments that have a mint, singular "1 mint"', async ({ page }) => {
  await setup(page, { urls: ['a', 'b', 'c'].map(url), known: ['a', 'b', 'c'].map(n => known(n, { online: true })) })
  await expect(summary(page)).toHaveText('3 mints watched · 3 online')
})

test('one watched mint reads "1 mint watched"', async ({ page }) => {
  await setup(page, { urls: [url('a')], known: [known('a', { online: false })] })
  await expect(summary(page)).toHaveText('1 mint watched · 1 offline')
})

test('an empty watchlist shows neither the line nor the explainer', async ({ page }) => {
  await setup(page, { urls: [], known: MIXED_KNOWN })
  await expect(page.getByText('No mints watched yet')).toBeVisible()
  await expect(summary(page)).toHaveCount(0)
  await expect(page.locator('.wl-notify-explainer')).toHaveCount(0)
})

test('absent while the known list is held (skeleton), there with the grid once it arrives', async ({ page }) => {
  const ctl = await setup(page, { urls: MIXED_URLS, known: MIXED_KNOWN, knownMode: 'hold' })
  await expect(page.locator('.skeleton-card').first()).toBeVisible()
  await expect(summary(page)).toHaveCount(0)
  await ctl.release()
  await expect(page.locator('.wl-grid .mint-card')).toHaveCount(6)
  await expect(summary(page)).toHaveText(MIXED_TEXT)
})

test('absent when the known list fails (LoadError instead of the grid)', async ({ page }) => {
  await setup(page, { urls: MIXED_URLS, known: [], knownMode: 'fail' })
  await expect(page.getByText('Could not load the mint list. Please try again.')).toBeVisible()
  await expect(summary(page)).toHaveCount(0)
  await expect(page.locator('.wl-grid')).toHaveCount(0)
})

test('counts every watched mint, not only the first 20 cards (30 mints)', async ({ page }) => {
  const names = Array.from({ length: 30 }, (_, i) => `m${String(i).padStart(2, '0')}`)
  // 30 mints: 24 online, 3 degraded, 2 offline, 1 archived.
  const list = names.map((n, i) => known(n, i < 24 ? { online: true } : i < 27 ? { online: false, degraded: true } : i < 29 ? { online: false } : { online: false, archived: true }))
  await setup(page, { urls: names.map(url), known: list, size: [1440, 700] })
  await expect(page.locator('.wl-grid .mint-card')).toHaveCount(20)
  await expect(page.locator('.wl-showing')).toHaveText('Showing 20 of 30')
  await expect(summary(page)).toHaveText('30 mints watched · 24 online · 3 degraded · 2 offline · 1 archived')
})

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`${w}px: the line moves nothing else; every card keeps its size and its place relative to the others`, async ({ page }) => {
    await setup(page, { urls: MIXED_URLS, known: MIXED_KNOWN, size: [w, h] })
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(6)
    await expect(summary(page)).toBeVisible()
    const measure = async () => {
      const cards = await page.locator('.wl-grid .mint-card').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, w: r.width, h: r.height } }))
      const ex = await page.locator('.wl-notify-explainer').evaluate(el => { const r = el.getBoundingClientRect(); return { y: r.y + window.scrollY, h: r.height } })
      return { cards, ex }
    }
    // Measure a settled layout: under parallel workers the cards' own requests and the web fonts can still arrive
    // between the two measurements and change a card. Network idle and fonts loaded, then the same boxes for 300 ms.
    const boxes = async () => {
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      let last = await measure()
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(300)
        const next = await measure()
        if (JSON.stringify(next) === JSON.stringify(last)) return next
        last = next
      }
      return last
    }
    const withLine = await boxes()
    await page.addStyleTag({ content: '.wl-summary { display: none !important }' })
    const without = await boxes()
    const shift = withLine.cards[0]!.y - without.cards[0]!.y
    expect(shift).toBeGreaterThan(0)
    expect(shift).toBeLessThan(60) // the line's own height plus its gap, nothing more
    withLine.cards.forEach((c, i) => {
      expect(c.x).toBeCloseTo(without.cards[i]!.x, 1)
      expect(c.w).toBeCloseTo(without.cards[i]!.w, 1)
      expect(c.h).toBeCloseTo(without.cards[i]!.h, 1)
      expect(c.y - shift).toBeCloseTo(without.cards[i]!.y, 1)
    })
    // The explainer keeps its height and its distance to the first card.
    expect(withLine.ex.h).toBeCloseTo(without.ex.h, 1)
    expect(withLine.cards[0]!.y - withLine.ex.y).toBeCloseTo(without.cards[0]!.y - without.ex.y, 1)
  })
}
