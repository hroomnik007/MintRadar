import type { KnownMint } from '@/hooks/useKnownMints'

// One definition of every mint count the UI shows. "Tracked" is every row the
// server knows (== /api/stats totalMints), archived and degraded included —
// the API is unfiltered and the UI says what the API says.

type CountableMint = Pick<KnownMint, 'online' | 'degraded' | 'archived'>
export type StatusFilter = 'all' | 'online' | 'offline'

export function trackedCount(mints: readonly CountableMint[]): number {
  return mints.length
}

export function onlineCount(mints: readonly CountableMint[]): number {
  return mints.filter(m => m.online === true).length
}

// Mints the pool drops until "Show" is pressed (24h+ offline, or archived).
export function isPoolHidden(m: CountableMint): boolean {
  return m.degraded === true || m.archived === true
}

// Mints the default view hides — the number behind "N mints hidden (offline
// 24h+)". Depends only on the Status radio, never on the reliability slider,
// Hide test mints or search, so user-chosen filters do not inflate it.
//   online  : every mint that is not online (degraded + archived + <24h offline)
//   all     : only what the pool strips (degraded + archived)
//   offline : nothing (the Offline filter already reveals them)
export function hiddenByDefaultCount(mints: readonly CountableMint[], status: StatusFilter): number {
  if (status === 'offline') return 0
  if (status === 'all') return mints.filter(isPoolHidden).length
  return mints.filter(m => m.online !== true).length
}
