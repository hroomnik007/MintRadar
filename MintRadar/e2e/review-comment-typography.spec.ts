import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

// The comment of a review on Mint Detail is 15 px with a 1.55 line height in --text (the lightest text token): old
// 13 px / 1.5 / --text2. Reviewer name, date, short key, stars and the action icons are not touched. A long word or
// URL wraps (overflow-wrap: anywhere) inside the card, also at 320 px. A review without text has no comment element.

const MINT_URL = MOCK_MINTS[0]!.url
const SHORT = 'Works fine, minted and melted without trouble.'
const LONG = 'I have used this mint for several months for small amounts. Deposits arrive within a minute, melts to Lightning are reliable, and the operator answers questions quickly. The only downside is the occasional slow response in the evening, which never lost any funds. '.repeat(2).trim()
const LINK = 'Details of my test here: https://example.com/a/very/long/path/with-many-segments/and-a-query?token=abcdefghijklmnopqrstuvwxyz0123456789&other=value-that-keeps-going-and-going-and-going'
const UNBROKEN = 'x'.repeat(220)

const now = Math.floor(Date.now() / 1000)
const texts: Array<{ id: string; text: string; key: string }> = [
  { id: 'short', text: SHORT, key: 'short' },
  { id: 'long', text: LONG, key: 'long' },
  { id: 'link', text: LINK, key: 'link' },
  { id: 'unbroken', text: UNBROKEN, key: 'unbroken' },
  { id: 'none', text: '', key: 'none' },
]

async function setup(page: Page, width: number) {
  await mockRelays(page)
  await installApiMocks(page)
  const reviews = texts.map((t, i) => {
    const ev = finalizeEvent({ kind: 38000, created_at: now - i * 60, tags: [['u', MINT_URL], ['rating', '4']], content: t.text }, generateSecretKey())
    return { id: ev.id, pubkey: ev.pubkey, content: ev.content, rating: 4, createdAt: ev.created_at, source: 'nostr' }
  })
  await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({ json: reviews }))
  await page.setViewportSize({ width, height: 900 })
  await page.goto(`/mint/${encodeURIComponent(MINT_URL)}`)
  await page.getByRole('button', { name: 'Reviews', exact: true }).click()
  await expect(page.locator('.review-card')).toHaveCount(texts.length)
}

// Short key and date follow the 12 px phone floor (MintDetail.css, max-width 767px since cf79605e); desktop keeps 11 / 10 px.
const SMALL_TEXT: Record<number, { npub: string; date: string }> = { 1440: { npub: '11px', date: '10px' }, 390: { npub: '12px', date: '12px' } }

for (const width of [1440, 390]) {
  test(`review comment at ${width}px: 15px, line height 1.55, contrast at least 7:1; the rest of the item unchanged`, async ({ page }) => {
    await setup(page, width)
    const c = page.locator('.review-comment').first()
    await expect(c).toHaveText(SHORT)
    const r = await c.evaluate(el => {
      const cs = getComputedStyle(el)
      const parse = (v: string) => { const m = v.match(/[\d.]+/g)!.map(Number); return { r: m[0]!, g: m[1]!, b: m[2]!, a: m[3] ?? 1 } }
      const lin = (x: number) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
      const lum = (c: { r: number; g: number; b: number }) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
      // the effective background: the translucent layers from the element up to the root, composited over the root's colour
      const layers: Array<ReturnType<typeof parse>> = []
      for (let n: Element | null = el; n; n = n.parentElement) { const b = parse(getComputedStyle(n).backgroundColor); if (b.a > 0) layers.push(b) }
      let bg = { r: 11, g: 21, b: 18 }
      for (const l of layers.reverse()) bg = { r: l.r * l.a + bg.r * (1 - l.a), g: l.g * l.a + bg.g * (1 - l.a), b: l.b * l.a + bg.b * (1 - l.a) }
      const fg = parse(cs.color)
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a)
      return { size: cs.fontSize, lh: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), ratio: (hi! + 0.05) / (lo! + 0.05), wrap: cs.overflowWrap, color: cs.color }
    })
    expect(r.size).toBe('15px')
    expect(r.lh).toBeCloseTo(1.55, 2)
    expect(r.ratio, `contrast ${r.ratio.toFixed(2)}`).toBeGreaterThanOrEqual(7)
    expect(r.wrap).toBe('anywhere')

    const card = page.locator('.review-card').first()
    const px = (sel: string) => card.locator(sel).first().evaluate(el => getComputedStyle(el).fontSize)
    expect(await px('.review-author-name')).toBe('14px')
    expect(await px('.review-author-npub')).toBe(SMALL_TEXT[width]!.npub)
    expect(await px('.review-date')).toBe(SMALL_TEXT[width]!.date)
    expect(await px('.review-stars')).toBe('12px')
    await expect(card.locator('.review-action-btn').first()).toBeVisible()
  })
}

for (const width of [320, 390]) {
  test(`review comments at ${width}px: a 220-character word and a long URL wrap inside the card, no horizontal overflow`, async ({ page }) => {
    await setup(page, width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    const vw = await page.evaluate(() => document.documentElement.clientWidth)
    for (const t of texts.filter(t => t.text)) {
      const p = page.locator('.review-comment', { hasText: t.text.slice(0, 20) }).first()
      await expect(p, t.id).toBeVisible()
      const m = await p.evaluate(el => {
        const card = el.closest('.review-card')!.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return { overflows: el.scrollWidth > el.clientWidth, inCard: r.left >= card.left - 0.5 && r.right <= card.right + 0.5, cardInView: card.right <= document.documentElement.clientWidth + 0.5 }
      })
      expect(m, t.id).toEqual({ overflows: false, inCard: true, cardInView: true })
    }
    expect(vw).toBe(width)
  })
}

test('a review without text has no comment element', async ({ page }) => {
  await setup(page, 390)
  await expect(page.locator('.review-card')).toHaveCount(texts.length)
  await expect(page.locator('.review-comment')).toHaveCount(texts.filter(t => t.text).length)
})
