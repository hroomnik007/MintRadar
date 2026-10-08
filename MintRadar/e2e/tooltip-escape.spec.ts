import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS } from './fixtures/mocks'

// Escape closes an open ⓘ tooltip first (only the tooltip, focus stays); a second Escape
// then closes the surrounding container. With no tooltip open, the container closes at once.

const ALPHA = MOCK_MINTS[0]!.url
const panel = (page: Page) => page.locator('.filter-panel')
const unitTip = (page: Page) => page.locator('.filter-unit-tip')

async function openFilters(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/')
  await page.locator('.filter-btn').click()
  await expect(panel(page)).toBeVisible()
}

// Keyboard focus (not pointer focus) is what opens the openOnFocus tooltip.
async function focusUnitIcon(page: Page) {
  await page.locator('.filter-btn').focus()
  for (let i = 0; i < 15 && !(await unitTip(page).evaluate(el => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(unitTip(page)).toBeFocused()
  await expect(page.getByRole('tooltip')).toBeVisible()
}

async function openBreakdownModal(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-sc.md-sc-reliability').click()
  const title = page.getByText('Reliability Score Breakdown')
  await expect(title).toBeVisible()
  return title
}

test.describe('Escape and ⓘ tooltips', () => {
  test('Filters panel, UNIT icon: first Escape closes only the tooltip, second closes the panel', async ({ page }) => {
    await openFilters(page)
    await focusUnitIcon(page)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect(panel(page)).toBeVisible()
    await expect(unitTip(page)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
  })

  test('Filters panel, hover-opened tooltip: Escape closes only the tooltip', async ({ page }) => {
    await openFilters(page)
    await unitTip(page).hover()
    await expect(page.getByRole('tooltip')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await expect(panel(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
  })

  test('Filters panel, no tooltip open: Escape closes the panel immediately', async ({ page }) => {
    await openFilters(page)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
  })

  test('modal with a tooltip inside: first Escape closes only the tooltip, second closes the modal', async ({ page }) => {
    const title = await openBreakdownModal(page)
    const modal = page.getByRole('dialog', { name: 'Reliability Score Breakdown' })
    await modal.locator('svg.lucide-info').first().hover()
    await expect(modal.locator('.audit-tooltip')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(modal.locator('.audit-tooltip')).toHaveCount(0)
    await expect(title).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(title).toHaveCount(0)
  })

  test('modal, no tooltip open: Escape closes the modal immediately', async ({ page }) => {
    const title = await openBreakdownModal(page)
    await page.keyboard.press('Escape')
    await expect(title).toHaveCount(0)
  })

  test('account menu, no tooltip open: Escape closes it and focus returns to the chip', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page, 'peter.bliznak', 'nip07')
    await page.goto('/')
    const chip = page.locator('.navbar-profile')
    await chip.click()
    await expect(page.locator('#navbar-account-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#navbar-account-panel')).toBeHidden()
    await expect(chip).toBeFocused()
  })
})
