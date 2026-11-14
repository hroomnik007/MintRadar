import { test, expect } from '@playwright/test'
import {
  ALPHA, CZ_PAGE_URL, FRESH_8333, LNPAY_DETAIL, NO_8333, NOT_COVERED, ago,
  auditCzResponse, czDetail, czSwapList, gotoAuditTab, measureSettled,
} from './fixtures/auditCz'

type Page = import('@playwright/test').Page

// Audit tab, cashu.info branch (src/utils/auditCz.ts, MintDetail.tsx). Every endpoint is mocked
// (e2e/fixtures/auditCz.ts); nothing here reaches cashu.info or audit.8333.space.

const row = (page: Page, host: string) => page.locator('.audit-swaps-table tbody tr', { hasText: host })
const czLink = (page: Page) => page.getByRole('link', { name: 'Open on cashu.info →' })
// cashu.info view (2026-11-13 layout): the verdict, one bar, the direction figures by key, swaps per day and ONE swap
// list with a filter ("All | Deposits | Withdrawals | Failed"), 8 rows until "Show all".
const tile = (page: Page, key: string) => page.locator(`.au-dirs [data-tile="${key}"]`)
const tileValue = (page: Page, key: string) => tile(page, key).locator('.au-dir-value')
const verdict = (page: Page) => page.getByTestId('audit-verdict')
const checksCard = (page: Page) => page.getByTestId('audit-cz-checks')
const swapList = (page: Page) => page.getByTestId('audit-swap-list')
const chip = (page: Page, name: string) => swapList(page).getByRole('button', { name: new RegExp(`^${name} \\d+$`) })
/** Shows every row of the list (it shows 8 by default): expands only when there is something to expand. */
const expandFrom = async (page: Page) => {
  const card = swapList(page)
  await expect(card.locator('tbody tr').first()).toBeVisible()
  const b = card.locator('.audit-swaps-show-all-btn')
  if (await b.count()) await b.click()
}
/** The State cell's visible text: the visually hidden failure text is left out. */
const visibleState = (page: Page, host: string) =>
  row(page, host).locator('td').last().evaluate(td => {
    const copy = td.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.sr-only').forEach(e => e.remove())
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
  })
const segGroup = (page: Page) => page.getByRole('group', { name: 'Audit source' })

const ok = { kind: 'ok', durationMs: 1000 }
const melt = { kind: 'melt', status: 'failed', stage: 'melt', error: 'melt failed', durationMs: 500 }
const limits = { kind: 'limits', status: 'failed', stage: 'limits', error: 'Amount 3 sat is below the mint minimum of 100 sat', durationMs: null }
const balance = { kind: 'balance', status: 'failed', stage: 'balance', error: 'Insufficient balance: need 27 sat, have 20 sat', durationMs: null }
const pending = { kind: 'pending', status: 'pending', durationMs: null }

/** audit.8333.space has no data for Alpha, cashu.info covers it. */
const onlyCz = (swaps: ReturnType<typeof czSwapList>, extra: Record<string, unknown> = {}) =>
  ({ alpha: NO_8333, cz: auditCzResponse({ swaps, ...extra }) })

