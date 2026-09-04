import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// ComparisonModal → "Software Version History" once clipped its entries to
// "Nu" / "since 6/" because its grid had no overflow handling and forced
// nowrap. Each entry is now a two-line stack (version, then "since <date>"
// below it) that grows the column taller instead of wider, so it no longer
// needs its own scroll wrapper for a normal entry count. .cmp-vh-grid keeps
// `overflow-x: auto` directly (same pattern as .cmp-grid) for the
// column-count case — e.g. 4 mints on mobile still doesn't fit side by side.
// These pin: entries render un-clipped at 2/3/4 mints on both desktop and
// mobile, and the section scrolls when it genuinely overflows.

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
    r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => ({ ...m, online: true, degraded: false, latencyMs: m.latencyMs ?? 120, trustScore: m.trustScore ?? 60 })) }))
  await page.route('**/api/mints/version-history**', r => r.fulfill({ json: LONG_VH }))
  await page.goto('/')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button', { hasText: 'Compare' }).click()
  for (const name of OTHERS.slice(0, n - 1)) {
    await page.locator('.md-picker-item', { hasText: name }).click()
  }
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
}

for (const n of [2, 3, 4]) {
  for (const vp of [
    { label: 'desktop', size: { width: 1280, height: 900 } },
    { label: 'mobile', size: { width: 390, height: 844 } },
  ]) {
    test(`compare ${n} mints — ${vp.label}`, async ({ page }) => {
      await page.setViewportSize(vp.size)
      await openCompare(page, n)

      // Version History entries are fully visible (no text clipping): every
      // .cmp-vh-entry's scrollWidth must fit its own clientWidth.
      await page.getByText('Software Version History').scrollIntoViewIfNeeded()
      const entries = page.locator('.cmp-vh-entry')
      const count = await entries.count()
      expect(count).toBeGreaterThan(0)
      for (let i = 0; i < count; i++) {
        const el = entries.nth(i)
        const clipped = await el.evaluate(n => n.scrollWidth > n.clientWidth + 1)
        expect(clipped, `entry ${i} clipped`).toBe(false)
      }
      // The section is horizontally scrollable (not dead-clipped) when it overflows.
      const scroll = page.locator('.cmp-vh-grid')
      const overflow = await scroll.evaluate(n => ({ sw: n.scrollWidth, cw: n.clientWidth }))
      if (overflow.sw > overflow.cw) {
        await scroll.evaluate(n => { n.scrollLeft = n.scrollWidth })
        expect(await scroll.evaluate(n => n.scrollLeft)).toBeGreaterThan(0)
      }

      // At least one full "since M/D/YYYY" string is rendered intact.
      await expect(entries.filter({ hasText: /since \d+\/\d+\/\d{4}/ }).first()).toBeVisible()
      await expect(entries.filter({ hasText: 'Nutshell/0.19.2' }).first()).toBeVisible()
    })
  }
}
