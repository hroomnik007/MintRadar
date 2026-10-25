// Phone Dashboard (2026-10-25): the default view opens with the first MOBILE_COLLAPSED_ONLINE online mints in the
// current sort order and a "Show all N" button under them, so the first screenfuls are the best mints instead of a
// 60-card scroll. Only the ONLINE mints are capped: mints revealed by the existing "N mints hidden (offline …) Show"
// toggle keep their place in the order and are never cut. A search, any non-default filter or Status other than the
// default "Online" shows every result (the visitor asked for something specific). Tablet and desktop never collapse.

export const MOBILE_COLLAPSED_ONLINE = 10
/** The phone breakpoint of the cut: the app's 640 px phone layout (useIsMobile's 768 px also covers portrait tablets). */
export const MOBILE_COLLAPSE_QUERY = '(max-width: 640px)'
/** Session key: an expanded list stays expanded on Back from a mint page (scroll restoration needs the same rows). */
export const MOBILE_EXPANDED_KEY = 'mintradar:dash-expanded'

export interface CollapseResult<T> {
  shown: T[]
  /** Online mints in the full result (the N of "Show all N"). */
  onlineTotal: number
  /** True when online mints were cut. */
  collapsed: boolean
}

export function collapseOnline<T extends { online?: boolean | null }>(sorted: readonly T[], limit: number | null): CollapseResult<T> {
  const onlineTotal = sorted.reduce((n, m) => n + (m.online === true ? 1 : 0), 0)
  if (limit === null || onlineTotal <= limit) return { shown: [...sorted], onlineTotal, collapsed: false }
  let seen = 0
  const shown = sorted.filter(m => {
    if (m.online !== true) return true
    seen += 1
    return seen <= limit
  })
  return { shown, onlineTotal, collapsed: true }
}

/** Whether the phone cut applies: default view only (no search, no non-default filter, Status "Online"). */
export function mobileCollapseApplies(opts: { isPhone: boolean; expanded: boolean; search: string; activeFilterCount: number; status: string }): boolean {
  return opts.isPhone && !opts.expanded && opts.search.trim() === '' && opts.activeFilterCount === 0 && opts.status === 'online'
}

/**
 * Whether an expanded phone list offers "Show less" (2026-10-25): exactly when the cut would apply again if the
 * expanded flag were cleared (phone, default view). A search or filter shows everything anyway, so no button there.
 */
export function showLessApplies(opts: { isPhone: boolean; expanded: boolean; search: string; activeFilterCount: number; status: string }): boolean {
  return opts.expanded && mobileCollapseApplies({ ...opts, expanded: false })
}

/**
 * The "Showing X of Y" line under the list. Uncollapsed (desktop, tablet, any search/filter, an expanded phone
 * list) it is unchanged: "Showing {shown} of {total}". While the phone cut is on, Y would be every tracked mint
 * (e.g. 62) right next to "Show all 50" (online), which reads as a contradiction, so it counts online mints only:
 * "Showing 10 of 50 online", plus " · N offline" when the hidden-mints toggle revealed non-online rows.
 */
export function showingNoteText<T extends { online?: boolean | null }>(shown: readonly T[], total: number, collapse: Pick<CollapseResult<T>, 'collapsed' | 'onlineTotal'>): string {
  if (!collapse.collapsed) return `Showing ${shown.length} of ${total}`
  const onlineShown = shown.reduce((n, m) => n + (m.online === true ? 1 : 0), 0)
  const others = shown.length - onlineShown
  return `Showing ${onlineShown} of ${collapse.onlineTotal} online${others > 0 ? ` · ${others} offline` : ''}`
}
