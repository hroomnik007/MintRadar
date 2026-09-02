import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// Regression check for the bug: the "Compare with..." picker opened from
// Dashboard used CSS classes (.md-picker-*) that lived only in MintDetail.css,
// which never loads unless /mint/:url has been visited in the session. This
// reproduces the exact scenario from the report: fresh session, go straight
// to Dashboard, click Compare — never visit a mint detail page first.
test.describe('Compare picker styling — fresh session, no prior /mint/:url visit', () => {
  test('picker is fully styled on desktop', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto('/')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button', { hasText: 'Compare' }).click()

    const modal = page.locator('.md-picker-modal')
    await expect(modal).toBeVisible()

    // Modal itself must be a bounded card, not an unstyled full-bleed block.
    const modalBox = await modal.boundingBox()
    expect(modalBox!.width).toBeLessThanOrEqual(400)
    const modalStyle = await modal.evaluate(el => {
      const s = getComputedStyle(el)
      return { display: s.display, flexDirection: s.flexDirection, borderRadius: s.borderRadius, overflow: s.overflow }
    })
    expect(modalStyle.display).toBe('flex')
    expect(modalStyle.flexDirection).toBe('column')
    expect(modalStyle.borderRadius).not.toBe('0px')

    // Header must be a flex row with title and × button side by side, not stacked.
    const header = page.locator('.md-picker-header')
    const headerStyle = await header.evaluate(el => getComputedStyle(el).display)
    expect(headerStyle).toBe('flex')
    const titleBox = await page.getByText('Compare with...').boundingBox()
    const closeBtn = header.locator('button', { hasText: '×' })
    const closeBox = await closeBtn.boundingBox()
    // Side-by-side means roughly the same vertical position, not stacked below.
    expect(Math.abs(titleBox!.y - closeBox!.y)).toBeLessThan(10)

    // Each picker row (checkbox + status dot + name) must be a single flex row,
    // not three stacked blocks (the "empty rectangle under the text" bug).
    const firstItem = page.locator('.md-picker-item').first()
    const itemDisplay = await firstItem.evaluate(el => getComputedStyle(el).display)
    expect(itemDisplay).toBe('flex')
    const checkboxBox = await firstItem.locator('.card-checkbox').boundingBox()
    const nameBox = await firstItem.locator('div').last().boundingBox()
    // Checkbox and name text must sit on the same row (small y-delta), not stacked.
    expect(Math.abs(checkboxBox!.y - nameBox!.y)).toBeLessThan(10)

    // Search input must be present and functional.
    const search = page.locator('.md-picker-search')
    await expect(search).toBeVisible()
    await search.fill('Delta')
    await expect(page.locator('.md-picker-item')).toHaveCount(1)
    await search.fill('')

    // Full flow still works end to end.
    await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
    await page.locator('.md-picker-confirm').click()
    await expect(page.getByText('Mint Comparison')).toBeVisible()
  })

  test('picker is fully styled on mobile viewport (incl. Chrome DevTools-style emulation)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto('/')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button', { hasText: 'Compare' }).click()

    const modal = page.locator('.md-picker-modal')
    await expect(modal).toBeVisible()
    const modalBox = await modal.boundingBox()
    // Must not be a bare full-viewport list — bounded card width/height.
    expect(modalBox!.width).toBeLessThan(390)
    expect(modalBox!.height).toBeLessThan(844)

    const header = page.locator('.md-picker-header')
    await expect(header).toBeVisible()
    await expect(header.locator('button', { hasText: '×' })).toBeVisible()
    await expect(page.locator('.md-picker-search')).toBeVisible()

    const firstItem = page.locator('.md-picker-item').first()
    const itemDisplay = await firstItem.evaluate(el => getComputedStyle(el).display)
    expect(itemDisplay).toBe('flex')

    await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
    await page.locator('.md-picker-confirm').click()
    await expect(page.getByText('Mint Comparison')).toBeVisible()
  })

  test('same picker styling from MintDetail matches Dashboard (no visual drift between the two call sites)', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.goto(`/mint/${encodeURIComponent('https://alpha.mint.example')}`)
    await page.locator('button', { hasText: 'Compare' }).click()

    const modal = page.locator('.md-picker-modal')
    await expect(modal).toBeVisible()
    const modalStyle = await modal.evaluate(el => getComputedStyle(el).display)
    expect(modalStyle).toBe('flex')
    const firstItem = page.locator('.md-picker-item').first()
    await expect(firstItem).toBeVisible()
    const itemDisplay = await firstItem.evaluate(el => getComputedStyle(el).display)
    expect(itemDisplay).toBe('flex')
  })
})
