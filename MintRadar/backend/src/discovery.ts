import { SimplePool, verifyEvent } from 'nostr-tools'
import type { Filter } from 'nostr-tools'
import WebSocket from 'ws'
import { pool } from './db.js'
import { probeMintToDb } from './prober.js'

// Fast string-based pre-filter. isSafeUrl() in probeMintToDb is the authoritative SSRF
// gate (ipaddr.js + full DNS resolution). This just avoids inserting obvious junk into DB.
function isObviouslyPrivate(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0') return true
  // loopback, private, link-local (169.254/16), CGNAT (100.64/10)
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.)/u.test(hostname)
}

// Normalizes a mint URL: enforces https, lowercases hostname, strips trailing slash.
// Handles cases that would otherwise create duplicate DB rows:
//   uppercase hostname (https://Mint.coinos.io → https://mint.coinos.io)
//   trailing slash    (https://mint.example.com/ → https://mint.example.com)
//   http scheme       (http://mint.example.com  → https://mint.example.com)
export function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw.trim())
    parsed.protocol = 'https:'
    parsed.hostname = parsed.hostname.toLowerCase()
    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    } else {
      parsed.pathname = ''
    }
    return parsed.toString()
  } catch {
    return raw.trim()
  }
}

const DISCOVERY_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://relay.cashumints.space',
  'wss://relay.azzamo.net',
]

const DISCOVERY_TIMEOUT_MS = 15_000

export async function discoverMintsFromNostr(): Promise<number> {
  // Node.js 20 has no native WebSocket — inject ws polyfill for nostr-tools
  if (!globalThis.WebSocket) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).WebSocket = WebSocket
  }
  const nostrPool = new SimplePool()
  const discovered38172: Set<string> = new Set()
  const discovered38000: Set<string> = new Set()

  try {
    const [res38172, res38000] = await Promise.allSettled([
      Promise.race([
        nostrPool.querySync(DISCOVERY_RELAYS, { kinds: [38172], limit: 1000 } as Filter),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), DISCOVERY_TIMEOUT_MS)
        ),
      ]),
      Promise.race([
        nostrPool.querySync(DISCOVERY_RELAYS, { kinds: [38000], limit: 2000 } as Filter),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), DISCOVERY_TIMEOUT_MS)
        ),
      ]),
    ])

    if (res38172.status === 'fulfilled') {
      for (const event of res38172.value.filter(e => verifyEvent(e))) {
        const uTag = event.tags.find((t: string[]) => t[0] === 'u')
        if (!uTag || !uTag[1]) continue
        const raw = uTag[1].trim()
        if (!raw.startsWith('https://')) continue
        try {
          const parsed = new URL(raw)
          const h = parsed.hostname.toLowerCase().replace(/\.$/, '')
          if (isObviouslyPrivate(h)) continue
          discovered38172.add(normalizeUrl(raw))
        } catch { continue }
      }
    } else {
      console.error('[discovery] NIP-87 fetch error:', res38172.reason)
    }

    if (res38000.status === 'fulfilled') {
      for (const event of res38000.value.filter(e => verifyEvent(e))) {
        for (const tag of event.tags as string[][]) {
          if (tag[0] !== 'u' || typeof tag[1] !== 'string' || !tag[1].startsWith('https://')) continue
          const raw = tag[1].trim()
          try {
            const parsed = new URL(raw)
            const h = parsed.hostname.toLowerCase().replace(/\.$/, '')
            if (isObviouslyPrivate(h)) continue
            discovered38000.add(normalizeUrl(raw))
          } catch { continue }
        }
      }
    } else {
      console.error('[discovery] kind:38000 fetch error:', res38000.reason)
    }
  } finally {
    nostrPool.destroy()
  }

  let added38172 = 0
  for (const url of discovered38172) {
    const r = await pool.query(
      'INSERT INTO mints (url, is_known) VALUES ($1, true) ON CONFLICT (url) DO NOTHING',
      [url]
    )
    if ((r.rowCount ?? 0) > 0) added38172++
  }
  console.log(`[discovery] kind:38172 found ${discovered38172.size} mints, added ${added38172} new`)

  let added38000 = 0
  for (const url of discovered38000) {
    const r = await pool.query(
      'INSERT INTO mints (url, is_known) VALUES ($1, true) ON CONFLICT (url) DO NOTHING',
      [url]
    )
    if ((r.rowCount ?? 0) > 0) added38000++
  }
  console.log(`[discovery] kind:38000 found ${discovered38000.size} mints, added ${added38000} new`)

  return added38172 + added38000
}

const AUDIT_API_BASE = 'https://api.audit.8333.space/mints/'
const AUDIT_PAGE_SIZE = 100
const AUDIT_MAX_RECORDS = 10_000

interface AuditRecord {
  url: string
  n_mints?: number | null
  n_melts?: number | null
  n_errors?: number | null
  updated_at?: string | null
}

export async function discoverMintsFromApi(): Promise<number> {
  const records: AuditRecord[] = []

  for (let skip = 0; skip < AUDIT_MAX_RECORDS; skip += AUDIT_PAGE_SIZE) {
    try {
      const url = `${AUDIT_API_BASE}?skip=${skip}&limit=${AUDIT_PAGE_SIZE}`
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) break
      const data: unknown = await res.json()
      if (!Array.isArray(data) || data.length === 0) break
      for (const record of data) {
        if (typeof record !== 'object' || record === null) continue
        const r = record as Record<string, unknown>
        const rawUrl = r['url']
        if (typeof rawUrl !== 'string') continue
        const trimmed = rawUrl.trim()
        if (!trimmed.startsWith('https://')) continue
        try {
          const parsed = new URL(trimmed)
          const h = parsed.hostname.toLowerCase().replace(/\.$/, '')
          if (isObviouslyPrivate(h)) continue
          records.push({
            url: normalizeUrl(trimmed),
            n_mints: typeof r['n_mints'] === 'number' ? r['n_mints'] : null,
            n_melts: typeof r['n_melts'] === 'number' ? r['n_melts'] : null,
            n_errors: typeof r['n_errors'] === 'number' ? r['n_errors'] : null,
            updated_at: typeof r['updated_at'] === 'string' ? r['updated_at'] : null,
          })
        } catch { continue }
      }
      if (data.length < AUDIT_PAGE_SIZE) break
    } catch (err) {
      console.error('[discovery] audit.8333.space fetch error:', err)
      break
    }
  }

  if (records.length === 0) return 0

  let added = 0
  const toProbe: string[] = []

  for (const rec of records) {
    // Insert if new, then update audit stats for all records
    const insertResult = await pool.query(
      'INSERT INTO mints (url, is_known) VALUES ($1, true) ON CONFLICT (url) DO NOTHING',
      [rec.url]
    )
    if ((insertResult.rowCount ?? 0) > 0) {
      added++
      toProbe.push(rec.url)
    }
    await pool.query(
      `UPDATE mints SET
        audit_n_mints = $1,
        audit_n_melts = $2,
        audit_n_errors = $3,
        audit_checked_at = $4
       WHERE url = $5`,
      [rec.n_mints, rec.n_melts, rec.n_errors, rec.updated_at, rec.url]
    )
  }

  if (toProbe.length > 0) {
    await Promise.allSettled(toProbe.map(url => probeMintToDb(url)))
  }

  console.log(`[discovery] audit.8333.space found ${records.length} mints, added ${added} new`)
  return added
}
