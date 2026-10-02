import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { installApiMocks, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// "Recommended by follows" sits BELOW the full-width card grid: one slim 44px line when there is
// nothing to show, the section (heading + rows) otherwise, nothing while loading or on a load error.

const KNOWN = MOCK_KNOWN_MINTS.slice(0, 4).map(m => ({ ...m, online: true, degraded: false, latencyMs: 120, reliabilityScore: 80, uptimePct24h: 97 }))
const WATCHED = KNOWN.slice(0, 3).map(m => m.url)
const RECOMMENDED = KNOWN[3]!

const userSk = generateSecretKey()
const userPk = getPublicKey(userSk)
const followSk = generateSecretKey()
const followPk = getPublicKey(followSk)
const now = () => Math.floor(Date.now() / 1000)

interface Opts {
  recs?: boolean
  noFollows?: boolean
  hold?: boolean
  throwOnLoad?: boolean
  width?: number
}

async function open(page: Page, opts: Opts = {}) {
  const { recs = false, noFollows = false, hold = false, throwOnLoad = false, width = 1440 } = opts
  let release!: () => void
  const gate = hold ? new Promise<void>(r => { release = r }) : Promise.resolve()

  const watchlistEv = finalizeEvent({ kind: 10003, created_at: now(), tags: [], content: JSON.stringify(WATCHED) }, userSk)
  const followsEv = finalizeEvent({ kind: 3, created_at: now(), tags: [['p', followPk]], content: '' }, userSk)
  const reviewEv = finalizeEvent({ kind: 38000, created_at: now(), tags: [['u', RECOMMENDED.url], ['rating', '5']], content: 'good' }, followSk)

  await page.addInitScript(({ pubkey, npub }) => {
    ;(window as unknown as { nostr: unknown }).nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (event: Record<string, unknown>) => ({ ...event, id: 'f'.repeat(64), pubkey, sig: '0'.repeat(128) }),
      nip04: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
      nip44: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
    }
    sessionStorage.setItem('mintradar_session', JSON.stringify({ state: { profile: { pubkey, npub, name: 'E2E Tester' }, method: 'nip07' }, version: 0 }))
  }, { pubkey: userPk, npub: nip19.npubEncode(userPk) })

  await page.routeWebSocket(/^wss:\/\//, ws => ws.onMessage(message => {
    let parsed: unknown
    try { parsed = JSON.parse(String(message)) } catch { return }
    if (!Array.isArray(parsed)) return
    const [verb, subId, filter] = parsed as [string, string, { kinds?: number[] } | undefined]
    if (verb === 'EVENT') { ws.send(JSON.stringify(['OK', (parsed[1] as { id?: string }).id ?? '', true, ''])); return }
    if (verb !== 'REQ') return
    const kinds = filter?.kinds ?? []
    const reply = (ev?: object) => { if (ev) ws.send(JSON.stringify(['EVENT', subId, ev])); ws.send(JSON.stringify(['EOSE', subId])) }
    if (kinds.includes(10003)) reply(watchlistEv)
    else if (kinds.includes(3)) void gate.then(() => reply(noFollows ? undefined : followsEv))
    else if (kinds.includes(38000)) reply(recs ? reviewEv : undefined)
    else reply()
  }))

  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))

  if (throwOnLoad) {
    // Make the follow-recommendations query itself fail (it swallows relay errors, so a relay mock cannot).
    await page.route('**/src/hooks/useFollowRecommendations.ts*', async route => {
      const res = await route.fetch()
      const body = (await res.text()).replace(
        /async function fetchFollowRecs\(pubkey\) \{/,
        "async function fetchFollowRecs(pubkey) { window.__recCalls = (window.__recCalls || 0) + 1; throw new Error('load failed');",
      )
      await route.fulfill({ response: res, body })
    })
  }

  await page.setViewportSize({ width, height: 1000 })
  await page.goto('/watchlist')
  await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
  return { release: () => release() }
}

const section = (page: Page) => page.locator('.wl-rec-panel')
const slim = (page: Page) => page.locator('.wl-rec-slim')

async function cardLayout(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector('.wl-grid')!.getBoundingClientRect()
    return {
      cards: [...document.querySelectorAll('.wl-grid .mint-card')].map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), Math.round(r.height)] }),
      grid: [Math.round(grid.left), Math.round(grid.top), Math.round(grid.width), Math.round(grid.height)],
    }
  })
}

