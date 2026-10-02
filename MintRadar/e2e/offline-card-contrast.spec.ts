import { test, expect } from '@playwright/test'
import { gotoDimmedGrid } from './fixtures/dimmedCards'
import { measureEffective } from './fixtures/contrast'

// Offline (24h+) cards must not be dimmed with whole-card opacity; every text element reaches WCAG AA
// (4.5:1), the large score 3:1, icons / controls / the status dot 3:1 — as EFFECTIVE colours, i.e. with any
// opacity composited over what is behind the card. The entry animation (`fadein … both`) holds opacity:1
// and would mask a `.mint-card.offline { opacity }` rule, so it is switched off here.
const TEXT: [string, string][] = [
  ['name', '.card-name'], ['hostname', '.card-host'], ['unit chip', '.card-pill >> nth=0'],
  ['LN chip', '.card-ln'], ['up chip', '.card-pill >> nth=2'], ['Offline 24h+ badge', '.card-hdr-badge'],
  ['LAST SEEN label', '.latency-label'], ['last seen value', '.latency-value'], ['RELIABILITY label', '.card-reliability-label'],
  ['rating value', '.card-reliability-rating-val'], ['rating count', '.card-reliability-rating-n'],
]
const OFFLINE = ['Offgreen', 'Offamber', 'Offred', 'Archived']

for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`offline cards keep readable contrast without opacity (${vp.width}px)`, async ({ page }) => {
    await page.setViewportSize(vp)
    await gotoDimmedGrid(page)
    await page.addStyleTag({ content: '.mint-card { animation: none !important; }' })
    await expect(page.locator('.mint-card')).toHaveCount(9)

    for (const name of OFFLINE) {
      const card = page.locator('.mint-card.offline', { hasText: `${name} Mint` })
      await expect(card, name).toHaveCount(1)
      await expect.soft(await card.evaluate(el => getComputedStyle(el).opacity), `${name} card opacity`).toBe('1')

      const frame = await measureEffective(card, 'bg')
      expect.soft(frame.ratio, `${name} card vs page`).toBeGreaterThanOrEqual(1.31)

      for (const [label, sel] of TEXT) {
        // The rating line is absent on mints without reviews ("No reviews yet" is checked below).
        if (!(await card.locator(sel).count())) { expect.soft(sel.includes('rating'), `${name} ${label} missing`).toBe(true); continue }
        const m = await measureEffective(card.locator(sel).first())
        expect.soft(m.opacity, `${name} ${label} opacity`).toBe(1)
        expect.soft(m.ratio, `${name} ${label}`).toBeGreaterThanOrEqual(4.5)
      }
      expect.soft((await measureEffective(card.locator('.card-reliability-score'))).ratio, `${name} score (large)`).toBeGreaterThanOrEqual(3)
      if (await card.locator('.card-reliability-star').count()) {
        expect.soft((await measureEffective(card.locator('.card-reliability-star'))).ratio, `${name} rating star`).toBeGreaterThanOrEqual(3)
      }
      expect.soft((await measureEffective(card.locator('.card-star'))).ratio, `${name} watch star`).toBeGreaterThanOrEqual(3)
      expect.soft((await measureEffective(card.locator('.status-dot'), 'bg')).ratio, `${name} status dot`).toBeGreaterThanOrEqual(3)
    }

    // The no-reviews line is text too.
    const noRev = page.locator('.mint-card.offline', { hasText: 'Offamber Mint' }).locator('.card-reliability-no-reviews')
    expect.soft((await measureEffective(noRev)).ratio, 'No reviews yet').toBeGreaterThanOrEqual(4.5)

    // Still recognisable as offline: the avatar is muted on its own, the card is not identical to an online one.
    const avatar = page.locator('.mint-card.offline').first().locator('.card-avatar-offline')
    await expect(avatar).toHaveCSS('opacity', '0.55')
    const online = await measureEffective(page.locator('.mint-card:not(.offline)', { hasText: 'Normal Mint' }), 'bg')
    const off = await measureEffective(page.locator('.mint-card.offline').first(), 'bg')
    expect(off.fg).not.toEqual(online.fg)
    // The status dot of an offline card stays the full --red (never dimmed).
    await expect(page.locator('.mint-card.offline .status-dot').first()).toHaveCSS('opacity', '1')
  })
}
