import { test, expect, type Page } from '@playwright/test'
import { appendFileSync } from 'fs'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, loginAs, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'

// Every page's main containers share the navbar's content edges (.navbar-inner content box, i.e. --dash-chrome-max
// capped, --page-pad gutters). Same idea as dashboard-container-edges.spec.ts, but for every main page, so a page
// cannot drift away from the navbar unnoticed. Each state below lists its containers with a rule:
//   'aligned' — left/right edge equals the navbar's content edge (±1px) at every width, on the stated box
//               ('content' = border box minus padding, 'border' = border box)
//   'within'  — a child of an aligned container (e.g. a result row inside a tool card): must not stick out of the navbar's content edges
//   'bleed'   — intentionally NOT aligned (full-bleed band / modal); only asserted to stay inside the viewport
// EDGES_REPORT=<file> turns the spec into a read-only measurement: every container is appended to <file> as JSON, nothing is asserted.

const WIDTHS = [1920, 1536, 1440, 1280, 1100, 900, 768, 640, 390] as const
const REPORT = process.env.EDGES_REPORT

type Rule = 'aligned' | 'within' | 'bleed'
interface Container { sel: string; rule: Rule; box?: 'content' | 'border'; why?: string }
const A = (sel: string, box: 'content' | 'border' = 'content'): Container => ({ sel, rule: 'aligned', box })
const WITHIN = (sel: string): Container => ({ sel, rule: 'within', box: 'border' })
const BLEED = (sel: string, why: string): Container => ({ sel, rule: 'bleed', why })

const DASH_CHROME = [A('.dash-intro'), A('.dash-status'), A('.dashboard-controls')]

interface State {
  name: string
  containers: Container[]
  setup: (page: Page) => Promise<void>
  widths?: readonly number[]
  /** Known, measured mismatch that looks unintentional: the case is test.fixme'd (reason = what was measured). */
  fixme?: string
}

const base = MOCK_KNOWN_MINTS[0]
const KNOWN = MOCK_KNOWN_MINTS.slice(0, 4).map(m => ({ ...base, ...m, online: true, degraded: false, latencyMs: 120, reliabilityScore: 80, uptimePct24h: 97 }))
const ALPHA = MOCK_MINTS[0]!.url

async function boot(page: Page, view: 'cards' | 'list' = 'cards') {
  await mockRelays(page)
  await installApiMocks(page)
  // No entry animations / transitions: boxes must not move while measuring.
  await page.addInitScript(() => {
    const css = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'
    const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s) }
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add)
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(v => localStorage.setItem('mintRadar_viewMode', v), view)
}

