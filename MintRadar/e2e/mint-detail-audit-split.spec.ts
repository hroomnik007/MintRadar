import { test, expect } from '@playwright/test'
import { NO_8333, auditCzResponse, czDetail, czSwapList, gotoAuditTab, ago } from './fixtures/auditCz'
import { layoutReady, resize } from './fixtures/settle'

type Page = import('@playwright/test').Page

// Audit tab, cashu.info view (Task Y G): the Deposits / Withdrawals tiles (the W6b rows are gone), the one source line,
// the caption of the swap strip and the two swap tables behind a tablist.

const tile = (page: Page, key: 'mints' | 'melts') => page.locator(`.audit-cz-tiles [data-tile="${key}"]`)
const czOnly = (cz: unknown) => ({ alpha: { ...NO_8333 }, cz })
const ok = { kind: 'ok', durationMs: 1000 }
const melt = { kind: 'melt', status: 'failed', stage: 'melt', error: 'melt failed', durationMs: 500 }
const limits = { kind: 'limits', status: 'failed', stage: 'limits', error: 'Amount 3 sat is below the mint minimum of 100 sat', durationMs: null }
const pending = { kind: 'pending', status: 'pending', durationMs: null }

test.describe('tiles', () => {
  test('Deposits (mint) first, then Withdrawals (melt): successful / attempts and "N failed"', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await expect(page.locator('.audit-cz-tiles .audit-cz-tile-label')).toHaveText(
      ['Deposits (mint)', 'Withdrawals (melt)', 'Without a failure caused by this mint', 'Avg swap time'])
    // asDest (62 attempts, 56 ok, 6 failed) is the deposit side, asSource (64, 51, 13) the withdrawal side
    await expect(tile(page, 'mints').locator('.audit-summary-value')).toHaveText('56 / 62')
    await expect(tile(page, 'mints').locator('.audit-cz-tile-sub')).toHaveText('6 failed')
    await expect(tile(page, 'melts').locator('.audit-summary-value')).toHaveText('51 / 64')
    await expect(tile(page, 'melts').locator('.audit-cz-tile-sub')).toHaveText('13 failed')
  })

  test('the W6b rows and their two sentences are gone', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await expect(page.locator('.audit-cz-tiles')).toBeVisible()
    await expect(page.getByTestId('audit-directions')).toHaveCount(0)
    await expect(page.getByText(/uses this same cashu\.info window/)).toHaveCount(0)
    await expect(page.getByText(/These rows are the same data split by direction/)).toHaveCount(0)
    await expect(page.getByText(/attempts?, \d+ failures?/)).toHaveCount(0)
  })

  test('no failures: no subtext; a very small sample is shown as it is, in the one constant colour', async ({ page }) => {
    const cz = auditCzResponse({ detail: czDetail({ swaps7d: { all: { total: 11, success: 9, failed: 2 }, asSource: { total: 10, success: 10, failed: 0 }, asDest: { total: 1, success: 0, failed: 1 }, errorsBlamed: 1 } }) })
    await gotoAuditTab(page, czOnly(cz))
    await expect(tile(page, 'melts').locator('.audit-summary-value')).toHaveText('10 / 10')
    await expect(tile(page, 'melts').locator('.audit-cz-tile-sub')).toHaveCount(0)
    await expect(tile(page, 'mints').locator('.audit-summary-value')).toHaveText('0 / 1')
    await expect(tile(page, 'mints').locator('.audit-cz-tile-sub')).toHaveText('1 failed')
    const color = (key: 'mints' | 'melts') => tile(page, key).locator('.audit-summary-value').evaluate(e => getComputedStyle(e).color)
    expect(await color('mints')).toBe(await color('melts'))
  })

  test('a direction without numbers says "No data" instead of numbers', async ({ page }) => {
    const cz = auditCzResponse({ detail: czDetail({ swaps7d: { all: { total: 30, success: 30, failed: 0 }, asSource: { total: 30, success: 30, failed: 0 }, errorsBlamed: 0 } }) })
    await gotoAuditTab(page, czOnly(cz))
    await expect(tile(page, 'mints').locator('.audit-summary-value')).toHaveText('No data')
    await expect(tile(page, 'mints').locator('.audit-cz-tile-sub')).toHaveCount(0)
    await expect(tile(page, 'melts').locator('.audit-summary-value')).toHaveText('30 / 30')
  })

  test('no swaps block at all: both direction tiles say "No data"', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ detail: czDetail({ swaps7d: undefined }) })))
    await expect(page.locator('.audit-cz-tiles .audit-summary-value')).toHaveText(['No data', 'No data'])
  })

  test('the tile tooltips say what mint and melt mean for this mint', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await tile(page, 'mints').locator('.info-tooltip').hover()
    await expect(page.getByRole('tooltip')).toHaveText('Deposits into this mint (mint operations) in the last 7 days, counted by cashu.info: successful of all.')
    await tile(page, 'melts').locator('.info-tooltip').hover()
    await expect(page.getByRole('tooltip')).toHaveText('Withdrawals from this mint (melt operations) in the last 7 days, counted by cashu.info: successful of all.')
  })
})

