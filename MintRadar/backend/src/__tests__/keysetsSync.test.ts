import { describe, it, expect, vi } from 'vitest'

vi.mock('pg', () => ({ Pool: class { on = () => this; query = async () => ({ rows: [], rowCount: 0 }) } }))

import {
  parseKeysetsResponse, parseKeysResponse, collectMintKeysets, runKeysetsTick, keysetsSlotOf, keysetsSlotAt, keysetsTickUrls,
  KEYSETS_MAX_PER_MINT, KEYSETS_SLOTS_PER_HOUR, KEYSETS_VANTAGE_SKIP_MS,
  type KeysetsDeps, type StoredKeyset,
} from '../keysetsSync.js'
import { NUT02_VECTORS as V } from './fixtures/nut02Vectors.js'

const MINT = 'https://mint.example.com'

function v2Entry(v: typeof V.v2_1, active = true) {
  return { id: v.id, unit: v.unit, active, input_fee_ppk: v.fee, final_expiry: v.expiry }
}
const keysBody = (id: string, unit: string, keys: Record<string, string>) => ({ keysets: [{ id, unit, keys }] })

/** A fake mint: path -> body (a missing path is a failed fetch). Records every requested URL and every store call. */
function fakeDeps(routes: Record<string, unknown>) {
  const requested: string[] = []
  const stored: Array<{ url: string; rows: StoredKeyset[] }> = []
  const deps: KeysetsDeps = {
    fetchJson: async (url: string) => { requested.push(url); return url in routes ? routes[url] : null },
    store: async (url, rows) => { stored.push({ url, rows }) },
    pendingMismatch: new Set<string>(),
  }
  return { deps, requested, stored }
}

describe('parseKeysetsResponse', () => {
  it('parses ids, unit, active, fee and expiry and classifies the id version', () => {
    const p = parseKeysetsResponse({ keysets: [v2Entry(V.v2_1), { id: V.v1_4.id, unit: 'SAT', active: false }, { id: 'I2yN+iRYfkzT', unit: 'sat', active: false, input_fee_ppk: 0 }] })!
    expect(p.keysets.map(k => k.idVersion)).toEqual(['v2', 'v1', 'legacy'])
    expect(p.keysets[0]).toMatchObject({ unit: 'sat', active: true, inputFeePpk: 100, finalExpiry: 2059210353 })
    expect(p.keysets[1]).toMatchObject({ unit: 'sat', inputFeePpk: null, finalExpiry: null })
  })

  it.each([
    ['null', null], ['an array', []], ['no keysets key', {}], ['keysets not an array', { keysets: {} }],
    ['an empty list', { keysets: [] }], ['only malformed entries', { keysets: [null, 5, { id: 1 }, { id: 'x'.repeat(8), unit: 'sat' }] }],
  ])('schema surprise (%s) is a failure (null)', (_n, body) => {
    expect(parseKeysetsResponse(body)).toBeNull()
  })

  it('drops malformed and duplicate entries, keeps the rest, and normalises odd numbers to null', () => {
    const p = parseKeysetsResponse({ keysets: [
      { id: 'a b', unit: 'sat', active: true },
      { id: V.v1_4.id, unit: 'sat', active: true, input_fee_ppk: -1, final_expiry: 'soon' },
      { id: V.v1_4.id, unit: 'sat', active: false },
      { id: V.v1_64.id, unit: 'sat', active: true, input_fee_ppk: 1.5, final_expiry: 0 },
    ] })!
    expect(p.keysets.map(k => k.id)).toEqual([V.v1_4.id, V.v1_64.id])
    expect(p.skipped).toBe(2)
    expect(p.keysets.every(k => k.inputFeePpk === null && k.finalExpiry === null)).toBe(true)
  })

  it('caps the keysets processed per mint and counts the rest as ignored', () => {
    const many = Array.from({ length: KEYSETS_MAX_PER_MINT + 5 }, (_, i) => ({ id: '00' + i.toString(16).padStart(14, '0'), unit: 'sat', active: false }))
    const p = parseKeysetsResponse({ keysets: many })!
    expect(p.keysets).toHaveLength(KEYSETS_MAX_PER_MINT)
    expect(p.ignored).toBe(5)
  })
})

