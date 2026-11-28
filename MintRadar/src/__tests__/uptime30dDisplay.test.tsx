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
import { isUptime30dLow, uptime30dColor, uptime30dShown, formatUptime30d } from '@/utils/mintFormatting'
import { COMPARE_UPTIME_30D_LABEL } from '@/utils/compareLabels'

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
    expect(uptime30dColor(0)).toBe('var(--red)')
  })
})

// Since 2026-11-22 (owner) the home card shows the last 24 hours ("Uptime 24 h" and 24 hourly bars); the 30-day figure
// is on Mint Detail and in Compare. The same display rule: one decimal, rounded down, ochre below the gate's limit.
describe('mint card', () => {
  const fact = (c: HTMLElement) => c.querySelector('[data-testid="card-uptime-24h"]') as HTMLElement | null
  const DAY_DOWN: KnownMint = { ...STEADY, url: 'https://beta.mint.example', name: 'Beta Mint', uptimePct24h: 77, uptimePct24hExact: 77 }
  it('marks the 24-hour uptime only below the limit', () => {
    expect(fact(render(wrap(<MintCard mint={STEADY} />)).container)?.dataset.low).toBeUndefined()
    expect(fact(render(wrap(<MintCard mint={{ ...STEADY, uptimePct24h: null }} />)).container)?.textContent).toBe('–')
    expect(fact(render(wrap(<MintCard mint={{ ...STEADY, uptimePct24h: MIN_RECOMMENDATION_UPTIME_30D_PCT }} />)).container)?.dataset.low).toBeUndefined()
    const low = fact(render(wrap(<MintCard mint={DAY_DOWN} />)).container)
    expect(low?.textContent).toBe('77.0%')
    expect(low?.dataset.low).toBe('true')
    expect(low?.style.color).toContain('--med')
  })
  it('the fact is "Uptime 24 h", not the 30-day figure', () => {
    const { container } = render(wrap(<MintCard mint={{ ...WEEK_DOWN, uptimePct24h: 100, uptimePct24hExact: 100 }} />))
    expect(container.querySelector('.card-facts')?.textContent).toContain('Uptime 24 h100%')
    expect(container.querySelector('.card-facts')?.textContent).not.toContain('30 d')
  })
  it('shows uptimePct24hExact with one decimal and never rounds up to 100', () => {
    const facts = (m: KnownMint) => render(wrap(<MintCard mint={m} />)).container.querySelector('.card-facts')?.textContent
    expect(facts({ ...STEADY, uptimePct24h: 100, uptimePct24hExact: 99.6 })).toContain('Uptime 24 h99.6%')
    expect(facts({ ...STEADY, uptimePct24h: 100, uptimePct24hExact: 100 })).toContain('Uptime 24 h100%')
    // No exact figure (older snapshot): the whole percent.
    expect(facts({ ...STEADY, uptimePct24h: 98, uptimePct24hExact: null })).toContain('Uptime 24 h98.0%')
  })
  it('24 hourly bars, labelled "24 h" and "Now"', () => {
    const hours = Array<number | null>(24).fill(100); hours[20] = 50
    const { container } = render(wrap(<MintCard mint={{ ...STEADY, uptimeHourly24: hours }} />))
    expect(container.querySelectorAll('.uptime-bars i')).toHaveLength(24)
    expect(container.querySelector('.uptime-bars')?.getAttribute('aria-label')).toBe('Uptime per hour, last 24 hours: 23 of 24 checked hours 99.5 % or more, lowest 50 %')
    expect(container.querySelector('.uptime-scale')?.textContent).toBe('24 hNow')
  })
})

describe('uptime30dShown / formatUptime30d', () => {
  it('cuts down to one decimal and falls back to the whole percent', () => {
    expect(uptime30dShown(99.99, 100)).toBe(99.9)
    expect(uptime30dShown(4.35, 4)).toBe(4.3)
    expect(uptime30dShown(null, 97)).toBe(97)
    expect(uptime30dShown(undefined, null)).toBeNull()
    expect(formatUptime30d(99.9)).toBe('99.9')
    expect(formatUptime30d(97)).toBe('97.0')
    expect(formatUptime30d(100)).toBe('100')
    expect(formatUptime30d(0)).toBe('0')
  })
})

// Compare (redesign 2026-11-28): each row's label above, one value per mint column; the hidden mint name is not counted.
const cmpVals = (root: HTMLElement, id: string) => Array.from(root.querySelectorAll(`.cx-row[data-row="${id}"] .cx-val`)).map(v => {
  const c = v.cloneNode(true) as HTMLElement
  c.querySelectorAll('.sr-only').forEach(e => e.remove())
  return c.textContent ?? ''
})
describe('Compare', () => {
  it('an "Uptime 30 days" row with each mint\'s figure, a dash when unknown; no BEST while one is unknown', () => {
    const { baseElement } = render(wrap(<ComparisonModal mints={[STEADY, WEEK_DOWN, UNKNOWN]} onClose={() => undefined} />))
    expect(baseElement.querySelector('.cx-row[data-row="uptime-30d"] .cx-lbl')?.textContent).toBe(COMPARE_UPTIME_30D_LABEL)
    expect(cmpVals(baseElement, 'uptime-30d')).toEqual(['100%', '77.0%', '—'])
  })
  it('on a phone the same row; two known figures: the higher one carries BEST', () => {
    mobile = true
    const { baseElement } = render(wrap(<ComparisonModal mints={[STEADY, WEEK_DOWN]} onClose={() => undefined} />))
    expect(cmpVals(baseElement, 'uptime-30d')).toEqual(['100%Best', '77.0%'])
    expect(baseElement.querySelector('.cx-row[data-row="uptime-30d"] .cx-val .cmp-best')?.textContent).toBe('Best')
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