test.describe('source line and header tooltip', () => {
  test('one line under the tiles: cashu.info · last 7 days · synced <relative>, the UTC time in the title', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    const line = page.getByTestId('audit-cz-source')
    await expect(line).toHaveText('cashu.info · last 7 days · synced 10 min ago')
    await expect(line.locator('span[title]')).toHaveAttribute('title', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/)
    await expect(page.getByTestId('audit-cz-source')).toHaveCount(1)
    // under the tiles, not before them
    const [tilesY, lineY] = await Promise.all([page.locator('.audit-cz-tiles').boundingBox(), line.boundingBox()])
    expect(lineY!.y).toBeGreaterThan(tilesY!.y + tilesY!.height - 1)
  })

  test('the Audit stats ⓘ carries the meaning of the old rows, with the real window', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse()))
    await page.locator('.md-audit-header-main .md-audit-info').hover()
    await expect(page.getByRole('tooltip')).toHaveText('audit.8333.space has no recent data for this mint. The Reliability Score uses the combined cashu.info number for the last 7 days. Deposits and withdrawals are the same data split by direction.')
  })
})

test.describe('swap strip caption', () => {
  test('states exactly what the strip shows', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: czSwapList([ok, melt, limits, pending, ok]) })))
    await expect(page.locator('.audit-swap-bar-mark')).toHaveCount(5)
    await expect(page.getByTestId('audit-swap-bar-caption')).toHaveText(
      "The latest 5 swaps MintRadar stored from cashu.info, both directions, newest first. Green: succeeded. Red: failed. Grey: not counted against the mint (below the mint's minimum, the auditor's balance, or no outcome yet).")
    // the marks follow the caption: 2 green, 1 red, 2 grey, newest left
    await expect(page.locator('.audit-swap-bar-ok')).toHaveCount(2)
    await expect(page.locator('.audit-swap-bar-fail')).toHaveCount(1)
    await expect(page.locator('.audit-swap-bar-neutral')).toHaveCount(2)
    await expect(page.locator('.audit-swap-bar-mark').first()).toHaveClass(/audit-swap-bar-ok/)
  })

  test('no swaps: no strip and no caption', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: [] })))
    await expect(page.locator('.audit-cz-tiles')).toBeVisible()
    await expect(page.getByTestId('audit-swap-bar-caption')).toHaveCount(0)
  })
})

