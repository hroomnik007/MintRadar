import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { execFile } from 'node:child_process'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocketServer } from 'ws'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import type { Event as NostrEvent } from 'nostr-tools'
import {
  buildHealthEvent, healthIdentifier, ATTESTATION_EXPIRY_S, ATTESTATION_MIN_INTERVAL_MS, ATTESTATION_MIN_RANK_DELTA,
  ATTESTATION_REFRESH_MS, ATTESTATION_AUDIT_MAX_AGE_MS, type HealthInput,
} from '../healthAssertions.js'
import { ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from '../shared/healthAssertionConstants.js'
import { HEALTH_URL_TABLE } from './healthUrlTable.js'
// The code shown on /for-wallets (a frontend constant, plain text without aliases) and the file it is published as.
import { VERIFY_HEALTH_SNIPPET } from '../../../src/constants/verifyHealthSnippet'
import { HEALTH_FACTS, HEALTH_FILTER_ALL, HEALTH_FILTER_ONE } from '../../../src/constants/healthAssertionPage'
// @ts-expect-error plain JavaScript module outside the backend's TypeScript root; tests are not type-checked
import * as example from '../../../docs/examples/verify-health.mjs'

// The example is ONE source: the text on the page, the file docs/examples/verify-health.mjs (equal byte for byte) and
// what runs here. It is checked against events signed by the real builder with a throwaway key and against local stub
// relays that refuse, close, stall, hang, answer with an HTTP error or with CLOSED.

const FILE = resolve(__dirname, '../../../docs/examples/verify-health.mjs')
const NOW = Date.UTC(2026, 9, 14, 12, 0, 0)
const nowS = Math.floor(NOW / 1000)
const sk = generateSecretKey()
const pk = getPublicKey(sk)
const URL_ = 'https://mint.example.com'
const opts = { pubkey: pk, nowSec: nowS }

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    url: URL_, status: 'online', score: 91, uptime24hPct: 100, uptime7dPct: 100, software: 'Nutshell/0.17.5', outdated: false,
    isTest: false, scoreCappedNew: false, audit: null, lastCheckedAt: new Date(NOW - 60_000).toISOString(), now: NOW, ...over,
  }
}
const sign = (over: Partial<HealthInput> = {}, key = sk): NostrEvent => finalizeEvent(buildHealthEvent(input(over))!, key)
const check = (e: unknown, url = URL_, o = opts) => example.checkHealthEvent(e, url, o) as { score: number; status: string; methodology: number; createdAt: number; expiresAt: number } | null

describe('the example: one source, imports, constants', () => {
  it('the file equals the text shown on the page', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(VERIFY_HEALTH_SNIPPET)
  })
  it('imports nothing but nostr-tools and uses no node module, environment variable or storage', () => {
    const specs = [...VERIFY_HEALTH_SNIPPET.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1]!)
    expect(specs).toEqual(['nostr-tools'])
    expect(VERIFY_HEALTH_SNIPPET).not.toMatch(/\bnsec1|process\.env|localStorage|node:/)
    expect(VERIFY_HEALTH_SNIPPET).not.toMatch(/SimplePool|nostr-tools\/(pool|relay)/)
  })
  it('pins the real key once and the three public relays by default', () => {
    expect(example.PINNED_PUBKEY).toBe(ATTESTATION_PUBKEY_HEX)
    expect(example.RELAYS).toEqual([...ATTESTATION_RELAYS_PUBLIC])
    expect(example.KIND).toBe(30385)
    expect(VERIFY_HEALTH_SNIPPET.split(ATTESTATION_PUBKEY_HEX)).toHaveLength(2)
    expect(VERIFY_HEALTH_SNIPPET).not.toContain('damus')
  })
  it('states the runtime requirement in its first line', () => {
    expect(VERIFY_HEALTH_SNIPPET.split('\n')[0]).toContain('Runs in browsers and in Node 22 or newer')
  })
  it.each(HEALTH_URL_TABLE)('normalises %s like the publisher', (raw, expected) => {
    expect(example.normalizeMintUrl(raw)).toBe(expected)
    expect(example.normalizeMintUrl(raw)).toBe(healthIdentifier(raw))
  })
})

