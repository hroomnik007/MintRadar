import { useSyncExternalStore } from 'react'

// Matches the app's standard mobile breakpoint (768px, same as Mint Detail's
// mobile header and Dashboard's responsive rules).
const QUERY = '(max-width: 768px)'

function subscribe(query: string, listener: () => void): () => void {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', listener)
  return () => mql.removeEventListener('change', listener)
}

function getSnapshot(query: string): boolean {
  return window.matchMedia(query).matches
}

/** True while `query` matches. Safe to read during render. Use this instead of
 * useIsMobile() when a component needs a different breakpoint than the app's
 * standard 768px (e.g. a panel that only condenses at 700px). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    listener => subscribe(query, listener),
    () => getSnapshot(query),
  )
}

/** True when the viewport is at or below the mobile breakpoint. Safe to read during render. */
export function useIsMobile(): boolean {
  return useMediaQuery(QUERY)
}
