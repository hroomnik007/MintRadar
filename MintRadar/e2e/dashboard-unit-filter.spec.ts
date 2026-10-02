import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

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
// SAT: Alpha 92, Bravo 55 (+USD), Delta 78 · USD only: Echo 85, Hotel 40 (uppercase "USD")
// EUR only: Foxtrot 60 · other: Golf (msat) 70 · unknown: India (null) 66
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
const cards = (page: Page) => page.locator('.mint-card')
const chip = (page: Page, u: string) => page.locator(`.filter-unit-chip[data-unit="${u}"]`)
async function openPanel(page: Page) {
  await page.locator('.filter-btn').click()
  await expect(page.locator('.filter-panel')).toBeVisible()
}

test.describe('Dashboard unit filter', () => {
  test('selecting a unit filters the cards and updates the URL on Apply', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await expect(cards(page)).toHaveCount(8)
    await openPanel(page)
    await chip(page, 'usd').click()
    await expect(chip(page, 'usd')).toHaveAttribute('aria-pressed', 'true')
    // Draft until Apply: nothing changed yet.
    await expect(cards(page)).toHaveCount(8)
    expect(page.url()).not.toContain('unit=')
    await page.getByRole('button', { name: /^Show \d+ of \d+ mints$/ }).click()
    await expect(cards(page)).toHaveCount(3)
    await expect(cards(page).filter({ hasText: 'Bravo Mint' })).toHaveCount(1)
    await expect(cards(page).filter({ hasText: 'Echo Mint' })).toHaveCount(1)
    await expect(cards(page).filter({ hasText: 'Hotel Mint' })).toHaveCount(1) // "USD" casing
    await expect.poll(() => new URL(page.url()).searchParams.get('unit')).toBe('usd')
    await expect(page.locator('.filter-badge')).toHaveText('1')
  })

  test('multi-select and all three still filter (msat-only and unknown-unit mints drop out)', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await openPanel(page)
    for (const u of ['sat', 'usd', 'eur']) await chip(page, u).click()
    await page.getByRole('button', { name: /^Show \d+ of \d+ mints$/ }).click()
    await expect(cards(page)).toHaveCount(6)
    await expect(cards(page).filter({ hasText: 'Golf Mint' })).toHaveCount(0)
    await expect(cards(page).filter({ hasText: 'India Mint' })).toHaveCount(0)
    await expect.poll(() => new URL(page.url()).searchParams.get('unit')).toBe('sat,usd,eur')
  })

  test('?unit=usd preselects the control and filters; "Show N of M" follows', async ({ page }) => {
    await setup(page)
    await page.goto('/?unit=usd')
    await expect(cards(page)).toHaveCount(3)
    await openPanel(page)
    await expect(chip(page, 'usd')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'sat')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: 'Show 3 of 8 mints' })).toBeVisible()
  })

  test('invalid ?unit= values are ignored (no filtering)', async ({ page }) => {
    await setup(page)
    await page.goto('/?unit=btc,%3Cscript%3E,msat')
    await expect(cards(page)).toHaveCount(8)
  })

  test('Reset clears the unit filter and removes the param', async ({ page }) => {
    await setup(page)
    await page.goto('/?unit=eur')
    await expect(cards(page)).toHaveCount(1)
    await openPanel(page)
    await page.locator('.filter-reset-btn').click()
    await expect(cards(page)).toHaveCount(8)
    await expect.poll(() => new URL(page.url()).searchParams.has('unit')).toBe(false)
  })

  test('dismissing the active unit tag clears it', async ({ page }) => {
    await setup(page)
    await page.goto('/?unit=sat,usd')
    await openPanel(page)
    await expect(page.locator('.filter-tag', { hasText: 'Unit: SAT, USD' })).toBeVisible()
    await page.getByRole('button', { name: 'Clear unit filter' }).click()
    await expect(cards(page)).toHaveCount(8)
  })

  test('combines with Status, Reliability and keeps other params', async ({ page }) => {
    await setup(page)
    await page.goto('/?unit=sat&reliability=60&testmints=hide')
    // sat mints with score >= 60: Alpha 92, Delta 78 (Bravo 55 excluded)
    await expect(cards(page)).toHaveCount(2)
    await openPanel(page)
    await chip(page, 'usd').click()
    await page.getByRole('button', { name: /^Show \d+ of \d+ mints$/ }).click()
    // sat|usd, >=60: Alpha, Delta, Echo 85
    await expect(cards(page)).toHaveCount(3)
    const sp = new URL(page.url()).searchParams
    expect(sp.get('unit')).toBe('sat,usd')
    expect(sp.get('reliability')).toBe('60')
    expect(sp.get('testmints')).toBe('hide')
  })

  test('hidden-mints banner stays driven by Status only', async ({ page }) => {
    await setup(page)
    await page.route('**/api/mints/known', r => r.fulfill({ json: [...mints, mk('Zulu', ['sat'], 5, { online: false, degraded: true })] }))
    await page.goto('/?unit=usd')
    await expect(cards(page)).toHaveCount(3)
    await expect(page.locator('.degraded-note')).toContainText('1 mints hidden')
  })

  for (const [width, height] of [[320, 700], [390, 844], [768, 900], [1440, 900]] as const) {
    test(`unit control has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await setup(page)
      await page.goto('/?unit=sat')
      await expect(cards(page).first()).toBeVisible()
      await openPanel(page)
      for (const u of ['sat', 'usd', 'eur']) await expect(chip(page, u)).toBeVisible()
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      expect(o.sw).toBeLessThanOrEqual(o.cw)
      for (const u of ['sat', 'usd', 'eur']) {
        const b = (await chip(page, u).boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x + b.width).toBeLessThanOrEqual(width)
      }
    })
  }

  test('chips have a 44px hit area on touch devices (visible height stays 36px)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    await setup(page)
    await page.goto('/')
    await expect(cards(page).first()).toBeVisible()
    await openPanel(page)
    for (const u of ['sat', 'usd', 'eur']) {
      const b = (await chip(page, u).boundingBox())!
      expect(b.height).toBe(36)
      // 4px invisible ::before above and below → 44px hit area; 3px outside the box still lands on the chip.
      const hit = await chip(page, u).evaluate((el, dy) => {
        const r = el.getBoundingClientRect()
        const x = r.left + r.width / 2
        return {
          pseudoH: parseFloat(getComputedStyle(el, '::before').height),
          hit: [document.elementFromPoint(x, r.top - dy), document.elementFromPoint(x, r.bottom + dy)].map(e => el.contains(e)),
        }
      }, 3)
      expect(hit.pseudoH).toBeGreaterThanOrEqual(44)
      expect(hit.hit).toEqual([true, true])
    }
    await ctx.close()
  })

  const TIP = 'While a unit is selected, mints whose units are not known yet, or are not SAT, USD or EUR, are hidden.'
  const tip = (page: Page) => page.locator('.filter-unit-tip')
  const note = (page: Page) => page.getByTestId('unit-hidden-note')

  test('Unit info icon is focusable and shows the tooltip on keyboard focus and on hover', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await openPanel(page)
    await expect(tip(page)).toHaveAttribute('aria-label', TIP)
    await expect(tip(page)).toHaveAttribute('tabindex', '0')
    // The label itself stays plain text.
    expect(await page.locator('#filter-unit-label').evaluate(el => el.tagName)).toBe('SPAN')
    await page.locator('.filter-btn').focus()
    await page.keyboard.press('Tab')
    for (let i = 0; i < 12; i++) {
      if (await tip(page).evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(tip(page)).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText(TIP)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    // Escape also closes the filter panel (existing behaviour); reopen for the hover check.
    if (!(await page.locator('.filter-panel').isVisible())) await openPanel(page)
    await tip(page).hover()
    await expect(page.getByRole('tooltip')).toHaveText(TIP)
  })

  test('Unit info icon does not move the controls: panel height and Status/Unit left edges unchanged', async ({ page }) => {
    await setup(page)
    // Baseline measured before the change (no unit selected): panel height / status x / unit x.
    const baseline: Record<number, [number, number, number]> = {
      1440: [56, 157.19, 408.38], 900: [100, 79.19, 330.38], 390: [176, 75.19, 75.19], 360: [176, 75.19, 75.19], 320: [220, 75.19, 75.19],
    }
    for (const [w, [h, sx, ux]] of Object.entries(baseline)) {
      await page.setViewportSize({ width: Number(w), height: 900 })
      await page.goto('/')
      await openPanel(page)
      const r = await page.evaluate(() => {
        const seg = document.querySelectorAll('.filter-seg')
        return [document.querySelector('.filter-panel')!.getBoundingClientRect().height, seg[0].getBoundingClientRect().x, seg[1].getBoundingClientRect().x]
      })
      expect(r[0]).toBe(h)
      expect(r[1]).toBeCloseTo(sx, 1)
      expect(r[2]).toBeCloseTo(ux, 1)
    }
  })

  test('footer note: only with a unit selected and a non-zero count, with the right number and wording', async ({ page }) => {
    await setup(page)
    // No unit: no note.
    await page.goto('/')
    await expect(cards(page)).toHaveCount(8)
    await expect(note(page)).toHaveCount(0)
    // sat: India (null) + Golf (msat) = 2; USD-only/EUR-only mints are ordinary filtering, not counted.
    await page.goto('/?unit=sat')
    await expect(cards(page)).toHaveCount(3)
    await expect(note(page)).toHaveText('· 2 hidden: units unknown or other')
    await expect(page.locator('.grid-showing-note')).toContainText('Showing 3 of 8')
    // Only unknown-unit mints hidden.
    await page.route('**/api/mints/known', r => r.fulfill({ json: mints.filter(x => x.name !== 'Golf Mint') }))
    await page.goto('/?unit=sat,usd,eur')
    await expect(note(page)).toHaveText('· 1 hidden: units unknown')
    // Only other-unit mints hidden.
    await page.route('**/api/mints/known', r => r.fulfill({ json: mints.filter(x => x.name !== 'India Mint') }))
    await page.goto('/?unit=sat,usd,eur')
    await expect(note(page)).toHaveText('· 1 hidden: other units')
    // Nothing excluded for this reason: no note.
    await page.route('**/api/mints/known', r => r.fulfill({ json: mints.filter(x => x.name !== 'India Mint' && x.name !== 'Golf Mint') }))
    await page.goto('/?unit=sat')
    await expect(cards(page)).toHaveCount(3)
    await expect(note(page)).toHaveCount(0)
  })

  test('footer note ignores mints hidden by Status / Reliability and by hide-test-mints', async ({ page }) => {
    await setup(page)
    await page.route('**/api/mints/known', r => r.fulfill({ json: [
      ...mints,
      mk('Offl', null, 50, { online: false }),   // unknown units but offline → already hidden by Status
      mk('Lowrel', ['msat'], 5),                 // other units but under the Reliability threshold
    ] }))
    await page.goto('/?unit=sat&reliability=60')
    await expect(note(page)).toHaveText('· 2 hidden: units unknown or other')
  })

  for (const width of [320, 360, 390, 768, 900, 1100, 1440, 1920]) {
    test(`panel and footer note have no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await setup(page)
      await page.goto('/?unit=sat')
      await expect(note(page)).toBeVisible()
      await openPanel(page)
      await page.locator('.filter-btn').focus()
      for (let i = 0; i < 12 && !(await tip(page).evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab')
      await expect(page.getByRole('tooltip')).toBeVisible()
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      expect(o.sw).toBeLessThanOrEqual(o.cw)
      const pop = (await page.getByRole('tooltip').boundingBox())!
      expect(pop.x).toBeGreaterThanOrEqual(0)
      expect(pop.x + pop.width).toBeLessThanOrEqual(width)
    })
  }
})
