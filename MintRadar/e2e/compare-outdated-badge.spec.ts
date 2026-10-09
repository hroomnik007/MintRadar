import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// The Compare modal's "Outdated" badge uses the ONE shared version rule (versionRule.ts) with the "latest" the
// API sends with each mint (`softwareLatest`): two or more MINOR versions behind the newest stable release of the
// mint's OWN software. It no longer depends on which mints happen to be compared (the old rule took the newest
// version among the compared mints, so a lone mint could never be flagged), and a mint of one software is never
// judged against another software's numbering.

type Over = { version: string | null; softwareLatest: { major: number; minor: number } | null }

async function overrideKnownMints(page: import('@playwright/test').Page, overrides: Record<string, Over>) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', route =>
    route.fulfill({
      json: MOCK_KNOWN_MINTS.map(m => ({
        ...m,
        online: true,
        degraded: false,
        ...(m.name in overrides ? overrides[m.name] : {}),
      })),
    }),
  )
}

async function openCompareFor(page: import('@playwright/test').Page, names: string[]) {
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  const [first, ...rest] = names
  await page.locator('.mint-card', { hasText: first! }).locator('button.card-compare-btn').click()
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

const CDK = { major: 0, minor: 18 }
const NUT = { major: 0, minor: 21 }

test.describe('Compare modal — Outdated badge follows the shared rule', () => {
  test('a current cdk-mintd mint is NOT flagged Outdated just because a compared Nutshell mint has a higher number', async ({ page }) => {
    await overrideKnownMints(page, {
      'Alpha Mint': { version: 'cdk-mintd/0.18.0', softwareLatest: CDK }, // current for cdk
      'Delta Mint': { version: 'Nutshell/0.21.3', softwareLatest: NUT },  // numerically far ahead, different software
    })
    await openCompareFor(page, ['Alpha Mint', 'Delta Mint'])

    await expect(versionCellOutdated(page, 0)).toHaveCount(0)
    await expect(versionCellOutdated(page, 1)).toHaveCount(0)
  })

  test('an old mint is flagged against its own software\'s latest even when it is the only one of its software in the comparison', async ({ page }) => {
    await overrideKnownMints(page, {
      'Alpha Mint': { version: 'cdk-mintd/0.15.1', softwareLatest: CDK }, // real-world trigger case: 3 behind
      'Delta Mint': { version: 'Nutshell/0.21.0', softwareLatest: NUT },
    })
    await openCompareFor(page, ['Alpha Mint', 'Delta Mint'])

    await expect(versionCellOutdated(page, 0)).toBeVisible()
    await expect(versionCellOutdated(page, 1)).toHaveCount(0)
  })

  test('one minor version behind is NOT outdated; two behind is', async ({ page }) => {
    await overrideKnownMints(page, {
      'Alpha Mint': { version: 'Nutshell/0.20.3', softwareLatest: NUT },  // 1 behind
      'Bravo Mint': { version: 'Nutshell/0.19.2', softwareLatest: NUT },  // 2 behind
      'Delta Mint': { version: 'cdk-mintd/0.17.7', softwareLatest: CDK }, // 1 behind
    })
    await openCompareFor(page, ['Alpha Mint', 'Bravo Mint', 'Delta Mint'])

    await expect(versionCellOutdated(page, 0)).toHaveCount(0)
    await expect(versionCellOutdated(page, 1)).toBeVisible()
    await expect(versionCellOutdated(page, 2)).toHaveCount(0)
  })

  test('a pre-release of the current line and a mint without a latest are NOT flagged', async ({ page }) => {
    await overrideKnownMints(page, {
      'Alpha Mint': { version: 'cdk-mintd/0.18.0-rc.1', softwareLatest: CDK },
      'Bravo Mint': { version: 'Nutshell/0.12.0', softwareLatest: null }, // no latest known for it: nothing to compare against
    })
    await openCompareFor(page, ['Alpha Mint', 'Bravo Mint'])

    await expect(versionCellOutdated(page, 0)).toHaveCount(0)
    await expect(versionCellOutdated(page, 1)).toHaveCount(0)
  })
})
