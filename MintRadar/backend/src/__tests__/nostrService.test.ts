import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DM_DAILY_CAP, DM_CAP_SUMMARY_TEXT, ALERT_COOLDOWN_HOURS, CLEAR_PROBES_TO_REARM } from '../notificationLimits.js'
import { generateSecretKey, nip17, nip19, verifyEvent, getPublicKey } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools'

// nostrService.ts holds the "MintRadar Alerts" service identity and sends
// Nostr DM notifications. We mock the external boundaries only:
//   - db.js pool     → no database
//   - nostr-tools's SimplePool → no real relay connections
// finalizeEvent/verifyEvent/nip19/nip17 run for real, so signature and event
// shape are genuinely verified, not assumed.
//
// nostrService.ts deliberately imports SimplePool from the 'nostr-tools/pool'
// subpath rather than the root 'nostr-tools' package (see the comment at the
// top of nostrService.ts) — root and subpath are separate compiled bundles
// with independent state, so the mock must target the same subpath the
// source file actually imports from, or this mock silently stops applying.

const publishMock = vi.fn()

vi.mock('nostr-tools/pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/pool')>()
  return {
    ...actual,
    SimplePool: vi.fn().mockImplementation(function SimplePoolMock() {
      return { publish: publishMock, destroy: vi.fn() }
    }),
  }
})

vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
}))

let query: ReturnType<typeof vi.fn>

// The daily cap (dmQuota.ts) adds queries after every claim. Default replies: a free slot (count 1) for the
// reservation, a lost race for the summary flag, success for everything else (releases, streak writes).
// Tests drive the cap through `quotaCounts` (what successive reservations report) and `summaryFlip`.
const QUOTA_WINDOW = new Date('2026-10-12T00:00:00.000Z')
let quotaCounts: number[] = []
let summaryFlip = false
function defaultQuery(sql: string) {
  if (sql.includes('INSERT INTO notification_dm_quota')) {
    return Promise.resolve({ rows: [{ dm_count: quotaCounts.shift() ?? 1, window_start: QUOTA_WINDOW }], rowCount: 1 })
  }
  if (sql.includes('UPDATE notification_dm_quota SET summary_sent = true')) {
    return Promise.resolve({ rows: [], rowCount: summaryFlip ? 1 : 0 })
  }
  return Promise.resolve({ rows: [], rowCount: 1 })
}
const sqlCalls = (re: RegExp) => query.mock.calls.filter(c => re.test(String(c[0]))) as Array<[string, unknown[]]>
const claimCalls = () => query.mock.calls.filter(c => !/notification_dm_quota|UPDATE mints/.test(String(c[0])) && !/= NULL|= \$4/.test(String(c[0])))

const ORIGINAL_NSEC = process.env['NOTIFICATION_SERVICE_NSEC']

function allSucceed(relays: string[]) {
  return relays.map(() => Promise.resolve('ok'))
}

beforeEach(() => {
  publishMock.mockReset()
  publishMock.mockImplementation(allSucceed)
})

afterEach(() => {
  if (ORIGINAL_NSEC === undefined) delete process.env['NOTIFICATION_SERVICE_NSEC']
  else process.env['NOTIFICATION_SERVICE_NSEC'] = ORIGINAL_NSEC
})

