import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, probePayload, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady } from './fixtures/settle'
import { CONTACT_ROW_LABEL, contactRowText } from '../src/utils/tooltipTexts'

// Mint Detail: the facts about the contact entries ("Contact checks: ...", from the stored contactChecks of the probe
// answer) are part of the ⓘ of the Contact row in "How the N is made" since 2026-11-27 (owner). There is no muted line
// under "Get in touch" any more, and no NIP-05 line. Facts only, neutral wording, nothing added for a mint without checks.
const ALPHA = MOCK_MINTS[0]!.url
const CHECKED = new Date(Date.now() - 5 * 60_000).toISOString()
const check = (kind: string, formatValid: boolean, domainResolves: boolean | null) => ({ kind, formatValid, domainResolves, checkedAt: CHECKED })
const CONTACT = [{ method: 'email', info: 'admin@example.com' }, { method: 'nostr', info: 'ab'.repeat(32) }]

async function contactTip(page: Page, contactChecks: unknown, contact = CONTACT): Promise<string> {
  await installApiMocks(page)
  await page.route('**/api/mint/probe**', r => {
    const p = probePayload(ALPHA)
    r.fulfill({ json: { ...p, info: { ...p.info, contact }, ...(contactChecks === undefined ? {} : { contactChecks }) } })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await layoutReady(page)
  const row = page.locator('.md-reliability-panel .rb-row').filter({ has: page.locator('.rb-row-label', { hasText: CONTACT_ROW_LABEL }) })
  await row.locator('.rb-row-label [data-tooltip-trigger]').hover()
  const tip = page.locator('[role="tooltip"]')
  await expect(tip).toHaveCount(1)
  await expect(tip).toHaveCSS('visibility', 'visible')
  return (await tip.textContent() ?? '').replace(/\s+/g, ' ').trim()
}

test.describe('Mint Detail — contact checks in the Contact row tooltip', () => {
  test('all checks valid: the explanation, then the facts and a relative time', async ({ page }) => {
    const text = await contactTip(page, [check('email', true, true), check('nostr', true, null)])
    expect(text.startsWith(contactRowText())).toBe(true)
    expect(text).toContain('Contact checks: email format recognised, domain has mail records · Nostr contact format recognised · checked 5 min ago.')
    // No value of any contact in the facts.
    expect(text).not.toContain('admin@example.com')
    // The muted lines under the contact cards are gone.
    await expect(page.getByTestId('contact-checks')).toHaveCount(0)
    await expect(page.locator('.md-panel', { has: page.locator('.md-contact-grid') })).not.toContainText('Contact checks')
    await expect(page.locator('body')).not.toContainText('Profile NIP-05')
  })

  test('an e-mail format that is not recognised is stated as a fact, without a domain claim and without verdict words', async ({ page }) => {
    const text = await contactTip(page, [check('email', false, null), check('nostr', true, null)])
    expect(text).toContain('Contact checks: email format not recognised · Nostr contact format recognised · checked 5 min ago.')
    const facts = text.slice(text.indexOf('Contact checks:'))
    expect(facts).not.toMatch(/domain/)
    expect(facts).not.toMatch(/verified|trusted|fake|safe|scam|invalid|not valid/i)
  })

  test('an unknown DNS result reads as inconclusive, never as "no mail records"', async ({ page }) => {
    const text = await contactTip(page, [check('email', true, null)])
    expect(text).toContain('email format recognised, domain lookup inconclusive')
    expect(text).not.toContain('no mail records')
  })

  test('no checks (empty array or no field): the tooltip is the explanation alone', async ({ page }) => {
    for (const checks of [[], undefined]) {
      expect(await contactTip(page, checks)).toBe(contactRowText())
      await page.mouse.move(1, 1)
      await page.unrouteAll({ behavior: 'ignoreErrors' })
    }
  })
})
