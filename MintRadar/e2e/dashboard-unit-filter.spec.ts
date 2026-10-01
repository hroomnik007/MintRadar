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
})
