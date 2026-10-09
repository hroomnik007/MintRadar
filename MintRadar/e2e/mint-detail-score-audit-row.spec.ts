import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// The audit row of the Reliability Score breakdown (25 points, from cashu.info's 7-day attributed failures):
// its text, its displayed points for every band and every neutral case, and that the score shown next to the
// breakdown is the sum of the displayed parts. The texts of some cases are also pinned in
// mint-detail-audit-freshness.spec.ts; this spec adds the points and the sum.
// Rules under test (shared/auditScore.ts): fewer than 10 swaps = neutral 12.5; detail older than 168 h = neutral;
// no detail = neutral; otherwise error rate blamed/total: 0 -> 25, <1% -> 20, <5% -> 15, <15% -> 10, else 5.

const ALPHA = MOCK_MINTS[0]!.url
const H = 3_600_000
const D = 24 * H
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

async function openBreakdown(page: Page, audit: { total: number | null; blamed: number | null; fetchedAt: string | null }) {
  await mockRelays(page)
  await installApiMocks(page)
  // reliabilityScore: null makes the page compute the score from the same parts it displays (a server value
  // would be shown as-is and could not be compared with the parts).
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0
    ? { ...m, reliabilityScore: null, auditCzTotal: audit.total, auditCzBlamed: audit.blamed, auditCzFetchedAt: audit.fetchedAt }
    : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  const panel = page.locator('.md-reliability-panel')
  await expect(panel.getByText('Audit reliability (25%)')).toBeVisible()
  return panel
}

/** Reads the five displayed "points/max" values and the score next to them. */
async function readParts(panel: ReturnType<Page['locator']>) {
  const scores = await panel.locator('.rb-row-score').allTextContents()
  expect(scores).toHaveLength(5)
  const parts = scores.map(s => {
    const m = /^(\d+(?:\.\d+)?)\/(\d+)$/.exec(s.trim())
    expect(m, `"${s}" is points/max`).not.toBeNull()
    return { points: Number(m![1]), max: Number(m![2]) }
  })
  const total = Number((await panel.locator('.gauge-num').innerText()).replace('%', ''))
  return { parts, total }
}

const auditRow = (panel: ReturnType<Page['locator']>) => panel.locator('.rb-row', { hasText: 'Audit reliability (25%)' })

interface Case {
  name: string
  audit: { total: number | null; blamed: number | null; fetchedAt: string | null }
  detail: string
  points: number
  display: string
  note?: string
}

// A scored row carries no detail line, only the "x / y" display.
const SCORED = ''
const TOO_FEW = 'Not enough audit data yet (fewer than 10 swaps in the last 7 days): neutral'

const CASES: Case[] = [
  { name: 'no failures attributed: full 25 points', audit: { total: 100, blamed: 0, fetchedAt: ago(H) }, detail: SCORED, points: 25, display: '0 / 100' },
  { name: 'under 1% attributed (1 of 200): 20 points', audit: { total: 200, blamed: 1, fetchedAt: ago(H) }, detail: SCORED, points: 20, display: '1 / 200' },
  { name: 'under 5% attributed (2 of 100): 15 points', audit: { total: 100, blamed: 2, fetchedAt: ago(H) }, detail: SCORED, points: 15, display: '2 / 100' },
  { name: 'under 15% attributed (10 of 100): 10 points', audit: { total: 100, blamed: 10, fetchedAt: ago(H) }, detail: SCORED, points: 10, display: '10 / 100' },
  { name: '15% or more attributed (20 of 100): 5 points', audit: { total: 100, blamed: 20, fetchedAt: ago(H) }, detail: SCORED, points: 5, display: '20 / 100' },
  { name: 'exactly 10 swaps is still scored', audit: { total: 10, blamed: 0, fetchedAt: ago(H) }, detail: SCORED, points: 25, display: '0 / 10' },
  { name: 'fewer than 10 swaps (9): neutral 12.5 and the "not enough" text', audit: { total: 9, blamed: 0, fetchedAt: ago(H) }, detail: TOO_FEW, points: 12.5, display: 'neutral' },
  { name: 'no detail stored: neutral 12.5', audit: { total: null, blamed: null, fetchedAt: null }, detail: 'No cashu.info audit data: neutral', points: 12.5, display: 'neutral' },
  { name: 'detail 30 hours old: still scored, note "data 1 day old"', audit: { total: 100, blamed: 0, fetchedAt: ago(30 * H) }, detail: SCORED, points: 25, display: '0 / 100', note: 'data 1 day old' },
  { name: 'detail 5 days old: still scored, note "data 5 days old"', audit: { total: 100, blamed: 2, fetchedAt: ago(5 * D + H) }, detail: SCORED, points: 15, display: '2 / 100', note: 'data 5 days old' },
  { name: 'detail older than 168 hours: neutral 12.5, no note', audit: { total: 100, blamed: 0, fetchedAt: ago(8 * D) }, detail: 'Audit data older than 7 days: neutral', points: 12.5, display: 'neutral' },
]

test.describe('Reliability breakdown: audit row', () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      const panel = await openBreakdown(page, c.audit)
      const row = auditRow(panel)
      if (c.detail) await expect(row.locator('.rb-row-detail')).toHaveText(c.detail)
      else await expect(row.locator('.rb-row-detail')).toHaveCount(0)
      await expect(row.locator('.rb-row-display')).toHaveText(c.display)
      await expect(row.locator('.rb-row-score')).toHaveText(`${c.points}/25`)
      if (c.note) await expect(row.locator('.rb-row-note')).toHaveText(c.note)
      else await expect(row.locator('.rb-row-note')).toHaveCount(0)

      // The score beside the breakdown is the (rounded, capped) sum of the five displayed parts.
      const { parts, total } = await readParts(panel)
      expect(parts.map(p => p.max)).toEqual([40, 25, 15, 15, 5])
      const sum = parts.reduce((a, p) => a + p.points, 0)
      expect(total).toBe(Math.min(100, Math.round(sum)))
    })
  }
})
