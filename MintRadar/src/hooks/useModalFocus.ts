import { useCallback } from 'react'

// Focus handling shared by every modal dialog: initial focus inside, Tab / Shift+Tab trap,
// and focus handed back to whatever opened the dialog when it closes. Escape, the outside
// click and the close button stay with each modal (they already exist there; an open
// tooltip swallows Escape first via useTapTooltip's capture listener).
//
//   const dialogRef = useModalFocus()          // or useModalFocus('input') to start in a field
//   {open && <div role="dialog" aria-modal="true" aria-labelledby="…" ref={dialogRef}>…</div>}
//
// While any dialog is open the page behind it does not scroll (reference-counted so stacked dialogs
// release it only when the last one closes; the scrollbar's width is kept as padding so the layout
// does not jump).
//
// A (React 19) callback ref, not an effect, so it works for dialogs that are rendered
// conditionally inside a big page component: it runs when the dialog element mounts and its
// returned cleanup runs when it unmounts. Without `initialFocus` the dialog container itself
// takes focus (it gets tabindex="-1", no focus ring), so the first Tab lands on the first control
// and a screen reader announces the dialog's name first.

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'
const open: HTMLElement[] = [] // mounted dialogs, last = topmost; only the topmost traps

let scrollLocks = 0
let savedScroll: { overflow: string; paddingRight: string } | null = null
function lockScroll() {
  if (scrollLocks++ > 0) return
  const de = document.documentElement
  const scrollbar = window.innerWidth - de.clientWidth
  savedScroll = { overflow: de.style.overflow, paddingRight: document.body.style.paddingRight }
  de.style.overflow = 'hidden'
  if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
}
function unlockScroll() {
  if (--scrollLocks > 0 || savedScroll === null) return
  document.documentElement.style.overflow = savedScroll.overflow
  document.body.style.paddingRight = savedScroll.paddingRight
  savedScroll = null
}

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
  )
}

export function useModalFocus(initialFocus?: string) {
  return useCallback((dialog: HTMLElement | null) => {
    if (!dialog) return
    const trigger = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const hadTabindex = dialog.hasAttribute('tabindex')
    if (!hadTabindex) dialog.tabIndex = -1
    const prevOutline = dialog.style.outline
    dialog.style.outline = 'none'
    open.push(dialog)
    lockScroll()
    ;((initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null) ?? dialog).focus({ preventScroll: true })

    const wrap = (to: 'first' | 'last') => {
      const items = tabbables(dialog)
      ;(items.length === 0 ? dialog : to === 'first' ? items[0]! : items[items.length - 1]!).focus({ preventScroll: true })
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || open[open.length - 1] !== dialog) return
      const active = document.activeElement
      const items = tabbables(dialog)
      if (active === dialog || !dialog.contains(active) || items.length === 0) {
        e.preventDefault()
        wrap(e.shiftKey ? 'last' : 'first')
      } else if (e.shiftKey && active === items[0]) {
        e.preventDefault()
        wrap('last')
      } else if (!e.shiftKey && active === items[items.length - 1]) {
        e.preventDefault()
        wrap('first')
      }
    }
    // Safety net for focus that escapes some other way (a control that is not in Tab order, the
    // browser UI handing focus back to the page).
    const onFocusIn = (e: FocusEvent) => {
      if (open[open.length - 1] === dialog && e.target instanceof Node && !dialog.contains(e.target)) wrap('first')
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      open.splice(open.indexOf(dialog), 1)
      unlockScroll()
      if (!hadTabindex) dialog.removeAttribute('tabindex')
      dialog.style.outline = prevOutline
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [initialFocus])
}
