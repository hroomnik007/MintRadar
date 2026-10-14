// One manager for every open tooltip. At most one tooltip is open at a time (opening another closes the first),
// and the document-level listeners that every open tooltip needs are registered ONCE, only while a tooltip is
// open, and removed the moment it closes:
//   - Escape (capture phase on window): closes only the tooltip and stops the key before any dialog, panel or
//     menu behind it sees it, so a second Escape closes the container as usual;
//   - pointerdown outside the open tooltip and its trigger (capture): closes it (a tap anywhere else);
//   - resize / orientationchange / visual viewport changes / scroll of any scroller (capture): re-places it.
// Nothing is registered while all tooltips are closed.

export interface ManagedTooltip {
  id: string
  close: () => void
  /** Re-measure and place the open tooltip (viewport or a scroller changed). */
  reposition: () => void
  /** True for the trigger and the tooltip element (a pointerdown there is not "outside"). */
  contains: (node: Node) => boolean
}

let active: ManagedTooltip | null = null
let registered = false
let frame = 0

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || active === null) return
  e.stopPropagation()
  active.close()
}

function onPointerDown(e: Event): void {
  if (active === null) return
  if (e.target instanceof Node && active.contains(e.target)) return
  active.close()
}

function schedule(): void {
  if (frame !== 0 || active === null) return
  frame = requestAnimationFrame(() => {
    frame = 0
    active?.reposition()
  })
}

function register(): void {
  if (registered) return
  registered = true
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  document.addEventListener('scroll', schedule, true)
  window.visualViewport?.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('scroll', schedule)
}

function unregister(): void {
  if (!registered) return
  registered = false
  window.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('resize', schedule)
  window.removeEventListener('orientationchange', schedule)
  document.removeEventListener('scroll', schedule, true)
  window.visualViewport?.removeEventListener('resize', schedule)
  window.visualViewport?.removeEventListener('scroll', schedule)
  if (frame !== 0) { cancelAnimationFrame(frame); frame = 0 }
}

export const tooltipManager = {
  /** Make `t` the open tooltip; the previously open one (if any) is closed. */
  open(t: ManagedTooltip): void {
    if (active !== null && active.id !== t.id) {
      const previous = active
      active = t
      previous.close()
    }
    active = t
    register()
  },
  /** `id` is no longer open. Removes the listeners when nothing is open any more. */
  close(id: string): void {
    if (active === null || active.id !== id) return
    active = null
    unregister()
  },
  activeId(): string | null {
    return active?.id ?? null
  },
  /** Number of listener registrations currently held (for tests): 0 while every tooltip is closed. */
  listening(): boolean {
    return registered
  },
}