// ── a) cz is the only source ────────────────────────────────────
test('only cz has data: header, verdict, bar, directions, one swap list with a filter, safe link, no switch', async ({ page }) => {
  // 7 OK, 2 failed melts, 1 below-minimum row = 10 swaps from this mint, plus 2 swaps to it.
  const swaps = [
    ...czSwapList([ok, ok, melt, ok, ok, limits, ok, melt, ok, ok]),
    ...czSwapList([ok, ok]).map((s, i) => ({ ...s, id: `t${i}`, direction: 'to' as const, otherMintUrl: `https://src${i}.example`, at: ago((200 + i) * 60_000) })),
  ]
  await gotoAuditTab(page, onlyCz(swaps))

  const header = page.locator('.md-audit-header-main')
  await expect(header).toBeVisible()
  await expect(header).toHaveText(/^Audit stats\s*·\s*via cashu\.info/, { useInnerText: true })

  // The verdict is the score's 7-day window: 0 attributed of 126 swaps; the 19 failures of other causes are named, not counted.
  await expect(page.getByTestId('audit-verdict-num')).toHaveText('0')
  await expect(verdict(page)).toContainText('of 126 swaps failed because of this mint')
  await expect(verdict(page)).toContainText('19 swaps failed for other reasons and do not count against it.')
  await expect(page.getByTestId('audit-legend').locator('span')).toHaveText(['107 succeeded', '19 failed elsewhere', '0 caused by this mint'])
  // No long window in the response: neither of its lines is shown.
  await expect(page.getByTestId('audit-long-line')).toHaveCount(0)
  await expect(page.getByTestId('audit-since-line')).toHaveCount(0)

  // Directions and the average, in order; sentence case.
  await expect(page.locator('.au-dirs .au-dir')).toHaveCount(3)
  await expect(page.locator('.au-dirs .au-dir-value')).toHaveText(['56 of 62', '51 of 64', '8.3 s'])
  await expect(page.locator('.au-dirs .au-dir-label')).toHaveText(['Deposits (mint)', 'Withdrawals (melt)', 'Average swap time'])
  await expect(tile(page, 'mints').locator('.au-dir-sub')).toHaveText('6 failed')
  await expect(tile(page, 'melts').locator('.au-dir-sub')).toHaveText('13 failed')
  await expect(page.getByText('Success rate')).toHaveCount(0)
  expect(await tile(page, 'melts').locator('.au-dir-label').evaluate(e => getComputedStyle(e).textTransform)).toBe('none')

  await expect(checksCard(page)).toHaveCount(0)

  // One list with a filter; "All" first and pressed.
  await expect(swapList(page).getByRole('group', { name: 'Filter swaps' }).getByRole('button')).toHaveText(['All 12', 'Deposits 2', 'Withdrawals 10', 'Failed 2'])
  await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true')
  await expect(swapList(page).locator('th')).toHaveText(['When', 'Direction', 'Other mint', 'Amount', 'Fee', 'Duration', 'Result'])
  await expect(swapList(page).locator('tbody tr')).toHaveCount(8)
  await expect(swapList(page).locator('.audit-swaps-show-all-btn')).toHaveText('Show all (12)')
  await swapList(page).locator('.audit-swaps-show-all-btn').click()
  await expect(swapList(page).locator('tbody tr')).toHaveCount(12)
  await expect(swapList(page).locator('.audit-swaps-show-all-btn')).toHaveText('Show fewer')
  await chip(page, 'Deposits').click()
  await expect(chip(page, 'Deposits')).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'false')
  await expect(swapList(page).locator('tbody tr')).toHaveCount(2)
  await expect(swapList(page).locator('.audit-swaps-show-all-btn')).toHaveCount(0)
  await expect(swapList(page).locator('tbody tr').first().locator('td').nth(1)).toHaveText('Deposit')
  await expect(swapList(page).locator('tbody tr').first().locator('td').nth(2)).toHaveText('src0.example')
  // "Failed" leaves out the grey below-minimum row: it is not counted against the mint.
  await chip(page, 'Failed').click()
  await expect(swapList(page).locator('tbody tr')).toHaveCount(2)
  await expect(swapList(page).locator('tbody tr .au-res-fail')).toHaveCount(2)
  await chip(page, 'Withdrawals').click()
  await expect(swapList(page).locator('tbody tr')).toHaveCount(8) // a filter change folds the list again
  await expect(swapList(page).locator('.audit-swaps-show-all-btn')).toHaveText('Show all (10)')

  const link = czLink(page)
  await expect(link).toHaveCount(1)
  await expect(link).toHaveAttribute('rel', /\bnoopener\b/)
  await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('href', /^https:\/\/cashu\.info\/mint\//)

  await expect(page.locator('.md-audit-seg')).toHaveCount(0)
  await expect(segGroup(page)).toHaveCount(0)
  await expect(page.getByText('via audit.8333.space')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /audit\.8333\.space/ })).toHaveCount(0)
})

// ── b) the browser only talks to our own backend ────────────────
test('the browser never requests cashu.info: only /api/mints/audit-cz?direction=both&limit=100', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __csp: string[] }).__csp = []
    document.addEventListener('securitypolicyviolation', e => (window as unknown as { __csp: string[] }).__csp.push(e.blockedURI))
  })
  const h = await gotoAuditTab(page, onlyCz(czSwapList([ok, ok, ok])))
  await expect(page.locator('.md-audit-header-main')).toContainText('via cashu.info')

  const origin = new URL(page.url()).origin
  const external = h.requests.filter(u => /^https?:/.test(u) && new URL(u).origin !== origin)
  expect(external.filter(u => /audit|cashu\.cz|8333/i.test(u))).toEqual([])
  // CSP blocks a direct fetch before it becomes a request, so a blocked attempt is checked separately.
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.filter(u => /audit|cashu\.cz|8333/i.test(u)))).toEqual([])

  // Every /api/ request that mentions the audit is this one endpoint.
  const apiAudit = h.requests.filter(u => { const p = new URL(u); return p.pathname.startsWith('/api/') && /audit/i.test(p.pathname) })
  expect(apiAudit.length).toBeGreaterThan(0)
  for (const u of apiAudit) expect(new URL(u).pathname).toBe('/api/mints/audit-cz')
  const queries = h.czQueries()
  expect(queries.length).toBe(apiAudit.length)
  for (const q of queries) {
    expect(q.get('direction')).toBe('both')
    expect(q.get('limit')).toBe('100')
    expect(q.get('url')).toBe(ALPHA)
  }
})

