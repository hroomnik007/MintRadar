// The ONE status rule for a mint (2026-10-27). The wallet API `status`, the Nostr health assertion `mint_status`,
// the link preview and every status word on the website derive from it, so the site and the API cannot disagree
// about the same snapshot (lnpay was `degraded` in the API but "Offline" on its Mint detail page).
// Order: archived first, then degraded, then the latest probe. The flags come from GET /api/mints/known:
//   - archived: the last successful probe is more than 30 days old and the latest probe failed;
//   - degraded: the latest probe failed and either at least 4 probes in the last 24 hours all failed, or that
//     failed probe is more than 24 hours old (backend/src/degraded.ts, computeDegraded);
//   - online: the latest probe succeeded. Anything else (failed, or never probed) is offline.
// The frontend copy (src/utils/mintStatus.ts) has the same code; src/__tests__/sharedModules.test.ts pins both.
export type MintStatus = 'online' | 'offline' | 'degraded' | 'archived'

export interface MintStatusFlags {
  online?: boolean | null | undefined
  degraded?: boolean | null | undefined
  archived?: boolean | null | undefined
}

export function mintStatus(m: MintStatusFlags): MintStatus {
  if (m.archived === true) return 'archived'
  if (m.degraded === true) return 'degraded'
  return m.online === true ? 'online' : 'offline'
}
