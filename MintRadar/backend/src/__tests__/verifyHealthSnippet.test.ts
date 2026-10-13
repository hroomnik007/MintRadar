import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import * as nostrTools from 'nostr-tools'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  buildHealthEvent, healthIdentifier, ATTESTATION_EXPIRY_S, ATTESTATION_MIN_INTERVAL_MS, ATTESTATION_MIN_RANK_DELTA,
  ATTESTATION_REFRESH_MS, ATTESTATION_AUDIT_MAX_AGE_MS, type HealthInput,
} from '../healthAssertions.js'
import { ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from '../shared/healthAssertionConstants.js'
import { HEALTH_URL_TABLE } from './healthUrlTable.js'
// The code shown on /for-wallets (a frontend constant, plain TypeScript without aliases).
import { VERIFY_HEALTH_SNIPPET } from '../../../src/constants/verifyHealthSnippet'
import { HEALTH_FACTS, HEALTH_FILTER_ALL, HEALTH_FILTER_ONE } from '../../../src/constants/healthAssertionPage'

// The snippet on the page is TESTED, not a copy: it is transpiled, evaluated with `require` limited to nostr-tools and
// run against events signed by the real builder with a throwaway key (the real key is a parameter of the snippet's
// pin, replaced here by the throwaway public key).

interface Snippet {
  PINNED_PUBKEY: string
  RELAYS: string[]
  normalizeMintUrl: (raw: string) => string
  checkHealthEvent: (event: NostrEvent, mintUrl: string, nowSec?: number) => { score: number; status: string; methodology: number; createdAt: number; expiresAt: number } | null
  getMintHealth: (mintUrl: string) => Promise<unknown>
}

function load(source: string, pool?: unknown): Snippet {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: Record<string, unknown> = {}
  const req = (name: string): unknown => {
    if (name === 'nostr-tools') return nostrTools
    if (name === 'nostr-tools/pool') return pool ? { SimplePool: pool } : (nostrTools as Record<string, unknown>)
    throw new Error(`the snippet may not import ${name}`)
  }
  new Function('require', 'exports', js)(req, exports)
  return exports as unknown as Snippet
}

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)
const nowS = Math.floor(NOW / 1000)
const sk = generateSecretKey()
const pk = getPublicKey(sk)
// The same snippet with the throwaway public key as the pin.
const snippet = load(VERIFY_HEALTH_SNIPPET.replace(ATTESTATION_PUBKEY_HEX, pk))
const URL_ = 'https://mint.example.com'

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    url: URL_, status: 'online', score: 91, uptime24hPct: 100, uptime7dPct: 100, software: 'Nutshell/0.17.5', outdated: false,
    isTest: false, scoreCappedNew: false, audit: null, lastCheckedAt: new Date(NOW - 60_000).toISOString(), now: NOW, ...over,
  }
}
const sign = (over: Partial<HealthInput> = {}, key = sk): NostrEvent => finalizeEvent(buildHealthEvent(input(over))!, key)

