import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  buildHealthEvent, ATTESTATION_RELAYS, ATTESTATION_PUBKEY_HEX as FROM_BUILDER, ATTESTATION_PROFILE, ATTESTATION_EXPIRY_S,
  ATTESTATION_AUDIT_MAX_AGE_MS, type HealthInput,
} from '../healthAssertions.js'
import {
  ATTESTATION_PUBKEY_HEX, ATTESTATION_NIP05, ATTESTATION_RELAYS_PUBLIC, HEALTH_ASSERTION_TAGS,
} from '../shared/healthAssertionConstants.js'

// The shared constants (also shown on /for-wallets) against the real builder, the profile and the NIP-05 file.
// The frontend copy is compared in src/__tests__/sharedModules.test.ts.

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)
const full: HealthInput = {
  url: 'https://mint.example.com', status: 'online', score: 91, uptime24hPct: 100, uptime7dPct: 99, software: 'Nutshell/0.17.5',
  outdated: false, isTest: false, scoreCappedNew: false, lastCheckedAt: new Date(NOW - 60_000).toISOString(), now: NOW,
  audit: { swaps7d: 120, attributedFailures: 1, fetchedAt: new Date(NOW - 3_600_000).toISOString() },
}
const names = (i: HealthInput): string[] => buildHealthEvent(i)!.tags.map(t => t[0]!)

describe('HEALTH_ASSERTION_TAGS equals what the builder can emit', () => {
  const variants: Record<string, HealthInput> = {
    'full data': full,
    offline: { ...full, status: 'offline', uptime24hPct: 0, uptime7dPct: null, outdated: null, software: null },
    'no audit data': { ...full, audit: null },
    'test mint': { ...full, isTest: true, scoreCappedNew: true },
  }
  const emitted = new Set(Object.values(variants).flatMap(names))

  it('has the same tag names as the union of the events', () => {
    expect([...emitted].sort()).toEqual(HEALTH_ASSERTION_TAGS.map(t => t.name).sort())
  })
  it('lists each tag once, in the builder order of the full event', () => {
    const list = HEALTH_ASSERTION_TAGS.map(t => t.name)
    expect(new Set(list).size).toBe(list.length)
    expect(list).toEqual(names(full))
  })
  it('describes every tag', () => {
    for (const t of HEALTH_ASSERTION_TAGS) {
      for (const k of ['type', 'presence', 'meaning'] as const) expect(t[k].trim().length, `${t.name}.${k}`).toBeGreaterThan(0)
      expect(['NIP-85', 'NIP-40', 'MintRadar']).toContain(t.source)
    }
  })
  it('marks the tags NIP-85 defines (d, k, rank) and expiration (NIP-40); every mint_* tag and methodology* is MintRadar\'s', () => {
    const src = Object.fromEntries(HEALTH_ASSERTION_TAGS.map(t => [t.name, t.source]))
    expect(src['d']).toBe('NIP-85'); expect(src['k']).toBe('NIP-85'); expect(src['rank']).toBe('NIP-85')
    expect(src['expiration']).toBe('NIP-40')
    for (const t of HEALTH_ASSERTION_TAGS) if (/^(mint_|methodology)/.test(t.name)) expect(t.source, t.name).toBe('MintRadar')
  })
  it('the numbers in the descriptions equal the code', () => {
    const by = (n: string) => HEALTH_ASSERTION_TAGS.find(t => t.name === n)!
    expect(by('expiration').meaning).toContain(`${ATTESTATION_EXPIRY_S / 3600} hours`)
    for (const n of ['mint_audit_swaps_7d', 'mint_audit_attributed_7d', 'mint_audit_at']) {
      expect(by(n).presence).toContain(`${ATTESTATION_AUDIT_MAX_AGE_MS / 3_600_000} hours`)
    }
  })
})

describe('identity and relays', () => {
  it('the builder module re-exports the shared key (one definition)', () => {
    expect(FROM_BUILDER).toBe(ATTESTATION_PUBKEY_HEX)
    expect(readFileSync(resolve(__dirname, '../healthAssertions.ts'), 'utf8')).not.toContain(ATTESTATION_PUBKEY_HEX)
  })
  it('the hex equals the NIP-05 file entry "health" and the NIP-05 name equals the profile', () => {
    const file = JSON.parse(readFileSync(resolve(__dirname, '../../../public/.well-known/nostr.json'), 'utf8')) as { names: Record<string, string> }
    expect(file.names['health']).toBe(ATTESTATION_PUBKEY_HEX)
    expect(ATTESTATION_NIP05).toBe(ATTESTATION_PROFILE.nip05)
    expect(ATTESTATION_NIP05).toBe('health@mintradar.org')
  })
  it('the public relays are a subset of the publisher relays, and the public list does not name relay.damus.io', () => {
    for (const r of ATTESTATION_RELAYS_PUBLIC) expect(ATTESTATION_RELAYS as readonly string[]).toContain(r)
    expect(ATTESTATION_RELAYS_PUBLIC as readonly string[]).not.toContain('wss://relay.damus.io')
    expect(ATTESTATION_RELAYS_PUBLIC).toHaveLength(3)
  })
})
