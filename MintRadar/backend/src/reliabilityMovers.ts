// Pure delta/threshold/ranking logic for GET /api/stats/reliability-movers, kept
// separate from the SQL query (index.ts) so it's unit-testable without a DB —
// same pattern as degraded.ts's computeDegraded().
//
// The SQL layer is responsible for resolving each mint's two score snapshots
// (latest, and the most recent one at-or-before the N-day cutoff — a
// point-in-time lookup, never an average); this module only turns already-
// resolved snapshots into deltas, applies the +/-3 threshold, and ranks them.

export const RELIABILITY_MOVER_THRESHOLD = 3
export const RELIABILITY_MOVER_TOP_N = 3

export interface MintScoreSnapshot {
  url: string
  name: string | null
  latestScore: number
  oldScore: number
}

export interface ReliabilityMover {
  url: string
  name: string | null
  delta: number
}

export interface ReliabilityMovers {
  risers: ReliabilityMover[]
  fallers: ReliabilityMover[]
}

export function computeReliabilityMovers(snapshots: MintScoreSnapshot[]): ReliabilityMovers {
  const deltas = snapshots.map(s => ({ url: s.url, name: s.name, delta: s.latestScore - s.oldScore }))

  const risers = deltas
    .filter(m => m.delta >= RELIABILITY_MOVER_THRESHOLD)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, RELIABILITY_MOVER_TOP_N)

  const fallers = deltas
    .filter(m => m.delta <= -RELIABILITY_MOVER_THRESHOLD)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, RELIABILITY_MOVER_TOP_N)

  return { risers, fallers }
}
