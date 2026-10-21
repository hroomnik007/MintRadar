import { describe, it, expect, vi } from 'vitest'

// Methodology 4 and the change log: the stored `info.nuts` baseline was built when "supported": false still listed the NUT.
// The row's `nuts_rules` stamp (NUTS_RULES_VERSION) makes the next observation replace that baseline silently (no change row),
// after which a real change still needs two agreeing observations, and a NUT flipping to supported:false is a change.

vi.mock('../db.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../nostrService.js', () => ({
  notifyMintChanges: vi.fn().mockResolvedValue(undefined),
  isNotificationServiceEnabled: vi.fn().mockReturnValue(true),
}))

import {
  normalizeInfo, observeInfo, NUTS_RULES_VERSION,
  type ChangeDeps, type MintChangeState, type StatePatch, type DetectedChange, type StoredChange, type Pending,
} from '../mintChanges.js'

const MINT = 'https://mint.example.com'

function makeDeps(initial: MintChangeState) {
  let state: MintChangeState = { ...initial }
  let clock = 1_000_000
  const commits: Array<{ patch: StatePatch; changes: DetectedChange[] }> = []
  const deps: ChangeDeps = {
    load: async () => state,
    commit: async (_url, patch, changes) => {
      commits.push({ patch, changes })
      state = { info: patch.info ?? state.info, keysets: state.keysets, nutsRules: patch.nutsRules ?? state.nutsRules }
      return changes.map((c, i) => ({ ...c, id: i + 1, observedAt: new Date(clock), merged: false }) as StoredChange)
    },
    pending: new Map<string, Pending>(),
    now: () => clock,
  }
  return { deps, commits, tick: () => { clock += 300_000 }, state: () => state }
}

const body = (nuts: Record<string, unknown>) => ({ nuts })
const OLD_BASELINE = { nuts: '4, 5, 7, 11', methods: 'none' } // built before methodology 4: 7 and 11 were listed although marked false

describe('normalizeInfo nuts', () => {
  it('leaves out a NUT with supported:false and a null entry, keeps presence-only, {} and supported:true', () => {
    expect(normalizeInfo(body({ '4': {}, '5': { supported: true }, '7': { supported: false }, '8': { methods: [] }, '11': null })).nuts).toBe('4, 5, 8')
  })
})

describe('baseline rebuild under NUTS_RULES_VERSION', () => {
  const observed = body({ '4': {}, '5': {}, '7': { supported: false }, '11': { supported: false } })

  it('an old stamp: the nuts baseline is replaced silently, the stamp is set, and nothing is written as a change', async () => {
    const { deps, commits, state } = makeDeps({ info: OLD_BASELINE, keysets: null, nutsRules: 0 })
    const out = await observeInfo(MINT, observed, deps)
    expect(out).toEqual([])
    expect(commits).toHaveLength(1)
    expect(commits[0]!.changes).toEqual([])
    expect(commits[0]!.patch.nutsRules).toBe(NUTS_RULES_VERSION)
    expect((state().info as Record<string, string>)['nuts']).toBe('4, 5')
    expect(deps.pending.size).toBe(0)
  })

  it('a row that never stored anything gets the stamp with its first baseline', async () => {
    const { deps, commits } = makeDeps({ info: null, keysets: null, nutsRules: 0 })
    await observeInfo(MINT, observed, deps)
    expect(commits[0]!.patch.nutsRules).toBe(NUTS_RULES_VERSION)
    expect(commits[0]!.changes).toEqual([])
  })

  it('an answer without a nuts object does not set the stamp (nothing was rebuilt)', async () => {
    const { deps, commits } = makeDeps({ info: OLD_BASELINE, keysets: null, nutsRules: 0 })
    await observeInfo(MINT, { name: 'Alpha' }, deps)
    expect(commits.every(c => c.patch.nutsRules === undefined)).toBe(true)
  })

  it('after the rebuild the same data is no change; a real NUT change still needs two agreeing observations', async () => {
    const { deps, commits, tick } = makeDeps({ info: OLD_BASELINE, keysets: null, nutsRules: 0 })
    await observeInfo(MINT, observed, deps)
    commits.length = 0
    tick(); await observeInfo(MINT, observed, deps)
    expect(commits).toHaveLength(0)
    const added = body({ '4': {}, '5': {}, '12': {}, '7': { supported: false }, '11': { supported: false } })
    tick(); expect(await observeInfo(MINT, added, deps)).toEqual([]) // first sight: pending
    tick(); const out = await observeInfo(MINT, added, deps) // confirmed
    expect(out.map(c => [c.type, c.oldValue, c.newValue])).toEqual([['nuts_changed', '4, 5', '4, 5, 12']])
  })

  it('a NUT flipping from supported:true to supported:false is a change after confirmation', async () => {
    const { deps, tick } = makeDeps({ info: { nuts: '4, 5, 7', methods: 'none' }, keysets: null, nutsRules: NUTS_RULES_VERSION })
    const flipped = body({ '4': {}, '5': {}, '7': { supported: false } })
    tick(); expect(await observeInfo(MINT, flipped, deps)).toEqual([])
    tick(); const out = await observeInfo(MINT, flipped, deps)
    expect(out.map(c => [c.type, c.oldValue, c.newValue])).toEqual([['nuts_changed', '4, 5, 7', '4, 5']])
  })
})
