// The mobile Compare table (ComparisonModal.tsx, ≤768px): every mint side by side in one table with a
// sticky label column, and an "Only differences" switch that hides rows equal for every mint.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KnownMint } from '@/hooks/useKnownMints'

vi.mock('@/core/nostr/pool', () => ({
  sharedPool: { querySync: () => new Promise<never>(() => undefined), subscribeMany: () => ({ close: () => undefined }) },
}))

import { ComparisonModal } from '@/components/ComparisonModal'

const A: KnownMint = {
  url: 'https://alpha.mint.example', name: 'Alpha Mint', iconUrl: null, degraded: false, online: true, latencyMs: 50,
  version: 'Nutshell/0.16.0', nutCount: 2, tosUrl: null, descriptionLong: null,
  nutsLimits: { '4': {}, '5': {} }, units: ['sat'], reliabilityScore: 80, uptimePct24h: 99, uptimePct7d: 99,
  discoveredAt: '2025-09-01T00:00:00.000Z', lastCheckedAt: new Date().toISOString(),
}
const B: KnownMint = { ...A, url: 'https://beta.mint.example', name: 'Beta Mint', latencyMs: 300, reliabilityScore: 60 }
const C: KnownMint = { ...A, url: 'https://gamma.mint.example', name: 'Gamma Mint', latencyMs: 120 }

let mobile = true
beforeEach(() => {
  mobile = true
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: mobile && query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
  }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => { vi.unstubAllGlobals() })

function renderModal(mints: KnownMint[]) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><ComparisonModal mints={mints} onClose={() => undefined} /></MemoryRouter>
    </QueryClientProvider>,
  )
}
const rowIds = (root: HTMLElement) => Array.from(root.querySelectorAll('table.cmp-m-table tbody tr')).map(r => r.getAttribute('data-row'))

describe('mobile Compare table', () => {
  it('one column per mint, row headers with scope, a labelled scroll region; no tabs, no desktop grid', () => {
    const { baseElement } = renderModal([A, B, C])
    const region = screen.getByRole('region', { name: 'Mint comparison table' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.getAttribute('aria-describedby')).toBeTruthy()
    const table = within(region).getByRole('table')
    const cols = table.querySelectorAll('thead th[scope="col"]:not(.cmp-m-corner)')
    expect(Array.from(cols).map(c => c.querySelector('.cmp-m-mint-name')?.textContent)).toEqual(['Alpha Mint', 'Beta Mint', 'Gamma Mint'])
    expect(table.querySelectorAll('tbody th[scope="row"]').length).toBe(table.querySelectorAll('tbody tr').length)
    expect(baseElement.querySelector('.cmp-grid')).toBeNull()
    expect(baseElement.querySelector('.cmp-mobile-tab')).toBeNull()
    expect(screen.getByText(/3 mints side by side, scroll sideways for more/)).toBeTruthy()
  })

  it('"Only differences" is a switch; on, it hides rows equal for every mint and says how many differ', () => {
    const { baseElement } = renderModal([A, B])
    const all = rowIds(baseElement)
    expect(all).toEqual(expect.arrayContaining(['status', 'reliability', 'latency', 'version']))
    const sw = screen.getByRole('switch', { name: 'Only differences' })
    expect(sw.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    const shown = rowIds(baseElement)
    expect(shown).toContain('reliability')
    expect(shown).toContain('latency')
    expect(shown).not.toContain('status')
    expect(shown).not.toContain('version')
    expect(shown).not.toContain('nut-count')
    const status = baseElement.querySelector('.cmp-m-status')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toMatch(new RegExp(`^${shown.length} of ${all.length} rows differ`))

    fireEvent.click(sw)
    expect(rowIds(baseElement)).toEqual(all)
    expect(status.textContent).toBe('')
  })

  it('identical mints: the switch shows that every row is the same instead of an empty table', () => {
    const twin: KnownMint = { ...A, url: 'https://twin.mint.example', name: 'Twin Mint' }
    const { baseElement } = renderModal([A, twin])
    fireEvent.click(screen.getByRole('switch', { name: 'Only differences' }))
    const status = baseElement.querySelector('.cmp-m-status')!.textContent ?? ''
    // Rows still loading (fee, uptime history) stay visible, so either message is honest.
    expect(status).toMatch(/Every row has the same value for these mints\.|rows differ/)
    expect(rowIds(baseElement)).not.toContain('latency')
  })

  it('methods, limits and units rows: a switched-off side reads "Disabled by the mint"; Only differences compares them', () => {
    const withMethods: KnownMint = {
      ...A, units: ['sat'],
      mintMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000 }, { method: 'bolt12', unit: 'sat', min_amount: 1, max_amount: 500 }],
      meltMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 800 }],
    }
    const off: KnownMint = { ...withMethods, url: 'https://off.mint.example', name: 'Off Mint', nutsLimits: { '4': { methods: [], disabled: true }, '5': {} } }
    const { baseElement } = renderModal([withMethods, off])
    const row = (id: string) => baseElement.querySelector(`table.cmp-m-table tbody tr[data-row="${id}"]`) as HTMLElement
    expect(rowIds(baseElement)).toEqual(expect.arrayContaining(['deposit-methods', 'withdrawal-methods', 'limits', 'units']))
    const dep = row('deposit-methods').querySelectorAll('td')
    expect(dep[0]!.textContent).toBe('bolt11, bolt12')
    expect(dep[1]!.textContent).toContain('Disabled by the mint')
    const lim = row('limits').querySelectorAll('td')
    expect(lim[0]!.textContent).toContain('Deposit · bolt12 · satmin 1, max 500')
    expect(lim[1]!.textContent).toContain('Depositdisabled by the mint')
    expect(row('units').textContent).toContain('SAT')

    fireEvent.click(screen.getByRole('switch', { name: 'Only differences' }))
    const shown = rowIds(baseElement)
    expect(shown).toContain('deposit-methods')
    expect(shown).toContain('limits')
    expect(shown).not.toContain('withdrawal-methods')
    expect(shown).not.toContain('units')
  })

  it('desktop grid shows the same methods, limits and units rows', () => {
    mobile = false
    const off: KnownMint = { ...B, nutsLimits: { '4': {}, '5': { methods: [], disabled: true } }, units: ['sat', 'usd'] }
    const { baseElement } = renderModal([{ ...A, mintMethods: [{ method: 'bolt11', unit: 'sat' }], meltMethods: [{ method: 'bolt11', unit: 'sat' }] }, off])
    const cells = (id: string) => Array.from(baseElement.querySelectorAll(`.cmp-grid .cmp-val[data-row="${id}"]`)).map(e => e.textContent)
    expect(cells('deposit-methods')).toEqual(['bolt11', 'None declared'])
    expect(cells('withdrawal-methods')[1]).toContain('Disabled by the mint')
    expect(cells('units')).toEqual(['SAT', 'SAT, USD'])
    expect(cells('limits')[0]).toContain('min not declared, max not declared')
  })

  it('desktop keeps the grid and has no switch', () => {
    mobile = false
    const { baseElement } = renderModal([A, B])
    expect(baseElement.querySelector('.cmp-grid')).not.toBeNull()
    expect(baseElement.querySelector('table.cmp-m-table')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Only differences' })).toBeNull()
  })
})
