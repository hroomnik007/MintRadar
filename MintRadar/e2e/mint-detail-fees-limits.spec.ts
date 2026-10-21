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

test('a mint with an input fee: examples for 1 / 16 / 100 proofs, rounded up, in the unit', async ({ page }) => {
  await open(page, { keysets: KS_FEE })
  await expect(group(page)).toBeVisible()
  await expect(group(page).locator('.md-panel-title')).toHaveText('Fees and limits')
  await expect(fees(page).locator('.md-info-row')).toHaveCount(1)
  await expect(fees(page).locator('.md-info-label')).toHaveText('sat')
  await expect(fees(page).locator('.md-info-value')).toHaveText('Spending 1 / 16 / 100 proofs: 1 / 2 / 10 sat')
})

test('the effective fee is the largest of the ACTIVE keysets; several units get a row each', async ({ page }) => {
  await open(page, { keysets: [
    ...KS_FEE,
    { id: '00aaaaaaaaaaaaaa', unit: 'sat', active: true, input_fee_ppk: 250 },
    { id: '01bbbbbbbbbbbbbb', unit: 'usd', active: true, input_fee_ppk: 1000 },
  ] })
  await expect(fees(page).locator('.md-info-row')).toHaveCount(2)
  await expect(fees(page).locator('.md-info-value')).toHaveText([
    'Spending 1 / 16 / 100 proofs: 1 / 4 / 25 sat',
    'Spending 1 / 16 / 100 proofs: 1 / 16 / 100 usd',
  ])
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

test('the muted sentence names /v1/info and the quote-time fee reserves; the source time carries the absolute UTC time', async ({ page }) => {
  await open(page, { keysets: KS_FEE })
  const note = group(page).locator('.md-fl-note')
  await expect(note).toContainText('Limits are declared by the mint in /v1/info.')
  await expect(note).toContainText('Lightning fee reserves depend on the invoice and are only known when a quote is requested')
  await expect(note).toContainText('declared by the mint in /v1/info · fetched 5 min ago')
  await expect(note.locator('span[title]')).toHaveAttribute('title', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/)
  // no explanation hides in a title attribute, and the group has no tooltip of its own
  await expect(group(page).locator('[title]:not(span[title])')).toHaveCount(0)
  await expect(group(page).locator('.info-tooltip')).toHaveCount(0)
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

test('while the probe is held the group keeps its place; releasing it shifts nothing noticeable', async ({ page }) => {
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
  const m = await open(page, { keysets: KS_FEE, hold })
  await expect.poll(() => m.reached(), { message: 'the probe request reached the mock' }).toBe(1)
  await expect(group(page)).toBeVisible()
  await expect(fees(page)).toContainText('Checking keysets')
  await expect(fees(page)).not.toContainText('Keyset data not available yet')
  await layoutReady(page)
  const before = (await group(page).boundingBox())!.height
  const shift = () => page.evaluate(() => { const w = window as unknown as { __cls: number; __obs: PerformanceObserver }; w.__obs.takeRecords(); return w.__cls })
  const clsBefore = await shift()
  letThrough()
  await expect(fees(page).locator('.md-info-value')).toHaveText('Spending 1 / 16 / 100 proofs: 1 / 2 / 10 sat')
  await layoutReady(page)
  const after = (await group(page).boundingBox())!.height
  expect(Math.abs(after - before), `placeholder ${before}px vs loaded ${after}px`).toBeLessThanOrEqual(12)
  expect((await shift()) - clsBefore).toBeLessThan(0.02)
})

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
