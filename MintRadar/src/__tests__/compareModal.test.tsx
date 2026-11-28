// The Compare modal after the 2026-11-28 redesign (ComparisonModal.tsx): mint cards on top, sections as panels with each
// row's label above one value per mint column, the same layout on every width, BEST on the single best value of a row
// (never on the community rating), the NUT count with per-NUT rows only under "Only differences", folded score points
// and History. Replaces compareMobileTable / compareNutSupport / compareScoreRowsModal (old table and grid).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KnownMint } from '@/hooks/useKnownMints'
import { TRACKED_NUT_KEYS } from '@/constants/nuts'

vi.mock('@/core/nostr/pool', () => ({
  sharedPool: { querySync: () => new Promise<never>(() => undefined), subscribeMany: () => ({ close: () => undefined }) },
}))

import { ComparisonModal } from '@/components/ComparisonModal'

const allNuts = Object.fromEntries(TRACKED_NUT_KEYS.map(k => [k, {}]))
const parts = (u: number) => ({ uptime: { points: u, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: 12, max: 15 }, version: { points: 15, max: 15 }, contact: { points: 3, max: 5 }, newMintCap: { points: 0, cap: 70 }, sum: 0 })
const A: KnownMint = {
  url: 'https://alpha.mint.example', name: 'Alpha Mint', iconUrl: null, degraded: false, online: true, latencyMs: 50,
  version: 'Nutshell/0.16.0', nutCount: 2, tosUrl: null, descriptionLong: null, nutsLimits: allNuts, units: ['sat'],
  reliabilityScore: 90, scoreBreakdown: parts(40), uptimePct24h: 99, uptimePct30d: 99, discoveredAt: '2025-09-01T00:00:00.000Z',
  lastCheckedAt: new Date().toISOString(), nostrAnnouncedAt: '2026-03-14T09:30:00.000Z',
  auditCzBlamed: 0, auditCzTotal: 50, auditCzFetchedAt: new Date().toISOString(), reviewAvgRating: 4.8, reviewCount: 7,
}
const B: KnownMint = {
  ...A, url: 'https://beta.mint.example', name: 'Beta Mint', reliabilityScore: 60, scoreBreakdown: parts(20), nostrAnnouncedAt: null,
  nutsLimits: { ...allNuts, '7': { supported: false }, '17': undefined }, latencyMs: 300, reviewAvgRating: 3.1,
}

let probe: (url: string) => Promise<Response>
let fees: Record<string, number> = {}
const fetched: string[] = []
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  fees = { alpha: 0, beta: 100 }
  fetched.length = 0
  probe = async url => json({
    url, online: true, latencyMs: 5, checkedAt: new Date().toISOString(),
    keysets: [{ id: '00aa', unit: 'sat', active: true, input_fee_ppk: url.includes('alpha') ? fees.alpha : fees.beta }],
    info: { name: 'x', nuts: {}, contact: url.includes('alpha') ? [{ method: 'nostr', info: 'npub1alpha' }, { method: 'email', info: 'a@alpha.example' }] : [] },
  })
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input)
    fetched.push(u)
    if (u.includes('/api/mint/probe')) return probe(decodeURIComponent(u))
    if (u.includes('/api/mints/history')) return json({ period: '24h', segments: [], uptimePct: 99, avgLatencyMs: null, prevUptimePct: null, prevAvgLatencyMs: null, earliestCheckedAt: null, daysOfDataAvailable: 1, periodDays: 1, prevPeriodInsufficientHistory: false })
    if (u.includes('/api/mints/version-history')) return json({ history: [], latestGlobalVersion: null })
    return json([])
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

function renderModal(mints: KnownMint[]) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ComparisonModal mints={mints} onClose={() => undefined} /></MemoryRouter>
    </QueryClientProvider>,
  )
}
/** The visible text of each mint's value in a row (the hidden mint name before each value is left out). */
const vals = (root: HTMLElement, id: string) => Array.from(root.querySelectorAll(`.cx-row[data-row="${id}"] .cx-val`)).map(v => {
  const c = v.cloneNode(true) as HTMLElement
  c.querySelectorAll('.sr-only').forEach(e => e.remove())
  return (c.textContent ?? '').trim()
})
const rowIds = (root: HTMLElement) => Array.from(root.querySelectorAll('.cx-sections > section .cx-row')).map(r => r.getAttribute('data-row'))
const label = (root: HTMLElement, id: string) => (root.querySelector(`.cx-row[data-row="${id}"] .cx-lbl`)?.textContent ?? '').trim()

