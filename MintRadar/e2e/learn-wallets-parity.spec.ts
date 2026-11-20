import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// /learn and /wallets share the page header (PageHead). Until the 2026-11-19 redesign they were twin card grids and this
// spec pinned the whole card recipe; since then Learn is a numbered list of modules (a real sequence) and Wallets an
// alphabetical card grid, so only the header recipe is shared.

type Page = import('@playwright/test').Page

async function css(page: Page, sel: string, prop: string) {
  return page.evaluate(([sel, prop]) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).getPropertyValue(prop) : null
  }, [sel, prop] as const)
}

test('learn and wallets share the header recipe', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto('/learn')
  await page.waitForSelector('.learn-page-title')
  const ref = {
    hTitleSize: await css(page, '.learn-page-title', 'font-size'),
    hTitleWeight: await css(page, '.learn-page-title', 'font-weight'),
    hSubSize: await css(page, '.learn-page-subtitle', 'font-size'),
  }

  await page.goto('/wallets')
  await page.waitForSelector('.wallet-card')
  const got = {
    hTitleSize: await css(page, '.wallets-title', 'font-size'),
    hTitleWeight: await css(page, '.wallets-title', 'font-weight'),
    hSubSize: await css(page, '.wallets-subtitle', 'font-size'),
  }

  expect(got).toEqual(ref)
})

test('the wallets grid is one column on a phone', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  // A phone (390 px). Since the 2026-11-19 mockup alignment the cards are 300 px minimum, so 680 px holds two columns.
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/wallets')
  await page.waitForSelector('.wallet-card')
  const walletCols = await css(page, '.wallets-grid', 'grid-template-columns')
  expect(walletCols!.split(' ').length).toBe(1)
})
