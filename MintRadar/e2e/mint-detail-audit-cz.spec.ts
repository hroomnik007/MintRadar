import { test, expect } from '@playwright/test'
import {
  ALPHA, CZ_PAGE_URL, D, FRESH_8333, LNPAY_DETAIL, NO_8333, NOT_COVERED, ago,
  auditCzResponse, czDetail, czSwapList, gotoAuditTab, measureSettled,
} from './fixtures/auditCz'

type Page = import('@playwright/test').Page
interface Rect { x: number; y: number; width: number; height: number; right: number }

// Audit tab, cashu.info branch (src/utils/auditCz.ts, MintDetail.tsx). Every endpoint is mocked
// (e2e/fixtures/auditCz.ts); nothing here reaches cashu.info or audit.8333.space.

const cell = (page: Page, label: string) => page.locator('.audit-summary-strip .audit-summary-cell', { hasText: label })
const row = (page: Page, host: string) => page.locator('.audit-swaps-table tbody tr', { hasText: host })
const czLink = (page: Page) => page.getByRole('link', { name: 'Open on cashu.info →' })
// cashu.info view: tile by key, the two table cards ("Swaps from this mint", "Swaps to this mint").
const tile = (page: Page, key: string) => page.locator(`.audit-cz-tiles [data-tile="${key}"]`)
const checksCard = (page: Page) => page.getByTestId('audit-cz-checks')
const tableCard = (page: Page, i: 0 | 1) => page.getByTestId('audit-cz-table').nth(i)
const fromCard = (page: Page) => tableCard(page, 0)
const toCard = (page: Page) => tableCard(page, 1)
/** Expands the "Swaps from this mint" card (every spec row is a `from` swap unless it says otherwise). */
// The card shows 5 rows by default: expand only when there is something to expand.
const expandFrom = async (page: Page) => {
  const card = fromCard(page)
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
test('only cz has data: header, four tiles from the stored detail, no checks card, two tables, safe link, no switch', async ({ page }) => {
  // 7 OK, 2 failed melts, 1 below-minimum row = 10 swaps from this mint, plus 2 swaps to it.
  const swaps = [
    ...czSwapList([ok, ok, melt, ok, ok, limits, ok, melt, ok, ok]),
    ...czSwapList([ok, ok]).map((s, i) => ({ ...s, id: `t${i}`, direction: 'to' as const, otherMintUrl: `https://src${i}.example`, at: ago((20 + i) * 60_000) })),
  ]
  await gotoAuditTab(page, onlyCz(swaps))

  const header = page.locator('.md-audit-header-main')
  await expect(header).toBeVisible()
  await expect(header).toHaveText(/^Audit stats\s*·\s*via cashu\.info/, { useInnerText: true })

  // Five tiles from the LNpay detail, in order; the label is sentence case.
  await expect(page.locator('.audit-cz-tiles .audit-summary-cell')).toHaveCount(5)
  await expect(page.locator('.audit-cz-tiles .audit-summary-value')).toHaveText(['85%', '51 / 64', '56 / 62', '0', '8.3 s'])
  await expect(page.locator('.audit-cz-tiles .audit-cz-tile-label span').filter({ hasText: /^[A-Z]/ })).toHaveText(
    ['Success rate', 'Payouts', 'Receives', 'Caused by this mint', 'Avg swap time'])
  await expect(tile(page, 'attributed').locator('.audit-cz-tile-caption')).toHaveText('of 19 failed swaps')
  expect(await tile(page, 'melts').locator('.audit-cz-tile-label span').first().evaluate(e => getComputedStyle(e).textTransform)).toBe('none') // sentence case, like the swap strip labels
  // The old Recent success rate tile is gone from this view.
  await expect(page.getByText('Recent success rate')).toHaveCount(0)

  // The bar shows both directions together.
  await expect(page.locator('.audit-swap-bar-mark')).toHaveCount(12)

  await expect(checksCard(page)).toHaveCount(0)

  await expect(page.getByTestId('audit-cz-table')).toHaveCount(2)
  await expect(fromCard(page)).toContainText('Swaps from this mint')
  await expect(toCard(page)).toContainText('Swaps to this mint')
  await expect(fromCard(page).locator('th').first()).toHaveText('To')
  await expect(toCard(page).locator('th').first()).toHaveText('From')
  await expect(fromCard(page).locator('th')).toHaveText(['To', 'Amount', 'Fee', 'Duration', 'State'])
  await expect(toCard(page).locator('th')).toHaveText(['From', 'Amount', 'Fee', 'Duration', 'State'])
  await expect(fromCard(page).locator('tbody tr')).toHaveCount(5)
  await expect(fromCard(page).locator('.audit-swaps-show-all-btn')).toHaveText('Show all (10)')
  await expect(toCard(page).locator('tbody tr')).toHaveCount(2)
  await expect(toCard(page).locator('.audit-swaps-show-all-btn')).toHaveCount(0)
  await expect(toCard(page).locator('tbody tr').first().locator('td').first()).toHaveText('src0.example')
  await fromCard(page).locator('.audit-swaps-show-all-btn').click()
  await expect(fromCard(page).locator('tbody tr')).toHaveCount(10)
  await expect(fromCard(page).locator('.audit-swaps-show-all-btn')).toHaveText('Show fewer')
  await expect(toCard(page).locator('tbody tr')).toHaveCount(2) // the other card is independent

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
test('limits, balance and pending rows are neutral, failures red; the bar follows the same split', async ({ page }) => {
  // 5 OK, 3 failed (melt), 3 limits, 2 balance, 1 pending, interleaved so no position implies the kind.
  const swaps = czSwapList([ok, melt, limits, ok, balance, pending, ok, melt, limits, balance, ok, limits, melt, ok])
  expect(swaps).toHaveLength(14)
  await gotoAuditTab(page, onlyCz(swaps))

  await expandFrom(page)
  await expect(fromCard(page).locator('tbody tr')).toHaveCount(14)

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

  const failed = await style('melt1.example')
  const okRow = await style('ok0.example')
  const neutral = [await style('limits2.example'), await style('balance4.example'), await style('pending5.example')]
  // Failed rows are the muted red; the neutral rows must look like neither a failure nor a dimmed row.
  expect(failed.color).not.toBe(okRow.color)
  for (const n of neutral) {
    expect(n.color).not.toBe(failed.color)
    expect(n.opacity).toBe(okRow.opacity)
  }
  // limits, balance and pending share one neutral style.
  expect(neutral[1]).toEqual(neutral[0])
  expect(neutral[2]).toEqual(neutral[0])
  // the other failed rows look like the first one
  expect(await style('melt7.example')).toEqual(failed)
  expect(await style('melt12.example')).toEqual(failed)

  // The outcome bar: 5 OK, 3 failed, 6 neutral (limits + balance + pending).
  await expect(page.locator('.audit-swap-bar-mark')).toHaveCount(14)
  await expect(page.locator('.audit-swap-bar-ok')).toHaveCount(5)
  await expect(page.locator('.audit-swap-bar-fail')).toHaveCount(3)
  await expect(page.locator('.audit-swap-bar-neutral')).toHaveCount(6)
})

// ── d) tiles, checks and tables from the stored detail ──────────
test.describe('tiles from the stored detail', () => {
  test('"Caused by this mint": the blamed number, the failed total as a caption, never "x / y"', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: czDetail({ swaps7d: { ...LNPAY_DETAIL.swaps7d, errorsBlamed: 3, all: { ...LNPAY_DETAIL.swaps7d.all, failed: 1 } } }) }))
    await expect(tile(page, 'attributed').locator('.audit-summary-value')).toHaveText('3')
    await expect(tile(page, 'attributed').locator('.audit-cz-tile-label span').first()).toHaveText('Caused by this mint')
    await expect(tile(page, 'attributed').locator('.audit-cz-tile-caption')).toHaveText('of 1 failed swap')
    await expect(tile(page, 'attributed')).not.toContainText('/')
  })

  test('no failed swaps: label "Failed swaps", no caption', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: czDetail({ swaps7d: { ...LNPAY_DETAIL.swaps7d, errorsBlamed: 0, all: { ...LNPAY_DETAIL.swaps7d.all, failed: 0 } } }) }))
    await expect(tile(page, 'attributed').locator('.audit-summary-value')).toHaveText('0')
    await expect(tile(page, 'attributed').locator('.audit-cz-tile-label span').first()).toHaveText('Failed swaps')
    await expect(tile(page, 'attributed').locator('.audit-cz-tile-caption')).toHaveCount(0)
  })

  test('a tile whose source field is missing is hidden; under a second the average is in ms', async ({ page }) => {
    const rest: Record<string, unknown> = { ...LNPAY_DETAIL.swaps7d }
    delete rest['asSource']
    await gotoAuditTab(page, onlyCz([], { detail: czDetail({ swaps7d: { ...rest, all: { ...LNPAY_DETAIL.swaps7d.all, avgMs: 640 } } }) }))
    await expect(page.locator('.audit-cz-tiles .audit-summary-cell')).toHaveCount(4)
    await expect(tile(page, 'melts')).toHaveCount(0)
    await expect(tile(page, 'avg').locator('.audit-summary-value')).toHaveText('640 ms')
  })

  test('tiles use one neutral number colour, whatever the numbers', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([], { detail: czDetail({ swaps7d: { ...LNPAY_DETAIL.swaps7d, errorsBlamed: 12 } }) }))
    const colors = await page.locator('.audit-cz-tiles .audit-summary-value').evaluateAll(els => els.map(e => getComputedStyle(e).color))
    expect(new Set(colors).size).toBe(1)
  })

  test('the info icons carry the honest tooltips', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([]))
    const expected: Record<string, string> = {
      melts: 'Swaps in the last 7 days in which this mint paid out a Lightning invoice, counted by cashu.info (successful of all)',
      mints: 'Swaps in the last 7 days in which this mint received ecash from another mint (successful of all)',
      attributed: "Swaps that failed because of this mint, as attributed by cashu.info. Failures with other causes are not counted against a mint, for example amounts below its minimum, the auditor's own balance and Lightning routing.",
      avg: 'Average swap time over the last 7 days as reported by cashu.info.',
    }
    for (const [key, text] of Object.entries(expected)) {
      await tile(page, key).locator('.info-tooltip').hover()
      await expect(tile(page, key).getByRole('tooltip')).toHaveText(text)
      // A standard tooltip: sentence case and normal spacing, not the uppercase of the tile label.
      const pop = await tile(page, key).getByRole('tooltip').evaluate(e => { const c = getComputedStyle(e); return { t: c.textTransform, l: c.letterSpacing, f: c.fontSize } })
      expect(pop).toEqual({ t: 'none', l: 'normal', f: '10px' })
      await page.mouse.move(0, 0)
    }
  })
})

