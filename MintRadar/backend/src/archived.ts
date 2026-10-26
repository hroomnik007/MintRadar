// "Archived" mint: no successful probe for more than ARCHIVE_AFTER_MS and the latest probe is not online. ONE rule for
// the /api/mints/known snapshot (the `archived` flag the website and the wallet API show) and the sitemap (an archived
// mint's page is left out of it).
export const ARCHIVE_AFTER_MS = 30 * 86_400_000

export function isArchivedMint(
  lastOnlineAt: Date | string | null | undefined,
  latestOnline: boolean | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastOnlineAt || latestOnline === true) return false
  return now - new Date(lastOnlineAt).getTime() > ARCHIVE_AFTER_MS
}
