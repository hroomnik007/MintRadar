import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

type Page = import('@playwright/test').Page

// NUTs tab card "Fees and limits" (first card, before NUT compatibility; it used to be an Overview group; src/components/mint/MintFeesLimits.tsx, src/utils/feesLimits.ts): input fee examples
// from the keysets the page already has (NUT-02 rule, rounded up) and the limits the mint declares in /v1/info.
// Mocked endpoints only; nothing is requested from a mint by this group.

const ALPHA = 'https://alpha.mint.example'
const group = (page: Page) => page.getByTestId('mint-fees-limits')
const fees = (page: Page) => page.getByTestId('mint-fees')
const limits = (page: Page) => page.getByTestId('mint-limits')
const rates = (page: Page) => fees(page).locator('.md-fee-rate')
const examples = (page: Page) => fees(page).locator('.md-fee-examples')
const EX = (fees3: string, unit: string) => `You pay (rounded up per payment): ${fees3} ${unit} for 1 / 16 / 100 coins`

function probeWith(keysets: unknown) {
  return {
    url: ALPHA, online: true, latencyMs: 40,
    info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts: { '4': {}, '5': {} } },
    keysets,
    checkedAt: new Date().toISOString(),
  }
}

interface Setup {
  keysets?: unknown
  hold?: Promise<void>
  known?: Record<string, unknown>
  /** Do not switch to the NUTs tab (the card must not be on the Overview). */
  overview?: boolean
}

async function open(page: Page, setup: Setup = {}, size: [number, number] = [1440, 900]) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, lastCheckedAt: new Date(Date.now() - 5 * 60_000).toISOString(), ...setup.known } : m))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  let reached = 0
  await page.route('**/api/mint/probe**', async r => {
    reached++
    if (setup.hold) await setup.hold
    await r.fulfill({ json: probeWith(setup.keysets ?? null) })
  })
  await resize(page, size[0], size[1])
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  if (!setup.overview) await page.locator('.md-tab', { hasText: /^NUTs/ }).click()
  return { reached: () => reached }
}

const KS_FEE = [
  { id: '00ad268c4d1f5826', unit: 'sat', active: true, input_fee_ppk: 100 },
  { id: '00c074b96c7e2b0e', unit: 'sat', active: false, input_fee_ppk: 5000 },
]

test('a mint with an input fee: the rate per coin first, then the fee for spending 1 / 16 / 100 coins, rounded up, in the unit', async ({ page }) => {
  await open(page, { keysets: KS_FEE })
  await expect(group(page)).toBeVisible()
  await expect(group(page).locator('.md-panel-title')).toHaveText('Fees and limits')
  await expect(fees(page).locator('.md-info-row')).toHaveCount(1)
  await expect(fees(page).locator('.md-info-label')).toHaveText('Input fee · sat')
  await expect(rates(page)).toHaveText('0.1 sat per coin · 100 ppk')
  await expect(examples(page)).toHaveText(EX('1 / 2 / 10', 'sat'))
})

test('150 ppk (mint.macadamia.cash): the rate line says 0.15 per coin, the examples line shows the payment rounded up per payment', async ({ page }) => {
  // an inactive keyset with another fee must not decide the rate: the ACTIVE keyset (150 ppk) does
  await open(page, { keysets: [
    { id: '00c074b96c7e2b0e', unit: 'sat', active: false, input_fee_ppk: 0 },
    { id: '00ad268c4d1f5826', unit: 'sat', active: true, input_fee_ppk: 150 },
    { id: '00ffee11aa22bb33', unit: 'sat', active: false, input_fee_ppk: 5000 },
  ] })
  await expect(rates(page)).toHaveText('0.15 sat per coin · 150 ppk')
  await expect(examples(page)).toHaveText('You pay (rounded up per payment): 1 / 3 / 15 sat for 1 / 16 / 100 coins')
  // the rate is the primary line: it comes first in the row and is not smaller than the examples
  const sizes = await fees(page).locator('.md-info-value').evaluate(el => {
    const r = el.querySelector('.md-fee-rate')!, x = el.querySelector('.md-fee-examples')!
    return { rateTop: r.getBoundingClientRect().top, exTop: x.getBoundingClientRect().top, rate: parseFloat(getComputedStyle(r).fontSize), ex: parseFloat(getComputedStyle(x).fontSize) }
  })
  expect(sizes.rateTop).toBeLessThan(sizes.exTop)
  expect(sizes.rate).toBeGreaterThanOrEqual(sizes.ex)
  expect(sizes.ex).toBeGreaterThanOrEqual(12)
  await expect(group(page).locator('button[data-tooltip-trigger]').first()).toBeVisible()
})

