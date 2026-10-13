import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { NEW_MINT_MAX_DAYS, isEligibleForRecommendation } from './shared/reliabilityScore.js'
import { classifyVersion, MAX_VERSION_LENGTH, type LatestVersion } from './shared/versionRule.js'
import { METHODOLOGY_VERSION } from './shared/methodology.js'
import { isTestMint } from './testMints.js'
export { WALLET_ENVELOPE_FIELDS, WALLET_MINT_FIELDS, WALLET_QUERY_PARAMS, WALLET_ERRORS } from './shared/walletFields.js'

// Public API for wallets (docs/API.md, docs/openapi/wallets-v1.yaml): a compact, fixed-shape view of the
// /api/mints/known snapshot. Everything here is a pure function of that snapshot; the snapshot itself (one
// database read per 60 seconds, shared with /api/mints/known) lives in index.ts.
//
// The mint object has EXACTLY the keys of WalletMint and is a v1 contract: never rename or remove a key,
// only add, and add its line to WALLET_MINT_FIELDS (shared/walletFields.ts: the /for-wallets page renders it, a
// test compares it with this mapper). It must never carry IP/network data, onion data, reviewer keys or texts,
// contact details or the mint's NUT-06 pubkey (a contract test lists the key set and scans the JSON for those
// names).

/** The fields of an /api/mints/known row that the wallet view reads. */
export interface KnownMintLike {
  url: string
  name: string | null
  archived: boolean
  degraded: boolean
  online: boolean | null
  version: string | null
  softwareLatest: LatestVersion | null
  nutsLimits: Record<string, unknown> | null
  units: string[] | null
  auditCzTotal: number | null
  auditCzBlamed: number | null
  auditCzFetchedAt: string | null
  discoveredAt: string | Date | null
  reliabilityScore: number | null
  uptimePct24h: number | null
  uptimePct7d: number | null
  lastCheckedAt: string | Date | null
  reviewCount: number | null
  reviewRatedCount: number | null
  reviewAvgRating: number | null
  operatorReviewCount: number | null
  latencyMs: number | null
}

export type WalletMintStatus = 'online' | 'offline' | 'degraded' | 'archived'

export interface WalletMint {
  url: string
  name: string | null
  status: WalletMintStatus
  score: number | null
  scoreCappedNew: boolean
  uptime24hPct: number | null
  uptime7dPct: number | null
  lastCheckedAt: string | null
  units: string[] | null
  nuts: string[] | null
  software: string | null
  outdated: boolean | null
  isTest: boolean
  audit: { swaps7d: number; attributedFailures: number; fetchedAt: string } | null
  reviews: { count: number; ratedCount: number; avg: number | null; operatorCount: number }
  eligibleForRecommendation: boolean
}

