import { test, expect, type Page, type Route } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { frames, layoutReady, resize, trackRequests } from './fixtures/settle'

// Mint Detail "Change log" (Overview): the confirmed changes in a mint's public data, fetched lazily from
// /api/mints/changes. Facts with a time: plain-words type, old → new, relative time with the absolute UTC time in title,
// "seen first" only for a late confirmation. A failed request is a calm sentence, never "no changes".

const ALPHA = MOCK_MINTS[0]!.url
const H = 3_600_000
const D = 24 * H
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const SINCE = '2026-10-05T08:00:00.000Z'

interface Row { type: string; field: string; oldValue: string | null; newValue: string | null; observedAt: string; firstSeenAt: string }
const row = (i: number, o: Partial<Row> = {}): Row => ({
  type: 'motd_changed', field: 'motd', oldValue: `old text ${i}`, newValue: `new text ${i}`, observedAt: ago(i * H), firstSeenAt: ago(i * H + 5 * 60_000), ...o,
})
const answer = (changes: Row[], trackingSince: string | null = SINCE) => ({ url: ALPHA, trackingSince, changes })

/** The route is held until the request reached the mock (never released by a timer); `release()` lets it through. */
function held(body: () => { status?: number; json: unknown }) {
  let letThrough!: () => void
  const gate = new Promise<void>(done => { letThrough = done })
  const requests: string[] = []
  return {
    requests,
    release: letThrough,
    handler: async (route: Route) => {
      requests.push(route.request().url())
      await gate
      const b = body()
      await route.fulfill({ status: b.status ?? 200, json: b.json })
    },
  }
}

async function observeShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __obs: PerformanceObserver }
    w.__cls = 0
    w.__obs = new PerformanceObserver(list => {
      for (const e of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) if (!e.hadRecentInput) w.__cls += e.value
    })
    w.__obs.observe({ type: 'layout-shift', buffered: true })
  })
}
const shiftTotal = (page: Page): Promise<number> =>
  page.evaluate(() => { const w = window as unknown as { __cls: number; __obs: PerformanceObserver }; w.__obs.takeRecords(); return w.__cls })

