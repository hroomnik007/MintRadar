import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { NEW_MINT_MAX_DAYS, isEligibleForRecommendation, hasFreshProbe } from './shared/reliabilityScore.js'
import { classifyVersion, MAX_VERSION_LENGTH, type LatestVersion } from './shared/versionRule.js'
import { METHODOLOGY_VERSION } from './shared/methodology.js'
import { isNutDeclaredSupported, isNutDisabled } from './shared/nutSupport.js'
import { mintStatus, type MintStatus } from './shared/mintStatus.js'
import { isTestMint } from './testMints.js'
import { auditDataState } from './shared/auditScore.js'
import type { ScoreBreakdown } from './scoreBreakdown.js'
import type { ContactCheck } from './contactChecks.js'
import { feeExamplesOf, type FeeExampleUnit } from './shared/feeExamples.js'
import { nip87AnnouncementOf, type Nip87AnnouncementFacts } from './shared/nip87Announcement.js'
export { WALLET_ENVELOPE_FIELDS, WALLET_MINT_FIELDS, WALLET_QUERY_PARAMS, WALLET_ERRORS } from './shared/walletFields.js'

// Public API for wallets (docs/API.md, docs/openapi/wallets-v1.yaml): a compact, fixed-shape view of the
// /api/mints/known snapshot. Everything here is a pure function of that snapshot; the snapshot itself (one
// database read per 60 seconds, shared with /api/mints/known) lives in index.ts.
//
// The mint object has EXACTLY the keys of WalletMint and is a v1 contract: never rename or remove a key,
// only add, and add its line to WALLET_MINT_FIELDS (shared/walletFields.ts: the /for-wallets page renders it, a
// test compares it with this mapper). It must never carry IP/network data (address, ASN, hosting organisation,
// server location), lastError, reviewer keys or texts or contact details. Since 2026-10-20 it does carry the mint's
// public NUT-06 pubkey, the boolean hasOnion and contactChecks (facts about the entries: kind, formatValid, domainResolves,
// checkedAt; never a contact value or a domain). A contract test lists the key set and scans the JSON for the forbidden names.

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
  // Read by the 2026-10-20 additive fields; optional so older fixtures still type-check.
  pubkey?: string | null
  hasOnion?: boolean | null
  lastOnlineAt?: string | Date | null
  mintMethods?: Record<string, unknown>[] | null
  meltMethods?: Record<string, unknown>[] | null
  // The stored NIP-87 announcement (discovery.ts): event created_at and `d` tag; read by `nip87` (2026-10-30).
  nostrAnnouncedAt?: string | Date | null
  nostrAnnounceD?: string | null
}

/** Per-mint data the snapshot carries beside the /api/mints/known rows (never serialised there). */
export interface WalletExtra {
  /** mint_history rows of the last 24 hours. */
  probes24h: number
  /** First failed probe after lastOnlineAt (see WALLET_MINT_FIELDS); null while the mint is online or has no history. */
  downSince: string | null
  /** The breakdown stored with the score (mints.score_breakdown); null until the first probe cycle after the deploy. */
  scoreBreakdown: ScoreBreakdown | null
  /** Share of successful probes in the last 30 days, in percent; null without probes in that window. */
  uptime30dPct?: number | null
  /** Latency percentiles of the successful probes of the last 24 hours; null without such a probe. */
  latency24h?: WalletLatency24h | null
  /** Keysets present in the latest successful keysets check, ordered by id. */
  keysets: WalletKeyset[]
  keysetsCheckedAt: string | null
  /** Confirmed changes of the mint's public data (mint_changes), newest first, at most 50. */
  changes: WalletChange[]
  /** What the mint showed once and was not confirmed yet (mintChanges.ts pendingOf); null or absent when nothing is pending. */
  changesPending?: WalletPendingChanges | null
  /** The stored facts about the contact entries (mints.contact_checks); never a value or a domain. */
  contactChecks?: ContactCheck[]
  /** cashu.info's 7-day swaps split by direction (audit_cz_detail), with the time MintRadar stored them; null when none are stored. */
  auditDirections?: AuditDirectionsRow | null
}

/** The part of audit_cz_detail.detail.swaps7d the per-direction facts read, as the snapshot query hands it over. */
export interface AuditDirectionsRow {
  asSource?: { total?: unknown; failed?: unknown } | null
  asDest?: { total?: unknown; failed?: unknown } | null
  fetchedAt: string | Date | null
}

