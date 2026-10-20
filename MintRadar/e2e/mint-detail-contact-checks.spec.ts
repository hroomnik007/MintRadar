import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, probePayload, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Mint Detail: one muted line of facts under the contact information ("Contact checks: ..."), from the stored contactChecks
// of the probe answer. Facts only, neutral wording, nothing shown for a mint without checks, values stay as they were.
const ALPHA = MOCK_MINTS[0]!.url
const CHECKED = new Date(Date.now() - 5 * 60_000).toISOString()
const check = (kind: string, formatValid: boolean, domainResolves: boolean | null) => ({ kind, formatValid, domainResolves, checkedAt: CHECKED })
const CONTACT = [{ method: 'email', info: 'admin@example.com' }, { method: 'nostr', info: 'ab'.repeat(32) }]

async function open(page: Page, contactChecks: unknown, opts: { contact?: typeof CONTACT; width?: number; height?: number } = {}) {
  await installApiMocks(page)
  await page.route('**/api/mint/probe**', r => {
    const p = probePayload(ALPHA)
    r.fulfill({ json: { ...p, info: { ...p.info, contact: opts.contact ?? CONTACT }, ...(contactChecks === undefined ? {} : { contactChecks }) } })
  })
  if (opts.width) await page.setViewportSize({ width: opts.width, height: opts.height ?? 1000 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await layoutReady(page)
  return { panel: page.locator('.md-panel', { has: page.locator('.md-contact-grid') }), line: page.getByTestId('contact-checks') }
}

test.describe('Mint Detail — contact checks line', () => {
  test('all checks valid: facts, a relative time and the absolute UTC time in the title', async ({ page }) => {
    const { panel, line } = await open(page, [check('email', true, true), check('nostr', true, null)])
    await expect(line).toHaveCount(1)
    await expect(line).toContainText('Contact checks: email format valid, domain has mail records · Nostr key valid · checked 5 min ago')
    await expect(line.locator('span[title]')).toHaveAttribute('title', /UTC$/)
    // Under the contact cards, inside the same block, muted and at least 12 px.
    const g = (await panel.locator('.md-contact-grid').boundingBox())!
    const l = (await line.boundingBox())!
    expect(l.y).toBeGreaterThanOrEqual(g.y + g.height)
    const css = await line.evaluate(el => { const cs = getComputedStyle(el); return { size: parseFloat(cs.fontSize), weight: cs.fontWeight } })
    expect(css.size).toBeGreaterThanOrEqual(12)
    expect(css.weight).toBe('400')
    // Plain text: no link, no button, no value of any contact.
    await expect(line.locator('a, button')).toHaveCount(0)
    await expect(line).not.toContainText('admin@example.com')
    await expect(line).not.toContainText('example.com')
  })

  test('an invalid e-mail format is stated as a fact, without a domain claim and without verdict words', async ({ page }) => {
    const { line } = await open(page, [check('email', false, null), check('nostr', true, null)])
    await expect(line).toContainText('Contact checks: email format not valid · Nostr key valid · checked 5 min ago')
    const text = (await line.innerText())
    expect(text).not.toMatch(/domain/)
    expect(text).not.toMatch(/verified|trusted|fake|safe|scam/i)
  })

  test('an unknown DNS result reads as inconclusive, never as "no mail records"', async ({ page }) => {
    const { line } = await open(page, [check('email', true, null)])
    await expect(line).toContainText('email format valid, domain lookup inconclusive')
    await expect(line).not.toContainText('no mail records')
  })

  test('no checks (empty array or no field): no line, and the contact block is unchanged', async ({ page }) => {
    for (const checks of [[], undefined]) {
      const { panel, line } = await open(page, checks)
      await expect(panel.locator('.md-contact-card')).toHaveCount(2)
      await expect(line).toHaveCount(0)
      await expect(page.locator('body')).not.toContainText('Contact checks')
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    }
  })

  test('checks for a mint that lists no e-mail, Twitter or Nostr (a website only) still show, without a "Get in touch" heading', async ({ page }) => {
    const { line } = await open(page, [check('url', true, null)], { contact: [{ method: 'website', info: 'https://mint-site.com' }] })
    await expect(line).toContainText('Contact checks: website URL valid · checked 5 min ago')
    await expect(page.locator('.md-panel-title', { hasText: 'Get in touch' })).toHaveCount(0)
  })

  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844], [320, 640]] as const) {
    test(`wraps and never overflows at ${w}px`, async ({ page }) => {
      const { line } = await open(page, [check('email', true, true), check('email', false, null), check('nostr', true, null), check('twitter', true, null), check('telegram', false, null), check('url', true, null)], { width: w, height: h })
      await expect(line).toBeVisible()
      await resize(page, w, h)
      const m = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="contact-checks"]')!.getBoundingClientRect()
        return { right: el.right, left: el.left, vw: innerWidth, scroll: document.documentElement.scrollWidth }
      })
      expect(m.left).toBeGreaterThanOrEqual(0)
      expect(m.right).toBeLessThanOrEqual(m.vw)
      expect(m.scroll).toBeLessThanOrEqual(m.vw)
    })
  }
})
