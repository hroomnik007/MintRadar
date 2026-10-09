import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// seedKnownMints() is a BOOTSTRAP: it inserts the public KNOWN_MINTS once per database (app_state flag
// 'known_mints_seeded') and never again, so a mint the prune removed does not come back at the next process
// start (13 dead, never-online seeded mints were re-inserted after every deploy). pg is replaced by an
// in-memory fake of the two tables involved.

const { state } = vi.hoisted(() => ({ state: { mints: new Set<string>(), appState: new Map<string, string>() } }))

vi.mock('../db.js', () => ({
  pool: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/SELECT 1 FROM app_state WHERE key = \$1/.test(sql)) {
        return { rows: state.appState.has(params[0] as string) ? [{ '?column?': 1 }] : [], rowCount: state.appState.has(params[0] as string) ? 1 : 0 }
      }
      if (/INSERT INTO app_state/.test(sql)) {
        if (!state.appState.has(params[0] as string)) state.appState.set(params[0] as string, params[1] as string)
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`unexpected query: ${sql}`)
    }),
  },
  pruneOldNotificationSubscriptions: vi.fn(),
}))
// cron.ts imports a lot that is irrelevant here
vi.mock('../prober.js', () => ({
  getKnownMints: vi.fn(), probeMintToDb: vi.fn(), pruneOldHistory: vi.fn(), pruneUnvalidatedMints: vi.fn(), pruneAbandonedMints: vi.fn(),
  revalidateMints: vi.fn(), backfillServerLocations: vi.fn(), refreshServerLocations: vi.fn(),
}))
vi.mock('../discovery.js', () => ({ discoverMintsFromNostr: vi.fn(), discoverMintsFromApi: vi.fn(), normalizeUrl: (u: string) => u }))
vi.mock('../auditCz.js', () => ({ syncAuditCz: vi.fn() }))
vi.mock('../auditCzDetail.js', () => ({ syncAuditCzDetails: vi.fn() }))
vi.mock('../mintAddress.js', () => ({ refreshMintAddresses: vi.fn() }))
vi.mock('../reviewsSync.js', () => ({ refreshAllMintReviews: vi.fn(), recomputeReviewCountRollups: vi.fn(), isReviewSyncRunning: vi.fn() }))
vi.mock('../reviewsSchedule.js', () => ({ startReviewsSyncTimer: vi.fn() }))
vi.mock('../reliabilityMoversRollup.js', () => ({ refreshReliabilityMoversRollup: vi.fn() }))
vi.mock('../reviewSurgeRollup.js', () => ({ refreshReviewSurgeBaseline: vi.fn() }))
vi.mock('../nostrService.js', () => ({ publishServiceProfile: vi.fn() }))
vi.mock('../versionCatalog.js', () => ({ fetchLatestUpstreamVersions: vi.fn() }))

import { seedKnownMints, KNOWN_MINTS, KNOWN_MINTS_SEEDED_KEY } from '../cron.js'

const upsert = vi.fn(async (url: string) => { state.mints.add(url) })

beforeEach(() => {
  state.mints.clear()
  state.appState.clear()
  upsert.mockClear()
  upsert.mockImplementation(async (url: string) => { state.mints.add(url) })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  delete process.env['MINT_ALLOWLIST']
})
afterEach(() => { delete process.env['MINT_ALLOWLIST'] })

describe('seedKnownMints', () => {
  it('a fresh database gets every known mint and the flag', async () => {
    await seedKnownMints(upsert)
    expect(state.mints.size).toBe(KNOWN_MINTS.length)
    expect([...state.mints].sort()).toEqual([...KNOWN_MINTS].sort())
    expect(state.appState.has(KNOWN_MINTS_SEEDED_KEY)).toBe(true)
  })

  it('with the flag set it inserts nothing, even after a seeded mint was deleted', async () => {
    await seedKnownMints(upsert)
    state.mints.delete(KNOWN_MINTS[3]!)
    upsert.mockClear()
    await seedKnownMints(upsert)
    expect(upsert).not.toHaveBeenCalled()
    expect(state.mints.has(KNOWN_MINTS[3]!)).toBe(false)
  })

  it('a seeded mint deleted by the prune does not come back at the next start (seed, delete, seed again)', async () => {
    await seedKnownMints(upsert)
    const dead = [KNOWN_MINTS[4]!, KNOWN_MINTS[10]!, KNOWN_MINTS[16]!]
    for (const u of dead) state.mints.delete(u) // what pruneUnvalidatedMints does
    await seedKnownMints(upsert) // process restart
    await seedKnownMints(upsert) // and another one
    for (const u of dead) expect(state.mints.has(u)).toBe(false)
    expect(state.mints.size).toBe(KNOWN_MINTS.length - dead.length)
  })

  it('the first start after this change finds all rows existing and just writes the flag (nothing changes)', async () => {
    for (const u of KNOWN_MINTS) state.mints.add(u) // a production database that was seeded the old way
    const before = new Set(state.mints)
    await seedKnownMints(upsert)
    expect(state.mints).toEqual(before)
    expect(state.appState.has(KNOWN_MINTS_SEEDED_KEY)).toBe(true)
  })

  it('a seed that fails halfway writes no flag, and the next start seeds again', async () => {
    let n = 0
    upsert.mockImplementation(async (url: string) => {
      if (++n === 5) throw new Error('connection lost')
      state.mints.add(url)
    })
    await expect(seedKnownMints(upsert)).rejects.toThrow('connection lost')
    expect(state.appState.has(KNOWN_MINTS_SEEDED_KEY)).toBe(false)
    expect(state.mints.size).toBe(4)

    upsert.mockImplementation(async (url: string) => { state.mints.add(url) })
    await seedKnownMints(upsert)
    expect(state.mints.size).toBe(KNOWN_MINTS.length)
    expect(state.appState.has(KNOWN_MINTS_SEEDED_KEY)).toBe(true)
  })

  it('allowlist mode keeps seeding its fixed list at every start and never touches the flag', async () => {
    process.env['MINT_ALLOWLIST'] = 'https://a.example,https://b.example'
    await seedKnownMints(upsert)
    state.mints.delete('https://a.example')
    await seedKnownMints(upsert)
    expect(state.mints.has('https://a.example')).toBe(true)
    expect(state.appState.size).toBe(0)
  })
})