async function open(page: Page, body: unknown | (() => { status?: number; json: unknown }), opts: { width?: number; height?: number; hash?: string } = {}) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  if (typeof body === 'function') {
    const fn = body as () => { status?: number; json: unknown }
    await page.route('**/api/mints/changes**', r => { const b = fn(); return r.fulfill({ status: b.status ?? 200, json: b.json }) })
  } else {
    await page.route('**/api/mints/changes**', r => r.fulfill({ json: body }))
  }
  await resize(page, opts.width ?? 1440, opts.height ?? 900)
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}${opts.hash ?? ''}`)
}

const panel = (page: Page) => page.getByTestId('change-log')
const rows = (page: Page) => panel(page).getByTestId('change-row')

/** No horizontal scroll on the page, and the panel and every row end inside the viewport. */
async function expectContained(page: Page) {
  await layoutReady(page)
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const p = document.querySelector('[data-testid="change-log"]')!.getBoundingClientRect()
    const rights = [...document.querySelectorAll('[data-testid="change-log"] *')].map(e => e.getBoundingClientRect().right)
    return { sw: document.documentElement.scrollWidth, vw, panelRight: p.right, maxRight: Math.max(...rights) }
  })
  expect(m.sw, 'no horizontal page scroll').toBeLessThanOrEqual(m.vw + 1)
  expect(m.panelRight, 'panel inside the viewport').toBeLessThanOrEqual(m.vw + 1)
  expect(m.maxRight, 'nothing inside the panel sticks out').toBeLessThanOrEqual(m.vw + 1)
}

test.describe('Change log: a mint with history', () => {
  test('rows in plain words with old → new, relative time (UTC title) and "seen first" only for a late confirmation', async ({ page }) => {
    await open(page, answer([
      row(2, { type: 'pubkey_changed', field: 'pubkey', oldValue: '02' + 'ab'.repeat(32), newValue: '03' + 'cd'.repeat(32) }),
      row(30, { type: 'input_fee_changed', field: 'input_fee', oldValue: 'sat: 0 ppk', newValue: 'sat: 100 ppk', firstSeenAt: ago(30 * H + 70 * 60_000) }),
      row(3 * 24, { type: 'keyset_added', field: 'keyset', oldValue: null, newValue: '00aabbccddeeff00 (sat, active, 0 ppk)', firstSeenAt: ago(3 * 24 * H + 3 * H) }),
    ]))
    await expect(panel(page).locator('.md-panel-title')).toHaveText('Change log')
    await expect(rows(page)).toHaveCount(3)

    const first = rows(page).nth(0)
    await expect(first.locator('.md-change-type')).toHaveText('Public key changed')
    await expect(first.locator('.md-change-old')).toHaveText('02' + 'ab'.repeat(32))
    await expect(first.locator('.md-change-new')).toHaveText('03' + 'cd'.repeat(32))
    await expect(first.locator('time.md-change-time')).toHaveText('2h ago')
    await expect(first.locator('time.md-change-time')).toHaveAttribute('title', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/)
    await expect(first.locator('.md-change-first')).toHaveCount(0) // confirmed one interval after the first sighting

    const fee = rows(page).nth(1)
    await expect(fee.locator('.md-change-type')).toHaveText('Input fee changed')
    await expect(fee.locator('.md-change-vals')).toHaveText('sat: 0 ppk→sat: 100 ppk')
    await expect(fee.locator('.md-change-first')).toHaveCount(0) // 70 min is the keysets interval plus ten minutes, not clearly longer

    const added = rows(page).nth(2)
    await expect(added.locator('.md-change-type')).toHaveText('Keyset added')
    await expect(added.locator('.md-change-old')).toHaveText('—')
    await expect(added.locator('.md-change-first')).toHaveText(/^seen first 3d ago$/)
    await expect(added.locator('.md-change-first time')).toHaveAttribute('title', /UTC$/)
  })

  test('the type labels never judge: no verdict word anywhere in the panel', async ({ page }) => {
    await open(page, answer([row(1, { type: 'pubkey_changed', field: 'pubkey' }), row(2, { type: 'methods_changed', field: 'methods' }), row(3, { type: 'version_changed', field: 'version' })]))
    await expect(rows(page)).toHaveCount(3)
    expect(await panel(page).innerText()).not.toMatch(/suspicious|warning|unsafe|scam|danger|risk|rug|fraud/i)
  })

  test('the day-summary row shows only "multiple changes"', async ({ page }) => {
    await open(page, answer([row(1, { oldValue: null, newValue: 'multiple changes' })]))
    await expect(rows(page).first().locator('.md-change-merged')).toHaveText('multiple changes')
    await expect(rows(page).first().locator('.md-change-arrow')).toHaveCount(0)
  })
})

test.describe('Change log: a mint without history', () => {
  test('"No changes recorded yet." and the date tracking started', async ({ page }) => {
    await open(page, answer([]))
    await expect(panel(page).locator('.md-changes-empty')).toContainText('No changes recorded yet.')
    await expect(panel(page).locator('.md-changes-since')).toHaveText('Tracking since 5 Oct 2026')
    await expect(rows(page)).toHaveCount(0)
    await expect(panel(page).getByRole('button')).toHaveCount(0)
  })

  test('without a tracking date the muted line is left out', async ({ page }) => {
    await open(page, answer([], null))
    await expect(panel(page).locator('.md-changes-empty')).toContainText('No changes recorded yet.')
    await expect(panel(page).locator('.md-changes-since')).toHaveCount(0)
  })
})

test.describe('Change log: 60 changes', () => {
  test('the newest 10 show, "Show all (60)" expands, "Show fewer" folds back', async ({ page }) => {
    await open(page, answer(Array.from({ length: 60 }, (_, i) => row(i + 1, { newValue: `new text ${i + 1}` }))))
    await expect(rows(page)).toHaveCount(10)
    await expect(rows(page).first().locator('.md-change-new')).toHaveText('new text 1')
    await expect(rows(page).nth(9).locator('.md-change-new')).toHaveText('new text 10')
    const toggle = panel(page).getByRole('button', { name: 'Show all (60)' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(rows(page)).toHaveCount(60)
    await expect(panel(page).getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
    await expectContained(page)
    await panel(page).getByRole('button', { name: 'Show fewer' }).click()
    await expect(rows(page)).toHaveCount(10)
  })
})

test.describe('Change log: long values never widen the page', () => {
  const LONG_TOKEN = `${'x'.repeat(40)}-${'y'.repeat(40)}-${'z'.repeat(38)}`
  const LONG = `Operators of this mint reserve the right to change fees, limits and availability without notice. ${LONG_TOKEN} ${LONG_TOKEN}`.slice(0, 200)
  const data = () => answer([
    row(1, { type: 'pubkey_changed', field: 'pubkey', oldValue: '02' + 'ab'.repeat(32), newValue: '03' + 'cd'.repeat(32) }),
    row(2, { oldValue: LONG, newValue: LONG_TOKEN + LONG_TOKEN }),
    row(3, { type: 'description_changed', field: 'description', oldValue: LONG, newValue: LONG, firstSeenAt: ago(3 * H + 9 * D) }),
    row(4, { type: 'contact_changed', field: 'contact', oldValue: 'email, nostr, twitter, other (4)', newValue: 'email (1)' }),
  ])

  for (const width of [320, 390, 768, 1440]) {
    test(`${width} px: wraps, no horizontal scroll, nothing sticks out`, async ({ page }) => {
      await open(page, data(), { width, height: width >= 768 ? 900 : 800 })
      await expect(rows(page)).toHaveCount(4)
      await expectContained(page)
      // each value wraps inside its row
      const overflowing = await page.evaluate(() => [...document.querySelectorAll('[data-testid="change-row"]')]
        .filter(r => r.scrollWidth > r.clientWidth + 1).length)
      expect(overflowing, 'rows whose content is wider than the row').toBe(0)
    })
  }
})

test.describe('Change log: the request fails', () => {
  test('a calm sentence with Try again, never "no changes"; Try again asks again', async ({ page }) => {
    let fail = true
    await open(page, () => (fail ? { status: 500, json: { error: 'secret-internal-detail' } } : { json: answer([row(1)]) }))
    const alert = panel(page).getByRole('alert')
    await expect(alert).toContainText('Change log is not available right now.')
    await expect(panel(page)).not.toContainText('No changes recorded yet.')
    await expect(panel(page)).not.toContainText('secret-internal-detail')
    await expect(rows(page)).toHaveCount(0)
    fail = false
    await alert.getByRole('button', { name: 'Try again' }).click()
    await expect(rows(page)).toHaveCount(1)
    await expect(panel(page).getByRole('alert')).toHaveCount(0)
  })

  test('an answer in the wrong shape is the same calm error', async ({ page }) => {
    await open(page, { nope: true })
    await expect(panel(page).getByRole('alert')).toContainText('Change log is not available right now.')
  })

  test('the rest of the Overview is untouched by a failing change log', async ({ page }) => {
    await open(page, () => ({ status: 500, json: {} }))
    await expect(panel(page).getByRole('alert')).toBeVisible()
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.getByText('Mint info', { exact: true })).toBeVisible()
  })
})

test.describe('Change log: lazy and stable', () => {
  test('requested only when the Overview is shown, once, for this mint', async ({ page }) => {
    trackRequests(page)
    const requests: string[] = []
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
    await page.route('**/api/mints/changes**', r => { requests.push(r.request().url()); return r.fulfill({ json: answer([row(1)]) }) })
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}#history`)
    await expect(page.locator('.md-tab.active')).toHaveText('History')
    await frames(page, 6)
    expect(requests, 'not requested while another tab is open').toEqual([])
    await page.locator('.md-tab', { hasText: 'Overview' }).click()
    await expect(rows(page)).toHaveCount(1)
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0]!).searchParams.get('url')).toBe(ALPHA)
  })

  test('while the request is held the panel keeps its place with a placeholder; releasing it shifts nothing noticeable', async ({ page }) => {
    const gate = held(() => ({ json: answer([]) }))
    await observeShift(page)
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
    await page.route('**/api/mints/changes**', gate.handler)
    await resize(page, 1440, 900)
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect.poll(() => gate.requests.length, { message: 'the request reached the mock' }).toBe(1)
    await expect(panel(page)).toHaveAttribute('aria-busy', 'true')
    await expect(panel(page).locator('.md-changes-placeholder')).toBeVisible()
    await expect(panel(page)).not.toContainText('No changes recorded yet.')
    await layoutReady(page)
    const before = (await panel(page).boundingBox())!.height
    const clsBefore = await shiftTotal(page)
    gate.release()
    await expect(panel(page).locator('.md-changes-empty')).toBeVisible()
    await layoutReady(page)
    const after = (await panel(page).boundingBox())!.height
    expect(Math.abs(after - before), `placeholder ${before}px vs loaded empty state ${after}px`).toBeLessThanOrEqual(12)
    expect((await shiftTotal(page)) - clsBefore).toBeLessThan(0.02)
  })
})

