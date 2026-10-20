import {
  uptimeComponent, nutComponent, versionComponent, contactComponent, applyNewMintCap, NEW_MINT_RELIABILITY_CAP,
  type AuditInput,
} from './shared/reliabilityScore.js'
import { auditComponent } from './shared/auditScore.js'
import type { LatestVersions } from './shared/versionRule.js'

// The per-component points behind a stored Reliability Score, for the wallet API (`scoreBreakdown`). Backend only:
// it calls the same component functions as computeReliabilityScore and adds nothing to the formula. prober.ts writes
// it into mints.score_breakdown in the SAME UPDATE as mints.last_reliability_score, with the same `now`, so what the
// API shows is exactly what the stored score used. It is never recomputed at read time.

export interface BreakdownPart { points: number; max: number }

export interface ScoreBreakdown {
  uptime: BreakdownPart
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

/** Same arguments as computeReliabilityScore; `score` is the value that function returns for them. */
export function computeScoreBreakdown(
  uptimePct: number,
  nutCount: number | null,
  version: string | null,
  contactCount: number,
  audit: AuditInput,
  latestVersions: LatestVersions | undefined,
  discoveredAt: string | null | undefined,
  now: number,
): ScoreBreakdown {
  const uptime = uptimeComponent(uptimePct)
  const auditPts = auditComponent(audit.blamed, audit.total, audit.fetchedAt, now)
  const nuts = nutComponent(nutCount)
  const versionPts = versionComponent(version, latestVersions)
  const contact = contactComponent(contactCount)
  const uncapped = Math.min(100, Math.round(uptime + nuts + versionPts + contact + auditPts))
  const sum = applyNewMintCap(uncapped, discoveredAt, now)
  return {
    uptime: { points: uptime, max: BREAKDOWN_MAX.uptime },
    audit: { points: auditPts, max: BREAKDOWN_MAX.audit },
    nuts: { points: nuts, max: BREAKDOWN_MAX.nuts },
    version: { points: versionPts, max: BREAKDOWN_MAX.version },
    contact: { points: contact, max: BREAKDOWN_MAX.contact },
    newMintCap: { points: sum - uncapped, cap: NEW_MINT_RELIABILITY_CAP },
    sum,
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
  return { uptime, audit, nuts, version, contact, newMintCap: { points: cap['points'], cap: NEW_MINT_RELIABILITY_CAP }, sum: sum as number }
}
