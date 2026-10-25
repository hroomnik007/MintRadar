import { describe, it, expect, vi } from 'vitest'

// Mint change log (mintChanges.ts): detection, confirmation, normalisation and sanitising. The database is replaced by an
// in-memory stand-in with the same contract as the real dependencies (load / commit), so every rule is checked on the real
// code path; the SQL itself (cap, cascade, index, retention) is in mintChanges.pg.test.ts.

vi.mock('../db.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../nostrService.js', () => ({
  notifyMintChanges: vi.fn().mockResolvedValue(undefined),
  isNotificationServiceEnabled: vi.fn().mockReturnValue(true),
}))

import {
  sanitizeText, sanitizeVersion, normalizeInfo, normalizeStoredInfo, normalizeKeysets, normalizeStoredKeysets, feesByUnit,
  stepValue, diffKeysets, decideStorage, observeInfo, observeKeysets, noticesOf, recordKeysetsObservation, recordInfoObservation,
  MAX_CHANGES_PER_MINT_PER_DAY, TEXT_MAX, VERSION_MAX, CHANGE_TYPES,
  pendingOf,
  type ChangeDeps, type MintChangeState, type PendingPatch, type StatePatch, type DetectedChange, type StoredChange, type KeysetSnap, type Pending,
} from '../mintChanges.js'
import { notifyMintChanges } from '../nostrService.js'

const MINT = 'https://mint.example.com'
const PK1 = '02' + 'ab'.repeat(32)
const PK2 = '03' + 'cd'.repeat(32)

/** The in-memory stand-in for the two database dependencies; `commits` records what would have been written. */
function makeDeps(initial: MintChangeState = { info: null, keysets: null }) {
  let state: MintChangeState = { ...initial }
  let clock = 1_000_000
  let id = 0
  const commits: Array<{ patch: StatePatch; changes: DetectedChange[] }> = []
  const deps: ChangeDeps = {
    load: async () => state,
    commit: async (_url, patch, changes) => {
      commits.push({ patch, changes })
      state = { ...state, info: patch.info ?? state.info, keysets: patch.keysets ?? state.keysets }
      return changes.map(c => ({ ...c, id: ++id, observedAt: new Date(clock), merged: false }) as StoredChange)
    },
    pending: new Map<string, Pending>(),
    now: () => clock,
  }
  return { deps, commits, tick: (ms = 300_000) => { clock += ms }, state: () => state }
}

const info = (o: Record<string, unknown> = {}) => ({
  name: 'Alpha', pubkey: PK1, version: 'Nutshell/0.17.0', motd: 'hello', description: 'A mint', contact: [{ method: 'email', info: 'ops@example.com' }],
  nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] }, '5': { methods: [{ method: 'bolt11', unit: 'sat' }] }, '7': { supported: true } },
  ...o,
})

const written = (c: Array<{ changes: DetectedChange[] }>) => c.flatMap(x => x.changes)

describe('sanitising', () => {
  it('replaces every kind of URL by [link], removes control characters and collapses spaces', () => {
    expect(sanitizeText('Go to https://evil.example/x?y=1 now')).toBe('Go to [link] now')
    expect(sanitizeText('see www.evil.example or evil.example/path or nostr:npub1abc')).toBe('see [link] or [link] or [link]')
    expect(sanitizeText(['  a', String.fromCharCode(0), 'b', String.fromCharCode(0x202e), 'c \n\t d', String.fromCharCode(0x200b), ' '].join(''))).toBe('abc d')
    expect(sanitizeText('line1\nline2')).toBe('line1 line2')
    expect(sanitizeText('ftp://x.example and javascript:alert(1)')).toBe('[link] and [link]')
  })

  it(`caps text at ${TEXT_MAX} and the version at ${VERSION_MAX} characters, by code point`, () => {
    expect(Array.from(sanitizeText('x'.repeat(500))!)).toHaveLength(TEXT_MAX)
    expect(Array.from(sanitizeText('😀'.repeat(500))!)).toHaveLength(TEXT_MAX)
    expect(sanitizeVersion('v'.repeat(300))).toHaveLength(VERSION_MAX)
    expect(sanitizeVersion('  Nutshell/0.17.0\n')).toBe('Nutshell/0.17.0')
    expect(sanitizeText(42)).toBeNull()
  })
})