describe('parseKeysResponse', () => {
  it('returns the keys of the requested id only', () => {
    const body = { keysets: [{ id: 'other', unit: 'sat', keys: { '1': 'x' } }, { id: V.v1_4.id, unit: 'sat', keys: V.v1_4.keys }] }
    expect(parseKeysResponse(body, V.v1_4.id)).toEqual(V.v1_4.keys)
    expect(parseKeysResponse(body, 'missing')).toBeNull()
  })
  it('rejects non-string keys, empty and oversized maps', () => {
    expect(parseKeysResponse(keysBody('a', 'sat', { '1': 5 as unknown as string }), 'a')).toBeNull()
    expect(parseKeysResponse(keysBody('a', 'sat', {}), 'a')).toBeNull()
    const big = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [String(i + 1), 'x']))
    expect(parseKeysResponse(keysBody('a', 'sat', big), 'a')).toBeNull()
    expect(parseKeysResponse('nope', 'a')).toBeNull()
  })
})

describe('collectMintKeysets', () => {
  const listUrl = `${MINT}/v1/keysets`
  const keysUrl = (id: string) => `${MINT}/v1/keys/${id}`

  it('stores verified v2 and v1 keysets: 1 + number of active requests, id_valid true', async () => {
    const { deps, requested, stored } = fakeDeps({
      [listUrl]: { keysets: [v2Entry(V.v2_1), { id: V.v1_4.id, unit: 'sat', active: true }, { id: V.v2_3.id, unit: 'sat', active: false, input_fee_ppk: 0 }] },
      [keysUrl(V.v2_1.id)]: keysBody(V.v2_1.id, 'sat', V.v2_1.keys),
      [keysUrl(V.v1_4.id)]: keysBody(V.v1_4.id, 'sat', V.v1_4.keys),
    })
    const r = await collectMintKeysets(MINT, deps)
    expect(r).toMatchObject({ ok: true, requests: 3, keysets: 3, verified: 2, invalid: 0 })
    expect(requested).toEqual([listUrl, keysUrl(V.v2_1.id), keysUrl(V.v1_4.id)])
    expect(stored[0]!.rows.map(x => x.idValid)).toEqual([true, true, null])
  })

  it('legacy ids are classified and never fetched or verified', async () => {
    const { deps, requested, stored } = fakeDeps({ [listUrl]: { keysets: [{ id: 'I2yN+iRYfkzT', unit: 'sat', active: true }] } })
    const r = await collectMintKeysets(MINT, deps)
    expect(r).toMatchObject({ ok: true, requests: 1, legacy: 1, verified: 0 })
    expect(requested).toEqual([listUrl])
    expect(stored[0]!.rows[0]).toMatchObject({ idVersion: 'legacy', idValid: null })
  })

  it.each([
    ['network failure', undefined],
    ['bad JSON / schema surprise', { keysets: 'nope' }],
    ['empty keysets', { keysets: [] }],
  ])('a failed keysets fetch (%s) writes nothing: stored rows and last_checked_at stay untouched', async (_n, body) => {
    const { deps, stored } = fakeDeps(body === undefined ? {} : { [listUrl]: body })
    const r = await collectMintKeysets(MINT, deps)
    expect(r.ok).toBe(false)
    expect(stored).toHaveLength(0)
  })

  it('a database failure is a failed mint, never a throw', async () => {
    const { deps } = fakeDeps({ [listUrl]: { keysets: [v2Entry(V.v2_1, false)] } })
    deps.store = async () => { throw new Error('db down') }
    await expect(collectMintKeysets(MINT, deps)).resolves.toMatchObject({ ok: false })
  })

  it('a failed /v1/keys fetch keeps the keyset row but leaves id_valid null (the stored verdict is kept by the upsert)', async () => {
    const { deps, stored } = fakeDeps({ [listUrl]: { keysets: [v2Entry(V.v2_1)] } })
    const r = await collectMintKeysets(MINT, deps)
    expect(r).toMatchObject({ ok: true, requests: 2, verified: 0 })
    expect(stored[0]!.rows[0]!.idValid).toBeNull()
  })

  it('a mismatch is stored as false only when the NEXT check agrees; the first one stays null', async () => {
    const tampered = { ...V.v2_1.keys, '1': V.v1_4.keys['2'] }
    const { deps, stored } = fakeDeps({
      [listUrl]: { keysets: [v2Entry(V.v2_1)] },
      [keysUrl(V.v2_1.id)]: keysBody(V.v2_1.id, 'sat', tampered),
    })
    const first = await collectMintKeysets(MINT, deps)
    expect(first.invalid).toBe(0)
    expect(stored[0]!.rows[0]!.idValid).toBeNull()
    const second = await collectMintKeysets(MINT, deps)
    expect(second.invalid).toBe(1)
    expect(stored[1]!.rows[0]!.idValid).toBe(false)
  })

  it('a good check in between clears a pending mismatch', async () => {
    const tampered = { ...V.v2_1.keys, '1': V.v1_4.keys['2'] }
    const routes: Record<string, unknown> = { [listUrl]: { keysets: [v2Entry(V.v2_1)] }, [keysUrl(V.v2_1.id)]: keysBody(V.v2_1.id, 'sat', tampered) }
    const { deps, stored } = fakeDeps(routes)
    await collectMintKeysets(MINT, deps)
    routes[keysUrl(V.v2_1.id)] = keysBody(V.v2_1.id, 'sat', V.v2_1.keys)
    await collectMintKeysets(MINT, deps)
    routes[keysUrl(V.v2_1.id)] = keysBody(V.v2_1.id, 'sat', tampered)
    await collectMintKeysets(MINT, deps)
    expect(stored.map(s => s.rows[0]!.idValid)).toEqual([null, true, null])
  })

  it('a keyset that disappears from the list is never deleted: the job only upserts what is listed', async () => {
    const { deps, stored } = fakeDeps({ [listUrl]: { keysets: [v2Entry(V.v2_3, false)] } })
    await collectMintKeysets(MINT, deps)
    expect(stored[0]!.rows.map(r => r.id)).toEqual([V.v2_3.id])
  })

  it('never requests more than the cap of keysets, even for a mint listing hundreds of active ones', async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({ id: '00' + i.toString(16).padStart(14, '0'), unit: 'sat', active: true }))
    const { deps, requested } = fakeDeps({ [listUrl]: { keysets: entries } })
    const r = await collectMintKeysets(MINT, deps)
    expect(r).toMatchObject({ ok: true, keysets: KEYSETS_MAX_PER_MINT, ignored: 200 - KEYSETS_MAX_PER_MINT })
    expect(requested.length).toBeLessThanOrEqual(1 + KEYSETS_MAX_PER_MINT)
  })
})