test.describe('swap tables behind a tablist', () => {
  const twoDirections = () => [
    ...czSwapList([ok, melt, ok, ok, ok, ok, ok]),
    ...czSwapList([ok, melt]).map((s, i) => ({ ...s, id: `t${i}`, direction: 'to' as const, otherMintUrl: `https://src${i}.example`, at: ago((90 + i) * 60_000) })),
  ]

  test('tablist semantics: roles, names, counts, one panel at a time, From first', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: twoDirections() })))
    const list = page.getByRole('tablist', { name: 'Swap direction' })
    await expect(list).toBeVisible()
    const tabs = list.getByRole('tab')
    await expect(tabs).toHaveText(['From this mint (7)', 'To this mint (2)'])
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false')
    await expect(tabs.first()).toHaveAttribute('tabindex', '0')
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1')
    // exactly one table, labelled by the selected tab
    await expect(page.getByRole('tabpanel')).toHaveCount(1)
    await expect(page.getByTestId('audit-cz-table')).toHaveCount(1)
    await expect(page.getByRole('tabpanel')).toHaveAccessibleName('From this mint (7)')
    await expect(page.getByRole('tabpanel').locator('th').first()).toHaveText('To')
    await expect(page.getByRole('tabpanel').locator('tbody tr')).toHaveCount(5)
    await expect(page.getByRole('tabpanel').locator('.audit-swaps-show-all-btn')).toHaveText('Show all (7)')
    // the failed-row styling and the cashu.info link are kept
    await expect(page.getByRole('tabpanel').locator('tr.audit-swap-row-fail')).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Open on cashu.info →' })).toBeVisible()
  })

  test('arrow keys, Home and End move between the tabs and switch the panel', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: twoDirections() })))
    const from = page.getByRole('tab', { name: /^From this mint/ })
    const to = page.getByRole('tab', { name: /^To this mint/ })
    await from.focus()
    await page.keyboard.press('ArrowRight')
    await expect(to).toBeFocused()
    await expect(to).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel').locator('th').first()).toHaveText('From')
    await expect(page.getByRole('tabpanel').locator('tbody tr')).toHaveCount(2)
    await page.keyboard.press('ArrowRight') // wraps
    await expect(from).toBeFocused()
    await page.keyboard.press('End')
    await expect(to).toBeFocused()
    await page.keyboard.press('Home')
    await expect(from).toBeFocused()
    await expect(from).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft') // wraps back
    await expect(to).toBeFocused()
    // Tab leaves the tablist for the panel content: the inactive tab is not a Tab stop
    await expect(from).toHaveAttribute('tabindex', '-1')
  })

  test('switching panels does not move anything above the control', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: twoDirections() })))
    await expect(page.getByRole('tablist', { name: 'Swap direction' })).toBeVisible()
    const above = async () => page.evaluate(() => {
      const list = document.querySelector('[role="tablist"][aria-label="Swap direction"]')!
      const top = list.getBoundingClientRect().top
      return [...document.querySelectorAll('.audit-cz-tiles, .audit-cz-source, .audit-swap-bar, .audit-swap-bar-caption, [role="tablist"]')]
        .map(e => [Math.round(e.getBoundingClientRect().top - top), Math.round(e.getBoundingClientRect().height)])
    })
    const before = await above()
    await page.getByRole('tab', { name: /^To this mint/ }).click()
    await expect(page.getByRole('tabpanel').locator('tbody tr')).toHaveCount(2)
    expect(await above()).toEqual(before)
  })

  test('44 px touch targets on phones', async ({ page }) => {
    await resize(page, 390, 844)
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: twoDirections() })))
    for (const tab of await page.getByRole('tab').all()) {
      const box = await tab.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
  })

  test('a direction with no failure rows shows no failed styling', async ({ page }) => {
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps: czSwapList([ok, ok]) })))
    await expect(page.getByRole('tabpanel').locator('tr.audit-swap-row-fail')).toHaveCount(0)
  })
})

