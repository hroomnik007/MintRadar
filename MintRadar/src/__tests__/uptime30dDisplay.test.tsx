// Methodology 7: where the 30-day uptime is shown next to a score. The card chip appears only below the
// recommendation limit (a chip on every card would be noise), Compare has its own row, and the warning tone
// starts at the same limit as the gate (MIN_RECOMMENDATION_UPTIME_30D_PCT).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KnownMint } from '@/hooks/useKnownMints'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MIN_RECOMMENDATION_UPTIME_30D_PCT, hasSteadyUptime, exactPct as feExactPct } from '@/utils/reliabilityScore'
import { exactPct as beExactPct } from '../../backend/src/shared/reliabilityScore'
import { isUptime30dLow, uptime30dColor } from '@/utils/mintFormatting'
import { COMPARE_UPTIME_30D_LABEL, cardUptime30dChip } from '@/utils/compareLabels'

vi.mock('@/core/nostr/pool', () => ({
  sharedPool: { querySync: () => new Promise<never>(() => undefined), subscribeMany: () => ({ close: () => undefined }) },
}))
vi.mock('@/db', () => ({
  db: { watchlist: { toArray: async () => [] }, mintHistory: { add: async () => 1, where: () => ({ equals: () => ({ sortBy: async () => [] }) }), bulkDelete: async () => undefined } },
}))

import { MintCard } from '@/components/mint/MintCard'
import { ComparisonModal } from '@/components/ComparisonModal'

const STEADY: KnownMint = {
  url: 'https://alpha.mint.example', name: 'Alpha Mint', iconUrl: null, degraded: false, online: true, latencyMs: 50,
  version: 'Nutshell/0.16.0', nutCount: 12, tosUrl: null, descriptionLong: null, nutsLimits: {},
  units: ['sat'], reliabilityScore: 92, uptimePct24h: 100, uptimePct7d: 100, uptimePct30d: 100,
  discoveredAt: '2025-09-01T00:00:00.000Z', lastCheckedAt: new Date().toISOString(),
}
const WEEK_DOWN: KnownMint = { ...STEADY, url: 'https://beta.mint.example', name: 'Beta Mint', reliabilityScore: 82, uptimePct30d: 77 }
const UNKNOWN: KnownMint = { ...STEADY, url: 'https://gamma.mint.example', name: 'Gamma Mint', uptimePct30d: null }

let mobile = false
beforeEach(() => {
  mobile = false
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } })
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: mobile && query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
  }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => { vi.unstubAllGlobals() })

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
)

describe('the warning tone starts where the recommendation gate does', () => {
  it('isUptime30dLow is the exact opposite of hasSteadyUptime for every known percentage', () => {
    for (let p = 0; p <= 100; p++) expect(isUptime30dLow(p), String(p)).toBe(!hasSteadyUptime(p))
    expect(isUptime30dLow(MIN_RECOMMENDATION_UPTIME_30D_PCT)).toBe(false)
    expect(isUptime30dLow(MIN_RECOMMENDATION_UPTIME_30D_PCT - 1)).toBe(true)
  })
  it('unknown is neither low nor coloured as a warning', () => {
    expect(isUptime30dLow(null)).toBe(false)
    expect(isUptime30dLow(undefined)).toBe(false)
    expect(uptime30dColor(null)).toBe('var(--t3)')
    expect(uptime30dColor(100)).toBe('var(--text)')
    expect(uptime30dColor(94)).toBe('var(--med)')
  })
})

describe('mint card', () => {
  const chip = (c: HTMLElement) => c.querySelector('[data-testid="card-uptime-30d"]')
  it('shows the 30-day chip only below the limit', () => {
    expect(chip(render(wrap(<MintCard mint={STEADY} />)).container)).toBeNull()
    expect(chip(render(wrap(<MintCard mint={UNKNOWN} />)).container)).toBeNull()
    expect(chip(render(wrap(<MintCard mint={{ ...STEADY, uptimePct30d: MIN_RECOMMENDATION_UPTIME_30D_PCT }} />)).container)).toBeNull()
    const low = chip(render(wrap(<MintCard mint={WEEK_DOWN} />)).container)
    expect(low?.textContent).toBe(cardUptime30dChip(77))
    expect(low?.textContent).toBe('77% up 30d')
  })
  it('the 24-hour chip stays next to it', () => {
    const { container } = render(wrap(<MintCard mint={WEEK_DOWN} />))
    expect(container.querySelector('.card-pills')?.textContent).toContain('100% up 24h')
  })
})

describe('Compare', () => {
  it('desktop grid: an "Uptime 30d" row with each mint\'s figure, a dash when unknown', () => {
    const { baseElement } = render(wrap(<ComparisonModal mints={[STEADY, WEEK_DOWN, UNKNOWN]} onClose={() => undefined} />))
    const label = Array.from(baseElement.querySelectorAll('.cmp-lbl')).find(l => l.textContent === COMPARE_UPTIME_30D_LABEL)!
    expect(label).toBeTruthy()
    const cells: string[] = []
    for (let el = label.nextElementSibling; el && el.classList.contains('cmp-val'); el = el.nextElementSibling) cells.push(el.textContent ?? '')
    expect(cells).toEqual(['100%', '77%', '—'])
  })
  it('mobile table: the same row; it is a difference between a steady mint and one that was down', () => {
    mobile = true
    const { baseElement } = render(wrap(<ComparisonModal mints={[STEADY, WEEK_DOWN]} onClose={() => undefined} />))
    const row = baseElement.querySelector('table.cmp-m-table tbody tr[data-row="uptime-30d"]')!
    expect(row).toBeTruthy()
    expect(row.querySelector('th')?.textContent).toBe(COMPARE_UPTIME_30D_LABEL)
    expect(Array.from(row.querySelectorAll('td')).map(td => td.textContent)).toEqual(['100%', '77%'])
  })
})

describe('the recommendation gate compares the unrounded 30-day share', () => {
  const src = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')
  it('94.5 % does not pass although it is shown as 95 %', () => {
    expect(hasSteadyUptime(94.5)).toBe(false)
    expect(hasSteadyUptime(feExactPct(8204, 8640))).toBe(false)
    expect(hasSteadyUptime(feExactPct(8208, 8640))).toBe(true)
  })
  it('frontend and backend round the share the same way', () => {
    for (const [part, total] of [[8204, 8640], [189, 200], [10, 12], [0, 3], [7, 7]] as const) {
      expect(feExactPct(part, total)).toBe(beExactPct(part, total))
    }
  })
  it('Stats and the Best Mint wizard gate on uptimePct30dExact, never on the whole-percent uptimePct30d', () => {
    for (const page of ['../pages/Stats.tsx', '../pages/Tools.tsx']) {
      const code = src(page)
      expect(code, page).toMatch(/hasSteadyUptime\(m\.uptimePct30dExact\)/)
      expect(code, page).not.toMatch(/hasSteadyUptime\(m\.uptimePct30d\)/)
    }
  })
})
