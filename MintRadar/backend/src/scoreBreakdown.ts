import {
  uptimeComponent, uptimeParts, nutComponent, versionComponent, contactComponent, applyNewMintCap, NEW_MINT_RELIABILITY_CAP,
  UPTIME_24H_MAX, UPTIME_30D_MAX, LONGEST_OUTAGE_MAX, OUTAGE_COUNT_MAX,
  type AuditInput, type UptimeInput,
} from './shared/reliabilityScore.js'
import { auditComponent } from './shared/auditScore.js'
import type { LatestVersions } from './shared/versionRule.js'

// The per-component points behind a stored Reliability Score, for the wallet API (`scoreBreakdown`). Backend only:
// it calls the same component functions as computeReliabilityScore and adds nothing to the formula. prober.ts writes
// it into mints.score_breakdown in the SAME UPDATE as mints.last_reliability_score, with the same `now`, so what the
// API shows is exactly what the stored score used. It is never recomputed at read time.

export interface BreakdownPart { points: number; max: number }

/** The four parts of the uptime component (methodology 7); their points add up to `uptime.points`. */
export interface UptimeBreakdownParts {
  last24h: BreakdownPart
  last30d: BreakdownPart
  longestOutage: BreakdownPart
  outageCount: BreakdownPart
}

export interface UptimeBreakdownInputs {
  uptime24hPct: number
  uptime30dPct: number
  /** The unrounded 30-day share the recommendation gate uses (two decimals, rounded down); absent in older rows. */
  uptime30dExactPct?: number
  outageCount30d: number
  longestOutage30dMs: number
  ongoingOutage: boolean
}

export interface ScoreBreakdown {
  uptime: BreakdownPart
  /** Absent in a breakdown stored before methodology 7 and when only the 24-hour percentage was known. */
  uptimeParts?: UptimeBreakdownParts
  /** The 30-day figures those parts were computed from, as stored at that probe (present together with uptimeParts). */
  uptimeInputs?: UptimeBreakdownInputs
  audit: BreakdownPart
  nuts: BreakdownPart
  version: BreakdownPart
  contact: BreakdownPart
  /** points: the correction (0 or negative) the 75-point cap for mints younger than 30 days applied; cap: that ceiling. */
  newMintCap: { points: number; cap: number }
  /** The stored score: min(100, round(sum of the five components)) + newMintCap.points. */
  sum: number
}

export const BREAKDOWN_MAX = { uptime: 40, audit: 25, nuts: 15, version: 15, contact: 5 } as const
export const UPTIME_PARTS_MAX = { last24h: UPTIME_24H_MAX, last30d: UPTIME_30D_MAX, longestOutage: LONGEST_OUTAGE_MAX, outageCount: OUTAGE_COUNT_MAX } as const

/** Same arguments as computeReliabilityScore; `score` is the value that function returns for them. */
export function computeScoreBreakdown(
  uptimeInput: number | UptimeInput,
  nutCount: number | null,
  version: string | null,
  contactCount: number,
  audit: AuditInput,
  latestVersions: LatestVersions | undefined,
  discoveredAt: string | null | undefined,
  now: number,
): ScoreBreakdown {
  const uptime = uptimeComponent(uptimeInput)
  const parts = typeof uptimeInput === 'number' ? null : uptimeParts(uptimeInput)
  const auditPts = auditComponent(audit.blamed, audit.total, audit.fetchedAt, now)
  const nuts = nutComponent(nutCount)
  const versionPts = versionComponent(version, latestVersions)
  const contact = contactComponent(contactCount)
  const uncapped = Math.min(100, Math.round(uptime + nuts + versionPts + contact + auditPts))
  const sum = applyNewMintCap(uncapped, discoveredAt, now)
  return {
    uptime: { points: uptime, max: BREAKDOWN_MAX.uptime },
    ...(parts ? { uptimeParts: {
      last24h: { points: parts.last24h, max: UPTIME_PARTS_MAX.last24h },
      last30d: { points: parts.last30d, max: UPTIME_PARTS_MAX.last30d },
      longestOutage: { points: parts.longestOutage, max: UPTIME_PARTS_MAX.longestOutage },
      outageCount: { points: parts.outageCount, max: UPTIME_PARTS_MAX.outageCount },
    }, uptimeInputs: inputsOf(uptimeInput as UptimeInput) } : {}),
    audit: { points: auditPts, max: BREAKDOWN_MAX.audit },
    nuts: { points: nuts, max: BREAKDOWN_MAX.nuts },
    version: { points: versionPts, max: BREAKDOWN_MAX.version },
    contact: { points: contact, max: BREAKDOWN_MAX.contact },
    newMintCap: { points: sum - uncapped, cap: NEW_MINT_RELIABILITY_CAP },
    sum,
  }
}