test.describe('Watchlist — recommendations section', () => {
  test('empty: one slim 44px line below the grid, no side column', async ({ page }) => {
    await open(page, { noFollows: true })
    await expect(slim(page)).toBeVisible()
    await expect(slim(page).locator('.wl-rec-panel-title')).toHaveText('Recommended by follows')
    await expect(slim(page).locator('.wl-rec-panel-badge')).toHaveText('NIP-87')
    await expect(slim(page).locator('.wl-rec-slim-text')).toHaveText('None from your follows yet')
    await expect(page.locator('.wl-rec-row')).toHaveCount(0)
    await expect(page.locator('.wl-side-col')).toHaveCount(0)
    expect((await slim(page).boundingBox())!.height).toBeCloseTo(44, 0)
    const lastCard = (await page.locator('.wl-grid .mint-card').last().boundingBox())!
    expect((await slim(page).boundingBox())!.y).toBeGreaterThanOrEqual(lastCard.y + lastCard.height)
    expect(await page.locator('.wl-rec-slim-text').evaluate(el => getComputedStyle(el).fontSize)).toBe('11.5px')
  })

  test('with recommendations: heading + rows below the full-width grid', async ({ page }) => {
    await open(page, { recs: true })
    await expect(section(page)).toBeVisible()
    await expect(slim(page)).toHaveCount(0)
    await expect(section(page).locator('.wl-rec-panel-title')).toHaveText('Recommended by follows')
    await expect(section(page).locator('.wl-rec-panel-badge')).toHaveText('NIP-87')
    await expect(section(page).locator('.wl-rec-panel-subheader')).toHaveText('1 mints · from 1 follows')
    await expect(section(page).locator('.wl-rec-row')).toHaveCount(1)
    await expect(section(page).locator('.wl-rec-row')).toContainText(RECOMMENDED.name!)
    const lastCard = (await page.locator('.wl-grid .mint-card').last().boundingBox())!
    expect((await section(page).boundingBox())!.y).toBeGreaterThanOrEqual(lastCard.y + lastCard.height)
    // "+ Watch" still adds the recommended mint to the watchlist.
    await section(page).getByRole('button', { name: '+ Watch' }).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(4)
  })

  test('loading shows nothing (no flash of the empty line), then the empty line appears', async ({ page }) => {
    const { release } = await open(page, { hold: true, noFollows: true })
    await page.waitForTimeout(600)
    await expect(section(page)).toHaveCount(0)
    await expect(page.getByText('None from your follows yet')).toHaveCount(0)
    release()
    await expect(slim(page)).toBeVisible()
  })

  test('a load error shows nothing', async ({ page }) => {
    await open(page, { throwOnLoad: true })
    // initial attempt + the app's single query retry
    await expect.poll(() => page.evaluate(() => (window as unknown as { __recCalls?: number }).__recCalls ?? 0), { timeout: 8000 }).toBeGreaterThanOrEqual(2)
    await page.waitForTimeout(400)
    await expect(section(page)).toHaveCount(0)
    await expect(page.getByText('None from your follows yet')).toHaveCount(0)
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
  })

  for (const width of [1440, 768, 390]) {
    test(`card grid is identical whether the section is empty or filled (${width}px)`, async ({ context }) => {
      const measure = async (opts: Opts) => {
        const page = await context.newPage()
        await open(page, { ...opts, width })
        await expect(opts.recs ? page.locator('.wl-rec-row') : slim(page)).toBeVisible()
        // The Down/Up buttons arrive with an async IndexedDB read and change the card height — wait for them.
        await expect(page.locator('.wl-grid .notify-toggle-btn')).toHaveCount(6)
        const layout = await cardLayout(page)
        await page.close()
        return layout
      }
      const empty = await measure({ noFollows: true })
      const filled = await measure({ recs: true })
      expect(filled).toEqual(empty)
      // Full page width, like the Dashboard grid: more than one column once there is room.
      if (width >= 768) expect(new Set(empty.cards.map(c => c[0])).size).toBeGreaterThan(1)
    })
  }

  for (const [label, opts] of [['empty', { noFollows: true }], ['with recommendations', { recs: true }]] as const) {
    test(`no horizontal overflow at 320, 360, 390, 768, 1440 and 1920px (${label})`, async ({ page }) => {
      await open(page, opts)
      await expect(opts.recs ? page.locator('.wl-rec-row') : slim(page)).toBeVisible()
      for (const width of [320, 360, 390, 768, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.waitForTimeout(100)
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(over, `overflow at ${width}px`).toBeLessThanOrEqual(0)
        const box = (await section(page).boundingBox())!
        expect(box.x, `section left edge at ${width}px`).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width, `section right edge at ${width}px`).toBeLessThanOrEqual(width)
      }
    })
  }

  // Screenshots for review: SHOTS=<dir> npx playwright test e2e/watchlist-recommendations.spec.ts
  const SHOTS = process.env['SHOTS']
  for (const width of [1440, 390]) {
    for (const [label, opts] of [['empty', { noFollows: true }], ['recs', { recs: true }]] as const) {
      test(`screenshot ${label} ${width}px`, async ({ page }) => {
        test.skip(!SHOTS, 'set SHOTS=<dir> to write screenshots')
        await open(page, { ...opts, width })
        await expect(opts.recs ? page.locator('.wl-rec-row') : slim(page)).toBeVisible()
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${SHOTS}/watchlist-recs-${label}-${width}.png`, fullPage: true })
      })
    }
  }
})