// Logged-in watchlist with three watched mints; follows/recommendation events served by a relay mock.
async function bootWatchlist(page: Page, o: { watched: boolean; recs: boolean }) {
  const userSk = generateSecretKey(); const userPk = getPublicKey(userSk)
  const followSk = generateSecretKey(); const followPk = getPublicKey(followSk)
  const now = Math.floor(Date.now() / 1000)
  const watchedUrls = o.watched ? KNOWN.slice(0, 3).map(m => m.url) : []
  const watchlistEv = finalizeEvent({ kind: 10003, created_at: now, tags: [], content: JSON.stringify(watchedUrls) }, userSk)
  const followsEv = finalizeEvent({ kind: 3, created_at: now, tags: [['p', followPk]], content: '' }, userSk)
  const reviewEv = finalizeEvent({ kind: 38000, created_at: now, tags: [['u', KNOWN[3]!.url], ['rating', '5']], content: 'good' }, followSk)
  await boot(page)
  await page.addInitScript(({ pubkey, npub }) => {
    const id = async (_p: string, t: string) => t
    ;(window as unknown as { nostr: unknown }).nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (event: Record<string, unknown>) => ({ ...event, id: 'f'.repeat(64), pubkey, sig: '0'.repeat(128) }),
      nip04: { encrypt: id, decrypt: id }, nip44: { encrypt: id, decrypt: id },
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
    else if (kinds.includes(3)) reply(o.recs ? followsEv : undefined)
    else if (kinds.includes(38000)) reply(o.recs ? reviewEv : undefined)
    else reply()
  }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
}

const WATCHLIST = [A('.wl-body'), A('.wl-main-col')]

const STATES: State[] = [
  { name: 'Dashboard grid', containers: [...DASH_CHROME, A('.mint-grid')],
    setup: async p => { await boot(p); await p.goto('/?status=all'); await expect(p.locator('.mint-card').first()).toBeVisible() } },
  { name: 'Dashboard list', containers: [...DASH_CHROME, A('.mint-list-table-wrap')],
    setup: async p => { await boot(p, 'list'); await p.goto('/?status=all'); await expect(p.locator('.mint-list-row').first()).toBeVisible() } },
  { name: 'Dashboard Filters panel open', containers: [...DASH_CHROME, A('.filter-panel', 'border'), A('.mint-grid')],
    setup: async p => { await boot(p); await p.goto('/?status=all'); await p.locator('.filter-btn').click(); await expect(p.locator('.filter-panel')).toBeVisible() } },
  { name: 'Watchlist empty (logged in)', containers: [...WATCHLIST, A('.wl-empty', 'border')],
    setup: async p => { await boot(p); await loginAs(p); await p.goto('/watchlist'); await expect(p.getByText('No mints watched yet')).toBeVisible() } },
  { name: 'Watchlist with mints, no recommendations', containers: [...WATCHLIST, A('.wl-grid'), A('.wl-rec-slim', 'border')],
    setup: async p => { await bootWatchlist(p, { watched: true, recs: false }); await p.goto('/watchlist'); await expect(p.locator('.wl-grid .mint-card')).toHaveCount(3); await expect(p.locator('.wl-rec-slim')).toBeVisible() } },
  { name: 'Watchlist with mints and recommendations', containers: [...WATCHLIST, A('.wl-grid'), A('.wl-rec-panel', 'border')],
    setup: async p => { await bootWatchlist(p, { watched: true, recs: true }); await p.goto('/watchlist'); await expect(p.locator('.wl-grid .mint-card')).toHaveCount(3); await expect(p.locator('.wl-rec-row')).toHaveCount(1) } },
  { name: 'Stats', containers: [A('.page-head'), A('.stats-board-grid')],
    setup: async p => { await boot(p); await p.goto('/stats'); await expect(p.locator('.stats-now-panel')).toBeVisible() } },
  { name: 'Tools', containers: [A('.page-head'), A('.tools-grid')],
    setup: async p => { await boot(p); await p.goto('/tools'); await expect(p.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible() } },
  { name: 'Tools with Best Mint results', containers: [A('.tools-grid'), WITHIN('.wizard-rec-row')],
    setup: async p => {
      await boot(p); await p.goto('/tools')
      await p.getByRole('radio', { name: 'SAT', exact: true }).click()
      await p.locator('.wizard-opt', { hasText: 'Small' }).click()
      await p.locator('.wizard-opt', { hasText: 'Fast from here' }).click()
      await p.getByRole('button', { name: /Find my mint/ }).click()
      await expect(p.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    } },
  { name: 'Wallets', containers: [A('.wallets-header'), A('.wallets-grid'), A('.wallets-grid-selfhost'), A('.wallets-selfhost')],
    setup: async p => { await boot(p); await p.goto('/wallets'); await expect(p.locator('.wallets-grid').first()).toBeVisible() } },
  { name: 'Learn', containers: [A('.learn-page-header'), A('.learn-grid')],
    setup: async p => { await boot(p); await p.goto('/learn'); await expect(p.locator('.learn-card').first()).toBeVisible() } },
  { name: 'Learn module', containers: [A('.learn-module-page')],
    setup: async p => { await boot(p); await p.goto('/learn'); await p.locator('.learn-card').first().click(); await expect(p.locator('.learn-module')).toBeVisible() } },
  ...(['overview', 'history', 'nuts', 'audit', 'reviews'] as const).map((tab): State => ({
    name: `Mint Detail — ${tab} tab`,
    containers: [A('.md-header', 'border'), A('.md-tabs'), A('.md-body')],
    setup: async p => {
      await boot(p); await p.goto(`/mint/${encodeURIComponent(ALPHA)}`)
      await expect(p.locator('.md-tabs')).toBeVisible()
      await p.locator('.md-tab', { hasText: new RegExp(`^${tab}$`, 'i') }).click()
      await expect(p.locator('.md-tab.active')).toHaveText(new RegExp(`^${tab}$`, 'i'))
    } })),
  { name: 'Mint Detail — summary strip', containers: [A('.md-summary')],
    setup: async p => { await boot(p); await p.goto(`/mint/${encodeURIComponent(ALPHA)}`); await expect(p.locator('.md-summary')).toBeVisible() } },
  { name: 'Wallets footnote', containers: [A('.wallets-footnote')],
    setup: async p => { await boot(p); await p.goto('/wallets'); await expect(p.locator('.wallets-footnote')).toBeVisible() } },
  ...WIDTHS.map((w): State => ({
    name: `Footer inner row (every page)`, widths: [w], containers: [A('.app-footer-inner')],
    setup: async p => { await boot(p); await p.goto('/?status=all'); await expect(p.locator('.app-footer-inner')).toBeVisible() } })),
  { name: 'Compare modal', containers: [BLEED('.cmp-modal', 'modal overlay: centred over the page, not part of the content column')],
    setup: async p => {
      await boot(p); await p.goto('/?status=all')
      await p.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
      await p.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
      await p.locator('.md-picker-confirm').click()
      await expect(p.locator('.cmp-modal')).toBeVisible()
    } },
]

interface Box { n: number; bl: number; br: number; cl: number; cr: number }

async function measure(page: Page, sels: string[]): Promise<Record<string, Box>> {
  return page.evaluate(sels => {
    const out: Record<string, Box> = {}
    for (const s of ['.navbar-inner', ...sels]) {
      const el = document.querySelector(s)
      if (!el) { out[s] = { n: 0, bl: 0, br: 0, cl: 0, cr: 0 }; continue }
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      out[s] = { n: document.querySelectorAll(s).length, bl: r.left, br: r.right,
        cl: r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), cr: r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) }
    }
    return out
  }, sels)
}

/** Fonts loaded, then two consecutive animation frames with identical boxes. */
async function settled(page: Page, sels: string[]) {
  await page.evaluate(() => document.fonts.ready)
  let prev = ''
  await expect.poll(async () => {
    const cur = await page.evaluate(async sels => {
      const snap = () => ['.navbar-inner', ...sels].map(s => { const e = document.querySelector(s); if (!e) return 'x'; const r = e.getBoundingClientRect(); return [r.left, r.right, r.top, r.height].map(v => v.toFixed(2)).join(',') }).join('|')
      const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()))
      await frame(); const a = snap(); await frame(); return a === snap() ? a : ''
    }, sels)
    const ok = cur !== '' && cur === prev
    prev = cur
    return ok
  }, { timeout: 10_000, intervals: [50, 100, 100, 200] }).toBe(true)
}

