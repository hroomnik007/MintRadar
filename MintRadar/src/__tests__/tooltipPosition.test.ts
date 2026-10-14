import { describe, it, expect } from 'vitest'
import { computeTooltipPosition, type RectLike, type TooltipPositionInput } from '@/utils/tooltipPosition'

const VP = { left: 0, top: 0, width: 320, height: 640 }
const rect = (left: number, top: number, w = 24, h = 24): RectLike => ({ left, top, right: left + w, bottom: top + h })
const place = (over: Partial<TooltipPositionInput> & { trigger: RectLike }) =>
  computeTooltipPosition({ size: { width: 200, height: 60 }, viewport: VP, ...over })

/** The box [x, x+width] x [y, y+h] must lie inside the viewport with the margin, and keep the gap to the trigger. */
function expectInside(p: ReturnType<typeof computeTooltipPosition>, h: number, vp = VP, margin = 8) {
  const boxH = p.maxHeight ?? h
  expect(p.x).toBeGreaterThanOrEqual(vp.left + margin)
  expect(p.x + p.width).toBeLessThanOrEqual(vp.left + vp.width - margin)
  expect(p.y).toBeGreaterThanOrEqual(vp.top + margin)
  expect(p.y + boxH).toBeLessThanOrEqual(vp.top + vp.height - margin)
}

describe('computeTooltipPosition', () => {
  it('goes above the trigger, centred, with the gap', () => {
    const p = place({ trigger: rect(148, 300) })
    expect(p.side).toBe('top')
    expect(p.maxHeight).toBeNull()
    expect(p.x).toBe(160 - 100) // trigger centre 160, width 200
    expect(p.y).toBe(300 - 6 - 60)
    expect(p.fallback).toBe(false)
  })

  it('goes below when there is no room above', () => {
    const p = place({ trigger: rect(148, 20) })
    expect(p.side).toBe('bottom')
    expect(p.y).toBe(20 + 24 + 6)
    expectInside(p, 60)
  })

  it('goes above when there is no room below', () => {
    const p = place({ trigger: rect(148, 600) })
    expect(p.side).toBe('top')
    expectInside(p, 60)
  })

  it('honours a preferred side of bottom when it fits, falls back to top when it does not', () => {
    expect(place({ trigger: rect(148, 300), preferred: 'bottom' }).side).toBe('bottom')
    expect(place({ trigger: rect(148, 600), preferred: 'bottom' }).side).toBe('top')
  })

  it('clamps horizontally at the four corners (trigger at the very left and right edge at 320 px)', () => {
    for (const [l, t] of [[0, 0], [296, 0], [0, 616], [296, 616]] as const) {
      const p = place({ trigger: rect(l, t) })
      expectInside(p, 60)
      if (l === 0) expect(p.x).toBe(8)
      else expect(p.x + p.width).toBe(312)
    }
  })

  it('shrinks a very wide tooltip to the viewport minus the margins', () => {
    const p = place({ trigger: rect(148, 300), size: { width: 900, height: 80 } })
    expect(p.width).toBe(304)
    expect(p.x).toBe(8)
  })

  it('cuts the box to the room of the roomier side when neither side fits the full height', () => {
    const vp = { left: 0, top: 0, width: 320, height: 300 }
    const p = computeTooltipPosition({ trigger: rect(148, 200), size: { width: 200, height: 400 }, viewport: vp })
    // room above: 200 - 6 - 8 = 186, room below: 292 - 230 = 62
    expect(p.side).toBe('top')
    expect(p.maxHeight).toBe(186)
    expect(p.y).toBe(200 - 6 - 186)
    expect(p.fallback).toBe(false)
    expectInside(p, 400, vp)
  })

  it('picks the bottom when it has more room', () => {
    const vp = { left: 0, top: 0, width: 320, height: 300 }
    const p = computeTooltipPosition({ trigger: rect(148, 60), size: { width: 200, height: 400 }, viewport: vp })
    expect(p.side).toBe('bottom')
    expect(p.maxHeight).toBe(300 - 8 - (60 + 24 + 6))
  })

  it('never overlaps the trigger when a side was used', () => {
    for (const top of [10, 60, 150, 300, 450, 600]) {
      const t = rect(100, top)
      const p = place({ trigger: t, size: { width: 220, height: 90 } })
      if (p.fallback) continue
      const bottom = p.y + (p.maxHeight ?? 90)
      if (p.side === 'top') expect(t.top - bottom).toBeGreaterThanOrEqual(6)
      else expect(p.y - t.bottom).toBeGreaterThanOrEqual(6)
    }
  })

  it('falls back to the top margin when the trigger is as big as the viewport', () => {
    const p = place({ trigger: { left: -10, top: -10, right: 330, bottom: 650 }, size: { width: 200, height: 120 } })
    expect(p.fallback).toBe(true)
    expect(p.y).toBe(8)
    expect(p.maxHeight).toBeNull()
    expectInside(p, 120)
  })

  it('falls back with a cut height when the tooltip is taller than the whole viewport', () => {
    const p = place({ trigger: { left: 0, top: 0, right: 320, bottom: 640 }, size: { width: 200, height: 900 } })
    expect(p.fallback).toBe(true)
    expect(p.maxHeight).toBe(624)
  })

  it('handles a trigger scrolled partly out of the viewport (scrolled containers)', () => {
    const above = place({ trigger: rect(148, -14) })
    expect(above.side).toBe('bottom')
    expectInside(above, 60)
    const below = place({ trigger: rect(148, 630) })
    expect(below.side).toBe('top')
    expectInside(below, 60)
    const farLeft = place({ trigger: rect(-60, 300) })
    expect(farLeft.x).toBe(8)
    const farRight = place({ trigger: rect(400, 300) })
    expect(farRight.x + farRight.width).toBe(312)
  })

  it('uses the visual viewport offsets (pinch zoom)', () => {
    const vp = { left: 100, top: 200, width: 180, height: 320 }
    const p = computeTooltipPosition({ trigger: rect(110, 260), size: { width: 160, height: 60 }, viewport: vp })
    expectInside(p, 60, vp)
    expect(p.x).toBe(108)
  })

  it('keeps every random placement inside the viewport', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let i = 0; i < 400; i++) {
      const vp = { left: Math.floor(rnd() * 40), top: Math.floor(rnd() * 40), width: 280 + Math.floor(rnd() * 400), height: 300 + Math.floor(rnd() * 500) }
      const l = vp.left - 40 + rnd() * (vp.width + 80), t = vp.top - 40 + rnd() * (vp.height + 80)
      const size = { width: 100 + Math.floor(rnd() * 500), height: 30 + Math.floor(rnd() * 500) }
      const p = computeTooltipPosition({ trigger: rect(l, t, 10 + rnd() * 30, 10 + rnd() * 30), size, viewport: vp })
      expectInside(p, size.height, vp)
      expect(p.width).toBeLessThanOrEqual(size.width)
    }
  })
})

describe('computeTooltipPosition: trigger outside the viewport', () => {
  it('keeps the box inside when the trigger has scrolled far out of view', () => {
    const farAbove = place({ trigger: rect(148, -300) })
    expect(farAbove.y).toBe(8)
    expectInside(farAbove, 60)
    const farBelow = place({ trigger: rect(148, 900) })
    expect(farBelow.y + 60).toBe(632)
    expectInside(farBelow, 60)
  })
})
