import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// The Compare modal's "Outdated" badge used to compute isOutdated against the
// highest minor-version number among ALL compared mints, regardless of
// software — so a cdk-mintd mint could be flagged "Outdated" purely because a
// Nutshell mint in the same comparison happened to carry a higher raw number
// (two unrelated projects with independent numbering; the real-world trigger
// was a cdk-mintd/0.15.1 mint compared against a 0.20.x Nutshell mint). The
// fix groups compared mints by canonical software (same parsing as
// versionFreshnessScore() in trustScore.ts) and only flags a mint against the
// newest version of its OWN software among the mints being compared.

async function overrideKnownMints(page: import('@playwright/test').Page, overrides: Record<string, string | null>) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', route =>
    route.fulfill({
      json: MOCK_KNOWN_MINTS.map(m => ({
        ...m,
        online: true,
        degraded: false,
        version: m.name in overrides ? overrides[m.name] : m.version,
      })),
    }),
  )
}

async function openCompareFor(page: import('@playwright/test').Page, names: string[]) {
  await page.goto('/')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  const [first, ...rest] = names
  await page.locator('.mint-card', { hasText: first! }).locator('button', { hasText: 'Compare' }).click()
  for (const name of rest) {
    await page.locator('.md-picker-item', { hasText: name }).click()
  }
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
}

// Locates the "Outdated" badge (if any) within the Version row's column for
// the mint at the given position (mints render as columns in the order they
// were selected — first is the card the Compare button was clicked from).
function versionCellOutdated(page: import('@playwright/test').Page, columnIndex: number) {
  return page.locator('.cmp-lbl', { hasText: 'Version' })
    .locator('xpath=following-sibling::div[contains(@class,"cmp-val")]')
    .nth(columnIndex)
    .getByText('Outdated')
}

test.describe('Compare modal — Outdated badge is software-scoped', () => {
  test('a current cdk-mintd mint is NOT flagged Outdated just because a compared Nutshell mint has a higher number', async ({ page }) => {
    await overrideKnownMints(page, {
      'Alpha Mint': 'cdk-mintd/0.15.1', // real-world trigger case
      'Delta Mint': 'Nutshell/0.20.3',  // numerically far ahead, different software
    })
    await openCompareFor(page, ['Alpha Mint', 'Delta Mint'])

    // Alpha (cdk) is alone in its software group among the compared mints —
    // it must not be judged against Delta's unrelated Nutshell numbering.
    await expect(versionCellOutdated(page, 0)).toHaveCount(0)
    // Delta (Nutshell) is likewise alone in its group — trivially not outdated.
    await expect(versionCellOutdated(page, 1)).toHaveCount(0)
  })

  test('reverse direction: an old Nutshell mint is NOT flagged Outdated just because a compared cdk-mintd mint has a higher number', async ({ page }) => {
    await overrideKnownMints(page, {
      'Alpha Mint': 'Nutshell/0.12.0',  // old, but no other Nutshell mint to compare against here
      'Bravo Mint': 'cdk-mintd/0.19.0', // numerically far ahead, different software
    })
    await openCompareFor(page, ['Alpha Mint', 'Bravo Mint'])

    await expect(versionCellOutdated(page, 0)).toHaveCount(0)
    await expect(versionCellOutdated(page, 1)).toHaveCount(0)
  })

  test('within-software comparison still works correctly once the cross-software noise is removed', async ({ page }) => {
    await overrideKnownMints(page, {
      'Alpha Mint': 'cdk-mintd/0.15.1',  // old cdk — should be flagged against Bravo
      'Bravo Mint': 'cdk-mintd/0.19.0',  // current cdk in this comparison
      'Delta Mint': 'Nutshell/0.20.3',   // unrelated software, must not affect either cdk mint
    })
    await openCompareFor(page, ['Alpha Mint', 'Bravo Mint', 'Delta Mint'])

    await expect(versionCellOutdated(page, 0)).toBeVisible() // Alpha: genuinely behind, within cdk
    await expect(versionCellOutdated(page, 1)).toHaveCount(0) // Bravo: newest cdk in this set
    await expect(versionCellOutdated(page, 2)).toHaveCount(0) // Delta: alone in its own group
  })
})