function toIso(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** NUT numbers (as strings, ascending) the mint advertises: the keys of nutsLimits whose value is not null. */
export function nutsOf(nutsLimits: Record<string, unknown> | null): string[] | null {
  if (nutsLimits === null || typeof nutsLimits !== 'object') return null
  return Object.keys(nutsLimits)
    .filter(k => nutsLimits[k] != null)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
}

function statusOf(m: KnownMintLike): WalletMintStatus {
  if (m.archived) return 'archived'
  if (m.degraded) return 'degraded'
  return m.online === true ? 'online' : 'offline'
}

/** True while the 75-point cap for mints younger than NEW_MINT_MAX_DAYS applies (same rule as applyNewMintCap). */
function underNewMintCap(discoveredAt: string | Date | null, now: number): boolean {
  const iso = toIso(discoveredAt)
  if (iso === null) return false
  const days = (now - new Date(iso).getTime()) / 86_400_000
  return days >= 0 && days < NEW_MINT_MAX_DAYS
}

/** true / false when the version rule can decide, null for unknown software, a missing or unreadable version. */
function outdatedOf(version: string | null, latest: LatestVersion | null): boolean | null {
  if (version === null || version === undefined) return null
  const c = classifyVersion(null, version, latest)
  if (c.label === 'outdated') return true
  if (c.family === null || c.parsed === null || c.minorsBehind === null) return null
  return false
}

export function toWalletMint(m: KnownMintLike, now: number = Date.now()): WalletMint {
  const status = statusOf(m)
  const score = typeof m.reliabilityScore === 'number' ? m.reliabilityScore : null
  const test = isTestMint(m.url)
  const auditOk = typeof m.auditCzTotal === 'number' && typeof m.auditCzBlamed === 'number' && toIso(m.auditCzFetchedAt) !== null
  return {
    url: m.url,
    name: m.name ?? null,
    status,
    score,
    scoreCappedNew: underNewMintCap(m.discoveredAt, now),
    uptime24hPct: m.uptimePct24h ?? null,
    uptime7dPct: m.uptimePct7d ?? null,
    lastCheckedAt: toIso(m.lastCheckedAt),
    units: Array.isArray(m.units) ? m.units : null,
    nuts: nutsOf(m.nutsLimits),
    software: typeof m.version === 'string' ? m.version.slice(0, MAX_VERSION_LENGTH) : null,
    outdated: outdatedOf(m.version, m.softwareLatest),
    isTest: test,
    audit: auditOk
      ? { swaps7d: m.auditCzTotal as number, attributedFailures: m.auditCzBlamed as number, fetchedAt: toIso(m.auditCzFetchedAt) as string }
      : null,
    reviews: {
      count: m.reviewCount ?? 0,
      ratedCount: m.reviewRatedCount ?? 0,
      avg: m.reviewAvgRating ?? null,
      operatorCount: m.operatorReviewCount ?? 0,
    },
    eligibleForRecommendation:
      isEligibleForRecommendation(m.discoveredAt, now) && !test && status === 'online' && score !== null,
  }
}

// ── List query ────────────────────────────────────────────────────────────────

export const WALLET_LIST_DEFAULT_LIMIT = 100
export const WALLET_LIST_MAX_LIMIT = 200

export interface WalletListFilter {
  unit?: string | undefined
  minScore?: number
  includeOffline: boolean
  includeTest: boolean
  includeArchived: boolean
  includeUnscored: boolean
  limit: number
  /** Only mints with eligibleForRecommendation (used by /api/mints/recommend, not a wallet query parameter). */
  eligibleOnly?: boolean
  /** NUT numbers the mint must advertise (used by /api/mints/recommend, not a wallet query parameter). */
  requiredNuts?: string[]
}

export type QueryResult = { ok: true; filter: WalletListFilter } | { ok: false; message: string }

function single(q: Record<string, unknown>, key: string): string | undefined | null {
  const v = q[key]
  if (v === undefined) return undefined
  return typeof v === 'string' ? v : null
}

/** Strict parse of the list query: a present but invalid value is an error; unknown parameters are ignored. */
export function parseWalletListQuery(q: Record<string, unknown>): QueryResult {
  const filter: WalletListFilter = {
    includeOffline: false, includeTest: false, includeArchived: false, includeUnscored: false, limit: WALLET_LIST_DEFAULT_LIMIT,
  }
  const unit = single(q, 'unit')
  if (unit === null || unit === '') return { ok: false, message: 'unit must be a single non-empty string' }
  if (unit !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(unit)) return { ok: false, message: 'unit must be 1 to 16 letters, digits, "_" or "-"' }
    filter.unit = unit.toLowerCase()
  }
  const minScore = single(q, 'minScore')
  if (minScore === null) return { ok: false, message: 'minScore must be a single integer from 0 to 100' }
  if (minScore !== undefined) {
    if (!/^\d{1,3}$/.test(minScore) || Number(minScore) > 100) return { ok: false, message: 'minScore must be an integer from 0 to 100' }
    filter.minScore = Number(minScore)
  }
  for (const key of ['includeOffline', 'includeTest', 'includeArchived', 'includeUnscored'] as const) {
    const v = single(q, key)
    if (v === null) return { ok: false, message: `${key} must be a single value: true or false` }
    if (v === undefined) continue
    if (v !== 'true' && v !== 'false') return { ok: false, message: `${key} must be true or false` }
    filter[key] = v === 'true'
  }
  const limit = single(q, 'limit')
  if (limit === null) return { ok: false, message: 'limit must be a single integer' }
  if (limit !== undefined) {
    if (!/^\d{1,4}$/.test(limit) || Number(limit) < 1 || Number(limit) > WALLET_LIST_MAX_LIMIT) {
      return { ok: false, message: `limit must be an integer from 1 to ${WALLET_LIST_MAX_LIMIT}` }
    }
    filter.limit = Number(limit)
  }
  return { ok: true, filter }
}

