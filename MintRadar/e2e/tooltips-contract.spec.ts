import { readFileSync } from 'node:fs'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { MOCK_STATS } from './fixtures/mocks'
import { TOOLTIP_STATES, VIEWPORTS, installTooltipMocks, type TooltipState } from './fixtures/tooltipStates'
import { extractTooltipTexts } from './fixtures/tooltipExtract'
import { hitAreaReport } from './fixtures/tooltipHitArea'

// The contract of the one tooltip component (src/components/InfoTooltip.tsx), checked on every page and state that
// carries tooltips, at the five viewports, with a mouse and with touch. One test per viewport.
//
// For every trigger (found by the component's marker): a focusable button with a non-empty accessible name, a hit
// area of at least 24 x 24 px that overlaps no neighbouring link or button. For every distinct trigger that can be
// reached: opening it (hover / tap) shows exactly one role="tooltip", wired with aria-describedby to an existing
// element, fully inside the viewport and not touching the trigger; Escape closes only the tooltip. Plus: keyboard
// (Tab, Enter, Space), second tap and tap outside close, Escape inside a dialog leaves the dialog open (a second
// Escape closes it), a trigger inside a Dashboard card does not navigate, a tooltip survives a refetch re-render
// of the Stats tiles, and (1440 and 390 px) every tooltip text equals the extraction made before the migration.

const BEFORE = JSON.parse(readFileSync(new URL('./fixtures/tooltip-texts.json', import.meta.url), 'utf8')) as Record<string, { texts: string[] }>
const MAX_OPENED_PER_STATE = 8
// Debugging aid: TT_STATES=home,stats runs only those states (and TT_TIMING=1 prints where the time goes).
const ONLY = process.env.TT_STATES?.split(',')
const dbg = (m: string) => { if (process.env.TT_TIMING) console.log(`  . ${new Date().toISOString().slice(14, 23)} ${m}`) }

type Pointer = 'mouse' | 'touch'
type Vp = { width: number; height: number }

async function newPage(browser: Browser, vp: Vp, pointer: Pointer): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: vp,
    hasTouch: pointer === 'touch',
    isMobile: pointer === 'touch' && vp.width <= 768,
    serviceWorkers: 'block',
  })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    const s = document.createElement('style')
    s.textContent = '*,*::before,*::after{animation-duration:0.001s !important;transition-duration:0.001s !important;scroll-behavior:auto !important}'
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s))
  })
  return page
}

test.use({ actionTimeout: 8000 }) // a locator that vanished fails instead of waiting for the whole test timeout

const tips = (page: Page) => page.locator('[role="tooltip"]')

interface Info { i: number; name: string; w: number; h: number; tag: string; type: string | null; tabbable: boolean; described: boolean }

/** Marks every visible trigger (data-tt-i) and reads what the contract says about it while closed. */
async function scanTriggers(page: Page): Promise<Info[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-tooltip-trigger]')).flatMap((el, i) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    if (!(r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none')) return []
    el.setAttribute('data-tt-i', String(i))
    const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim()
    return [{
      i, name, w: r.width, h: r.height, tag: el.tagName, type: el.getAttribute('type'),
      tabbable: (el as HTMLElement).tabIndex >= 0, described: el.hasAttribute('aria-describedby'),
    }]
  }))
}

