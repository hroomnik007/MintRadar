// Pure formatting helpers used across Dashboard and MintDetail.
// All functions are side-effect free and accept an optional `now` timestamp
// for deterministic testing.

// ── Mint age badge ─────────────────────────────────────────────
// Thresholds: < 1 month → Fresh, < 6 months → Established,
//             < 12 months → Veteran, ≥ 12 months → OG
export interface AgeBadge {
  label: 'Fresh' | 'Established' | 'Veteran' | 'OG'
  color: string
  bg: string
  border: string
}

export function mintAgeBadge(
  discoveredAt: string | null | undefined,
  now: number = Date.now()
): AgeBadge | null {
  if (!discoveredAt) return null
  const months = (now - new Date(discoveredAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  if (months < 1)  return { label: 'Fresh',       color: '#d3a446', bg: 'rgba(211,164,70,.14)',  border: 'rgba(211,164,70,.3)'  }
  if (months < 6)  return { label: 'Established', color: '#5cc9a3', bg: 'rgba(69,173,140,.14)',  border: 'rgba(69,173,140,.28)'  }
  if (months < 12) return { label: 'Veteran',     color: '#ffa500', bg: 'rgba(255,165,0,0.1)',   border: 'rgba(255,165,0,0.25)'   }
  return              { label: 'OG',          color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.25)' }
}

// ── Trust score (MintDetail gauge/badge) ───────────────────────
// trustScoreColor: raw colour for the score number
export function trustScoreColor(score: number): string {
  if (score >= 75) return '#4ade80'
  if (score >= 50) return '#ffa500'
  return '#ff4d4d'
}

export interface TrustScoreInfo {
  label: 'High Trust' | 'Moderate Trust' | 'Low Trust'
  color: string
  bg: string
  border: string
}

// trustScoreInfo: full badge object for the MintDetail panel
export function trustScoreInfo(score: number): TrustScoreInfo {
  if (score >= 70) return { label: 'High Trust',     color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.25)'  }
  if (score >= 40) return { label: 'Moderate Trust', color: '#ffa500', bg: 'rgba(255,165,0,0.1)',   border: 'rgba(255,165,0,0.25)'   }
  return                  { label: 'Low Trust',      color: '#ff4d4d', bg: 'rgba(255,77,77,0.1)',   border: 'rgba(255,77,77,0.25)'   }
}

// trustColor: used in Dashboard list view (same thresholds as trustScoreInfo)
export function trustColor(score: number): string {
  if (score >= 70) return '#4ade80'
  if (score >= 40) return '#ffa500'
  return '#ff4d4d'
}

// ── Latency colour (Dashboard card + list) ─────────────────────
// null / 0 / negative → muted; < 500 ms → fast; < 2000 ms → medium; ≥ 2000 ms → slow
export function latencyColor(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return 'var(--t3)'
  if (ms < 500)  return 'var(--fast)'
  if (ms < 2000) return 'var(--med)'
  return 'var(--slow)'
}
