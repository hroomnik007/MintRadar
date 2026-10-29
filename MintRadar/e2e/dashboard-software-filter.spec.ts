// Dashboard software filter (?software=, utils/softwareFilter.ts) and the row-1 layout of the filter panel (F1):
// every family (a single-mint one too) + Unknown, multi-select OR, in the badge / Reset / URL; Unit and Method labels
// carry no info icon; at wide widths row 1 has no empty end and the slider keeps its width.
import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const base = MOCK_KNOWN_MINTS[0]
const m = (method: string, unit = 'sat') => ({ method, unit, min_amount: 1, max_amount: 1000 })
const mk = (name: string, version: string | null, over: Record<string, unknown> = {}) => ({
  ...base,
  url: `https://${name.toLowerCase()}.mint.example`,
  name: `${name} Mint`,
  online: true, degraded: false, archived: false, units: ['sat'], reliabilityScore: 80, version,
  nutsLimits: { '4': {}, '5': {} }, mintMethods: [m('bolt11')], meltMethods: [m('bolt11')],
  ...over,
})
const mints = [
  mk('Alpha', 'Nutshell/0.16.3', { units: ['sat', 'usd'], mintMethods: [m('bolt11'), m('bolt12')] }),
  mk('Bravo', 'nutshell/0.17.0'),
  mk('Charlie', 'Nutshell/0.16.3', { units: ['usd'], mintMethods: [m('bolt11', 'usd')], meltMethods: [m('bolt11', 'usd')] }),
  mk('Delta', 'cdk-mintd/0.9.1', { mintMethods: [m('bolt12')], meltMethods: [m('bolt12')] }),
  mk('Echo', 'cdk-mintd/0.9.2'),
  mk('Foxtrot', 'LekMint/1.0'),
  mk('Golf', null),
]

async function setup(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: mints }))
}
const cards = (page: Page) => page.locator('.mint-card')
const names = async (page: Page) => (await cards(page).allInnerTexts()).map(t => /\w+ Mint/.exec(t)?.[0] ?? t).sort()
const chip = (page: Page, k: string) => page.locator(`.filter-software-chip[data-software="${k}"]`)
const openPanel = async (page: Page) => { await page.locator('.filter-btn').click(); await expect(page.locator('.filter-panel')).toBeVisible() }