test('the effective fee is the largest of the ACTIVE keysets; several units get a row each', async ({ page }) => {
  await open(page, { keysets: [
    ...KS_FEE,
    { id: '00aaaaaaaaaaaaaa', unit: 'sat', active: true, input_fee_ppk: 250 },
    { id: '01bbbbbbbbbbbbbb', unit: 'usd', active: true, input_fee_ppk: 1000 },
  ] })
  await expect(fees(page).locator('.md-info-row')).toHaveCount(2)
  await expect(rates(page)).toHaveText(['0.25 sat per coin · 250 ppk', '1 cents per coin · 1000 ppk'])
  await expect(examples(page)).toHaveText([EX('1 / 4 / 25', 'sat'), EX('1 / 16 / 100', 'cents')])
})

const FEE_TIP = 'Your balance is made of many small coins. The mint charges a small fee per coin used and rounds the total up, so small payments cost relatively more. Fewer, larger coins keep fees low.'

test('plain wording: "coins" instead of "proofs", cents for usd and eur, the raw unit for any other unit; the numbers are unchanged', async ({ page }) => {
  await open(page, { keysets: [
    ...KS_FEE,
    { id: '01bbbbbbbbbbbbbb', unit: 'usd', active: true, input_fee_ppk: 100 },
    { id: '01cccccccccccccc', unit: 'eur', active: true, input_fee_ppk: 1000 },
    { id: '00dddddddddddddd', unit: 'lek', active: true, input_fee_ppk: 100 },
  ] })
  await expect(fees(page).locator('.md-info-label')).toHaveText(['Input fee · sat', 'Input fee · eur', 'Input fee · lek', 'Input fee · usd'])
  await expect(rates(page)).toHaveText(['0.1 sat per coin · 100 ppk', '1 cents per coin · 1000 ppk', '0.1 lek per coin · 100 ppk', '0.1 cents per coin · 100 ppk'])
  await expect(examples(page)).toHaveText([EX('1 / 2 / 10', 'sat'), EX('1 / 16 / 100', 'cents'), EX('1 / 2 / 10', 'lek'), EX('1 / 2 / 10', 'cents')])
  // nothing in the card body uses the technical words
  await expect(group(page)).not.toContainText(/proof|ecash note/i)
})

test('the fee rows have a plain-language tooltip (button, named, opens by click, text as approved); a row without a fee has none', async ({ page }) => {
  await open(page, { keysets: [...KS_FEE, { id: '01bbbbbbbbbbbbbb', unit: 'usd', active: true, input_fee_ppk: 0 }] })
  await layoutReady(page)
  const btn = fees(page).locator('button[data-tooltip-trigger]')
  await expect(btn).toHaveCount(1)
  await expect(btn).toHaveAttribute('aria-label', 'More information about input fee in sat')
  // contract: a real button, a hit area of at least 24 x 24 px (the icon itself stays small), no overlap with the label's text
  const box = (await btn.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(23.99)
  expect(box.height).toBeGreaterThanOrEqual(23.99)
  await expect(btn).toHaveAttribute('type', 'button')
  await btn.click()
  await expect(btn).toHaveAttribute('aria-describedby', /.+/)
  const tip = page.locator('[role="tooltip"]')
  await expect(tip).toHaveText(FEE_TIP)
  expect(await tip.innerText()).not.toMatch(/proof|ecash note/i)
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
})

test('zero fee and undeclared limits: "No input fee" and "not declared", never a number', async ({ page }) => {
  await open(page, {
    keysets: [{ id: '00ad268c4d1f5826', unit: 'sat', active: true, input_fee_ppk: 0 }],
    known: { mintMethods: [{ method: 'bolt11', unit: 'sat' }], meltMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 0 }] },
  })
  await expect(fees(page).locator('.md-info-value')).toHaveText('No input fee')
  await expect(limits(page).locator('.md-info-row')).toHaveText([
    /Deposit \(mint\) · bolt11 · sat\s*min not declared, max not declared/,
    /Withdrawal \(melt\) · bolt11 · sat\s*min 0, max not declared/,
  ])
})

test('a keyset that states no input_fee_ppk uses the NUT-02 default 0: "No input fee"', async ({ page }) => {
  await open(page, { keysets: [{ id: '00ad268c4d1f5826', unit: 'sat', active: true }] })
  await expect(fees(page).locator('.md-info-value')).toHaveText('No input fee')
  await expect(fees(page)).not.toContainText('not stated')
})

