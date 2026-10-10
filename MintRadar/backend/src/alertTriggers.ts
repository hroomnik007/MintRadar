import { classifyMintVersion } from './shared/versionRule.js'
import type { LatestVersions } from './shared/versionRule.js'

// Pure decisions for the "More alerts" DMs (mint/melt issues, version outdated, lost NUT-04/05).
// No DB or network access, so they are directly unit-testable; prober.ts wires them to
// nostrService.notifyAlert / resetAlert. 'unknown' = not enough data: neither send nor re-arm.
export type Condition = 'active' | 'clear' | 'unknown'

// audit_cz only gives a 7-day aggregate (swaps7d total + errorsBlamed), so "mint/melt issues" is the
// blamed share of those swaps. A tiny sample says nothing, and a stale aggregate is not current.
export const MINT_MELT_MIN_SWAPS = 10
export const MINT_MELT_BLAMED_RATIO = 0.5
export const AUDIT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

export function mintMeltCondition(
  total: number | null,
  blamed: number | null,
  fetchedAt: Date | string | null,
  now: Date = new Date(),
): Condition {
  if (total === null || blamed === null || fetchedAt === null) return 'unknown'
  if (now.getTime() - new Date(fetchedAt).getTime() > AUDIT_MAX_AGE_MS) return 'unknown'
  if (total < MINT_MELT_MIN_SWAPS) return 'unknown'
  return blamed / total >= MINT_MELT_BLAMED_RATIO ? 'active' : 'clear'
}

// "Outdated" is the shared rule in versionRule.ts (two or more minor versions behind the family's latest,
// with the release grace period already applied in `latestVersions`).
export function versionCondition(version: string | null, latestVersions: LatestVersions): Condition {
  if (!version) return 'unknown'
  const { label } = classifyMintVersion(version, latestVersions)
  return label === 'outdated' ? 'active' : 'clear'
}

const WATCHED_NUTS = ['4', '5'] as const

function supports(nuts: Record<string, unknown> | null, key: string): boolean {
  const entry = nuts?.[key]
  if (entry === null || entry === undefined || typeof entry !== 'object') return false
  return (entry as { disabled?: unknown }).disabled !== true
}

// Compares the nuts object stored before this probe with the one the mint just advertised.
// 'lost'  — NUT-04 or NUT-05 was supported before and no longer is (edge: fires once);
// 'restored' — both are supported again (re-arms); null — nothing to do.
export function nutLossTransition(
  previous: Record<string, unknown> | null,
  current: Record<string, unknown>,
): 'lost' | 'restored' | null {
  if (previous === null) return null
  if (WATCHED_NUTS.some(k => supports(previous, k) && !supports(current, k))) return 'lost'
  if (WATCHED_NUTS.every(k => supports(current, k))) return 'restored'
  return null
}