describe('normalizeInfo', () => {
  it('a URL never reaches a stored MOTD, name or description', () => {
    const s = normalizeInfo(info({ motd: 'Join https://t.me/scam now', name: 'Mint https://x.example', description: 'docs at www.x.example/a' }))
    expect(s.motd).toBe('Join [link] now')
    expect(s.name).toBe('Mint [link]')
    expect(s.description).toBe('docs at [link]')
    expect(JSON.stringify(s)).not.toMatch(/https?:|www\./)
  })

  it('contacts: only the method kinds and the count, never a value', () => {
    const s = normalizeInfo(info({ contact: [{ method: 'nostr', info: 'npub1secret' }, { method: 'Email', info: 'a@b.example' }, { method: 'nostr', info: 'npub1other' }] }))
    expect(s.contact).toBe('email, nostr (3)')
    expect(JSON.stringify(s)).not.toMatch(/npub1|@b\.example|secret/)
    expect(normalizeInfo(info({ contact: [] })).contact).toBe('none')
  })

  it('sorts NUT keys and method lists, so the field order in the JSON does not matter', () => {
    const a = normalizeInfo(info({ nuts: { '7': {}, '4': { methods: [{ method: 'bolt12', unit: 'sat' }, { method: 'bolt11', unit: 'sat' }] }, '10': {} } }))
    const b = normalizeInfo(info({ nuts: { '10': {}, '4': { methods: [{ unit: 'sat', method: 'bolt11' }, { unit: 'sat', method: 'bolt12' }] }, '7': {} } }))
    expect(a).toEqual(b)
    expect(a.nuts).toBe('4, 7, 10')
    expect(a.methods).toBe('mint:bolt11/sat, mint:bolt12/sat')
  })

  it('a field missing from a partial answer is absent from the snapshot, never an empty value', () => {
    const s = normalizeInfo({ nuts: { '4': {} } })
    expect(Object.keys(s).sort()).toEqual(['methods', 'nuts'])
    expect(normalizeInfo(null)).toEqual({})
    expect(normalizeInfo({ pubkey: 'not-hex' }).pubkey).toBeUndefined()
  })
})

describe('normalizeStoredInfo (legacy shapes)', () => {
  it('brings arrays, unsorted lists, padded text and an upper-case key to the normalised form', () => {
    const stored = normalizeStoredInfo({ nuts: ['7', '4', '10'], methods: 'mint:bolt12/sat,  mint:bolt11/sat', pubkey: PK1.toUpperCase(), name: '  Alpha   ', version: ' Nutshell/0.17.0 ', bogus: 'x', motd: 12 })
    expect(stored).toEqual({ nuts: '4, 7, 10', methods: 'mint:bolt11/sat, mint:bolt12/sat', pubkey: PK1, name: 'Alpha', version: 'Nutshell/0.17.0' })
  })

  it('a deploy over a legacy snapshot writes no change when the content is the same', async () => {
    const { deps, commits, tick } = makeDeps({ info: { nuts: ['7', '5', '4'], methods: 'mint:bolt11/sat,melt:bolt11/sat', name: ' Alpha ', pubkey: PK1.toUpperCase() }, keysets: null })
    await observeInfo(MINT, info(), deps)
    tick(); await observeInfo(MINT, info(), deps)
    tick(); await observeInfo(MINT, info(), deps)
    expect(written(commits)).toEqual([])
  })

  it('stored keysets in the wallet-API field names are read too', () => {
    expect(normalizeStoredKeysets([{ id: 'b', unit: 'SAT', active: true, inputFeePpk: 100, finalExpiry: 5 }, { id: 'a', unit: 'sat', active: false, fee: '7', expiry: null }, { nope: 1 }]))
      .toEqual([{ id: 'a', unit: 'sat', active: false, fee: 7, expiry: null }, { id: 'b', unit: 'sat', active: true, fee: 100, expiry: 5 }])
    expect(normalizeStoredKeysets(null)).toBeNull()
  })
})

describe('confirmation (stepValue)', () => {
  it('baseline, same, pending, confirmed', () => {
    expect(stepValue(undefined, undefined, 'x', 1)).toEqual({ kind: 'baseline' })
    expect(stepValue('x', undefined, 'x', 1)).toEqual({ kind: 'same' })
    expect(stepValue('x', undefined, 'y', 5)).toEqual({ kind: 'pending', pending: { value: 'y', firstSeenAt: 5 } })
    expect(stepValue('x', { value: 'y', firstSeenAt: 5 }, 'y', 9)).toEqual({ kind: 'confirmed', firstSeenAt: 5 })
    expect(stepValue('x', { value: 'y', firstSeenAt: 5 }, 'z', 9)).toEqual({ kind: 'pending', pending: { value: 'z', firstSeenAt: 9 } })
  })
})

