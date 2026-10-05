import { test, expect } from '@playwright/test'
import {
  ALPHA, CZ_PAGE_URL, D, FRESH_8333, NO_8333, NOT_COVERED, ago,
  auditCzResponse, czSwapList, gotoAuditTab, measureSettled,
} from './fixtures/auditCz'

type Page = import('@playwright/test').Page
interface Rect { x: number; y: number; width: number; height: number; right: number }

// Audit tab, audit.cashu.cz branch (src/utils/auditCz.ts, MintDetail.tsx). Every endpoint is mocked
// (e2e/fixtures/auditCz.ts); nothing here reaches audit.cashu.cz or audit.8333.space.

const cell = (page: Page, label: string) => page.locator('.audit-summary-strip .audit-summary-cell', { hasText: label })
const row = (page: Page, host: string) => page.locator('.audit-swaps-table tbody tr', { hasText: host })
const czLink = (page: Page) => page.getByRole('link', { name: 'Open on audit.cashu.cz →' })
const showAll = (page: Page) => page.locator('.audit-swaps-show-all-btn')
const segGroup = (page: Page) => page.getByRole('group', { name: 'Audit source' })

const ok = { kind: 'ok', durationMs: 1000 }
const melt = { kind: 'melt', status: 'failed', stage: 'melt', error: 'melt failed', durationMs: 500 }
const limits = { kind: 'limits', status: 'failed', stage: 'limits', error: 'Amount 3 sat is below the mint minimum of 100 sat', durationMs: null }
const balance = { kind: 'balance', status: 'failed', stage: 'balance', error: 'Insufficient balance: need 27 sat, have 20 sat', durationMs: null }
const pending = { kind: 'pending', status: 'pending', durationMs: null }

/** audit.8333.space has no data for Alpha, audit.cashu.cz covers it. */
const onlyCz = (swaps: ReturnType<typeof czSwapList>, extra: Record<string, unknown> = {}) =>
  ({ alpha: NO_8333, cz: auditCzResponse({ swaps, ...extra }) })

// ── a) cz is the only source ────────────────────────────────────
test('only cz has data: header, four tiles in order, "To" column, safe link, no switch', async ({ page }) => {
  // 7 OK (1000 ms), 2 failed melts (500 ms), 1 below-minimum row → 9 counted swaps, 10 rows.
  const swaps = czSwapList([ok, ok, melt, ok, ok, limits, ok, melt, ok, ok])
  await gotoAuditTab(page, onlyCz(swaps))

  const header = page.locator('.md-audit-header-main')
  await expect(header).toBeVisible()
  await expect(header).toHaveText(/^AUDIT STATS\s*·\s*via audit\.cashu\.cz/, { useInnerText: true })

  await expect(page.locator('.audit-summary-label')).toHaveText(['Mints', 'Melts', 'Recent success rate', 'Avg swap time'])
  await expect(page.locator('.audit-summary-cell')).toHaveCount(4)
  // Mints / Melts come from detail7d.minted / melted, the success rate and the average from the swap list.
  await expect(cell(page, 'Mints').locator('.audit-summary-value')).toHaveText('26')
  await expect(cell(page, 'Melts').locator('.audit-summary-value')).toHaveText('21')
  await expect(cell(page, 'Recent success rate').locator('.audit-summary-main')).toHaveText('7 / 9')
  await expect(cell(page, 'Recent success rate').locator('.audit-summary-sub')).toHaveText('78% ok')
  // Only OK swaps count towards the average (the failed rows carry 500 ms).
  await expect(cell(page, 'Avg swap time').locator('.audit-summary-value')).toHaveText('1000 ms')

  await expect(page.locator('.audit-swap-bar-mark')).toHaveCount(10)
  await expect(page.locator('.audit-swaps-table th').first()).toHaveText('To')
  await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(8)
  await expect(showAll(page)).toHaveText('Show all (10)')
  await showAll(page).click()
  await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(10)
  await expect(showAll(page)).toHaveText('Show fewer')

  const link = czLink(page)
  await expect(link).toHaveCount(1)
  await expect(link).toHaveAttribute('rel', /\bnoopener\b/)
  await expect(link).toHaveAttribute('rel', /\bnoreferrer\b/)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('href', /^https:\/\/audit\.cashu\.cz\//)

  await expect(page.locator('.md-audit-seg')).toHaveCount(0)
  await expect(segGroup(page)).toHaveCount(0)
  await expect(page.getByText('via audit.8333.space')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /audit\.8333\.space/ })).toHaveCount(0)
})

