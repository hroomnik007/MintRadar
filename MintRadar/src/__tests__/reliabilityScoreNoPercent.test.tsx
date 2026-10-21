// A Reliability Score is a number of points from 0 to 100, never a percentage (docs/claude/scoring-and-probing.md,
// "Score is points"): a plain number in compact places, "92/100" in running text. This renders every place that
// shows the score of a mint with a fixture and scans its text for a percent sign. Real percentages (uptime,
// adoption) are not part of the scan: each element is picked by what it shows, not by "all text of the page".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KnownMint } from '@/hooks/useKnownMints'

const MINT_URL = 'https://alpha.mint.example'
const MINT: KnownMint = {
  url: MINT_URL, name: 'Alpha Mint', iconUrl: null, degraded: false, online: true, latencyMs: 50,
  version: 'Nutshell/0.16.0', nutCount: 12, tosUrl: null, descriptionLong: null, nutsLimits: {},
  units: ['sat'], reliabilityScore: 92, uptimePct24h: 99, uptimePct7d: 99,
  discoveredAt: '2025-09-01T00:00:00.000Z', lastCheckedAt: new Date().toISOString(),
}
const OTHER: KnownMint = { ...MINT, url: 'https://beta.mint.example', name: 'Beta Mint', reliabilityScore: 78 }

const known = vi.hoisted(() => ({
  state: { data: undefined as unknown, isLoading: false, isError: false, error: null, refetch: vi.fn() },
}))
vi.mock('@/hooks/useKnownMints', () => ({ useKnownMints: () => known.state }))
vi.mock('@/hooks/useNostrDiscovery', () => ({ useNostrDiscovery: () => undefined }))
vi.mock('@/hooks/useFollowRecommendations', () => ({ useFollowRecommendations: () => ({ data: undefined, isLoading: false, isError: false }) }))
// Mint Detail reads live reviews and profiles through sharedPool (useMintReviews, useMintOperatorNip05). Unmocked, that opened
// real WebSockets to the public relays, and a connection that completed while jsdom was torn down raised an "Unhandled
// Error" in about one whole-suite run in five (Task F3). A relay that never answers is what the score checks assume: the
// promise stays pending, so nothing re-renders after the test (an answer would, once vi.unstubAllGlobals has run).
vi.mock('@/core/nostr/pool', () => ({
  sharedPool: { querySync: () => new Promise<never>(() => undefined), subscribeMany: () => ({ close: () => undefined }) },
}))

// jsdom has no IndexedDB: the probe's history save is the only Dexie use these renders reach.
vi.mock('@/db', () => ({
  db: { watchlist: { toArray: async () => [] }, mintHistory: { add: async () => 1, where: () => ({ equals: () => ({ sortBy: async () => [] }) }), bulkDelete: async () => undefined } },
}))

import MintDetail from '@/pages/MintDetail'
import Stats from '@/pages/Stats'
import { MintCard } from '@/components/mint/MintCard'
import { ComparisonModal } from '@/components/ComparisonModal'

const TREND = { trend: [{ date: '2026-10-01', avgReliability: 80 }, { date: '2026-10-10', avgReliability: 90 }, { date: '2026-10-19', avgReliability: 86 }], periodDays: 30, earliestCheckedAt: null, daysOfDataAvailable: 30 }
const STATS = {
  totalMints: 2, onlineMints: 2, offlineMints: 0, avgReliabilityScore: 86, avgLatency24h: 110,
  reliabilityDistribution: { low: 0, moderate: 1, high: 1 }, nutAdoption: [], top5ByReliabilityScore: [],
}

beforeEach(() => {
  known.state.data = [MINT, OTHER]
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.startsWith('/api/stats/reliability-trend')) return json(TREND)
    if (url.startsWith('/api/stats/reliability-movers')) return json({ period: '7d', risers: [{ url: MINT_URL, name: 'Alpha Mint', delta: 12 }], fallers: [] })
    if (url === '/api/stats') return json(STATS)
    if (url.startsWith('/api/mints/history')) return json({ period: '7d', segments: [] })
    if (url.startsWith('/api/mints/version-history')) return json({ history: [], latestGlobalVersion: null })
    return json([])
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const wrap = (ui: React.ReactElement, path = '/', route = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={ui} /></Routes></MemoryRouter>
  </QueryClientProvider>
)

describe('no rendered Reliability Score contains a percent sign', () => {
  it('Dashboard card: the score and its "Reliability" line', () => {
    const { container } = render(wrap(<MintCard mint={MINT} />))
    const card = container.querySelector('.mint-card') as HTMLElement
    expect(card).not.toBeNull()
    const score = within(card).getByText('92')
    expect(score.textContent).not.toContain('%')
    expect(card.querySelector('.card-reliability')?.textContent ?? '').not.toContain('%')
    // the uptime pill on the same card is a real percentage and stays one
    expect(card.textContent).toContain('99% up 24h')
  })

  it('Compare modal: the Reliability Score row, desktop table and mobile cards', () => {
    const { baseElement } = render(wrap(<ComparisonModal mints={[MINT, OTHER]} onClose={() => undefined} />))
    const scores = Array.from(baseElement.querySelectorAll('span')).filter(s => s.textContent === '92' || s.textContent === '78')
    expect(scores.length).toBeGreaterThanOrEqual(2)
    expect(baseElement.textContent).not.toMatch(/(92|78)%/)
  })

  it('Mint Detail: the ring, the page meta and the summary tile', async () => {
    const { container } = render(wrap(<MintDetail />, `/mint/${encodeURIComponent(MINT_URL)}`, '/mint/:url'))
    const ring = await waitFor(() => {
      const el = container.querySelector('.md-sc-reliability-num')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(ring.textContent).toBe('92')
    expect(container.querySelector('.md-sc-reliability')?.textContent ?? '').not.toContain('%')
    const description = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? ''
    expect(description).toContain('Reliability Score of 92/100')
    expect(description).not.toMatch(/92\s*%/)
  })

  it('Stats: the trend summary (Current / High / Low) shows the average score as a plain number', async () => {
    const { container } = render(wrap(<Stats />, '/stats', '/stats'))
    const row = await waitFor(() => {
      const el = container.querySelector('.trend-summary-row')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(row.textContent).toMatch(/Current\s*86/)
    expect(row.textContent).not.toContain('%')
    // the Reliability Score movers column is a change in points
    await waitFor(() => expect(container.querySelector('.stats-movers-delta')).not.toBeNull())
    for (const d of Array.from(container.querySelectorAll('.stats-movers-delta'))) expect(d.textContent).not.toContain('%')
    expect(screen.getByText('+12')).toBeInTheDocument()
  })
})