async function loadWithNsec(nsec: string | undefined) {
  vi.resetModules()
  if (nsec === undefined) delete process.env['NOTIFICATION_SERVICE_NSEC']
  else process.env['NOTIFICATION_SERVICE_NSEC'] = nsec
  const db = await import('../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  quotaCounts = []
  summaryFlip = false
  query.mockImplementation(defaultQuery)
  return import('../nostrService.js')
}

describe('service identity loading', () => {
  it('disables notification sending when NOTIFICATION_SERVICE_NSEC is unset', async () => {
    const svc = await loadWithNsec(undefined)
    expect(svc.isNotificationServiceEnabled()).toBe(false)
  })

  it('disables notification sending when NOTIFICATION_SERVICE_NSEC is malformed', async () => {
    const svc = await loadWithNsec('not-a-valid-nsec')
    expect(svc.isNotificationServiceEnabled()).toBe(false)
  })

  it('disables notification sending when NOTIFICATION_SERVICE_NSEC is a valid-shape bech32 but the wrong type (npub)', async () => {
    const sk = generateSecretKey()
    const npub = nip19.npubEncode(getPublicKey(sk))
    const svc = await loadWithNsec(npub)
    expect(svc.isNotificationServiceEnabled()).toBe(false)
  })

  it('loads the service identity from a valid nsec', async () => {
    const sk = generateSecretKey()
    const svc = await loadWithNsec(nip19.nsecEncode(sk))
    expect(svc.isNotificationServiceEnabled()).toBe(true)
  })
})

describe('missing service key — graceful no-op (rest of the app unaffected)', () => {
  it('publishServiceProfile no-ops without publishing', async () => {
    const svc = await loadWithNsec(undefined)
    await svc.publishServiceProfile()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('notifySubscribers no-ops without querying the DB', async () => {
    const svc = await loadWithNsec(undefined)
    await svc.notifySubscribers('https://mint.example.com', 'down', new Date())
    expect(query).not.toHaveBeenCalled()
  })
})

describe('publishServiceProfile', () => {
  it('publishes a well-formed, correctly-signed kind:0 event', async () => {
    const sk = generateSecretKey()
    const expectedPubkey = getPublicKey(sk)
    const svc = await loadWithNsec(nip19.nsecEncode(sk))

    await svc.publishServiceProfile()

    expect(publishMock).toHaveBeenCalledTimes(1)
    const [, event] = publishMock.mock.calls[0] as [string[], NostrEvent]
    expect(event.kind).toBe(0)
    expect(event.pubkey).toBe(expectedPubkey)
    expect(verifyEvent(event)).toBe(true)
    const content: unknown = JSON.parse(event.content)
    expect(content).toEqual({
      name: 'MintRadar Alerts',
      about: expect.stringContaining('mintradar.org') as unknown,
      website: 'https://mintradar.org',
      picture: 'https://mintradar.org/icons/icon-512x512.png',
    })
  })
})

describe('notifySubscribers', () => {
  const MINT = 'https://mint.example.com'
  const CLAIMED_AT = new Date('2026-09-07T12:00:00.000Z')

  function claimedRow(pubkey: string, relays: string[] | null = ['wss://relay.example.com']) {
    return { pubkey, relays, claimed_at: CLAIMED_AT }
  }

  it('claims via a conditional UPDATE keyed on notify_on_down / last_notified_down_at for a down transition', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rows: [] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/UPDATE notification_subscriptions/)
    expect(sql).toContain('notify_on_down = true')
    // ms precision on purpose: the value is read back as a JS Date and used as the release guard
    expect(sql).toContain("last_notified_down_at = date_trunc('milliseconds', now())")
    expect(sql).toMatch(/last_notified_down_at IS NULL OR last_notified_down_at < now\(\) - INTERVAL '60 minutes'/)
    expect(sql).toContain('RETURNING pubkey, relays, last_notified_down_at AS claimed_at')
    expect(params).toEqual([MINT])
  })

  it('uses the notify_on_up / last_notified_up_at columns for an up transition', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rows: [] })

    await svc.notifySubscribers(MINT, 'up', new Date())

    const [sql] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('notify_on_up = true')
    expect(sql).toContain("last_notified_up_at = date_trunc('milliseconds', now())")
  })

  it('sends exactly one DM per claimed subscriber; the only other query is the cap slot, no release', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    query.mockResolvedValueOnce({ rows: [claimedRow(pubkey)] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    expect(publishMock).toHaveBeenCalledTimes(1)
    expect(claimCalls()).toHaveLength(1)
    expect(sqlCalls(/INSERT INTO notification_dm_quota/)).toHaveLength(1)
    expect(sqlCalls(/= NULL|GREATEST/)).toHaveLength(0)
  })

  it('sends nothing when the claim matches no rows (cooldown still active / no subscribers)', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rows: [] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    expect(publishMock).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('RACE: two concurrent notifySubscribers for the same transition send only ONE DM', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    // The DB is the arbiter: the first conditional UPDATE claims the row; the
    // second's WHERE no longer matches (cooldown just set) → zero rows.
    query
      .mockResolvedValueOnce({ rows: [claimedRow(pubkey)] })
      .mockResolvedValueOnce({ rows: [] })

    await Promise.all([
      svc.notifySubscribers(MINT, 'down', new Date()),
      svc.notifySubscribers(MINT, 'down', new Date()),
    ])

    expect(publishMock).toHaveBeenCalledTimes(1)
  })

  it('down and up directions claim independent cooldown columns', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())

    query.mockResolvedValueOnce({ rows: [claimedRow(pubkey)] })
    await svc.notifySubscribers(MINT, 'down', new Date())
    expect(publishMock).toHaveBeenCalledTimes(1)

    // up transition — its own column, so it still claims even seconds later
    query.mockResolvedValueOnce({ rows: [claimedRow(pubkey)] })
    await svc.notifySubscribers(MINT, 'up', new Date())
    expect(publishMock).toHaveBeenCalledTimes(2)

    expect(claimCalls().map(c => String(c[0])).some(q => q.includes('last_notified_up_at'))).toBe(true)
  })

  it('unions the subscriber relays with the NOTIFICATION_RELAYS fallback set', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    query.mockResolvedValueOnce({ rows: [claimedRow(pubkey, ['wss://custom-relay.example.com'])] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    const [relays] = publishMock.mock.calls[0] as [string[], NostrEvent]
    expect(relays).toContain('wss://custom-relay.example.com')
    expect(relays).toContain('wss://relay.damus.io')
  })

  it('RELEASES the claim (cooldown → NULL, guarded on the claimed timestamp) and the cap slot when every relay publish fails', async () => {
    publishMock.mockImplementation((relays: string[]) => relays.map(() => Promise.reject(new Error('fail'))))
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    query.mockResolvedValueOnce({ rows: [claimedRow(pubkey)] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    const [releaseSql, releaseParams] = sqlCalls(/SET last_notified_down_at = NULL/)[0]!
    expect(releaseSql).toContain('last_notified_down_at = $3')
    expect(releaseParams).toEqual([pubkey, MINT, CLAIMED_AT])
    const [slotSql, slotParams] = sqlCalls(/GREATEST\(dm_count - 1, 0\)/)[0]!
    expect(slotSql).toContain('window_start = $2')
    expect(slotParams).toEqual([pubkey, QUOTA_WINDOW, DM_DAILY_CAP])
  })

  it('one subscriber failing (malformed relays) does not stop the rest, and releases only the failed one', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const badPubkey = getPublicKey(generateSecretKey())
    const goodPubkey = getPublicKey(generateSecretKey())
    query.mockResolvedValueOnce({ rows: [claimedRow(badPubkey, null), claimedRow(goodPubkey)] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    expect(publishMock).toHaveBeenCalledTimes(1) // the good subscriber still got theirs
    const releases = sqlCalls(/= NULL/)
    expect(releases).toHaveLength(1)
    expect(releases[0]![1]).toEqual([badPubkey, MINT, CLAIMED_AT])
  })

  it('down message uses the plain hostname (no scheme) plus a URL-encoded MintRadar deep link', async () => {
    const recipientSecretKey = generateSecretKey()
    const pubkey = getPublicKey(recipientSecretKey)
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rows: [claimedRow(pubkey)] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    const [, giftWrap] = publishMock.mock.calls[0] as [string[], NostrEvent]
    const rumor = nip17.unwrapEvent(giftWrap, recipientSecretKey)
    const expectedUrl = `https://mintradar.org/mint/${encodeURIComponent(MINT)}`
    expect(rumor.content).toBe(`⚠️ mint.example.com just went offline.\nView details: ${expectedUrl}`)
  })

  it('up message uses the plain hostname (no scheme) plus a URL-encoded MintRadar deep link', async () => {
    const recipientSecretKey = generateSecretKey()
    const pubkey = getPublicKey(recipientSecretKey)
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rows: [claimedRow(pubkey)] })

    await svc.notifySubscribers(MINT, 'up', new Date())

    const [, giftWrap] = publishMock.mock.calls[0] as [string[], NostrEvent]
    const rumor = nip17.unwrapEvent(giftWrap, recipientSecretKey)
    const expectedUrl = `https://mintradar.org/mint/${encodeURIComponent(MINT)}`
    expect(rumor.content).toBe(`✅ mint.example.com is back online.\nView details: ${expectedUrl}`)
  })

  it('never throws even if the claiming query rejects', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockRejectedValueOnce(new Error('db down'))

    await expect(svc.notifySubscribers(MINT, 'down', new Date())).resolves.toBeUndefined()
  })
})

