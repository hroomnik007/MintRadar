import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { measureEffective } from './fixtures/contrast'

// 1) Unsupported NUT cards (Mint Detail > NUTs) were dimmed with whole-card opacity .4: the name measured
//    2.21:1 and the description 2.62:1 (WCAG 1.4.3 needs 4.5:1). They now use muted token colours at full
//    opacity, and stay visibly different from the supported ones without relying on low contrast alone
//    (since the 2026-11-19 redesign: rows with a "Not supported" state word in its own colour and a dimmer name).
// 2) Links inside running text (a paragraph or list item that has other text around the link) carry an
//    underline as well as their colour (WCAG 1.4.1). Buttons, cards, navigation, footer and table-cell links
//    are not in-text links and are left alone.

const DETAIL = `/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}#nuts`

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

async function openNuts(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(DETAIL)
  await expect(page.locator('.nut-card.unsupported').first()).toBeVisible()
  await page.addStyleTag({ content: '.nut-card, .nut-card * { transition: none !important; }' })
}

// Rows of the grouped NUT list since the 2026-11-19 redesign (they were cards with a dashed border for unsupported ones).
for (const width of [1440, 390]) {
  test(`unsupported NUT rows: text >= 4.5:1 at full opacity, still visibly dimmer than supported (${width}px)`, async ({ page }) => {
    await openNuts(page, width)
    const cards = page.locator('.nut-card.unsupported')
    const n = await cards.count()
    expect(n).toBeGreaterThanOrEqual(3)

    for (const hover of [false, true]) {
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i)
        if (hover) await card.hover(); else await page.mouse.move(0, 0)
        const name = (await card.locator('.nut-tag').textContent())!.trim()
        expect.soft(await card.evaluate(el => getComputedStyle(el).opacity), `${name} row opacity`).toBe('1')
        for (const [label, sel] of [['tag', '.nut-tag'], ['name', '.nut-row-name b'], ['description', '.nut-row-name span'], ['state', '.nut-row-state']] as const) {
          const m = await measureEffective(card.locator(sel))
          expect.soft(m.opacity, `${name} ${label} opacity`).toBe(1)
          expect.soft(m.ratio, `${name} ${label}${hover ? ' (hover)' : ''}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }

    // Hierarchy, not low contrast alone: a different state word and colour, and a dimmer name.
    const sup = page.locator('.nut-card.supported').first()
    const uns = cards.first()
    await expect(uns.locator('.nut-row-state')).toHaveText('Not supported')
    await expect(sup.locator('.nut-row-state')).toHaveText('Supported')
    const color = (c: typeof sup, sel: string) => c.locator(sel).evaluate(el => getComputedStyle(el).color)
    expect(await color(uns, '.nut-row-state')).not.toBe(await color(sup, '.nut-row-state'))
    expect((await measureEffective(uns.locator('.nut-row-name b'))).ratio).toBeLessThan((await measureEffective(sup.locator('.nut-row-name b'))).ratio)
  })
}

const TEXT_PAGES = [
  '/methodology', '/for-wallets', '/about',
  '/learn/cashu-basics', '/learn/understanding-the-risks', '/learn/how-to-choose-a-mint',
  '/learn/getting-started-with-a-wallet', '/learn/safe-habits', '/learn/99',
]

for (const width of [1440, 390]) {
  for (const path of TEXT_PAGES) {
    test(`links in running text are underlined: ${path} (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(path)
      await expect(page.locator('main h1').first()).toBeAttached()
      const rows = await page.evaluate(() => {
        const out: { text: string; deco: string }[] = []
        for (const a of Array.from(document.querySelectorAll('main a[href]')) as HTMLAnchorElement[]) {
          // a link is "in running text" when its paragraph / list item has other text around it
          const block = a.closest('p, li, dd, blockquote, .learn-not-found')
          if (!block) continue
          const clone = block.cloneNode(true) as HTMLElement
          clone.querySelectorAll('a').forEach(x => x.remove())
          if (clone.textContent!.replace(/\s+/g, ' ').trim().length < 6) continue
          if (a.closest('nav, footer, header, button, [role="button"], table')) continue
          out.push({ text: a.innerText.trim().slice(0, 40), deco: getComputedStyle(a).textDecorationLine })
        }
        return out
      })
      for (const r of rows) expect.soft(r.deco, `link "${r.text}"`).toContain('underline')
      // the pages that have prose links must actually have been reached (not a vacuous pass)
      if (!path.endsWith('/learn/99') && !path.includes('cashu-basics') && !path.includes('understanding') && !path.includes('safe-habits')) {
        expect(rows.length, `${path} has in-text links`).toBeGreaterThan(0)
      }
    })
  }
}

test('Learn CTA buttons and the Back link are not underlined (not in-text links)', async ({ page }) => {
  await page.goto('/learn/how-to-choose-a-mint')
  await expect(page.locator('.learn-cta-btn')).toBeVisible()
  expect(await page.locator('.learn-cta-btn').evaluate(e => getComputedStyle(e).textDecorationLine)).toBe('none')
  expect(await page.locator('.learn-back-link').evaluate(e => getComputedStyle(e).textDecorationLine)).toBe('none')
})
