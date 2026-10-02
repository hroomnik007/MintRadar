import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Compact Filters panel (2026-10-01): labelled segmented Status + Unit controls, Reliability row,
// footer with Hide test mints · Reset · "Show N of M". Behaviour/URL params are unchanged.
const base = MOCK_KNOWN_MINTS[0]
const mk = (name: string, units: string[] | null, reliabilityScore: number, over: Record<string, unknown> = {}) => ({
  ...base,
  url: `https://${name.toLowerCase()}.mint.example`,
  name: `${name} Mint`,
  online: true, degraded: false, archived: false,
  units, reliabilityScore,
  mintMethods: null, meltMethods: null,
  ...over,
})
// 8 mints, all online: usd = Bravo 55, Echo 85, Hotel 40 · offline-but-recent: none
const mints = [
  mk('Alpha', ['sat'], 92),
  mk('Bravo', ['sat', 'usd'], 55),
  mk('Delta', ['sat'], 78),
  mk('Echo', ['usd'], 85),
  mk('Hotel', ['USD'], 40),
  mk('Foxtrot', ['eur'], 60),
  mk('Golf', ['msat'], 70),
  mk('India', null, 66),
]

async function setup(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: mints }))
}
const showBtn = (page: Page) => page.getByRole('button', { name: /^Show \d+ of \d+ mints$/ })
const chip = (page: Page, u: string) => page.locator(`.filter-unit-chip[data-unit="${u}"]`)
async function openPanel(page: Page, url = '/') {
  await setup(page)
  await page.goto(url)
  await expect(page.locator('.mint-card').first()).toBeVisible()
  await page.locator('.filter-btn').click()
  await expect(page.locator('.filter-panel')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

test.describe('Filters panel — Status segmented control', () => {
  test('radiogroup "Status" with native radios; click selects, arrow keys move the selection', async ({ page }) => {
    await openPanel(page)
    const group = page.getByRole('radiogroup', { name: 'Status' })
    await expect(group.getByRole('radio')).toHaveCount(3)
    await expect(group.getByRole('radio', { name: 'Online' })).toBeChecked()

    await group.getByRole('radio', { name: 'All' }).click()
    await expect(group.getByRole('radio', { name: 'All' })).toBeChecked()
    await expect(group.locator('.filter-seg-opt.active')).toHaveText('All')

    // Native radio keyboard behaviour: arrows move focus + selection within the group.
    await group.getByRole('radio', { name: 'All' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(group.getByRole('radio', { name: 'Online' })).toBeChecked()
    await page.keyboard.press('ArrowRight')
    await expect(group.getByRole('radio', { name: 'Offline' })).toBeChecked()
    await expect(group.getByRole('radio', { name: 'Offline' })).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(group.getByRole('radio', { name: 'All' })).toBeChecked()
    // Still a draft: nothing committed to the URL until the Show button is clicked.
    expect(new URL(page.url()).searchParams.has('status')).toBe(false)
  })

  test('keyboard focus shows a visible focus ring on the segment', async ({ page }) => {
    await openPanel(page)
    await page.getByRole('radio', { name: 'Online' }).focus()
    await page.keyboard.press('ArrowRight')
    const outline = await page.locator('.filter-seg-opt:has(input:focus-visible)').evaluate(el => getComputedStyle(el).outlineStyle)
    expect(outline).toBe('solid')
  })
})

test.describe('Filters panel — Unit segmented control', () => {
  test('multi-select toggles (aria-pressed), empty = no filtering, ?unit= written on apply', async ({ page }) => {
    await openPanel(page)
    const group = page.getByRole('group', { name: 'Unit' })
    for (const u of ['sat', 'usd', 'eur']) await expect(chip(page, u)).toHaveAttribute('aria-pressed', 'false')
    await expect(group.getByRole('button')).toHaveCount(3)
    await chip(page, 'usd').click()
    await chip(page, 'eur').click()
    await expect(chip(page, 'usd')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'eur')).toHaveAttribute('aria-pressed', 'true')
    await chip(page, 'eur').click()
    await expect(chip(page, 'eur')).toHaveAttribute('aria-pressed', 'false')
    await showBtn(page).click()
    await expect(page.locator('.mint-card')).toHaveCount(3)
    await expect.poll(() => new URL(page.url()).searchParams.get('unit')).toBe('usd')
  })
})

test.describe('Filters panel — "Show N of M"', () => {
  test('updates live with the draft, matches the grid footer after applying, and applies + updates the URL', async ({ page }) => {
    await openPanel(page)
    await expect(showBtn(page)).toHaveAccessibleName('Show 8 of 8 mints')
    await expect(showBtn(page)).toHaveText('Show 8 of 8')
    await chip(page, 'usd').click()
    await expect(showBtn(page)).toHaveAccessibleName('Show 3 of 8 mints') // draft, not yet applied
    await expect(page.locator('.mint-card')).toHaveCount(8)
    await page.getByRole('slider').fill('60')
    await expect(showBtn(page)).toHaveAccessibleName('Show 1 of 8 mints') // usd ≥ 60: Echo 85
    await page.getByLabel('Hide test mints').check()
    await page.getByRole('radio', { name: 'Offline' }).check()
    await expect(showBtn(page)).toHaveAccessibleName('Show 0 of 8 mints')
    await expect(showBtn(page)).toBeEnabled() // N = 0 stays enabled, same as the old Apply button
    await page.getByRole('radio', { name: 'Online' }).check()

    await showBtn(page).click()
    await expect(page.locator('.filter-panel')).toHaveCount(0)
    await expect(page.locator('.mint-card')).toHaveCount(1)
    await expect(page.locator('.grid-showing-note')).toHaveText(/^Showing 1 of 8( · \d+ hidden: .+)?$/)
    const sp = new URL(page.url()).searchParams
    expect(sp.get('unit')).toBe('usd')
    expect(sp.get('reliability')).toBe('60')
    expect(sp.get('testmints')).toBe('hide')
  })

  test('the old "Apply filter" text and the separate "Showing N of M" line are gone; no aria-live on the panel', async ({ page }) => {
    await openPanel(page)
    await expect(page.getByRole('button', { name: 'Apply filter' })).toHaveCount(0)
    await expect(page.locator('.filter-panel')).not.toContainText('Showing')
    await expect(page.locator('.filter-panel [aria-live]')).toHaveCount(0)
  })

  test('button width does not change with the count', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openPanel(page)
    const w1 = (await showBtn(page).boundingBox())!.width
    await chip(page, 'eur').click() // 8 → 1
    await expect(showBtn(page)).toHaveText('Show 1 of 8')
    const w2 = (await showBtn(page).boundingBox())!.width
    expect(w2).toBe(w1)
  })

  test('Reset resets the draft and the committed filters', async ({ page }) => {
    await openPanel(page, '/?unit=eur&reliability=50&testmints=hide&status=all')
    await expect(page.locator('.mint-card')).toHaveCount(1)
    await expect(chip(page, 'eur')).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(page.locator('.mint-card')).toHaveCount(8)
    await expect(chip(page, 'eur')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('radio', { name: 'Online' })).toBeChecked()
    await expect(page.getByLabel('Hide test mints')).not.toBeChecked()
    await expect(page.getByRole('slider')).toHaveValue('0')
    const sp = new URL(page.url()).searchParams
    for (const k of ['unit', 'reliability', 'testmints', 'status']) expect(sp.has(k)).toBe(false)
  })
})

test.describe('Filters panel — layout', () => {
  for (const width of [390, 1440]) {
    test(`panel edges equal the Search row and the card grid at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openPanel(page)
      const e = await page.evaluate(() => {
        const box = (s: string) => document.querySelector(s)!.getBoundingClientRect()
        const inner = (s: string) => {
          const el = document.querySelector(s)!, r = el.getBoundingClientRect(), cs = getComputedStyle(el)
          return { l: r.left + parseFloat(cs.paddingLeft), r: r.right - parseFloat(cs.paddingRight) }
        }
        return { panel: box('.filter-panel'), controls: inner('.dashboard-controls'), grid: inner('.mint-grid'), card: box('.mint-card') }
      })
      expect(e.panel.left).toBeCloseTo(e.controls.l, 0)
      expect(e.panel.right).toBeCloseTo(e.controls.r, 0)
      expect(e.panel.left).toBeCloseTo(e.card.left, 0)
      expect(e.panel.left).toBeCloseTo(e.grid.l, 0)
      expect(e.panel.right).toBeCloseTo(e.grid.r, 0)
      if (width === 390) expect(e.panel.right).toBeCloseTo(e.card.right, 0) // single full-width card column
    })
  }

  for (const width of [320, 360, 390, 768, 900, 1100, 1440, 1920]) {
    test(`no horizontal overflow with the panel open at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openPanel(page, '/?unit=sat,usd,eur')
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      expect(o.sw).toBeLessThanOrEqual(o.cw)
      const p = (await page.locator('.filter-panel').boundingBox())!
      for (const loc of [page.locator('.filter-seg').first(), page.locator('.filter-seg').nth(1), page.locator('.filter-rel'), page.locator('.filter-footer'), showBtn(page)]) {
        const b = (await loc.boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(p.x)
        expect(b.x + b.width).toBeLessThanOrEqual(p.x + p.width + 0.5)
      }
    })
  }

  test('panel height: ≤ 200px at 390px, a single ~56px row on a wide window', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPanel(page)
    expect((await page.locator('.filter-panel').boundingBox())!.height).toBeLessThanOrEqual(200)
    await page.setViewportSize({ width: 1440, height: 900 })
    expect((await page.locator('.filter-panel').boundingBox())!.height).toBeLessThanOrEqual(58)
  })

  test('segments, checkbox row and buttons are 36px tall', async ({ page }) => {
    await openPanel(page)
    for (const loc of [page.locator('.filter-seg').first(), page.locator('.filter-seg').nth(1), page.locator('.filter-check'), page.getByRole('button', { name: 'Reset', exact: true }), showBtn(page)]) {
      expect((await loc.boundingBox())!.height).toBe(36)
    }
  })

  test('hit areas are ≥ 44px with a coarse pointer (visible size unchanged)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await openPanel(page)
    const targets = [
      ...await page.locator('.filter-seg-opt').all(),
      page.locator('.filter-check'),
      page.getByRole('button', { name: 'Reset', exact: true }),
      showBtn(page),
    ]
    expect(targets).toHaveLength(9)
    for (const t of targets) {
      const r = await t.evaluate(el => {
        // The Reliability slider (44px hit area, z-index above the neighbouring rows' 4px bands) wins the
        // gap between itself and the row above/below: a point inside its box counts as theirs to own.
        const slider = document.querySelector('.filter-slider')!
        const ownsPoint = (target: Element, px: number, py: number) => {
          const hit = document.elementFromPoint(px, py)
          if (hit === slider) { const sb = slider.getBoundingClientRect(); return py >= sb.top && py <= sb.bottom && px >= sb.left && px <= sb.right }
          return target.contains(hit)
        }
        const b = el.getBoundingClientRect(), x = b.left + b.width / 2
        const pseudo = getComputedStyle(el, '::before')
        // The invisible ::before is exactly what extends the target: it must be ≥ 44px tall and live
        // (hit-testing 3px outside the visible box still lands on the element; the exact 4px edge is
        // within sub-pixel rounding of the neighbouring row's extension, so it isn't probed).
        return {
          h: b.height, pseudoH: parseFloat(pseudo.height), pseudoContent: pseudo.content,
          up: ownsPoint(el, x, b.top - 3), down: ownsPoint(el, x, b.bottom + 3),
        }
      })
      expect(r.h).toBe(36)
      expect(r.pseudoContent).toBe('""')
      expect(r.pseudoH).toBeGreaterThanOrEqual(44)
      expect(r, `target ${targets.indexOf(t)}`).toMatchObject({ up: true, down: true })
    }
    await ctx.close()
  })
})