/** One direction of cashu.info's 7-day swaps. melt = the mint was the source of a swap (it paid the invoice), mint = it was the destination. */
export interface AuditDirection { attempts: number; failures: number; windowDays: number; source: string; syncedAt: string }

/** One confirmed change (docs/API.md "Mint change log"); times are ISO 8601, the Nostr tags use UNIX seconds. */
export interface WalletChange {
  type: string
  field: string
  oldValue: string | null
  newValue: string | null
  observedAt: string
  firstSeenAt: string
}

/** A difference seen once that waits for its confirming observation. Never in `changes`, never counted by changedSince. */
export interface WalletPendingChange {
  type: string
  field: string
  oldValue: string | null
  newValue: string | null
  firstSeenAt: string
}

export interface WalletPendingChanges { firstSeenAt: string; diff: WalletPendingChange[] }

export interface WalletKeyset {
  id: string
  unit: string
  active: boolean
  inputFeePpk: number | null
  finalExpiry: string | null
  idVersion: string
  idValid: boolean | null
}

export interface WalletMethodEntry { method: string; unit: string; minAmount: number | null; maxAmount: number | null }

export interface WalletLimit { method: string; unit: string; min: number | null; max: number | null }

export type AuditNeutralReason = 'low_sample' | 'stale' | 'no_data'

export const WALLET_METHODS = ['bolt11', 'bolt12', 'onchain'] as const
export const WALLET_INCLUDES = ['facts', 'keysets', 'methods', 'breakdown', 'changes'] as const
/** `include=changes` on the list returns this many newest changes per mint; the single-mint endpoint returns up to 50. */
export const WALLET_LIST_CHANGES_CAP = 10
export type WalletInclude = typeof WALLET_INCLUDES[number]

/** p50/p95 of latency_ms over the successful probes of the last 24 hours (percentile_cont), rounded to whole ms. */
export interface WalletLatency24h { p50Ms: number; p95Ms: number; samples: number }

