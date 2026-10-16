import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { LEARN_MODULES } from '../src/constants/learnModules'

// Learn index cards: header row (icon left, reading time right), "Module N" under it, then title, summary, CTA.
// The reading-time numbers are pinned against the module text by src/__tests__/learnReadingTime.test.tsx.

const MODULES = [...LEARN_MODULES].sort((a, b) => a.order - b.order)

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

for (const width of [1440, 390, 320]) {
  test.describe(`@ ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('card structure: label under the header row, above the title; time at the top right', async ({ page }) => {
      await page.goto('/learn')
      const cards = page.locator('.learn-card')
      await expect(cards).toHaveCount(MODULES.length)

      for (const [i, mod] of MODULES.entries()) {
        const card = cards.nth(i)
        const head = card.locator('.learn-card-head')
        const label = card.locator('.learn-card-number')
        const time = card.locator('.learn-card-time')
        const title = card.locator('.learn-card-title')

        await expect(label).toHaveText(`Module ${mod.order}`)
        await expect(time).toHaveText(`${mod.readingMinutes} min read`)
        await expect(card.locator('a')).toHaveCount(1)

        const [c, h, l, t, ti] = await Promise.all([card, head, label, time, title].map(loc => loc.boundingBox()))
        // header row, then label, then title, top to bottom
        expect(l!.y).toBeGreaterThanOrEqual(h!.y + h!.height - 0.5)
        expect(ti!.y).toBeGreaterThanOrEqual(l!.y + l!.height - 0.5)
        // time: right edge of the card (inside its 18px padding), within the first 56px, in the header row
        expect(t!.x + t!.width).toBeGreaterThan(c!.x + c!.width - 24)
        expect(t!.x + t!.width).toBeLessThanOrEqual(c!.x + c!.width)
        expect(t!.y - c!.y).toBeLessThan(56)
        expect(t!.y + t!.height).toBeLessThanOrEqual(h!.y + h!.height + 0.5)
        // time and label never overlap
        const overlap = t!.x < l!.x + l!.width && l!.x < t!.x + t!.width && t!.y < l!.y + l!.height && l!.y < t!.y + t!.height
        expect(overlap).toBe(false)
        // time is a single line
        const lineHeight = await time.evaluate(el => parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height)
        expect(t!.height).toBeLessThanOrEqual(lineHeight + 1)
      }
    })

    test('no horizontal overflow, cards in a row keep one height', async ({ page }) => {
      await page.goto('/learn')
      await expect(page.locator('.learn-card')).toHaveCount(MODULES.length)
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
      expect(noOverflow).toBe(true)
      const rows = await page.locator('.learn-card').evaluateAll(els => {
        const byTop = new Map<number, number[]>()
        for (const el of els) {
          const r = el.getBoundingClientRect()
          const key = Math.round(r.top + window.scrollY)
          byTop.set(key, [...(byTop.get(key) ?? []), Math.round(r.height)])
        }
        return [...byTop.values()]
      })
      for (const heights of rows) expect(new Set(heights).size).toBe(1)
    })
  })
}

test.describe('card link behaviour', () => {
  test('one link per card, name starts with the title, click navigates', async ({ page }) => {
    await page.goto('/learn')
    for (const mod of MODULES) {
      const link = page.getByRole('link', { name: new RegExp(`^${mod.title}`) })
      await expect(link).toHaveCount(1)
      await expect(link).toHaveAttribute('href', `/learn/${mod.id}`)
    }
    await page.locator('.learn-card').first().click()
    await expect(page).toHaveURL(new RegExp(`/learn/${MODULES[0]?.id}$`))
  })

  test('the card link is reachable and activated by keyboard', async ({ page }) => {
    await page.goto('/learn')
    const link = page.locator('.learn-card-link').nth(1)
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/learn/${MODULES[1]?.id}$`))
  })

  test('the Learn page keeps exactly one h1', async ({ page }) => {
    await page.goto('/learn')
    await expect(page.locator('.learn-card')).toHaveCount(MODULES.length)
    await expect(page.locator('h1')).toHaveCount(1)
  })
})