// ── b) the browser only talks to our own backend ────────────────
test('the browser never requests audit.cashu.cz: only /api/mints/audit-cz?direction=from&limit=100', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __csp: string[] }).__csp = []
    document.addEventListener('securitypolicyviolation', e => (window as unknown as { __csp: string[] }).__csp.push(e.blockedURI))
  })
  const h = await gotoAuditTab(page, onlyCz(czSwapList([ok, ok, ok])))
  await expect(page.locator('.md-audit-header-main')).toContainText('via audit.cashu.cz')

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
    expect(q.get('direction')).toBe('from')
    expect(q.get('limit')).toBe('100')
    expect(q.get('url')).toBe(ALPHA)
  }
})

// ── c) success rate counts exactly the rows the table shows as OK or failed ──
test('Recent success rate = OK / counted rows; limits, balance and pending rows are neutral and not counted', async ({ page }) => {
  // 5 OK, 3 failed (melt), 3 limits, 2 balance, 1 pending, interleaved so no position implies the kind.
  const swaps = czSwapList([ok, melt, limits, ok, balance, pending, ok, melt, limits, balance, ok, limits, melt, ok])
  expect(swaps).toHaveLength(14)
  await gotoAuditTab(page, onlyCz(swaps))

  const tile = cell(page, 'Recent success rate')
  await expect(tile.locator('.audit-summary-main')).toHaveText('5 / 8')
  await expect(tile.locator('.audit-summary-sub')).toHaveText('63% ok')
  await expect(tile.locator('.audit-summary-value')).toHaveText(/^5 \/ 8\s*·\s*63% ok$/, { useInnerText: true })

  await showAll(page).click()
  await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(14)

  const state = (host: string) => row(page, host).locator('td').last()
  const style = (host: string) => row(page, host).locator('td').first().evaluate(td => {
    const s = getComputedStyle(td)
    return { color: s.color, opacity: s.opacity }
  })

  for (const host of ['melt1', 'melt7', 'melt12']) await expect(state(`${host}.example`)).toHaveText('failed (melt)')
  for (const host of ['limits2', 'limits8', 'limits11']) await expect(state(`${host}.example`)).toHaveText('below minimum')
  for (const host of ['balance4', 'balance9']) await expect(state(`${host}.example`)).toHaveText('auditor balance')
  await expect(state('pending5.example')).toHaveText('pending')
  for (const host of ['ok0', 'ok3', 'ok6', 'ok10', 'ok13']) await expect(state(`${host}.example`)).toHaveText('OK')

  const failed = await style('melt1.example')
  const okRow = await style('ok0.example')
  const neutral = [await style('limits2.example'), await style('balance4.example'), await style('pending5.example')]
  // Failed rows are the muted red; the neutral rows must look like neither a failure nor a dimmed row.
  expect(failed.color).not.toBe(okRow.color)
  for (const n of neutral) {
    expect(n.color).not.toBe(failed.color)
    expect(n.opacity).not.toBe(failed.opacity)
    expect(n.opacity).toBe(okRow.opacity)
  }
  // limits, balance and pending share one neutral style.
  expect(neutral[1]).toEqual(neutral[0])
  expect(neutral[2]).toEqual(neutral[0])
  // the other failed rows look like the first one
  expect(await style('melt7.example')).toEqual(failed)
  expect(await style('melt12.example')).toEqual(failed)

  // The outcome bar follows the same split: 5 OK, 3 failed, 6 neutral (limits + balance + pending).
  await expect(page.locator('.audit-swap-bar-mark')).toHaveCount(14)
  await expect(page.locator('.audit-swap-bar-ok')).toHaveCount(5)
  await expect(page.locator('.audit-swap-bar-fail')).toHaveCount(3)
  await expect(page.locator('.audit-swap-bar-neutral')).toHaveCount(6)
})