describe('notifyAlert / recordAlertClear ("More alerts")', () => {
  const MINT = 'https://mint.example.com'
  const CLAIMED_AT = new Date('2026-10-10T12:00:00.000Z')
  const PREV_AT = new Date('2026-10-09T08:00:00.000Z')
  const DETAIL = `https://mintradar.org/mint/${encodeURIComponent(MINT)}`
  const claimedRow = (pubkey: string, prev: Date | null = null) =>
    ({ pubkey, relays: ['wss://relay.example.com'], claimed_at: CLAIMED_AT, prev_at: prev })
  // first query = the streak reset, second = the claim
  const withClaim = (rows: unknown[]) => query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows })

  async function decryptedText(svc: Awaited<ReturnType<typeof loadWithNsec>>, kind: 'mint_melt' | 'version_outdated' | 'nut_loss') {
    const recipient = generateSecretKey()
    withClaim([claimedRow(getPublicKey(recipient))])
    await svc.notifyAlert(MINT, kind)
    const wrap = publishMock.mock.calls[0]![1] as NostrEvent
    return nip17.unwrapEvent(wrap, recipient).content
  }

  it.each([
    ['mint_melt', 'notify_on_mint_melt_issues', 'last_notified_mint_melt_at', 'alert_rearmed_mint_melt_at', 12],
    ['version_outdated', 'notify_on_version_outdated', 'last_notified_version_outdated_at', 'alert_rearmed_version_outdated_at', 24],
    ['nut_loss', 'notify_on_nut_loss', 'last_notified_nut_loss_at', 'alert_rearmed_nut_loss_at', 24],
  ] as const)('%s: atomic claim on its own flag, cooldown %i h from the LAST claim and the re-arm check', async (kind, flag, claim, rearmed, hours) => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    await decryptedText(svc, kind)
    const [sql, params] = claimCalls()[0] as [string, unknown[]]
    expect(ALERT_COOLDOWN_HOURS[kind]).toBe(hours)
    expect(sql).toContain(`ns.${flag} = true`)
    expect(sql).toContain('FOR UPDATE OF ns')
    expect(sql).toContain(`SET ${claim} = date_trunc('milliseconds', now())`)
    expect(sql).toContain(`ns.${claim} IS NULL`)
    expect(sql).toContain(`ns.${claim} < now() - make_interval(hours => $2::int)`)
    expect(sql).toContain(`ns.${claim} < m.${rearmed}`)
    expect(sql).toContain('RETURNING ns.pubkey, ns.relays')
    expect(params).toEqual([MINT, hours])
  })

  it('a cleared condition never writes NULL into a claim column any more (the old reset bypassed every cooldown)', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    await svc.recordAlertClear(MINT, 'version_outdated')
    await decryptedText(svc, 'version_outdated')
    expect(sqlCalls(/SET last_notified_\w+ = NULL/)).toHaveLength(0)
  })

  it('the active condition first resets the mint clear streak (skipped when it is already 0)', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    await decryptedText(svc, 'nut_loss')
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toBe('UPDATE mints SET alert_clear_streak_nut_loss = 0 WHERE url = $1 AND alert_clear_streak_nut_loss <> 0')
    expect(params).toEqual([MINT])
  })

  it('text per type: fixed template + hostname + mintradar.org link, never the mint name', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    expect(await decryptedText(svc, 'mint_melt')).toBe(`⚠️ mint.example.com: mint or melt issues were detected.\nView details: ${DETAIL}`)
    publishMock.mockClear()
    expect(await decryptedText(svc, 'version_outdated')).toBe(`ℹ️ mint.example.com is now running outdated software.\nView details: ${DETAIL}`)
    publishMock.mockClear()
    expect(await decryptedText(svc, 'nut_loss')).toBe(`⚠️ mint.example.com no longer supports NUT-04 or NUT-05 (minting or melting).\nView details: ${DETAIL}`)
    expect(sqlCalls(/\bname\b/)).toHaveLength(0)
  })

  it('RACE: two concurrent calls send only ONE DM (the second claim matches no row)', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    query
      .mockResolvedValueOnce({ rowCount: 0 }) // streak reset, call 1
      .mockResolvedValueOnce({ rowCount: 0 }) // streak reset, call 2
      .mockResolvedValueOnce({ rows: [claimedRow(pubkey)] })
      .mockResolvedValueOnce({ rows: [] })
    await Promise.all([svc.notifyAlert(MINT, 'nut_loss'), svc.notifyAlert(MINT, 'nut_loss')])
    expect(publishMock).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when no subscriber can be claimed', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    withClaim([])
    await svc.notifyAlert(MINT, 'version_outdated')
    expect(publishMock).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('failed send: the claim goes back to its PREVIOUS value (guarded on the claimed time) and the cap slot is given back', async () => {
    publishMock.mockImplementation((relays: string[]) => relays.map(() => Promise.reject(new Error('fail'))))
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    withClaim([claimedRow(pubkey, PREV_AT)])
    await svc.notifyAlert(MINT, 'mint_melt')
    const [releaseSql, releaseParams] = sqlCalls(/SET last_notified_mint_melt_at = \$4/)[0]!
    expect(releaseSql).toContain('last_notified_mint_melt_at = $3')
    expect(releaseParams).toEqual([pubkey, MINT, CLAIMED_AT, PREV_AT])
    expect(sqlCalls(/GREATEST\(dm_count - 1, 0\)/)).toHaveLength(1)
  })

  it('failed send of a first-ever claim restores NULL', async () => {
    publishMock.mockImplementation((relays: string[]) => relays.map(() => Promise.reject(new Error('fail'))))
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    withClaim([claimedRow(pubkey, null)])
    await svc.notifyAlert(MINT, 'nut_loss')
    expect(sqlCalls(/SET last_notified_nut_loss_at = \$4/)[0]![1]).toEqual([pubkey, MINT, CLAIMED_AT, null])
  })

  it('does nothing without the service key', async () => {
    const svc = await loadWithNsec(undefined)
    await svc.notifyAlert(MINT, 'nut_loss')
    expect(query).not.toHaveBeenCalled()
  })

  it('never throws even if a query rejects', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockRejectedValue(new Error('db down'))
    await expect(svc.notifyAlert(MINT, 'nut_loss')).resolves.toBeUndefined()
    await expect(svc.recordAlertClear(MINT, 'nut_loss')).resolves.toBeUndefined()
  })

  it.each(['mint_melt', 'version_outdated', 'nut_loss'] as const)('recordAlertClear(%s): one atomic statement, re-arms at %i consecutive clear probes, no write once full', async (kind) => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    await svc.recordAlertClear(MINT, kind)
    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(CLEAR_PROBES_TO_REARM).toBe(12)
    expect(sql).toContain(`SET alert_clear_streak_${kind} = alert_clear_streak_${kind} + 1`)
    expect(sql).toContain(`alert_rearmed_${kind}_at = CASE WHEN alert_clear_streak_${kind} + 1 >= $2::int THEN now() ELSE alert_rearmed_${kind}_at END`)
    expect(sql).toContain(`WHERE url = $1 AND alert_clear_streak_${kind} < $2::int`)
    expect(params).toEqual([MINT, 12])
  })
})

