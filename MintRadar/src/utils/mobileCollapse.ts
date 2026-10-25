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