// ── d) too few counted swaps ────────────────────────────────────
test.describe('Recent success rate needs 3 counted swaps', () => {
  test('2 counted swaps (the rest neutral): n/a', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, melt, limits, balance, pending])))
    const value = cell(page, 'Recent success rate').locator('.audit-summary-value')
    await expect(value).toHaveText('n/a')
    await expect(cell(page, 'Recent success rate').locator('.audit-summary-main')).toHaveCount(0)
  })

  test('no swaps at all: n/a, no bar, no table', async ({ page }) => {
    await gotoAuditTab(page, onlyCz([]))
    await expect(cell(page, 'Recent success rate').locator('.audit-summary-value')).toHaveText('n/a')
    await expect(page.locator('.audit-swap-bar')).toHaveCount(0)
    await expect(page.locator('.audit-swaps-table')).toHaveCount(0)
  })

  test('3 counted swaps is enough (boundary)', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, melt, limits, ok, pending])))
    const tile = cell(page, 'Recent success rate')
    await expect(tile.locator('.audit-summary-main')).toHaveText('2 / 3')
    await expect(tile.locator('.audit-summary-sub')).toHaveText('67% ok')
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
    const czBtn = segGroup(page).getByRole('button', { name: 'cashu.cz', exact: true })
    const eightBtn = segGroup(page).getByRole('button', { name: '8333.space', exact: true })

    // The control sits in the card's header row, to the right of the title.
    await expect(seg).toBeVisible()
    await expect(segGroup(page)).toHaveCount(1)
    await expect(segGroup(page).getByRole('button')).toHaveText(['cashu.cz', '8333.space'])
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
    await expect(header).toContainText('via audit.cashu.cz')
    await expect(czBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(eightBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(cell(page, 'Mints').locator('.audit-summary-value')).toHaveText('26')
    await expect(cell(page, 'Recent success rate').locator('.audit-summary-main')).toHaveText('3 / 4')
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
    const czBtn = segGroup(page).getByRole('button', { name: 'cashu.cz', exact: true })
    const eightBtn = segGroup(page).getByRole('button', { name: '8333.space', exact: true })

    await czBtn.focus()
    await expect(czBtn).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(czBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(header).toContainText('via audit.cashu.cz')
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
      const czBtn = segGroup(page).getByRole('button', { name: 'cashu.cz', exact: true })
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
    await expect(page.getByText(/audit\.cashu\.cz/)).toHaveCount(0)
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
      await expect(page.getByText(/audit\.cashu\.cz/)).toHaveCount(0)
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
  await expect(page.locator('.md-audit-header-main')).toContainText('via audit.cashu.cz')
  await expect(loading).toHaveCount(0)
  await expect(cell(page, 'Recent success rate').locator('.audit-summary-main')).toHaveText('3 / 4')
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
  await expect(page.locator('.audit-swaps-table tbody tr')).toHaveCount(5)

  // `stage` and the destination are displayed: literally, as text. (`error` and `otherMintName` are not shown.)
  await expect(row(page, 'stage2.example').locator('td').last()).toHaveText(`failed (${XSS})`)
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

test.describe('the page link needs the https://audit.cashu.cz/ prefix', () => {
  const bad = [
    ['http scheme', 'http://audit.cashu.cz/mint/abc'],
    ['look-alike host', 'https://audit.cashu.cz.evil.example/mint/abc'],
    ['userinfo trick', 'https://audit.cashu.cz@evil.example/mint/abc'],
    ['prefix only in the path', 'https://evil.example/https://audit.cashu.cz/mint/abc'],
    ['javascript: URL', 'javascript:alert(1)'],
    ['no URL', null],
  ] as const
  for (const [name, sourceUrl] of bad) {
    test(`${name}: no link, the card still renders`, async ({ page }) => {
      const h = await gotoAuditTab(page, onlyCz(czSwapList([ok, ok, melt]), { sourceUrl }))
      await expect(page.locator('.md-audit-header-main')).toContainText('via audit.cashu.cz')
      await expect(cell(page, 'Recent success rate').locator('.audit-summary-main')).toHaveText('2 / 3')
      await expect(page.locator('.audit-external-link')).toHaveCount(0)
      await expect(page.getByRole('link', { name: /audit\.cashu\.cz/ })).toHaveCount(0)
      await expect(page.locator('.md-audit-collapsible a[href]')).toHaveCount(0)
      expect(h.dialogs).toEqual([])
    })
  }

  test('a valid page URL produces the link (control)', async ({ page }) => {
    await gotoAuditTab(page, onlyCz(czSwapList([ok, ok, melt])))
    await expect(czLink(page)).toHaveAttribute('href', CZ_PAGE_URL)
  })
})

// ── i) 390px ────────────────────────────────────────────────────
test.describe('390px viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // Hostnames without a break opportunity force the nowrap table wider than the card.
  const wide = (i: number) => `https://${'x'.repeat(48)}${i}.example`
  const swaps = () => czSwapList([ok, ok, melt, ok, ok, ok, ok, ok, ok, ok]).map((s, i) => ({ ...s, otherMintUrl: wide(i) }))
  const cases = [
    ['cz only', () => onlyCz(swaps())],
    ['both sources (switch in the heading)', () => ({ alpha: FRESH_8333, cz: auditCzResponse({ swaps: swaps() }) })],
  ] as const

  for (const [name, setup] of cases) {
    test(`${name}: no horizontal page overflow, the table scrolls inside its own box`, async ({ page }) => {
      await gotoAuditTab(page, setup())
      if (name !== 'cz only') await segGroup(page).getByRole('button', { name: 'cashu.cz', exact: true }).click()
      await expect(page.locator('.md-audit-toggle')).toContainText('via audit.cashu.cz')
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
      // The table is wider than its box and scrolls there.
      expect(['auto', 'scroll']).toContain(m.overflowX)
      expect(m.before.scrollWidth).toBeGreaterThan(m.before.clientWidth)
      expect(m.before.tableWidth).toBeGreaterThan(m.before.clientWidth)
      expect(m.scrolled).toBeGreaterThan(0)
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