test.describe('Dashboard software filter', () => {
  test('options: every family by count, then Unknown', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await expect(cards(page)).toHaveCount(7)
    await openPanel(page)
    await expect(page.locator('#filter-software-label')).toHaveText('Software')
    await expect(page.locator('.filter-software-chip')).toHaveText(['Nutshell', 'CDK-Mintd', 'LekMint', 'Unknown'])
  })

  test('selecting an option changes the count and the cards; Apply puts it in the URL and the badge', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await openPanel(page)
    await chip(page, 'cdk').click()
    await expect(chip(page, 'cdk')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.filter-apply-btn')).toHaveText('Show 2 of 7')
    await page.locator('.filter-apply-btn').click()
    await expect(page).toHaveURL(/[?&]software=cdk(&|$)/)
    await expect(cards(page)).toHaveCount(2)
    expect(await names(page)).toEqual(['Delta Mint', 'Echo Mint'])
    await expect(page.locator('.filter-btn')).toContainText('1')
  })

  test('multi-select ORs: CDK + LekMint + Unknown', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await openPanel(page)
    for (const k of ['cdk', 'lekmint', 'unknown']) await chip(page, k).click()
    await expect(page.locator('.filter-apply-btn')).toHaveText('Show 4 of 7')
    await page.locator('.filter-apply-btn').click()
    await expect(cards(page)).toHaveCount(4)
    expect(await names(page)).toEqual(['Delta Mint', 'Echo Mint', 'Foxtrot Mint', 'Golf Mint'])
    await expect(page).toHaveURL(/software=cdk%2Clekmint%2Cunknown|software=cdk,lekmint,unknown/)
  })

  test('combines with Unit and Method (AND between filters)', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await openPanel(page)
    await chip(page, 'nutshell').click()
    await page.locator('.filter-unit-chip[data-unit="usd"]').click()
    await expect(page.locator('.filter-apply-btn')).toHaveText('Show 2 of 7')   // Alpha, Charlie
    await page.locator('.filter-method-chip[data-method="bolt12"]').click()
    await expect(page.locator('.filter-apply-btn')).toHaveText('Show 1 of 7')   // Alpha only
    await page.locator('.filter-apply-btn').click()
    await expect(cards(page)).toHaveCount(1)
    expect(await names(page)).toEqual(['Alpha Mint'])
  })

  test('Reset clears it; the tag clears it; a malformed ?software= is ignored', async ({ page }) => {
    await setup(page)
    await page.goto('/?software=cdk')
    await expect(cards(page)).toHaveCount(2)
    await openPanel(page)
    await expect(chip(page, 'cdk')).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Clear software filter' }).click()
    await expect(page).not.toHaveURL(/software=/)
    await expect(cards(page)).toHaveCount(7)
    await page.goto('/?software=unknown')
    await expect(cards(page)).toHaveCount(1)
    await openPanel(page)
    await page.locator('.filter-reset-btn').click()
    await expect(page).not.toHaveURL(/software=/)
    await expect(cards(page)).toHaveCount(7)
    await page.goto('/?software=bad%20name')
    await expect(cards(page)).toHaveCount(7)
  })

  test('persists like the other filters: it survives a reload through the URL', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await openPanel(page)
    await chip(page, 'nutshell').click()
    await page.locator('.filter-apply-btn').click()
    await expect(cards(page)).toHaveCount(3)
    await page.reload()
    await expect(cards(page)).toHaveCount(3)
    await openPanel(page)
    await expect(chip(page, 'nutshell')).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('Filter panel row 1 (F1)', () => {
  test('Unit and Method labels have no info icon', async ({ page }) => {
    await setup(page)
    await page.goto('/')
    await openPanel(page)
    for (const id of ['filter-unit-label', 'filter-method-label']) {
      await expect(page.locator(`#${id}`)).toBeVisible()
      await expect(page.locator(`#${id}`).locator('xpath=..').locator('[data-tooltip-trigger], svg')).toHaveCount(0)
    }
    await expect(page.locator('.filter-panel [data-tooltip-trigger]')).toHaveCount(0)
  })

  const geometry = (page: Page) => page.evaluate(() => {
    const r = (e: Element) => e.getBoundingClientRect()
    const main = document.querySelector('.filter-main')!
    const kids = [...main.children].map(r)
    return {
      mainLeft: r(main).left, mainRight: r(main).right,
      kids: kids.map(k => ({ left: k.left, right: k.right, top: k.top })),
      slider: r(document.querySelector('.filter-slider')!).width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  test('wide: the last group ends at the right edge, gaps between the groups are even, slider width unchanged 1440 → 1573', async ({ page }) => {
    await setup(page)
    const seen: number[] = []
    for (const w of [1440, 1573]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto('/')
      await openPanel(page)
      const g = await geometry(page)
      expect(new Set(g.kids.map(k => Math.round(k.top))).size).toBe(1)           // all four on one line
      expect(g.kids).toHaveLength(4)
      expect(Math.abs(g.kids[3]!.right - g.mainRight)).toBeLessThan(3)            // no empty end
      expect(Math.abs(g.kids[0]!.left - g.mainLeft)).toBeLessThan(1)
      const gaps = [1, 2, 3].map(i => g.kids[i]!.left - g.kids[i - 1]!.right)
      for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(12)
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(2)               // even gaps
      expect(g.overflow).toBeLessThanOrEqual(0)
      seen.push(g.slider)
    }
    expect(seen).toEqual([140, 140])
  })

  test('narrow: wrapped lines stay left-aligned with the normal 12px gap (768 and 700)', async ({ page }) => {
    await setup(page)
    for (const w of [768, 700]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto('/')
      await openPanel(page)
      const g = await geometry(page)
      const lines = new Map<number, typeof g.kids>()
      for (const k of g.kids) lines.set(Math.round(k.top), [...(lines.get(Math.round(k.top)) ?? []), k])
      expect(lines.size).toBeGreaterThan(1)
      for (const line of lines.values()) {
        expect(Math.abs(line[0]!.left - g.mainLeft)).toBeLessThan(1)
        for (let i = 1; i < line.length; i++) expect(line[i]!.left - line[i - 1]!.right).toBeCloseTo(12, 0)
      }
      expect(g.overflow).toBeLessThanOrEqual(0)
    }
  })

  test('the search bar and the Filters button stay on one row at every width', async ({ page }) => {
    await setup(page)
    for (const w of [1573, 1440, 1024, 768, 390]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto('/')
      await openPanel(page)
      const tops = await page.evaluate(() => [document.querySelector('.search-input')!, document.querySelector('.filter-btn')!].map(e => Math.round(e.getBoundingClientRect().top)))
      expect(Math.abs(tops[0]! - tops[1]!)).toBeLessThan(4)
    }
  })
})