/** Rectangles and wiring of the one open tooltip, relative to the visual viewport. */
async function openState(page: Page, i: number) {
  return page.evaluate((i: number) => {
    const trig = document.querySelector(`[data-tt-i="${i}"]`)!
    const tipsOpen = document.querySelectorAll('[role="tooltip"]')
    const tip = tipsOpen[0] as HTMLElement | undefined
    const vv = window.visualViewport
    const vw = vv?.width ?? window.innerWidth, vh = vv?.height ?? window.innerHeight
    const t = tip?.getBoundingClientRect()
    const r = trig.getBoundingClientRect()
    const id = trig.getAttribute('aria-describedby')
    return {
      count: tipsOpen.length,
      text: (tip?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      wired: !!id && !!document.getElementById(id) && document.getElementById(id) === tip,
      inside: !!t && t.left >= -0.01 && t.right <= vw + 0.01 && t.top >= -0.01 && t.bottom <= vh + 0.01,
      rect: t ? { l: Math.round(t.left), r: Math.round(t.right), t: Math.round(t.top), b: Math.round(t.bottom) } : null,
      touchesTrigger: !!t && t.left < r.right && t.right > r.left && t.top < r.bottom && t.bottom > r.top,
      vw, vh,
    }
  }, i)
}

/**
 * A point that is not on (or inside) anything interactive, for "tap outside". With a dialog open the point lies inside
 * the dialog (a tap on its backdrop would close the dialog, which is not what is being tested).
 */
async function safePoint(page: Page): Promise<{ x: number; y: number }> {
  const p = await page.evaluate(() => {
    const vv = window.visualViewport
    const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).pop() ?? null
    const area = dlg ? dlg.getBoundingClientRect() : { left: 0, top: 0, width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight }
    for (let gy = 1; gy <= 24; gy++) for (let gx = 1; gx <= 24; gx++) {
      const x = Math.round(area.left + (area.width * gx) / 25), y = Math.round(area.top + (area.height * gy) / 25)
      const el = document.elementFromPoint(x, y)
      if (el && (!dlg || dlg.contains(el)) && !el.closest('a, button, input, select, textarea, label, summary, [role="button"], [role="tooltip"], [tabindex]:not([tabindex="-1"])')) return { x, y }
    }
    return null
  })
  expect(p, 'a point without anything interactive').not.toBeNull()
  return p!
}

async function reachable(page: Page, i: number): Promise<{ x: number; y: number } | null> {
  const loc = page.locator(`[data-tt-i="${i}"]`)
  if ((await loc.count()) === 0) return null // re-rendered away since the scan
  await loc.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }))
  await page.waitForTimeout(40)
  const box = await loc.boundingBox()
  if (!box) return null
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  const hit = await loc.evaluate((el, [px, py]) => { const t = document.elementFromPoint(px!, py!); return !!t && (t === el || el.contains(t)) }, [x, y])
  return hit ? { x, y } : null
}

async function open(page: Page, pointer: Pointer, p: { x: number; y: number }) {
  if (pointer === 'touch') await page.touchscreen.tap(p.x, p.y)
  else await page.mouse.move(p.x, p.y)
  await expect(tips(page)).toHaveCount(1)
}

