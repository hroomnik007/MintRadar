// Helpers of the /for-wallets and /methodology "On this page" navigation (components/DocToc.tsx).

export interface HeadingTop { id: string; top: number }

/** The section the reader is in: the last heading whose top has passed `offset` (the sticky navbar + a gap).
 * Before the first heading the first section counts as current. `tops` are in document order. */
export function activeSectionId(tops: readonly HeadingTop[], offset: number): string | null {
  if (tops.length === 0) return null
  let current = tops[0]!.id
  for (const t of tops) {
    if (t.top - offset <= 1) current = t.id
    else break
  }
  return current
}

/** Smooth scrolling unless the reader asked the system for reduced motion. */
export function tocScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? 'auto' : 'smooth'
}
