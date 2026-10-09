// The backend and the frontend each carry their own copy of a few pure modules (separate npm
// packages, no workspace). These tests fail when a pair drifts: the code (comments stripped) must be
// byte-identical, and both copies must give the same answer on a shared list of cases.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { operatorPubkeys as feOperators, type OperatorSource } from '@/utils/operatorPubkeys'
import { operatorPubkeys as beOperators } from '../../backend/src/shared/operatorPubkeys'
import { cleanMintNameDetailed as feClean } from '@/utils/cleanMintName'
import { cleanMintNameDetailed as beClean } from '../../backend/src/shared/cleanMintName'
import * as feAudit from '@/utils/auditScore'
import * as beAudit from '../../backend/src/shared/auditScore'
import { computeReliabilityScore as feScore } from '@/utils/reliabilityScore'
import * as feVersion from '@/utils/versionRule'
import * as beVersion from '../../backend/src/shared/versionRule'
import { VERSION_CASES, ORDER_CASES } from './versionCases'
import { computeReliabilityScore as beScore } from '../../backend/src/shared/reliabilityScore'

const codeOf = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')

const K1 = 'ab'.repeat(32)
const K2 = 'cd'.repeat(32)
export const OPERATOR_CASES: OperatorSource[] = [
  { contact: [{ method: 'nostr', info: nip19.npubEncode(K1) }] },
  { contact: [{ method: 'nostr', info: nip19.nprofileEncode({ pubkey: K1, relays: ['wss://r.example'] }) }] },
  { contact: [{ method: 'nostr', info: K2.toUpperCase() }] },
  { contact: [{ method: 'nostr', info: `nostr:${nip19.npubEncode(K2)}` }] },
  { contact: [{ method: 'nostr', info: 'npub1invalid' }, { method: 'nostr', info: 'a@b.example' }, { method: 'email', info: K1 }] },
  { announcePubkey: K1 },
  { announcePubkey: 'not-hex' },
  { contact: [{ method: 'nostr', info: K1 }], announcePubkey: K2 },
  { contact: [{ method: 'nostr', info: nip19.npubEncode(K1) }], announcePubkey: K1 },
  { contact: [{ method: 'nostr', info: nip19.nprofileEncode({ pubkey: K2 }) }, { method: 'nostr', info: K1 }], announcePubkey: K2.toUpperCase() },
  { contact: null, announcePubkey: null },
  {},
]

describe('operatorPubkeys: backend and frontend copies agree', () => {
  it('has identical code', () => {
    expect(codeOf('../utils/operatorPubkeys.ts')).toBe(codeOf('../../backend/src/shared/operatorPubkeys.ts'))
  })
  it.each(OPERATOR_CASES.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
    expect([...feOperators(c)].sort()).toEqual([...beOperators(c)].sort())
  })
})

const cpt = (...n: number[]) => String.fromCodePoint(...n)
export const NAME_CASES: Array<[string | null | undefined, string]> = [
  ['Minibits', 'https://mint.example.com'],
  ['Caf\u00e9 \u00c9clair', 'https://mint.example.com'],
  ['\u65e5\u672c\u8a9e\u30df\u30f3\u30c8', 'https://mint.example.com'],
  [`a${cpt(0x200b)}b${cpt(0x202e)}c${cpt(0x2066)}d`, 'https://mint.example.com'],
  [`${cpt(0x1f525).repeat(9)} hot`, 'https://mint.example.com'],
  ['x'.repeat(120), 'https://mint.example.com'],
  [`a${cpt(0xfe0f).repeat(4)}b`, 'https://mint.example.com'],
  ['  two   spaces ', 'https://mint.example.com'],
  [cpt(0x200b, 0x200b), 'https://mint.example.com'],
  [cpt(0x200b), ''],
  ['', 'not a url'],
  [null, 'https://mint.example.com'],
  [undefined, 'https://mint.example.com'],
]

describe('cleanMintName: backend and frontend copies agree', () => {
  it('has identical code', () => {
    expect(codeOf('../utils/cleanMintName.ts')).toBe(codeOf('../../backend/src/shared/cleanMintName.ts'))
  })
  it.each(NAME_CASES.map((c, i) => [i, c] as const))('case %i', (_i, [raw, url]) => {
    expect(feClean(raw, url)).toEqual(beClean(raw, url))
  })
})

