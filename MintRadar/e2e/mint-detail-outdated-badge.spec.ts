import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, mockProbedVersion, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Mint Detail's "Version" stat renders an "Outdated" badge by the ONE shared version rule
// (shared/versionRule.ts): two or more MINOR versions behind the newest stable release of the mint's own
// software. "Latest" is the value the API sends with the mint (`softwareLatest`, the same value the stored
// Reliability Score was computed against), never a static list and never the network maximum seen by the
// page. A pre-release counts as its base version and is never outdated against its own minor line.

const ALPHA = MOCK_MINTS[0]!.url
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`

function versionStat(page: Page) {
  return page.locator('.md-sc', { has: page.locator('.md-sc-sub', { hasText: 'software' }) })
}

async function gotoWith(page: Page, version: string, softwareLatest: { major: number; minor: number } | null) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', route =>
    route.fulfill({ json: MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, version, softwareLatest } : m)) }),
  )
  await mockProbedVersion(page, version)
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await expect(versionStat(page)).toContainText(version)
}

test.describe('Mint Detail — Outdated badge', () => {
  test('shows "Outdated" when the mint is several minor versions behind its own software\'s latest', async ({ page }) => {
    await gotoWith(page, 'Nutshell/0.16.0', { major: 0, minor: 20 })
    await expect(versionStat(page).getByText('Outdated')).toBeVisible()
  })

  test('shows "Outdated" at exactly two minor versions behind', async ({ page }) => {
    await gotoWith(page, 'Nutshell/0.19.2', { major: 0, minor: 21 })
    await expect(versionStat(page).getByText('Outdated')).toBeVisible()
  })

  test('does NOT show "Outdated" one minor version behind (0.20.3 against 0.21)', async ({ page }) => {
    await gotoWith(page, 'Nutshell/0.20.3', { major: 0, minor: 21 })
    await expect(versionStat(page).getByText('Outdated')).toHaveCount(0)
  })

  test('does NOT show "Outdated" for a four-segment version one behind (0.20.3.1)', async ({ page }) => {
    await gotoWith(page, 'Nutshell/0.20.3.1', { major: 0, minor: 21 })
    await expect(versionStat(page).getByText('Outdated')).toHaveCount(0)
  })

  test('does NOT show "Outdated" when the mint is current for its software', async ({ page }) => {
    await gotoWith(page, 'Nutshell/0.21.0', { major: 0, minor: 21 })
    await expect(versionStat(page).getByText('Outdated')).toHaveCount(0)
  })

  test('does NOT show "Outdated" for a pre-release of the current minor line (cdk-mintd 0.18.0-rc.1, latest 0.18)', async ({ page }) => {
    await gotoWith(page, 'cdk-mintd/0.18.0-rc.1', { major: 0, minor: 18 })
    await expect(versionStat(page).getByText('Outdated')).toHaveCount(0)
  })

  test('does NOT show "Outdated" when the API has no latest for this mint\'s software (softwareLatest null)', async ({ page }) => {
    await gotoWith(page, 'Nutshell/0.16.0', null)
    await expect(versionStat(page).getByText('Outdated')).toHaveCount(0)
  })

  test('does NOT show "Outdated" for software the rule does not know (Nutshell-CF)', async ({ page }) => {
    await gotoWith(page, 'Nutshell-CF/0.0.1', null)
    await expect(versionStat(page).getByText('Outdated')).toHaveCount(0)
  })
})
