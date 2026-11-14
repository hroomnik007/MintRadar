import { test, expect } from '@playwright/test'
import { NO_8333, auditCzResponse, czDetail, czSwapList, gotoAuditTab, ago } from './fixtures/auditCz'
import { layoutReady, resize } from './fixtures/settle'

type Page = import('@playwright/test').Page

// Audit tab, cashu.info view (layout of 2026-11-13): the Deposits / Withdrawals figures, the header and its sync note,
// and the one swap list with its filter (it replaced the swap strip and the two tables behind a tablist).

const tile = (page: Page, key: 'mints' | 'melts') => page.locator(`.au-dirs [data-tile="${key}"]`)
const swapList = (page: Page) => page.getByTestId('audit-swap-list')
const chips = (page: Page) => swapList(page).getByRole('group', { name: 'Filter swaps' }).getByRole('button')
const czOnly = (cz: unknown) => ({ alpha: { ...NO_8333 }, cz })
const ok = { kind: 'ok', durationMs: 1000 }
const melt = { kind: 'melt', status: 'failed', stage: 'melt', error: 'melt failed', durationMs: 500 }
const limits = { kind: 'limits', status: 'failed', stage: 'limits', error: 'Amount 3 sat is below the mint minimum of 100 sat', durationMs: null }
const pending = { kind: 'pending', status: 'pending', durationMs: null }

test.describe('direction figures', () => {
  test('Deposits (mint) first, then Withdrawals (melt): successful of attempts and "N failed"', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    // asDest (62 attempts, 56 ok, 6 failed) is the deposit side, asSource (64, 51, 13) the withdrawal side
    await expect(page.locator('.au-dirs .au-dir-label')).toHaveText(['Deposits (mint)', 'Withdrawals (melt)', 'Average swap time'])
    await expect(tile(page, 'mints').locator('.au-dir-value')).toHaveText('56 of 62')
    await expect(tile(page, 'mints').locator('.au-dir-sub')).toHaveText('6 failed')
    await expect(tile(page, 'melts').locator('.au-dir-value')).toHaveText('51 of 64')
    await expect(tile(page, 'melts').locator('.au-dir-sub')).toHaveText('13 failed')
    // the small bar under a direction: succeeded and failed, never the red of "caused by this mint"
    await expect(tile(page, 'melts').locator('.au-mini i')).toHaveCount(2)
    await expect(tile(page, 'melts').locator('.au-mini .au-seg-mint')).toHaveCount(0)
  })

  test('no failures: no subtext and a bar of one colour; a very small sample is shown as it is', async ({ page }) => {
    const cz = auditCzResponse({ detail: czDetail({ swaps7d: { all: { total: 11, success: 9, failed: 2 }, asSource: { total: 10, success: 10, failed: 0 }, asDest: { total: 1, success: 0, failed: 1 }, errorsBlamed: 0 } }) })
    await gotoAuditTab(page, czOnly(cz))
    await expect(tile(page, 'melts').locator('.au-dir-value')).toHaveText('10 of 10')
    await expect(tile(page, 'melts').locator('.au-dir-sub')).toHaveCount(0)
    await expect(tile(page, 'melts').locator('.au-mini i')).toHaveCount(1)
    await expect(tile(page, 'mints').locator('.au-dir-value')).toHaveText('0 of 1')
    await expect(tile(page, 'mints').locator('.au-dir-sub')).toHaveText('1 failed')
  })

  test('a direction without numbers says "No data" instead of numbers; no swaps block at all: both do', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ detail: czDetail({ swaps7d: { all: { total: 30, success: 30, failed: 0 }, asSource: { total: 30, success: 30, failed: 0 }, errorsBlamed: 0 } }) })))
    await expect(tile(page, 'mints').locator('.au-dir-value')).toHaveText('No data')
    await expect(tile(page, 'melts').locator('.au-dir-value')).toHaveText('30 of 30')
    await gotoAuditTab(page, czOnly(auditCzResponse({ detail: czDetail({ swaps7d: undefined }) })))
    await expect(page.locator('.au-dirs .au-dir-value')).toHaveText(['No data', 'No data'])
  })

  test('the tooltips say what mint and melt mean for this mint', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await tile(page, 'mints').locator('.info-tooltip').hover()
    await expect(page.getByRole('tooltip')).toHaveText('Deposits into this mint (mint operations) in the last 7 days, counted by cashu.info: successful of all.')
    await page.mouse.move(0, 0)
    await tile(page, 'melts').locator('.info-tooltip').hover()
    await expect(page.getByRole('tooltip')).toHaveText('Withdrawals from this mint (melt operations) in the last 7 days, counted by cashu.info: successful of all.')
  })
})

