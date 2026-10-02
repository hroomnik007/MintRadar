import { test, expect, type Page } from '@playwright/test'
import { MIXED_ROW_MINTS, gotoMixedRow } from './fixtures/mixedRow'
import { installApiMocks, mockRelays } from './fixtures/mocks'

const card = (page: Page, name: string) => page.locator('.mint-card', { hasText: name })

test.describe('canonical unit order (display only)', () => {
  test('card chips show SAT / USD and SAT / USD / EUR whatever order the API returns', async ({ page }) => {
    await gotoMixedRow(page)
    // API order: ['usd','sat'] and ['eur','usd','sat']
    await expect(card(page, 'Normal Mint').locator('.card-pills .card-pill').first()).toHaveText('SAT / USD')
    await expect(card(page, 'Testmint Mint').locator('.card-pills .card-pill').first()).toHaveText('SAT / USD / EUR')
    await expect(card(page, 'Newbie Mint').locator('.card-pills .card-pill').first()).toHaveText('SAT / USD')
  })

  for (const [name, url, expected] of [
    ['Normal Mint', 'https://normal.mint.example', ['SAT', 'USD']],
    ['Testmint Mint', 'https://testnut.cashu.space', ['SAT', 'USD', 'EUR']],
  ] as const) {
    test(`Mint Detail lists units of ${name} in canonical order`, async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await page.route('**/api/mints/known', r => r.fulfill({ json: MIXED_ROW_MINTS }))
      await page.goto(`/mint/${encodeURIComponent(url)}`)
      await expect(page.locator('.md-um-panel-methods .unit-badge')).toHaveText([...expected])
    })
  }

  test('the unit filter matches the same mints regardless of API order', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/known', r => r.fulfill({ json: MIXED_ROW_MINTS }))
    await page.goto('/?testmints=show&status=all&unit=eur')
    await expect(page.locator('.mint-card')).toHaveCount(1)
    await expect(page.locator('.mint-card .card-name')).toHaveText('Testmint Mint')
    await page.goto('/?testmints=show&status=all&unit=usd')
    // usd: Normal, Testmint, Offline, Newbie — everything except the sat-only Noreviews
    await expect(page.locator('.mint-card')).toHaveCount(4)
    await expect(page.locator('.mint-card', { hasText: 'Noreviews Mint' })).toHaveCount(0)
  })
})

// The metrics block (RELIABILITY label, score, rating line) is pinned to the card's
// bottom edge. A Test mint / Same op badge must not lift the label above neighbours.
for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`metrics block sits at identical positions on every card variant (${w}px)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    await gotoMixedRow(page)
    await expect(page.locator('.mint-card')).toHaveCount(MIXED_ROW_MINTS.length)
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.mint-card')].map(c => {
        const box = (sel: string) => { const b = c.querySelector(sel)!.getBoundingClientRect(); return { top: b.top + scrollY } }
        const cb = c.getBoundingClientRect()
        return {
          name: c.querySelector('.card-name')!.textContent,
          cardTop: cb.top + scrollY,
          cardBottom: cb.bottom + scrollY,
          label: box('.card-reliability-label, .card-reliability-na').top,
          score: box('.card-reliability-score').top,
          rating: box('.card-reliability-rating, .card-reliability-no-reviews').top,
        }
      }),
    )
    // 1) cards sharing a grid row: absolute tops equal
    const sameRow = new Map<number, typeof rows>()
    for (const r of rows) {
      const key = [...sameRow.keys()].find(k => Math.abs(k - r.cardTop) < 0.5) ?? r.cardTop
      sameRow.set(key, [...(sameRow.get(key) ?? []), r])
    }
    for (const group of sameRow.values()) {
      for (const part of ['label', 'score', 'rating'] as const) {
        for (const r of group) expect(Math.abs(r[part] - group[0]![part]), `${part} of ${r.name}`).toBeLessThanOrEqual(0.5)
      }
    }
    // 2) every card (also single-column layouts): offset from the card's bottom edge equal
    for (const part of ['label', 'score', 'rating'] as const) {
      const off = rows.map(r => r.cardBottom - r[part])
      for (let i = 0; i < rows.length; i++) expect(Math.abs(off[i]! - off[0]!), `${part} of ${rows[i]!.name}`).toBeLessThanOrEqual(0.5)
    }
  })
}