describe('stored subscriber relays on other ports', () => {
  const MINT = 'https://mint.example.com'
  const row = (relays: string[]) => ({ pubkey: getPublicKey(generateSecretKey()), relays, claimed_at: new Date('2026-10-10T12:00:00.000Z') })

  it('are skipped at send time (not used, not deleted) and only counted in the log line', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    query.mockResolvedValueOnce({ rows: [row(['wss://ok.example.com', 'wss://odd.example.com:8080', 'ws://plain.example.com:80', 'ws://wrong.example.com:443'])] })
    await svc.notifySubscribers(MINT, 'down', new Date())
    const [relays] = publishMock.mock.calls[0] as [string[], NostrEvent]
    expect(relays).toContain('wss://ok.example.com')
    expect(relays).toContain('ws://plain.example.com:80')
    expect(relays).toContain('wss://relay.damus.io') // the 13 fixed relays are unaffected
    expect(relays.some(r => r.includes(':8080') || r.includes(':443'))).toBe(false)
    expect(sqlCalls(/DELETE|UPDATE notification_subscriptions SET relays/)).toHaveLength(0)
    const line = log.mock.calls.map(c => String(c[0])).find(l => l.includes('down-alert'))!
    expect(line).toContain('2 stored relay(s) skipped (port not 80/443)')
    expect(line).not.toContain('odd.example.com')
    log.mockRestore()
  })

  it('a subscriber whose relays are all on other ports still gets the DM through the 13 fixed relays', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows: [row(['wss://odd.example.com:8443'])] })
    await svc.notifyAlert(MINT, 'nut_loss')
    const [relays] = publishMock.mock.calls[0] as [string[], NostrEvent]
    expect(relays).not.toContain('wss://odd.example.com:8443')
    expect(relays.length).toBeGreaterThanOrEqual(13)
  })

  it('no skipped relays -> the log line is unchanged', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    query.mockResolvedValueOnce({ rows: [row(['wss://ok.example.com'])] })
    await svc.notifySubscribers(MINT, 'up', new Date())
    const line = log.mock.calls.map(c => String(c[0])).find(l => l.includes('up-alert'))!
    expect(line).toMatch(/claimed 1, 1 sent, 0 failed \(claim released\)$/)
    log.mockRestore()
  })
})