test.describe('no source line; header tooltip', () => {
  test('no cashu.info source line under the figures (uptime and DLEQ are shown elsewhere)', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await expect(page.locator('.au-dirs')).toBeVisible()
    await expect(page.locator('.audit-cz-source')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('DLEQ valid')
    await expect(page.locator('body')).not.toContainText('uptime 30d')
  })

  test('the Audit stats ⓘ names the two windows of the score', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await page.locator('.md-audit-header-main .md-audit-info').hover()
    await expect(page.getByRole('tooltip')).toHaveText('The Reliability Score takes the worse result of two cashu.info windows: the last 7 days and up to 28 days. Deposits and withdrawals are the 7 days split by direction.')
  })
})

test.describe('header sync note', () => {
  test('fresh: "· synced N min ago" right after "via cashu.info", muted, styled like "fetched …" under Fees & limits', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    const note = page.getByTestId('audit-cz-sync')
    await expect(note).toHaveText('· synced 10 min ago')
    await expect(note).not.toHaveClass(/md-audit-sync-wrapped/) // fits on the header line at desktop size: the dot shows
    await expect(note.locator('.md-audit-sync-sep')).toBeVisible()
    await expect(note).not.toHaveClass(/md-audit-sync-stale/)
    // after "· via cashu.info" and its ⓘ (the ⓘ stays with the source name)
    await expect(page.locator('.md-audit-header-main .md-audit-via').first()).toHaveText('· via cashu.info')
    await expect(page.locator('.md-audit-header-main .md-audit-info').locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'audit-cz-sync')
    await expect(page.locator('[data-testid="audit-cz-sync"], [data-testid="audit-cz-sync"] *').and(page.locator('[title]'))).toHaveCount(0)
    // the same look as the "fetched …" time: muted 12 px body font, dotted underline on the time
    const time = note.locator('.md-audit-sync-time')
    const style = await time.evaluate(e => { const c = getComputedStyle(e); return { line: c.textDecorationLine, deco: c.textDecorationStyle, size: c.fontSize } })
    expect(style).toEqual({ line: 'underline', deco: 'dotted', size: '12px' })
  })

  test('the time opens a tooltip with the exact sync time', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await page.getByTestId('audit-cz-sync').locator('.md-audit-sync-time').hover()
    await expect(page.getByRole('tooltip')).toHaveText(/^Last synced from cashu\.info: \d{1,2} [A-Z][a-z]{2} \d{4}, \d\d:\d\d UTC\.$/)
  })

  test('stale (older than 90 minutes): "· not updated recently" in the warning colour', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ detail: czDetail({}, 120) })))
    const note = page.getByTestId('audit-cz-sync')
    await expect(note).toHaveText('· not updated recently')
    await expect(note).toHaveClass(/md-audit-sync-stale/)
    const color = await note.evaluate(e => getComputedStyle(e).color)
    const via = await page.locator('.md-audit-header-main .md-audit-via').first().evaluate(e => getComputedStyle(e).color)
    expect(color).not.toBe(via)
    await note.locator('.md-audit-sync-time').hover()
    await expect(page.getByRole('tooltip')).toHaveText(/^Last synced from cashu\.info: .+ UTC, more than 90 minutes ago\.$/)
  })

  test('mobile 390: the note wraps onto its own line without a leading dot and without widening the card', async ({ page }) => {
    await resize(page, 390, 844)
    await gotoAuditTab(page, czOnly(auditCzResponse({ detail: czDetail({}, 120) })))
    const note = page.getByTestId('audit-cz-sync-mobile')
    await expect(note).toHaveText('· not updated recently')
    await expect(note).toHaveClass(/md-audit-sync-wrapped/)
    await expect(note.locator('.md-audit-sync-sep')).toBeHidden() // no leading dot on its own line
    await layoutReady(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const card = await page.locator('.md-audit-collapsible').boundingBox()
    const box = await note.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width)
    const via = await page.locator('.md-audit-toggle .md-audit-via').boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(via!.y + via!.height - 1) // on the next line
    const title = await page.locator('.md-audit-toggle .md-panel-title').boundingBox()
    const text = await note.locator('.md-audit-sync-time').boundingBox()
    expect(Math.abs(text!.x - title!.x)).toBeLessThanOrEqual(1.5) // starts at the left edge, where the dot would have been
    // "via cashu.info" uses the same font in both headers
    const fonts = await page.locator('.md-audit-toggle .md-audit-via').evaluate(e => getComputedStyle(e).fontFamily)
    expect(fonts).not.toMatch(/mono/i)
  })

  test('the dot comes back once the note fits on the line again', async ({ page }) => {
    await resize(page, 360, 800)
    await gotoAuditTab(page, czOnly(auditCzResponse({ detail: czDetail({}, 120) })))
    const note = page.getByTestId('audit-cz-sync-mobile')
    await expect(note).toHaveClass(/md-audit-sync-wrapped/)
    await resize(page, 700, 900)
    await expect(note).not.toHaveClass(/md-audit-sync-wrapped/)
    await expect(note.locator('.md-audit-sync-sep')).toBeVisible()
  })
})

