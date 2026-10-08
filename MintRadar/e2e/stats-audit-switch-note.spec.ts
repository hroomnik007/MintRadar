import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// One-time note under "Reliability Score movers": shown for 30 days after AUDIT_SOURCE_SWITCH_DATE
// (src/utils/auditSourceSwitch.ts, '2026-10-08'), hidden afterwards. The browser clock is fixed so the
// spec does not depend on the real date.
const DAY = 86_400_000
const SWITCH = Date.parse('2026-10-08')

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test('shown on the switch date: muted line, no banner, link to the scoring module', async ({ page }) => {
  await page.clock.setFixedTime(new Date(SWITCH + 3_600_000))
  await page.goto('/stats')
  const panel = page.locator('.stats-movers-panel')
  await panel.scrollIntoViewIfNeeded()
  const note = panel.locator('.stats-movers-note')
  await expect(note).toBeVisible()
  await expect(note).not.toContainText('the audit part of the score moved to cashu.info')
  await expect(note).not.toHaveAttribute('role', 'alert')
  const link = note.getByRole('link', { name: 'How scoring works' })
  await expect(link).toHaveAttribute('href', '/learn/how-to-choose-a-mint')
  await link.click()
  await expect(page).toHaveURL(/\/learn\/how-to-choose-a-mint$/)
})

test('still shown on day 29', async ({ page }) => {
  await page.clock.setFixedTime(new Date(SWITCH + 29 * DAY))
  await page.goto('/stats')
  await expect(page.locator('.stats-movers-note')).toBeVisible()
})

test('hidden 31 days after the switch', async ({ page }) => {
  await page.clock.setFixedTime(new Date(SWITCH + 31 * DAY))
  await page.goto('/stats')
  await expect(page.locator('.stats-movers-panel')).toBeVisible()
  await expect(page.locator('.stats-movers-note')).toHaveCount(0)
  await expect(page.getByText('How scoring works')).toHaveCount(0)
})