// Task Z: on phones the State text of a failed row was cut by its 54 px cell ("failed (melt)" read "…led (me"). It wraps now.
for (const [w, h] of [[640, 900], [390, 844], [320, 640]] as const) {
  test(`State text of failed rows is not clipped and the page does not scroll sideways @ ${w}px`, async ({ page }) => {
    await resize(page, w, h)
    const swaps = [
      ...czSwapList([ok, { ...melt, kind: 'a-rather-long-destination-host-name', stage: 'melt' }, { kind: 'another-long-mint-host-name', status: 'failed', stage: 'mint', error: 'mint failed', durationMs: 12345, amount: 1234567 }, limits, pending]),
      ...czSwapList([ok, melt, { kind: 'another-long-mint-host-name', status: 'failed', stage: 'mint', error: 'mint failed', durationMs: 12345 }]).map((x, i) => ({ ...x, id: `t${i}`, direction: 'to' as const, at: ago((90 + i) * 60_000) })),
    ]
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps })))
    await layoutReady(page)
    for (const panel of ['from', 'to'] as const) {
      if (panel === 'to') await page.getByRole('tab', { name: /^To this mint/ }).click()
      const rows = page.locator('.audit-swaps-table tbody tr')
      await expect(rows.first()).toBeVisible()
      await layoutReady(page)
      const m = await page.evaluate(() => {
        const out: Array<{ state: string; cellClipped: boolean; textOutside: boolean; amountClipped: boolean; fontPx: number }> = []
        for (const tr of document.querySelectorAll('.audit-swaps-table tbody tr:not(:first-child)')) {
          const cells = tr.querySelectorAll('td')
          const td = cells[cells.length - 1] as HTMLElement
          const amount = cells[1] as HTMLElement
          const trigger = (td.querySelector('[data-tooltip-trigger]') ?? td) as HTMLElement
          const cr = td.getBoundingClientRect(), tr2 = trigger.getBoundingClientRect()
          out.push({
            state: (trigger.textContent ?? '').trim(),
            cellClipped: td.scrollWidth > td.clientWidth + 1 || trigger.scrollWidth > trigger.clientWidth + 1,
            textOutside: tr2.right > cr.right + 1 || tr2.left < cr.left - 1,
            amountClipped: amount.scrollWidth > amount.clientWidth + 1,
            fontPx: parseFloat(getComputedStyle(td).fontSize),
          })
        }
        return { rows: out, doc: document.documentElement.scrollWidth - window.innerWidth, wrap: (document.querySelector('.audit-swaps-table-wrap') as HTMLElement).scrollWidth - (document.querySelector('.audit-swaps-table-wrap') as HTMLElement).clientWidth }
      })
      expect(m.rows.length, panel).toBeGreaterThan(1)
      for (const r of m.rows) {
        expect(r.cellClipped, `${panel}: "${r.state}" is cut`).toBe(false)
        expect(r.textOutside, `${panel}: "${r.state}" leaves its cell`).toBe(false)
        expect(r.amountClipped, `${panel}: amount cut next to "${r.state}"`).toBe(false)
        expect(r.fontPx).toBeGreaterThanOrEqual(12)
      }
      expect(m.doc, panel).toBeLessThanOrEqual(0)
      expect(m.wrap, `${panel}: the table scrolls inside its box`).toBeLessThanOrEqual(0)
    }
    // the failed row keeps its styling and its full state is in the text
    await page.getByRole('tab', { name: /^From this mint/ }).click()
    await expect(page.locator('tr.audit-swap-row-fail').first()).toContainText('failed (melt)')
  })
}

for (const [w, h] of [[1440, 900], [768, 1024], [390, 844], [320, 640]] as const) {
  test(`layout at ${w}px: inside the panel, no overflow, 12px floor on phones`, async ({ page }) => {
    await resize(page, w, h)
    const swaps = [
      ...czSwapList([ok, melt, limits, ok, pending, ok, ok]),
      ...czSwapList([ok, melt]).map((s, i) => ({ ...s, id: `t${i}`, direction: 'to' as const, otherMintUrl: `https://a-rather-long-source-host-name-${i}.mint.example`, at: ago((90 + i) * 60_000) })),
    ]
    await gotoAuditTab(page, czOnly(auditCzResponse({ swaps })))
    await expect(page.getByRole('tab')).toHaveCount(2)
    await layoutReady(page)
    for (const panel of ['from', 'to'] as const) {
      if (panel === 'to') await page.getByRole('tab', { name: /^To this mint/ }).click()
      const m = await page.locator('.md-audit-collapsible').evaluate(root => {
        const pr = root.getBoundingClientRect()
        const out: string[] = []
        const small: string[] = []
        for (const el of root.querySelectorAll<HTMLElement>('*')) {
          if (el.closest('.audit-swaps-table-wrap')) continue // the table scrolls inside its own box
          const r = el.getBoundingClientRect()
          if (r.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1)) out.push(String(el.className || el.tagName))
          if (!el.closest('.sr-only') && [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim()) && parseFloat(getComputedStyle(el).fontSize) < 12) small.push(String(el.className || el.tagName))
        }
        return { out, small, docOverflow: document.documentElement.scrollWidth - window.innerWidth }
      })
      expect(m.out, panel).toEqual([])
      expect(m.docOverflow, panel).toBeLessThanOrEqual(0)
      if (w <= 480) expect(m.small, panel).toEqual([])
    }
  })
}
