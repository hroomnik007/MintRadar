import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

type Page = import('@playwright/test').Page

const card = (page: Page, name: string) => page.locator('.mint-card', { hasText: name })

// Fixture discoveredAt: Alpha 400d, Bravo 10d, Charlie 120d, Delta 200d.
test.describe('MintCard — copy & reduced badge set', () => {
  test.beforeEach(async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
  })

  test('"New" badge shows only for a mint discovered < 30 days ago', async ({ page }) => {
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)
    await expect(card(page, 'Bravo Mint').getByText('New', { exact: true })).toBeVisible()
    await expect(card(page, 'Alpha Mint').getByText('New', { exact: true })).toHaveCount(0)
    await expect(card(page, 'Delta Mint').getByText('New', { exact: true })).toHaveCount(0)
  })

  test('Established / Veteran / OG badges are gone from cards', async ({ page }) => {
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)
    for (const label of ['Established', 'Veteran', 'OG']) {
      await expect(page.locator('.mint-card').getByText(label, { exact: true })).toHaveCount(0)
    }
  })

  test('version + "N NUTs" pills are gone from the card', async ({ page }) => {
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)
    await expect(page.locator('.mint-card .card-pill', { hasText: /NUTs/ })).toHaveCount(0)
    await expect(page.locator('.mint-card .card-pill', { hasText: /Nutshell|cdk-mintd/ })).toHaveCount(0)
  })

  test('Trust block shows a bare number (no %), or "Trust n/a" when missing', async ({ page }) => {
    await page.goto('/?status=all')
    const alphaTrust = card(page, 'Alpha Mint').locator('.card-trust')
    await expect(alphaTrust).toBeVisible()
    await expect(alphaTrust.locator('.card-trust-score')).toHaveText('92')
    await expect(alphaTrust).not.toContainText('%')
    // Offline mint with a null score still shows the block, as "Trust n/a".
    await expect(card(page, 'Charlie Mint').locator('.card-trust-na')).toHaveText('Trust n/a')
  })

  test('uptime chip reads "<n>% up 24h"', async ({ page }) => {
    await page.goto('/?status=all')
    await expect(card(page, 'Alpha Mint').locator('.card-pill', { hasText: '99% up 24h' })).toBeVisible()
  })

  test('Lightning chip: "LN" when bolt11 is on mint + melt, "LN in" for mint-only, none when methods absent', async ({ page }) => {
    // Fixture buildMethods() gives bolt11 on both sides for any mint with units;
    // Charlie has units: null → no methods → no chip.
    const rows = MOCK_KNOWN_MINTS.map(m => {
      if (m.name === 'Bravo Mint') return { ...m, meltMethods: [{ method: 'onchain', unit: 'sat' }] }
      return m
    })
    await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await expect(card(page, 'Alpha Mint').locator('.card-ln')).toHaveText('LN')
    // mint has bolt11, melt is onchain-only → "LN in"
    await expect(card(page, 'Bravo Mint').locator('.card-ln')).toHaveText('LN in')
    // no method data at all → no chip
    await expect(card(page, 'Charlie Mint').locator('.card-ln')).toHaveCount(0)
    // the chip has no hover text
    await expect(card(page, 'Alpha Mint').locator('.card-ln')).not.toHaveAttribute('title', /.*/)
  })

  test('latency row is never blank — sampled / timeout / n/a', async ({ page }) => {
    const rows = MOCK_KNOWN_MINTS.map(m => {
      if (m.name === 'Bravo Mint') return { ...m, online: false, latencyMs: null, lastError: 'Connection timeout' }
      if (m.name === 'Charlie Mint') return { ...m, online: false, latencyMs: null, lastError: null }
      return m
    })
    await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)

    await expect(card(page, 'Alpha Mint').locator('.latency-value')).toHaveText('50ms')
    await expect(card(page, 'Bravo Mint').locator('.latency-value')).toHaveText('timeout')
    await expect(card(page, 'Charlie Mint').locator('.latency-value')).toHaveText('n/a')
  })

  test('dashboard tiles carry the new labels + subtitles', async ({ page }) => {
    await page.goto('/?status=all')
    const bar = page.locator('.stats-bar')
    await expect(bar.getByText('Online now')).toBeVisible()
    // The Online tile shows the count as the primary value; "/ N" is the
    // muted unit beside it, not a second big number.
    const onlineTile = bar.locator('.stat-card', { hasText: 'Online now' })
    await expect(onlineTile.locator('.stat-value')).toHaveText('3')
    await expect(onlineTile.locator('.stat-unit')).toHaveText('/ 4')
    await expect(bar.getByText(/of \d+ listed/)).toHaveCount(0)
    await expect(bar.getByText('Mints tracked')).toBeVisible()
    await expect(bar.getByText('incl. offline')).toBeVisible()
    await expect(bar.getByText('from Frankfurt')).toBeVisible()

    // Tapping a count tile reveals the Listed/Known explainer.
    await expect(page.locator('.stat-count-note')).toHaveCount(0)
    await bar.getByText('Mints tracked').click()
    await expect(page.locator('.stat-count-note')).toContainText(/Listed.*in the grid.*Known.*every mint we indexed/s)
  })

  test('grid carries the Trust-vs-Stars explainer sentence once, above the cards', async ({ page }) => {
    await page.goto('/?status=all')
    const explainer = page.locator('.grid-score-explainer')
    await expect(explainer).toHaveCount(1)
    await expect(explainer).toHaveText('We score how it runs. They score how it went. You pick.')
    // Readable size: ~13–14px, not the 12px muted-caption tier.
    const fontSize = await explainer.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(13)
  })

  test('known-count is consistent: All Known tile === grid footer "of N"', async ({ page }) => {
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card')).toHaveCount(4)
    const bar = page.locator('.stats-bar')
    const tile = (await bar.locator('.stat-card', { hasText: 'Mints tracked' }).locator('.stat-value').textContent())?.trim()
    const footer = await page.locator('.grid-showing-note').textContent()
    const footerN = footer?.match(/of (\d+)/)?.[1]
    expect(footerN).toBe(tile)
    // 4 mock mints, none degraded → "Showing 4 of 4", tile "4".
    expect(footerN).toBe('4')
  })
})

test.describe('Dashboard list view — reduced columns', () => {
  test.beforeEach(async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
  })

  test('no Age column / Established–Veteran–OG badges, Trust cell has no %', async ({ page }) => {
    await page.goto('/?status=all')
    await page.locator('.view-toggle-btn[title="List view"]').click()
    await expect(page.locator('.mint-list-table')).toBeVisible()

    // Age column header + age badges are gone.
    await expect(page.locator('.mint-list-table th', { hasText: 'Age' })).toHaveCount(0)
    for (const label of ['Established', 'Veteran', 'OG']) {
      await expect(page.locator('.mint-list-table').getByText(label, { exact: true })).toHaveCount(0)
    }

    // Kept columns.
    for (const label of ['Status', 'Uptime 24h', 'Latency', 'Trust', 'NUTs']) {
      await expect(page.locator('.mint-list-table th', { hasText: label })).toHaveCount(1)
    }

    // Trust cell is an integer, no "%".
    const trustCell = page.locator('.mint-list-row', { hasText: 'Alpha Mint' }).locator('.trust-col')
    await expect(trustCell).toHaveText('92')
  })
})
