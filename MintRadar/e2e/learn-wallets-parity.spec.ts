import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// /learn and /wallets are twin "card index" pages. This pins the shared
// recipe (Learn is the reference) so the two can't silently drift apart
// again — same failure class as the search-bar / Watchlist unifications.

type Page = import('@playwright/test').Page

async function css(page: Page, sel: string, prop: string) {
  return page.evaluate(([sel, prop]) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).getPropertyValue(prop) : null
  }, [sel, prop] as const)
}

test('learn and wallets share the card + grid + header recipe', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.goto('/learn')
  await page.waitForSelector('.learn-card')
  const ref = {
    gridGap: await css(page, '.learn-grid', 'gap'),
    gridCols: await css(page, '.learn-grid', 'grid-template-columns'),
    gridMaxW: await css(page, '.learn-grid', 'max-width'),
    cardPad: await css(page, '.learn-card', 'padding'),
    cardRadius: await css(page, '.learn-card', 'border-top-left-radius'),
    cardGap: await css(page, '.learn-card', 'gap'),
    iconW: await css(page, '.learn-card-icon', 'width'),
    iconH: await css(page, '.learn-card-icon', 'height'),
    titleSize: await css(page, '.learn-card-title', 'font-size'),
    summarySize: await css(page, '.learn-card-summary', 'font-size'),
    summaryLh: await css(page, '.learn-card-summary', 'line-height'),
    ctaSize: await css(page, '.learn-card-cta', 'font-size'),
    ctaWeight: await css(page, '.learn-card-cta', 'font-weight'),
    hTitleSize: await css(page, '.learn-page-title', 'font-size'),
    hTitleWeight: await css(page, '.learn-page-title', 'font-weight'),
    hSubSize: await css(page, '.learn-page-subtitle', 'font-size'),
  }

  await page.goto('/wallets')
  await page.waitForSelector('.wallet-card')
  const got = {
    gridGap: await css(page, '.wallets-grid', 'gap'),
    gridCols: await css(page, '.wallets-grid', 'grid-template-columns'),
    gridMaxW: await css(page, '.wallets-grid', 'max-width'),
    cardPad: await css(page, '.wallet-card', 'padding'),
    cardRadius: await css(page, '.wallet-card', 'border-top-left-radius'),
    cardGap: await css(page, '.wallet-card', 'gap'),
    iconW: await css(page, '.wallet-icon', 'width'),
    iconH: await css(page, '.wallet-icon', 'height'),
    titleSize: await css(page, '.wallet-name', 'font-size'),
    summarySize: await css(page, '.wallet-blurb', 'font-size'),
    summaryLh: await css(page, '.wallet-blurb', 'line-height'),
    ctaSize: await css(page, '.wallet-link', 'font-size'),
    ctaWeight: await css(page, '.wallet-link', 'font-weight'),
    hTitleSize: await css(page, '.wallets-title', 'font-size'),
    hTitleWeight: await css(page, '.wallets-title', 'font-weight'),
    hSubSize: await css(page, '.wallets-subtitle', 'font-size'),
  }

  expect(got).toEqual(ref)
})

test('wallets grid collapses to one column at the same breakpoint as learn', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 680, height: 900 })

  await page.goto('/learn')
  await page.waitForSelector('.learn-card')
  const learnCols = await css(page, '.learn-grid', 'grid-template-columns')

  await page.goto('/wallets')
  await page.waitForSelector('.wallet-card')
  const walletCols = await css(page, '.wallets-grid', 'grid-template-columns')

  expect(walletCols.split(' ').length).toBe(1)
  expect(walletCols.split(' ').length).toBe(learnCols.split(' ').length)
})
