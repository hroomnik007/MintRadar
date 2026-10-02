import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { installApiMocks, probePayload, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// "Get in Touch": the unverified NIP-05 of the announcing profile is a muted text line under the
// card grid (no card / link / copy button); only its ⓘ is interactive.
const ALPHA = MOCK_MINTS[0]!.url
const sk = generateSecretKey()
const pk = getPublicKey(sk)
const TOOLTIP = 'Taken from the Nostr profile of the account that announced this mint. MintRadar has not checked it.'
const EMAIL = { method: 'email', info: 'admin@example.com' }
const NOSTR = { method: 'nostr', info: 'npub1' + 'q'.repeat(58) }

async function open(page: Page, opts: { contacts?: { method: string; info: string }[]; nip05?: string | null; width?: number } = {}) {
  const { contacts = [EMAIL, NOSTR], nip05 = 'alice@example.com', width } = opts
  const ev = nip05 === null ? null : finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ nip05 }) }, sk)
  await page.routeWebSocket(/^wss:\/\//, ws => ws.onMessage(m => {
    const p = JSON.parse(String(m)) as [string, ...unknown[]]
    if (p[0] === 'REQ') {
      const kinds = ((p[2] as { kinds?: number[] })?.kinds) ?? []
      if (ev && kinds.includes(0)) ws.send(JSON.stringify(['EVENT', p[1], ev]))
      ws.send(JSON.stringify(['EOSE', p[1]]))
    } else if (p[0] === 'EVENT') ws.send(JSON.stringify(['OK', (p[1] as { id: string }).id, true, '']))
  }))
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({
    json: MOCK_KNOWN_MINTS.map(m => m.url === ALPHA ? { ...m, nostrAnnouncePubkey: pk, nostrAnnounceD: 'alpha' } : m),
  }))
  await page.route('**/api/mint/probe**', r => {
    const p = probePayload(ALPHA)
    r.fulfill({ json: { ...p, info: { ...p.info, contact: contacts } } })
  })
  if (width) await page.setViewportSize({ width, height: 1000 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  // The block is found by its content, not its heading: with only a NIP-05 value there is no heading.
  const panel = page.locator('.md-panel', { has: page.locator('.md-contact-grid, .md-nip05-line') })
  return { panel, line: panel.locator('.md-nip05-line'), icon: panel.locator('.md-nip05-tip') }
}

test.describe('Mint Detail — unverified NIP-05 line', () => {
  test('the grid holds exactly the Email and Nostr cards; the NIP-05 is a muted line below it', async ({ page }) => {
    const { panel, line } = await open(page)
    await expect(line).toBeVisible()
    await expect(panel.locator('.md-contact-card')).toHaveCount(2)
    await expect(panel.locator('.md-contact-type')).toHaveText(['Email', 'Nostr'])
    await expect(panel).not.toContainText('NIP-05 (unverified)')
    await expect(line).toContainText('Profile NIP-05 · not verified: alice@example.com')
    await expect(line.locator('.md-nip05-val')).toHaveText('alice@example.com')
    // Directly below the grid, inside the same block.
    const g = (await panel.locator('.md-contact-grid').boundingBox())!
    const l = (await line.boundingBox())!
    expect(l.y).toBeGreaterThanOrEqual(g.y + g.height)
    // Muted, small, normal weight; the value is mono.
    const css = await line.evaluate(el => {
      const cs = getComputedStyle(el), v = getComputedStyle(el.querySelector('.md-nip05-val')!)
      return { size: cs.fontSize, weight: cs.fontWeight, mono: v.fontFamily }
    })
    expect(css.size).toBe('11.5px')
    expect(css.weight).toBe('400')
    expect(css.mono).toMatch(/mono/i)
  })

  test('plain text only: no link, no mailto:, no copy button, no hover state', async ({ page }) => {
    const { line } = await open(page)
    await expect(line).toBeVisible()
    await expect(line.locator('a')).toHaveCount(0)
    await expect(line.locator('button')).toHaveCount(0)
    expect(await line.innerHTML()).not.toMatch(/mailto:|nostr:|href=/i)
    const text = line.locator('.md-nip05-text')
    expect(await text.evaluate(el => getComputedStyle(el).cursor)).not.toBe('pointer')
    // Only the ⓘ is interactive.
    await expect(line.locator('[tabindex], [role="button"]')).toHaveCount(1)
  })

  test('the ⓘ is focusable and shows the tooltip on keyboard focus and on hover', async ({ page }) => {
    const { line, icon } = await open(page)
    await expect(line).toBeVisible()
    await expect(icon).toHaveAttribute('aria-label', TOOLTIP)
    await expect(icon).toHaveAttribute('tabindex', '0')
    await expect(line.getByRole('tooltip')).toHaveCount(0)

    await page.keyboard.press('Tab') // make the next programmatic focus count as keyboard focus
    await icon.focus()
    await expect(icon).toBeFocused()
    await expect(line.getByRole('tooltip')).toHaveText(TOOLTIP)
    await page.keyboard.press('Escape')
    await expect(line.getByRole('tooltip')).toHaveCount(0)
    await icon.blur()

    await icon.hover()
    await expect(line.getByRole('tooltip')).toHaveText(TOOLTIP)
    await page.mouse.move(5, 5)
    await expect(line.getByRole('tooltip')).toHaveCount(0)
  })

  for (const long of [false, true]) {
    test(`at 390px the line wraps without horizontal overflow${long ? ' (very long value)' : ''}`, async ({ page }) => {
      const nip05 = long ? `${'verylongname'.repeat(8)}@${'subdomain.'.repeat(5)}example.com` : 'alice@example.com'
      const { line } = await open(page, { width: 390, nip05 })
      await expect(line).toBeVisible()
      await line.scrollIntoViewIfNeeded()
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      expect(o.sw).toBeLessThanOrEqual(o.cw)
      const b = (await line.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(390)
      if (long) expect(b.height).toBeGreaterThan(30) // wrapped onto several lines
    })
  }

  test('the value is rendered as text, never as HTML', async ({ page }) => {
    const { line } = await open(page, { nip05: '<img src=x onerror=window.__x=1>@example.com' })
    await expect(line.locator('.md-nip05-val')).toHaveText('<img src=x onerror=window.__x=1>@example.com')
    await expect(line.locator('img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined()
  })

  test('touch: the ⓘ has a 44px invisible hit area (icon stays small)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true })
    const page = await ctx.newPage()
    const { line, icon } = await open(page)
    await expect(line).toBeVisible()
    const r = await icon.evaluate(el => {
      const b = el.getBoundingClientRect(), p = getComputedStyle(el, '::before')
      return { w: b.width, h: b.height, pw: parseFloat(p.width), ph: parseFloat(p.height) }
    })
    expect(r.w).toBeLessThan(20)
    expect(r.pw).toBeGreaterThanOrEqual(44)
    expect(r.ph).toBeGreaterThanOrEqual(44)
    // A tap on the ::before area (15px right of the icon's centre, outside the icon) opens the tooltip.
    await icon.scrollIntoViewIfNeeded()
    const b = (await icon.boundingBox())!
    await page.touchscreen.tap(b.x + b.width / 2 + 15, b.y + b.height / 2)
    await expect(line.getByRole('tooltip')).toHaveText(TOOLTIP)
    await ctx.close()
  })

  test('no NIP-05 value → no line; only email → block unchanged', async ({ page }) => {
    const { panel, line } = await open(page, { contacts: [EMAIL], nip05: null })
    await expect(panel).toBeVisible()
    await expect(panel.locator('.md-contact-card')).toHaveCount(1)
    await page.waitForTimeout(1500) // let the (empty) profile lookup settle
    await expect(line).toHaveCount(0)
    await expect(panel).not.toContainText('NIP-05')
  })

  test('only email + the NIP-05 line keeps the Email card as it was', async ({ page }) => {
    const { panel, line } = await open(page, { contacts: [EMAIL] })
    await expect(line).toBeVisible()
    await expect(panel.locator('.md-contact-card')).toHaveCount(1)
    await expect(panel.locator('.md-contact-type')).toHaveText(['Email'])
  })
})

// The block keeps its visibility rule (email || twitter || nostr || NIP-05) but the heading and
// the card grid only render when at least one of email / twitter / nostr exists.
const TWITTER = { method: 'twitter', info: '@alpha_mint' }
const noHeading = (page: Page) => page.locator('.md-panel-title', { hasText: 'Get in Touch' })

test.describe('Mint Detail — "Get in Touch" heading', () => {
  test('all values: heading, three cards and the NIP-05 line', async ({ page }) => {
    const { panel, line } = await open(page, { contacts: [EMAIL, TWITTER, NOSTR] })
    await expect(panel.locator('.md-panel-title')).toHaveText('Get in Touch')
    await expect(panel.locator('.md-contact-type')).toHaveText(['Email', 'Twitter', 'Nostr'])
    await expect(line).toBeVisible()
  })

  test('email only: heading and one card, no NIP-05 line', async ({ page }) => {
    const { panel, line } = await open(page, { contacts: [EMAIL], nip05: null })
    await expect(panel.locator('.md-panel-title')).toHaveText('Get in Touch')
    await expect(panel.locator('.md-contact-card')).toHaveCount(1)
    await page.waitForTimeout(1500) // let the (empty) profile lookup settle
    await expect(line).toHaveCount(0)
  })

  test('NIP-05 only: no heading, no empty grid — just the muted line with its ⓘ, same top spacing', async ({ page }) => {
    const { panel, line, icon } = await open(page, { contacts: [] })
    await expect(line).toBeVisible()
    await expect(noHeading(page)).toHaveCount(0)
    await expect(page.getByText('Get in Touch')).toHaveCount(0)
    await expect(page.locator('.md-contact-grid')).toHaveCount(0)
    await expect(panel.locator('.md-contact-card')).toHaveCount(0)
    await expect(line).toContainText('Profile NIP-05 · not verified: alice@example.com')
    // Same block, and the line starts where the heading would: panel border + padding, no extra margin.
    const lead = await panel.evaluate((el, ln) => {
      const cs = getComputedStyle(el)
      return ln!.getBoundingClientRect().top - el.getBoundingClientRect().top - parseFloat(cs.paddingTop) - parseFloat(cs.borderTopWidth)
    }, await line.elementHandle())
    expect(Math.abs(lead)).toBeLessThan(1)
    // The ⓘ still works (keyboard focus opens the tooltip).
    await page.keyboard.press('Tab')
    await icon.focus()
    await expect(line.getByRole('tooltip')).toHaveText(TOOLTIP)
  })

  test('with a card, the line keeps its 10px gap under the grid', async ({ page }) => {
    const { panel, line } = await open(page, { contacts: [EMAIL] })
    await expect(line).toBeVisible()
    const l = (await line.boundingBox())!
    const g = (await panel.locator('.md-contact-grid').boundingBox())!
    expect(Math.round(l.y - (g.y + g.height))).toBe(10)
  })

  test('nothing at all: the block is not rendered', async ({ page }) => {
    const { panel } = await open(page, { contacts: [], nip05: null })
    await page.waitForTimeout(1500) // let the (empty) profile lookup settle
    await expect(panel).toHaveCount(0)
    await expect(page.getByText('Get in Touch')).toHaveCount(0)
    await expect(page.locator('.md-contact-grid, .md-nip05-line')).toHaveCount(0)
  })
})