function sortKey(m: WalletMint): string {
  if (m.name !== null) return m.name.toLowerCase()
  try { return new URL(m.url).hostname.toLowerCase() } catch { return m.url.toLowerCase() }
}

/** Score descending (nulls last), then uptime7dPct descending (nulls last), then name, then url. */
export function compareWalletMints(a: WalletMint, b: WalletMint): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1
    if (b.score === null) return -1
    return b.score - a.score
  }
  if (a.uptime7dPct !== b.uptime7dPct) {
    if (a.uptime7dPct === null) return 1
    if (b.uptime7dPct === null) return -1
    return b.uptime7dPct - a.uptime7dPct
  }
  const an = sortKey(a), bn = sortKey(b)
  if (an !== bn) return an < bn ? -1 : 1
  return a.url < b.url ? -1 : a.url > b.url ? 1 : 0
}

function nutRequirementMet(m: WalletMint, n: string): boolean {
  const set = m.nuts
  if (set === null) return false
  return set.includes(n) || set.includes(n.replace(/^0+/, ''))
}

/**
 * Filters, orders and truncates. Offline and degraded mints need includeOffline; archived mints need
 * includeArchived (alone: an archived mint is offline by definition). minScore excludes unscored mints.
 */
export function filterWalletMints(mints: WalletMint[], f: WalletListFilter): WalletMint[] {
  return mints
    .filter(m => {
      if (m.status === 'archived') { if (!f.includeArchived) return false }
      else if (m.status !== 'online' && !f.includeOffline) return false
      if (!f.includeTest && m.isTest) return false
      if (m.score === null && !f.includeUnscored) return false
      if (f.minScore !== undefined && (m.score === null || m.score < f.minScore)) return false
      if (f.unit !== undefined && !(m.units ?? []).some(u => u.toLowerCase() === f.unit)) return false
      if (f.eligibleOnly && !m.eligibleForRecommendation) return false
      if (f.requiredNuts && !f.requiredNuts.every(n => nutRequirementMet(m, n))) return false
      return true
    })
    .sort(compareWalletMints)
    .slice(0, f.limit)
}

// ── Envelope ──────────────────────────────────────────────────────────────────

export interface Snapshot { data: unknown; computedAt: number }

export function walletListEnvelope(snap: Snapshot, filter: WalletListFilter): object {
  const now = snap.computedAt
  const all = (snap.data as KnownMintLike[]).map(m => toWalletMint(m, now))
  const mints = filterWalletMints(all, filter)
  return { methodology: METHODOLOGY_VERSION, generatedAt: new Date(now).toISOString(), count: mints.length, mints }
}

export function walletSingleEnvelope(snap: Snapshot, url: string): object | null {
  const found = (snap.data as KnownMintLike[]).find(m => m.url === url)
  if (!found) return null
  return { methodology: METHODOLOGY_VERSION, generatedAt: new Date(snap.computedAt).toISOString(), mint: toWalletMint(found, snap.computedAt) }
}

export interface RecommendQuery { unit: string; minScore: number; limit: number; requiredNuts: string[] }

