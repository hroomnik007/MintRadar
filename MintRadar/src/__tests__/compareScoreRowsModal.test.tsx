// The new Compare rows (score points, contact methods, NIP-87) rendered in the modal, on the desktop grid and the phone table.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KnownMint } from '@/hooks/useKnownMints'

vi.mock('@/core/nostr/pool', () => ({
  sharedPool: { querySync: () => new Promise<never>(() => undefined), subscribeMany: () => ({ close: () => undefined }) },
}))

import { ComparisonModal } from '@/components/ComparisonModal'

const parts = (u: number) => ({ uptime: { points: u, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: 12, max: 15 }, version: { points: 15, max: 15 }, contact: { points: 3, max: 5 }, newMintCap: { points: 0, cap: 70 }, sum: 0 })
const A: KnownMint = {
  url: 'https://alpha.mint.example', name: 'Alpha Mint', iconUrl: null, degraded: false, online: true, latencyMs: 50,
  version: 'Nutshell/0.16.0', nutCount: 2, tosUrl: null, descriptionLong: null, nutsLimits: { '4': {}, '5': {} }, units: ['sat'],
  reliabilityScore: 90, scoreBreakdown: parts(40), uptimePct24h: 99, discoveredAt: '2025-09-01T00:00:00.000Z', lastCheckedAt: new Date().toISOString(),
  nostrAnnouncedAt: '2026-03-14T09:30:00.000Z', auditCzBlamed: 0, auditCzTotal: 50, auditCzFetchedAt: new Date().toISOString(),
}
const B: KnownMint = { ...A, url: 'https://beta.mint.example', name: 'Beta Mint', reliabilityScore: 60, scoreBreakdown: parts(20), nostrAnnouncedAt: null }
const C: KnownMint = { ...A, url: 'https://gamma.mint.example', name: 'Gamma Mint', reliabilityScore: null, scoreBreakdown: null, nostrAnnouncedAt: null }

