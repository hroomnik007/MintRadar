// Admission gate for NEW mint rows that come from untrusted input: POST /api/mint/submit, POST /api/mints/discover
// and the NIP-87 discovery of kind:38172 / kind:38000 events (anyone can publish those). Without it one person with a
// wildcard DNS record (*.example.com answering a fake /v1/info) could add thousands of "mints": every one is shown on
// the Dashboard, listed in the sitemap and probed every 5 minutes. Two caps, both read from the database (so a
// restart does not reset them) and checked only for a URL that is not tracked yet:
//   - at most MAX_MINTS_PER_BASE_DOMAIN rows per base domain (all rows, archived ones too). The busiest base domain
//     had 2 mints on 2026-11-08;
//   - at most NEW_MINTS_PER_DAY new rows in the last 24 hours, all sources together. The real network adds a few mints
//     a month (47 of the 61 public mints were seeded on the first day).
// A concurrent burst can overshoot a cap by the few requests in flight; that is accepted. audit.8333.space records
// (a fixed, trusted source) are not gated.
import { pool } from './db.js'

export const MAX_MINTS_PER_BASE_DOMAIN = 5
export const NEW_MINTS_PER_DAY = 20

export type AdmissionResult = { ok: true } | { ok: false; reason: 'domain_cap' | 'daily_cap'; error: string }

export const ADMISSION_ERRORS = {
  domain_cap: 'MintRadar already tracks the maximum number of mints for this domain.',
  daily_cap: 'MintRadar has added the maximum number of new mints for today. Try again tomorrow.',
} as const

// Second-level labels under a two-letter country code that act as a public suffix (co.uk, com.br, …). A small list
// on purpose: no Public Suffix List dependency. A miss only makes the cap coarser (it then counts per suffix).
const CC_SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'gov', 'edu', 'ne', 'or'])

/** "mint.a.example.co.uk" → "example.co.uk", "mint.example.com" → "example.com"; an IP literal or a single label as is. */
export function baseDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h
  const labels = h.split('.')
  if (labels.length <= 2) return h
  const tld = labels[labels.length - 1]!
  const second = labels[labels.length - 2]!
  const take = tld.length === 2 && CC_SECOND_LEVEL.has(second) ? 3 : 2
  return labels.slice(-take).join('.')
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname } catch { return null }
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
const defaultQuery: Query = (sql, params) => pool.query(sql, params)

/** May `url` be inserted as a new mint? A URL that is already tracked is always admitted (nothing new is added). */
export async function checkMintAdmission(url: string, query: Query = defaultQuery): Promise<AdmissionResult> {
  const host = hostOf(url)
  if (host === null) return { ok: true }
  const res = await query(
    `SELECT url, discovered_at > NOW() - INTERVAL '24 hours' AS recent FROM mints`,
  )
  const rows = res.rows as { url: string; recent: boolean }[]
  if (rows.some(r => r.url === url)) return { ok: true }
  const base = baseDomain(host)
  const sameBase = rows.filter(r => { const h = hostOf(r.url); return h !== null && baseDomain(h) === base }).length
  if (sameBase >= MAX_MINTS_PER_BASE_DOMAIN) return { ok: false, reason: 'domain_cap', error: ADMISSION_ERRORS.domain_cap }
  if (rows.filter(r => r.recent).length >= NEW_MINTS_PER_DAY) return { ok: false, reason: 'daily_cap', error: ADMISSION_ERRORS.daily_cap }
  return { ok: true }
}

/**
 * Rate-limit key of a client address: an IPv4 address as is, an IPv6 address cut to its /64 (one end user usually
 * holds a whole /64, so per-address keys would be trivial to rotate). IPv4-mapped IPv6 (::ffff:a.b.c.d) is IPv4.
 */
export function rateLimitKey(ip: string | undefined): string {
  if (ip === undefined || ip === '') return 'unknown'
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  if (mapped) return mapped[1]!
  if (!ip.includes(':')) return ip
  const [head = '', tail = ''] = ip.split('::')
  const h = head === '' ? [] : head.split(':')
  const t = tail === '' ? [] : tail.split(':')
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h
  return `${groups.slice(0, 4).map(g => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`
}