test('declared limits per method and unit, with thousands separators', async ({ page }) => {
  await open(page, { keysets: KS_FEE })
  await expect(limits(page).locator('.md-info-row')).toHaveText([
    /Deposit \(mint\) · bolt11 · sat\s*min 1, max 1,000,000/,
    /Withdrawal \(melt\) · bolt11 · sat\s*min 1, max 500,000/,
  ])
})

test('no keyset data: "Keyset data not available yet"; the limits still show', async ({ page }) => {
  await open(page, { keysets: null })
  await expect(fees(page)).toContainText('Keyset data not available yet')
  await expect(limits(page)).toContainText('min 1, max 1,000,000')
})

const SENTENCE = 'Limits are declared by the mint. Lightning fee reserves depend on the invoice and are known only when a quote is requested, so MintRadar does not show them.'
const infoButton = (page: Page) => group(page).locator('.md-fl-head button[data-tooltip-trigger]')

test('the source line stays under the rows; its time carries the absolute UTC time; no sub-headings, one divider between fee and limit rows', async ({ page }) => {
  await open(page, { keysets: KS_FEE })
  const note = group(page).locator('.md-fl-note')
  await expect(note).toHaveText('declared by the mint in /v1/info · fetched 5 min ago')
  await expect(note.locator('span[title]')).toHaveAttribute('title', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/)
  // no explanation hides in a title attribute
  await expect(group(page).locator('[title]:not(span[title])')).toHaveCount(0)
  await expect(group(page)).not.toContainText(/input fee$/im)
  await expect(group(page)).not.toContainText('Declared limits')
  await expect(group(page).locator('.md-fl-group-label')).toHaveCount(0)
  const border = (loc: ReturnType<typeof fees>) => loc.locator('.md-info-row').last().evaluate(el => getComputedStyle(el).borderBottomWidth)
  expect(await border(fees(page))).toBe('1px')
  expect(await border(limits(page))).toBe('0px')
})

test('the explanatory sentence is not in the card body; it is in the header tooltip, which opens by click and by keyboard', async ({ page }) => {
  await open(page, { keysets: KS_FEE })
  await layoutReady(page)
  // not visible in the card body, and not in the DOM at all while the tooltip is closed
  await expect(group(page).getByText('Lightning fee reserves')).toHaveCount(0)
  await expect(group(page).locator('.md-fl-note')).not.toContainText('Lightning fee reserves')
  const btn = infoButton(page)
  await expect(btn).toHaveCount(1)
  await expect(btn).toHaveAttribute('aria-label', 'More information about Fees and limits')
  const tip = page.locator('[role="tooltip"]')
  // by click
  await btn.click()
  await expect(btn).toHaveAttribute('aria-describedby', /.+/)
  await expect(tip).toHaveText(SENTENCE)
  await expect(group(page).locator('.md-fl-note')).not.toContainText('Lightning fee reserves')
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  // by keyboard
  await page.locator('body').click({ position: { x: 1, y: 1 } })
  await btn.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(btn).toBeFocused()
  await expect(tip).toHaveText(SENTENCE)
  await page.keyboard.press('Escape')
  await expect(tip).toHaveCount(0)
  await expect(btn).toBeFocused()
})

test('it is the first card of the NUTs tab, before NUT compatibility, and no longer on the Overview; the old "NUT limits" card is gone', async ({ page }) => {
  await open(page, { keysets: KS_FEE })
  await expect(group(page)).toBeVisible()
  const titles = await page.locator('.md-panel-title').allInnerTexts()
  const i = titles.findIndex(t => /^Fees and limits$/i.test(t))
  const j = titles.findIndex(t => /^NUT compatibility$/i.test(t))
  expect(i).toBeGreaterThanOrEqual(0)
  expect(j).toBeGreaterThan(i)
  expect(titles.slice(0, i).filter(t => !/^Keysets$/i.test(t))).toEqual([])
  expect(titles.some(t => /^NUT limits$/i.test(t))).toBe(false)
  expect(await page.locator('.md-tab').allInnerTexts()).not.toContain('Fees')
  await page.locator('.md-tab', { hasText: /^Overview/ }).click()
  await expect(page.getByText('Mint info', { exact: true })).toBeVisible()
  await expect(group(page)).toHaveCount(0)
})

