import type { Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './mocks'

// One grid row carrying every card variant that changes the middle (badge) row
// of the card: normal, Test mint, "No reviews yet", offline, "New".
// Unit orders are deliberately mixed (API order, not canonical) to exercise sortUnits.
const base = MOCK_KNOWN_MINTS[0]
const mk = (name: string, over: Record<string, unknown>) => ({
  ...base,
  url: `https://${name.toLowerCase()}.mint.example`,
  name: `${name} Mint`,
  online: true,
  degraded: false,
  archived: false,
  discoveredAt: new Date(Date.now() - 200 * 86_400_000).toISOString(),
  uptimePct24h: 99,
  reviewCount: 12,
  reviewAvgRating: 4.2,
  ...over,
})

export const MIXED_ROW_MINTS = [
  mk('Normal', { reliabilityScore: 95, units: ['usd', 'sat'] }),
  mk('Testmint', { url: 'https://testnut.cashu.space', reliabilityScore: 90, units: ['eur', 'usd', 'sat'] }),
  mk('Noreviews', { reliabilityScore: 85, units: ['sat'], reviewCount: 0, reviewAvgRating: null }),
  mk('Offline', { reliabilityScore: 80, online: false, latencyMs: null, units: ['usd', 'sat'], reviewCount: 0, reviewAvgRating: null }),
  mk('Newbie', { reliabilityScore: 75, units: ['sat', 'usd'], discoveredAt: new Date().toISOString() }),
]

export async function gotoMixedRow(page: Page, mode: 'cards' | 'list' = 'cards') {
  await mockRelays(page)
  await installApiMocks(page)
  await page.addInitScript(m => localStorage.setItem('mintRadar_viewMode', m), mode)
  await page.route('**/api/mints/known', r => r.fulfill({ json: MIXED_ROW_MINTS }))
  await page.goto('/?testmints=show&status=all')
}