describe('slots and the tick', () => {
  const noSleep = async () => undefined
  const at = (iso: string) => () => new Date(iso)

  it('a URL always maps to the same slot, and many URLs spread over all twelve slots', () => {
    expect(keysetsSlotOf(MINT)).toBe(keysetsSlotOf(MINT))
    const counts = new Array<number>(KEYSETS_SLOTS_PER_HOUR).fill(0)
    for (let i = 0; i < 600; i++) counts[keysetsSlotOf(`https://mint${i}.example.com`)]!++
    expect(Math.min(...counts)).toBeGreaterThan(20)
    expect(Math.max(...counts)).toBeLessThan(90)
  })

  it('the minute of the hour picks the slot: minutes 2,7,...,57 are slots 0..11', () => {
    expect(Array.from({ length: 12 }, (_, i) => keysetsSlotAt(2 + 5 * i))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('a tick visits only the mints of its slot (not all at once) and pauses between them', async () => {
    const urls = Array.from({ length: 60 }, (_, i) => `https://m${i}.example.com`)
    const slot3 = urls.filter(u => keysetsSlotOf(u) === 3)
    expect(slot3.length).toBeGreaterThan(0)
    expect(slot3.length).toBeLessThan(urls.length)
    const visited: string[] = []
    const sleeps: number[] = []
    const deps: KeysetsDeps = {
      fetchJson: async (url) => { if (url.endsWith('/v1/keysets')) visited.push(url.replace('/v1/keysets', '')); return null },
      store: async () => undefined,
      pendingMismatch: new Set(),
    }
    const stats = await runKeysetsTick({
      deps, now: at('2026-10-20T12:17:00'), random: () => 0.5, sleep: async ms => { sleeps.push(ms) },
      listOnlineUrls: async () => urls, lastVantageOutageAt: () => null, log: () => undefined,
    })
    expect(visited).toEqual(slot3)
    expect(stats).toMatchObject({ slot: 3, mints: slot3.length, failed: slot3.length, ok: 0 })
    expect(sleeps).toHaveLength(slot3.length) // one start offset + a pause between consecutive mints
  })

  it('skips the tick when the last probe cycle was a suspected vantage outage, and does not touch anything', async () => {
    const list = vi.fn(async () => [MINT])
    const log = vi.fn()
    const now = new Date('2026-10-20T12:17:00')
    const stats = await runKeysetsTick({
      now: () => now, sleep: noSleep, listOnlineUrls: list, log,
      lastVantageOutageAt: () => new Date(now.getTime() - 60_000).toISOString(),
    })
    expect(stats.skipped).toBe('vantage-outage')
    expect(list).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('an old vantage outage does not skip the tick', async () => {
    const list = vi.fn(async () => [] as string[])
    const now = new Date('2026-10-20T12:17:00')
    const stats = await runKeysetsTick({
      now: () => now, sleep: noSleep, listOnlineUrls: list, log: () => undefined,
      lastVantageOutageAt: () => new Date(now.getTime() - KEYSETS_VANTAGE_SKIP_MS - 1000).toISOString(),
    })
    expect(stats.skipped).toBeNull()
    expect(list).toHaveBeenCalled()
  })

  it('logs ONE counts-only line: no URL, no body', async () => {
    const lines: string[] = []
    const url = 'https://secret-host.example.com'
    const slot = keysetsSlotOf(url)
    await runKeysetsTick({
      deps: fakeDeps({ [`${url}/v1/keysets`]: { keysets: [v2Entry(V.v2_1, false)] } }).deps,
      now: at(`2026-10-20T12:${String(2 + 5 * slot).padStart(2, '0')}:00`), random: () => 0, sleep: noSleep,
      listOnlineUrls: async () => [url], lastVantageOutageAt: () => null, log: l => lines.push(l),
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^\[keysets\] slot \d+: mints 1, ok 1, failed 0, requests 1, keysets 1/)
    expect(lines[0]).not.toContain('example.com')
  })

  it('a failing list query is swallowed (nothing fetched, nothing written)', async () => {
    const stats = await runKeysetsTick({
      now: at('2026-10-20T12:17:00'), sleep: noSleep, log: () => undefined, lastVantageOutageAt: () => null,
      listOnlineUrls: async () => { throw new Error('db down') },
    })
    expect(stats.failed).toBe(1)
  })

  describe('mints with a pending keysets change', () => {
    const urls = Array.from({ length: 60 }, (_, i) => `https://p${i}.example.com`)
    const inSlot = (slot: number) => urls.filter(u => keysetsSlotOf(u) === slot)
    const outSlot = (slot: number) => urls.filter(u => keysetsSlotOf(u) !== slot)
    const minute = (slot: number) => `2026-10-20T12:${String(2 + 5 * slot).padStart(2, '0')}:00`
    function visitor(routes: Record<string, unknown> = {}) {
      const visited: string[] = []
      const stored: string[] = []
      const deps: KeysetsDeps = {
        fetchJson: async (url) => { if (url.endsWith('/v1/keysets')) visited.push(url.replace('/v1/keysets', '')); return url in routes ? routes[url] : null },
        store: async (url) => { stored.push(url) },
        pendingMismatch: new Set(),
      }
      return { deps, visited, stored }
    }

    it('an online pending mint outside its slot is re-checked in the NEXT tick, once per pending value', async () => {
      const other = outSlot(3)[0]!
      const fast = new Set<string>()
      const pending = [{ url: other, firstSeenAt: 111 }]
      const run = async (now: string, p = pending) => {
        const v = visitor()
        await runKeysetsTick({ deps: v.deps, now: at(now), random: () => 0, sleep: noSleep, listOnlineUrls: async () => urls, listPendingKeysets: async () => p, fastRechecked: fast, lastVantageOutageAt: () => null, log: () => undefined })
        return v.visited
      }
      expect(await run(minute(3))).toEqual([...inSlot(3), other])
      // the same pending value again (the re-check did not confirm, e.g. it failed): not every tick, it waits for its slot
      expect(await run(minute(4))).toEqual(inSlot(4).filter(u => u !== other).concat(keysetsSlotOf(other) === 4 ? [other] : []))
      // a NEW pending value (another firstSeenAt) gets its own fast re-check
      expect(await run(minute(3), [{ url: other, firstSeenAt: 222 }])).toContain(other)
    })

    it('an OFFLINE mint with a pending value is still fetched in its own slot, never outside it', () => {
      const slot = 5
      const offline = inSlot(slot)[0]!
      const offlineOther = outSlot(slot)[0]!
      const online = urls.filter(u => u !== offline && u !== offlineOther)
      const picked = keysetsTickUrls(online, [{ url: offline, firstSeenAt: 1 }, { url: offlineOther, firstSeenAt: 1 }], slot, new Set())
      expect(picked).toContain(offline)
      expect(picked).not.toContain(offlineOther)
      // without a pending value an offline mint is not visited
      expect(keysetsTickUrls(online, [], slot, new Set())).not.toContain(offline)
    })

    it('the re-check set is bounded: values that are no longer pending are forgotten', () => {
      const fast = new Set<string>()
      const other = outSlot(0)[0]!
      keysetsTickUrls(urls, [{ url: other, firstSeenAt: 1 }], 0, fast)
      expect(fast.size).toBe(1)
      keysetsTickUrls(urls, [], 0, fast)
      expect(fast.size).toBe(0)
    })

    it('a failed fetch of a pending mint writes nothing', async () => {
      const other = outSlot(2)[0]!
      const v = visitor()
      const stats = await runKeysetsTick({ deps: v.deps, now: at(minute(2)), random: () => 0, sleep: noSleep, listOnlineUrls: async () => [other], listPendingKeysets: async () => [{ url: other, firstSeenAt: 1 }], fastRechecked: new Set(), lastVantageOutageAt: () => null, log: () => undefined })
      expect(v.visited).toEqual([other])
      expect(v.stored).toEqual([])
      expect(stats).toMatchObject({ mints: 1, failed: 1, ok: 0 })
    })

    it('a failing pending query does not stop the slot: its online mints are still visited', async () => {
      const v = visitor()
      await runKeysetsTick({ deps: v.deps, now: at(minute(7)), random: () => 0, sleep: noSleep, listOnlineUrls: async () => urls, listPendingKeysets: async () => { throw new Error('db down') }, fastRechecked: new Set(), lastVantageOutageAt: () => null, log: () => undefined })
      expect(v.visited).toEqual(inSlot(7))
    })
  })
})