test.describe('swap list filter', () => {
  const swaps = () => [
    ...czSwapList([ok, melt, limits, ok, pending, ok, ok]),
    ...czSwapList([ok, melt]).map((s, i) => ({ ...s, id: `t${i}`, direction: 'to' as const, otherMintUrl: `https://src${i}.example`, at: ago((90 + i) * 60_000) })),
  ]

  test('a group of toggle buttons with counts; exactly one is pressed; the old strip and tablist are gone', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: swaps() })))
    await expect(chips(page)).toHaveText(['All 9', 'Deposits 2', 'Withdrawals 7', 'Failed 2'])
    await expect(swapList(page).locator('[aria-pressed="true"]')).toHaveText('All 9')
    await chips(page).nth(3).click()
    await expect(swapList(page).locator('[aria-pressed="true"]')).toHaveText('Failed 2')
    await expect(swapList(page).locator('tbody tr')).toHaveCount(2)
    await expect(page.locator('.md-audit-collapsible').getByRole('tab')).toHaveCount(0)
    await expect(page.locator('.audit-swap-bar')).toHaveCount(0)
    await expect(page.getByTestId('audit-swap-bar-caption')).toHaveCount(0)
  })

  test('keyboard: Tab reaches the filter, Enter and Space switch it', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: swaps() })))
    await chips(page).nth(1).focus()
    await page.keyboard.press('Enter')
    await expect(chips(page).nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(swapList(page).locator('tbody tr')).toHaveCount(2)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Space')
    await expect(chips(page).nth(2)).toHaveAttribute('aria-pressed', 'true')
    await expect(swapList(page).locator('tbody tr')).toHaveCount(7)
  })

  test('switching the filter does not move anything above it', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: swaps() })))
    await layoutReady(page)
    // Measured from the top of the card: a shorter list can change the page's scroll position, not the layout above the filter.
    const top = async () => (await swapList(page).getByRole('group', { name: 'Filter swaps' }).boundingBox())!.y - (await page.locator('.md-audit-collapsible').boundingBox())!.y
    const before = await top()
    await chips(page).nth(3).click()
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(0.5)
    await chips(page).nth(0).click()
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(0.5)
  })

  test('phone: every filter button is at least 44 px high', async ({ page }) => {
    await resize(page, 390, 844)
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: swaps() })))
    await layoutReady(page)
    for (const b of await chips(page).all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  })

  test('a list with no failed swap shows no failed chip in any row', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: czSwapList([ok, ok]) })))
    await expect(swapList(page).locator('tbody tr')).toHaveCount(2)
    await expect(swapList(page).locator('.au-res-fail')).toHaveCount(0)
  })
})