describe('checkHealthEvent on events produced by the builder', () => {
  it('accepts a valid event and reads the fields', () => {
    expect(check(sign())).toMatchObject({ score: 91, status: 'online', createdAt: nowS, expiresAt: nowS + ATTESTATION_EXPIRY_S })
    expect(check(sign())!.methodology).toEqual(expect.any(Number))
  })
  it('accepts any equivalent spelling of the mint URL', () => {
    for (const u of ['https://MINT.example.com/', 'http://mint.example.com:443', 'https://mint.example.com/#x']) expect(check(sign(), u), u).not.toBeNull()
  })
  it('rejects another key, with the real pinned key too', () => {
    expect(check(sign({}, generateSecretKey()))).toBeNull()
    expect(example.checkHealthEvent(sign(), URL_, { nowSec: nowS })).toBeNull()
  })
  it('rejects a tampered tag', () => {
    const e = JSON.parse(JSON.stringify(sign())) as NostrEvent
    e.tags = e.tags.map(t => (t[0] === 'rank' ? ['rank', '1'] : t))
    expect(check(e)).toBeNull()
  })
  it('rejects an expired event and one created in the future', () => {
    expect(check(sign(), URL_, { ...opts, nowSec: nowS + ATTESTATION_EXPIRY_S })).toBeNull()
    expect(check(sign(), URL_, { ...opts, nowSec: nowS + ATTESTATION_EXPIRY_S - 1 })).not.toBeNull()
    expect(check(sign(), URL_, { ...opts, nowSec: nowS - 301 })).toBeNull()
  })
  it('rejects the event of another mint (different d)', () => {
    expect(check(sign({ url: 'https://other.example.com' }))).toBeNull()
  })
  it('rejects a wrong kind, a missing expiration, k not web, a bad rank and an empty rank', () => {
    const base = buildHealthEvent(input())!
    const withTags = (f: (t: string[][]) => string[][]) => finalizeEvent({ ...base, tags: f(base.tags) }, sk)
    expect(check(finalizeEvent({ ...base, kind: 1 }, sk))).toBeNull()
    expect(check(withTags(t => t.filter(x => x[0] !== 'expiration')))).toBeNull()
    expect(check(withTags(t => t.map(x => (x[0] === 'k' ? ['k', 'isbn'] : x))))).toBeNull()
    expect(check(withTags(t => t.map(x => (x[0] === 'rank' ? ['rank', '101'] : x))))).toBeNull()
    expect(check(withTags(t => t.map(x => (x[0] === 'rank' ? ['rank', ''] : x))))).toBeNull()
  })
  it('returns null for garbage without throwing', () => {
    for (const bad of [null, undefined, 'x', 5, {}, { tags: 'no' }, { tags: [null] }]) expect(check(bad)).toBeNull()
  })
})

// ── Stub relays ──────────────────────────────────────────────────────────────

const freePort = (): Promise<number> => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)) }) })
const closers: Array<() => void> = []
type Kind = 'refuse' | 'close' | 'stall' | 'hang' | 'http-error' | 'closed' | 'junk' | 'good' | 'empty'

