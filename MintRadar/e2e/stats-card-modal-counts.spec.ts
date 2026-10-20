import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_STATS } from './fixtures/mocks'
import { networkQuiet } from './fixtures/settle'

// Cards on /stats count ONLINE mints, so the modal behind each card must list exactly those mints and say that offline
// mints are not counted: NUT coverage, Software in use (version list) and Geographic distribution.
// Fixture: 3 online mints (Alpha, Bravo, Delta) plus an OFFLINE twin of each with the same software version, the same
// NUTs and the same location, so a modal that lists offline mints too has more rows than its card.

const NOTE = 'Offline mints are not counted.'
const known = () => {
  const online = MOCK_KNOWN_MINTS.filter(m => m.online)
  const twins = online.map(m => ({ ...m, url: m.url.replace('.mint.', '-off.mint.'), name: `${m.name} Offline`, online: false }))
  return [...online, ...twins]
}

async function open(page: Page) {
  const mints = known()
  const onlineMints = mints.filter(m => m.online)
  const nut09 = onlineMints.filter(m => (m.nutsLimits as Record<string, unknown>)['9'] != null).length
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: mints }))
  await page.route('**/api/stats', r => r.fulfill({
    json: {
      ...MOCK_STATS,
      onlineMints: onlineMints.length,
      nutAdoption: [{ nut: 'NUT-09', count: nut09, percent: Math.round(nut09 / onlineMints.length * 100) }],
    },
  }))
  await page.goto('/stats')
  await networkQuiet(page)
  return { nut09, online: onlineMints.length }
}

const modal = (page: Page) => page.locator('.nut-modal')

test('NUT coverage: the modal lists the mints the card counts, not the offline ones', async ({ page }) => {
  const { nut09, online } = await open(page)
  const row = page.locator('.stats-nut-row', { hasText: 'NUT-09' })
  await expect(row.locator('.snr-nut-count')).toHaveText(`${nut09}/${online}`)
  await row.click()
  await expect(modal(page).locator('.nut-modal-row')).toHaveCount(nut09)
  await expect(modal(page).getByText('Offline', { exact: false }).filter({ hasText: /Mint Offline/ })).toHaveCount(0)
  await expect(modal(page).locator('.nut-modal-note')).toHaveText(NOTE)
})

test('Software in use: the mint list of a version holds the online mints the version list counts', async ({ page }) => {
  await open(page)
  await page.locator('.sw-row', { hasText: 'Nutshell' }).click()
  // Nutshell/0.16.0: Alpha online, Alpha Offline twin
  const versionRow = modal(page).locator('.nut-modal-row', { hasText: '0.16.0' })
  await expect(versionRow).toContainText('1')
  await versionRow.click()
  await expect(modal(page).locator('.nut-modal-title')).toHaveText('Nutshell 0.16.0')
  await expect(modal(page).locator('.nut-modal-row')).toHaveCount(1)
  await expect(modal(page).locator('.nut-modal-row')).toContainText('Alpha Mint')
  await expect(modal(page).locator('.nut-modal-row', { hasText: 'Offline' })).toHaveCount(0)
  await expect(modal(page).locator('.nut-modal-note')).toHaveText(NOTE)
})

test('Geographic distribution: the modal of a place lists the online mints the card counts', async ({ page }) => {
  const { online } = await open(page)
  const row = page.locator('.stats-geo-panel .dist-row-clickable', { hasText: 'Germany' })
  await expect(row.locator('.dist-count')).toHaveText(String(online))
  await row.click()
  await expect(modal(page).locator('.nut-modal-row')).toHaveCount(online)
  await expect(modal(page).locator('.nut-modal-row', { hasText: 'Offline' })).toHaveCount(0)
  await expect(modal(page).locator('.nut-modal-note')).toHaveText(NOTE)
})

test('the Software in use hint says what a click does', async ({ page }) => {
  await open(page)
  const panel = page.locator('.stats-sw-panel')
  await expect(panel.locator('.stats-panel-desc')).toHaveText('Mints by implementation. Click for versions.')
})
