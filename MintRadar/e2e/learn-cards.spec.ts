import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { LEARN_MODULES } from '../src/constants/learnModules'

// Learn index, 2026-11-19 redesign: the modules are a numbered list (a real sequence): the big number, the title (the one
// link of the row, stretched over it), the summary, "Read module N", the length on the right. "The short version" beside.
// The reading-time numbers are pinned against the module text by src/__tests__/learnReadingTime.test.tsx.

const MODULES = [...LEARN_MODULES].sort((a, b) => a.order - b.order)

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

for (const width of [1440, 390, 320]) {
  test.describe(`@ ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('row structure: number, title, summary and "Read module N"; the length beside the text', async ({ page }) => {
      await page.goto('/learn')
      const rows = page.locator('.learn-mod')
      await expect(rows).toHaveCount(MODULES.length)
      for (const [i, mod] of MODULES.entries()) {
        const row = rows.nth(i)
        await expect(row.locator('.learn-mod-num')).toHaveText(String(mod.order))
        await expect(row.locator('.learn-mod-title')).toHaveText(mod.title)
        await expect(row.locator('.learn-mod-summary')).toHaveText(mod.summary)
        await expect(row.locator('.learn-mod-go')).toHaveText(`Read module ${mod.order}`)
        await expect(row.locator('.learn-mod-len')).toHaveText(`${mod.readingMinutes} min`)
        await expect(row.locator('a')).toHaveCount(1)
        const [n, t] = await Promise.all([row.locator('.learn-mod-num').boundingBox(), row.locator('.learn-mod-title').boundingBox()])
        expect(n!.x + n!.width).toBeLessThanOrEqual(t!.x)
      }
      await expect(page.locator('.learn-aside li')).toHaveCount(3)
    })

    test('no horizontal overflow', async ({ page }) => {
      await page.goto('/learn')
      await expect(page.locator('.learn-mod')).toHaveCount(MODULES.length)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    })
  })
}

test.describe('row link behaviour', () => {
  test('one link per row, named by the title, a click anywhere on the row navigates', async ({ page }) => {
    await page.goto('/learn')
    for (const mod of MODULES) {
      const link = page.getByRole('link', { name: mod.title, exact: true })
      await expect(link).toHaveCount(1)
      await expect(link).toHaveAttribute('href', `/learn/${mod.id}`)
    }
    // The link's ::after covers the row: a click on the row (here its centre) is a click on the link.
    await page.locator('.learn-mod').first().click()
    await expect(page).toHaveURL(new RegExp(`/learn/${MODULES[0]?.id}$`))
  })

  test('the row link is reachable and activated by keyboard', async ({ page }) => {
    await page.goto('/learn')
    const link = page.locator('.learn-mod-link').nth(1)
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/learn/${MODULES[1]?.id}$`))
  })

  test('the Learn page keeps exactly one h1 and says the course length', async ({ page }) => {
    await page.goto('/learn')
    await expect(page.locator('.learn-mod')).toHaveCount(MODULES.length)
    await expect(page.locator('h1')).toHaveCount(1)
    const total = MODULES.reduce((s, m) => s + m.readingMinutes, 0)
    await expect(page.locator('.learn-page-subtitle')).toContainText(`Five short modules, about ${total} minutes in all.`)
  })
})
