import type { Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './mocks'

// One grid with every card state that matters for dimming: online, "No reviews yet", Test mint, New,
// offline 24h+ (degraded) with a green / amber / red score, plain offline (not yet degraded) and archived.
const base = MOCK_KNOWN_MINTS[0]
const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
const mk = (name: string, over: Record<string, unknown>) => ({
  ...base,
  url: `https://${name.toLowerCase()}.mint.example`,
  name: `${name} Mint`,
  online: true, degraded: false, archived: false,
  discoveredAt: old, uptimePct24h: 99, latencyMs: 50,
  reviewCount: 12, reviewAvgRating: 4.2,
  lastOnlineAt: null,
  ...over,
})
const sixDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString()

export const DIMMED_MINTS = [
  mk('Normal', { reliabilityScore: 95 }),
  mk('Noreviews', { reliabilityScore: 85, reviewCount: 0, reviewAvgRating: null }),
  mk('Testmint', { url: 'https://testnut.cashu.space', reliabilityScore: 90 }),
  mk('Newbie', { reliabilityScore: 75, discoveredAt: new Date().toISOString() }),
  mk('Offgreen', { reliabilityScore: 80, online: false, degraded: true, latencyMs: null, uptimePct24h: 0, lastOnlineAt: sixDaysAgo }),
  mk('Offamber', { reliabilityScore: 55, online: false, degraded: true, latencyMs: null, uptimePct24h: 3, lastOnlineAt: sixDaysAgo, reviewCount: 0, reviewAvgRating: null }),
  mk('Offred', { reliabilityScore: 25, online: false, degraded: true, latencyMs: null, uptimePct24h: 0, lastOnlineAt: null }),
  mk('Plainoff', { reliabilityScore: 60, online: false, degraded: false, latencyMs: null, uptimePct24h: 40 }),
  mk('Archived', { reliabilityScore: 50, online: false, degraded: true, archived: true, latencyMs: null, uptimePct24h: 0, lastOnlineAt: sixDaysAgo }),
]

export async function gotoDimmedGrid(page: Page, mode: 'cards' | 'list' = 'cards') {
  await mockRelays(page)
  await installApiMocks(page)
  await page.addInitScript(m => localStorage.setItem('mintRadar_viewMode', m), mode)
  await page.route('**/api/mints/known', r => r.fulfill({ json: DIMMED_MINTS }))
  await page.goto('/?testmints=show&status=all')
}
