import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

type Page = import('@playwright/test').Page

// Overview group "Nutzap-related features" (src/components/mint/MintNutzapFeatures.tsx, src/utils/nutzapFeatures.ts):
// NUT-07, NUT-10, NUT-11 and NUT-12 each "supported" or "not declared", with the source and the time of the latest
// successful info fetch. No request of its own, no combined verdict.

const ALPHA = 'https://alpha.mint.example'
const group = (page: Page) => page.getByTestId('mint-nutzap')
const row = (page: Page, nut: number) => group(page).getByTestId(`nutzap-nut-${nut}`)

async function open(page: Page, nuts: Record<string, unknown>, size: [number, number] = [1440, 900], onKnown?: (rows: Record<string, unknown>[]) => unknown) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  const fetchedAt = new Date(Date.now() - 5 * 60_000).toISOString()
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, lastCheckedAt: fetchedAt, nutsLimits: nuts } : m))
  await page.route('**/api/mints/known', r => r.fulfill({ json: onKnown ? onKnown(rows) : rows }))
  await page.route('**/api/mint/probe**', r => r.fulfill({ json: {
    url: ALPHA, online: true, latencyMs: 40,
    info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts },
    keysets: null, checkedAt: fetchedAt,
  } }))
  await resize(page, size[0], size[1])
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(group(page)).toBeVisible()
  return { fetchedAt }
}

test('each of NUT-07, 10, 11, 12 is "supported" only when the mint declares it', async ({ page }) => {
  await open(page, { '4': {}, '5': {}, '7': { supported: true }, '12': { supported: true } })
  await expect(group(page).locator('.md-panel-title')).toHaveText('Nutzap-related features')
  await expect(group(page).locator('.md-info-row')).toHaveCount(4)
  await expect(row(page, 7).locator('.md-info-value')).toHaveText('supported')
  await expect(row(page, 10).locator('.md-info-value')).toHaveText('not declared')
  await expect(row(page, 11).locator('.md-info-value')).toHaveText('not declared')
  await expect(row(page, 12).locator('.md-info-value')).toHaveText('supported')
  await expect(row(page, 11).locator('.md-info-label')).toContainText('NUT-11')
})

test('all four declared: all four supported; no combined verdict anywhere in the group', async ({ page }) => {
  await open(page, { '7': {}, '10': {}, '11': {}, '12': {} })
  await expect(group(page).locator('.md-info-value')).toHaveText(['supported', 'supported', 'supported', 'supported'])
  await expect(group(page)).not.toContainText(/ready|safe|recommended|trusted/i)
})

test('source and time: declared by the mint in /v1/info, fetched <relative>, absolute UTC in the title', async ({ page }) => {
  const { fetchedAt } = await open(page, { '11': {} })
  const note = group(page).locator('.md-fl-source')
  await expect(note).toContainText('declared by the mint in /v1/info')
  const time = note.locator('span[title]')
  await expect(time).toHaveText(/^fetched 5 min ago$|^fetched \d+ min(utes)? ago$/)
  const d = new Date(fetchedAt)
  await expect(time).toHaveAttribute('title', new RegExp(`UTC$`))
  await expect(time).toHaveAttribute('title', new RegExp(String(d.getUTCFullYear())))
})

test('the group makes no request of its own: no request to the mint, no API path about it', async ({ page }) => {
  const requests: URL[] = []
  page.on('request', r => requests.push(new URL(r.url())))
  await open(page, { '11': {} })
  await expect(row(page, 11).locator('.md-info-value')).toHaveText('supported')
  expect(requests.filter(u => u.hostname === 'alpha.mint.example')).toEqual([])
  expect(requests.filter(u => u.pathname.startsWith('/api/') && /nutzap|nuts?(\/|$)/i.test(u.pathname)).map(u => u.pathname)).toEqual([])
})

for (const w of [320, 390, 768, 1440] as const) {
  test(`${w}px: wraps inside the page, no text under 12 px`, async ({ page }) => {
    await open(page, { '7': {}, '11': {} }, [w, 900])
    await layoutReady(page)
    const m = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="mint-nutzap"]')!
      const vw = document.documentElement.clientWidth
      const r = g.getBoundingClientRect()
      const small = Array.from(g.querySelectorAll<HTMLElement>('*')).filter(e => Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent?.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).map(e => e.className)
      return { right: r.right, left: r.left, vw, scroll: document.documentElement.scrollWidth - vw, small }
    })
    expect(m.right).toBeLessThanOrEqual(m.vw + 0.5)
    expect(m.left).toBeGreaterThanOrEqual(-0.5)
    expect(m.scroll).toBeLessThanOrEqual(1)
    expect(m.small).toEqual([])
  })
}

test('height is reserved: the group does not change height when the probe answers with another NUT list', async ({ page }) => {
  await open(page, { '7': {} })
  const before = await group(page).boundingBox()
  await expect(row(page, 7).locator('.md-info-value')).toHaveText('supported')
  await expect(row(page, 11).locator('.md-info-value')).toHaveText('not declared')
  const after = await group(page).boundingBox()
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1)
})
