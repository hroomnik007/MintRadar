// Effective-colour contrast measurement for e2e: reads getComputedStyle in the page, composites every
// ancestor background and the accumulated opacity over the page background, and returns WCAG 2.x ratios.
import type { Locator } from '@playwright/test'

export interface Measured {
  fg: [number, number, number]
  bg: [number, number, number]
  opacity: number // product of opacity along the ancestor chain, element included
  ratio: number
}

type Rgb = [number, number, number]
export const luminance = ([r, g, b]: Rgb) => {
  const c = [r, g, b].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
export const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/**
 * Runs inside the page. `mode`: 'text' = element's own `color` is the foreground; 'bg' = the element's own
 * background colour is the foreground (status dot, icon tiles) measured against what is behind it.
 */
export function measureEffective(el: Locator, mode: 'text' | 'bg' = 'text'): Promise<Measured> {
  return el.evaluate((node, m) => {
    type C = [number, number, number, number]
    const canvas = document.createElement('canvas').getContext('2d')!
    const parse = (css: string): C => {
      // Normalise any CSS colour (rgb, color(srgb …), color-mix result) to 8-bit rgba via a 1px canvas.
      canvas.clearRect(0, 0, 1, 1)
      canvas.fillStyle = '#000'; canvas.fillStyle = css
      canvas.globalCompositeOperation = 'copy'; canvas.fillRect(0, 0, 1, 1)
      const d = canvas.getImageData(0, 0, 1, 1).data
      return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
    }
    const over = (top: C, below: [number, number, number]): [number, number, number] => [
      top[0] * top[3] + below[0] * (1 - top[3]),
      top[1] * top[3] + below[1] * (1 - top[3]),
      top[2] * top[3] + below[2] * (1 - top[3]),
    ]
    const chain: Element[] = []
    for (let e: Element | null = node; e; e = e.parentElement) chain.unshift(e)
    // Group opacity applies to the whole subtree of the element carrying it; backgrounds above the
    // outermost opacity<1 ancestor are "behind", the rest are "inside".
    let opacity = 1
    let split = chain.length
    chain.forEach((e, i) => {
      const o = Number(getComputedStyle(e).opacity)
      if (o < 1 && i < split) split = i
      opacity *= o
    })
    let behind: [number, number, number] = [255, 255, 255]
    for (let i = 0; i < chain.length; i++) {
      const bgc = parse(getComputedStyle(chain[i]!).backgroundColor)
      const isSelfBg = m === 'bg' && chain[i] === node
      if (i < split && !isSelfBg) behind = over(bgc, behind)
    }
    let inside: [number, number, number] = behind
    for (let i = split; i < chain.length; i++) {
      if (m === 'bg' && chain[i] === node) continue
      inside = over(parse(getComputedStyle(chain[i]!).backgroundColor), inside)
    }
    const cs = getComputedStyle(node as Element)
    const fgRaw = parse(m === 'bg' ? cs.backgroundColor : cs.color)
    const fgInside = over(fgRaw, inside)
    const mix = (a: [number, number, number], b: [number, number, number], o: number): [number, number, number] =>
      [a[0] * o + b[0] * (1 - o), a[1] * o + b[1] * (1 - o), a[2] * o + b[2] * (1 - o)]
    const o = split < chain.length ? opacity : 1
    const fg = mix(fgInside, behind, o)
    const bg = mix(inside, behind, o)
    const lum = (c: [number, number, number]) => {
      const k = c.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
      return 0.2126 * k[0]! + 0.7152 * k[1]! + 0.0722 * k[2]!
    }
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    return { fg, bg, opacity, ratio: (hi! + 0.05) / (lo! + 0.05) }
  }, mode)
}