// Status "All" must mean every tracked mint (2026-10-01 fix): 51 online + 10 offline <24h +
// 12 offline 24h+ (degraded) + 3 archived = 76. Real pointer input at the segment centre — no
// force/dispatchEvent/check() — so an overlay or a wrong draft count cannot hide behind them.
const big = Array.from({ length: 76 }, (_, i) => mk(`M${i}`, ['sat'], 50 + (i % 40), {
  online: i < 51,
  degraded: i >= 61 && i < 73,
  archived: i >= 73,
}))
const segCentre = async (page: Page, label: string) => {
  const bb = (await page.locator('.filter-seg-opt', { hasText: new RegExp(`^${label}$`) }).boundingBox())!
  return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }
}

for (const vp of [{ width: 1440, height: 900, name: 'desktop one-row' }, { width: 390, height: 844, name: '390px' }]) {
  test.describe(`Filters panel — Status by real pointer click (${vp.name})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await mockRelays(page)
      await installApiMocks(page)
      await page.route('**/api/mints/known', r => r.fulfill({ json: big }))
      await page.goto('/')
      await expect(page.locator('.mint-card').first()).toBeVisible()
      await page.locator('.filter-btn').click()
      await expect(page.locator('.filter-panel')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
    })
    const clickSeg = async (page: Page, label: string) => {
      const { x, y } = await segCentre(page, label)
      const hit = await page.evaluate(([px, py]) => {
        const e = document.elementFromPoint(px, py) as HTMLInputElement
        return { tag: e.tagName, inSeg: !!e.closest('.filter-seg-opt'), name: e.getAttribute('name') }
      }, [x, y])
      expect(hit).toEqual({ tag: 'INPUT', inSeg: true, name: 'filter-status' })
      await page.mouse.click(x, y)
    }

    test('All → "Show 76 of 76", ?status=all, all 76 cards, no hidden-mints banner', async ({ page }) => {
      await expect(showBtn(page)).toHaveText('Show 51 of 76')
      await clickSeg(page, 'All')
      await expect(page.getByRole('radio', { name: 'All' })).toBeChecked()
      await expect(page.locator('.filter-seg-opt.active')).toHaveText('All')
      await expect(showBtn(page)).toHaveText('Show 76 of 76')
      await showBtn(page).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('all')
      await expect(page.locator('.mint-card')).toHaveCount(76)
      await expect(page.locator('.degraded-note')).toHaveCount(0)
    })

    test('Online → 51 / default URL / banner counts the 25 hidden; Offline → 25 / ?status=offline', async ({ page }) => {
      await clickSeg(page, 'Offline')
      await expect(showBtn(page)).toHaveText('Show 25 of 76')
      await clickSeg(page, 'Online')
      await expect(page.locator('.filter-seg-opt.active')).toHaveText('Online')
      await expect(showBtn(page)).toHaveText('Show 51 of 76')
      await showBtn(page).click()
      await expect(page.locator('.mint-card')).toHaveCount(51)
      expect(new URL(page.url()).searchParams.has('status')).toBe(false)
      await expect(page.locator('.degraded-note')).toContainText('25 mints hidden')

      await page.locator('.filter-btn').click()
      await clickSeg(page, 'Offline')
      await expect(showBtn(page)).toHaveText('Show 25 of 76')
      await showBtn(page).click()
      await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('offline')
      await expect(page.locator('.mint-card')).toHaveCount(25)
      await expect(page.locator('.degraded-note')).toHaveCount(0)
    })

    test('live count follows every draft change: All, Unit, Reliability, Hide test mints', async ({ page }) => {
      await clickSeg(page, 'All')
      await expect(showBtn(page)).toHaveText('Show 76 of 76')
      await chip(page, 'usd').click()
      await expect(showBtn(page)).toHaveText('Show 0 of 76')
      await chip(page, 'usd').click()
      await page.getByRole('slider').fill('85')
      // offline mints score 0 in the list, so only the online ones can pass the slider
      const above = big.filter(m => m.online && (m.reliabilityScore as number) >= 85).length
      await expect(showBtn(page)).toHaveText(`Show ${above} of 76`)
      await page.getByRole('slider').fill('0')
      await page.locator('.filter-check').click() // label: at 390px its touch-target ::before sits over the checkbox
      await expect(showBtn(page)).toHaveText('Show 76 of 76') // none of these are test mints
      await clickSeg(page, 'Online')
      await expect(showBtn(page)).toHaveText('Show 51 of 76')
    })

    test('All after Unit change and after Reset still reaches 76', async ({ page }) => {
      await chip(page, 'sat').click()
      await clickSeg(page, 'All')
      await expect(showBtn(page)).toHaveText('Show 76 of 76')
      await page.locator('.filter-reset-btn').click()
      await clickSeg(page, 'All')
      await expect(showBtn(page)).toHaveText('Show 76 of 76')
    })

    test('keyboard (arrow keys) and ?status=all URL reach the same All view', async ({ page }) => {
      await page.getByRole('radio', { name: 'Online' }).focus()
      await page.keyboard.press('ArrowLeft')
      await expect(showBtn(page)).toHaveText('Show 76 of 76')
      await page.goto('/?status=all')
      await expect(page.locator('.mint-card')).toHaveCount(76)
      await expect(page.locator('.degraded-note')).toHaveCount(0)
    })
  })
}

// Plain labels vs button-like options (2026-10-01): the Status/Unit labels sit OUTSIDE the segmented
// control, styled like the "RELIABILITY ≥ N%" label; the options look and behave like buttons.
test.describe('Filters panel — labels versus options', () => {
  const style = (loc: import('@playwright/test').Locator, props: string[]) =>
    loc.evaluate((el, ps) => { const cs = getComputedStyle(el); return Object.fromEntries(ps.map(p => [p, cs.getPropertyValue(p)])) }, props)
  const label = (page: Page, name: string) => page.locator('.filter-field-label', { hasText: new RegExp(`^${name}$`) })

  test('labels are plain text outside the control: transparent, borderless, default cursor, not focusable', async ({ page }) => {
    await openPanel(page)
    for (const name of ['Status', 'Unit']) {
      const l = label(page, name)
      await expect(l).toHaveCount(1)
      expect(await l.evaluate(el => !!el.closest('.filter-seg'))).toBe(false)
      const st = await style(l, ['background-color', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'cursor', 'text-transform', 'font-family', 'color'])
      expect(st['background-color']).toBe('rgba(0, 0, 0, 0)')
      for (const side of ['top', 'right', 'bottom', 'left']) expect(st[`border-${side}-width`]).toBe('0px')
      expect(st.cursor).toBe('default')
      expect(st['text-transform']).toBe('uppercase')
      expect(await l.getAttribute('tabindex')).toBeNull()
    }
    // Same type treatment as the existing "RELIABILITY ≥ N%" label.
    const ref = await style(page.locator('.filter-group-label'), ['font-family', 'font-size', 'letter-spacing', 'text-transform', 'color'])
    expect(await style(label(page, 'Status'), ['font-family', 'font-size', 'letter-spacing', 'text-transform', 'color'])).toEqual(ref)
    // The label text is the group's accessible name.
    await expect(page.getByRole('radiogroup', { name: 'Status' })).toHaveCount(1)
    await expect(page.getByRole('group', { name: 'Unit' })).toHaveCount(1)
  })

  test('clicking a label changes nothing', async ({ page }) => {
    await openPanel(page)
    const before = await showBtn(page).textContent()
    for (const name of ['Status', 'Unit']) await label(page, name).click()
    await expect(page.getByRole('radio', { name: 'Online' })).toBeChecked()
    for (const u of ['sat', 'usd', 'eur']) await expect(chip(page, u)).toHaveAttribute('aria-pressed', 'false')
    expect(await showBtn(page).textContent()).toBe(before)
    expect(await page.evaluate(() => document.activeElement?.closest('.filter-field-label') ?? null)).toBeNull()
  })

  test('options look like buttons; the selected one differs by computed style', async ({ page }) => {
    await openPanel(page)
    const props = ['cursor', 'background-color', 'background-image', 'box-shadow', 'color']
    for (const opt of await page.locator('.filter-seg-opt').all()) {
      const st = await style(opt, props)
      expect(st.cursor).toBe('pointer')
      expect(st['background-color']).not.toBe('rgba(0, 0, 0, 0)')
    }
    await chip(page, 'usd').click()
    const on = await style(chip(page, 'usd'), props)
    const off = await style(chip(page, 'eur'), props)
    expect(on.color).not.toBe(off.color)
    expect(on['box-shadow']).not.toBe(off['box-shadow'])
    expect(on['background-image']).not.toBe(off['background-image'])
    const frame = await page.locator('.filter-seg').first().evaluate(el => getComputedStyle(el, '::after').borderTopWidth)
    expect(frame).toBe('1px')
    expect((await style(page.locator('.filter-seg-opt').nth(1), ['border-left-width']))['border-left-width']).toBe('1px')
  })

  test('hover lightens an unselected option and strengthens its border (hover-capable pointer)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openPanel(page)
    const opt = chip(page, 'eur')
    const rest = await style(opt, ['background-image', 'box-shadow'])
    await opt.hover()
    const hov = await style(opt, ['background-image', 'box-shadow'])
    expect(hov['background-image']).not.toBe(rest['background-image'])
    expect(hov['box-shadow']).not.toBe(rest['box-shadow'])
  })

  test('keyboard focus ring: 2px accent outline with an offset', async ({ page }) => {
    await openPanel(page)
    await page.getByRole('radio', { name: 'Online' }).focus()
    await page.keyboard.press('ArrowRight')
    const o = await style(page.locator('.filter-seg-opt:has(input:focus-visible)'), ['outline-width', 'outline-style', 'outline-offset', 'outline-color'])
    expect(o).toMatchObject({ 'outline-width': '2px', 'outline-style': 'solid', 'outline-offset': '2px' })
    await chip(page, 'sat').focus()
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    expect((await style(chip(page, 'sat'), ['outline-style']))['outline-style']).toBe('solid')
  })

  test('Status and Unit controls start at the same left edge at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPanel(page)
    const lefts = await page.locator('.filter-seg').evaluateAll(els => els.map(e => e.getBoundingClientRect().left))
    expect(lefts).toHaveLength(2)
    expect(lefts[0]).toBeCloseTo(lefts[1], 1)
    const labels = await page.locator('.filter-field-label').evaluateAll(els => els.map(e => e.getBoundingClientRect().width))
    expect(labels[0]).toBeCloseTo(labels[1], 1)
  })
})

// Reliability slider touch target (2026-10-02): with a coarse pointer the input grows to 44px
// (equal negative margin keeps its 28px layout box), so panel and row heights stay the same.
test.describe('Filters panel — Reliability slider touch target', () => {
  const widths = [1440, 900, 390, 360, 320]

  async function panelMetrics(page: Page) {
    return page.evaluate(() => {
      const h = (s: string) => document.querySelector(s)!.getBoundingClientRect().height
      return { panel: h('.filter-panel'), bar: h('.filter-bar'), rel: h('.filter-rel'), footer: h('.filter-footer') }
    })
  }

  for (const w of widths) {
    test.describe(`touch ${w}px`, () => {
      test.use({ viewport: { width: w, height: 900 }, hasTouch: true, isMobile: true })

      test('hit area is at least 44px, layout identical to a mouse context', async ({ page, browser }) => {
        await openPanel(page)
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
        const slider = page.locator('.filter-slider')
        const hits = await page.evaluate(() => {
          const s = document.querySelector('.filter-slider')!
          const b = s.getBoundingClientRect()
          const cx = b.left + b.width / 2
          const cy = b.top + b.height / 2
          const at = (dy: number) => document.elementFromPoint(cx, cy + dy) === s
          return { up: at(-20), down: at(20), height: b.height }
        })
        expect(hits.up).toBe(true)
        expect(hits.down).toBe(true)
        expect(hits.height).toBeGreaterThanOrEqual(44)
        // The row keeps its 28px layout box
        expect((await slider.evaluate(e => e.parentElement!.getBoundingClientRect().height))).toBe(28)

        const touchMetrics = await panelMetrics(page)
        const mouse = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: false, isMobile: false })
        const mousePage = await mouse.newPage()
        await openPanel(mousePage)
        expect(await mousePage.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(false)
        const mouseMetrics = await panelMetrics(mousePage)
        await mouse.close()
        expect(touchMetrics).toEqual(mouseMetrics)
      })

      test('touch drag and tap change the value and the Show N of M count live', async ({ page, context }) => {
        await openPanel(page)
        const slider = page.locator('.filter-slider')
        const box = (await slider.boundingBox())!
        const cy = box.y + box.height / 2
        const xAt = (pct: number) => box.x + 8 + (box.width - 16) * (pct / 100)
        const expected = (min: number) => mints.filter(m => m.reliabilityScore >= min).length
        const countText = async () => (await showBtn(page).getAttribute('aria-label'))!
        expect(await countText()).toMatch(/^Show \d+ of \d+ mints$/)

        const cdp = await context.newCDPSession(page)
        const touch = (type: string, x: number, y: number) =>
          cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
        // Drag the thumb from 0 to ~80 along the track — the finger starts 18px below the centre line,
        // i.e. in the extended hit area, outside the 28px layout box.
        await touch('touchStart', xAt(0), cy + 18)
        for (let p = 0; p <= 80; p += 10) await touch('touchMove', xAt(p), cy + 18)
        const live = Number(await slider.inputValue())
        await touch('touchEnd', 0, 0)
        expect(live).toBeGreaterThanOrEqual(70)
        expect(live).toBeLessThanOrEqual(90)
        await expect(page.locator('.filter-rel strong')).toHaveText(`${live}%`)
        expect(await countText()).toBe(`Show ${expected(live)} of ${mints.length} mints`)

        // Tap on the track, 18px above the centre line, moves the value back
        await page.touchscreen.tap(xAt(30), cy - 18)
        const tapped = Number(await slider.inputValue())
        expect(tapped).toBeGreaterThanOrEqual(25)
        expect(tapped).toBeLessThanOrEqual(35)
        expect(await countText()).toBe(`Show ${expected(tapped)} of ${mints.length} mints`)
      })
    })
  }
})
