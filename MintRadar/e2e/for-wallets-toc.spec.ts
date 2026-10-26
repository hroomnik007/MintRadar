import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// /for-wallets table of contents (components/DocToc.tsx): stable anchors,
// smooth in-page jumps that focus the heading and mark the entry with
// aria-current, and on phones (≤640px) a folding "On this page" button.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

const toc = (page: Page) => page.getByRole('navigation', { name: 'On this page' })

async function expectLinksMatchHeadings(page: Page) {
  const hrefs = await toc(page).locator('a').evaluateAll(els => els.map(e => e.getAttribute('href') ?? ''))
  expect(hrefs.length).toBeGreaterThanOrEqual(8)
  for (const href of hrefs) {
    const id = href.split('#')[1]!
    expect(id).toMatch(/^[a-z0-9-]+$/)
    await expect(page.locator(`main h2[id="${id}"]`)).toHaveCount(1)
  }
}

async function expectHeadingClear(page: Page, id: string) {
  const h2 = page.locator(`h2[id="${id}"]`)
  await expect(h2).toBeFocused()
  // Wait for the (smooth) scroll to settle, then check nothing sticky covers it.
  await expect.poll(async () => h2.evaluate(el => Math.round(el.getBoundingClientRect().top)), { timeout: 4000 })
    .toBeLessThan(400)
  await page.waitForTimeout(800)
  const { top, coveredBy } = await h2.evaluate(el => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2)
    return { top: r.top, coveredBy: hit && !el.contains(hit) ? hit.className : null }
  })
  expect(top).toBeGreaterThanOrEqual(0)
  expect(coveredBy).toBeNull()
}

test.describe('For wallets table of contents', () => {
  test('desktop: every entry links to a stable heading id; a click jumps, focuses and marks it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/for-wallets')
    await expect(toc(page)).toBeVisible()
    await expectLinksMatchHeadings(page)
    // The fold button is a phone-only control.
    await expect(page.locator('.doc-toc-toggle')).toBeHidden()

    const link = toc(page).getByRole('link', { name: 'Errors' })
    await link.click()
    await expect(page).toHaveURL(/#errors$/)
    await expect(link).toHaveAttribute('aria-current', 'location')
    await expect(toc(page).locator('a[aria-current]')).toHaveCount(1)
    await expectHeadingClear(page, 'errors')
  })

  test('mobile 390: the list folds behind "On this page"; open, jump, Escape', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/for-wallets')
    const toggle = page.locator('.doc-toc-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const listId = await toggle.getAttribute('aria-controls')
    expect(listId).toBeTruthy()
    const list = page.locator(`[id="${listId}"]`)
    await expect(list).toBeHidden()

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(list).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()

    await toggle.click()
    await expectLinksMatchHeadings(page)
    await list.getByRole('link', { name: 'Filters' }).click()
    await expect(page).toHaveURL(/#filters$/)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toContainText('Filters')
    await expectHeadingClear(page, 'filters')

    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(sw).toBeLessThanOrEqual(391)
  })

  test('reduced motion: the jump is instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/for-wallets')
    await toc(page).getByRole('link', { name: 'Stability' }).click()
    const top = await page.locator('h2#stability').evaluate(el => el.getBoundingClientRect().top)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top).toBeLessThan(200)
  })

  test('scrolling by hand updates the marked entry', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/for-wallets')
    await page.locator('h2#response').evaluate(el => el.scrollIntoView({ block: 'start' }))
    await expect(toc(page).locator('a[aria-current="location"]')).toHaveAttribute('href', /#response$/)
  })
})