async function checkState(page: Page, state: TooltipState, vp: Vp, pointer: Pointer, notes: string[]) {
  const all = await scanTriggers(page)
  // --- every trigger: button, focusable, named, 24 x 24, no overlap, nothing described while closed
  for (const t of all) {
    const where = `${state.id} · "${t.name.slice(0, 40)}"`
    expect(t.tag, `${where}: a real button`).toBe('BUTTON')
    expect(t.type, `${where}: type=button`).toBe('button')
    expect(t.tabbable, `${where}: focusable`).toBe(true)
    expect(t.name.trim().length, `${where}: accessible name`).toBeGreaterThan(0)
    expect(t.described, `${where}: no aria-describedby while closed`).toBe(false)
    expect(t.w, `${where}: hit area width ${t.w}`).toBeGreaterThanOrEqual(23.99)
    expect(t.h, `${where}: hit area height ${t.h}`).toBeGreaterThanOrEqual(23.99)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  for (const h of await hitAreaReport(page)) expect(h.overlaps, `${state.id} · "${h.name.slice(0, 40)}": hit area overlaps a neighbouring control`).toEqual([])
  await expect(tips(page)).toHaveCount(0)

  dbg('open triggers')
  // --- open the distinct reachable triggers
  const seen = new Set<string>()
  let opened = 0
  let first: { i: number; p: { x: number; y: number } } | null = null
  for (const t of all) {
    if (opened >= MAX_OPENED_PER_STATE) break
    if (seen.has(t.name)) continue
    const p = await reachable(page, t.i)
    if (!p) continue
    seen.add(t.name)
    await open(page, pointer, p)
    const s = await openState(page, t.i)
    const where = `${state.id} · "${t.name.slice(0, 40)}" @${vp.width} ${pointer}`
    expect(s.count, `${where}: one tooltip open`).toBe(1)
    expect(s.wired, `${where}: aria-describedby points at the tooltip`).toBe(true)
    expect(s.inside, `${where}: tooltip inside the viewport ${JSON.stringify(s.rect)} of ${s.vw}x${s.vh}`).toBe(true)
    expect(s.touchesTrigger, `${where}: tooltip does not cover its trigger`).toBe(false)
    expect(s.text.length, `${where}: has text`).toBeGreaterThan(0)
    first ??= { i: t.i, p }
    await page.keyboard.press('Escape')
    await expect(tips(page)).toHaveCount(0)
    await expect(page.locator(`[data-tt-i="${t.i}"]`)).not.toHaveAttribute('aria-describedby', /./)
    if (pointer === 'mouse') await page.mouse.move(1, 1)
    opened++
  }
  if (opened === 0) notes.push(`${state.id}: no reachable trigger`)
  if (!first) return

  dbg('one at a time')
  // --- one at a time: opening a second tooltip closes the first
  if (opened >= 2) {
    const [a, b] = all.filter(t => seen.has(t.name)).slice(0, 2) as [Info, Info]
    const locA = page.locator(`[data-tt-i="${a.i}"]`), locB = page.locator(`[data-tt-i="${b.i}"]`)
    const pa = await reachable(page, a.i)
    if (pa) {
      if (pointer === 'touch') await open(page, pointer, pa)
      else { await page.keyboard.press('Tab'); await locA.focus(); await expect(tips(page)).toHaveCount(1) } // hovering A and moving to B would close A by leaving
      await expect(locA).toHaveAttribute('aria-describedby', /./)
      const pb = await reachable(page, b.i) // scrolls B into view: take its position only now
      if (pb) {
        await open(page, pointer, pb)
        await expect(tips(page), `${state.id}: only one tooltip is open`).toHaveCount(1)
        await expect(locB).toHaveAttribute('aria-describedby', /./)
        await expect(locA, `${state.id}: the first tooltip was closed`).not.toHaveAttribute('aria-describedby', /./)
      }
    }
    await page.keyboard.press('Escape')
    await expect(tips(page)).toHaveCount(0)
    await locA.blur()
    if (pointer === 'mouse') await page.mouse.move(1, 1)
  }

  dbg('touch taps')
  // --- touch: second tap closes, a tap anywhere else closes
  if (pointer === 'touch') {
    const p = await reachable(page, first.i)
    if (p) {
      await open(page, pointer, p)
      await page.touchscreen.tap(p.x, p.y)
      await expect(tips(page), `${state.id}: second tap closes`).toHaveCount(0)
      await open(page, pointer, p)
      const away = await safePoint(page)
      await page.touchscreen.tap(away.x, away.y)
      await expect(tips(page), `${state.id}: a tap outside closes`).toHaveCount(0)
    }
  }

  dbg('keyboard')
  // --- keyboard (mouse pages): focus-visible opens, Enter / Space toggle, Escape closes and focus stays
  if (pointer === 'mouse') {
    const loc = page.locator(`[data-tt-i="${first.i}"]`)
    await page.keyboard.press('Tab')
    await loc.focus()
    await expect(tips(page), `${state.id}: keyboard focus opens`).toHaveCount(1)
    const s = await openState(page, first.i)
    expect(s.wired, `${state.id}: focus-opened tooltip is wired`).toBe(true)
    expect(s.inside, `${state.id}: focus-opened tooltip inside the viewport`).toBe(true)
    await page.keyboard.press('Enter')
    await expect(tips(page), `${state.id}: Enter toggles it closed`).toHaveCount(0)
    await page.keyboard.press('Space')
    await expect(tips(page), `${state.id}: Space opens it`).toHaveCount(1)
    await page.keyboard.press('Space')
    await expect(tips(page)).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(tips(page)).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(tips(page)).toHaveCount(0)
    await expect(loc, `${state.id}: focus stays on the trigger after Escape`).toBeFocused()
    await loc.blur()
  }

  dbg('card')
  // --- a trigger inside a Dashboard card does not activate the card / its link
  const inCard = await page.locator('.mint-card [data-tooltip-trigger]').evaluateAll(els => els.map(e => Number(e.getAttribute('data-tt-i') ?? -1)))
  if (inCard.length > 0 && (await page.locator('[role="dialog"]').count()) === 0) {
    const before = page.url()
    for (const i of inCard.slice(0, 4)) {
      if (i < 0) continue
      const p = await reachable(page, i)
      if (!p) continue
      if (pointer === 'touch') await page.touchscreen.tap(p.x, p.y)
      else await page.mouse.click(p.x, p.y)
      await expect(tips(page), `${state.id}: card trigger opens its tooltip`).toHaveCount(1)
      expect(page.url(), `${state.id}: a card trigger must not navigate`).toBe(before)
      await page.keyboard.press('Escape')
      await expect(tips(page)).toHaveCount(0)
      if (pointer === 'mouse') await page.mouse.move(1, 1)
    }
  }

  dbg('dialog')
  // --- inside a dialog: Escape closes only the tooltip, the second Escape the dialog
  const dialog = page.locator('[role="dialog"]').last()
  if (await dialog.isVisible().catch(() => false)) {
    const inside = await dialog.locator('[data-tooltip-trigger]').evaluateAll(els => els.map(e => Number(e.getAttribute('data-tt-i') ?? -1)))
    for (const i of inside.slice(0, 1)) {
      if (i < 0) continue
      const p = await reachable(page, i)
      if (!p) continue
      await open(page, pointer, p)
      expect(await dialog.locator('[role="tooltip"]').count(), `${state.id}: the tooltip is rendered inside the dialog`).toBe(1)
      await page.keyboard.press('Escape')
      await expect(tips(page), `${state.id}: Escape closes the tooltip`).toHaveCount(0)
      await expect(dialog, `${state.id}: ... and leaves the dialog open`).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog, `${state.id}: a second Escape closes the dialog`).toHaveCount(0)
    }
  }
}