let assertions = 0
const soft = (actual: number, message: string) => { assertions++; return expect.soft(actual, message) }

for (const state of STATES) {
  const widths = state.widths ?? WIDTHS
  test(`content edges — ${state.name}${state.widths ? ` @${state.widths[0]}px` : ''}`, async ({ page }) => {
    test.fixme(!!state.fixme && !REPORT, state.fixme ?? '')
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await state.setup(page)
    const sels = state.containers.map(c => c.sel)
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      await settled(page, sels)
      const m = await measure(page, sels)
      const nav = m['.navbar-inner']!
      const vw = width
      if (REPORT) {
        for (const c of state.containers) appendFileSync(REPORT, JSON.stringify({ state: state.name, width, sel: c.sel, rule: c.rule, nav: [nav.cl, nav.cr], ...m[c.sel]! }) + '\n')
        continue
      }
      // At phone width the navbar's own gutter is the page padding.
      if (width === 390) {
        const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-pad')))
        soft(Math.abs(nav.cl - pad), `390px: navbar left gutter vs --page-pad`).toBeLessThanOrEqual(1)
        soft(Math.abs(vw - nav.cr - pad), `390px: navbar right gutter vs --page-pad`).toBeLessThanOrEqual(1)
      }
      for (const c of state.containers) {
        const b = m[c.sel]!
        const where = `${state.name} @${width}px ${c.sel}`
        soft(b.n, `${where}: container is rendered`).toBeGreaterThan(0)
        if (c.rule === 'bleed') {
          soft(b.bl, `${where}: inside viewport (left)`).toBeGreaterThanOrEqual(-1)
          soft(b.br, `${where}: inside viewport (right)`).toBeLessThanOrEqual(vw + 1)
          continue
        }
        if (c.rule === 'within') {
          soft(Math.max(0, nav.cl - b.bl), `${where}: left edge sticks out of the navbar content edge`).toBeLessThanOrEqual(1)
          soft(Math.max(0, b.br - nav.cr), `${where}: right edge sticks out of the navbar content edge`).toBeLessThanOrEqual(1)
          continue
        }
        const l = c.box === 'border' ? b.bl : b.cl
        const r = c.box === 'border' ? b.br : b.cr
        soft(Math.abs(l - nav.cl), `${where}: left ${l.toFixed(1)} vs navbar ${nav.cl.toFixed(1)}`).toBeLessThanOrEqual(1)
        soft(Math.abs(r - nav.cr), `${where}: right ${r.toFixed(1)} vs navbar ${nav.cr.toFixed(1)}`).toBeLessThanOrEqual(1)
      }
    }
  })
}

test.afterEach(() => { if (process.env.EDGES_COUNT) appendFileSync(process.env.EDGES_COUNT, `${assertions}\n`); assertions = 0 })
