import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { cmpOpenFold } from './fixtures/compare'

// Compare → History → "Software versions" (2026-11-28 redesign): one column per mint under the cards, the last two
// versions of each (version, then "since <date>" below it) and an "All versions" button for the rest. The column grows
// taller, never wider: entries are not clipped and nothing scrolls sideways, on the desktop or a phone, at 2, 3 and 4
// mints. A version may wrap after its slash, never inside the number.

const LONG_VH = {
  history: [
    { version: 'Nutshell/0.19.2', firstSeenAt: '2026-06-17T00:00:00Z' },
    { version: 'Nutshell/0.18.3', firstSeenAt: '2026-05-02T00:00:00Z' },
    { version: 'Nutshell/0.16.0', firstSeenAt: '2026-03-11T00:00:00Z' },
  ],
  latestGlobalVersion: 'Nutshell/0.20.0',
}

const OTHERS = ['Bravo Mint', 'Charlie Mint', 'Delta Mint']

async function openCompare(page: import('@playwright/test').Page, n: number) {
  await mockRelays(page)
  await installApiMocks(page)
  // Force all 4 mock mints online so the picker offers 3 candidates → 4-way compare.
  await page.route('**/api/mints/known', r =>
    r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => ({ ...m, online: true, degraded: false, latencyMs: m.latencyMs ?? 120, reliabilityScore: m.reliabilityScore ?? 60 })) }))
  await page.route('**/api/mints/version-history**', r => r.fulfill({ json: LONG_VH }))
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  for (const name of OTHERS.slice(0, n - 1)) {
    await page.locator('.md-picker-item', { hasText: name }).click()
  }
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText(/^Compare [2-4] mints$/)).toBeVisible()
}

for (const n of [2, 3, 4]) {
  for (const vp of [
    { label: 'desktop', size: { width: 1280, height: 900 } },
    { label: 'mobile', size: { width: 390, height: 844 } },
  ]) {
    test(`compare ${n} mints — ${vp.label}`, async ({ page }) => {
      await page.setViewportSize(vp.size)
      await openCompare(page, n)

      await cmpOpenFold(page, 'History')
      const versions = page.locator('.cx-row[data-row="versions"]')
      await versions.scrollIntoViewIfNeeded()
      const entries = versions.locator('.cmp-vh-entry')
      // The last two per mint until "All versions".
      await expect(entries).toHaveCount(2 * n)
      for (let i = 0; i < 2 * n; i++) {
        const clipped = await entries.nth(i).evaluate(el => el.scrollWidth > el.clientWidth + 1)
        expect(clipped, `entry ${i} clipped`).toBe(false)
      }
      const more = versions.getByRole('button', { name: 'All versions' })
      await expect(more).toHaveCount(n)
      await more.first().click()
      await expect(entries).toHaveCount(2 * n + 1)
      await expect(versions.getByRole('button', { name: 'Fewer versions' })).toHaveAttribute('aria-expanded', 'true')
      const modal = page.locator('.cmp-modal')
      expect(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)

      // At least one full "since 29 Sep 2026" string is rendered intact.
      await expect(entries.filter({ hasText: /since \d{1,2} [A-Z][a-z]{2} \d{4}/ }).first()).toBeVisible()
      await expect(entries.filter({ hasText: 'Nutshell/0.19.2' }).first()).toBeVisible()
    })
  }
}
