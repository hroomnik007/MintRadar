import { useSyncExternalStore } from 'react'

// Matches the app's standard mobile breakpoint (768px, same as Mint Detail's
// mobile header and Dashboard's responsive rules).
const QUERY = '(max-width: 768px)'

function subscribe(listener: () => void): () => void {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', listener)
  return () => mql.removeEventListener('change', listener)
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches
}

/** True when the viewport is at or below the mobile breakpoint. Safe to read during render. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}
