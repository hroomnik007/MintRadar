// Dashboard Filters panel, F2: ONE segmented-control style for Status / Unit / Method / Software, desktop rows
// (row 1 = the four groups, row 2 = Reliability · Hide test mints · Reset · Show) and the phone column
// (Status, Unit, Method, Software, Reliability, Hide test mints, Reset + Show).
import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const base = MOCK_KNOWN_MINTS[0]
const m = (method: string, unit = 'sat') => ({ method, unit, min_amount: 1, max_amount: 1000 })
const mk = (name: string, version: string | null, over: Record<string, unknown> = {}) => ({
  ...base,
  url: `https://${name.toLowerCase()}.mint.example`, name: `${name} Mint`,
  online: true, degraded: false, archived: false, units: ['sat'], reliabilityScore: 80, version,
  nutsLimits: { '4': {}, '5': {} },
  mintMethods: ['bolt11', 'bolt12', 'onchain', 'paypal', 'venmo'].map(x => m(x)), meltMethods: [m('bolt11')],
  ...over,
})
// Four software options (Nutshell, CDK-Mintd, Nutshell-CF, LekMint) and five methods: the longest texts the panel shows today.
const mints = [
  mk('Alpha', 'Nutshell/0.16.3'), mk('Bravo', 'Nutshell/0.17.0'), mk('Charlie', 'cdk-mintd/0.9.1'), mk('Delta', 'cdk-mintd/0.9.2'),
  mk('Echo', 'Nutshell-CF/0.1'), mk('Foxtrot', 'Nutshell-CF/0.2'), mk('Golf', 'LekMint/1.0'),
]

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: mints }))
  await page.goto('/')
  await page.locator('.filter-btn').click()
  await expect(page.locator('.filter-panel')).toBeVisible()
  await expect(page.locator('.filter-software-chip')).toHaveCount(4)
}

const GROUPS = ['status', 'unit', 'method', 'software'] as const
const seg = (g: string) => `[aria-labelledby="filter-${g}-label"]`

for (const width of [1440, 390]) {
  test.describe(`unified segmented controls at ${width}px`, () => {
    test('all four groups share segment height, option font, border radius and horizontal padding', async ({ page }) => {
      await open(page, width)
      const rows = await page.evaluate((groups: string[]) => groups.map(g => {
        const el = document.querySelector(`[aria-labelledby="filter-${g}-label"]`)!
        const opts = [...el.querySelectorAll('.filter-seg-opt')]
        const c = getComputedStyle(opts[1] ?? opts[0]!), first = getComputedStyle(opts[0]!), last = getComputedStyle(opts[opts.length - 1]!)
        return {
          g, segH: el.getBoundingClientRect().height, optH: opts.map(o => o.getBoundingClientRect().height),
          font: `${c.fontSize} ${c.fontWeight} ${c.fontFamily}`, segRadius: getComputedStyle(el).borderRadius,
          pad: `${c.paddingLeft} ${c.paddingRight}`, firstRadius: first.borderRadius, lastRadius: last.borderRadius,
          sep: opts.length > 1 ? getComputedStyle(opts[1]!).borderLeftWidth : '1px',
        }
      }), [...GROUPS])
      const ref = rows[0]!
      for (const r of rows) {
        expect(r.segH, r.g).toBe(28)
        expect(r.optH.every(h => h === 28), `${r.g} option heights`).toBe(true)
        expect(r.font, r.g).toBe(ref.font)
        expect(r.segRadius, r.g).toBe(ref.segRadius)
        expect(r.firstRadius, r.g).toBe(ref.firstRadius)
        expect(r.lastRadius, r.g).toBe(ref.lastRadius)
        expect(r.pad, r.g).toBe(ref.pad)
        expect(r.sep, r.g).toBe(ref.sep)
      }
    })

    test('the "Hide test mints" label is at least 12px', async ({ page }) => {
      await open(page, width)
      const px = await page.locator('.filter-check').evaluate(el => parseFloat(getComputedStyle(el).fontSize))
      expect(px).toBeGreaterThanOrEqual(12)
    })

    test('Reset and Show are as tall as the segments', async ({ page }) => {
      await open(page, width)
      for (const b of [page.getByRole('button', { name: 'Reset', exact: true }), page.locator('.filter-apply-btn')]) {
        expect((await b.boundingBox())!.height).toBe(28)
      }
    })
  })
}