describe('the snippet on the page', () => {
  it('imports nothing but nostr-tools', () => {
    const specs = [...VERIFY_HEALTH_SNIPPET.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm)].map(m => m[1]!)
    expect(specs.length).toBeGreaterThan(0)
    for (const s of specs) expect(s === 'nostr-tools' || s.startsWith('nostr-tools/'), s).toBe(true)
    expect(VERIFY_HEALTH_SNIPPET).not.toMatch(/\bnsec1|process\.env|localStorage/)
  })

  it('pins the real key and the public relays, once', () => {
    const real = load(VERIFY_HEALTH_SNIPPET)
    expect(real.PINNED_PUBKEY).toBe(ATTESTATION_PUBKEY_HEX)
    expect(real.RELAYS).toEqual([...ATTESTATION_RELAYS_PUBLIC])
    expect(VERIFY_HEALTH_SNIPPET.split(ATTESTATION_PUBKEY_HEX)).toHaveLength(2)
    expect(VERIFY_HEALTH_SNIPPET).not.toContain('damus')
  })

  it.each(HEALTH_URL_TABLE)('normalises %s like the publisher', (raw, expected) => {
    expect(snippet.normalizeMintUrl(raw)).toBe(expected)
    expect(snippet.normalizeMintUrl(raw)).toBe(healthIdentifier(raw))
  })

  it('accepts a valid event and reads the fields', () => {
    const h = snippet.checkHealthEvent(sign(), URL_, nowS)
    expect(h).toMatchObject({ score: 91, status: 'online', methodology: expect.any(Number), createdAt: nowS, expiresAt: nowS + ATTESTATION_EXPIRY_S })
  })
  it('accepts any equivalent spelling of the mint URL', () => {
    for (const u of ['https://MINT.example.com/', 'http://mint.example.com:443', 'https://mint.example.com/#x']) expect(snippet.checkHealthEvent(sign(), u, nowS), u).not.toBeNull()
  })
  it('rejects an event signed by another key', () => {
    expect(snippet.checkHealthEvent(sign({}, generateSecretKey()), URL_, nowS)).toBeNull()
    // and the real pinned key does not accept the throwaway key either
    expect(load(VERIFY_HEALTH_SNIPPET).checkHealthEvent(sign(), URL_, nowS)).toBeNull()
  })
  it('rejects a tampered tag', () => {
    const e = JSON.parse(JSON.stringify(sign())) as NostrEvent
    e.tags = e.tags.map(t => (t[0] === 'rank' ? ['rank', '1'] : t))
    expect(snippet.checkHealthEvent(e, URL_, nowS)).toBeNull()
  })
  it('rejects an expired event and one created in the future', () => {
    expect(snippet.checkHealthEvent(sign(), URL_, nowS + ATTESTATION_EXPIRY_S)).toBeNull()
    expect(snippet.checkHealthEvent(sign(), URL_, nowS + ATTESTATION_EXPIRY_S - 1)).not.toBeNull()
    expect(snippet.checkHealthEvent(sign(), URL_, nowS - 301)).toBeNull()
  })
  it('rejects the event of another mint (different d)', () => {
    expect(snippet.checkHealthEvent(sign({ url: 'https://other.example.com' }), URL_, nowS)).toBeNull()
  })
  it('rejects a wrong kind, a missing expiration and a bad rank', () => {
    const base = buildHealthEvent(input())!
    expect(snippet.checkHealthEvent(finalizeEvent({ ...base, kind: 1 }, sk), URL_, nowS)).toBeNull()
    expect(snippet.checkHealthEvent(finalizeEvent({ ...base, tags: base.tags.filter(t => t[0] !== 'expiration') }, sk), URL_, nowS)).toBeNull()
    expect(snippet.checkHealthEvent(finalizeEvent({ ...base, tags: base.tags.map(t => (t[0] === 'rank' ? ['rank', '101'] : t)) }, sk), URL_, nowS)).toBeNull()
  })

  it('getMintHealth queries the public relays with the documented filter, takes the newest valid event, and returns null when nothing is valid', async () => {
    const calls: Array<{ relays: string[]; filter: unknown }> = []
    let closed = 0
    let returned: NostrEvent[] = []
    class FakePool {
      async querySync(relays: string[], filter: unknown): Promise<NostrEvent[]> { calls.push({ relays, filter }); return returned }
      close(): void { closed++ }
    }
    const s = load(VERIFY_HEALTH_SNIPPET.replace(ATTESTATION_PUBKEY_HEX, pk), FakePool)
    // The snippet reads the real clock, so the events are built "now".
    const mk = (offsetS: number, score: number, key = sk): NostrEvent => {
      const t = buildHealthEvent(input({ now: Date.now() - offsetS * 1000, score }))!
      return finalizeEvent(t, key)
    }
    returned = [mk(7200, 10), mk(60, 77), mk(30, 5, generateSecretKey())]
    const found = (await s.getMintHealth('https://MINT.example.com/')) as { score: number }
    expect(found.score).toBe(77)
    expect(calls[0]!.relays).toEqual([...ATTESTATION_RELAYS_PUBLIC])
    expect(calls[0]!.filter).toEqual({ kinds: [30385], authors: [pk], '#d': [URL_] })
    returned = []
    expect(await s.getMintHealth(URL_)).toBeNull()
    returned = [mk(30, 5, generateSecretKey())]
    expect(await s.getMintHealth(URL_)).toBeNull()
    expect(closed).toBe(3)
  })
})

describe('the numbers and filters on the page equal the publisher', () => {
  it('HEALTH_FACTS', () => {
    expect(HEALTH_FACTS.expiryHours * 3600).toBe(ATTESTATION_EXPIRY_S)
    expect(HEALTH_FACTS.minIntervalHours * 3_600_000).toBe(ATTESTATION_MIN_INTERVAL_MS)
    expect(HEALTH_FACTS.minRankDelta).toBe(ATTESTATION_MIN_RANK_DELTA)
    expect(HEALTH_FACTS.refreshHours * 3_600_000).toBe(ATTESTATION_REFRESH_MS)
    expect(HEALTH_FACTS.auditMaxAgeHours * 3_600_000).toBe(ATTESTATION_AUDIT_MAX_AGE_MS)
  })
  it('the filters shown name the pinned key and the kind', () => {
    for (const f of [HEALTH_FILTER_ALL, HEALTH_FILTER_ONE]) {
      expect(f).toContain('kinds: [30385]')
      expect(f).toContain(`authors: ['${ATTESTATION_PUBKEY_HEX}']`)
    }
    expect(HEALTH_FILTER_ALL).toContain(`limit: ${HEALTH_FACTS.queryLimit}`)
    expect(HEALTH_FILTER_ONE).toContain(`'#d': ['${URL_}']`)
  })
})
