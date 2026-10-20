import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, nip17, nip19, getPublicKey } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools'

// The two change DMs of the mint change log (nostrService.ts notifyMintChanges): a CONFIRMED public key change and a CONFIRMED
// input fee change. Wording, the combined message, the dedupe claim, the cap and the cases that send nothing. The boundaries
// are mocked exactly like nostrService.test.ts (no database, no relay); signing and the NIP-17 wrap run for real, once per DM.

const publishMock = vi.fn()
vi.mock('nostr-tools/pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/pool')>()
  return { ...actual, SimplePool: vi.fn().mockImplementation(function SimplePoolMock() { return { publish: publishMock, destroy: vi.fn() } }) }
})
vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))

let query: ReturnType<typeof vi.fn>
function defaultQuery(sql: string) {
  if (sql.includes('INSERT INTO notification_dm_quota')) return Promise.resolve({ rows: [{ dm_count: 1, window_start: new Date('2026-10-20T00:00:00Z') }], rowCount: 1 })
  return Promise.resolve({ rows: [], rowCount: 1 })
}

const MINT = 'https://mint.example.com'
const DETAIL = `https://mintradar.org/mint/${encodeURIComponent(MINT)}`
const WHEN = new Date('2026-10-20T14:05:33.000Z')
const WHEN_TEXT = '2026-10-20 14:05 UTC'

