// Compare's NUT chips and Backup row use the one NUT rule (utils/nutSupport.ts) that the score and Mint Detail use:
// a NUT listed as { supported: false } in /v1/info is grey / not supported, not green.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { KnownMint } from '@/hooks/useKnownMints'

vi.mock('@/core/nostr/pool', () => ({
  sharedPool: { querySync: () => new Promise<never>(() => undefined), subscribeMany: () => ({ close: () => undefined }) },
}))

import { ComparisonModal } from '@/components/ComparisonModal'

const BASE: KnownMint = {
  url: 'https://alpha.mint.example', name: 'Alpha Mint', iconUrl: null, degraded: false, online: true, latencyMs: 50,
  version: 'Nutshell/0.16.0', nutCount: 2, tosUrl: null, descriptionLong: null,
  nutsLimits: { '4': { methods: [] }, '7': { supported: false }, '9': { supported: false }, '10': { supported: true } },
  units: ['sat'], reliabilityScore: 80, uptimePct24h: 99, uptimePct7d: 99,
  discoveredAt: '2025-09-01T00:00:00.000Z', lastCheckedAt: new Date().toISOString(),
}
const OTHER: KnownMint = { ...BASE, url: 'https://beta.mint.example', name: 'Beta Mint', nutsLimits: { '7': {}, '9': {} } }

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } })
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => { vi.unstubAllGlobals() })

/** The NUT chips of the desktop table, one array per mint column: [label, green?]. */
function chips(root: HTMLElement) {
  const label = Array.from(root.querySelectorAll('.cmp-lbl')).find(e => e.textContent?.startsWith('NUT Support'))!
  const cols: Element[] = []
  for (let el = label.nextElementSibling; el && el.classList.contains('cmp-val'); el = el.nextElementSibling) cols.push(el)
  return cols.map(c => Array.from(c.querySelectorAll('span')).filter(s => /^\d\d$/.test(s.textContent ?? ''))
    .map(s => [s.textContent, (s as HTMLElement).style.color === 'var(--accent)'] as const))
}

describe('Compare NUT Support follows the score rule', () => {
  it('{ supported: false } is grey, presence and { supported: true } are green', () => {
    const { baseElement } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><ComparisonModal mints={[BASE, OTHER]} onClose={() => undefined} /></MemoryRouter>
      </QueryClientProvider>,
    )
    const [alpha, beta] = chips(baseElement)
    const green = (col: ReadonlyArray<readonly [string | null, boolean]>) => col.filter(c => c[1]).map(c => c[0])
    expect(green(alpha!)).toEqual(['04', '10'])
    expect(green(beta!)).toEqual(['07', '09'])
  })
})
