// Admission gate for NEW mint rows that come from untrusted input: POST /api/mint/submit and POST /api/mints/discover
// (source 'manual', a person adding mints) and the NIP-87 discovery of kind:38172 / kind:38000 events (source
// 'nostr', anyone can publish those). Without it one person with a wildcard DNS record (*.example.com answering a fake
// /v1/info) could add thousands of "mints": every one is shown on the Dashboard, listed in the sitemap and probed every
// 5 minutes. Two caps, both read from the database (so a restart does not reset them) and checked only for a URL that
// is not tracked yet:
//   - at most MAX_MINTS_PER_BASE_DOMAIN rows per base domain (all rows, archived ones too). The base domain comes from
//     the Public Suffix List including its private section (tldts), so every app on a shared host (foo.fly.dev,
//     bar.onrender.com, baz.herokuapp.com, …) is its own base and one platform's tenants do not share five slots;
//   - a daily budget of new rows per source, counted on mints.added_via: NEW_MANUAL_MINTS_PER_DAY for 'manual' and
//     NEW_NOSTR_MINTS_PER_DAY for 'nostr'. Separate budgets, so published Nostr events can never use up the slots of
//     people adding a mint by hand. Rows without added_via (inserted before the column, the seed list, audit.8333.space)
//     count toward neither budget. The real network adds a few mints a month (47 of the 61 public mints were seeded on
//     the first day).
// Only an inserted row counts, and every insert path requires a successful probe first (Nostr discovery the stronger
// /v1/info + /v1/keys check, isFunctioningCashuMint), so a URL that does not answer as a mint never uses up a budget.
// A concurrent burst can overshoot a cap by the few requests in flight; that is accepted.
import { getDomain } from 'tldts'
import { pool } from './db.js'

export const MAX_MINTS_PER_BASE_DOMAIN = 5
export const NEW_MANUAL_MINTS_PER_DAY = 20
export const NEW_NOSTR_MINTS_PER_DAY = 10

export type AdmissionSource = 'manual' | 'nostr'

export const DAILY_BUDGET: Readonly<Record<AdmissionSource, number>> = {
  manual: NEW_MANUAL_MINTS_PER_DAY,
  nostr: NEW_NOSTR_MINTS_PER_DAY,
}

export type AdmissionResult = { ok: true } | { ok: false; reason: 'domain_cap' | 'daily_cap'; error: string }

export const ADMISSION_ERRORS = {
  domain_cap: 'MintRadar already tracks the maximum number of mints for this domain.',
  daily_cap: 'MintRadar has added the maximum number of new mints for today. Try again tomorrow.',
} as const

// Multi-tenant hosts that the Public Suffix List does not (fully) list: each direct subdomain is a separate tenant.
// (railway.app: only up.railway.app is in the list.)
const EXTRA_SHARED_SUFFIXES = ['railway.app']

/**
 * The registrable domain of a host, by the Public Suffix List with its private (shared hosting) section:
 * "mint.a.example.co.uk" → "example.co.uk", "mint.example.com" → "example.com", "mint.app.fly.dev" → "app.fly.dev".
 * An IP literal, a single label or anything the list cannot split is returned as is.
 */
export function baseDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h.startsWith('[')) return h
  const domain = getDomain(h, { allowPrivateDomains: true }) ?? h
  // The list stops at an unlisted platform suffix ("x.railway.app" → "railway.app"): one label more.
  if (EXTRA_SHARED_SUFFIXES.includes(domain) && h !== domain) {
    const labels = h.slice(0, -domain.length - 1).split('.')
    return `${labels[labels.length - 1]}.${domain}`
  }
  return domain
}

function hostOf(url: string): string | null {
  try { return new URL(url).hostname } catch { return null }
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
const defaultQuery: Query = (sql, params) => pool.query(sql, params)

/**
 * May `url` be inserted as a new mint from `source`? A URL that is already tracked is always admitted (nothing new is
 * added). The caller stores `source` in mints.added_via on insert, which is what the daily budget counts.
 */
export async function checkMintAdmission(url: string, source: AdmissionSource, query: Query = defaultQuery): Promise<AdmissionResult> {
  const host = hostOf(url)
  if (host === null) return { ok: true }
  const res = await query(
    `SELECT url, added_via, discovered_at > NOW() - INTERVAL '24 hours' AS recent FROM mints`,
  )
  const rows = res.rows as { url: string; added_via?: string | null; recent: boolean }[]
  if (rows.some(r => r.url === url)) return { ok: true }
  const base = baseDomain(host)
  const sameBase = rows.filter(r => { const h = hostOf(r.url); return h !== null && baseDomain(h) === base }).length
  if (sameBase >= MAX_MINTS_PER_BASE_DOMAIN) return { ok: false, reason: 'domain_cap', error: ADMISSION_ERRORS.domain_cap }
  if (rows.filter(r => r.recent && r.added_via === source).length >= DAILY_BUDGET[source]) {
    return { ok: false, reason: 'daily_cap', error: ADMISSION_ERRORS.daily_cap }
  }
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
