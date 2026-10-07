import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './mocks'

// Fixtures for the cashu.info branch of the Mint Detail Audit tab. The shapes mirror
// GET /api/mints/audit-cz (docs/API.md, src/hooks/useAuditCz.ts) and GET /api/mints/swaps.

export const ALPHA = MOCK_MINTS[0]!.url
export const ALPHA_PATH = `/mint/${encodeURIComponent(ALPHA)}`
export const CZ_PAGE_URL = 'https://cashu.info/mint/abc12345'

const H = 3_600_000
const D = 24 * H
export const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
export { H, D }

export interface CzSwap {
  id: string
  at: string
  status: string
  stage: string | null
  error: string | null
  amount: number | null
  fee: number | null
  durationMs: number | null
  direction: 'from' | 'to'
  otherMintUrl: string | null
  otherMintName: string | null
}

export function czSwap(i: number, over: Partial<CzSwap> = {}): CzSwap {
  return {
    id: `s${i}`,
    // Newest first: the endpoint orders by `at` descending.
    at: ago((i + 1) * 10 * 60_000),
    status: 'success',
    stage: null,
    error: null,
    amount: 10 + i,
    fee: 1,
    durationMs: 1000,
    direction: 'from',
    otherMintUrl: `https://dest${i}.example`,
    otherMintName: `Dest ${i}`,
    ...over,
  }
}

/** Rows in order, numbered from 0 (newest). Each spec per row gets a distinct destination host `<kind><n>.example`. */
export function czSwapList(spec: Array<Partial<CzSwap> & { kind: string }>): CzSwap[] {
  return spec.map(({ kind, ...over }, i) => czSwap(i, { otherMintUrl: `https://${kind}${i}.example`, ...over }))
}

/** The stored detail of mint.lnpay.cz (the subset the backend keeps; built from the real response). */
export const LNPAY_DETAIL = {
  swaps7d: {
    all: { total: 126, success: 107, failed: 19, avgMs: 8289 },
    asSource: { total: 64, success: 51, failed: 13, avgMs: 11719 },
    asDest: { total: 62, success: 56, failed: 6, avgMs: 5166 },
    errorsBlamed: 0,
    dleq: { valid: 56, invalid: 0, missing: 0 },
  },
  integrity: {
    proof_state: { checked: 9, spent: 0, pending: 0 },
  },
  network: { asn: 14061, asName: 'DIGITALOCEAN-ASN - DigitalOcean, LLC, US', country: 'US' },
  onion: false,
}

/** A deep copy of LNPAY_DETAIL with parts replaced (shallow per top-level block: pass a whole block). */
export function czDetail(over: Record<string, unknown> = {}, fetchedMinutesAgo = 10) {
  return { ...JSON.parse(JSON.stringify(LNPAY_DETAIL)), ...over, fetchedAt: ago(fetchedMinutesAgo * 60_000) }
}

export function auditCzResponse(over: Record<string, unknown> = {}) {
  return {
    source: 'audit.cashu.cz',
    sourceUrl: CZ_PAGE_URL,
    fetchedAt: ago(5 * 60_000),
    covered: true,
    mint: {
      state: 'ok', uptime24h: 99.5, uptime7d: 98.1, uptime30d: 97.4,
      attributedFailures: 1, lastCheck: ago(4 * 60_000), minted: 30, melted: 25,
    },
    swaps: [] as CzSwap[],
    stats7d: null,
    detail: czDetail(),
    ...over,
  }
}

export const NOT_COVERED = { source: 'audit.cashu.cz', sourceUrl: null, fetchedAt: ago(5 * 60_000), covered: false, mint: null, swaps: [], stats7d: null }

/** audit.8333.space data as the known-mints payload carries it: fresh by default. */
export const FRESH_8333 = {
  auditNMints: 1234, auditNMelts: 567, auditRecentTotal: 100, auditRecentErrors: 2,
  auditCheckedAt: ago(3 * H), auditSyncedAt: ago(2 * H),
}
export const NO_8333 = {
  auditNMints: null, auditNMelts: null, auditRecentTotal: null, auditRecentErrors: null,
  auditCheckedAt: null, auditSyncedAt: null,
}