describe('Compare modal (redesign 2026-11-28)', () => {
  it('cards: name with its status dot right after it, host, score; BEST on the single best online score', () => {
    const { baseElement } = renderModal([A, B])
    const cards = baseElement.querySelectorAll('[data-testid="cmp-card"]')
    expect(cards.length).toBe(2)
    const nameEl = cards[0]!.querySelector('.cx-name-text')!
    expect(nameEl.textContent).toBe('Alpha Mint')
    expect(nameEl.querySelector('.cx-name-tail .cx-dot-online')).not.toBeNull()
    expect(cards[0]!.querySelector('.cx-host')?.textContent).toBe('alpha.mint.example')
    expect(cards[0]!.querySelector('.cx-score-num')?.textContent).toBe('90')
    expect(cards[0]!.querySelector('.cx-score .cmp-best')).not.toBeNull()
    expect(cards[1]!.querySelector('.cx-score .cmp-best')).toBeNull()
    // No sideways scroller, no old table or grid, no "Measure again".
    expect(baseElement.querySelector('table.cmp-m-table, .cmp-grid')).toBeNull()
    expect(screen.queryByTestId('cmp-remeasure')).toBeNull()
  })

  it('an offline mint shows its status word next to the dot and no score', () => {
    const { baseElement } = renderModal([A, { ...B, online: false }])
    const card = baseElement.querySelectorAll('[data-testid="cmp-card"]')[1]!
    expect(card.querySelector('.cx-status-word')?.textContent).toBe('Offline')
    expect(card.querySelector('.cx-score-num')?.textContent).toBe('—')
  })

  it('sections in order, label above the values, one value per mint', () => {
    const { baseElement } = renderModal([A, B])
    expect(Array.from(baseElement.querySelectorAll('.cx-sections > section .cx-h')).map(h => h.textContent))
      .toEqual(['Reliability', 'Latency', 'Deposits and withdrawals', 'Features', 'Operator'])
    expect(rowIds(baseElement)).toEqual(['uptime', 'uptime-30d', 'audit', 'rating', 'browser-latency', 'latency', 'fee', 'units', 'nut-count', 'version', 'contact-methods', 'nip87'])
    expect(label(baseElement, 'uptime-30d')).toBe('Uptime 30 days')
    expect(vals(baseElement, 'latency')).toEqual(['50 ms', '300 ms'])
  })

  it('community rating: stars and count, never a BEST tag', () => {
    const { baseElement } = renderModal([A, B])
    expect(vals(baseElement, 'rating')).toEqual(['★ 4.8 (7)', '★ 3.1 (7)'])
    expect(baseElement.querySelector('.cx-row[data-row="rating"] .cmp-best')).toBeNull()
  })

  it('input fee: 0 reads "free" and gets BEST when it is the only lowest; a tie gets none', async () => {
    const { baseElement, unmount } = renderModal([A, B])
    await waitFor(() => expect(vals(baseElement, 'fee')).toEqual(['freeBest', '0.1 sat per coin']))
    unmount()
    fees = { alpha: 0, beta: 0 }
    const again = renderModal([A, B])
    await waitFor(() => expect(vals(again.baseElement, 'fee')).toEqual(['free', 'free']))
  })

  it('NUTs: only the count with BEST; per-NUT rows appear only under "Only differences"', () => {
    const { baseElement } = renderModal([A, B])
    const n = TRACKED_NUT_KEYS.length
    // { supported: false } and a missing entry are not support (utils/nutSupport.ts).
    const bMissing = ['7', '17'].filter(k => TRACKED_NUT_KEYS.includes(k)).length
    expect(vals(baseElement, 'nut-count')).toEqual([`${n} of ${n}Best`, `${n - bMissing} of ${n}`])
    expect(rowIds(baseElement).filter(id => id?.startsWith('nut-') && id !== 'nut-count')).toEqual([])

    fireEvent.click(screen.getByRole('switch', { name: 'Only differences' }))
    const nutRows = rowIds(baseElement).filter(id => id?.startsWith('nut-') && id !== 'nut-count')
    expect(nutRows.length).toBe(bMissing)
    if (TRACKED_NUT_KEYS.includes('7')) {
      expect(label(baseElement, 'nut-7')).toMatch(/^NUT-07/)
      expect(vals(baseElement, 'nut-7')).toEqual(['✓ Supported', '– Not supported'])
    }
  })

  it('"Only differences" hides rows equal for every mint, says how many differ, and restores them', () => {
    const { baseElement } = renderModal([A, B])
    const all = rowIds(baseElement)
    const sw = screen.getByRole('switch', { name: 'Only differences' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    const shown = rowIds(baseElement)
    expect(shown).toContain('latency')    // 50 vs 300
    expect(shown).toContain('rating')     // 4.8 vs 3.1
    expect(shown).not.toContain('units')  // sat for both
    expect(shown).not.toContain('version')
    const status = baseElement.querySelector('.cmp-m-status')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toMatch(/rows differ/)
    fireEvent.click(sw)
    expect(rowIds(baseElement)).toEqual(all)
    expect(status.textContent).toBe('')
  })

  it('payment methods: one row per method, "not offered" for a mint without it, a switched-off side named', () => {
    const withMethods: KnownMint = {
      ...A,
      mintMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000 }, { method: 'bolt12', unit: 'sat', min_amount: 1, max_amount: 500 }],
      meltMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000 }],
    }
    const off: KnownMint = { ...B, mintMethods: [{ method: 'bolt11', unit: 'sat' }], meltMethods: [{ method: 'bolt11', unit: 'sat' }], nutsLimits: { ...allNuts, '4': { methods: [], disabled: true } } }
    const { baseElement } = renderModal([withMethods, off])
    expect(rowIds(baseElement)).toEqual(expect.arrayContaining(['method-bolt11', 'method-bolt12']))
    expect(label(baseElement, 'method-bolt11')).toBe('Lightning')
    expect(vals(baseElement, 'method-bolt11')[0]).toBe('1 to 1k sat')
    expect(vals(baseElement, 'method-bolt11')[1]).toMatch(/in disabled by the mint/)
    expect(vals(baseElement, 'method-bolt12')[1]).toBe('not offered')
  })

  it('folded score points: values with the max, "—" without a stored score', () => {
    const C: KnownMint = { ...A, url: 'https://gamma.mint.example', name: 'Gamma Mint', reliabilityScore: null, scoreBreakdown: null }
    const { baseElement } = renderModal([A, B, C])
    const fold = baseElement.querySelector('details.cx-fold[data-fold="points"]')!
    expect(fold.querySelector('summary')?.textContent).toBe('How each score is made')
    expect(vals(baseElement, 'uptime-points')).toEqual(['40 / 40', '20 / 40', '—'])
    expect(vals(baseElement, 'contact-points')).toEqual(['3 / 5', '3 / 5', '—'])
  })

  it('operator: contact kinds only (never the values), NIP-87 text; "…" while the probe runs', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => { release = r })
    const original = probe
    probe = async url => { await gate; return original(url) }
    const { baseElement } = renderModal([A, B])
    expect(vals(baseElement, 'contact-methods')).toEqual(['…', '…'])
    expect(vals(baseElement, 'nip87')).toEqual(['Seen · event dated 14 Mar 2026', 'Not seen on our relays'])
    release()
    await waitFor(() => expect(vals(baseElement, 'contact-methods')).toEqual(['Email · Nostr', 'None listed']))
    expect(baseElement.textContent).not.toMatch(/npub1alpha|a@alpha\.example/)
  })

  it('a failed probe reads "n/a"; hostile contact kinds stay text', async () => {
    probe = async () => new Response('{}', { status: 500 })
    const { baseElement, unmount } = renderModal([A, B])
    await waitFor(() => expect(vals(baseElement, 'contact-methods')).toEqual(['n/a', 'n/a']), { timeout: 5000 })
    unmount()
    probe = async url => json({ url, online: true, latencyMs: 5, checkedAt: new Date().toISOString(), keysets: [], info: { name: 'x', nuts: {}, contact: [{ method: '<img src=x onerror=alert(1)>', info: 'x' }] } })
    const again = renderModal([A, B])
    await waitFor(() => expect(vals(again.baseElement, 'contact-methods')[0]).toMatch(/^<img src=x/))
    expect(again.baseElement.querySelector('.cx-row[data-row="contact-methods"] img')).toBeNull()
  })

  it('History is folded: its chart and version requests start only when it is opened', async () => {
    const { baseElement } = renderModal([A, B])
    await waitFor(() => expect(fetched.some(u => u.includes('period=24h'))).toBe(true))
    expect(fetched.some(u => u.includes('/api/mints/version-history'))).toBe(false)
    expect(fetched.some(u => u.includes('period=7d'))).toBe(false)
    const history = Array.from(baseElement.querySelectorAll('details.cx-fold')).find(d => d.querySelector('summary')?.textContent === 'History') as HTMLDetailsElement
    history.open = true
    fireEvent(history, new Event('toggle'))
    await waitFor(() => expect(fetched.some(u => u.includes('/api/mints/version-history'))).toBe(true))
    expect(fetched.some(u => u.includes('period=7d'))).toBe(true)
  })
})