/** One local relay of the given behaviour; `events` is what the good relay serves for any REQ. */
async function stub(kind: Kind, events: NostrEvent[] = []): Promise<string> {
  const port = await freePort()
  const url = `ws://127.0.0.1:${port}`
  if (kind === 'refuse') return url // nothing listens
  if (kind === 'stall') { // TCP accepted, the WebSocket handshake never answered
    const sockets = new Set<net.Socket>()
    const s = net.createServer(c => { sockets.add(c); c.on('error', () => {}) })
    await new Promise<void>(r => s.listen(port, '127.0.0.1', r))
    closers.push(() => { sockets.forEach(c => c.destroy()); s.close() })
    return url
  }
  if (kind === 'http-error') {
    const h = http.createServer((_q, s) => { s.statusCode = 500; s.end('no') })
    h.on('upgrade', (_q, sock) => { sock.end('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n') })
    await new Promise<void>(r => h.listen(port, '127.0.0.1', r))
    closers.push(() => h.close())
    return url
  }
  const wss = new WebSocketServer({ port, host: '127.0.0.1' })
  wss.on('connection', ws => {
    ws.on('error', () => {})
    if (kind === 'close') { ws.close(); return }
    ws.on('message', raw => {
      let msg: unknown
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (!Array.isArray(msg) || msg[0] !== 'REQ') return
      const sub = msg[1]
      if (kind === 'closed') ws.send(JSON.stringify(['CLOSED', sub, 'error: no']))
      else if (kind === 'junk') { ws.send('not json'); ws.send(JSON.stringify(['EVENT', sub, { tags: 5 }])); ws.send(JSON.stringify(['EVENT', 'other', 1])); ws.send(JSON.stringify(['EOSE', sub])) }
      else if (kind === 'good') { for (const e of events) ws.send(JSON.stringify(['EVENT', sub, e])); ws.send(JSON.stringify(['EOSE', sub])) }
      else if (kind === 'empty') ws.send(JSON.stringify(['EOSE', sub]))
      // 'hang': no answer at all
    })
  })
  await new Promise<void>(r => wss.on('listening', r))
  closers.push(() => { wss.clients.forEach(c => c.terminate()); wss.close() })
  return url
}

const handleCounts = (): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const r of process.getActiveResourcesInfo()) out[r] = (out[r] ?? 0) + 1
  return out
}
const uncaught: unknown[] = []
const onUncaught = (e: unknown): void => { uncaught.push(e) }
beforeAll(() => { process.on('uncaughtException', onUncaught); process.on('unhandledRejection', onUncaught) })
afterAll(() => { process.off('uncaughtException', onUncaught); process.off('unhandledRejection', onUncaught); closers.forEach(c => c()) })

const ALL_BAD: Kind[] = ['refuse', 'close', 'stall', 'hang', 'http-error', 'closed', 'junk']

describe('getMintHealth against stub relays', () => {
  it('returns the valid result when one relay is good, whatever the others do (refuse, close, stall, hang, HTTP error, CLOSED, junk), and cleans up', async () => {
    const before = handleCounts()
    const good = await stub('good', [sign({ now: NOW - 3_600_000, score: 10 }), sign(), sign({}, generateSecretKey())])
    const bad = await Promise.all(ALL_BAD.map(k => stub(k)))
    const started = Date.now()
    const res = await example.getMintHealth('https://MINT.example.com/', { relays: [...bad, good], webSocket: WebSocket, ...opts }) as { health: { score: number } | null; answered: string[]; failed: string[] }
    const elapsed = Date.now() - started
    expect(res.health?.score).toBe(91) // the newest valid event; the older one and the foreign key are ignored
    expect(res.answered).toEqual([bad[ALL_BAD.indexOf('junk')], good]) // junk still ends with EOSE: the relay answered, its events were invalid
    expect(res.failed.sort()).toEqual(bad.filter((_, i) => ALL_BAD[i] !== 'junk').sort())
    expect(elapsed).toBeLessThan(8_000) // the 6 second read timeout of the hanging relay is the longest wait
    await new Promise(r => setTimeout(r, 300))
    expect(uncaught).toEqual([])
    const after = handleCounts()
    expect(after['Timeout'] ?? 0).toBeLessThanOrEqual(before['Timeout'] ?? 0)
  }, 20_000)

  it('returns null with answered relays when no relay has an event, and null when the only event is not valid', async () => {
    const empty = await stub('empty')
    const foreign = await stub('good', [sign({}, generateSecretKey()), sign({ url: 'https://other.example.com' })])
    const refuse = await stub('refuse')
    const res = await example.getMintHealth(URL_, { relays: [empty, foreign, refuse], webSocket: WebSocket, ...opts }) as { health: unknown; answered: string[]; failed: string[] }
    expect(res.health).toBeNull()
    expect(res.answered).toEqual([empty, foreign])
    expect(res.failed).toEqual([refuse])
  })

  it('never throws: nothing answers, an invalid relay URL, no WebSocket in the runtime', async () => {
    const refuse = await stub('refuse')
    const none = await example.getMintHealth(URL_, { relays: [refuse, 'not a url', 'http://127.0.0.1:1'], webSocket: WebSocket, ...opts }) as { health: unknown; answered: string[]; failed: string[] }
    expect(none).toEqual({ health: null, answered: [], failed: [refuse, 'not a url', 'http://127.0.0.1:1'] })
    const noWs = await example.getMintHealth(URL_, { relays: [refuse], webSocket: undefined, ...opts }) as { answered: string[]; failed: string[] }
    expect(noWs).toMatchObject({ answered: [], failed: [refuse] })
    expect(uncaught).toEqual([])
  })

  it('sends the documented filter and closes the subscription', async () => {
    const seen: unknown[] = []
    const port = await freePort()
    const wss = new WebSocketServer({ port, host: '127.0.0.1' })
    wss.on('connection', ws => ws.on('message', raw => { const m = JSON.parse(String(raw)); seen.push(m); if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]])) }))
    await new Promise<void>(r => wss.on('listening', r))
    await example.getMintHealth('https://MINT.example.com/', { relays: [`ws://127.0.0.1:${port}`], webSocket: WebSocket, ...opts })
    await new Promise(r => setTimeout(r, 200))
    wss.clients.forEach(c => c.terminate()); wss.close()
    const req = seen.find(m => (m as unknown[])[0] === 'REQ') as unknown[]
    expect(req[2]).toEqual({ kinds: [30385], authors: [pk], '#d': [URL_] })
    expect((seen.find(m => (m as unknown[])[0] === 'CLOSE') as unknown[])[1]).toBe(req[1])
  })
})