test.describe('Change log: mobile layout', () => {
  test('390 px: the panel sits in the Overview column, rows stack and fit', async ({ page }) => {
    await open(page, answer([row(1, { type: 'pubkey_changed', field: 'pubkey', oldValue: '02' + 'ab'.repeat(32), newValue: '03' + 'cd'.repeat(32) }), row(5)]), { width: 390, height: 844 })
    await expect(rows(page)).toHaveCount(2)
    await expectContained(page)
    const box = (await rows(page).first().boundingBox())!
    const panelBox = (await panel(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(panelBox.x)
    expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1)
    // the old and the new value sit on their own lines when they are long (wrapped flex row)
    const olds = await rows(page).first().locator('.md-change-old').boundingBox()
    const news = await rows(page).first().locator('.md-change-new').boundingBox()
    expect(news!.y).toBeGreaterThan(olds!.y)
  })

  test('the Show all button is a real, reachable control at 320 px', async ({ page }) => {
    await open(page, answer(Array.from({ length: 12 }, (_, i) => row(i + 1))), { width: 320, height: 640 })
    const toggle = panel(page).getByRole('button', { name: 'Show all (12)' })
    await toggle.scrollIntoViewIfNeeded()
    await expect(toggle).toBeInViewport()
    const box = (await toggle.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(16)
    await expectContained(page)
  })
})