const EXTRA = ['uptime-points', 'audit-points', 'nut-points', 'version-points', 'contact-points', 'contact-methods', 'nip87']
let mobile = true
let probe: (url: string) => Promise<Response>
beforeEach(() => {
  mobile = true
  probe = async url => new Response(JSON.stringify({
    url, online: true, latencyMs: 5, checkedAt: new Date().toISOString(), keysets: [],
    info: { name: 'x', nuts: {}, contact: url.includes('alpha') ? [{ method: 'nostr', info: 'npub1alpha' }, { method: 'email', info: 'a@alpha.example' }] : [] },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: mobile && query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
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
const mRow = (root: HTMLElement, id: string) => root.querySelector(`table.cmp-m-table tbody tr[data-row="${id}"]`) as HTMLElement | null
const mVals = (root: HTMLElement, id: string) => Array.from(mRow(root, id)?.querySelectorAll('td') ?? []).map(td => (td.textContent ?? '').trim())
const dVals = (root: HTMLElement, id: string) => Array.from(root.querySelectorAll(`.cmp-grid .cmp-val[data-row="${id}"]`)).map(e => (e.textContent ?? '').trim())

describe('Compare: score points, contact methods and NIP-87 rows', () => {
  it('phone table: the seven rows follow the audit row in the specified order, each its own row', async () => {
    const { baseElement } = renderModal([A, B, C])
    const ids = Array.from(baseElement.querySelectorAll('table.cmp-m-table tbody tr')).map(r => r.getAttribute('data-row'))
    const at = ids.indexOf('audit')
    expect(ids.slice(at + 1, at + 8)).toEqual(EXTRA)
    expect(ids[at + 8]).toBe('backup')
    const labels = Array.from(baseElement.querySelectorAll('table.cmp-m-table tbody tr th[scope="row"]')).map(t => (t.textContent ?? '').trim())
    expect(labels.slice(at + 1, at + 8)).toEqual(['Uptime points', 'Audit points', 'NUT support points', 'Version points', 'Contact points', 'Contact methods', 'NIP-87 announcement'])
    // the old Uptime percentage row is still there
    expect(ids).toContain('uptime')
  })

  it('values: points with the max, "—" for a mint without a stored score, kinds only, NIP-87 text', async () => {
    const { baseElement } = renderModal([A, B, C])
    expect(mVals(baseElement, 'uptime-points')).toEqual(['40 / 40', '20 / 40', '—'])
    expect(mVals(baseElement, 'audit-points')).toEqual(['25 / 25', '25 / 25', '—'])
    expect(mVals(baseElement, 'contact-points')).toEqual(['3 / 5', '3 / 5', '—'])
    expect(mVals(baseElement, 'nip87')).toEqual(['Seen · event dated 14 Mar 2026', 'Not seen on our relays', 'Not seen on our relays'])
    await waitFor(() => expect(mVals(baseElement, 'contact-methods')).toEqual(['Email · Nostr', 'None listed', 'None listed']))
    expect(baseElement.querySelector('.cmp-m-table')?.textContent).not.toMatch(/npub1alpha|a@alpha\.example/)
  })

  it('desktop grid: the same rows, values and order', async () => {
    mobile = false
    const { baseElement } = renderModal([A, B])
    const labels = [...baseElement.querySelectorAll('.cmp-grid .cmp-lbl')].map(e => (e.textContent ?? '').trim())
    const at = labels.findIndex(l => l.startsWith('No mint fault'))
    expect(labels.slice(at + 1, at + 8)).toEqual(['Uptime points', 'Audit points', 'NUT support points', 'Version points', 'Contact points', 'Contact methods', 'NIP-87 announcement'])
    expect(labels[at + 8]).toBe('Backup')
    expect(dVals(baseElement, 'uptime-points')).toEqual(['40 / 40', '20 / 40'])
    expect(dVals(baseElement, 'nip87')).toEqual(['Seen · event dated 14 Mar 2026', 'Not seen on our relays'])
    await waitFor(() => expect(dVals(baseElement, 'contact-methods')).toEqual(['Email · Nostr', 'None listed']))
  })

  it('"Only differences": a new row is hidden when every mint agrees and kept when they differ (both layouts)', async () => {
    for (const isMobile of [true, false]) {
      mobile = isMobile
      const original = probe
      probe = url => original(url.replace('beta', 'alpha')) // both mints list the same contact kinds
      const { baseElement, unmount } = renderModal([A, { ...A, url: 'https://beta.mint.example', name: 'Beta Mint' }])
      await waitFor(() => expect(baseElement.textContent).toContain('Email · Nostr'))
      const ids = () => isMobile
        ? Array.from(baseElement.querySelectorAll('table.cmp-m-table tbody tr')).map(r => r.getAttribute('data-row'))
        : EXTRA.filter(id => baseElement.querySelector(`.cmp-grid .cmp-val[data-row="${id}"]`))
      expect(ids()).toEqual(expect.arrayContaining(EXTRA))
      fireEvent.click(screen.getByRole('switch', { name: 'Only differences' }))
      // identical mints: every new row is the same for both
      for (const id of EXTRA) expect(ids()).not.toContain(id)
      unmount()
      probe = original
      const again = renderModal([A, B])
      await waitFor(() => expect(again.baseElement.textContent).toContain('None listed'))
      fireEvent.click(again.getAllByRole('switch', { name: 'Only differences' })[0]!)
      const kept = isMobile
        ? Array.from(again.baseElement.querySelectorAll('table.cmp-m-table tbody tr')).map(r => r.getAttribute('data-row'))
        : EXTRA.filter(id => again.baseElement.querySelector(`.cmp-grid .cmp-val[data-row="${id}"]`))
      expect(kept).toEqual(expect.arrayContaining(['uptime-points', 'contact-methods', 'nip87']))
      expect(kept).not.toContain('audit-points') // 25 / 25 for both
      again.unmount()
    }
  })

  it('contact methods: "…" while the probe is held, then the kinds; "n/a" when the probe fails', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => { release = r })
    const original = probe
    probe = async url => { await gate; return original(url) }
    const { baseElement } = renderModal([A, B])
    expect(mVals(baseElement, 'contact-methods')).toEqual(['…', '…'])
    // a held row stays visible under "Only differences"
    fireEvent.click(screen.getByRole('switch', { name: 'Only differences' }))
    expect(mRow(baseElement, 'contact-methods')).not.toBeNull()
    release()
    await waitFor(() => expect(mVals(baseElement, 'contact-methods')).toEqual(['Email · Nostr', 'None listed']))
  })

  it('contact methods: a failed probe reads "n/a"', async () => {
    probe = async () => new Response('{}', { status: 500 })
    const { baseElement } = renderModal([A, B])
    await waitFor(() => expect(mVals(baseElement, 'contact-methods')).toEqual(['n/a', 'n/a']), { timeout: 5000 })
  })

  it('hostile contact kind names are rendered as text, never as markup', async () => {
    probe = async url => new Response(JSON.stringify({ url, online: true, latencyMs: 5, checkedAt: new Date().toISOString(), keysets: [], info: { name: 'x', nuts: {}, contact: [{ method: '<img src=x onerror=alert(1)>', info: 'x' }, { method: 'email', info: 'x' }] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    const { baseElement } = renderModal([A, B])
    await waitFor(() => expect(mVals(baseElement, 'contact-methods')[0]).toBe('Email · <img src=x onerror=aler…'))
    expect(baseElement.querySelector('.cmp-m-table img')).toBeNull()
  })
})