describe('observeInfo', () => {
  it('the first observation of a mint is a baseline: it stores the state and writes NO change', async () => {
    const { deps, commits, state } = makeDeps()
    expect(await observeInfo(MINT, info(), deps)).toEqual([])
    expect(commits).toHaveLength(1)
    expect(commits[0]!.changes).toEqual([])
    expect(state().info).toMatchObject({ name: 'Alpha', pubkey: PK1, nuts: '4, 5, 7', contact: 'email (1)' })
  })

  it('one observation of a difference writes nothing and leaves the stored baseline alone', async () => {
    const { deps, commits, tick, state } = makeDeps()
    await observeInfo(MINT, info(), deps)
    tick()
    expect(await observeInfo(MINT, info({ pubkey: PK2 }), deps)).toEqual([])
    expect(commits).toHaveLength(1) // nothing was committed for the pending difference
    expect((state().info as Record<string, string>)['pubkey']).toBe(PK1)
  })

  it('two consecutive observations confirm it: one change with old, new and when it was first seen', async () => {
    const { deps, tick, state } = makeDeps()
    await observeInfo(MINT, info(), deps)
    tick(300_000); await observeInfo(MINT, info({ pubkey: PK2 }), deps)
    tick(300_000)
    const stored = await observeInfo(MINT, info({ pubkey: PK2 }), deps)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ type: 'pubkey_changed', field: 'pubkey', oldValue: PK1, newValue: PK2, source: 'info', firstSeenAt: 1_300_000 })
    expect((state().info as Record<string, string>)['pubkey']).toBe(PK2)
    tick(); expect(await observeInfo(MINT, info({ pubkey: PK2 }), deps)).toEqual([]) // and it is not reported again
  })

  it('a difference that does not repeat (flip back, or a third value) is never a change', async () => {
    const { deps, commits, tick } = makeDeps()
    await observeInfo(MINT, info(), deps)
    tick(); await observeInfo(MINT, info({ motd: 'A' }), deps)
    tick(); await observeInfo(MINT, info({ motd: 'hello' }), deps) // back to the stored value
    tick(); await observeInfo(MINT, info({ motd: 'A' }), deps) // pending again, not confirmed by the earlier A
    tick(); await observeInfo(MINT, info({ motd: 'B' }), deps)
    expect(written(commits)).toEqual([])
  })

  it('pure reordering of NUT keys, methods and contacts is not a change', async () => {
    const { deps, commits, tick } = makeDeps()
    const a = info({ nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }, { method: 'bolt11', unit: 'usd' }] }, '7': {}, '5': {} }, contact: [{ method: 'email', info: 'x' }, { method: 'nostr', info: 'y' }] })
    const b = info({ nuts: { '5': {}, '7': {}, '4': { methods: [{ method: 'bolt11', unit: 'usd' }, { method: 'bolt11', unit: 'sat' }] } }, contact: [{ method: 'nostr', info: 'q' }, { method: 'email', info: 'z' }] })
    await observeInfo(MINT, a, deps)
    for (let i = 0; i < 3; i++) { tick(); await observeInfo(MINT, b, deps) }
    expect(written(commits)).toEqual([])
  })

  it('a field missing from a partial answer does not compare, does not overwrite and cannot be a change', async () => {
    const { deps, commits, tick, state } = makeDeps()
    await observeInfo(MINT, info(), deps)
    const before = JSON.stringify(state().info)
    for (let i = 0; i < 3; i++) { tick(); await observeInfo(MINT, { nuts: info().nuts }, deps) }
    expect(JSON.stringify(state().info)).toBe(before)
    expect(written(commits)).toEqual([])
  })

  it('a field that was never stored is a baseline when it first appears', async () => {
    const { deps, commits, tick, state } = makeDeps({ info: { name: 'Alpha' }, keysets: null })
    await observeInfo(MINT, info(), deps)
    tick(); await observeInfo(MINT, info(), deps)
    expect(written(commits)).toEqual([])
    expect((state().info as Record<string, string>)['motd']).toBe('hello')
  })

  it.each([
    ['pubkey_changed', { pubkey: PK2 }],
    ['motd_changed', { motd: 'maintenance tonight' }],
    ['name_changed', { name: 'Beta' }],
    ['description_changed', { description: 'Another text' }],
    ['contact_changed', { contact: [{ method: 'email', info: 'a' }, { method: 'twitter', info: 'b' }] }],
    ['version_changed', { version: 'Nutshell/0.18.0' }],
    ['nuts_changed', { nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }] }, '5': { methods: [{ method: 'bolt11', unit: 'sat' }] }, '7': {}, '12': {} } }],
    ['methods_changed', { nuts: { '4': { methods: [{ method: 'bolt11', unit: 'sat' }, { method: 'bolt12', unit: 'sat' }] }, '5': { methods: [{ method: 'bolt11', unit: 'sat' }] }, '7': {} } }],
  ] as const)('%s is detected after two observations and stored with sanitised values', async (type, patch) => {
    const { deps, tick } = makeDeps()
    await observeInfo(MINT, info(), deps)
    tick(); await observeInfo(MINT, info(patch), deps)
    tick(); const stored = await observeInfo(MINT, info(patch), deps)
    expect(stored.map(s => s.type)).toEqual([type])
    expect(CHANGE_TYPES).toContain(stored[0]!.type)
    expect(stored[0]!.oldValue).not.toBe(stored[0]!.newValue)
    expect(JSON.stringify(stored)).not.toMatch(/https?:\/\/|ops@example|\bsecret\b/)
  })

  it('a contact VALUE change alone is not a change (only the kinds and the count are tracked)', async () => {
    const { deps, commits, tick } = makeDeps()
    await observeInfo(MINT, info(), deps)
    for (let i = 0; i < 3; i++) { tick(); await observeInfo(MINT, info({ contact: [{ method: 'email', info: 'someone-else@example.com' }] }), deps) }
    expect(written(commits)).toEqual([])
  })

  it('several fields confirmed in the same run are separate changes', async () => {
    const { deps, tick } = makeDeps()
    await observeInfo(MINT, info(), deps)
    tick(); await observeInfo(MINT, info({ pubkey: PK2, motd: 'x' }), deps)
    tick(); const stored = await observeInfo(MINT, info({ pubkey: PK2, motd: 'x' }), deps)
    expect(stored.map(s => s.type).sort()).toEqual(['motd_changed', 'pubkey_changed'])
  })
})