// On phones the Result text of a failed row wraps inside its cell, only at the space or after an underscore
// ("failed (mint_quote)" never breaks inside a word), is never cut, and the page does not scroll sideways.
for (const [w, h] of [[640, 900], [390, 844], [320, 640]] as const) {
  test(`Result text of failed rows is not clipped and the page does not scroll sideways @ ${w}px`, async ({ page }) => {
    await resize(page, w, h)
    const swaps = [
      ...czSwapList([ok, { ...melt, kind: 'a-rather-long-destination-host-name', stage: 'melt', durationMs: 17289722 }, { kind: 'another-long-mint-host-name', status: 'failed', stage: 'mint_quote', error: 'mint failed', durationMs: 183600000, amount: 1234567 }]),
      ...czSwapList([ok, melt, { kind: 'another-long-mint-host-name', status: 'failed', stage: 'mint_quote', error: 'mint failed', durationMs: 17289722 }]).map((x, i) => ({ ...x, id: `t${i}`, direction: 'to' as const, at: ago((90 + i) * 60_000) })),
    ]
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps })))
    await expect(swapList(page).locator('tbody tr')).toHaveCount(6)
    await layoutReady(page)
    const m = await page.evaluate(() => {
      const out: Array<{ state: string; cellClipped: boolean; textOutside: boolean; amountClipped: boolean; fontPx: number; splitWords: string[] }> = []
      for (const tr of document.querySelectorAll('.audit-swaps-table tbody tr')) {
        const cells = tr.querySelectorAll('td')
        const td = cells[cells.length - 1] as HTMLElement
        const amount = cells[3] as HTMLElement
        const trigger = (td.querySelector('[data-tooltip-trigger]') ?? td.querySelector('.au-res') ?? td) as HTMLElement
        const cr = td.getBoundingClientRect(), tr2 = trigger.getBoundingClientRect()
        const chars: Array<{ ch: string; top: number }> = []
        const walker = document.createTreeWalker(trigger, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if ((n.parentElement as HTMLElement).closest('.sr-only')) continue
          const text = n.textContent ?? ''
          for (let i = 0; i < text.length; i++) {
            const range = document.createRange()
            range.setStart(n, i); range.setEnd(n, i + 1)
            const rect = range.getClientRects()[0]
            if (rect) chars.push({ ch: text[i]!, top: rect.top })
          }
        }
        // A word runs to the next space or underscore (the underscore stays with the word before it); a word on two lines is a mid-word wrap.
        const split: string[] = []
        let word: typeof chars = []
        const flush = () => { if (word.length && word.some(c => Math.abs(c.top - word[0]!.top) > 3)) split.push(word.map(c => c.ch).join('')); word = [] }
        for (const c of chars) {
          if (/\s/.test(c.ch)) { flush(); continue }
          word.push(c)
          if (c.ch === '_') flush()
        }
        flush()
        out.push({
          state: (trigger.textContent ?? '').trim(),
          cellClipped: td.scrollWidth > td.clientWidth + 1 || trigger.scrollWidth > trigger.clientWidth + 1,
          textOutside: tr2.right > cr.right + 1 || tr2.left < cr.left - 1,
          amountClipped: amount.scrollWidth > amount.clientWidth + 1,
          fontPx: parseFloat(getComputedStyle(td).fontSize),
          splitWords: split,
        })
      }
      const wrap = document.querySelector('.audit-swaps-table-wrap') as HTMLElement
      return { rows: out, doc: document.documentElement.scrollWidth - window.innerWidth, wrap: wrap.scrollWidth - wrap.clientWidth }
    })
    expect(m.rows.length).toBe(6)
    for (const r of m.rows) {
      expect(r.cellClipped, `"${r.state}" is cut`).toBe(false)
      expect(r.textOutside, `"${r.state}" leaves its cell`).toBe(false)
      expect(r.amountClipped, `amount cut next to "${r.state}"`).toBe(false)
      expect(r.fontPx).toBeGreaterThanOrEqual(12)
      expect(r.splitWords, `"${r.state}" breaks inside a word`).toEqual([])
    }
    expect(m.doc).toBeLessThanOrEqual(0)
    expect(m.wrap, 'the table fits its box').toBeLessThanOrEqual(0)
    // the failed rows carry the amber chip and their full state is in the text
    await expect(swapList(page).locator('tr.au-row-fail', { hasText: 'failed (melt)' })).toHaveCount(2)
    await expect(swapList(page).locator('tr.au-row-fail', { hasText: 'failed (mint_quote)' })).toHaveCount(2)
    await expect(swapList(page).locator('tr.au-row-fail .au-res-fail')).toHaveCount(4)
  })
}