function inputsOf(u: UptimeInput): UptimeBreakdownInputs {
  return {
    uptime24hPct: u.pct24h, uptime30dPct: u.pct30d, uptime30dExactPct: u.pct30dExact ?? u.pct30d, outageCount30d: u.outageCount30d,
    longestOutage30dMs: u.longestOutageMs30d, ongoingOutage: u.ongoingOutage,
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function part(v: unknown, max: number): BreakdownPart | null {
  if (v === null || typeof v !== 'object') return null
  const p = (v as Record<string, unknown>)['points']
  return isNum(p) && p >= 0 && p <= max ? { points: p, max } : null
}

/** The stored jsonb as a ScoreBreakdown, or null when it is missing or not of that shape (never throws). */
export function readStoredBreakdown(raw: unknown): ScoreBreakdown | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const uptime = part(o['uptime'], BREAKDOWN_MAX.uptime)
  const audit = part(o['audit'], BREAKDOWN_MAX.audit)
  const nuts = part(o['nuts'], BREAKDOWN_MAX.nuts)
  const version = part(o['version'], BREAKDOWN_MAX.version)
  const contact = part(o['contact'], BREAKDOWN_MAX.contact)
  const cap = o['newMintCap'] as Record<string, unknown> | null
  const sum = o['sum']
  if (!uptime || !audit || !nuts || !version || !contact) return null
  if (cap === null || typeof cap !== 'object' || !isNum(cap['points']) || cap['points'] > 0 || !Number.isInteger(sum) || (sum as number) < 0 || (sum as number) > 100) return null
  const uptimeParts = readUptimeParts(o['uptimeParts'], uptime.points)
  const uptimeInputs = uptimeParts ? readUptimeInputs(o['uptimeInputs']) : null
  return { uptime, ...(uptimeParts && uptimeInputs ? { uptimeParts, uptimeInputs } : {}), audit, nuts, version, contact, newMintCap: { points: cap['points'], cap: NEW_MINT_RELIABILITY_CAP }, sum: sum as number }
}

/** The stored uptime parts, or null when they are missing, malformed or do not add up to the uptime points. */
function readUptimeParts(raw: unknown, uptimePoints: number): UptimeBreakdownParts | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const last24h = part(o['last24h'], UPTIME_PARTS_MAX.last24h)
  const last30d = part(o['last30d'], UPTIME_PARTS_MAX.last30d)
  const longestOutage = part(o['longestOutage'], UPTIME_PARTS_MAX.longestOutage)
  const outageCount = part(o['outageCount'], UPTIME_PARTS_MAX.outageCount)
  if (!last24h || !last30d || !longestOutage || !outageCount) return null
  if (last24h.points + last30d.points + longestOutage.points + outageCount.points !== uptimePoints) return null
  return { last24h, last30d, longestOutage, outageCount }
}

function readUptimeInputs(raw: unknown): UptimeBreakdownInputs | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const pct = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 100
  const count = (v: unknown): v is number => isNum(v) && v >= 0
  const { uptime24hPct, uptime30dPct, uptime30dExactPct, outageCount30d, longestOutage30dMs, ongoingOutage } = o
  if (!pct(uptime24hPct) || !pct(uptime30dPct) || !count(outageCount30d) || !count(longestOutage30dMs) || typeof ongoingOutage !== 'boolean') return null
  // Optional (stored since the unrounded gate); a malformed value is dropped, not the whole inputs object.
  const exact = pct(uptime30dExactPct) ? { uptime30dExactPct } : {}
  return { uptime24hPct, uptime30dPct, ...exact, outageCount30d, longestOutage30dMs, ongoingOutage }
}