const KS = (o: Partial<KeysetSnap> & { id: string }): KeysetSnap => ({ unit: 'sat', active: true, fee: 0, expiry: null, ...o })
const asParsed = (list: KeysetSnap[]) => list.map(k => ({ id: k.id, unit: k.unit, active: k.active, inputFeePpk: k.fee, finalExpiry: k.expiry, idVersion: 'v1' as const }))

describe('keysets', () => {
  it('normalizeKeysets sorts by id and compares fees as numbers', () => {
    expect(normalizeKeysets(asParsed([KS({ id: 'b' }), KS({ id: 'a', unit: 'SAT' })])).map(k => k.id)).toEqual(['a', 'b'])
    expect(feesByUnit([KS({ id: 'a', fee: 100 }), KS({ id: 'b', fee: 250 }), KS({ id: 'c', active: false, fee: 9999 }), KS({ id: 'd', unit: 'usd', fee: null })]).get('sat')).toBe(250)
  })

  it('baseline, one observation and a reordered list write nothing', async () => {
    const { deps, commits, tick } = makeDeps()
    const a = [KS({ id: 'a' }), KS({ id: 'b', unit: 'usd' })]
    await observeKeysets(MINT, normalizeKeysets(asParsed(a)), deps)
    tick(); await observeKeysets(MINT, normalizeKeysets(asParsed([...a].reverse())), deps)
    tick(); await observeKeysets(MINT, normalizeKeysets(asParsed([KS({ id: 'a' }), KS({ id: 'b', unit: 'usd' }), KS({ id: 'c' })])), deps) // one observation only
    expect(written(commits)).toEqual([])
  })

  const diffTypes = (o: KeysetSnap[], n: KeysetSnap[]) => diffKeysets(o, n, 1).map(c => c.type)

  it('keyset_added, keyset_removed, keyset_deactivated, keyset_reactivated, keyset_final_expiry_changed, input_fee_changed', () => {
    expect(diffTypes([KS({ id: 'a' })], [KS({ id: 'a' }), KS({ id: 'b' })])).toEqual(['keyset_added'])
    expect(diffTypes([KS({ id: 'a' }), KS({ id: 'b' })], [KS({ id: 'a' })])).toEqual(['keyset_removed'])
    expect(diffTypes([KS({ id: 'a' }), KS({ id: 'b' })], [KS({ id: 'a' }), KS({ id: 'b', active: false })])).toEqual(['keyset_deactivated'])
    expect(diffTypes([KS({ id: 'a' }), KS({ id: 'b', active: false })], [KS({ id: 'a' }), KS({ id: 'b' })])).toEqual(['keyset_reactivated'])
    expect(diffTypes([KS({ id: 'a', expiry: 1_800_000_000 })], [KS({ id: 'a', expiry: 1_900_000_000 })])).toEqual(['keyset_final_expiry_changed'])
    expect(diffTypes([KS({ id: 'a', fee: 0 })], [KS({ id: 'a', fee: 100 })])).toEqual(['input_fee_changed'])
    expect(diffTypes([KS({ id: 'a', fee: 0 })], [KS({ id: 'a', fee: 0 })])).toEqual([])
  })

  it('input_fee_changed: the max fee of the ACTIVE keysets per unit, old and new as that value per unit, and the fee delta for the DM', () => {
    const [c] = diffKeysets(
      [KS({ id: 'a', fee: 100 }), KS({ id: 'b', fee: 10, active: false }), KS({ id: 'u', unit: 'usd', fee: 5 })],
      [KS({ id: 'a', fee: 200 }), KS({ id: 'b', fee: 10, active: false }), KS({ id: 'u', unit: 'usd', fee: 5 })], 7)
    expect(c).toMatchObject({ type: 'input_fee_changed', source: 'keysets', oldValue: 'sat: 100 ppk, usd: 5 ppk', newValue: 'sat: 200 ppk, usd: 5 ppk', firstSeenAt: 7 })
    expect(c!.fees).toEqual([{ unit: 'sat', oldPpk: 100, newPpk: 200 }])
    // a fee going from nothing to something, and a deactivated-only change that does not touch the max
    expect(diffKeysets([KS({ id: 'a', fee: 0 }), KS({ id: 'b', fee: 100 })], [KS({ id: 'a', fee: 0 }), KS({ id: 'b', fee: 100, active: false })], 1).map(x => x.type)).toEqual(['keyset_deactivated', 'input_fee_changed'])
  })

  it('two consecutive keysets checks confirm a change; a failed or partial answer never compares', async () => {
    const { deps, commits, tick } = makeDeps()
    const a = [KS({ id: 'a', fee: 0 })]
    const b = [KS({ id: 'a', fee: 100 })]
    await observeKeysets(MINT, normalizeKeysets(asParsed(a)), deps)
    tick(3_600_000); expect(await observeKeysets(MINT, normalizeKeysets(asParsed(b)), deps)).toEqual([])
    tick(3_600_000); const stored = await observeKeysets(MINT, normalizeKeysets(asParsed(b)), deps)
    expect(stored.map(s => s.type)).toEqual(['input_fee_changed'])
    expect(stored[0]!.firstSeenAt).toBe(1_000_000 + 3_600_000)
    expect(commits.length).toBe(2)
    // an empty list never compares
    expect(await observeKeysets(MINT, [], deps)).toEqual([])
  })

  it('recordKeysetsObservation ignores a partly malformed, truncated or empty answer', async () => {
    const { deps, commits } = makeDeps()
    const keysets = asParsed([KS({ id: 'a' })])
    await recordKeysetsObservation(MINT, { keysets, skipped: 1, ignored: 0 }, deps)
    await recordKeysetsObservation(MINT, { keysets, skipped: 0, ignored: 3 }, deps)
    await recordKeysetsObservation(MINT, { keysets: [], skipped: 0, ignored: 0 }, deps)
    expect(commits).toHaveLength(0)
    await recordKeysetsObservation(MINT, { keysets, skipped: 0, ignored: 0 }, deps)
    expect(commits).toHaveLength(1)
  })

  it('a database failure in the observation is swallowed (it must never touch the probe or keysets result)', async () => {
    const { deps } = makeDeps()
    const failing: ChangeDeps = { ...deps, load: async () => { throw new Error('db down') } }
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(recordInfoObservation(MINT, info(), failing)).resolves.toBeUndefined()
    await expect(recordKeysetsObservation(MINT, { keysets: asParsed([KS({ id: 'a' })]), skipped: 0, ignored: 0 }, failing)).resolves.toBeUndefined()
    err.mockRestore()
  })
})

