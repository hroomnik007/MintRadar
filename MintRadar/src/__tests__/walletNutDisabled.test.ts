// NUT-04/05 with `disabled: true` (2026-10-27): the wallet API keeps the NUT in `nuts` (it is declared, backward
// compatible) and adds mintDisabled / meltDisabled; the site's lists and filters treat it as not offered.
import { describe, it, expect } from 'vitest'
import { toWalletMint, nutDisabledOf, parseWalletListQuery, walletListEnvelope, type KnownMintLike } from '../../backend/src/walletApi'

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0)
const BASE: KnownMintLike = {
  url: 'https://mint.lek.example', name: 'Lek', archived: false, degraded: false, online: true,
  version: 'Nutshell/0.21.0', softwareLatest: { major: 0, minor: 21 },
  nutsLimits: { '4': { methods: [], disabled: true }, '5': { methods: [], disabled: true }, '7': {}, '12': {} },
  units: ['sat'], auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null,
  discoveredAt: '2026-01-01T00:00:00.000Z', reliabilityScore: 70, uptimePct24h: 100, uptimePct7d: 100,
  lastCheckedAt: '2026-10-27T11:59:00.000Z', reviewCount: 0, reviewRatedCount: 0, reviewAvgRating: null,
  operatorReviewCount: 0, latencyMs: 100, mintMethods: [], meltMethods: [],
}

describe('wallet API: mintDisabled / meltDisabled', () => {
  it('both true for a mint that switched minting and melting off; NUT-04/05 stay in nuts', () => {
    const w = toWalletMint(BASE, NOW)
    expect(w.mintDisabled).toBe(true)
    expect(w.meltDisabled).toBe(true)
    expect(w.nuts).toEqual(['4', '5', '7', '12'])
  })

  it('false when listed without disabled: true or not listed; null when the NUTs are unknown', () => {
    expect(toWalletMint({ ...BASE, nutsLimits: { '4': { methods: [], disabled: false }, '7': {} } }, NOW)).toMatchObject({ mintDisabled: false, meltDisabled: false })
    expect(toWalletMint({ ...BASE, nutsLimits: { '4': {}, '5': { disabled: true } } }, NOW)).toMatchObject({ mintDisabled: false, meltDisabled: true })
    expect(toWalletMint({ ...BASE, nutsLimits: null }, NOW)).toMatchObject({ mintDisabled: null, meltDisabled: null })
    expect(nutDisabledOf({ '4': { disabled: 'true' } }, '4')).toBe(false)
  })

  it('on every object of the default list; the nuts= filter is unchanged (a declared, switched-off NUT still matches)', () => {
    const q = parseWalletListQuery({ nuts: '4,5' })
    if (!q.ok) throw new Error('query rejected')
    const env = walletListEnvelope({ data: [BASE], computedAt: NOW }, q.filter) as unknown as { mints: Array<Record<string, unknown>> }
    expect(env.mints).toHaveLength(1)
    expect(env.mints[0]).toHaveProperty('mintDisabled', true)
    expect(env.mints[0]).toHaveProperty('meltDisabled', true)
  })
})
