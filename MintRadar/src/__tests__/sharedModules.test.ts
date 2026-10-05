// The backend and the frontend each carry their own copy of a few pure modules (separate npm
// packages, no workspace). These tests fail when a pair drifts: the code (comments stripped) must be
// byte-identical, and both copies must give the same answer on a shared list of cases.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { detectDemoNotice as feDetect } from '@/utils/demoNotice'
import { detectDemoNotice as beDetect } from '../../backend/src/shared/demoNotice'
import { nip19 } from 'nostr-tools'
import { operatorPubkeys as feOperators, type OperatorSource } from '@/utils/operatorPubkeys'
import { operatorPubkeys as beOperators } from '../../backend/src/shared/operatorPubkeys'

const codeOf = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n')

export const DEMO_CASES: Array<{ texts: Array<string | null | undefined>; expected: string | null }> = [
  { texts: ['This mint is for demonstration purposes only.'], expected: 'for demonstration purposes' },
  { texts: ['FOR   DEMONSTRATION\nPURPOSES ONLY'], expected: 'for demonstration purposes' },
  { texts: ['Welcome to our Demo Mint!'], expected: 'demo mint' },
  { texts: ['Play money, no real value'], expected: 'play money' },
  { texts: ['Please DO NOT DEPOSIT large amounts'], expected: 'do not deposit' },
  { texts: [null, undefined, '', 'a long text', 'for testing purposes'], expected: 'for testing purposes' },
  { texts: ['No guarantee of availability. Use without guarantee.'], expected: null },
  { texts: ['A reliable mint run by volunteers since 2023.'], expected: null },
  { texts: ['demonstration onlyish'], expected: null },
  { texts: ['mydemo mint'], expected: null },
  { texts: [], expected: null },
  { texts: [null], expected: null },
]

describe('detectDemoNotice: backend and frontend copies agree', () => {
  it('has identical code', () => {
    expect(codeOf('../utils/demoNotice.ts')).toBe(codeOf('../../backend/src/shared/demoNotice.ts'))
  })
  it.each(DEMO_CASES.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
    expect(feDetect(c.texts)).toBe(c.expected)
    expect(beDetect(c.texts)).toBe(c.expected)
  })
})

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