describe('the command line (child process)', () => {
  const run = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> => new Promise(res => {
    const t = Date.now()
    execFile(process.execPath, [FILE, ...args], { timeout: 15_000 }, (err, stdout, stderr) => {
      res({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stdout, stderr, ms: Date.now() - t })
    })
  })

  it('exits 0 without RangeError when one relay answered and the others refuse, close, stall, hang or fail', async () => {
    const empty = await stub('empty')
    const bad = await Promise.all((['refuse', 'close', 'stall', 'hang', 'http-error', 'closed'] as Kind[]).map(k => stub(k)))
    const r = await run([URL_, ...bad, empty])
    expect(r.stderr).not.toMatch(/RangeError|Maximum call stack|Error/)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('relays answered: 127.0.0.1:' + new URL(empty).port)
    expect(r.stdout).toContain('relays failed:')
    expect(r.stdout).toContain('no valid assertion found: unknown, not a bad mint')
    expect(r.ms).toBeLessThan(12_000)
  }, 20_000)

  it('exits 1 with a clear message when no relay answered, and 2 without a mint URL', async () => {
    const refuse = await stub('refuse')
    const closed = await stub('close')
    const r = await run([URL_, refuse, closed])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('no relay answered')
    expect(r.stderr).not.toMatch(/RangeError/)
    expect((await run([])).code).toBe(2)
  }, 20_000)
})

describe('the numbers and filters on the page equal the publisher', () => {
  it('HEALTH_FACTS', () => {
    expect(HEALTH_FACTS.expiryHours * 3600).toBe(ATTESTATION_EXPIRY_S)
    expect(HEALTH_FACTS.minIntervalHours * 3_600_000).toBe(ATTESTATION_MIN_INTERVAL_MS)
    expect(HEALTH_FACTS.minRankDelta).toBe(ATTESTATION_MIN_RANK_DELTA)
    expect(HEALTH_FACTS.refreshHours * 3_600_000).toBe(ATTESTATION_REFRESH_MS)
    expect(HEALTH_FACTS.auditMaxAgeHours * 3_600_000).toBe(ATTESTATION_AUDIT_MAX_AGE_MS)
  })
  it('the filters shown name the pinned key and the kind', () => {
    for (const f of [HEALTH_FILTER_ALL, HEALTH_FILTER_ONE]) {
      expect(f).toContain('kinds: [30385]')
      expect(f).toContain(`authors: ['${ATTESTATION_PUBKEY_HEX}']`)
    }
    expect(HEALTH_FILTER_ALL).toContain(`limit: ${HEALTH_FACTS.queryLimit}`)
    expect(HEALTH_FILTER_ONE).toContain(`'#d': ['${URL_}']`)
  })
})
