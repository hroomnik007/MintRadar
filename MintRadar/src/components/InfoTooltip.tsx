import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info, AlertTriangle } from 'lucide-react'
import { computeTooltipPosition } from '@/utils/tooltipPosition'
import { tooltipManager } from '@/utils/tooltipManager'
import './InfoTooltip.css'

// THE tooltip of the app: every explanation behind an ⓘ icon, a badge or a chip uses this component (never a
// title attribute for an explanation, never a bespoke popup).
//
// Contract
//   Trigger   a real <button type="button"> carrying data-tooltip-trigger. Icon mode (no children): the ⓘ / ⚠,
//             named by `label`, or "More information about {about}", or "More information". Chip mode (children):
//             the children are the visible text of the badge / chip and name the button themselves.
//             While open the button has aria-describedby → the tooltip's id; the tooltip is role="tooltip" and
//             exists in the DOM only while open.
//   Open      mouse: hover opens after ~100 ms, leaving closes; keyboard: focus-visible opens, blur closes,
//             Enter / Space toggle; touch: a tap opens, a second tap on the trigger closes, a tap anywhere else
//             closes. Escape closes ONLY the tooltip (stopped before any dialog sees it; focus stays on the
//             trigger). One tooltip at a time (tooltipManager, whose document listeners exist only while one is open).
//   Place     computeTooltipPosition(): above, else below, clamped inside the visual viewport (8 px), a 6 px gap,
//             re-placed on resize / orientation change / scroll. Rendered in a portal: the nearest enclosing
//             [role="dialog"] when the trigger sits in one (above the dialog and inside its focus handling),
//             document.body otherwise.
//   Hit area  the visible icon stays small; padding with a compensating negative margin makes the button at
//             least 24 x 24 px without moving the layout. Hosts that have a neighbouring control right next to the
//             icon shrink a side through --tt-hit-t/r/b/l (see InfoTooltip.css).
//   Hosts     a click never reaches the host (stopPropagation + preventDefault): a card, a stretched link, a
//             label, a summary or a dialog backdrop is not activated by it.

const HOVER_DELAY_MS = 100

export function InfoTooltip({
  text,
  width = 220,
  iconSize = 12,
  className,
  tone = 'info',
  label,
  about,
  children,
  style,
}: {
  text: string
  /** Width of the tooltip box in px (clamped to the viewport; never above 320). */
  width?: number
  iconSize?: number
  className?: string
  // 'warn' swaps the ⓘ for a quiet amber ⚠ — used for soft advisory signals
  // (e.g. the recent-review-surge flag) that shouldn't read as neutral help.
  tone?: 'info' | 'warn'
  /** Full accessible name of an icon trigger. */
  label?: string
  /** The visible label next to the icon; the name becomes "More information about {about}". */
  about?: string
  /** Chip mode: the visible chip / badge / value text that becomes the trigger (instead of the ⓘ icon). */
  children?: ReactNode
  /** Extra inline style for the trigger (custom properties such as --tt-ml). */
  style?: CSSProperties
  /** @deprecated Keyboard focus always opens the tooltip now; kept so existing call sites keep compiling. */
  openOnFocus?: boolean
}) {
  const rawId = useId()
  const tipId = `tt-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const timer = useRef(0)
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current !== 0) { window.clearTimeout(timer.current); timer.current = 0 }
  }, [])

  const show = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    setTarget((trigger.closest('[role="dialog"]') as HTMLElement | null) ?? document.body)
    setOpen(true)
  }, [])
  const hide = useCallback(() => { clearTimer(); setOpen(false) }, [clearTimer])

  // Place the box: one rectangle read per placement. The tooltip is laid out at left/top 0 first; where that
  // lands is the origin of its containing block (the viewport, or the dialog's overlay when that has a
  // backdrop-filter), which the final left/top are corrected by.
  const place = useCallback(() => {
    const trigger = triggerRef.current
    const tip = tipRef.current
    if (!trigger || !tip) return
    tip.style.left = '0px'
    tip.style.top = '0px'
    tip.style.maxHeight = ''
    tip.style.overflowY = ''
    const origin = tip.getBoundingClientRect()
    const size = { width: tip.offsetWidth, height: tip.offsetHeight }
    const rect = trigger.getBoundingClientRect()
    const vv = window.visualViewport
    const viewport = vv
      ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height }
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    const gone = rect.bottom < viewport.top || rect.top > viewport.top + viewport.height || rect.right < viewport.left || rect.left > viewport.left + viewport.width
    if (gone) { setOpen(false); return }
    const pos = computeTooltipPosition({ trigger: rect, size, viewport })
    if (pos.width < size.width) tip.style.width = `${pos.width}px`
    tip.style.left = `${pos.x - origin.left}px`
    tip.style.top = `${pos.y - origin.top}px`
    if (pos.maxHeight !== null) {
      tip.style.maxHeight = `${pos.maxHeight}px`
      tip.style.overflowY = 'auto'
    }
    tip.style.visibility = 'visible'
  }, [])

  useLayoutEffect(() => {
    if (open && target) place()
  }, [open, target, text, width, place])

  useEffect(() => {
    if (!open) return
    tooltipManager.open({
      id: tipId,
      close: () => setOpen(false),
      reposition: place,
      contains: node => !!(triggerRef.current?.contains(node) || tipRef.current?.contains(node)),
    })
    return () => tooltipManager.close(tipId)
  }, [open, tipId, place])

  useEffect(() => clearTimer, [clearTimer])

  const Icon = tone === 'warn' ? AlertTriangle : Info
  const chip = children !== undefined && children !== null
  const name = label ?? (chip ? undefined : about ? `More information about ${about}` : 'More information')
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`info-tooltip${chip ? ' info-tooltip--chip' : ''}${className ? ` ${className}` : ''}`}
        style={style}
        data-tooltip-trigger=""
        aria-label={name}
        aria-describedby={open ? tipId : undefined}
        onPointerEnter={e => {
          if (e.pointerType !== 'mouse') return
          clearTimer()
          timer.current = window.setTimeout(() => { timer.current = 0; show() }, HOVER_DELAY_MS)
        }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') hide() }}
        onFocus={e => { if (e.currentTarget.matches(':focus-visible')) show() }}
        onBlur={hide}
        onClick={e => {
          e.stopPropagation()
          e.preventDefault()
          clearTimer()
          if (open) setOpen(false)
          else show()
        }}
      >
        {chip ? children : (
          <Icon
            size={iconSize}
            color={tone === 'warn' ? 'var(--amber)' : '#6b7280'}
            style={{ flexShrink: 0, cursor: 'help', display: 'block' }}
          />
        )}
      </button>
      {open && target && createPortal(
        <span
          ref={tipRef}
          id={tipId}
          className="info-tooltip-pop"
          role="tooltip"
          style={{ width, visibility: 'hidden' }}
        >
          {text}
        </span>,
        target,
      )}
    </>
  )
}