// Duration: ms under a second, seconds with one decimal under a minute ("10.9 s", not "10934 ms"), a short human form from a minute on.
test('Duration of a swap: ms, then seconds, then a short form from a minute on', async ({ page }) => {
  await resize(page, 1440, 900)
  const swaps = [
    ...czSwapList([{ ...ok, durationMs: 1759 }, { ...melt, durationMs: 17289722 }, { ...melt, durationMs: 62000 }, { ...melt, durationMs: 183600000 }]),
    ...czSwapList([{ ...melt, durationMs: 59999 }, { ...melt, durationMs: 3600000 }, { ...ok, durationMs: 640 }]).map((x, i) => ({ ...x, id: `t${i}`, direction: 'to' as const, at: ago((90 + i) * 60_000) })),
  ]
  await gotoAuditTab(page, czOnly(auditCzResponse({ swaps })))
  await expect(swapList(page).locator('tbody tr')).toHaveCount(7)
  const durations = await swapList(page).locator('tbody tr').evaluateAll(trs => trs.map(tr => tr.querySelectorAll('td')[5]!.textContent))
  expect(durations).toEqual(['1.7 s', '4 h 48 min', '1 min 2 s', '2 d 3 h', '59.9 s', '1 h', '640 ms'])
})

for (const [w, h] of [[1440, 900], [768, 1024], [390, 844], [320, 640]] as const) {
  test(`layout at ${w}px: inside the panel, no overflow, 12px floor on phones`, async ({ page }) => {
    await resize(page, w, h)
    const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10)
    const swaps = [
      ...czSwapList([ok, melt, limits, ok, pending, ok, ok]),
      ...czSwapList([ok, melt]).map((s, i) => ({ ...s, id: `t${i}`, direction: 'to' as const, otherMintUrl: `https://a-rather-long-source-host-name-${i}.mint.example`, at: ago((90 + i) * 60_000) })),
    ]
    const daily7d = [6, 5, 4, 3, 2, 1, 0].map(b => ({ day: day(b), ok: 12 + b, failed: b % 3, other: 0 }))
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps, daily7d, long: { windowDays: 28, swaps: 410, attributedFailures: 2 }, since: { day: '2026-08-01', swaps: 900, attributedFailures: 3 } })))
    await expect(swapList(page).locator('tbody tr')).toHaveCount(8)
    await expect(page.getByTestId('audit-days')).toBeVisible()
    await layoutReady(page)
    for (const filter of [0, 3] as const) {
      await chips(page).nth(filter).click()
      const m = await page.locator('.md-audit-collapsible').evaluate(root => {
        const pr = root.getBoundingClientRect()
        const out: string[] = []
        const small: string[] = []
        for (const el of root.querySelectorAll<HTMLElement>('*')) {
          if (el.closest('.audit-swaps-table-wrap')) continue // the table has its own box
          const r = el.getBoundingClientRect()
          if (r.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1)) out.push(String(el.className || el.tagName))
          if (!el.closest('.sr-only') && [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim()) && parseFloat(getComputedStyle(el).fontSize) < 12) small.push(String(el.className || el.tagName))
        }
        return { out, small, docOverflow: document.documentElement.scrollWidth - window.innerWidth }
      })
      expect(m.out, String(filter)).toEqual([])
      expect(m.docOverflow, String(filter)).toBeLessThanOrEqual(0)
      if (w <= 480) expect(m.small, String(filter)).toEqual([])
    }
  })
}
