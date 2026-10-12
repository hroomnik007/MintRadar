import { useEffect } from 'react'
import type { RefObject } from 'react'

// The two scroll helpers of the long static text pages (/methodology, /for-wallets). They behave like the
// private ones in pages/About.tsx, which stays as it is.

// Scrolls the element named by the URL hash into view and moves keyboard focus to it. The AppShell resets
// the scroll to the top on every pathname change from an effect that runs AFTER this page's effects, so the
// scroll waits one frame; it is repeated once the web fonts are in because they re-wrap the text above.
export function useHashScroll(hash: string): void {
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    let cancelled = false
    const go = (focus: boolean): void => {
      if (cancelled) return
      const el = document.getElementById(id)
      if (!el) return
      el.scrollIntoView({ block: 'start' })
      if (focus) el.focus({ preventScroll: true })
    }
    const raf = requestAnimationFrame(() => go(true))
    void document.fonts?.ready.then(() => go(false))
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [hash])
}

// The sticky navbar is 51px on desktop, 86px on phones and 117px at ~320px (its tabs wrap), so a fixed
// scroll-margin would leave headings under it: --about-scroll-offset follows the real navbar height + a gap.
export function useNavbarOffset(pageRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.navbar')
    const page = pageRef.current
    if (!nav || !page) return
    const apply = (): void => { page.style.setProperty('--about-scroll-offset', `${nav.offsetHeight + 16}px`) }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(apply)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [pageRef])
}
