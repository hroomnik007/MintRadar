import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Stats "NUT Coverage Across the Network": a NUT row click opens the mint-list
// modal (like the Software / Geographic modals) instead of navigating to the
// Dashboard ?nut filter. NUT-09 is supported by Alpha / Bravo / Delta in the
// fixture set (nutCount >= 5), not by the offline Charlie.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS }))
})

const modal = (page: import('@playwright/test').Page) => page.locator('.nut-modal')

test.describe('Stats NUT coverage modal', () => {
  test('clicking a NUT row opens the mint-list modal, not a Dashboard nav', async ({ page }) => {
    await page.goto('/stats')
    await expect(page.locator('.stats-nut-row').first()).toBeVisible()

    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()

    // stays on /stats — no ?nut redirect
    await expect(page).toHaveURL(/\/stats$/)
    await expect(modal(page)).toBeVisible()
    await expect(modal(page).locator('.nut-modal-title')).toContainText('NUT-09')

    await expect(modal(page).locator('.nut-modal-header')).toContainText('3 of 3')

    // supporting mints, sorted by Reliability desc: Alpha 92, Delta 78, Bravo 55
    const rows = modal(page).locator('.nut-modal-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Alpha Mint')
    await expect(rows.nth(1)).toContainText('Delta Mint')
    await expect(rows.nth(2)).toContainText('Bravo Mint')
    await expect(modal(page).getByText('Charlie Mint')).toHaveCount(0)

    // footer online/offline + sort note
    await expect(modal(page).locator('.nut-modal-footer')).toHaveText(/^3 of 3 online mints offer this NUT\s*Sorted by/)
    await expect(modal(page).locator('.nut-modal-footer')).toContainText('Sorted by Reliability Score')
  })

  test('the denominator is every online mint, including one without NUT data', async ({ page }) => {
    const echo = { ...MOCK_KNOWN_MINTS[0]!, url: 'https://echo.mint.example', name: 'Echo Mint', nutsLimits: null }
    await page.route('**/api/mints/known', r => r.fulfill({ json: [...MOCK_KNOWN_MINTS, echo] }))
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()

    await expect(modal(page).locator('.nut-modal-header')).toContainText('3 of 4')
    await expect(modal(page).locator('.nut-modal-footer')).toContainText('3 of 4 online mints offer this NUT')
    await expect(modal(page).locator('.nut-modal-footer')).toContainText('Sorted by Reliability Score')
    await expect(modal(page).getByText('Offline mints are not counted.')).toBeVisible()
    await expect(modal(page).locator('.nut-modal-row')).toHaveCount(3)
  })

  test('mints without this NUT sit in a collapsed section; mints with no NUT data only get a line', async ({ page }) => {
    const mk = (m: (typeof MOCK_KNOWN_MINTS)[number], nutsLimits: Record<string, unknown> | null) => ({ ...m, nutsLimits })
    const [alpha, bravo, , delta] = MOCK_KNOWN_MINTS
    const echo = { ...alpha!, url: 'https://echo.mint.example', name: 'Echo Mint', nutsLimits: null }
    await page.route('**/api/mints/known', r => r.fulfill({ json: [mk(alpha!, { '9': {} }), mk(bravo!, { '9': { supported: false } }), MOCK_KNOWN_MINTS[2], mk(delta!, { '7': {} }), echo] }))
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()

    await expect(modal(page).locator('.nut-modal-header')).toContainText('1 of 4')
    const toggle = modal(page).getByRole('button', { name: /Online mints without this NUT \(2\)/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // collapsed: only the offering mint is a row
    await expect(modal(page).locator('.nut-modal-row')).toHaveCount(1)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const rows = modal(page).locator('.nut-modal-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(1)).toContainText('Delta Mint')
    await expect(rows.nth(2)).toContainText('Bravo Mint')
    // the mint without NUT data is in neither list; one plain line says so
    await expect(modal(page).getByText('Echo Mint')).toHaveCount(0)
    await expect(modal(page).locator('.nut-modal-note')).toHaveText(['1 online mint has no NUT data yet.', 'Offline mints are not counted.'])
  })

  test('no "no NUT data" line and no collapsed section when nothing applies', async ({ page }) => {
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()
    await expect(modal(page).getByRole('button', { name: /without this NUT/ })).toHaveCount(0)
    await expect(modal(page).getByText(/no NUT data yet/)).toHaveCount(0)
  })

  test('the modal shows the NUT description and the spec link', async ({ page }) => {
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()
    await expect(modal(page).locator('.nm-desc')).toHaveText('Restoring blinded signatures from mint backup data.')
    const link = modal(page).getByRole('link', { name: /View NUT spec on GitHub/ })
    await expect(link).toHaveAttribute('href', 'https://github.com/cashubtc/nuts/blob/main/09.md')
  })

  test('no leftover age badges and no "Show on Dashboard" button in the modal', async ({ page }) => {
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()
    await expect(modal(page)).toBeVisible()

    for (const label of ['Established', 'Veteran', 'OG']) {
      await expect(modal(page).getByText(label, { exact: true })).toHaveCount(0)
    }
    await expect(modal(page).getByRole('button', { name: /Show on Dashboard/i })).toHaveCount(0)
  })

  test('a row name links through to that mint\'s detail page', async ({ page }) => {
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()
    await expect(modal(page)).toBeVisible()

    await modal(page).locator('.nut-modal-row-name', { hasText: 'Alpha Mint' }).click()

    await expect(page).toHaveURL(new RegExp(`/mint/${encodeURIComponent('https://alpha.mint.example')}$`))
    await expect(modal(page)).toHaveCount(0)
  })

  test('Escape / close button / overlay all close the modal', async ({ page }) => {
    await page.goto('/stats')
    await page.locator('.stats-nut-row', { hasText: 'NUT-07' }).click()
    await expect(modal(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(modal(page)).toHaveCount(0)

    await page.locator('.stats-nut-row', { hasText: 'NUT-07' }).click()
    await modal(page).locator('.nut-modal-close').click()
    await expect(modal(page)).toHaveCount(0)
  })

  // Narrow-screen layout: 49 online mints, 26 of them offering NUT-19 (long title "NUT-19 · Cached responses").
  test.describe('header and footer layout', () => {
    const many = Array.from({ length: 49 }, (_, i) => ({
      ...MOCK_KNOWN_MINTS[0]!, url: `https://m${i}.example`, name: `Mint ${i}`, online: true, reliabilityScore: 90 - i,
      nutsLimits: { '4': {}, '5': {}, ...(i < 26 ? { '19': {} } : {}) },
    }))
    type Box = { y: number; h: number; lh: number }
    const boxes = (page: import('@playwright/test').Page, sel: string) => page.locator(sel).evaluateAll(els => els.map(e => {
      const r = e.getBoundingClientRect()
      return { y: r.top, h: r.height, lh: parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5 }
    })) as Promise<Box[]>

    const open = async (page: import('@playwright/test').Page, width: number) => {
      await page.setViewportSize({ width, height: 800 })
      await page.route('**/api/mints/known', r => r.fulfill({ json: many }))
      await page.goto('/stats')
      await page.locator('.stats-nut-row', { hasText: 'NUT-19' }).click()
      await expect(modal(page).locator('.nut-modal-header')).toContainText('26 of 49')
    }

    for (const width of [390, 360, 320]) {
      test(`${width}px: the count badge is one line and sits on the first line of the title`, async ({ page }) => {
        await open(page, width)
        const [badge] = await boxes(page, '.nut-modal-count-badge')
        const [title] = await boxes(page, '.nut-modal-title')
        expect(badge!.h).toBeLessThanOrEqual(badge!.lh + 8)
        expect(Math.abs(badge!.y - title!.y)).toBeLessThanOrEqual(3)
        expect(badge!.y + badge!.h).toBeLessThanOrEqual(title!.y + title!.lh + 3)
      })
    }

    test('390px: footer items are stacked and "offer this NUT" is one line', async ({ page }) => {
      await open(page, 390)
      const items = await boxes(page, '.nut-modal-footer > span')
      expect(items).toHaveLength(2)
      expect(items[1]!.y).toBeGreaterThan(items[0]!.y + items[0]!.h - 1)
      expect(items[0]!.h).toBeLessThanOrEqual(items[0]!.lh + 2)
    })

    test('1440px: footer items share one row', async ({ page }) => {
      await open(page, 1440)
      const items = await boxes(page, '.nut-modal-footer > span')
      expect(Math.abs(items[0]!.y - items[1]!.y)).toBeLessThan(2)
    })

    test('320px: no horizontal overflow, description spans the content width', async ({ page }) => {
      await open(page, 320)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      expect(await modal(page).evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
      const desc = await modal(page).locator('.nm-desc').boundingBox()
      const header = await modal(page).locator('.nut-modal-header').boundingBox()
      expect(desc!.width).toBeGreaterThanOrEqual(header!.width - 1)
    })
  })
})