describe('per-day cap', () => {
  it(`rows are stored until ${MAX_CHANGES_PER_MINT_PER_DAY} exist today; the rest merges into ONE "multiple changes" row per type`, () => {
    expect(decideStorage(0, false)).toBe('insert')
    expect(decideStorage(MAX_CHANGES_PER_MINT_PER_DAY - 1, false)).toBe('insert')
    expect(decideStorage(MAX_CHANGES_PER_MINT_PER_DAY, false)).toBe('insert-merged')
    expect(decideStorage(MAX_CHANGES_PER_MINT_PER_DAY + 5, true)).toBe('merge')
    expect(MAX_CHANGES_PER_MINT_PER_DAY).toBe(20)
  })
})

describe('what may become a DM', () => {
  const stored = (type: StoredChange['type'], extra: Partial<StoredChange> = {}): StoredChange => ({
    type, field: 'x', oldValue: 'a', newValue: 'b', firstSeenAt: 1, source: 'info', id: 5, observedAt: new Date('2026-10-20T12:00:00Z'), merged: false, ...extra,
  })

  it('only a public key change and an input fee change; never a merged summary row', () => {
    const fees = [{ unit: 'sat', oldPpk: 0, newPpk: 100 }]
    const all = CHANGE_TYPES.map(t => stored(t, t === 'input_fee_changed' ? { fees } : {}))
    expect(noticesOf(all).map(n => n.type)).toEqual(['pubkey_changed', 'input_fee_changed'])
    expect(noticesOf([stored('pubkey_changed', { merged: true }), stored('input_fee_changed', { merged: true, fees })])).toEqual([])
    expect(noticesOf([stored('input_fee_changed', { fees })])[0]!.fees).toEqual([{ unit: 'sat', old: 0, new: 100 }])
  })

  it('recordInfoObservation sends a DM for a confirmed public key change, and not for a MOTD change', async () => {
    const notify = vi.mocked(notifyMintChanges)
    const { deps, tick } = makeDeps()
    await recordInfoObservation(MINT, info(), deps)
    tick(); await recordInfoObservation(MINT, info({ motd: 'new' }), deps)
    tick(); await recordInfoObservation(MINT, info({ motd: 'new' }), deps)
    expect(notify).not.toHaveBeenCalled()
    tick(); await recordInfoObservation(MINT, info({ motd: 'new', pubkey: PK2 }), deps)
    tick(); await recordInfoObservation(MINT, info({ motd: 'new', pubkey: PK2 }), deps)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]![1].map(n => n.type)).toEqual(['pubkey_changed'])
  })
})