/** GET /api/mints/recommend: the wallet list restricted to eligibleForRecommendation, in the 2026-10-10 shape. */
export function recommendEnvelope(snap: Snapshot, q: RecommendQuery): object {
  const rows = snap.data as KnownMintLike[]
  const latency = new Map(rows.map(r => [r.url, r.latencyMs ?? null]))
  const all = rows.map(m => toWalletMint(m, snap.computedAt))
  const picked = filterWalletMints(all, {
    unit: q.unit === '' ? undefined : q.unit.toLowerCase(),
    minScore: q.minScore,
    includeOffline: false, includeTest: false, includeArchived: false, includeUnscored: false,
    limit: q.limit,
    eligibleOnly: true,
    requiredNuts: q.requiredNuts,
  })
  return {
    recommended: picked.map(m => ({
      url: m.url,
      name: m.name,
      reliabilityScore: m.score,
      uptimePct24h: m.uptime24hPct,
      latencyMs: latency.get(m.url) ?? null,
      version: m.software,
      units: [q.unit],
    })),
    generatedAt: new Date(snap.computedAt).toISOString(),
    methodology: METHODOLOGY_VERSION,
  }
}

// ── Paths (CORS, rate limit) ──────────────────────────────────────────────────

const PUBLIC_CORS_EXACT = new Set(['/api/mints/known', '/api/mints/recommend', '/health'])

/** /api/wallets and everything below it (the /api/v1 alias is already rewritten when this runs). */
export function isWalletApiPath(path: string): boolean {
  const p = path.toLowerCase()
  return p === '/api/wallets' || p.startsWith('/api/wallets/')
}

/** /api/mints/recommend (any case, trailing slashes ignored, as Express routes it). */
export function isRecommendPath(path: string): boolean {
  return path.toLowerCase().replace(/\/+$/, '') === '/api/mints/recommend'
}

/** Routes on the wallet budget (300/min/IP, ONE shared counter): the wallet API and /api/mints/recommend, which wallets call. */
export function usesWalletRateLimit(path: string): boolean {
  return isWalletApiPath(path) || isRecommendPath(path)
}

/** Routes that answer any origin: the wallet API, /api/mints/known, /api/mints/recommend and /health. */
export function isPublicCorsPath(path: string): boolean {
  const p = path.toLowerCase().replace(/\/+$/, '')
  return isWalletApiPath(p) || PUBLIC_CORS_EXACT.has(p)
}

export const PUBLIC_CORS_EXPOSE_HEADERS = 'ETag, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset'

// ── Cached JSON ───────────────────────────────────────────────────────────────

export interface CachedBody { json: string; etag: string }

export function buildCachedBody(body: unknown): CachedBody {
  const json = JSON.stringify(body)
  return { json, etag: `"${createHash('sha256').update(json).digest('hex').slice(0, 32)}"` }
}

// One serialised body (and its strong ETag) per snapshot and request shape, so a hit costs no stringify or hash.
// Bounded: at most MEMO_MAX bodies per snapshot, dropped together with the snapshot.
const MEMO_MAX = 64
let memoSnapshot: object | null = null
let memo = new Map<string, CachedBody>()

export function memoizedBody(snapshot: object, key: string, build: () => unknown): CachedBody {
  if (memoSnapshot !== snapshot) { memoSnapshot = snapshot; memo = new Map() }
  const hit = memo.get(key)
  if (hit) return hit
  const body = buildCachedBody(build())
  if (memo.size < MEMO_MAX) memo.set(key, body)
  return body
}

/** Cache-Control public, max-age=300 and a strong ETag on EVERY response; Express turns a matching If-None-Match into 304. */
export function sendCachedBody(res: Response, body: CachedBody): void {
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.setHeader('ETag', body.etag)
  res.type('application/json')
  res.send(body.json)
}

export function sendWalletError(res: Response, status: number, code: string, message: string, retryAfterSec?: number): void {
  res.status(status).json({ error: { code, message, ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) } })
}

export function queryOf(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>
}
