import type { Page } from '@playwright/test'

// Extracts every tooltip text of the current page state: the text of each tooltip as shown after hovering its
// trigger, plus every visible `title` attribute (the explanatory ones that are not migrated stay titles).
// A trigger is any element the cursor turns into "help" on (the ⓘ icons and, after the migration, the
// component's buttons carry data-tooltip-trigger and the same cursor). The result is sorted so that two runs
// compare as multisets: before the migration a chip's text is its title, afterwards it is a popup.

const POPUP = '[role="tooltip"]'

export interface Extracted {
  /** Sorted texts: tooltip popups and visible title attributes. */
  texts: string[]
  /** How many triggers were hovered (cursor: help / data-tooltip-trigger). */
  triggers: number
}

export async function extractTooltipTexts(page: Page): Promise<Extracted> {
  await page.evaluate(() => {
    const w = window as unknown as { __ttAdded?: Element[]; __ttObs?: MutationObserver }
    if (w.__ttObs) return
    w.__ttAdded = []
    w.__ttObs = new MutationObserver(muts => {
      for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1) { w.__ttAdded!.push(n as Element); (n as Element).querySelectorAll('*').forEach(c => w.__ttAdded!.push(c)) } })
      if (w.__ttAdded!.length > 600) w.__ttAdded = w.__ttAdded!.slice(-300)
    })
    w.__ttObs.observe(document.body, { childList: true, subtree: true })
  })

  const count = await page.evaluate(() => {
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
    const cands: Element[] = []
    document.querySelectorAll('body *').forEach(e => {
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return
      if (e.hasAttribute('data-tooltip-trigger') || getComputedStyle(e).cursor === 'help') cands.push(e)
    })
    const outer = cands.filter(e => !cands.some(o => o !== e && o.contains(e)) && visible(e))
    outer.forEach((e, i) => e.setAttribute('data-tt-x', String(i)))
    return outer.length
  })

  const readPopup = (sel: string) => page.evaluate((sel: string) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
    const open = Array.from(document.querySelectorAll(sel)).filter(visible)
    // textContent, not innerText: the text itself, whatever text-transform the box inherits
    if (open.length > 0) return norm(open[open.length - 1]!.textContent ?? '')
    const added = ((window as unknown as { __ttAdded: Element[] }).__ttAdded).filter(e => e.isConnected && visible(e) && ['absolute', 'fixed'].includes(getComputedStyle(e).position) && norm(e.textContent ?? '').length > 0)
    return added.length ? norm(added[added.length - 1]!.textContent ?? '') : ''
  }, sel)

  const texts: string[] = []
  for (let i = 0; i < count; i++) {
    const loc = page.locator(`[data-tt-x="${i}"]`)
    await loc.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => undefined)
    await page.waitForTimeout(40)
    const box = await loc.boundingBox()
    if (!box) continue
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    // A trigger covered by something (a modal's overlay) cannot be hovered: open it with a dispatched click instead.
    const covered = await loc.evaluate((el, [x, y]) => { const t = document.elementFromPoint(x!, y!); return !t || !(t === el || el.contains(t)) }, [cx, cy])
    await page.evaluate(() => { (window as unknown as { __ttAdded: Element[] }).__ttAdded = [] })
    if (covered) await loc.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
    else await page.mouse.move(cx, cy)
    await page.waitForTimeout(260)
    const text = await readPopup(POPUP)
    if (text) texts.push(text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ISO>').replace(/\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC/g, '<DATE>'))
    if (covered) { await loc.evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))); await page.waitForTimeout(80) }
    await page.mouse.move(1, 1)
    await page.waitForTimeout(140)
  }

  const titles = await page.evaluate(() => {
    const visible = (e: Element) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
    return Array.from(document.querySelectorAll('[title]'))
      .filter(e => !e.closest('svg') && visible(e))
      .map(e => (e.getAttribute('title') ?? '').replace(/\s+/g, ' ').trim().replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ISO>').replace(/\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC/g, '<DATE>'))
      .filter(Boolean)
  })
  return { texts: [...texts, ...titles].sort(), triggers: count }
}
