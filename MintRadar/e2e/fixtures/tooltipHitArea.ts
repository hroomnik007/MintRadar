import type { Page } from '@playwright/test'

// Hit-area report of every tooltip trigger on the page: its size and every neighbouring interactive element
// (link, button, input, role=button/link/tab) inside the same container whose box intersects the trigger's box. The button's own
// box IS the hit area (padding with a compensating negative margin; the ::before touch overlays of two hosts are
// not counted: they only exist under a coarse pointer and are part of the same button).

export interface HitRecord {
  name: string
  w: number
  h: number
  x: number
  y: number
  overlaps: { el: string; ow: number; oh: number }[]
}

export async function hitAreaReport(page: Page): Promise<HitRecord[]> {
  return page.evaluate(() => {
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
    const describe = (e: Element) => {
      const cls = (typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${(e.textContent ?? '').trim() ? ` "${(e.textContent ?? '').trim().slice(0, 24)}"` : ''}`
    }
    // Neighbouring controls only: links, buttons and form fields (not scrollable regions with a tabindex).
    const interactive = Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab]')).filter(visible)
    const inDialog = (e: Element) => e.closest('[role="dialog"]') !== null
    // "In the same container": the grandparent block of the trigger (its block parent's parent), so that a sticky
    // header or another panel that merely lies over the same pixels is not a neighbour.
    const containerOf = (t: Element) => t.parentElement?.closest('div, section, li, td, th, p, h1, h2, h3, h4, label, article')?.parentElement ?? document.body
    return Array.from(document.querySelectorAll('[data-tooltip-trigger]')).filter(visible).map(t => {
      const r = t.getBoundingClientRect()
      const box = containerOf(t)
      const overlaps = interactive
        // an element behind an open dialog is not a neighbour of a trigger inside it (and vice versa)
        .filter(o => o !== t && !o.contains(t) && !t.contains(o) && inDialog(o) === inDialog(t) && box.contains(o))
        .map(o => {
          const q = o.getBoundingClientRect()
          const ow = Math.min(r.right, q.right) - Math.max(r.left, q.left)
          const oh = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top)
          return { el: describe(o), ow: Math.round(ow * 10) / 10, oh: Math.round(oh * 10) / 10 }
        })
        .filter(o => o.ow > 0.5 && o.oh > 0.5)
      return { name: t.getAttribute('aria-label') ?? (t.textContent ?? '').trim().slice(0, 30), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, x: Math.round(r.left), y: Math.round(r.top), overlaps }
    })
  })
}