// ── c) neutral rows ─────────────────────────────────────────────
test('limits, balance and pending rows are neutral, failures amber, OK green: one Result chip per row', async ({ page }) => {
  // 5 OK, 3 failed (melt), 3 limits, 2 balance, 1 pending, interleaved so no position implies the kind.
  const swaps = czSwapList([ok, melt, limits, ok, balance, pending, ok, melt, limits, balance, ok, limits, melt, ok])
  expect(swaps).toHaveLength(14)
  await gotoAuditTab(page, onlyCz(swaps))

  await expandFrom(page)
  await expect(swapList(page).locator('tbody tr')).toHaveCount(14)

  const state = (host: string) => expect.poll(() => visibleState(page, host))
  const style = (host: string) => row(page, host).locator('td').first().evaluate(td => {
    const s = getComputedStyle(td)
    return { color: s.color, opacity: s.opacity }
  })

  for (const host of ['melt1', 'melt7', 'melt12']) await state(`${host}.example`).toBe('failed (melt)')
  for (const host of ['limits2', 'limits8', 'limits11']) await state(`${host}.example`).toBe('below minimum')
  for (const host of ['balance4', 'balance9']) await state(`${host}.example`).toBe('auditor balance')
  await state('pending5.example').toBe('pending')
  for (const host of ['ok0', 'ok3', 'ok6', 'ok10', 'ok13']) await state(`${host}.example`).toBe('OK')

  // The Result chip carries the outcome: one class per kind, and a failed row is not the red of "caused by this mint".
  const res = (host: string) => row(page, host).locator('.au-res')
  for (const host of ['melt1', 'melt7', 'melt12']) await expect(res(`${host}.example`)).toHaveClass(/au-res-fail/)
  for (const host of ['ok0', 'ok3', 'ok6', 'ok10', 'ok13']) await expect(res(`${host}.example`)).toHaveClass(/au-res-ok/)
  for (const host of ['limits2', 'balance4', 'pending5']) await expect(res(`${host}.example`)).toHaveClass(/au-res-neutral/)
  const color = (host: string) => res(host).evaluate(e => getComputedStyle(e).color)
  const failed = await color('melt1.example')
  expect(failed).not.toBe(await color('ok0.example'))
  expect(failed).not.toBe(await color('limits2.example'))
  expect(failed).not.toBe(await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--red)'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c }))
  // limits, balance and pending share one neutral row style, the same opacity as an OK row.
  const neutral = [await style('limits2.example'), await style('balance4.example'), await style('pending5.example')]
  const okRow = await style('ok0.example')
  for (const n of neutral) expect(n.opacity).toBe(okRow.opacity)
  expect(neutral[1]).toEqual(neutral[0])
  expect(neutral[2]).toEqual(neutral[0])
  // The filter counts follow the same split: 3 failed, the 6 neutral rows are not among them.
  await expect(chip(page, 'Failed')).toHaveText('Failed 3')
  // The old outcome strip is gone.
  await expect(page.locator('.audit-swap-bar')).toHaveCount(0)
})

