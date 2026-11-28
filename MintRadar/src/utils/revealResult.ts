// Tools (owner, 2026-11-28): after "Inspect token", and after a payment request is pasted, the page moves to the result,
// which on a phone (and often on a laptop) starts below the fold. It moves only when the result's top is not already in
// the upper part of the screen, and stops just under the sticky navbar. Smooth unless the visitor asked for reduced motion.

/** The upper share of the viewport where a result counts as already in view. */
export const REVEAL_IN_VIEW_SHARE = 0.55

/** Where to scroll so `top` (the element's top relative to the viewport) lands `gap` px under the navbar; null = stay. */
export function revealTarget(top: number, scrollY: number, viewportH: number, navH: number, gap = 12): number | null {
  if (top >= navH && top <= viewportH * REVEAL_IN_VIEW_SHARE) return null
  return Math.max(0, scrollY + top - navH - gap)
}

export function revealResult(el: Element | null): void {
  if (!el || typeof window === 'undefined') return
  const navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 50
  const target = revealTarget(el.getBoundingClientRect().top, window.scrollY, window.innerHeight, navH)
  if (target === null) return
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  try { window.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' }) } catch { /* no scrolling in this environment (tests) */ }
}
