// Finds every badge / chip / pill / tag / notice text on the current page and measures its EFFECTIVE WCAG 2.x
// contrast (translucent backgrounds + opacity composited over the real backdrop, text alpha included).
// Also reports the matching CSS rules that set colour / background / border, and the border-vs-backdrop ratio.
import type { Page } from '@playwright/test'

export interface BadgeRecord {
  sel: string
  text: string
  fg: string
  bg: string
  ratio: number
  borderRatio: number | null
  fontPx: number
  weight: number
  state: string
  interactive: boolean
  gradient: boolean
  rules: { color: string[]; background: string[]; border: string[]; inline: string }
}

export interface ScanOptions {
  /** Also hover one instance per distinct selector and re-measure (interactive elements only). */
  hover?: boolean
  /** Restrict the scan to a subtree. */
  root?: string
}

const NAMEY = /badge|chip|pill|tag|notice|banner|alert|status|flag|stamp|toast|warn|caveat|outdated|new\b|tone/i

function scanInPage({ root, pick, only }: { root: string; pick: string | null; only: { sel: string; text: string } | null }) {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  type C = [number, number, number, number]
  type Rgb = [number, number, number]
  const parse = (css: string): C => {
    cv.globalCompositeOperation = 'copy'
    cv.fillStyle = '#000'; cv.fillStyle = css
    cv.fillRect(0, 0, 1, 1)
    const d = cv.getImageData(0, 0, 1, 1).data
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
  }
  const over = (t: C, b: Rgb): Rgb => [t[0] * t[3] + b[0] * (1 - t[3]), t[1] * t[3] + b[1] * (1 - t[3]), t[2] * t[3] + b[2] * (1 - t[3])]
  const mix = (a: Rgb, b: Rgb, o: number): Rgb => [a[0] * o + b[0] * (1 - o), a[1] * o + b[1] * (1 - o), a[2] * o + b[2] * (1 - o)]
  const lum = (c: Rgb) => {
    const k = c.map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * k[0]! + 0.7152 * k[1]! + 0.0722 * k[2]!
  }
  const ratio = (a: Rgb, b: Rgb) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05) }

  const effective = (node: Element, what: 'text' | 'border') => {
    const chain: Element[] = []
    for (let e: Element | null = node; e; e = e.parentElement) chain.unshift(e)
    let opacity = 1, split = chain.length
    chain.forEach((e, i) => { const o = Number(getComputedStyle(e).opacity); if (o < 1 && i < split) split = i; opacity *= o })
    let behind: Rgb = [255, 255, 255]
    for (let i = 0; i < split; i++) behind = over(parse(getComputedStyle(chain[i]!).backgroundColor), behind)
    let inside: Rgb = behind
    for (let i = split; i < chain.length; i++) inside = over(parse(getComputedStyle(chain[i]!).backgroundColor), inside)
    const o = split < chain.length ? opacity : 1
    const cs = getComputedStyle(node)
    let fgRaw: C
    let backdrop: Rgb
    if (what === 'border') {
      // Border sits over the element's PARENT backdrop (background-clip default is border-box, so over own bg too).
      fgRaw = parse(cs.borderTopWidth === '0px' || cs.borderTopStyle === 'none' ? 'rgba(0,0,0,0)' : cs.borderTopColor)
      backdrop = inside
    } else { fgRaw = parse(cs.color); backdrop = inside }
    const fg = mix(over(fgRaw, backdrop), behind, o)
    const bg = mix(backdrop, behind, o)
    return { fg, bg, ratio: ratio(fg, bg), hasFg: fgRaw[3] > 0 }
  }

  const ruleTexts = (el: Element) => {
    const out: { color: string[]; background: string[]; border: string[] } = { color: [], background: [], border: [] }
    const visit = (rules: CSSRuleList) => {
      for (const r of Array.from(rules)) {
        if ('cssRules' in r && !(r instanceof CSSStyleRule)) {
          if (r instanceof CSSMediaRule && !matchMedia(r.conditionText).matches) continue
          if (r instanceof CSSSupportsRule || r instanceof CSSMediaRule || r instanceof CSSLayerBlockRule) visit(r.cssRules)
          continue
        }
        if (!(r instanceof CSSStyleRule)) continue
        let hit = false
        try { hit = el.matches(r.selectorText) } catch { hit = false }
        if (!hit) continue
        const st = r.style
        const tag = `${r.selectorText} {`
        if (st.getPropertyValue('color')) out.color.push(`${tag} color: ${st.getPropertyValue('color')} }`)
        const bgv = st.getPropertyValue('background') || st.getPropertyValue('background-color')
        if (bgv) out.background.push(`${tag} background: ${bgv} }`)
        const bv = st.getPropertyValue('border') || st.getPropertyValue('border-color')
        if (bv) out.border.push(`${tag} border: ${bv} }`)
      }
    }
    for (const sh of Array.from(document.styleSheets)) { try { visit(sh.cssRules) } catch { /* cross-origin */ } }
    return out
  }

  const selOf = (e: Element) => {
    const cls = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).filter(Boolean)
    return e.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '')
  }
  const NAMEY = new RegExp(pick ?? '', 'i')

  const rootEl = document.querySelector(root) ?? document.body
  const all = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))]
  const out: unknown[] = []
  for (const el of all) {
    if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'HTML', 'BODY'].includes(el.tagName.toUpperCase())) continue
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent!.trim()).join(' ').trim()
    if (!own || own.length > 60) continue
    if (only && (selOf(el) !== only.sel || !own.startsWith(only.text))) continue
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none') continue
    // Badge-like: named by class on itself / up to 3 ancestors, or pill-shaped (own bg or border + radius, small type).
    const fontPx = parseFloat(cs.fontSize)
    const bgA = parse(cs.backgroundColor)[3]
    const hasBox = (bgA > 0 || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none')) && parseFloat(cs.borderTopLeftRadius) > 0
    let named = false
    for (let a: Element | null = el, i = 0; a && i < 4; a = a.parentElement, i++) {
      const c = typeof a.className === 'string' ? a.className : ''
      if (NAMEY.test(c) || (a.getAttribute('role') === 'alert') || a.getAttribute('role') === 'status') { named = true; break }
    }
    if (!(named || (hasBox && fontPx <= 14 && own.length <= 40))) continue
    // MintFavicon initials tile (1-2 letters in a classless / *avatar* div) is an avatar placeholder, not a badge.
    if (el.tagName === 'DIV' && own.length <= 2 && (!el.getAttribute('class') || /avatar/.test(el.getAttribute('class')!))) continue
    const e = effective(el, 'text')
    const bd = hasBox && parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' ? effective(el, 'border') : null
    const rules = ruleTexts(el)
    const interactive = el.matches('button,a,[role=button],[tabindex],input,select,label') || !!el.closest('button,a,[role=button]')
    out.push({
      sel: selOf(el), text: own.slice(0, 40),
      fg: e.fg.map(Math.round).join(','), bg: e.bg.map(Math.round).join(','),
      ratio: e.ratio, borderRatio: bd ? bd.ratio : null,
      fontPx, weight: Number(cs.fontWeight), interactive,
      gradient: cs.backgroundImage !== 'none',
      rules: { ...rules, inline: (el as HTMLElement).getAttribute('style') ?? '' },
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
    })
  }
  return out
}

export async function scanBadges(page: Page, state = 'default', opts: ScanOptions = {}): Promise<BadgeRecord[]> {
  const root = opts.root ?? 'body'
  const recs = (await page.evaluate(scanInPage, { root, pick: NAMEY.source, only: null })) as (BadgeRecord & { disabled?: boolean })[]
  for (const r of recs) r.state = r.disabled ? `${state}+disabled` : state
  if (opts.hover) {
    const seen = new Set<string>()
    for (const r of recs.filter(x => x.interactive)) {
      if (seen.has(r.sel)) continue
      seen.add(r.sel)
      const loc = page.locator(r.sel.replace(/[^\w.\-]/g, '')).filter({ hasText: r.text.slice(0, 20) }).first()
      try {
        await loc.hover({ timeout: 1500 })
        const again = (await page.evaluate(scanInPage, { root, pick: NAMEY.source, only: { sel: r.sel, text: r.text } })) as BadgeRecord[]
        const mine = again.find(a => a.sel === r.sel && a.text === r.text)
        if (mine) recs.push({ ...mine, state: `${state}+hover` })
      } catch { /* not hoverable (covered/off-screen) */ }
    }
  }
  return recs
}