// ── d) tiles, checks and tables from the stored detail ──────────
test.describe('verdict and directions from the stored detail', () => {
  const cleanCase = (total: number, failed: number, blamed: number) => czDetail({ swaps7d: { ...LNPAY_DETAIL.swaps7d, errorsBlamed: blamed, all: { ...LNPAY_DETAIL.swaps7d.all, total, failed, success: total - failed } } })
  const num = (page: Page) => page.getByTestId('audit-verdict-num')
  const legend = (page: Page) => page.getByTestId('audit-legend').locator('span')

  test('LNpay-like: 0 attributed of 105 with 16 failed', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: cleanCase(105, 16, 0) }))
    await expect(num(page)).toHaveText('0')
    await expect(num(page)).not.toHaveClass(/au-verdict-num-bad/)
    await expect(verdict(page)).toContainText('of 105 swaps failed because of this mint')
    await expect(verdict(page)).toContainText('16 swaps failed for other reasons and do not count against it.')
    await expect(legend(page)).toHaveText(['89 succeeded', '16 failed elsewhere', '0 caused by this mint'])
    await expect(page.locator('.au-stack .au-seg-mint')).toHaveCount(0) // red only when the mint caused a failure
  })

  test('lnw.cash-like: 202 attributed of 229 with 207 failed', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: cleanCase(229, 207, 202) }))
    await expect(num(page)).toHaveText('202')
    await expect(num(page)).toHaveClass(/au-verdict-num-bad/)
    await expect(verdict(page)).toContainText('of 229 swaps failed because of this mint')
    await expect(verdict(page)).toContainText('5 swaps failed for other reasons and do not count against it.')
    await expect(legend(page)).toHaveText(['22 succeeded', '5 failed elsewhere', '202 caused by this mint'])
    await expect(page.locator('.au-stack .au-seg-mint')).toHaveCount(1)
  })

  test('no failed swaps: one sentence, a bar of one colour', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: cleanCase(50, 0, 0) }))
    await expect(verdict(page)).toContainText('Every swap of the last 7 days succeeded.')
    await expect(page.locator('.au-stack i')).toHaveCount(1)
    await expect(page.locator('.au-stack .au-seg-ok')).toHaveCount(1)
  })

  test('fewer than 10 swaps still shows the numbers', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: cleanCase(4, 0, 0) }))
    await expect(num(page)).toHaveText('0')
    await expect(verdict(page)).toContainText('of 4 swaps failed because of this mint')
  })

  test('one other failure and one swap use the singular', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: cleanCase(50, 1, 0) }))
    await expect(verdict(page)).toContainText('1 swap failed for other reasons and does not count against it.')
    await gotoAuditTab(page, onlyCz([], { detail: cleanCase(50, 2, 2) }))
    await expect(verdict(page)).toContainText('No other swap failed.')
  })

  test('blamed above total is clamped', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: cleanCase(20, 20, 999) }))
    await expect(num(page)).toHaveText('20')
    await expect(legend(page)).toHaveText(['0 succeeded', '0 failed elsewhere', '20 caused by this mint'])
  })

  test('total 0: no verdict and no bar, the directions stay', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: cleanCase(0, 0, 0) }))
    await expect(page.locator('.au-dirs .au-dir')).toHaveCount(3)
    await expect(verdict(page)).toHaveCount(0)
    await expect(page.locator('.au-stack')).toHaveCount(0)
  })

  test('the points pill repeats the breakdown row; the long window and the since line appear when the server sends them', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { long: { windowDays: 28, swaps: 410, attributedFailures: 2 }, since: { day: '2026-08-01', swaps: 900, attributedFailures: 3 } }))
    await expect(page.getByTestId('audit-long-line')).toHaveText('Last 28 days: 2 of 410 swaps failed because of this mint.')
    await expect(page.getByTestId('audit-since-line')).toHaveText('Since 1 Aug 2026: 3 of 900 swaps.')
    const pill = page.getByTestId('audit-points-pill')
    const row = page.locator('.md-reliability-panel .rb-row', { hasText: 'Audit reliability (25%)' }).locator('.rb-row-score')
    const pts = ((await row.textContent()) ?? '').replace('/', ' / ')
    await expect(pill).toHaveText(`Audit part ${pts}`)
  })

  test('a direction without numbers reads "No data"; under a second the average is in ms', async ({ page }) => {
    const rest: Record<string, unknown> = { ...LNPAY_DETAIL.swaps7d }
    delete rest['asSource']
    await gotoAuditTab(page, onlyCz([], { detail: czDetail({ swaps7d: { ...rest, all: { ...LNPAY_DETAIL.swaps7d.all, avgMs: 640 } } }) }))
    await expect(page.locator('.au-dirs .au-dir')).toHaveCount(3)
    await expect(tileValue(page, 'melts')).toHaveText('No data')
    await expect(tile(page, 'melts').locator('.au-dir-sub')).toHaveCount(0)
    await expect(tileValue(page, 'mints')).toHaveText('56 of 62')
    await expect(tileValue(page, 'avg')).toHaveText('640 ms')
  })

  test('swaps per day: one column per day with its count; absent while no day has a swap', async ({ page }) => {
    const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10)
    const daily7d = [6, 5, 4, 3, 2, 1, 0].map(b => ({ day: day(b), ok: b === 0 ? 3 : b === 2 ? 1 : 0, failed: b === 0 ? 1 : 0, other: 0 }))
    await gotoAuditTab(page, onlyCz([], { daily7d }))
    const days = page.getByTestId('audit-days')
    await expect(days.locator('.au-day')).toHaveCount(7)
    await expect(days.locator('.au-day-count')).toHaveText(['', '', '', '', '1', '', '4'])
    await expect(days.locator('.au-day').last().locator('.au-seg-fail')).toHaveCount(1)
    await gotoAuditTab(page, onlyCz([], { daily7d: daily7d.map(d => ({ ...d, ok: 0, failed: 0 })) }))
    await expect(verdict(page)).toBeVisible()
    await expect(page.getByTestId('audit-days')).toHaveCount(0)
  })

  test('the info icons carry the honest tooltips', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([]))
    const expected: Record<string, string> = {
      mints: 'Deposits into this mint (mint operations) in the last 7 days, counted by cashu.info: successful of all.',
      melts: 'Withdrawals from this mint (melt operations) in the last 7 days, counted by cashu.info: successful of all.',
    }
    for (const [key, text] of Object.entries(expected)) {
      await tile(page, key).locator('.info-tooltip').hover()
      await expect(page.getByRole('tooltip')).toHaveText(text)
      // A standard tooltip: sentence case and normal spacing.
      const pop = await page.getByRole('tooltip').evaluate(e => { const c = getComputedStyle(e); return { t: c.textTransform, l: c.letterSpacing, f: c.fontSize } })
      expect(pop).toEqual({ t: 'none', l: 'normal', f: '10px' })
      await page.mouse.move(0, 0)
    }
    // Average swap time has no ⓘ: its label says it, and the window and source are in the sibling tooltips.
    await expect(tile(page, 'avg').locator('.info-tooltip')).toHaveCount(0)
  })
})

test.describe('the swap list', () => {
  test('no swaps in the window: one sentence, no table and no filter', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([]))
    await expect(page.getByTestId('audit-swaps-empty')).toHaveText('No swaps collected in the last 7 days.')
    await expect(page.locator('.audit-swaps-table')).toHaveCount(0)
    await expect(swapList(page)).toHaveCount(0)
  })

  test('only deposits: the Withdrawals filter says that nothing matches', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, ok]).map(s => ({ ...s, direction: 'to' as const }))))
    await expect(swapList(page).getByRole('group', { name: 'Filter swaps' }).getByRole('button')).toHaveText(['All 2', 'Deposits 2', 'Withdrawals 0', 'Failed 0'])
    await chip(page, 'Withdrawals').click()
    await expect(page.getByTestId('audit-swaps-none')).toHaveText('No swaps match this filter.')
    await chip(page, 'Deposits').click()
    await expect(swapList(page).locator('tbody tr')).toHaveCount(2)
  })

  test('a swap older than 7 days is not listed: the list is the window of the figures above it', async ({ page }) => {
    const swaps = czSwapList([ok, ok, ok])
    swaps[2] = { ...swaps[2]!, at: ago(8 * 86_400_000) }
    await gotoAuditTab(page, onlyCz(swaps))
    await expect(swapList(page).locator('tbody tr')).toHaveCount(2)
    await expect(chip(page, 'All')).toHaveText('All 2')
  })
})

