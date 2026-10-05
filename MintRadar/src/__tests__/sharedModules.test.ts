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
