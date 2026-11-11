import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// "Only differences" on the desktop Compare grid (Task K1). Same switch, state and rule as the phone table:
// off by default, on hides the rows whose value is the same for every mint, a row still loading stays.

test.use({ viewport: { width: 1440, height: 900 } })

async function openCompare(page: Page, others: string[]) {
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  for (const name of others) await page.locator('.md-picker-item', { hasText: name }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
}
const labels = (page: Page) => page.locator('.cmp-grid .cmp-lbl').evaluateAll(els => els.map(e => (e.textContent ?? '').trim()))

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
  const gb = await page.locator('.cmp-grid').boundingBox()
  expect(tb!.y + tb!.height).toBeLessThanOrEqual(gb!.y + 1)
  const all = await labels(page)
  expect(all).toContain('Status')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toBeFocused()
  const shown = await labels(page)
  // Alpha and Delta are both online, same uptime, same backup: those rows go; score, latency, version stay.
  expect(shown).not.toContain('Status')
  expect(shown).not.toContain('Backup')
  expect(shown).toContain('Reliability Score')
  expect(shown).toContain('Version')
  expect(shown.length).toBeLessThan(all.length)
  await expect(page.locator('.cmp-d-status')).toContainText('rows differ')
  // The mint header row is never a data row.
  await expect(page.locator('.cmp-grid .cmp-lbl', { hasText: /^Mint$/ })).toHaveCount(1)

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
  await expect(page.locator('.cmp-grid .cmp-input-fee').first()).toHaveText('…')
  expect(await labels(page)).toContain('Input fee')
  release()
  // Both mints then report no fee ("n/a" for both): the row is equal and goes.
  await expect.poll(async () => (await labels(page)).includes('Input fee')).toBe(false)
})

test('desktop: when no row differs the same text as on the phone is shown', async ({ page }) => {
  const twin = { ...MOCK_KNOWN_MINTS[0], url: 'https://echo.mint.example', name: 'Echo Mint' }
  await page.route('**/api/mints/known', route => route.fulfill({ json: [...MOCK_KNOWN_MINTS, twin] }))
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(5)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  await page.locator('.md-picker-item', { hasText: 'Echo Mint' }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
  const toggle = page.getByRole('switch', { name: 'Only differences' })
  await toggle.click()
  await expect(page.locator('.cmp-d-status')).toHaveText('Every row has the same value for these mints.')
  expect(await labels(page)).toEqual(['Mint'])
  await toggle.click()
  expect((await labels(page)).length).toBeGreaterThan(5)
})

test('the choice survives a resize to the phone layout and back; the phone table keeps working', async ({ page }) => {
  await openCompare(page, ['Delta Mint'])
  await page.getByRole('switch', { name: 'Only differences' }).click()
  const desktopRows = (await labels(page)).length

  await page.setViewportSize({ width: 390, height: 844 })
  const toggle = page.getByRole('switch', { name: 'Only differences' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('table.cmp-m-table tbody tr[data-row="status"]')).toHaveCount(0)
  await expect(page.locator('.cmp-m-status')).toContainText('rows differ')

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByRole('switch', { name: 'Only differences' })).toHaveAttribute('aria-checked', 'true')
  // The desktop grid is rendered again after the resize settles; wait for it instead of reading it in the same tick.
  await expect.poll(async () => (await labels(page)).length).toBe(desktopRows)
})

test('the switch is off again every time the modal opens', async ({ page }) => {
  await openCompare(page, ['Delta Mint'])
  await page.getByRole('switch', { name: 'Only differences' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Mint Comparison')).toHaveCount(0)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByRole('switch', { name: 'Only differences' })).toHaveAttribute('aria-checked', 'false')
})
