import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * A tooltip that opens on desktop hover and toggles reliably on a single
 * tap/click, with an outside tap/click closing it.
 *
 * Hover is gated on `pointerType === 'mouse'` (React Pointer Events) instead
 * of onMouseEnter/onMouseLeave — touch taps synthesize mouse events too, so a
 * plain onMouseEnter (open) + onClick (toggle) combo on the same element
 * cancels itself out on the first tap and needs a second tap to actually
 * show anything. Ignoring non-mouse pointers for the hover handlers removes
 * that race entirely; the click handler is then the only thing touch ever
 * triggers.
 *
 * The trigger element's ref is a parameter (not part of the return value) —
 * the react-compiler ESLint rules treat any object that bundles a ref
 * together with other values as ref-tainted for every property access, not
 * just `.current`. Keeping `ref={yourRef}` a plain `useRef()` result at the
 * call site avoids that false positive.
 */
export function useTapTooltip<T extends HTMLElement = HTMLElement>(ref: RefObject<T | null>) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const handleOutside = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('click', handleOutside, true)
    document.addEventListener('touchstart', handleOutside, true)
    return () => {
      document.removeEventListener('click', handleOutside, true)
      document.removeEventListener('touchstart', handleOutside, true)
    }
  }, [open, ref])

  const onPointerEnter = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setOpen(true)
  }, [])
  const onPointerLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setOpen(false)
  }, [])
  // stopPropagation so tapping the info icon never bubbles into an ancestor's
  // own click handler (e.g. a modal's click-outside-to-close backdrop).
  const onClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }, [])

  return { open, onPointerEnter, onPointerLeave, onClick }
}
