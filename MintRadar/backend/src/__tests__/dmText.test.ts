import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, nip17, nip19, getPublicKey } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools'

// Every DM text (Goes down, Goes up and the three "More alerts") is a fixed template + the validated
// hostname + a https://mintradar.org/mint/<encoded url> link. A mint controls its name, version, MOTD,
// error texts and the path/query of its URL \u2014 none of that may appear in a DM signed by the service key.

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

type Svc = typeof import('../nostrService.js')
let svc: Svc
let query: ReturnType<typeof vi.fn>

const KINDS = ['down', 'up', 'mint_melt', 'version_outdated', 'nut_loss'] as const

beforeEach(async () => {
  vi.resetModules()
  process.env['NOTIFICATION_SERVICE_NSEC'] = nip19.nsecEncode(generateSecretKey())
  publishMock.mockReset()
  publishMock.mockImplementation((relays: string[]) => relays.map(() => Promise.resolve('ok')))
  const db = await import('../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  svc = await import('../nostrService.js')
})

describe('DM templates (snapshots)', () => {
  const url = 'https://mint.example.com'
  const link = 'https://mintradar.org/mint/https%3A%2F%2Fmint.example.com'
  it.each(KINDS)('%s', (kind) => {
    expect(svc.buildDmText(kind, url)).toMatchSnapshot()
  })
  it('keeps the exact wording of the original down and up messages', () => {
    expect(svc.buildDmText('down', url)).toBe(`⚠️ mint.example.com just went offline.\nView details: ${link}`)
    expect(svc.buildDmText('up', url)).toBe(`✅ mint.example.com is back online.\nView details: ${link}`)
  })
})

// [mint url as stored, fragments that must NOT appear outside the encoded mintradar.org link, expected host in the text]
const HOSTILE_URLS: Array<[string, string[], string]> = [
  ['https://mint.example.com/URGENT-your-sats-are-at-risk-reclaim-at-evil.example', ['URGENT', 'reclaim', 'evil.example', 'sats'], 'mint.example.com'],
  ['https://mint.example.com/nostr:npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsx6r4cw', ['nostr:', 'npub1'], 'mint.example.com'],
  ['https://mint.example.com/@jack', ['@jack', '@'], 'mint.example.com'],
  ['https://mint.example.com/[click](http://x.y)**bold**`code`', ['[click]', 'http://x.y', '**', '`'], 'mint.example.com'],
  ['https://mint.example.com/?next=evil2.example/login', ['evil2.example', 'login', '?next'], 'mint.example.com'],
  ['https://mint.example.com/\u202Etxt.exe\u200B\u200D', ['txt.exe'], 'mint.example.com'],
  [`https://mint.example.com/${'x'.repeat(450)}`, ['xxxxxxxxxx'], 'mint.example.com'],
  ['https://mint.example.com/a\nMintRadar: log in at https://evil.example', ['MintRadar:', 'evil.example', 'log in'], 'A watched mint'],
  ['https://mint.example.com/a b', ['a b'], 'A watched mint'],
  ['https://admin:pw@evil.example/', ['admin', 'pw@', 'evil.example'], 'A watched mint'],
  ['https://mint.example.com@evil.example/', ['evil.example'], 'A watched mint'],
  ['not a url', ['not a url'], 'A watched mint'],
]

// eslint-disable-next-line no-control-regex
const INVISIBLES = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/

describe('hostile mint URLs never reach the DM text', () => {
  for (const kind of KINDS) {
    describe(kind, () => {
      it.each(HOSTILE_URLS)('%s', (url, forbidden, host) => {
        const text = svc.buildDmText(kind, url)
        const link = `https://mintradar.org/mint/${encodeURIComponent(url)}`
        // exactly one "\n" (template), one "://" and it is the one of the mintradar.org link
        expect(text.split('\n')).toHaveLength(2)
        expect(text.match(/:\/\//g)).toHaveLength(1)
        expect(text.endsWith(`View details: ${link}`)).toBe(true)
        const head = text.slice(0, text.length - link.length)
        expect(head).toContain(host)
        for (const f of forbidden) expect(head, `"${f}" leaked into the text`).not.toContain(f)
        expect(text).not.toMatch(INVISIBLES)
        // the link is percent-encoded: no raw "@", "nostr:" or space survives in it
        expect(link.slice('https://mintradar.org/mint/'.length)).not.toMatch(/[\s@:/\u200B\u202E]/)
      })
    })
  }
})

describe('end to end through notifyAlert / notifySubscribers: DB-held mint text is never read', () => {
  const HOSTILE_ROW = {
    name: 'URGENT: send sats to nostr:npub1abc @jack https://evil.example www.evil.example\nMintRadar:',
    version: 'Nutshell/0.15.0 click https://evil.example',
    motd: 'please visit evil.example',
    last_error: 'connect failed: contact evil.example',
  }
  const claimed = (pubkey: string) => ({ rows: [{ pubkey, relays: ['wss://relay.example.com'], claimed_at: new Date('2026-10-12T10:00:00Z') }] })
  // The claim gets its subscriber, the cap reservation a free slot, EVERY other query the hostile mint row:
  // if the code read a mint name/version/motd/error from the DB, it would show up in the text.
  const route = (pubkey: string) => (sql: string) => {
    if (/WITH cand AS|UPDATE notification_subscriptions/.test(sql) && /RETURNING/.test(sql)) return Promise.resolve(claimed(pubkey))
    if (sql.includes('INSERT INTO notification_dm_quota')) return Promise.resolve({ rows: [{ dm_count: 1, window_start: new Date() }] })
    return Promise.resolve({ rows: [HOSTILE_ROW], rowCount: 1 })
  }
  const decrypt = (sk: Uint8Array) => nip17.unwrapEvent(publishMock.mock.calls[0]![1] as NostrEvent, sk).content

  for (const kind of ['mint_melt', 'version_outdated', 'nut_loss'] as const) {
    it(`${kind}: sends exactly buildDmText and issues no query that could read name/version/motd/error`, async () => {
      const sk = generateSecretKey()
      const url = 'https://mint.example.com/pay-evil.example'
      query.mockImplementation(route(getPublicKey(sk)))
      await svc.notifyAlert(url, kind)
      const text = decrypt(sk)
      expect(text).toBe(svc.buildDmText(kind, url))
      for (const bad of ['URGENT', 'npub1abc', '@jack', 'evil.example/', 'www.', 'Nutshell', 'motd', 'connect failed']) {
        expect(text.replace(/View details: \S+$/, '')).not.toContain(bad)
      }
      for (const call of query.mock.calls) expect(String(call[0])).not.toMatch(/\b(name|motd|last_error)\b/i)
    })
  }

  for (const direction of ['down', 'up'] as const) {
    it(`${direction}: sends exactly buildDmText`, async () => {
      const sk = generateSecretKey()
      const url = 'https://mint.example.com/pay-evil.example'
      query.mockImplementation(route(getPublicKey(sk)))
      await svc.notifySubscribers(url, direction, new Date())
      expect(decrypt(sk)).toBe(svc.buildDmText(direction, url))
    })
  }
})