// ── f) cz does not cover the mint ───────────────────────────────
// audit.8333.space is no longer shown at all (no answer since 2026-09-27), whatever its stored data says.
test.describe('cz does not cover the mint (covered: false)', () => {
  for (const [name, alpha] of [['no 8333 data', NO_8333], ['fresh 8333 data in the payload', FRESH_8333]] as const) {
    test(`${name}: "No audit data available", nothing names audit.8333.space, no strip, no switch`, async ({ page }) => {
      const h = await gotoAuditTab(page, { alpha, cz: NOT_COVERED })
      await expect(page.getByText('No audit data available for this mint.')).toBeVisible()
      await expect(page.getByText('Loading audit data…')).toHaveCount(0)
      expect(h.czQueries().length).toBeGreaterThan(0) // the answer really came from the endpoint
      await expect(page.locator('.md-audit-header')).not.toContainText('8333')
      await expect(page.getByRole('link', { name: /audit\.8333\.space/ })).toHaveCount(0)
      await expect(page.locator('.au-dirs')).toHaveCount(0)
      await expect(segGroup(page)).toHaveCount(0)
    })
  }
  test('with cashu.info data and fresh 8333 data: only the cashu.info view', async ({ page }) => {
    await gotoAuditTab(page, { alpha: FRESH_8333, cz: auditCzResponse({ swaps: czSwapList([ok, ok]) }) })
    await expect(page.locator('.md-audit-header-main')).toContainText('via cashu.info')
    await expect(segGroup(page)).toHaveCount(0)
    await expect(page.locator('.md-audit-collapsible')).not.toContainText('8333')
  })
})

// ── g) loading state ────────────────────────────────────────────
test('while the audit-cz response is held: "Loading audit data…", then the cz card, no 8333 flash', async ({ page }) => {
  // Records whether the audit.8333.space panel (or its empty state) is ever in the DOM.
  await page.addInitScript(() => {
    const w = window as unknown as { __flash8333: boolean }
    w.__flash8333 = false
    const check = () => {
      const text = document.body?.textContent ?? ''
      if (text.includes('No audit data available for this mint.') || text.includes('via audit.8333.space')) w.__flash8333 = true
    }
    new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true })
  })
  // Held until the test releases it (deterministic, unlike a fixed delay).
  let release!: () => void
  const hold = new Promise<void>(r => { release = r })
  const h = await gotoAuditTab(page, { ...onlyCz(czSwapList([ok, ok, ok, melt])), hold })

  const loading = page.getByRole('status').filter({ hasText: 'Loading audit data…' })
  await expect(loading).toBeVisible()
  await expect.poll(() => h.heldAtMock(), { message: 'the audit-cz request is in flight at the mock, held' }).toBe(true)
  // (the Reliability Score breakdown has its own, different "No audit data available" row: match the panel's full sentence)
  await expect(page.getByText('No audit data available for this mint.')).toHaveCount(0)
  await expect(page.locator('.md-audit-header, .md-audit-header-main, .au-dirs')).toHaveCount(0)

  release() // only after the request reached the mock (asserted above): it can never run ahead of it
  await expect(page.locator('.md-audit-header-main')).toContainText('via cashu.info')
  await expect(loading).toHaveCount(0)
  await expect(tileValue(page, 'melts')).toHaveText('51 of 64')
  expect(await page.evaluate(() => (window as unknown as { __flash8333: boolean }).__flash8333)).toBe(false)
})

// ── h) hostile data ─────────────────────────────────────────────
const XSS = '<img src=x onerror=alert(1)>'

test('hostile text from the endpoint is shown as text: no element, no dialog, no request', async ({ page }) => {
  const swaps = czSwapList([
    ok,
    { kind: 'err', status: 'failed', stage: 'melt', error: XSS, otherMintName: XSS },
    { kind: 'stage', status: 'failed', stage: XSS, error: XSS },
    { kind: 'url', otherMintUrl: XSS },
    ok,
  ])
  const h = await gotoAuditTab(page, onlyCz(swaps))
  await expandFrom(page)
  await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(5)

  // `stage` and the destination are displayed: literally, as text. (`error` and `otherMintName` are not shown.)
  expect(await visibleState(page, 'stage2.example')).toBe(`failed (${XSS})`)
  await expect(page.locator('.audit-swaps-table tbody tr').nth(3).locator('td').nth(2)).toHaveText(XSS)
  await expect(page.locator('.audit-swaps-table')).toContainText(XSS)

  // (the page has legitimate <img>s elsewhere, e.g. the mint icon: look at the audit card and for the payload itself)
  await expect(page.locator('.md-audit-collapsible img')).toHaveCount(0)
  await expect(page.locator('[onerror], img[src="x"]')).toHaveCount(0)
  expect(h.requests.filter(u => new URL(u).pathname === '/x')).toEqual([])
  expect(h.dialogs).toEqual([])
  // The dialog listener works (a real alert is recorded), so the empty list above is not vacuous.
  await page.evaluate(() => { alert('canary') })
  expect(h.dialogs).toEqual(['canary'])
})