test('the Overview itself has no Fees and limits group', async ({ page }) => {
  await open(page, { keysets: KS_FEE, overview: true })
  await expect(page.getByText('Mint info', { exact: true })).toBeVisible()
  await expect(group(page)).toHaveCount(0)
  await expect(page.locator('.md-panel-title', { hasText: /^Fees and limits$/ })).toHaveCount(0)
})

test('no request to a mint is made by the group: only our own API is contacted', async ({ page }) => {
  const hosts = new Set<string>()
  page.on('request', r => { const u = new URL(r.url()); if (u.protocol.startsWith('http')) hosts.add(u.host) })
  await open(page, { keysets: KS_FEE })
  await expect(group(page)).toBeVisible()
  const own = new URL(page.url()).host
  expect([...hosts].filter(h => h !== own)).toEqual([])
})

const HELD_CASES = [
  { name: 'a fee row (two lines)', keysets: KS_FEE, shown: '0.1 sat per coin · 100 ppk' },
  { name: 'a "No input fee" row (one line)', keysets: [{ id: '00ad268c4d1f5826', unit: 'sat', active: true, input_fee_ppk: 0 }], shown: 'No input fee' },
] as const

for (const [w, h] of [[1440, 900], [390, 844], [320, 640]] as const) for (const c of HELD_CASES) {
test(`while the probe is held the group keeps its place; releasing it shifts nothing noticeable (${w}px, ${c.name})`, async ({ page }) => {
  let letThrough!: () => void
  const hold = new Promise<void>(res => { letThrough = res })
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __obs: PerformanceObserver }
    w.__cls = 0
    w.__obs = new PerformanceObserver(list => {
      for (const e of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) if (!e.hadRecentInput) w.__cls += e.value
    })
    w.__obs.observe({ type: 'layout-shift', buffered: true })
  })
  const m = await open(page, { keysets: c.keysets, hold }, [w, h])
  await expect.poll(() => m.reached(), { message: 'the probe request reached the mock' }).toBe(1)
  await expect(group(page)).toBeVisible()
  await expect(fees(page)).toContainText('Checking keysets')
  await expect(fees(page)).not.toContainText('Keyset data not available yet')
  await layoutReady(page)
  const before = (await group(page).boundingBox())!.height
  const shift = () => page.evaluate(() => { const w = window as unknown as { __cls: number; __obs: PerformanceObserver }; w.__obs.takeRecords(); return w.__cls })
  const clsBefore = await shift()
  letThrough()
  await expect(fees(page).locator('.md-info-value')).toContainText(c.shown)
  await layoutReady(page)
  const after = (await group(page).boundingBox())!.height
  // the reserved row height is the midpoint of a one-line and a two-line row: 12px on desktop (as before), 20px where the value sits under the label (<= 480px)
  expect(Math.abs(after - before), `placeholder ${before}px vs loaded ${after}px`).toBeLessThanOrEqual(w <= 480 ? 20 : 12)
  expect((await shift()) - clsBefore).toBeLessThan(0.02)
})
}

for (const [w, h] of [[1440, 900], [768, 1024], [390, 844], [320, 640]] as const) {
  test(`layout at ${w}px: no horizontal overflow, text at least 12px on phones, rows wrap inside the panel`, async ({ page }) => {
    await open(page, {
      keysets: [...KS_FEE, { id: '01bbbbbbbbbbbbbb', unit: 'usd', active: true, input_fee_ppk: 999 }],
      known: { units: ['sat', 'usd'], mintMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 1000000 }, { method: 'bolt12', unit: 'usd', min_amount: 100 }], meltMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 1000000000 }] },
    }, [w, h])
    await expect(group(page)).toBeVisible()
    await layoutReady(page)
    const m = await group(page).evaluate(panel => {
      const pr = panel.getBoundingClientRect()
      const out: string[] = []
      for (const el of panel.querySelectorAll<HTMLElement>('*')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > pr.right + 1 || r.left < pr.left - 1) out.push(`${el.className || el.tagName} sticks out`)
      }
      const small: string[] = []
      for (const el of panel.querySelectorAll<HTMLElement>('*')) {
        if (!(el.childNodes.length && [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim()))) continue
        const px = parseFloat(getComputedStyle(el).fontSize)
        if (px < 12) small.push(`${el.className || el.tagName} ${px}px`)
      }
      return { out, small, docOverflow: document.documentElement.scrollWidth - window.innerWidth }
    })
    expect(m.out).toEqual([])
    expect(m.docOverflow).toBeLessThanOrEqual(0)
    if (w <= 480) expect(m.small).toEqual([])
  })
}
