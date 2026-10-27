// One status rule for the website and the wallet API (2026-10-27). lnpay was `degraded` in /api/v1/wallets/mints
// but "Offline" on its Mint detail page: the page built its own word from `online` alone. Now the API `status` and
// every status word on the site come from utils/mintStatus.ts (twin of backend/src/shared/mintStatus.ts).
import { describe, it, expect } from 'vitest'
import { toWalletMint, type KnownMintLike } from '../../backend/src/walletApi'
import { mintStatusLabel as ogStatusLabel } from '../../backend/src/og'
import { mintStatus } from '@/utils/mintStatus'
import { mintStatusLabel, MINT_STATUS_LABEL, statusDotColor } from '@/utils/mintFormatting'
import { mintStatusWord } from '@/utils/paymentRequest'

const base: KnownMintLike = {
  url: 'https://lnpay.example', name: 'LNpay', archived: false, degraded: false, online: true,
  version: 'Nutshell/0.16.0', softwareLatest: null, nutsLimits: { '4': {}, '5': {} }, units: ['sat'],
  auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null, discoveredAt: '2026-01-01T00:00:00.000Z',
  reliabilityScore: 40, uptimePct24h: 0, uptimePct7d: 50, lastCheckedAt: '2026-10-27T06:00:00.000Z',
  reviewCount: 0, reviewRatedCount: 0, reviewAvgRating: null, operatorReviewCount: 0, latencyMs: null,
  pubkey: null, hasOnion: false, lastOnlineAt: '2026-10-23T19:15:00.000Z',
  mintMethods: [], meltMethods: [],
}
const NOW = Date.UTC(2026, 9, 27, 6, 5, 0)

const snapshots: Array<[string, Partial<KnownMintLike>, string, string]> = [
  ['online', { online: true }, 'online', 'Online'],
  ['offline, under the degraded rule', { online: false }, 'offline', 'Offline'],
  ['degraded (lnpay: no successful probe for 3 days)', { online: false, degraded: true }, 'degraded', 'Degraded'],
  ['archived', { online: false, degraded: true, archived: true }, 'archived', 'Archived'],
  ['never probed', { online: null }, 'offline', 'Offline'],
]

describe('the site and the wallet API derive the same status from the same snapshot', () => {
  it.each(snapshots)('%s', (_n, flags, apiStatus, word) => {
    const m = { ...base, ...flags } as KnownMintLike
    expect(toWalletMint(m, NOW).status).toBe(apiStatus)
    expect(mintStatus(m)).toBe(apiStatus)
    expect(mintStatusLabel(mintStatus(m))).toBe(word)
  })

  it('every API status has a site word; degraded reads "Degraded" (the card badge and the Dashboard note)', () => {
    expect(MINT_STATUS_LABEL).toEqual({ online: 'Online', offline: 'Offline', degraded: 'Degraded', archived: 'Archived' })
  })

  it('the Payment request inspector and the link preview use the same words', () => {
    expect(mintStatusWord({ online: false, degraded: true })).toBe('Degraded')
    expect(mintStatusWord({ online: false, degraded: true, archived: true })).toBe('Archived')
    expect(mintStatusWord({ online: null })).toBe('Unknown')
    expect(ogStatusLabel({ online: false, degraded: true })).toBe('Degraded')
  })

  it('a degraded dot is red like an offline one', () => {
    expect(statusDotColor('Degraded')).toBe(statusDotColor('Offline'))
  })
})