/** The snapshot query's percentile columns as latency24h; null when there is no successful probe with a latency. */
export function latency24hOf(p50: unknown, p95: unknown, samples: unknown): WalletLatency24h | null {
  const n = Number(samples ?? 0)
  const a = p50 == null ? NaN : Number(p50)
  const b = p95 == null ? NaN : Number(p95)
  if (!(n > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return null
  return { p50Ms: Math.round(a), p95Ms: Math.round(b), samples: n }
}

export type WalletMintStatus = MintStatus

export interface WalletMint {
  url: string
  name: string | null
  status: WalletMintStatus
  score: number | null
  /** true when status is not "online" (offline, degraded, archived): score is then the last measured one. Derived from the status only. */
  scoreStale: boolean
  scoreCappedNew: boolean
  uptime24hPct: number | null
  uptime7dPct: number | null
  /** Additive 2026-10-25: share of successful probes in the last 30 days, in percent. */
  uptime30dPct: number | null
  lastCheckedAt: string | null
  units: string[] | null
  nuts: string[] | null
  /** Additive 2026-10-27: NUT-04 (minting) listed with `disabled: true`; null when the NUTs are unknown. NUT-04 stays in `nuts`. */
  mintDisabled: boolean | null
  /** Additive 2026-10-27: NUT-05 (melting) listed with `disabled: true`; null when the NUTs are unknown. NUT-05 stays in `nuts`. */
  meltDisabled: boolean | null
  software: string | null
  outdated: boolean | null
  isTest: boolean
  audit: { swaps7d: number; attributedFailures: number; fetchedAt: string } | null
  reviews: { count: number; ratedCount: number; avg: number | null; operatorCount: number }
  eligibleForRecommendation: boolean
  pubkey: string | null
  firstSeenAt: string | null
  lastOnlineAt: string | null
  downSince: string | null
  hasOnion: boolean
  authRequired: { clear: boolean; blind: boolean } | null
  sample: { probes24h: number | null; swaps7d: number | null }
  auditNeutralReason: AuditNeutralReason | null
  // Heavier fields (pubkey, firstSeenAt, lastOnlineAt, sample and the four below): always built here, kept in the output only
  // for the single-mint endpoint and `include=` on the list (the default list may grow by about 25% over the 2026-10-12 shape).
  keysets: WalletKeyset[]
  keysetsCheckedAt: string | null
  methods: { mint: WalletMethodEntry[]; melt: WalletMethodEntry[] } | null
  scoreBreakdown: ScoreBreakdown | null
  changes: WalletChange[]
  /** With `changes`: the unconfirmed differences ({ firstSeenAt, diff }), null when nothing is pending. */
  changesPending: WalletPendingChanges | null
  /** Facts about the contact entries (kind, formatValid, domainResolves, checkedAt); no values, no domains. */
  contactChecks: ContactCheck[]
  /** Only with include=facts: input fee for spending 1, 16 and 100 proofs, per unit with an active keyset (a missing fee counts as 0, docs/API.md). [] when none. */
  feeExamples: FeeExampleUnit[]
  /** Only with include=facts: the limits the mint declares in /v1/info for NUT-04 (mint) and NUT-05 (melt), per method and unit. null when neither is stored. */
  limits: { mint: WalletLimit[]; melt: WalletLimit[] } | null
  /** Only with include=facts: cashu.info's 7-day swaps per direction. A part is null when that direction has no stored numbers. */
  auditByDirection: { mint: AuditDirection | null; melt: AuditDirection | null }
  /** Only with include=facts (additive 2026-10-25): latency percentiles of the successful probes of the last 24 hours. */
  latency24h: WalletLatency24h | null
  /** Only with include=facts (additive 2026-10-30): the stored NIP-87 kind:38172 announcement (shared/nip87Announcement.ts). No checkedAt: the time of the last discovery run is not stored. */
  nip87: Nip87AnnouncementFacts
}

const HEAVY_KEYS = { facts: ['pubkey', 'firstSeenAt', 'lastOnlineAt', 'sample', 'contactChecks', 'feeExamples', 'limits', 'auditByDirection', 'latency24h', 'nip87'], keysets: ['keysets', 'keysetsCheckedAt'], methods: ['methods'], breakdown: ['scoreBreakdown'], changes: ['changes', 'changesPending'] } as const

function toIso(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** NUT numbers (as strings, ascending) the mint advertises: the keys of nutsLimits that are declared and not `supported: false` (shared/nutSupport.ts). */
export function nutsOf(nutsLimits: Record<string, unknown> | null): string[] | null {
  if (nutsLimits === null || typeof nutsLimits !== 'object') return null
  return Object.keys(nutsLimits)
    .filter(k => isNutDeclaredSupported(nutsLimits[k]))
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
}

/** True when NUT `key` is listed with `disabled: true` (shared/nutSupport.ts isNutDisabled); null when the NUTs are unknown. */
export function nutDisabledOf(nutsLimits: Record<string, unknown> | null | undefined, key: string): boolean | null {
  if (nutsLimits === null || nutsLimits === undefined || typeof nutsLimits !== 'object') return null
  return isNutDisabled(nutsLimits[key])
}

/** The shared status rule (shared/mintStatus.ts): the website shows the same state from the same snapshot. */
function statusOf(m: KnownMintLike): WalletMintStatus {
  return mintStatus(m)
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

/** The reviews rollup recomputed from the stored reviews (same rule as mints.review_*), for a mint whose rollup is still NULL. */
export interface ReviewsFallback { count: number; ratedCount: number; avg: number | null; operatorCount: number }

const PUBKEY_RE = /^[0-9a-f]{66}$/i
const METHOD_NAME_RE = /^[a-z0-9_-]{1,32}$/i
const UNIT_RE = /^[A-Za-z0-9_-]{1,16}$/
const METHODS_MAX_ENTRIES = 32

const amountOf = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null)

/** The advertised NUT-04/05 methods (method, unit, min and max amount), bounded and validated; null when neither is stored. */
export function methodsOf(mint: Record<string, unknown>[] | null | undefined, melt: Record<string, unknown>[] | null | undefined): WalletMint['methods'] {
  if (!Array.isArray(mint) && !Array.isArray(melt)) return null
  const clean = (list: unknown): WalletMethodEntry[] => {
    if (!Array.isArray(list)) return []
    const out: WalletMethodEntry[] = []
    for (const e of list as Array<Record<string, unknown> | null>) {
      if (out.length >= METHODS_MAX_ENTRIES) break
      if (e === null || typeof e !== 'object') continue
      const method = e['method'], unit = e['unit']
      if (typeof method !== 'string' || !METHOD_NAME_RE.test(method) || typeof unit !== 'string' || !UNIT_RE.test(unit)) continue
      out.push({ method: method.toLowerCase(), unit: unit.toLowerCase(), minAmount: amountOf(e['min_amount']), maxAmount: amountOf(e['max_amount']) })
    }
    return out
  }
  return { mint: clean(mint), melt: clean(melt) }
}

/** The declared NUT-04/05 limits per method and unit: null for a limit the mint does not declare (or states in an unusable form). */
export function limitsOf(mint: Record<string, unknown>[] | null | undefined, melt: Record<string, unknown>[] | null | undefined): WalletMint['limits'] {
  const m = methodsOf(mint, melt)
  if (m === null) return null
  const pick = (list: WalletMethodEntry[]): WalletLimit[] => list.map(e => ({ method: e.method, unit: e.unit, min: e.minAmount, max: e.maxAmount }))
  return { mint: pick(m.mint), melt: pick(m.melt) }
}

const AUDIT_DIRECTION_SOURCE = 'cashu.info'
const AUDIT_DIRECTION_WINDOW_DAYS = 7

/** One direction of the stored cashu.info detail; null when attempts or failures is not a non-negative integer or the store time is unusable. */
function auditDirectionOf(d: { total?: unknown; failed?: unknown } | null | undefined, at: string | null): AuditDirection | null {
  if (d === null || d === undefined || typeof d !== 'object' || at === null) return null
  const { total, failed } = d
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return null
  if (typeof failed !== 'number' || !Number.isSafeInteger(failed) || failed < 0) return null
  return { attempts: total, failures: Math.min(failed, total), windowDays: AUDIT_DIRECTION_WINDOW_DAYS, source: AUDIT_DIRECTION_SOURCE, syncedAt: at }
}

export function auditByDirectionOf(row: AuditDirectionsRow | null | undefined): WalletMint['auditByDirection'] {
  const at = row ? toIso(row.fetchedAt) : null
  return { mint: auditDirectionOf(row?.asDest, at), melt: auditDirectionOf(row?.asSource, at) }
}

/** The changes_json column of the snapshot query (newest first) as WalletChange[]; entries of the wrong shape are dropped. */
export function changesOf(raw: unknown): WalletChange[] {
  if (!Array.isArray(raw)) return []
  const out: WalletChange[] = []
  for (const e of raw as Array<Record<string, unknown> | null>) {
    if (e === null || typeof e !== 'object') continue
    const { type, field, old, new: next, observed, first } = e
    if (typeof type !== 'string' || typeof field !== 'string' || typeof observed !== 'string' || typeof first !== 'string') continue
    out.push({
      type, field,
      oldValue: typeof old === 'string' ? old : null,
      newValue: typeof next === 'string' ? next : null,
      observedAt: observed, firstSeenAt: first,
    })
  }
  return out
}

/** The keysets_json column of the snapshot query as WalletKeyset[]; entries of the wrong shape are dropped. */
export function keysetsOf(raw: unknown): WalletKeyset[] {
  if (!Array.isArray(raw)) return []
  const out: WalletKeyset[] = []
  for (const e of raw as Array<Record<string, unknown> | null>) {
    if (e === null || typeof e !== 'object') continue
    const { id, unit, active, fee, expiry, version, valid } = e
    if (typeof id !== 'string' || typeof unit !== 'string' || typeof active !== 'boolean' || typeof version !== 'string') continue
    out.push({
      id, unit, active,
      inputFeePpk: typeof fee === 'number' && Number.isSafeInteger(fee) && fee >= 0 ? fee : null,
      finalExpiry: typeof expiry === 'string' ? toIso(expiry) : null,
      idVersion: version,
      idValid: typeof valid === 'boolean' ? valid : null,
    })
  }
  return out
}

/** Why the audit component is neutral (shared/auditScore.ts decides); null while it is scored. */
function auditNeutralReasonOf(m: KnownMintLike, now: number): AuditNeutralReason | null {
  switch (auditDataState(m.auditCzBlamed, m.auditCzTotal, m.auditCzFetchedAt, now)) {
    case 'scored': return null
    case 'too-few': return 'low_sample'
    case 'too-old': return 'stale'
    default: return 'no_data'
  }
}

export function toWalletMint(m: KnownMintLike, now: number = Date.now(), reviewsFallback?: ReviewsFallback, extra?: WalletExtra): WalletMint {
  const status = statusOf(m)
  const score = typeof m.reliabilityScore === 'number' ? m.reliabilityScore : null
  const test = isTestMint(m.url)
  const auditOk = typeof m.auditCzTotal === 'number' && typeof m.auditCzBlamed === 'number' && toIso(m.auditCzFetchedAt) !== null
  return {
    url: m.url,
    name: m.name ?? null,
    status,
    score,
    scoreStale: status !== 'online',
    scoreCappedNew: underNewMintCap(m.discoveredAt, now),
    uptime24hPct: m.uptimePct24h ?? null,
    uptime7dPct: m.uptimePct7d ?? null,
    uptime30dPct: extra?.uptime30dPct ?? null,
    lastCheckedAt: toIso(m.lastCheckedAt),
    units: Array.isArray(m.units) ? m.units : null,
    nuts: nutsOf(m.nutsLimits),
    mintDisabled: nutDisabledOf(m.nutsLimits, '4'),
    meltDisabled: nutDisabledOf(m.nutsLimits, '5'),
    software: typeof m.version === 'string' ? m.version.slice(0, MAX_VERSION_LENGTH) : null,
    outdated: outdatedOf(m.version, m.softwareLatest),
    isTest: test,
    audit: auditOk
      ? { swaps7d: m.auditCzTotal as number, attributedFailures: Math.min(m.auditCzBlamed as number, m.auditCzTotal as number), fetchedAt: toIso(m.auditCzFetchedAt) as string }
      : null,
    // While review_rated_count is NULL the stored reviews are counted at read time (the snapshot carries them), so
    // ratedCount is never a misleading 0; 0 only when there really are no rated reviews.
    reviews: m.reviewRatedCount == null && reviewsFallback
      ? { count: reviewsFallback.count, ratedCount: reviewsFallback.ratedCount, avg: reviewsFallback.avg, operatorCount: reviewsFallback.operatorCount }
      : {
        count: m.reviewCount ?? 0,
        ratedCount: m.reviewRatedCount ?? 0,
        avg: m.reviewAvgRating ?? null,
        operatorCount: m.operatorReviewCount ?? 0,
      },
    eligibleForRecommendation:
      isEligibleForRecommendation(m.discoveredAt, now) && !test && status === 'online' && score !== null &&
      hasFreshProbe(m.lastCheckedAt, now),
    pubkey: typeof m.pubkey === 'string' && PUBKEY_RE.test(m.pubkey) ? m.pubkey.toLowerCase() : null,
    firstSeenAt: toIso(m.discoveredAt),
    lastOnlineAt: toIso(m.lastOnlineAt),
    downSince: status === 'online' ? null : (extra?.downSince ?? null),
    hasOnion: m.hasOnion === true,
    authRequired: m.nutsLimits === null || m.nutsLimits === undefined || typeof m.nutsLimits !== 'object'
      ? null
      : { clear: isNutDeclaredSupported(m.nutsLimits['21']), blind: isNutDeclaredSupported(m.nutsLimits['22']) },
    sample: { probes24h: extra?.probes24h ?? null, swaps7d: typeof m.auditCzTotal === 'number' ? m.auditCzTotal : null },
    auditNeutralReason: auditNeutralReasonOf(m, now),
    keysets: extra?.keysets ?? [],
    keysetsCheckedAt: extra?.keysetsCheckedAt ?? null,
    methods: methodsOf(m.mintMethods, m.meltMethods),
    scoreBreakdown: extra?.scoreBreakdown ?? null,
    changes: extra?.changes ?? [],
    changesPending: extra?.changesPending ?? null,
    contactChecks: extra?.contactChecks ?? [],
    feeExamples: feeExamplesOf(extra?.keysets ?? []),
    limits: limitsOf(m.mintMethods, m.meltMethods),
    auditByDirection: auditByDirectionOf(extra?.auditDirections),
    latency24h: extra?.latency24h ?? null,
    nip87: nip87AnnouncementOf({ announcedAt: m.nostrAnnouncedAt, announceD: m.nostrAnnounceD, infoPubkey: m.pubkey }),
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
  /** Only mints with eligibleForRecommendation (used by /api/mints/recommend; the wallet query parameter is `eligible`). */
  eligibleOnly?: boolean
  /** The `eligible` query parameter: keep only mints whose eligibleForRecommendation equals this. */
  eligible?: boolean
  /** NUT numbers the mint must advertise (the `nuts` query parameter, and /api/mints/recommend). */
  requiredNuts?: string[]
  /** The `method` query parameter: the mint advertises it (mint or melt, a switched-off side not counted), for `unit` when that is given too. */
  method?: string
  /** The `maxInputFeePpk` query parameter. */
  maxInputFeePpk?: number
  /** The `include` query parameter: which heavier fields the list objects carry. */
  include: WalletInclude[]
  /** The `changedSince` query parameter (ms): keep mints with a confirmed change observed after this time. */
  changedSince?: number
}

/** The largest fee the keysets collection stores (keysetsSync.ts MAX_FEE_PPK); the bound of `maxInputFeePpk`. */
export const WALLET_MAX_FEE_PPK = 1_000_000

/** The most NUT numbers one `nuts` value may list (there are fewer than 30 NUTs). */
export const WALLET_NUTS_MAX = 32

const CHANGED_SINCE_MESSAGE = 'changedSince must be a single ISO 8601 UTC time such as 2026-10-20T12:00:00Z (a bare date means 00:00 UTC), or UNIX seconds'
const ISO_SINCE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/

/** ISO 8601 (date, or date and time WITH Z or an offset) or UNIX seconds (9 to 11 digits) as milliseconds; null when it is neither. */
export function parseChangedSince(v: string): number | null {
  if (/^\d{9,11}$/.test(v)) return Number(v) * 1000
  if (!ISO_SINCE_RE.test(v)) return null
  const ms = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v)
  return Number.isFinite(ms) ? ms : null
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
    includeOffline: false, includeTest: false, includeArchived: false, includeUnscored: false, limit: WALLET_LIST_DEFAULT_LIMIT, include: [],
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
  const nuts = single(q, 'nuts')
  if (nuts === null || nuts === '') return { ok: false, message: 'nuts must be a single comma-separated list of NUT numbers, for example 4,5' }
  if (nuts !== undefined) {
    const list = nuts.split(',').map(n => n.trim())
    if (list.length > WALLET_NUTS_MAX || !list.every(n => /^\d{1,3}$/.test(n))) {
      return { ok: false, message: `nuts must be 1 to ${WALLET_NUTS_MAX} comma-separated NUT numbers, for example 4,5` }
    }
    filter.requiredNuts = [...new Set(list)]
  }
  const eligible = single(q, 'eligible')
  if (eligible === null) return { ok: false, message: 'eligible must be a single value: true or false' }
  if (eligible !== undefined) {
    if (eligible !== 'true' && eligible !== 'false') return { ok: false, message: 'eligible must be true or false' }
    filter.eligible = eligible === 'true'
  }
  const method = single(q, 'method')
  if (method === null || method === '') return { ok: false, message: `method must be a single value: ${WALLET_METHODS.join(', ')}` }
  if (method !== undefined) {
    const lower = method.toLowerCase()
    if (!(WALLET_METHODS as readonly string[]).includes(lower)) return { ok: false, message: `method must be one of ${WALLET_METHODS.join(', ')}` }
    filter.method = lower
  }
  const maxFee = single(q, 'maxInputFeePpk')
  if (maxFee === null || maxFee === '') return { ok: false, message: 'maxInputFeePpk must be a single integer from 0 to 1000000' }
  if (maxFee !== undefined) {
    if (!/^\d{1,7}$/.test(maxFee) || Number(maxFee) > WALLET_MAX_FEE_PPK) return { ok: false, message: 'maxInputFeePpk must be an integer from 0 to 1000000' }
    filter.maxInputFeePpk = Number(maxFee)
  }
  const include = single(q, 'include')
  if (include === null || include === '') return { ok: false, message: `include must be a single comma-separated list of: ${WALLET_INCLUDES.join(', ')}` }
  if (include !== undefined) {
    const list = include.split(',').map(v => v.trim())
    if (!list.every(v => (WALLET_INCLUDES as readonly string[]).includes(v))) return { ok: false, message: `include must be a comma-separated list of: ${WALLET_INCLUDES.join(', ')}` }
    filter.include = WALLET_INCLUDES.filter(v => list.includes(v))
  }
  const changedSince = single(q, 'changedSince')
  if (changedSince === null || changedSince === '') return { ok: false, message: CHANGED_SINCE_MESSAGE }
  if (changedSince !== undefined) {
    const ms = parseChangedSince(changedSince)
    if (ms === null) return { ok: false, message: CHANGED_SINCE_MESSAGE }
    filter.changedSince = ms
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

// A NUT-04 (mint) or NUT-05 (melt) side the mint switched off (`disabled: true`) does not meet `method=`, as on the
// website's Dashboard method filter (2026-10-27). The `methods` and `limits` fields still list its entries.
function methodRequirementMet(m: WalletMint, method: string, unit: string | undefined): boolean {
  if (m.methods === null) return false
  const sides = [m.mintDisabled === true ? [] : m.methods.mint, m.meltDisabled === true ? [] : m.methods.melt]
  return sides.flat().some(e => e.method === method && (unit === undefined || e.unit === unit))
}

/**
 * maxInputFeePpk: the active keysets in scope (the requested unit, or every unit) must exist and ALL have a known fee
 * at or below the limit. An unknown fee (null) or no active keyset in scope never matches.
 */
function feeRequirementMet(m: WalletMint, max: number, unit: string | undefined): boolean {
  const scope = m.keysets.filter(k => k.active && (unit === undefined || k.unit === unit))
  return scope.length > 0 && scope.every(k => k.inputFeePpk !== null && k.inputFeePpk <= max)
}

/**
 * Filters and orders (no truncation: `total` of the list envelope counts these). Offline and degraded mints need
 * includeOffline; archived mints need includeArchived (alone: an archived mint is offline by definition). minScore
 * excludes unscored mints.
 */
export function matchWalletMints(mints: WalletMint[], f: WalletListFilter): WalletMint[] {
  return mints
    .filter(m => {
      if (m.status === 'archived') { if (!f.includeArchived) return false }
      else if (m.status !== 'online' && !f.includeOffline) return false
      if (!f.includeTest && m.isTest) return false
      if (m.score === null && !f.includeUnscored) return false
      if (f.minScore !== undefined && (m.score === null || m.score < f.minScore)) return false
      if (f.unit !== undefined && !(m.units ?? []).some(u => u.toLowerCase() === f.unit)) return false
      if (f.eligibleOnly && !m.eligibleForRecommendation) return false
      if (f.eligible !== undefined && m.eligibleForRecommendation !== f.eligible) return false
      if (f.requiredNuts && !f.requiredNuts.every(n => nutRequirementMet(m, n))) return false
      if (f.method !== undefined && !methodRequirementMet(m, f.method, f.unit)) return false
      if (f.maxInputFeePpk !== undefined && !feeRequirementMet(m, f.maxInputFeePpk, f.unit)) return false
      if (f.changedSince !== undefined && !m.changes.some(c => Date.parse(c.observedAt) > (f.changedSince as number))) return false
      return true
    })
    .sort(compareWalletMints)
}

/** matchWalletMints, truncated to f.limit. */
export function filterWalletMints(mints: WalletMint[], f: WalletListFilter): WalletMint[] {
  return matchWalletMints(mints, f).slice(0, f.limit)
}

// ── Envelope ──────────────────────────────────────────────────────────────────

export interface Snapshot {
  data: unknown
  computedAt: number
  /** Review aggregates recomputed from stored reviews, by mint URL, only for mints whose rollup column is NULL. Never serialised. */
  reviewFallback?: ReadonlyMap<string, ReviewsFallback>
  /** probes24h, downSince, the stored score breakdown and the keysets, by mint URL. Never serialised. */
  walletExtra?: ReadonlyMap<string, WalletExtra>
}

const toMint = (snap: Snapshot, m: KnownMintLike): WalletMint =>
  toWalletMint(m, snap.computedAt, snap.reviewFallback?.get(m.url), snap.walletExtra?.get(m.url))

/** The mint object without the heavier fields that `include` did not ask for. */
function withIncludes(m: WalletMint, include: readonly WalletInclude[]): object {
  const out: Record<string, unknown> = { ...m }
  for (const group of WALLET_INCLUDES) {
    if (include.includes(group)) continue
    for (const key of HEAVY_KEYS[group]) delete out[key]
  }
  if (include.includes('changes')) out['changes'] = m.changes.slice(0, WALLET_LIST_CHANGES_CAP)
  return out
}

export function walletListEnvelope(snap: Snapshot, filter: WalletListFilter): object {
  const now = snap.computedAt
  const all = (snap.data as KnownMintLike[]).map(m => toMint(snap, m))
  const matched = matchWalletMints(all, filter)
  const mints = matched.slice(0, filter.limit)
  return {
    methodology: METHODOLOGY_VERSION, generatedAt: new Date(now).toISOString(),
    count: mints.length, total: matched.length, truncated: matched.length > mints.length,
    mints: mints.map(m => withIncludes(m, filter.include)),
  }
}

/** scheme + host and the lower-cased path of a mint URL, for the case-insensitive fallback; null when unparseable. */
function pathKey(url: string): string | null {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.replace(/\/+$/, '').toLowerCase()}`
  } catch { return null }
}

/**
 * The mint for a requested (already normalised) URL: the exact match, else the ONE mint whose URL differs only in the
 * case of the path (canonicalUrl = its stored URL). Several candidates or none: null.
 */
export function findWalletMint(rows: KnownMintLike[], url: string): { mint: KnownMintLike; canonicalUrl: string | null } | null {
  const exact = rows.find(m => m.url === url)
  if (exact) return { mint: exact, canonicalUrl: null }
  const key = pathKey(url)
  if (key === null) return null
  const candidates = rows.filter(m => pathKey(m.url) === key)
  return candidates.length === 1 ? { mint: candidates[0] as KnownMintLike, canonicalUrl: (candidates[0] as KnownMintLike).url } : null
}

export function walletSingleEnvelope(snap: Snapshot, url: string): object | null {
  const found = findWalletMint(snap.data as KnownMintLike[], url)
  if (!found) return null
  return {
    methodology: METHODOLOGY_VERSION, generatedAt: new Date(snap.computedAt).toISOString(),
    mint: toMint(snap, found.mint),
    canonicalUrl: found.canonicalUrl,
  }
}

export interface RecommendQuery { unit: string; minScore: number; limit: number; requiredNuts: string[] }

/** GET /api/mints/recommend: the wallet list restricted to eligibleForRecommendation, in the 2026-10-10 shape. */
export function recommendEnvelope(snap: Snapshot, q: RecommendQuery): object {
  const rows = snap.data as KnownMintLike[]
  const latency = new Map(rows.map(r => [r.url, r.latencyMs ?? null]))
  const all = rows.map(m => toMint(snap, m))
  const picked = filterWalletMints(all, {
    unit: q.unit === '' ? undefined : q.unit.toLowerCase(),
    minScore: q.minScore,
    includeOffline: false, includeTest: false, includeArchived: false, includeUnscored: false, include: [],
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
      units: m.units,
    })),
    generatedAt: new Date(snap.computedAt).toISOString(),
    methodology: METHODOLOGY_VERSION,
  }
}

// ── Paths (CORS, rate limit) ──────────────────────────────────────────────────

const PUBLIC_CORS_EXACT = new Set(['/api/mints/recommend', '/health'])

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

/** Routes that answer any origin: the wallet API, /api/mints/recommend and /health. /api/mints/known is NOT one of them. */
export function isPublicCorsPath(path: string): boolean {
  const p = path.toLowerCase().replace(/\/+$/, '')
  return isWalletApiPath(p) || PUBLIC_CORS_EXACT.has(p)
}

// Deprecation, Sunset and Link let browser wallets read the deprecation notice of the recommend routes (deprecation.ts).
export const PUBLIC_CORS_EXPOSE_HEADERS = 'ETag, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Deprecation, Sunset, Link'

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

// A body built from a long-lived in-process data object (the /api/stats cache and the like): serialised and hashed
// once per object, so a cache hit costs no stringify or sha256. Weak keys: dropped together with the object.
const bodyByData = new WeakMap<object, CachedBody>()

export function cachedBodyOf(data: object): CachedBody {
  let body = bodyByData.get(data)
  if (!body) { body = buildCachedBody(data); bodyByData.set(data, body) }
  return body
}

/**
 * Cache-Control public, max-age=<maxAgeSec> (default 300) and a strong ETag on EVERY response; Express turns a
 * matching If-None-Match into 304. Only for responses every caller may share (no per-user data).
 */
export function sendCachedBody(res: Response, body: CachedBody, maxAgeSec = 300): void {
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSec}`)
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
