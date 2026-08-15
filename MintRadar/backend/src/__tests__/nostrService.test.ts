import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateSecretKey, nip19, verifyEvent, getPublicKey } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools'

// nostrService.ts holds the "MintRadar Alerts" service identity and sends
// Nostr DM notifications. We mock the external boundaries only:
//   - db.js pool     → no database
//   - nostr-tools's SimplePool → no real relay connections
// finalizeEvent/verifyEvent/nip19/nip17 run for real, so signature and event
// shape are genuinely verified, not assumed.

const publishMock = vi.fn()

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>()
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
      about: expect.stringContaining('mintradar.pedani.eu') as unknown,
      website: 'https://mintradar.pedani.eu',
      picture: 'https://mintradar.pedani.eu/icons/icon-512x512.png',
    })
  })
})

describe('notifySubscribers', () => {
  const MINT = 'https://mint.example.com'

  it('queries by notify_on_down for a down transition', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rows: [] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    const [sql, params] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('notify_on_down = true')
    expect(params).toEqual([MINT])
  })

  it('queries by notify_on_up for an up transition', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockResolvedValueOnce({ rows: [] })

    await svc.notifySubscribers(MINT, 'up', new Date())

    const [sql] = query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('notify_on_up = true')
  })

  it('sends to a subscriber with no prior cooldown timestamp, then records it', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    query
      .mockResolvedValueOnce({ rows: [{ pubkey, relays: ['wss://relay.example.com'], last_notified_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 })

    await svc.notifySubscribers(MINT, 'down', new Date())

    expect(publishMock).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[1] as [string, unknown[]]
    expect(sql).toContain('last_notified_down_at')
    expect(params).toEqual([pubkey, MINT])
  })

  it('blocks a second notification within the 60-minute cooldown window', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    const recent = new Date(Date.now() - 30 * 60 * 1000)
    query.mockResolvedValueOnce({ rows: [{ pubkey, relays: ['wss://relay.example.com'], last_notified_at: recent }] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    expect(publishMock).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('allows a notification once 60+ minutes have passed since the last one', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    const old = new Date(Date.now() - 61 * 60 * 1000)
    query
      .mockResolvedValueOnce({ rows: [{ pubkey, relays: ['wss://relay.example.com'], last_notified_at: old }] })
      .mockResolvedValueOnce({ rowCount: 1 })

    await svc.notifySubscribers(MINT, 'down', new Date())

    expect(publishMock).toHaveBeenCalledTimes(1)
  })

  it('simulated down→up→down flapping: a second down within 60min stays blocked', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())

    // t0: down, no prior cooldown → sent
    query
      .mockResolvedValueOnce({ rows: [{ pubkey, relays: ['wss://relay.example.com'], last_notified_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 })
    await svc.notifySubscribers(MINT, 'down', new Date())
    expect(publishMock).toHaveBeenCalledTimes(1)

    // t0+10min: up transition uses an independent cooldown column
    query
      .mockResolvedValueOnce({ rows: [{ pubkey, relays: ['wss://relay.example.com'], last_notified_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 })
    await svc.notifySubscribers(MINT, 'up', new Date())
    expect(publishMock).toHaveBeenCalledTimes(2)

    // t0+20min: down again, within 60min of the first down → still blocked
    const recentDown = new Date(Date.now() - 20 * 60 * 1000)
    query.mockResolvedValueOnce({ rows: [{ pubkey, relays: ['wss://relay.example.com'], last_notified_at: recentDown }] })
    await svc.notifySubscribers(MINT, 'down', new Date())
    expect(publishMock).toHaveBeenCalledTimes(2)
  })

  it('unions the subscriber relays with the NOTIFICATION_RELAYS fallback set', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    query
      .mockResolvedValueOnce({ rows: [{ pubkey, relays: ['wss://custom-relay.example.com'], last_notified_at: null }] })
      .mockResolvedValueOnce({ rowCount: 1 })

    await svc.notifySubscribers(MINT, 'down', new Date())

    const [relays] = publishMock.mock.calls[0] as [string[], NostrEvent]
    expect(relays).toContain('wss://custom-relay.example.com')
    expect(relays).toContain('wss://relay.damus.io')
  })

  it('does not update the cooldown timestamp when every relay publish fails', async () => {
    publishMock.mockImplementation((relays: string[]) => relays.map(() => Promise.reject(new Error('fail'))))
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const pubkey = getPublicKey(generateSecretKey())
    query.mockResolvedValueOnce({ rows: [{ pubkey, relays: ['wss://relay.example.com'], last_notified_at: null }] })

    await svc.notifySubscribers(MINT, 'down', new Date())

    expect(query).toHaveBeenCalledTimes(1)
  })

  it('one subscriber failing (malformed relays) does not prevent others from being notified', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    const badPubkey = getPublicKey(generateSecretKey())
    const goodPubkey = getPublicKey(generateSecretKey())
    query
      .mockResolvedValueOnce({
        rows: [
          { pubkey: badPubkey, relays: null, last_notified_at: null },
          { pubkey: goodPubkey, relays: ['wss://relay.example.com'], last_notified_at: null },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 })

    await svc.notifySubscribers(MINT, 'down', new Date())

    expect(publishMock).toHaveBeenCalledTimes(1)
  })

  it('never throws even if the initial DB query rejects', async () => {
    const svc = await loadWithNsec(nip19.nsecEncode(generateSecretKey()))
    query.mockRejectedValueOnce(new Error('db down'))

    await expect(svc.notifySubscribers(MINT, 'down', new Date())).resolves.toBeUndefined()
  })
})