async function load() {
  vi.resetModules()
  process.env['NOTIFICATION_SERVICE_NSEC'] = nip19.nsecEncode(generateSecretKey())
  const db = await import('../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  query.mockImplementation(defaultQuery)
  return import('../nostrService.js')
}

beforeEach(() => {
  publishMock.mockReset()
  publishMock.mockImplementation((relays: string[]) => relays.map(() => Promise.resolve('ok')))
})

const pubkeyNotice = { id: 11, type: 'pubkey_changed', observedAt: WHEN } as const
const feeNotice = { id: 12, type: 'input_fee_changed', observedAt: WHEN, fees: [{ unit: 'sat', old: 0, new: 100 }] } as const
const claimCalls = () => query.mock.calls.filter(c => /last_notified_change_id = \$2::bigint/.test(String(c[0]))) as Array<[string, unknown[]]>

async function sentText(svc: Awaited<ReturnType<typeof load>>, notices: Parameters<typeof svc.notifyMintChanges>[1]) {
  const recipient = generateSecretKey()
  query.mockImplementation((sql: string) => /last_notified_change_id = \$2::bigint/.test(sql)
    ? Promise.resolve({ rows: [{ pubkey: getPublicKey(recipient), relays: ['wss://relay.example.com'], prev_id: null }], rowCount: 1 })
    : defaultQuery(sql))
  await svc.notifyMintChanges(MINT, notices)
  const wrap = publishMock.mock.calls[0]![1] as NostrEvent
  return nip17.unwrapEvent(wrap, recipient).content
}

describe('wording', () => {
  it('public key: neutral, factual, hostname + UTC time + the MintRadar page, no verdict and no advice', async () => {
    const svc = await load()
    const text = await sentText(svc, [pubkeyNotice])
    expect(text).toBe(`ℹ️ Mint mint.example.com changed its public key on ${WHEN_TEXT}.\nView details: ${DETAIL}`)
  })

  it('input fee: old → new ppk (unit)', async () => {
    const svc = await load()
    expect(await sentText(svc, [feeNotice])).toBe(`ℹ️ Mint mint.example.com changed its input fee on ${WHEN_TEXT}: 0 → 100 ppk (sat).\nView details: ${DETAIL}`)
  })

  it('several units, a unit that did not exist and an unknown unit', async () => {
    const svc = await load()
    const text = await sentText(svc, [{ ...feeNotice, fees: [{ unit: 'sat', old: 100, new: 250 }, { unit: 'usd', old: null, new: 5 }, { unit: 'scam-unit-xyz', old: 1, new: 2 }] }])
    expect(text).toContain('100 → 250 ppk (sat); none → 5 ppk (usd); 1 → 2 ppk (other).')
    expect(text).not.toContain('scam')
  })

  it('both changes in the same run: ONE message, one sentence each, one link', async () => {
    const svc = await load()
    const text = await sentText(svc, [pubkeyNotice, feeNotice])
    expect(text).toBe(
      `ℹ️ Mint mint.example.com changed its public key on ${WHEN_TEXT}.\n` +
      `Mint mint.example.com changed its input fee on ${WHEN_TEXT}: 0 → 100 ppk (sat).\nView details: ${DETAIL}`)
    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(text.match(/https?:\/\//g)).toHaveLength(1)
  })

  it('no verdict words and no advice, in any variant', async () => {
    const svc = await load()
    const all = [svc.buildChangeDmText(MINT, [pubkeyNotice]), svc.buildChangeDmText(MINT, [feeNotice]), svc.buildChangeDmText(MINT, [pubkeyNotice, feeNotice])].join('\n')
    expect(all).not.toMatch(/suspicious|warning|unsafe|scam|danger|risk|withdraw|trust|safe|fraud|rug|⚠️/i)
  })

  it('the mint-controlled name never reaches the text: only the hostname does', async () => {
    const svc = await load()
    expect(svc.buildChangeDmText('not a url', [pubkeyNotice])).toContain('A watched mint')
    expect(sqlNames()).toHaveLength(0)
    function sqlNames() { return query.mock.calls.filter(c => /\bname\b/.test(String(c[0]))) }
  })
})

describe('claim, dedupe and the cases that send nothing', () => {
  it('claims atomically per subscriber on the newest change id: active subscriptions only, once per change row', async () => {
    const svc = await load()
    await svc.notifyMintChanges(MINT, [pubkeyNotice, feeNotice])
    const [sql, params] = claimCalls()[0]!
    expect(sql).toContain('FOR UPDATE OF ns')
    expect(sql).toContain('ns.notify_on_down OR ns.notify_on_up OR ns.notify_on_mint_melt_issues')
    expect(sql).toContain('ns.last_notified_change_id IS NULL OR ns.last_notified_change_id < $2::bigint')
    expect(params).toEqual([MINT, 12])
  })

  it('RACE / replay: when the claim matches no subscriber (already told, or none active) nothing is published', async () => {
    const svc = await load()
    await svc.notifyMintChanges(MINT, [pubkeyNotice])
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('sends exactly one DM per claimed subscriber, through the daily cap', async () => {
    const svc = await load()
    const a = getPublicKey(generateSecretKey()), b = getPublicKey(generateSecretKey())
    query.mockImplementation((sql: string) => /last_notified_change_id = \$2::bigint/.test(sql)
      ? Promise.resolve({ rows: [{ pubkey: a, relays: [], prev_id: null }, { pubkey: b, relays: [], prev_id: '3' }], rowCount: 2 })
      : defaultQuery(sql))
    await svc.notifyMintChanges(MINT, [feeNotice])
    expect(publishMock).toHaveBeenCalledTimes(2)
    expect(query.mock.calls.filter(c => String(c[0]).includes('INSERT INTO notification_dm_quota'))).toHaveLength(2)
  })

  it('a failed send gives the claim back to its previous id (guarded on the id we set) and the cap slot', async () => {
    const svc = await load()
    publishMock.mockImplementation((relays: string[]) => relays.map(() => Promise.reject(new Error('refused'))))
    query.mockImplementation((sql: string) => /last_notified_change_id = \$2::bigint/.test(sql)
      ? Promise.resolve({ rows: [{ pubkey: getPublicKey(generateSecretKey()), relays: [], prev_id: '7' }], rowCount: 1 })
      : defaultQuery(sql))
    await svc.notifyMintChanges(MINT, [pubkeyNotice])
    const release = query.mock.calls.find(c => /SET last_notified_change_id = \$4::bigint/.test(String(c[0]))) as [string, unknown[]]
    expect(release[1]).toEqual([expect.any(String), MINT, 11, '7'])
  })

  it('nothing to send, or no service key: nothing is queried', async () => {
    const svc = await load()
    await svc.notifyMintChanges(MINT, [])
    expect(query).not.toHaveBeenCalled()
    vi.resetModules()
    delete process.env['NOTIFICATION_SERVICE_NSEC']
    const bare = await import('../nostrService.js')
    await bare.notifyMintChanges(MINT, [pubkeyNotice])
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('never throws when the claim query rejects', async () => {
    const svc = await load()
    query.mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(svc.notifyMintChanges(MINT, [pubkeyNotice])).resolves.toBeUndefined()
    err.mockRestore()
  })
})