/**
 * The persisted pending state (mint_change_state.pending_*): a fake row the deps load from and savePending writes to. A
 * "restart" is a fresh in-memory pending map over the same row, exactly what a new process sees.
 */
function persistedDeps() {
  const row: MintChangeState = { info: null, keysets: null, pendingKeysets: null, pendingInfo: null }
  let clock = 1_000_000
  const commits: Array<{ patch: StatePatch; changes: DetectedChange[] }> = []
  const saves: PendingPatch[] = []
  const make = (): ChangeDeps => ({
    load: async () => ({ ...row, pendingInfo: row.pendingInfo ? { ...row.pendingInfo } : null }),
    commit: async (_url, patch, changes) => {
      commits.push({ patch, changes })
      if (patch.info) row.info = patch.info
      if (patch.keysets) row.keysets = patch.keysets
      return changes.map((c, i) => ({ ...c, id: i + 1, observedAt: new Date(clock), merged: false }) as StoredChange)
    },
    savePending: async (_url, patch) => {
      saves.push(patch)
      if (patch.keysets !== undefined) row.pendingKeysets = patch.keysets
      if (patch.info) {
        const next = { ...(row.pendingInfo ?? {}) }
        for (const [f, p] of Object.entries(patch.info)) { if (p) next[f] = p; else delete next[f] }
        row.pendingInfo = Object.keys(next).length > 0 ? next : null
      }
    },
    pending: new Map<string, Pending>(),
    now: () => clock,
  })
  return { row, commits, saves, make, tick: (ms = 3_600_000) => { clock += ms }, now: () => clock }
}

