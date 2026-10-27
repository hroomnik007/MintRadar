import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, mockProbedVersion, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Hero stats row of a mint that is not online (no latency: the value reads "—"): the Latency tile must be built like the one
// of an online mint and sit on the same lines as its neighbours. On the desktop strip the label of such a tile used to climb
// into the first row, next to the "Show my latency" button, because the short "—" left room for it.

const ALPHA = MOCK_MINTS[0]!.url
const GONE = 'https://gone.mint.example'
// A current version for every state: an archived mint shows no "Outdated" pill (2026-10-27), which would change the
// height of the Version tile on phones; this spec is about the Latency tile only.
const LATEST = 'Nutshell/0.20.0'
const H = 3_600_000
const D = 24 * H
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const STATES = {
  online: {},
  offline: { online: false, degraded: false, archived: false, lastOnlineAt: ago(8 * D), offlineSince: ago(8 * D), latencyMs: null, nutCount: 3 },
  degraded: { online: false, degraded: true, archived: false, lastOnlineAt: ago(5 * H), offlineSince: ago(5 * H), latencyMs: null, nutCount: 3 },
  archived: { online: false, degraded: true, archived: true, lastOnlineAt: ago(60 * D), offlineSince: ago(60 * D), latencyMs: null, nutCount: 3 },
} as const

async function open(page: Page, state: keyof typeof STATES, width: number, height: number) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  const base = MOCK_KNOWN_MINTS.find(m => m.url === ALPHA)!
  const rows = [...MOCK_KNOWN_MINTS, { ...base, url: GONE, name: 'Gone Mint', version: LATEST, ...STATES[state] }]
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  if (state === 'online') await mockProbedVersion(page, LATEST)
  if (state !== 'online') {
    await page.route('**/api/mint/probe**', r => r.fulfill({
      json: { url: GONE, online: false, latencyMs: null, info: null, keysets: null, checkedAt: new Date().toISOString(), error: 'Mint unreachable' },
    }))
  }
  await resize(page, width, height)
  await page.goto(`/mint/${encodeURIComponent(GONE)}`)
  await expect(page.locator('.md-summary .md-sc').first()).toBeVisible()
  await expect(page.locator('.md-sc-value').first()).toHaveText(state === 'online' ? /ms$|—/ : '—')
  await layoutReady(page)
}

/** Offsets inside every tile of the strip (value, label, sub) from the tile's own top, and its height. */
const tiles = (page: Page) => page.locator('.md-summary .md-sc').evaluateAll(els => els
  .filter(e => e.getBoundingClientRect().height > 0)
  .map(e => {
    const r = e.getBoundingClientRect()
    const dy = (sel: string) => { const x = e.querySelector(sel); return x ? Math.round(x.getBoundingClientRect().top - r.top) : null }
    return { top: Math.round(r.top), h: Math.round(r.height), value: dy('.md-sc-value'), label: dy('.md-sc-label'), sub: dy('.md-sc-sub') }
  }))

for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 640]] as const) {
  for (const state of ['offline', 'degraded', 'archived'] as const) {
    test(`Latency tile of a ${state} mint is built and aligned like the one of an online mint @ ${width}px`, async ({ page, browser }) => {
      await open(page, state, width, height)
      const gone = await tiles(page)

      const ref = await (await browser.newContext()).newPage()
      await open(ref, 'online', width, height)
      const online = await tiles(ref)

      // Same offsets inside the Latency tile and the same strip height as with a number in it.
      expect(gone[0]).toMatchObject({ h: online[0]!.h, value: online[0]!.value, label: online[0]!.label, sub: online[0]!.sub })
      expect(gone.map(t => t.h)).toEqual(online.map(t => t.h))
      // The strip's own rows keep their place: the tiles start on the lines they have for an online mint.
      expect(gone.map(t => t.top - gone[0]!.top)).toEqual(online.map(t => t.top - online[0]!.top))
      if (width >= 1200) {
        // One row of tiles: value tops and label tops are the same lines as the neighbours' (the label of Latency is on row 2).
        const labelTops = gone.slice(0, 5).map(t => t.label)
        expect(labelTops[0]).toBe(online[0]!.label)
        expect(Math.abs((labelTops[0] ?? 0) - (labelTops[1] ?? 0))).toBeLessThanOrEqual(4)
        expect(gone[0]!.value).toBe(gone[1]!.value)
      }
      await ref.context().close()
    })
  }
}
