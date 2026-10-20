import type { Page } from '@playwright/test'
import { MOCK_KNOWN_MINTS, MOCK_STATS } from './mocks'
import { trendPayload, trendDaysOf } from './trendSeries'

// Realistic /stats data for the layout-shift specs and for re-measuring the reserved heights
// (docs/claude/stats-dashboard-watchlist-ui.md, "Layout shift rule"): 50 online mints, 20 geography rows
// (19 cities + the CDN bucket), 5 software families, 3 risers and 3 fallers, a 30 day trend. The endpoints can be
// held one by one; a held response is released only after the request reached the mock.

export type StatsEndpoint = 'stats' | 'known' | 'movers' | 'trend'
export const STATS_ENDPOINTS: StatsEndpoint[] = ['stats', 'known', 'movers', 'trend']

const CITIES = [
  'Germany', 'United States', 'Finland', 'Netherlands', 'France', 'Canada', 'United Kingdom', 'Singapore', 'Japan',
  'Switzerland', 'Sweden', 'Poland', 'Australia', 'Brazil', 'Ireland', 'Lithuania', 'South Africa', 'Czechia', 'Cloudflare CDN',
]
// 19 cities + the CDN bucket = 20 rows; the first ones are the biggest so the list is not flat.
const LOCATIONS = [...CITIES.flatMap((c, i) => Array<string>(i < 4 ? 5 - i : 2).fill(c)), 'Germany', 'Finland', 'Canada', 'France', 'Cloudflare CDN']
const SOFTWARE: Array<[string, number]> = [['Nutshell/0.16.5', 20], ['Nutshell/0.15.3', 8], ['cdk-mintd/0.13.4', 12], ['gonuts/0.4.0', 5], ['moksha-mint/0.3.0', 3], ['', 2]]

function mints(): typeof MOCK_KNOWN_MINTS {
  const versions = SOFTWARE.flatMap(([v, n]) => Array<string | null>(n).fill(v === '' ? null : v))
  const base = MOCK_KNOWN_MINTS[0]!
  return Array.from({ length: 50 }, (_, i) => ({
    ...base,
    url: `https://mint${i + 1}.example`,
    name: `Mint ${String.fromCharCode(65 + (i % 26))}${i + 1}`,
    online: true,
    version: versions[i % versions.length] ?? null,
    softwareLatest: null,
    reliabilityScore: 96 - (i % 40),
    uptimePct24h: 100 - (i % 9),
    uptimePct7d: 100 - (i % 7),
    discoveredAt: new Date(Date.now() - (60 + i) * 86_400_000).toISOString(),
    serverLocation: LOCATIONS[i % LOCATIONS.length]!,
  }))
}

const statsPayload = () => ({
  ...MOCK_STATS,
  totalMints: 57,
  onlineMints: 50,
  offlineMints: 7,
  reliabilityDistribution: { low: 4, moderate: 14, high: 32 },
  top5ByReliabilityScore: mints().slice(0, 5).map(m => ({ url: m.url, name: m.name, reliabilityScore: m.reliabilityScore as number })),
})

const moversPayload = (period: '7d' | '30d') => ({
  period,
  risers: [{ url: 'https://mint3.example', name: 'Mint C3', delta: 14 }, { url: 'https://mint9.example', name: 'Mint I9', delta: 9 }, { url: 'https://mint21.example', name: 'Mint V21', delta: 6 }],
  fallers: [{ url: 'https://mint5.example', name: 'Mint E5', delta: -11 }, { url: 'https://mint12.example', name: 'Mint L12', delta: -8 }, { url: 'https://mint30.example', name: 'Mint E30', delta: -5 }],
})

export interface StatsGate {
  /** Resolves when the held request has reached the mock. */
  reached: (endpoint: StatsEndpoint) => Promise<void>
  /** Lets the held response through (call it only after `reached`). */
  release: (endpoint: StatsEndpoint) => void
}

/** Mocks the four endpoints /stats needs (and the Nostr-free rest of installApiMocks is NOT needed here). */
export async function mockStatsEndpoints(page: Page, held: StatsEndpoint[] = []): Promise<StatsGate> {
  const reachedAt = new Map<StatsEndpoint, () => void>()
  const reachedP = new Map<StatsEndpoint, Promise<void>>()
  const releaseAt = new Map<StatsEndpoint, () => void>()
  const releaseP = new Map<StatsEndpoint, Promise<void>>()
  for (const e of STATS_ENDPOINTS) {
    reachedP.set(e, new Promise<void>(r => reachedAt.set(e, r)))
    releaseP.set(e, new Promise<void>(r => releaseAt.set(e, r)))
  }
  const serve = (e: StatsEndpoint, body: () => unknown) => async (route: import('@playwright/test').Route) => {
    reachedAt.get(e)!()
    if (held.includes(e)) await releaseP.get(e)
    await route.fulfill({ json: body() })
  }
  await page.route('**/api/stats', serve('stats', statsPayload))
  await page.route('**/api/mints/known', serve('known', mints))
  await page.route('**/api/stats/reliability-movers**', route =>
    serve('movers', () => moversPayload(new URL(route.request().url()).searchParams.get('period') === '30d' ? '30d' : '7d'))(route))
  await page.route('**/api/stats/reliability-trend**', route =>
    // Only the first (30 day) request is the held one; the idle prefetch of 90 days is answered at once.
    trendDaysOf(route.request().url()) === 30 ? serve('trend', () => trendPayload(30))(route) : route.fulfill({ json: trendPayload(90) }))
  return { reached: e => reachedP.get(e)!, release: e => releaseAt.get(e)!() }
}
