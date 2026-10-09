import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, mockProbedVersion, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// The version row of the Reliability Score breakdown (15 points) follows the ONE shared version rule
// (versionRule.ts): 0 or 1 minor version behind the family's latest = 15, 2 behind = 9, 3 = 6, 4 = 3, 5 or more = 0;
// unknown software and a mint without a latest keep the neutral 4. "Latest" is the value the API sends with the
// mint (`softwareLatest`), so the breakdown and the stored score always use the same one (before 2026-10-09 the
// breakdown used a static ladder and could differ from the stored score by 3 points).

const ALPHA = MOCK_MINTS[0]!.url

async function openBreakdown(page: Page, version: string, softwareLatest: { major: number; minor: number } | null) {
  await mockRelays(page)
  await installApiMocks(page)
  // reliabilityScore: null makes the page compute the score from the parts it displays (a stored value is shown as-is).
  await page.route('**/api/mints/known', route =>
    route.fulfill({ json: MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, version, softwareLatest, reliabilityScore: null } : m)) }),
  )
  await mockProbedVersion(page, version)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  const panel = page.locator('.md-reliability-panel')
  await expect(panel.getByText('Version (15%)')).toBeVisible()
  return panel
}

const L = { major: 0, minor: 21 }
const C = { major: 0, minor: 18 }

const CASES: Array<{ name: string; version: string; latest: { major: number; minor: number } | null; points: string }> = [
  { name: 'latest release: 15', version: 'Nutshell/0.21.0', latest: L, points: '15/15' },
  { name: 'one minor behind (0.20.3): still the full 15', version: 'Nutshell/0.20.3', latest: L, points: '15/15' },
  { name: 'four-segment version one behind (0.20.3.1): 15', version: 'Nutshell/0.20.3.1', latest: L, points: '15/15' },
  { name: 'two behind (0.19.2): 9', version: 'Nutshell/0.19.2', latest: L, points: '9/15' },
  { name: 'three behind (0.18.2): 6', version: 'Nutshell/0.18.2', latest: L, points: '6/15' },
  { name: 'four behind (0.17.0): 3', version: 'Nutshell/0.17.0', latest: L, points: '3/15' },
  { name: 'five behind (0.16.0): 0', version: 'Nutshell/0.16.0', latest: L, points: '0/15' },
  { name: 'cdk-mintd pre-release of the current line (0.18.0-rc.1): 15', version: 'cdk-mintd/0.18.0-rc.1', latest: C, points: '15/15' },
  { name: 'cdk-mintd 0.13.4: 0', version: 'cdk-mintd/0.13.4', latest: C, points: '0/15' },
  { name: 'no latest from the API: neutral 4', version: 'Nutshell/0.21.0', latest: null, points: '4/15' },
  { name: 'unknown software (Nutshell-CF): neutral 4', version: 'Nutshell-CF/0.0.1', latest: null, points: '4/15' },
]

test.describe('Reliability breakdown: version row', () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      const panel = await openBreakdown(page, c.version, c.latest)
      const row = panel.locator('.rb-row', { hasText: 'Version (15%)' })
      await expect(row.locator('.rb-row-score')).toHaveText(c.points)

      // INVARIANT: the score next to the breakdown is the (rounded, capped) sum of the five displayed parts,
      // so the version points shown are exactly the version points inside the score.
      // Polled: the page first renders from the stored data and then from the live probe; the invariant is
      // checked once the numbers have settled.
      await expect.poll(async () => {
        const scores = await panel.locator('.rb-row-score').allTextContents()
        const sum = scores.reduce((a, s) => a + Number(s.split('/')[0]), 0)
        const total = Number((await panel.locator('.gauge-num').innerText()).replace('%', ''))
        return total - Math.min(100, Math.round(sum))
      }).toBe(0)
      await expect(row.locator('.rb-row-score')).toHaveText(c.points)
    })
  }

  test('the row tooltip states the rule', async ({ page }) => {
    const panel = await openBreakdown(page, 'Nutshell/0.19.2', L)
    await panel.locator('.rb-row', { hasText: 'Version (15%)' }).locator('svg').first().hover()
    await expect(page.locator('.audit-tooltip')).toContainText('0 or 1 minor version behind scores the full 15 points')
  })
})