export const SWAPS_8333 = {
  url: ALPHA,
  avgTimeMs: 800,
  swaps: [0, 1, 2].map(i => ({
    swapId: 9000 + i, toUrl: `https://eight${i}.example`, amount: 20 + i, fee: 0,
    createdAt: ago((i + 1) * 15 * 60_000), timeTakenMs: 800, state: 'OK', error: null,
  })),
}

export interface AuditCzSetup {
  /** Overrides of Alpha's /api/mints/known row (audit.8333.space data). */
  alpha?: Record<string, unknown>
  /** Body of /api/mints/audit-cz. */
  cz?: unknown
  /** HTTP status of /api/mints/audit-cz (default 200). */
  czStatus?: number
  /** When set, the audit-cz response is held until this promise resolves. */
  hold?: Promise<void>
}

export interface AuditCzHarness {
  /** Every request the page made (full URL), in order. */
  requests: string[]
  /** Messages of JS dialogs (alert/confirm/prompt) that opened; each is dismissed. */
  dialogs: string[]
  /** Query strings of the /api/mints/audit-cz requests. */
  czQueries: () => URLSearchParams[]
}

/** Turns CSS animations/transitions off before any app code runs so geometry never depends on them. */
export async function disableMotion(page: Page) {
  await page.addInitScript(() => {
    const style = document.createElement('style')
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'
    document.documentElement.appendChild(style)
  })
}

/**
 * Mocks every endpoint the Audit tab uses (no real network), opens Alpha's detail page and the Audit tab.
 * cashu.info / audit.8333.space themselves are aborted, so a regression that makes the browser contact
 * them directly cannot reach the network (it is still recorded in `requests`).
 */
export async function gotoAuditTab(page: Page, setup: AuditCzSetup = {}, openAuditTab = true): Promise<AuditCzHarness> {
  const requests: string[] = []
  const dialogs: string[] = []
  page.on('request', r => requests.push(r.url()))
  page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss() })

  await disableMotion(page)
  await mockRelays(page)
  await installApiMocks(page)
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, ...setup.alpha } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.route('**/api/mints/swaps**', route => route.fulfill({ json: SWAPS_8333 }))
  await page.route('**/api/mints/audit-cz**', async route => {
    if (setup.hold) await setup.hold
    await route.fulfill({ status: setup.czStatus ?? 200, json: setup.cz ?? NOT_COVERED })
  })
  await page.route(/^https?:\/\/(cashu\.info|audit\.8333\.space|api\.audit\.8333\.space)\//, route => route.abort())

  await page.goto(ALPHA_PATH)
  await expect(page.locator('.md-tabs')).toBeVisible()
  if (openAuditTab) await page.locator('.md-tab', { hasText: 'Audit' }).click()

  return {
    requests,
    dialogs,
    czQueries: () => requests
      .filter(u => new URL(u).pathname === '/api/mints/audit-cz')
      .map(u => new URL(u).searchParams),
  }
}

/**
 * Waits for the real "layout is final" condition instead of a timeout: web fonts loaded (font-display: swap
 * re-wraps text when they arrive) and the geometry of every element matching the selectors identical across two
 * consecutive animation frames. Returns the rects from that same frame.
 */
export async function measureSettled(page: Page, selectors: string[]) {
  return page.evaluate(async sels => {
    await document.fonts.ready
    const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()))
    const read = () => sels.flatMap(sel => {
      const els = Array.from(document.querySelectorAll(sel))
      if (els.length === 0) throw new Error(`measureSettled: ${sel} not found`)
      return els.map(el => {
        const b = el.getBoundingClientRect()
        return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right }
      })
    })
    let prev = JSON.stringify(read())
    for (let i = 0; i < 300; i++) {
      await frame()
      const cur = read()
      if (JSON.stringify(cur) === prev) return cur
      prev = JSON.stringify(cur)
    }
    throw new Error('measureSettled: layout did not settle within 300 frames')
  }, selectors)
}