describe('persisted pending state', () => {
  const ks = (list: KeysetSnap[]) => normalizeKeysets(asParsed(list))
  const A = [KS({ id: 'a', fee: 0 })]
  const B = [KS({ id: 'a', fee: 100 })]
  const C = [KS({ id: 'a', fee: 300 })]

  it('a keysets pending value survives a restart and is confirmed with its ORIGINAL firstSeenAt', async () => {
    const db = persistedDeps()
    await observeKeysets(MINT, ks(A), db.make())
    db.tick(); const seenAt = db.now()
    expect(await observeKeysets(MINT, ks(B), db.make())).toEqual([])
    expect(db.row.pendingKeysets).toEqual({ value: JSON.stringify(ks(B)), firstSeenAt: seenAt })
    db.tick() // restart: a new process with an empty in-memory map
    const stored = await observeKeysets(MINT, ks(B), db.make())
    expect(stored.map(c => c.type)).toEqual(['input_fee_changed'])
    expect(stored[0]!.firstSeenAt).toBe(seenAt)
    expect(db.row.pendingKeysets).toBeNull()
  })

  it('an info pending value survives a restart too; the same value as stored writes nothing to the pending state', async () => {
    const db = persistedDeps()
    await observeInfo(MINT, info(), db.make())
    db.tick(); await observeInfo(MINT, info(), db.make())
    expect(db.saves).toEqual([]) // nothing pending, nothing written per probe
    db.tick(); const seenAt = db.now()
    await observeInfo(MINT, info({ motd: 'new' }), db.make())
    expect(db.row.pendingInfo).toEqual({ motd: { value: 'new', firstSeenAt: seenAt } })
    db.tick(); const stored = await observeInfo(MINT, info({ motd: 'new' }), db.make())
    expect(stored).toMatchObject([{ type: 'motd_changed', oldValue: 'hello', newValue: 'new', firstSeenAt: seenAt }])
    expect(db.row.pendingInfo).toBeNull()
  })

  it('pending, then a failed fetch (no observation), then the matching answer: confirmed with the original firstSeenAt', async () => {
    const db = persistedDeps()
    const deps = db.make()
    await recordKeysetsObservation(MINT, { keysets: asParsed(A), skipped: 0, ignored: 0 }, deps)
    db.tick(); const seenAt = db.now()
    await recordKeysetsObservation(MINT, { keysets: asParsed(B), skipped: 0, ignored: 0 }, deps)
    db.tick(); await recordKeysetsObservation(MINT, { keysets: asParsed(B), skipped: 1, ignored: 0 }, deps) // a partial answer = a failed check
    expect(written(db.commits)).toEqual([])
    db.tick(); await recordKeysetsObservation(MINT, { keysets: asParsed(B), skipped: 0, ignored: 0 }, deps)
    expect(written(db.commits)).toMatchObject([{ type: 'input_fee_changed', firstSeenAt: seenAt }])
  })

  it('A, B, C, C: a third value replaces the pending one; it is confirmed with the firstSeenAt of C, B is never a change', async () => {
    const db = persistedDeps()
    await observeKeysets(MINT, ks(A), db.make())
    db.tick(); await observeKeysets(MINT, ks(B), db.make())
    db.tick(); const cSeen = db.now()
    await observeKeysets(MINT, ks(C), db.make())
    expect(db.row.pendingKeysets!.firstSeenAt).toBe(cSeen)
    db.tick(); const stored = await observeKeysets(MINT, ks(C), db.make())
    expect(stored).toMatchObject([{ type: 'input_fee_changed', oldValue: 'sat: 0 ppk', newValue: 'sat: 300 ppk', firstSeenAt: cSeen }])
  })

  it('A, B, B: confirmed with the firstSeenAt of the first B', async () => {
    const db = persistedDeps()
    await observeKeysets(MINT, ks(A), db.make())
    db.tick(); const bSeen = db.now()
    await observeKeysets(MINT, ks(B), db.make())
    db.tick(); expect((await observeKeysets(MINT, ks(B), db.make()))[0]!.firstSeenAt).toBe(bSeen)
  })

  it('pending then the stored value again: cancelled, cleared from the row, no change', async () => {
    const db = persistedDeps()
    await observeKeysets(MINT, ks(A), db.make())
    db.tick(); await observeKeysets(MINT, ks(B), db.make())
    db.tick(); await observeKeysets(MINT, ks(A), db.make())
    expect(db.row.pendingKeysets).toBeNull()
    db.tick(); expect(await observeKeysets(MINT, ks(B), db.make())).toEqual([])
    expect(written(db.commits)).toEqual([])
  })

  it('a failing pending write does not break the observation (the in-memory pending still confirms)', async () => {
    const db = persistedDeps()
    const deps = { ...db.make(), savePending: async () => { throw new Error('db down') } }
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await observeKeysets(MINT, ks(A), deps)
    db.tick(); await observeKeysets(MINT, ks(B), deps)
    db.tick(); expect((await observeKeysets(MINT, ks(B), deps)).map(c => c.type)).toEqual(['input_fee_changed'])
    err.mockRestore()
  })

  it('a v2 (66 hex) keyset added together with a fee change: keyset_added + keyset_deactivated + input_fee_changed (sat 100 -> 200)', async () => {
    const OLD = '00' + 'ab'.repeat(7)
    const NEW = '01' + 'cb'.repeat(32)
    expect(NEW).toMatch(/^[0-9a-f]{66}$/)
    const db = persistedDeps()
    await observeKeysets(MINT, ks([KS({ id: OLD, fee: 100 })]), db.make())
    const next = ks([KS({ id: OLD, fee: 100, active: false }), KS({ id: NEW, fee: 200 })])
    db.tick(); await observeKeysets(MINT, next, db.make())
    // what the read side shows meanwhile
    const pending = pendingOf({ info: null, keysets: db.row.keysets, pendingKeysets: JSON.parse(db.row.pendingKeysets!.value), pendingKeysetsFirstSeenAt: new Date(db.row.pendingKeysets!.firstSeenAt), pendingInfo: null })
    expect(pending!.diff.map(d => d.type)).toEqual(['keyset_added', 'keyset_deactivated', 'input_fee_changed'])
    db.tick(); const stored = await observeKeysets(MINT, next, db.make())
    expect(stored.map(c => c.type)).toEqual(['keyset_added', 'keyset_deactivated', 'input_fee_changed'])
    expect(stored[0]!.newValue).toBe(`${NEW} (sat, active, 200 ppk)`)
    expect(stored[2]).toMatchObject({ oldValue: 'sat: 100 ppk', newValue: 'sat: 200 ppk', fees: [{ unit: 'sat', oldPpk: 100, newPpk: 200 }] })
  })
})

