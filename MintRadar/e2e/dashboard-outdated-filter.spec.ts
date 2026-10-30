// Dashboard "Hide outdated software" filter (?outdated=hide, utils/outdatedFilter.ts): hides what the shared version rule
// labels outdated, keeps unknown versions and says how many, writes the URL only when on, ANDs with Software, and its
// touch target matches the other checkbox.
import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

const base = MOCK_KNOWN_MINTS[0]
const mk = (name: string, version: string | null, softwareLatest: { major: number; minor: number } | null) => ({
  ...base,
  url: `https://${name.toLowerCase()}.mint.example`,
  name: `${name} Mint`,
  online: true, degraded: false, archived: false, units: ['sat'], reliabilityScore: 80, version, softwareLatest,
})
const NUTSHELL = { major: 0, minor: 21 }
const CDK = { major: 0, minor: 18 }
const mints = [
  mk('Alpha', 'Nutshell/0.21.0', NUTSHELL),     // latest
  mk('Bravo', 'Nutshell/0.20.1', NUTSHELL),     // one minor behind: stays
  mk('Charlie', 'Nutshell/0.19.0', NUTSHELL),   // outdated
  mk('Delta', 'cdk-mintd/0.14.0', CDK),         // outdated
  mk('Echo', 'Nutshell-CF/0.16.0', null),       // unknown software: kept
  mk('Foxtrot', 'LekMint/1.0', null),           // unknown software: kept
]

async function setup(page: Page, path = '/') {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: mints }))
  await page.goto(path)
}
const cards = (page: Page) => page.locator('.mint-card')
const names = async (page: Page) => (await cards(page).allInnerTexts()).map(t => /\w+ Mint/.exec(t)?.[0] ?? t).sort()
const openPanel = async (page: Page) => { await page.locator('.filter-btn').click(); await expect(page.locator('.filter-panel')).toBeVisible() }
const box = (page: Page) => page.getByRole('checkbox', { name: 'Hide outdated software' })

test('hides the outdated mints, keeps unknown versions with their count, URL only when on', async ({ page }) => {
  await setup(page)
  await expect(cards(page)).toHaveCount(6)
  await expect(page).not.toHaveURL(/outdated=/)
  await openPanel(page)
  await expect(page.locator('#filter-outdated-hint')).toHaveCount(0)
  await expect(page.getByTestId('filter-outdated-kept')).toHaveCount(0)
  await box(page).check()
  await expect(page.locator('.filter-apply-btn')).toHaveText('Show 4 of 6')
  await expect(page.getByTestId('filter-outdated-kept')).toHaveText('2 mints with unknown software are kept.')
  await page.locator('.filter-apply-btn').click()
  await expect(page).toHaveURL(/[?&]outdated=hide(&|$)/)
  await expect(cards(page)).toHaveCount(4)
  expect(await names(page)).toEqual(['Alpha Mint', 'Bravo Mint', 'Echo Mint', 'Foxtrot Mint'])
  await expect(page.locator('.filter-btn')).toContainText('1')
})

test('?outdated=hide restores the filter; AND with Software', async ({ page }) => {
  await setup(page, '/?outdated=hide&software=nutshell')
  await expect(cards(page)).toHaveCount(2)
  expect(await names(page)).toEqual(['Alpha Mint', 'Bravo Mint'])
  await openPanel(page)
  await expect(box(page)).toBeChecked()
  await expect(page.getByTestId('filter-outdated-kept')).toHaveText('0 mints with unknown software are kept.')
  await box(page).uncheck()
  await page.locator('.filter-apply-btn').click()
  await expect(page).not.toHaveURL(/outdated=/)
  await expect(cards(page)).toHaveCount(3)
  expect(await names(page)).toEqual(['Alpha Mint', 'Bravo Mint', 'Charlie Mint'])
})

test('touch: the checkbox row is 36px with a 44px hit area, like "Hide test mints"', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await setup(page)
  await openPanel(page)
  const label = page.locator('.filter-outdated-check')
  expect((await label.boundingBox())!.height).toBe(36)
  const hit = await label.evaluate(el => {
    const b = el.getBoundingClientRect()
    const x = b.left + 10
    return [b.top - 3, b.bottom + 3].every(y => el.contains(document.elementFromPoint(x, y)))
  })
  expect(hit).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  await ctx.close()
})