test.describe('the two tables', () => {
  test('no swaps yet: "No swaps collected yet" in both cards, no bar', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([]))
    await expect(fromCard(page).getByText('No swaps collected yet')).toBeVisible()
    await expect(toCard(page).getByText('No swaps collected yet')).toBeVisible()
    await expect(page.locator('.audit-swaps-table')).toHaveCount(0)
    await expect(page.locator('.audit-swap-bar')).toHaveCount(0)
  })

  test('only swaps to the mint: the "from" card says so, the "to" card lists them', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, ok]).map(s => ({ ...s, direction: 'to' as const }))))
    await expect(fromCard(page).getByText('No swaps collected yet')).toBeVisible()
    await expect(toCard(page).locator('tbody tr')).toHaveCount(2)
  })
})

// ── e) both sources have data: the switch ───────────────────────
const bothSources = () => ({ alpha: FRESH_8333, cz: auditCzResponse({ swaps: czSwapList([ok, ok, melt, ok]) }) })

test.describe('source switch (both sources have data)', () => {
  test('defaults to 8333.space, switches to cashu.cz and back with the 8333 panel unchanged', async ({ page }) => {
    await gotoAuditTab(page, bothSources())
    const header = page.locator('.md-audit-header-main')
    const seg = header.locator('.md-audit-seg')
    const card = page.locator('.md-audit-collapsible')
    const czBtn = segGroup(page).getByRole('button', { name: 'cashu.info', exact: true })
    const eightBtn = segGroup(page).getByRole('button', { name: '8333.space', exact: true })

    // The control sits in the card's header row, to the right of the title.
    await expect(seg).toBeVisible()
    await expect(segGroup(page)).toHaveCount(1)
    await expect(segGroup(page).getByRole('button')).toHaveText(['cashu.info', '8333.space'])
    const [h, s] = await measureSettled(page, ['.md-audit-header-main', '.md-audit-header-main .md-audit-seg']) as [Rect, Rect]
    // Layout rects are fractional (font metrics, flex rounding): 1px tolerance, nothing looser.
    expect(s.y).toBeGreaterThanOrEqual(h.y - 1)
    expect(s.y + s.height).toBeLessThanOrEqual(h.y + h.height + 1)
    expect(s.right).toBeLessThanOrEqual(h.right + 1)

    // Default: the audit.8333.space panel.
    await expect(header).toContainText('via audit.8333.space')
    await expect(eightBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(czBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(cell(page, 'Mints').locator('.audit-summary-value')).toHaveText('1,234')
    await expect(cell(page, 'Recent success rate').locator('.audit-summary-main')).toHaveText('98 / 100')
    await expect(page.getByRole('link', { name: 'Open on audit.8333.space →' })).toBeVisible()
    const before = await card.evaluate(e => e.outerHTML)

    await czBtn.click()
    await expect(header).toContainText('via cashu.info')
    await expect(czBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(eightBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(tile(page, 'mints').locator('.audit-summary-value')).toHaveText('56 / 62')
    await expect(tile(page, 'melts').locator('.audit-summary-value')).toHaveText('51 / 64')
    await expect(czLink(page)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open on audit.8333.space →' })).toHaveCount(0)
    await expect(seg).toBeVisible()

    await eightBtn.click()
    await expect(header).toContainText('via audit.8333.space')
    await expect(eightBtn).toHaveAttribute('aria-pressed', 'true')
    expect(await card.evaluate(e => e.outerHTML)).toBe(before)
  })

  test('operable from the keyboard, with a group name and aria-pressed', async ({ page }) => {
    await gotoAuditTab(page, bothSources())
    const header = page.locator('.md-audit-header-main')
    const czBtn = segGroup(page).getByRole('button', { name: 'cashu.info', exact: true })
    const eightBtn = segGroup(page).getByRole('button', { name: '8333.space', exact: true })

    await czBtn.focus()
    await expect(czBtn).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(czBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(header).toContainText('via cashu.info')
    await expect(czBtn).toBeFocused() // the re-render keeps the focus on the pressed button

    await page.keyboard.press('Tab')
    await expect(eightBtn).toBeFocused()
    await page.keyboard.press('Space')
    await expect(eightBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(czBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(header).toContainText('via audit.8333.space')
  })

  test.describe('coarse pointer', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('hit area is at least 44px and a tap outside the visible box still toggles', async ({ page }) => {
      await gotoAuditTab(page, bothSources())
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
      // ≤767px the mobile heading carries the control (the desktop one is display:none).
      const header = page.locator('.md-audit-toggle')
      await expect(header).toBeVisible()
      const czBtn = segGroup(page).getByRole('button', { name: 'cashu.info', exact: true })
      const eightBtn = segGroup(page).getByRole('button', { name: '8333.space', exact: true })
      await expect(czBtn).toBeVisible()
      await czBtn.scrollIntoViewIfNeeded() // taps and elementFromPoint use viewport coordinates
      await measureSettled(page, ['.md-audit-toggle .md-audit-seg-btn'])

      for (const btn of [czBtn, eightBtn]) {
        const m = await btn.evaluate(el => {
          const b = el.getBoundingClientRect()
          const pseudo = getComputedStyle(el, '::before')
          const cx = b.left + b.width / 2
          // 10px beyond the visible box is inside the invisible extension (≈12.5px each side).
          return {
            height: b.height,
            pseudoContent: pseudo.content,
            pseudoHeight: parseFloat(pseudo.height),
            above: el.contains(document.elementFromPoint(cx, b.top - 10)),
            below: el.contains(document.elementFromPoint(cx, b.bottom + 10)),
          }
        })
        expect(m.pseudoContent).toBe('""')
        expect(m.pseudoHeight).toBeGreaterThanOrEqual(44)
        expect(m.above).toBe(true)
        expect(m.below).toBe(true)
      }

      // Real touch input 10px above / below the visible box.
      const cz = (await czBtn.boundingBox())!
      await page.touchscreen.tap(cz.x + cz.width / 2, cz.y - 10)
      await expect(czBtn).toHaveAttribute('aria-pressed', 'true')
      const eight = (await eightBtn.boundingBox())!
      await page.touchscreen.tap(eight.x + eight.width / 2, eight.y + eight.height + 10)
      await expect(eightBtn).toHaveAttribute('aria-pressed', 'true')
    })
  })
})

// The Reliability Score breakdown (sidebar panel) now names its source, cashu.info, in the audit row text, so the
// "no cashu.info on this tab" checks look at everything outside that panel.
const cashuInfoOutsideBreakdown = (page: import('@playwright/test').Page) =>
  page.getByText(/cashu\.info/).evaluateAll(els => els.filter(e => !e.closest('.md-reliability-panel')).length)

// ── f) cz does not cover the mint: the page is as before ────────
test.describe('cz does not cover the mint (covered: false)', () => {
  test('8333 data absent: "No audit data available", no cz card, no switch', async ({ page }) => {
    const h = await gotoAuditTab(page, { alpha: NO_8333, cz: NOT_COVERED })
    await expect(page.getByText('No audit data available for this mint.')).toBeVisible()
    await expect(page.getByText('Loading audit data…')).toHaveCount(0)
    expect(h.czQueries().length).toBeGreaterThan(0) // the answer really came from the endpoint
    await expect(page.locator('.md-audit-header')).toContainText('via audit.8333.space')
    await expect(page.locator('.audit-summary-strip')).toHaveCount(0)
    await expect(page.locator('.md-audit-seg')).toHaveCount(0)
    expect(await cashuInfoOutsideBreakdown(page)).toBe(0)
  })

  const stale = [
    ['auditor data 10 days old', { auditCheckedAt: ago(10 * D) }],
    ['MintRadar sync 2 days old', { auditSyncedAt: ago(2 * D) }],
  ] as const
  for (const [name, over] of stale) {
    test(`8333 data stale (${name}): the 8333 panel, no cz card, no switch`, async ({ page }) => {
      const h = await gotoAuditTab(page, { alpha: { ...FRESH_8333, ...over }, cz: NOT_COVERED })
      await expect(page.locator('.audit-summary-strip')).toBeVisible()
      expect(h.czQueries().length).toBeGreaterThan(0)
      await expect(page.locator('.md-audit-header-main')).toContainText('via audit.8333.space')
      await expect(cell(page, 'Mints').locator('.audit-summary-value')).toHaveText('1,234')
      await expect(cell(page, 'Recent success rate').locator('.audit-summary-main')).toHaveText('98 / 100')
      await expect(page.getByRole('link', { name: 'Open on audit.8333.space →' })).toBeVisible()
      await expect(page.locator('.md-audit-seg')).toHaveCount(0)
      await expect(segGroup(page)).toHaveCount(0)
      expect(await cashuInfoOutsideBreakdown(page)).toBe(0)
    })
  }
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
  await expect.poll(() => h.czQueries().length).toBeGreaterThan(0) // the request is in flight, held
  // (the Reliability Score breakdown has its own, different "No audit data available" row: match the panel's full sentence)
  await expect(page.getByText('No audit data available for this mint.')).toHaveCount(0)
  await expect(page.locator('.md-audit-header, .md-audit-header-main, .audit-summary-strip')).toHaveCount(0)

  release()
  await expect(page.locator('.md-audit-header-main')).toContainText('via cashu.info')
  await expect(loading).toHaveCount(0)
  await expect(tile(page, 'melts').locator('.audit-summary-value')).toHaveText('51 / 64')
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
  await expect(page.locator('.audit-swaps-table tbody tr').nth(3).locator('td').first()).toHaveText(XSS)
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
  // Strings where numbers belong are not numbers: their tiles and lines are hidden, nothing is printed.
  await expect(tile(page, 'melts')).toHaveCount(0)
  await expect(tile(page, 'attributed')).toHaveCount(0)
  await expect(tile(page, 'avg')).toHaveCount(0)
  await expect(tile(page, 'mints').locator('.audit-summary-value')).toHaveText('56 / 62')
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
      await expect(tile(page, 'melts').locator('.audit-summary-value')).toHaveText('51 / 64')
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

  test('failed, below-minimum and balance rows: error text in the title and in a hidden element, visible text unchanged', async ({ page }) => {
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
    await expect(meltCell).toHaveAttribute('title', NO_ROUTE)
    await expect(meltCell.locator('.sr-only')).toHaveText(NO_ROUTE)
    expect(await visibleState(page, 'melt1.example')).toBe('failed (melt)')
    // grey rows: the fixed explanation first, then the error text
    const limitsCell = stateCell(page, 'limits2.example')
    await expect(limitsCell).toHaveAttribute('title', `${LIMITS_WHY}. ${MIN_TEXT}`)
    await expect(limitsCell.locator('.sr-only')).toHaveText(MIN_TEXT)
    expect(await visibleState(page, 'limits2.example')).toBe('below minimum')
    const balanceCell = stateCell(page, 'balance3.example')
    await expect(balanceCell).toHaveAttribute('title', `${BALANCE_WHY}. ${BAL_TEXT}`)
    await expect(balanceCell.locator('.sr-only')).toHaveText(BAL_TEXT)
    expect(await visibleState(page, 'balance3.example')).toBe('auditor balance')
    // pending is not OK either
    await expect(stateCell(page, 'pending4.example')).toHaveAttribute('title', 'Waiting for the quote')
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

  test('a failed row without an error text has no title and no hidden element; a grey row keeps the explanation', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, { ...melt, error: null }, { ...limits, error: null }, { ...melt, error: ' \n\t ' }])))
    await expandFrom(page)
    await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(4)
    await expect(stateCell(page, 'melt1.example')).not.toHaveAttribute('title', /.*/)
    await expect(stateCell(page, 'melt1.example').locator('.sr-only')).toHaveCount(0)
    await expect(stateCell(page, 'limits2.example')).toHaveAttribute('title', LIMITS_WHY)
    await expect(stateCell(page, 'melt3.example')).not.toHaveAttribute('title', /.*/)
    await expect(stateCell(page, 'melt3.example').locator('.sr-only')).toHaveCount(0)
  })

  test('an OK row has neither a title nor a hidden element, even when the endpoint sends an error text', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([{ ...ok, error: 'leftover text' }, ok, { ...melt, error: NO_ROUTE }])))
    await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(3)
    for (const host of ['ok0.example', 'ok1.example']) {
      await expect(stateCell(page, host)).not.toHaveAttribute('title', /.*/)
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
      await expect(cellEl).toHaveAttribute('title', new RegExp(`${XSS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
      await expect(cellEl.locator('*')).toHaveCount(1) // the hidden span, nothing else
    }
    await expect(page.locator('.md-audit-collapsible img')).toHaveCount(0)
    await expect(page.locator('[onerror], img[src="x"]')).toHaveCount(0)
    expect(h.requests.filter(u => new URL(u).pathname === '/x')).toEqual([])
    expect(h.dialogs).toEqual([])
  })

  test('control characters and extra whitespace are cleaned before use', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, { ...melt, error: '  Lightning\n\n payment\tfailed\u0000:\u202e  no_route.  ' }])))
    const cellEl = stateCell(page, 'melt1.example')
    await expect(cellEl).toHaveAttribute('title', 'Lightning payment failed: no_route.')
    await expect(cellEl.locator('.sr-only')).toHaveText('Lightning payment failed: no_route.')
  })

  test('a very long error text is truncated to 200 characters in the title', async ({ page }) => {
    const long = `${'word '.repeat(60)}END` // 303 characters, the endpoint caps at 300
    await gotoAuditTab(page, onlyCz(czSwapList([ok, { ...melt, error: long.slice(0, 300) }, { ...limits, error: long.slice(0, 300) }])))
    const title = await stateCell(page, 'melt1.example').getAttribute('title')
    expect(title).not.toBeNull()
    expect(title!.length).toBeLessThanOrEqual(200)
    expect(title!.length).toBeGreaterThan(150)
    expect(title!.endsWith('…')).toBe(true)
    expect(long.startsWith(title!.slice(0, -1).trimEnd())).toBe(true)
    // the grey row: explanation, then the same truncated text
    const greyTitle = await stateCell(page, 'limits2.example').getAttribute('title')
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
    ['both sources (switch in the heading)', () => ({ alpha: FRESH_8333, cz: auditCzResponse({ swaps: swaps() }) })],
  ] as const

  for (const [name, setup] of cases) {
    test(`${name}: no horizontal page overflow, the table fits its box (long names are cut)`, async ({ page }) => {
      await gotoAuditTab(page, setup())
      if (name !== 'cz only') await segGroup(page).getByRole('button', { name: 'cashu.info', exact: true }).click()
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

// ── score breakdown row: the detail, whichever tab is open ──────
test.describe('Reliability breakdown: audit row sentence', () => {
  const auditRow = (page: Page) => page.locator('.md-reliability-panel .rb-row', { hasText: 'Audit reliability (25%)' })
  const SENTENCE = '89 of 105 swaps succeeded in the last 7 days; 16 failed, 0 attributed to this mint (cashu.info)'
  const detail = () => czDetail({ swaps7d: { all: { total: 105, success: 89, failed: 16, avgMs: 9418 }, asSource: { total: 54, success: 42, failed: 12 }, asDest: { total: 51, success: 47, failed: 4 }, errorsBlamed: 0, dleq: { valid: 47, invalid: 0, missing: 0 } } })

  test('the sentence is on Overview without opening the Audit tab, from ONE request that the Audit tab reuses', async ({ page }) => {
    const h = await gotoAuditTab(page, onlyCz([], { detail: detail() }), false)
    await expect(auditRow(page).locator('.rb-row-detail')).toHaveText(SENTENCE)
    await expect(auditRow(page).locator('.rb-row-display')).toHaveText('0 / 100')
    await expect(auditRow(page).locator('.rb-row-score')).toHaveText('25/25')
    await auditRow(page).locator('svg').first().hover()
    await expect(page.getByText('Only failures attributed to this mint count, not the overall success rate.')).toBeVisible()
    const czRequests = () => h.requests.filter(u => u.includes('/api/mints/audit-cz'))
    expect(czRequests()).toHaveLength(1)

    await page.locator('.md-tab', { hasText: 'Audit' }).click()
    await expect(tile(page, 'attributed')).toBeVisible()
    await page.locator('.md-tab', { hasText: 'Overview' }).click()
    await expect(auditRow(page).locator('.rb-row-detail')).toHaveText(SENTENCE)
    expect(czRequests()).toHaveLength(1)
  })

  test('without a stored detail the row keeps its own text', async ({ page }) => {
    await gotoAuditTab(page, { alpha: NO_8333, cz: NOT_COVERED }, false)
    await expect(auditRow(page)).toBeVisible()
    await expect(auditRow(page).locator('.rb-row-detail')).toHaveCount(0)
    await expect(auditRow(page).locator('.rb-row-display')).toHaveText('0 / 100')
  })
})