test('hostile values in the detail fields are shown as nothing or as plain text: no element, no dialog, no request', async ({ page }) => {
  const detail = czDetail({
    swaps7d: {
      ...LNPAY_DETAIL.swaps7d,
      dleq: { valid: XSS, invalid: 0, missing: 0 },
      asSource: { total: XSS, success: XSS },
      all: { failed: XSS, avgMs: XSS },
      errorsBlamed: XSS,
    },
    integrity: { proof_state: { checked: XSS, spent: XSS, pending: XSS } },
  })
  const h = await gotoAuditTab(page, onlyCz(czSwapList([ok, ok]), { detail }))
  // Strings where numbers belong are not numbers: a direction reads "No data", the verdict and the average are hidden, nothing is printed.
  await expect(tileValue(page, 'melts')).toHaveText('No data')
  await expect(verdict(page)).toHaveCount(0)
  await expect(tile(page, 'avg')).toHaveCount(0)
  await expect(tileValue(page, 'mints')).toHaveText('56 of 62')
  await expect(checksCard(page)).toHaveCount(0)
  await expect(page.locator('.md-audit-collapsible')).not.toContainText('onerror')
  await expect(page.locator('.md-audit-collapsible img')).toHaveCount(0)
  await expect(page.locator('[onerror], img[src="x"]')).toHaveCount(0)
  expect(h.requests.filter(u => new URL(u).pathname === '/x')).toEqual([])
  expect(h.dialogs).toEqual([])
})

test.describe('the page link must be exactly https://cashu.info/mint/<id>', () => {
  const bad = [
    ['http scheme', 'http://cashu.info/mint/abc12345'],
    ['look-alike host (suffix)', 'https://cashu.info.evil.example/mint/abc12345'],
    ['look-alike host (prefix)', 'https://evilcashu.info/mint/abc12345'],
    ['userinfo trick', 'https://cashu.info@evil.example/mint/abc12345'],
    ['prefix only in the path', 'https://evil.example/https://cashu.info/mint/abc12345'],
    ['old host (not rendered any more)', 'https://audit.cashu.cz/mint/abc12345'],
    ['wrong path', 'https://cashu.info/evil/abc12345'],
    ['id too short', 'https://cashu.info/mint/abc'],
    ['trailing path', 'https://cashu.info/mint/abc12345/../x'],
    ['javascript: URL', 'javascript:alert(1)'],
    ['no URL', null],
  ] as const
  for (const [name, sourceUrl] of bad) {
    test(`${name}: no link, the card still renders`, async ({ page }) => {
      const h = await gotoAuditTab(page, onlyCz(czSwapList([ok, ok, melt]), { sourceUrl }))
      await expect(page.locator('.md-audit-header-main')).toContainText('via cashu.info')
      await expect(tileValue(page, 'melts')).toHaveText('51 of 64')
      await expect(page.locator('.audit-external-link')).toHaveCount(0)
      await expect(page.getByRole('link', { name: /cashu\.info/ })).toHaveCount(0)
      await expect(page.locator('.md-audit-collapsible a[href]')).toHaveCount(0)
      expect(h.dialogs).toEqual([])
    })
  }

  test('a valid page URL produces the link (control)', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, ok, melt])))
    await expect(czLink(page)).toHaveAttribute('href', CZ_PAGE_URL)
  })
})

