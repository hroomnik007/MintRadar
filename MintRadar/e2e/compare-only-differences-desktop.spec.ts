import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { cmpRowIds } from './fixtures/compare'

// "Only differences" in Compare on a desktop (Task K1; one layout on every width since the 2026-11-28 redesign):
// off by default, on hides the rows whose value is the same for every mint, a row still loading stays.

test.use({ viewport: { width: 1440, height: 900 } })

async function openCompare(page: Page, others: string[]) {
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  for (const name of others) await page.locator('.md-picker-item', { hasText: name }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText(/^Compare [2-4] mints$/)).toBeVisible()
}
const labels = (page: Page) => cmpRowIds(page)

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test('desktop: the switch exists, is off by default, and switching it on hides the equal rows', async ({ page }) => {
  await openCompare(page, ['Delta Mint'])
  const toggle = page.getByRole('switch', { name: 'Only differences' })
  await expect(toggle).toHaveCount(1)
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  // The switch sits above the rows.
  const tb = await toggle.boundingBox()
  const gb = await page.locator('.cx-sections').boundingBox()
  expect(tb!.y + tb!.height).toBeLessThanOrEqual(gb!.y + 1)
  const all = await labels(page)
  expect(all).toContain('units')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toBeFocused()
  const shown = await labels(page)
  // Alpha and Delta both list sat only: Units goes; latency and version stay. The mint cards always stay.
  expect(shown).not.toContain('units')
  expect(shown).toContain('latency')
  expect(shown).toContain('version')
  expect(shown.length).toBeLessThan(all.length)
  await expect(page.locator('.cmp-m-status')).toContainText('rows differ')
  await expect(page.locator('[data-testid="cmp-card"]')).toHaveCount(2)

  await toggle.press('Space')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(await labels(page)).toEqual(all)
})

test('desktop: a row whose value is still loading stays visible until it resolves', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  await page.route('**/api/mint/probe**', async route => {
    await gate
    const target = new URL(route.request().url()).searchParams.get('url')
    await route.fulfill({ json: { url: target, online: true, latencyMs: 50, checkedAt: new Date().toISOString(), info: { name: 'Mint', nuts: {} }, keysets: [{ id: '00aa000000000002', unit: 'sat', active: true }] } })
  })
  await openCompare(page, ['Delta Mint'])
  const toggle = page.getByRole('switch', { name: 'Only differences' })
  await toggle.click()
  // Probe pending: Input fee reads "…" and the row stays although it may end up equal.
  await expect(page.locator('.cx-val[data-row="fee"]').first()).toContainText('…')
  expect(await labels(page)).toContain('fee')
  release()
  // Both mints then report no fee ("n/a" for both): the row is equal and goes.
  await expect.poll(async () => (await labels(page)).includes('fee')).toBe(false)
})

test('desktop: when no row differs the same text as on the phone is shown', async ({ page }) => {
  const twin = { ...MOCK_KNOWN_MINTS[0], url: 'https://echo.mint.example', name: 'Echo Mint' }
  await page.route('**/api/mints/known', route => route.fulfill({ json: [...MOCK_KNOWN_MINTS, twin] }))
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(5)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  await page.locator('.md-picker-item', { hasText: 'Echo Mint' }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText(/^Compare [2-4] mints$/)).toBeVisible()
  const toggle = page.getByRole('switch', { name: 'Only differences' })
  await toggle.click()
  await expect(page.locator('.cmp-m-status')).toHaveText('Every row has the same value for these mints.')
  expect(await labels(page)).toEqual([])
  await expect(page.locator('[data-testid="cmp-card"]')).toHaveCount(2)
  await toggle.click()
  expect((await labels(page)).length).toBeGreaterThan(5)
})

test('the choice survives a resize to a phone width and back; the same rows stay', async ({ page }) => {
  await openCompare(page, ['Delta Mint'])
  await page.getByRole('switch', { name: 'Only differences' }).click()
  const desktopRows = await labels(page)

  await page.setViewportSize({ width: 390, height: 844 })
  const toggle = page.getByRole('switch', { name: 'Only differences' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.cx-row[data-row="units"]')).toHaveCount(0)
  await expect(page.locator('.cmp-m-status')).toContainText('rows differ')

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByRole('switch', { name: 'Only differences' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => labels(page)).toEqual(desktopRows)
})

test('the switch is off again every time the modal opens', async ({ page }) => {
  await openCompare(page, ['Delta Mint'])
  await page.getByRole('switch', { name: 'Only differences' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByText(/^Compare [2-4] mints$/)).toHaveCount(0)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByRole('switch', { name: 'Only differences' })).toHaveAttribute('aria-checked', 'false')
})
