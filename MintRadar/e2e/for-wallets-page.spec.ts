import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import {
  DOC_WIDTHS, recordHosts, expectNoHorizontalOverflow, expectBoxesInsideViewport, expectLinksValid,
  expectExternalLinksSafe, expectKeyboardOrder,
} from './fixtures/docPage'
import { WALLET_MINT_FIELDS, WALLET_QUERY_PARAMS, WALLET_ERRORS } from '../src/utils/walletFields'
import { WALLET_EXAMPLES } from '../src/constants/forWalletsPage'
import { PAGE_META } from '../src/utils/pageMeta'

// /for-wallets: quick start for wallet developers (pages/ForWallets.tsx), a static page.

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('For wallets page', () => {
  test('renders one h1 and its sections', async ({ page }) => {
    await page.goto('/for-wallets')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: 'MintRadar for wallets' })).toBeVisible()
    for (const name of ['Quick start', 'Polling and caching', 'CORS and limits', 'Response', 'Filters', 'Errors', 'Stability', 'Suggested UX', 'Docs and contact']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    await expect(page.getByRole('note').first()).toContainText('Operational health signal, not solvency, not a recommendation to deposit funds')
  })

  test('title, description, canonical and Open Graph tags', async ({ page }) => {
    await page.goto('/')
    const genericImage = await page.locator('meta[property="og:image"]').getAttribute('content')
    await page.goto('/for-wallets')
    await expect(page).toHaveTitle(PAGE_META['/for-wallets'].title)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://mintradar.org/for-wallets')
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://mintradar.org/for-wallets')
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', PAGE_META['/for-wallets'].title)
    const description = await page.locator('meta[name="description"]').getAttribute('content')
    expect(description).toBe(PAGE_META['/for-wallets'].description)
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', genericImage!)
  })

  for (const width of DOC_WIDTHS) {
    test(`no horizontal overflow at ${width}px; code blocks and tables scroll inside their box`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/for-wallets')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page, `for-wallets ${width}px`)
      await expectBoxesInsideViewport(page, '.doc-table-wrap, .doc-code', width)
    })
  }

  test('a long code line scrolls inside its block and does not widen the page', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/for-wallets')
    const pre = page.locator('pre.doc-code-pre[aria-label="Polling with ETag and If-None-Match (fetch)"]')
    await expect(pre).toBeVisible()
    const before = await page.evaluate(() => document.documentElement.scrollWidth)
    const m = await pre.evaluate(el => { const e = el as HTMLElement; e.scrollLeft = 80; return { sw: e.scrollWidth, cw: e.clientWidth, left: e.scrollLeft, overflowX: getComputedStyle(e).overflowX } })
    expect(m.sw).toBeGreaterThan(m.cw)
    expect(m.left).toBeGreaterThan(0)
    expect(m.overflowX).toBe('auto')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(before)
    await expectNoHorizontalOverflow(page, 'after scrolling a code block')
  })

  test('the field table lists every key of the mapper, parameters and error codes', async ({ page }) => {
    await page.goto('/for-wallets')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const rows = await page.locator('tr[data-field]').evaluateAll(els => els.map(e => e.getAttribute('data-field')))
    for (const f of WALLET_MINT_FIELDS) expect(rows, f.name).toContain(f.name)
    await expect(page.locator('tr[data-param]')).toHaveCount(WALLET_QUERY_PARAMS.length)
    await expect(page.locator('tr[data-code]')).toHaveCount(WALLET_ERRORS.length)
    const row = page.locator('tr[data-field="score"]')
    await expect(row).toContainText('integer 0 to 100')
    await expect(row).toContainText('yes')
  })

  test('copy buttons put exactly the code on the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/for-wallets')
    for (const ex of WALLET_EXAMPLES.slice(0, 2)) {
      const button = page.getByRole('button', { name: `Copy: ${ex.title}` })
      await button.click()
      await expect(button).toHaveText('Copied')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ex.code)
    }
  })

  test('internal links are valid and external links are safe', async ({ page }) => {
    await page.goto('/for-wallets')
    await expectLinksValid(page)
    await expectExternalLinksSafe(page)
    await expect(page.getByRole('link', { name: 'docs/API.md' })).toHaveAttribute('href', 'https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/API.md')
    await expect(page.getByRole('link', { name: 'docs/openapi/wallets-v1.yaml' })).toHaveAttribute('href', 'https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/openapi/wallets-v1.yaml')
    await expect(page.getByRole('link', { name: 'Reliability Score methodology' })).toHaveAttribute('href', '/methodology')
  })

  test('makes no request to any host other than the app, and none to the API', async ({ page }) => {
    const rec = recordHosts(page)
    const apiCalls: string[] = []
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/v1/wallets')) apiCalls.push(r.url()) })
    await page.goto('/for-wallets')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(rec.hosts()).toEqual(['localhost:5173'])
    expect(apiCalls).toEqual([])
  })

  test('keyboard: Tab reaches every link, copy button and scroll box in order with a visible focus indicator', async ({ page }) => {
    await page.goto('/for-wallets')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectKeyboardOrder(page)
  })

  test('the Methodology page links here', async ({ page }) => {
    await page.goto('/methodology')
    await page.getByRole('link', { name: 'API for wallets' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/for-wallets')
    await expect(page.getByRole('heading', { level: 1, name: 'MintRadar for wallets' })).toBeVisible()
  })
})