// ── j) failure reason of a swap ─────────────────────────────────
// The State cell of every row that is not OK carries the error text as a tooltip (≤200 characters) and as
// visually hidden text (.sr-only); the visible text of the cell does not change.
test.describe('failure reason in the State cell', () => {
  const NO_ROUTE = 'Lightning payment failed: no_route.'
  const MIN_TEXT = 'Amount 61 sat is below the mint minimum of 100 sat'
  const BAL_TEXT = 'Insufficient balance: need 27 sat, have 20 sat'
  const LIMITS_WHY = "Not counted against the mint: the auditor's test was below the mint's minimum amount"
  const BALANCE_WHY = "Not counted against the mint: the auditor's wallet had too little balance"
  const stateCell = (page: Page, host: string) => row(page, host).locator('td').last()
  // The failure text is the State cell's tooltip (an InfoTooltip button around the state text), not a title attribute.
  const stateTip = async (page: Page, host: string) => {
    const trigger = stateCell(page, host).getByRole('button')
    await trigger.hover()
    const text = await page.getByRole('tooltip').textContent()
    await page.mouse.move(0, 0)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    return text
  }

  test('failed, below-minimum and balance rows: error text in the tooltip and in a hidden element, visible text unchanged', async ({ page }) => {
    const swaps = czSwapList([
      ok,
      { ...melt, error: NO_ROUTE },
      { ...limits, error: MIN_TEXT },
      { ...balance, error: BAL_TEXT },
      { ...pending, error: 'Waiting for the quote' },
    ])
    await gotoAuditTab(page, onlyCz(swaps))
    await expandFrom(page)
    await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(5)

    // red melt row
    const meltCell = stateCell(page, 'melt1.example')
    await expect(meltCell).not.toHaveAttribute('title', /.*/)
    expect(await stateTip(page, 'melt1.example')).toBe(NO_ROUTE)
    await expect(meltCell.locator('.sr-only')).toHaveText(NO_ROUTE)
    expect(await visibleState(page, 'melt1.example')).toBe('failed (melt)')
    // grey rows: the fixed explanation first, then the error text
    const limitsCell = stateCell(page, 'limits2.example')
    expect(await stateTip(page, 'limits2.example')).toBe(`${LIMITS_WHY}. ${MIN_TEXT}`)
    await expect(limitsCell.locator('.sr-only')).toHaveText(MIN_TEXT)
    expect(await visibleState(page, 'limits2.example')).toBe('below minimum')
    const balanceCell = stateCell(page, 'balance3.example')
    expect(await stateTip(page, 'balance3.example')).toBe(`${BALANCE_WHY}. ${BAL_TEXT}`)
    await expect(balanceCell.locator('.sr-only')).toHaveText(BAL_TEXT)
    expect(await visibleState(page, 'balance3.example')).toBe('auditor balance')
    // pending is not OK either
    expect(await stateTip(page, 'pending4.example')).toBe('Waiting for the quote')
    expect(await visibleState(page, 'pending4.example')).toBe('pending')

    // the hidden element is really hidden: 1px box, clipped, takes no room (cell text width = the visible text's)
    const hidden = await meltCell.locator('.sr-only').evaluate(el => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
      return { w: r.width, h: r.height, position: cs.position, overflow: cs.overflow }
    })
    expect(hidden).toEqual({ w: 1, h: 1, position: 'absolute', overflow: 'hidden' })
    // …but it is in the accessibility tree: the cell's accessible text includes it after the visible text
    await expect(meltCell).toContainText(`failed (melt) ${NO_ROUTE}`, { useInnerText: false })
  })

  test('a failed row without an error text has no tooltip and no hidden element; a grey row keeps the explanation', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, { ...melt, error: null }, { ...limits, error: null }, { ...melt, error: ' \n\t ' }])))
    await expandFrom(page)
    await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(4)
    await expect(stateCell(page, 'melt1.example').getByRole('button')).toHaveCount(0) // no tooltip without an error text
    await expect(stateCell(page, 'melt1.example').locator('.sr-only')).toHaveCount(0)
    expect(await stateTip(page, 'limits2.example')).toBe(LIMITS_WHY)
    await expect(stateCell(page, 'melt3.example').getByRole('button')).toHaveCount(0)
    await expect(stateCell(page, 'melt3.example').locator('.sr-only')).toHaveCount(0)
  })

  test('an OK row has neither a tooltip nor a hidden element, even when the endpoint sends an error text', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([{ ...ok, error: 'leftover text' }, ok, { ...melt, error: NO_ROUTE }])))
    await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(3)
    for (const host of ['ok0.example', 'ok1.example']) {
      await expect(stateCell(page, host)).not.toHaveAttribute('title', /.*/)
      await expect(stateCell(page, host).getByRole('button')).toHaveCount(0)
      await expect(stateCell(page, host).locator('.sr-only')).toHaveCount(0)
      expect(await visibleState(page, host)).toBe('OK')
    }
    // and nothing in the OK rows carries the text anywhere
    await expect(row(page, 'ok0.example')).not.toContainText('leftover text')
  })

  test('hostile error text appears only as text: no element, no dialog, no request', async ({ page }) => {
    const h = await gotoAuditTab(page, onlyCz(czSwapList([ok, { ...melt, error: XSS }, { ...limits, error: XSS }])))
    await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(3)
    for (const host of ['melt1.example', 'limits2.example']) {
      const cellEl = stateCell(page, host)
      await expect(cellEl.locator('.sr-only')).toHaveText(XSS)
      expect(await stateTip(page, host)).toMatch(new RegExp(`${XSS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
      // only the chip span, the tooltip button (with its text span) and the hidden span: nothing the text could have created
      await expect(cellEl.locator('*:not(button):not(span)')).toHaveCount(0)
      await expect(cellEl.locator('*')).toHaveCount(4)
    }
    await expect(page.locator('.md-audit-collapsible img')).toHaveCount(0)
    await expect(page.locator('[onerror], img[src="x"]')).toHaveCount(0)
    expect(h.requests.filter(u => new URL(u).pathname === '/x')).toEqual([])
    expect(h.dialogs).toEqual([])
  })

  test('control characters and extra whitespace are cleaned before use', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, { ...melt, error: '  Lightning\n\n payment\tfailed\u0000:\u202e  no_route.  ' }])))
    const cellEl = stateCell(page, 'melt1.example')
    expect(await stateTip(page, 'melt1.example')).toBe('Lightning payment failed: no_route.')
    await expect(cellEl.locator('.sr-only')).toHaveText('Lightning payment failed: no_route.')
  })

  test('a very long error text is truncated to 200 characters in the tooltip', async ({ page }) => {
    const long = `${'word '.repeat(60)}END` // 303 characters, the endpoint caps at 300
    await gotoAuditTab(page, onlyCz(czSwapList([ok, { ...melt, error: long.slice(0, 300) }, { ...limits, error: long.slice(0, 300) }])))
    const title = await stateTip(page, 'melt1.example')
    expect(title).not.toBeNull()
    expect(title!.length).toBeLessThanOrEqual(200)
    expect(title!.length).toBeGreaterThan(150)
    expect(title!.endsWith('…')).toBe(true)
    expect(long.startsWith(title!.slice(0, -1).trimEnd())).toBe(true)
    // the grey row: explanation, then the same truncated text
    const greyTitle = await stateTip(page, 'limits2.example')
    expect(greyTitle!.startsWith(`${LIMITS_WHY}. `)).toBe(true)
    const greyReason = greyTitle!.slice(`${LIMITS_WHY}. `.length)
    expect(greyReason.length).toBeLessThanOrEqual(200)
    expect(greyReason).toBe(title)
    // the hidden text is not cut at 200
    expect(((await stateCell(page, 'melt1.example').locator('.sr-only').textContent()) ?? '').length).toBeGreaterThan(200)
  })
})

// ── i) 390px ────────────────────────────────────────────────────
test.describe('390px viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // Hostnames without a break opportunity: on phones the fixed-layout table cuts them with an ellipsis instead of scrolling.
  const wide = (i: number) => `https://${'x'.repeat(48)}${i}.example`
  const swaps = () => czSwapList([ok, ok, melt, ok, ok, ok, ok, ok, ok, ok]).map((s, i) => ({ ...s, otherMintUrl: wide(i) }))
  const cases = [
    ['cz only', () => onlyCz(swaps())],
  ] as const

  for (const [name, setup] of cases) {
    test(`${name}: no horizontal page overflow, the table fits its box (long names are cut)`, async ({ page }) => {
      await gotoAuditTab(page, setup())
      await expect(page.locator('.md-audit-toggle')).toContainText('via cashu.info')
      await expect(page.locator('.audit-swaps-table tbody tr').first()).toBeVisible()

      const [card, wrap] = await measureSettled(page, ['.md-audit-collapsible', '.audit-swaps-table-wrap'])
      const m = await page.evaluate(() => {
        const w = document.querySelector('.audit-swaps-table-wrap') as HTMLElement
        const table = w.querySelector('table')!
        const before = { scrollWidth: w.scrollWidth, clientWidth: w.clientWidth, tableWidth: table.getBoundingClientRect().width }
        w.scrollLeft = 10_000
        return {
          before,
          overflowX: getComputedStyle(w).overflowX,
          scrolled: w.scrollLeft,
          docScroll: document.documentElement.scrollWidth,
          docClient: document.documentElement.clientWidth,
          bodyScroll: document.body.scrollWidth,
          // The page did not move sideways when the table scrolled.
          pageScrollX: window.scrollX,
        }
      })
      // Whole-pixel integers: the page itself must not scroll sideways.
      expect(m.docScroll).toBeLessThanOrEqual(m.docClient)
      expect(m.bodyScroll).toBeLessThanOrEqual(m.docClient)
      expect(m.pageScrollX).toBe(0)
      // The table fits its box: nothing to scroll sideways.
      expect(m.before.scrollWidth).toBeLessThanOrEqual(m.before.clientWidth)
      expect(m.before.tableWidth).toBeLessThanOrEqual(m.before.clientWidth + 1)
      expect(m.scrolled).toBe(0)
      // The card and the table box stay inside the viewport (fractional rects: 1px tolerance).
      expect(card!.right).toBeLessThanOrEqual(390 + 1)
      expect(wrap!.right).toBeLessThanOrEqual(390 + 1)
      expect(wrap!.x).toBeGreaterThanOrEqual(0)
      if (name !== 'cz only') {
        const [seg] = await measureSettled(page, ['.md-audit-toggle .md-audit-seg'])
        expect(seg!.right).toBeLessThanOrEqual(390 + 1)
      }
    })
  }
})

// ── score breakdown row: identical whether or not the Audit tab was opened ──
test.describe('Reliability breakdown: audit row', () => {
  const auditRow = (page: Page) => page.locator('.md-reliability-panel .rb-row', { hasText: 'Audit reliability (25%)' })
  const TIP = 'Swaps without a failure that cashu.info attributes to this mint, out of all its swaps. The worse of two windows counts: the last 7 days and up to 28 days. Under 10 swaps or no recent data: neutral 12.5 of 25.'
  const detail = () => czDetail({ swaps7d: { all: { total: 105, success: 89, failed: 16, avgMs: 9418 }, asSource: { total: 54, success: 42, failed: 12 }, asDest: { total: 51, success: 47, failed: 4 }, errorsBlamed: 0, dleq: { valid: 47, invalid: 0, missing: 0 } } })
  const snapshot = async (page: Page) => ({
    detail: await auditRow(page).locator('.rb-row-detail').count(),
    display: await auditRow(page).locator('.rb-row-display').textContent(),
    score: await auditRow(page).locator('.rb-row-score').textContent(),
    text: await auditRow(page).innerText(),
  })

  test('a scored row has no sentence, the exact tooltip, and the audit detail is requested only by the Audit tab (0, then 1, then still 1)', async ({ page }) => {
    const h = await gotoAuditTab(page, onlyCz([], { detail: detail() }), false)
    const czRequests = () => h.requests.filter(u => new URL(u, 'http://x').pathname === '/api/mints/audit-cz')
    await expect(auditRow(page).locator('.rb-row-score')).toHaveText('25/25')
    const before = await snapshot(page)
    expect(before).toMatchObject({ detail: 0, display: '100 / 100', score: '25/25' })
    expect(before.text).not.toMatch(/swaps succeeded|attributed to this mint \(cashu\.info\)|had a failure/)
    await auditRow(page).locator('svg').first().hover()
    await expect(page.getByText(TIP, { exact: true })).toBeVisible()
    expect(czRequests()).toHaveLength(0)

    await page.locator('.md-tab', { hasText: 'Audit' }).click()
    await expect(verdict(page)).toBeVisible()
    expect(czRequests()).toHaveLength(1)
    await page.locator('.md-tab', { hasText: 'Overview' }).click()
    expect(await snapshot(page)).toEqual(before)
    expect(czRequests()).toHaveLength(1)
  })
})