// Audit component of the Reliability Score (cashu.info attributed failures, 7-day window, 168 h freshness).
const A_NOW = Date.parse('2026-10-08T12:00:00Z')
const aH = (h: number) => new Date(A_NOW - h * 3_600_000).toISOString()
export const AUDIT_CASES: Array<[number | null, number | null, string | Date | null]> = [
  [0, 12, aH(1)], [0, 9, aH(1)], [1, 30, aH(1)], [1, 200, aH(1)], [1, 8, aH(1)], [3, 10, aH(1)], [10, 100, aH(1)],
  [5, 100, aH(1)], [1, 100, aH(1)], [15, 100, aH(1)], [500, 20, aH(1)], [0, 10, aH(1)],
  [null, null, null], [null, 100, aH(1)], [0, null, aH(1)], [Number.NaN, 100, aH(1)], [-1, 100, aH(1)], [0, Number.POSITIVE_INFINITY, aH(1)],
  [0, 100, aH(167)], [0, 100, aH(168)], [0, 100, aH(169)], [0, 100, aH(-5)], [0, 100, 'garbage'], [0, 100, null],
  [0, 100, new Date(A_NOW - 3_600_000)],
]

describe('auditScore: backend and frontend copies agree', () => {
  it('has identical code', () => {
    expect(codeOf('../utils/auditScore.ts')).toBe(codeOf('../../backend/src/shared/auditScore.ts'))
  })
  it('exports the same constants', () => {
    expect([feAudit.AUDIT_MIN_SAMPLES, feAudit.AUDIT_MAX_AGE_HOURS, feAudit.AUDIT_NEUTRAL, feAudit.AUDIT_TAB_MIN_SAMPLES])
      .toEqual([beAudit.AUDIT_MIN_SAMPLES, beAudit.AUDIT_MAX_AGE_HOURS, beAudit.AUDIT_NEUTRAL, beAudit.AUDIT_TAB_MIN_SAMPLES])
  })
  it.each(AUDIT_CASES.map((c, i) => [i, c] as const))('case %i: component, state and total', (_i, [blamed, total, at]) => {
    expect(feAudit.auditComponent(blamed, total, at, A_NOW)).toBe(beAudit.auditComponent(blamed, total, at, A_NOW))
    expect(feAudit.auditDataState(blamed, total, at, A_NOW)).toBe(beAudit.auditDataState(blamed, total, at, A_NOW))
    const audit = { blamed, total, fetchedAt: at }
    expect(feScore(97, 12, 'Nutshell/0.20', 2, audit, undefined, null, A_NOW)).toBe(beScore(97, 12, 'Nutshell/0.20', 2, audit, undefined, null, A_NOW))
  })
})

describe('versionRule: backend and frontend copies agree', () => {
  it('has identical code', () => {
    expect(codeOf('../utils/versionRule.ts')).toBe(codeOf('../../backend/src/shared/versionRule.ts'))
  })
  it.each(VERSION_CASES.map(c => [c.name, c] as const))('%s', (_n, c) => {
    expect(feVersion.classifyVersion(c.software, c.version, c.latest)).toEqual(beVersion.classifyVersion(c.software, c.version, c.latest))
  })
  it.each(ORDER_CASES)('orders %s above %s the same way', (newer, older) => {
    expect(Math.sign(feVersion.compareMintVersionNumbers(newer, older))).toBe(Math.sign(beVersion.compareMintVersionNumbers(newer, older)))
  })
  it('the score uses the rule: the version component is the rule\'s points in both score copies', () => {
    const L = { nutshell: { major: 0, minor: 21 }, cdk: { major: 0, minor: 18 } }
    for (const v of ['Nutshell/0.21.0', 'Nutshell/0.20.3.1', 'Nutshell/0.19.2', 'cdk-mintd/0.18.0-rc.1', 'cdk-mintd/0.13.4', 'LekMint/1.0', 'garbage', null]) {
      const a = feScore(100, 14, v, 3, { blamed: 0, total: 100, fetchedAt: new Date().toISOString() }, L)
      const b = beScore(100, 14, v, 3, { blamed: 0, total: 100, fetchedAt: new Date().toISOString() }, L)
      expect(a).toBe(b)
    }
  })
})
