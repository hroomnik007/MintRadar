// Where a tooltip goes: pure geometry, no DOM. The component (components/InfoTooltip.tsx) measures the trigger
// rectangle, the tooltip's own size and the (visual) viewport once, and places the box with this function.
//
// Rules: above the trigger by default, below when there is no room above; centred on the trigger and clamped
// so that the whole box stays inside the viewport with a margin; a gap to the trigger so it never covers it.
// When neither side has room for the full height the side with more room is used and the box is cut to that
// room (the caller makes it scroll). Only when there is practically no room on either side (a trigger as big
// as the viewport) the box is placed at the top margin and may overlap the trigger (`fallback`).

export type TooltipSide = 'top' | 'bottom'

export interface RectLike { left: number; top: number; right: number; bottom: number }

export interface TooltipPositionInput {
  /** The trigger's bounding rectangle in viewport coordinates. */
  trigger: RectLike
  /** The tooltip's natural size (as laid out with its width, before it is cut to a maxHeight). */
  size: { width: number; height: number }
  /** The visible area in the same coordinates (window.visualViewport: offsetLeft, offsetTop, width, height). */
  viewport: { left: number; top: number; width: number; height: number }
  preferred?: TooltipSide
  /** Distance to every viewport edge. */
  margin?: number
  /** Distance between the trigger and the tooltip. */
  gap?: number
}

export interface TooltipPosition {
  /** Left and top of the box in viewport coordinates. */
  x: number
  y: number
  /** The width the box has after clamping to the viewport (never above the width asked for). */
  width: number
  side: TooltipSide
  /** Set when the box is taller than the room on its side: the box is cut to this height and scrolls. */
  maxHeight: number | null
  /** True when there was no usable room on either side and the box may cover the trigger. */
  fallback: boolean
}

export const TOOLTIP_MARGIN = 8
export const TOOLTIP_GAP = 6
/** Below this much room (px) a side is not worth cutting the box to. */
const MIN_USABLE_HEIGHT = 40

export function computeTooltipPosition(input: TooltipPositionInput): TooltipPosition {
  const { trigger: t, size, viewport: vp } = input
  const margin = input.margin ?? TOOLTIP_MARGIN
  const gap = input.gap ?? TOOLTIP_GAP
  const preferred = input.preferred ?? 'top'

  const left = vp.left + margin
  const right = vp.left + vp.width - margin
  const top = vp.top + margin
  const bottom = vp.top + vp.height - margin

  const width = Math.max(0, Math.min(size.width, right - left))
  const cx = (t.left + t.right) / 2
  const x = Math.min(Math.max(cx - width / 2, left), right - width)

  const room = { top: t.top - gap - top, bottom: bottom - (t.bottom + gap) }
  const other: TooltipSide = preferred === 'top' ? 'bottom' : 'top'
  const side: TooltipSide = room[preferred] >= size.height ? preferred
    : room[other] >= size.height ? other
      : room.top >= room.bottom ? 'top' : 'bottom'

  // Never more than the viewport itself (a trigger scrolled out of view has "room" far beyond it).
  const space = Math.min(room[side], bottom - top)
  if (space < Math.min(size.height, MIN_USABLE_HEIGHT)) {
    const height = Math.min(size.height, bottom - top)
    return { x, y: top, width, side, maxHeight: height < size.height ? Math.max(0, Math.floor(height)) : null, fallback: true }
  }

  const cut = size.height > space
  const height = cut ? Math.floor(space) : size.height
  // A trigger scrolled out of the viewport must not drag the box out with it: keep it inside.
  const y = Math.min(Math.max(side === 'top' ? t.top - gap - height : t.bottom + gap, top), bottom - height)
  return {
    x,
    y,
    width,
    side,
    maxHeight: cut ? height : null,
    fallback: false,
  }
}