describe('pendingOf (the read side)', () => {
  const stored = [KS({ id: 'a', fee: 0 })]
  it('nothing pending, a stale pending (equal to the stored list) or no stored baseline: undefined', () => {
    expect(pendingOf(undefined)).toBeUndefined()
    expect(pendingOf({ info: {}, keysets: stored, pendingKeysets: null, pendingKeysetsFirstSeenAt: null, pendingInfo: null })).toBeUndefined()
    expect(pendingOf({ info: {}, keysets: stored, pendingKeysets: stored, pendingKeysetsFirstSeenAt: '2026-10-23T10:00:00Z', pendingInfo: null })).toBeUndefined()
    expect(pendingOf({ info: {}, keysets: null, pendingKeysets: [KS({ id: 'b' })], pendingKeysetsFirstSeenAt: '2026-10-23T10:00:00Z', pendingInfo: null })).toBeUndefined()
    // an info field never stored is a baseline, not a pending change
    expect(pendingOf({ info: {}, keysets: null, pendingKeysets: null, pendingKeysetsFirstSeenAt: null, pendingInfo: { motd: { value: 'x', firstSeenAt: 1 } } })).toBeUndefined()
  })
  it('ISO times and only the documented keys (no source, no fees, no ms)', () => {
    const p = pendingOf({ info: {}, keysets: stored, pendingKeysets: [KS({ id: 'a', fee: 100 })], pendingKeysetsFirstSeenAt: '2026-10-23T10:00:00Z', pendingInfo: null })!
    expect(p).toEqual({ firstSeenAt: '2026-10-23T10:00:00.000Z', diff: [{ type: 'input_fee_changed', field: 'input_fee', oldValue: 'sat: 0 ppk', newValue: 'sat: 100 ppk', firstSeenAt: '2026-10-23T10:00:00.000Z' }] })
  })
})
