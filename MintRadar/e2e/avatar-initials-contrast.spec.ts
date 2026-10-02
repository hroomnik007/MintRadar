import { test, expect, type Page } from '@playwright/test'
import { DIMMED_MINTS, gotoDimmedGrid } from './fixtures/dimmedCards'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS } from './fixtures/mocks'
import { measureEffective } from './fixtures/contrast'

// Every initial letter on a coloured tile reaches WCAG 4.5:1 (docs/claude/design-palette-and-chrome.md,
// "Avatar initials"): mint monograms (MintFavicon fallback), the account chip placeholder and the
// review avatars. Measured as effective colours (ancestor backgrounds + opacity composited).
// The dimmed offline (24h+) avatar is the one documented exception — see the last test.

// Cards fade in (0.22s); a measurement taken mid-animation would composite the partial opacity.
const settle = (page: Page) => page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' })

test.describe('avatar initials contrast', () => {
  for (const width of [1440, 390]) {
    test(`mint monograms on the grid reach 4.5:1 (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await gotoDimmedGrid(page)
      const tiles = page.locator('.mint-card:not(.offline) [role="img"][aria-label$="mint icon placeholder"]')
      await expect(tiles.first()).toBeVisible()
      await settle(page)
      const n = await tiles.count()
      expect(n).toBeGreaterThanOrEqual(5)
      for (let i = 0; i < n; i++) {
        const m = await measureEffective(tiles.nth(i))
        expect(m.ratio, `monogram ${i}`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  test('mint monograms in the Watchlist reach 4.5:1', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page)
    await page.goto('/')
    await page.waitForSelector('.mint-card')
    const watch = page.getByRole('button', { name: 'Watch', exact: true })
    const total = await watch.count()
    expect(total).toBeGreaterThanOrEqual(3)
    for (let i = 1; i <= 3; i++) {
      await watch.first().click()
      await expect(watch).toHaveCount(total - i)
    }
    await page.getByRole('link', { name: 'Watchlist' }).click()
    const tiles = page.locator('.wl-grid .mint-card [role="img"][aria-label$="mint icon placeholder"]')
    await expect(tiles.first()).toBeVisible()
    await settle(page)
    expect(await tiles.count()).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < await tiles.count(); i++) {
      expect((await measureEffective(tiles.nth(i))).ratio, `watchlist tile ${i}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('account chip placeholder initial reaches 4.5:1', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page, 'Peter')
    await page.goto('/')
    const chip = page.locator('.navbar-avatar--placeholder')
    await expect(chip).toHaveText('P')
    expect((await measureEffective(chip)).ratio).toBeGreaterThanOrEqual(4.5)
  })

  test('review avatar fallbacks reach 4.5:1 for every palette colour', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    // 12 pubkeys whose first 8 hex digits are 0..11 → every palette index (parseInt(…, 16) % 6) twice
    const reviews = Array.from({ length: 12 }, (_, i) => ({
      id: i.toString(16).padStart(2, '0').repeat(32), pubkey: i.toString(16).padStart(8, '0').repeat(8),
      content: `review ${i}`, rating: 4, createdAt: 1_700_000_000 + i, source: 'nostr',
    }))
    await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({ json: reviews }))
    await page.goto(`/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`)
    await page.locator('.md-tab', { hasText: 'Reviews' }).click()
    const tiles = page.locator('.review-avatar-fallback')
    const bgs = new Set<string>()
    let measured = 0
    for (let pageNo = 1; pageNo <= 3; pageNo++) {
      if (pageNo > 1) await page.locator('.reviews-page-btn', { hasText: new RegExp(`^${pageNo}$`) }).click()
      await expect(tiles.first()).toBeVisible()
      for (let i = 0; i < await tiles.count(); i++) {
        const m = await measureEffective(tiles.nth(i))
        bgs.add(m.bg.map(Math.round).join(','))
        measured++
        expect(m.ratio, `review avatar ${pageNo}.${i} (bg ${m.bg.map(Math.round)})`).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(measured).toBe(12)
    expect(bgs.size).toBe(6) // the whole palette was actually rendered
  })

  test('dimmed offline avatar: effective contrast (documented exception, must not regress)', async ({ page }) => {
    await gotoDimmedGrid(page)
    const tile = page.locator('.mint-card.offline .card-avatar-offline').first()
    await expect(tile).toBeVisible()
    await settle(page)
    // Effective colours of letter and tile after grayscale(.6) + opacity .55 over the offline card surface.
    const ratio = await tile.evaluate(el => {
      const cv = document.createElement('canvas').getContext('2d')!
      const parse = (css: string): [number, number, number, number] => {
        cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = css
        cv.globalCompositeOperation = 'copy'; cv.fillRect(0, 0, 1, 1)
        const d = cv.getImageData(0, 0, 1, 1).data
        return [d[0]!, d[1]!, d[2]!, d[3]! / 255]
      }
      type V = [number, number, number]
      const over = (t: [number, number, number, number], b: V): V => [0, 1, 2].map(i => t[i]! * t[3] + b[i]! * (1 - t[3])) as V
      let surface: V = [255, 255, 255]
      const chain: Element[] = []
      for (let e = el.parentElement; e; e = e.parentElement) chain.unshift(e)
      for (const e of chain) surface = over(parse(getComputedStyle(e).backgroundColor), surface)
      const cs = getComputedStyle(el)
      const tileBg = over(parse(cs.backgroundColor), surface)
      const text = over(parse(cs.color), tileBg)
      const g = Number(/grayscale\(([\d.]+)\)/.exec(cs.filter)?.[1] ?? 0)
      const gray = (c: V): V => {
        const k = 1 - g
        const m = [
          [0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k],
          [0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k],
          [0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k],
        ]
        return m.map(r => r[0]! * c[0] + r[1]! * c[1] + r[2]! * c[2]) as V
      }
      const o = Number(cs.opacity)
      const eff = (c: V): V => [0, 1, 2].map(i => gray(c)[i]! * o + surface[i]! * (1 - o)) as V
      const lum = (c: V) => {
        const k = c.map(v => { const s = Math.min(255, Math.max(0, v)) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
        return 0.2126 * k[0]! + 0.7152 * k[1]! + 0.0722 * k[2]!
      }
      const [hi, lo] = [lum(eff(text)), lum(eff(tileBg))].sort((a, b) => b - a)
      return (hi! + 0.05) / (lo! + 0.05)
    })
    // Before the fix the letter was plain copper: 2.19:1. The best reachable with theme tokens is
    // --text (4.46:1); the lifted copper mix lands near 3:1 and must not drop below it.
    expect(ratio).toBeGreaterThanOrEqual(2.9)
    expect(DIMMED_MINTS.some(m => m.degraded)).toBe(true)
  })
})