describe('per-subscriber daily cap', () => {
  const MINT = 'https://mint.example.com'
  const CLAIMED_AT = new Date('2026-10-10T12:00:00.000Z')
  const row = (pubkey: string) => ({ pubkey, relays: ['wss://relay.example.com'], claimed_at: CLAIMED_AT })

  it('the reservation is ONE atomic upsert: rolling 24 h window from the first DM, count bounded at cap+1', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rows: [row(getPublicKey(generateSecretKey()))] })
    await svc.notifySubscribers(MINT, 'down', new Date())
    const [sql, params] = sqlCalls(/INSERT INTO notification_dm_quota/)[0]!
    expect(sql).toContain('ON CONFLICT (pubkey) DO UPDATE')
    expect(sql).toContain('q.window_start <= now() - make_interval(hours => $2::int)')
    expect(sql).toContain('LEAST(q.dm_count + 1, $3::int + 1)')
    expect(params.slice(1)).toEqual([24, DM_DAILY_CAP])
  })

  it(`DM number ${DM_DAILY_CAP} still goes out`, async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    quotaCounts = [DM_DAILY_CAP]
    query.mockResolvedValueOnce({ rows: [row(getPublicKey(generateSecretKey()))] })
    await svc.notifySubscribers(MINT, 'down', new Date())
    expect(publishMock).toHaveBeenCalledTimes(1)
  })

  it(`DM number ${DM_DAILY_CAP + 1}: dropped, exactly one summary DM per window, the claim is NOT released`, async () => {
    const recipient = generateSecretKey()
    const second = generateSecretKey()
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    quotaCounts = [DM_DAILY_CAP + 1, DM_DAILY_CAP + 1]
    // the first over-cap subscriber wins the summary flag, the second loses that race
    query.mockResolvedValueOnce({ rows: [row(getPublicKey(recipient)), row(getPublicKey(second))] })
    summaryFlip = true
    const orig = defaultQuery
    let flips = 0
    query.mockImplementation((sql: string) =>
      sql.includes('UPDATE notification_dm_quota SET summary_sent = true')
        ? Promise.resolve({ rows: [], rowCount: flips++ === 0 ? 1 : 0 })
        : orig(sql))
    await svc.notifySubscribers(MINT, 'down', new Date())
    expect(publishMock).toHaveBeenCalledTimes(1) // only the summary of the first
    const [, wrap] = publishMock.mock.calls[0] as [string[], NostrEvent]
    const text = nip17.unwrapEvent(wrap, recipient).content
    expect(text).toBe(DM_CAP_SUMMARY_TEXT)
    expect(text.match(/:\/\//g)).toHaveLength(1)
    expect(text).toContain('https://mintradar.org/watchlist')
    expect(sqlCalls(/= NULL/)).toHaveLength(0) // dropped, not queued and not retried
  })

  it('no summary when another process already sent it in this window; nothing at all is published', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    quotaCounts = [DM_DAILY_CAP + 1]
    summaryFlip = false
    query.mockResolvedValueOnce({ rows: [row(getPublicKey(generateSecretKey()))] })
    await svc.notifySubscribers(MINT, 'down', new Date())
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('a summary that could not be published frees the flag so a later dropped DM retries it', async () => {
    publishMock.mockImplementation((relays: string[]) => relays.map(() => Promise.reject(new Error('fail'))))
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    quotaCounts = [DM_DAILY_CAP + 1]
    summaryFlip = true
    const pubkey = getPublicKey(generateSecretKey())
    query.mockResolvedValueOnce({ rows: [row(pubkey)] })
    await svc.notifySubscribers(MINT, 'down', new Date())
    const [sql, params] = sqlCalls(/summary_sent = false WHERE pubkey = \$1 AND window_start = \$2/)[0]!
    expect(sql).toContain('UPDATE notification_dm_quota')
    expect(params).toEqual([pubkey, QUOTA_WINDOW])
  })

  it('the cap also applies to the three "More alerts" types', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    quotaCounts = [DM_DAILY_CAP + 1]
    query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows: [row(getPublicKey(generateSecretKey()))] })
    await svc.notifyAlert(MINT, 'version_outdated')
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('a reservation error releases the claim and never throws', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    query.mockResolvedValueOnce({ rows: [row(pubkey)] })
    const orig = defaultQuery
    query.mockImplementation((sql: string) =>
      sql.includes('INSERT INTO notification_dm_quota') ? Promise.reject(new Error('db down')) : orig(sql))
    await expect(svc.notifySubscribers(MINT, 'down', new Date())).resolves.toBeUndefined()
    expect(publishMock).not.toHaveBeenCalled()
    expect(sqlCalls(/SET last_notified_down_at = NULL/)).toHaveLength(1)
    expect(sqlCalls(/GREATEST/)).toHaveLength(0) // nothing was reserved, nothing to give back
  })
})