test('1440px: row 1 holds the four groups, row 2 holds Reliability, the checkbox, Reset and Show', async ({ page }) => {
  await open(page, 1440)
  const top = async (sel: string) => (await page.locator(sel).first().boundingBox())!
  const row1 = await Promise.all(GROUPS.map(g => top(seg(g))))
  const row2 = await Promise.all(['.filter-slider', '.filter-check', '.filter-reset-btn', '.filter-apply-btn'].map(top))
  for (const b of row1) expect(Math.abs(b.y - row1[0]!.y)).toBeLessThan(2)
  for (const b of row2) expect(b.y + b.height / 2).toBeGreaterThan(row1[0]!.y + 28 + 8)
  const mid = row2.map(b => b.y + b.height / 2)
  expect(Math.max(...mid) - Math.min(...mid)).toBeLessThan(2)                       // one line
  // left to right: Reliability, checkbox, Reset, Show; the buttons end at the panel's right edge
  expect(row2[0]!.x).toBeLessThan(row2[1]!.x)
  expect(row2[1]!.x).toBeLessThan(row2[2]!.x)
  const main = (await page.locator('.filter-main').boundingBox())!
  expect(Math.abs(row2[3]!.x + row2[3]!.width - (main.x + main.width))).toBeLessThan(2)
  // row 1: the free space sits between the groups, the last group ends at the right edge
  const last = row1[3]!
  expect(Math.abs(last.x + last.width - (main.x + main.width))).toBeLessThan(2)
  expect((await page.locator('.filter-slider').boundingBox())!.width).toBe(140)
})

test('390px: one column in the order Status, Unit, Method, Software, Reliability, checkbox, buttons; controls share one right edge', async ({ page }) => {
  await open(page, 390)
  const sel = [seg('status'), seg('unit'), seg('method'), seg('software'), '.filter-rel', '.filter-check', '.filter-actions-row']
  const boxes = await Promise.all(sel.map(async s => (await page.locator(s).first().boundingBox())!))
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y, `${sel[i]} below ${sel[i - 1]}`).toBeGreaterThan(boxes[i - 1]!.y)
  const domOrder = await page.evaluate((s: string[]) => {
    const els = s.map(x => document.querySelector(x)!)
    return els.every((e, i) => i === 0 || !!(els[i - 1]!.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING))
  }, sel)
  expect(domOrder).toBe(true)
  const rights = boxes.slice(0, 4).map(b => Math.round(b.x + b.width))
  expect(new Set(rights).size).toBe(1)
  const lefts = boxes.slice(0, 4).map(b => Math.round(b.x))
  expect(new Set(lefts).size).toBe(1)                                                // one label column
  // Status and Unit (three short texts) have equal-width options
  for (const g of ['status', 'unit']) {
    const w = await page.locator(`${seg(g)} .filter-seg-opt`).evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().width)))
    expect(Math.max(...w) - Math.min(...w), g).toBeLessThanOrEqual(1)
  }
})

for (const width of [390, 360, 320]) {
  test(`no horizontal overflow and no clipped option text at ${width}px`, async ({ page }) => {
    await open(page, width)
    const r = await page.evaluate(() => {
      const panel = document.querySelector('.filter-panel')!.getBoundingClientRect()
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        outside: [...document.querySelectorAll('.filter-panel *')].filter(e => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > panel.right + 0.5).map(e => e.className),
        clipped: [...document.querySelectorAll('.filter-seg-opt')].filter(o => o.scrollWidth > o.clientWidth + 0.5).map(o => o.textContent),
      }
    })
    expect(r.page).toBeLessThanOrEqual(0)
    expect(r.outside).toEqual([])
    expect(r.clipped).toEqual([])
  })
}