async function textsMatchBefore(page: Page, state: TooltipState, vp: Vp) {
  const key = `${state.id}@${vp.width}`
  const before = BEFORE[key]
  if (!before) return
  const { texts } = await extractTooltipTexts(page)
  expect(texts, `tooltip texts of ${key} equal the extraction made before the migration`).toEqual(before.texts)
}

async function survivesRefetch(browser: Browser, vp: Vp, pointer: Pointer) {
  const page = await newPage(browser, vp, pointer)
  let hits = 0
  await installTooltipMocks(page)
  await page.route('**/api/stats', r => { hits++; return r.fulfill({ json: { ...MOCK_STATS, avgReliabilityScore: 50 + hits } }) })
  await page.clock.install()
  await page.goto('/stats')
  await expect(page.locator('.nhi-gauge-wrap')).toBeVisible()
  const uptime = page.locator('.smc-label-info').filter({ hasText: 'average uptime' }).locator('[data-tooltip-trigger]')
  await uptime.scrollIntoViewIfNeeded()
  const box = (await uptime.boundingBox())!
  if (pointer === 'touch') await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  else await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.clock.runFor(200)
  await expect(tips(page)).toHaveCount(1)
  const text = await tips(page).textContent()
  const before = hits
  await page.clock.fastForward(130_000) // the Stats query refetches every 2 minutes
  await expect.poll(() => hits).toBeGreaterThan(before)
  await expect(tips(page), 'the tooltip survives the re-render of the tiles').toHaveCount(1)
  expect(await tips(page).textContent()).toBe(text)
  await page.context().close()
}

for (const vp of VIEWPORTS) {
  test(`tooltip contract at ${vp.width}x${vp.height}, mouse and touch`, async ({ browser }) => {
    test.setTimeout(1_200_000)
    const notes: string[] = []
    let checked = 0
    for (const pointer of ['mouse', 'touch'] as const) {
      for (const state of TOOLTIP_STATES) {
        if (ONLY && !ONLY.includes(state.id)) continue
        const page = await newPage(browser, vp, pointer)
        await test.step(`${state.id} (${pointer})`, async () => {
          const t0 = Date.now()
          if (!(await state.run(page))) return
          const t1 = Date.now()
          checked++
          if (pointer === 'mouse') await textsMatchBefore(page, state, vp)
          const t2 = Date.now()
          await checkState(page, state, vp, pointer, notes)
          if (process.env.TT_TIMING) console.log(`[timing ${vp.width} ${pointer}] ${state.id}: run ${t1 - t0} ms, texts ${t2 - t1} ms, checks ${Date.now() - t2} ms`)
        })
        await page.context().close()
      }
      await test.step(`refetch survival (${pointer})`, () => survivesRefetch(browser, vp, pointer))
    }
    if (!ONLY) expect(checked, 'states that exist at this viewport').toBeGreaterThan(20)
    if (notes.length) console.log(`[tooltips-contract ${vp.width}] ${notes.join('; ')}`)
  })
}
