import { test, expect } from '@playwright/test'
import { LNPAY_DETAIL, NO_8333, NOT_COVERED, auditCzResponse, czDetail, gotoAuditTab } from './fixtures/auditCz'

type Page = import('@playwright/test').Page

// Overview "Network" card (src/components/MintNetworkCard.tsx, src/utils/networkInfo.ts): public network
// facts about the mint host from the cashu.info detail our backend stores. Mocked endpoints only.

const card = (page: Page) => page.getByTestId('mint-network-card')
const rowOf = (page: Page, label: string) => card(page).locator('.md-info-row', { has: page.locator('.md-info-label', { hasText: new RegExp(`^${label}`) }) })
const value = (page: Page, label: string) => rowOf(page, label).locator('.md-info-value')
const XSS = '<img src=x onerror=alert(1)>'

const IP = '188.166.166.165'
const withNetwork = (net: Record<string, unknown>, extra: Record<string, unknown> = {}, alpha: Record<string, unknown> = {}) =>
  ({ alpha: { ...NO_8333, ...alpha }, cz: auditCzResponse({ detail: czDetail({ network: { ...LNPAY_DETAIL.network, ...net }, ...extra }) }) })

const open = (page: Page, setup: Parameters<typeof gotoAuditTab>[1]) => gotoAuditTab(page, setup, false)

test('LNpay-like detail: title with the source tag and the rows', async ({ page }) => {
  await open(page, withNetwork({}, {}, { ipAddress: IP }))
  await expect(card(page)).toBeVisible()
  await expect(card(page).locator('.md-panel-title')).toHaveText(/^network\s*via cashu\.info$/i, { useInnerText: true })
  await expect(card(page).locator('.md-info-label')).toHaveText(['IP', 'Network', 'Registered in', 'Tor'])
  await expect(value(page, 'IP')).toHaveText(IP)
  await expect(value(page, 'Network')).toHaveText('AS14061 DigitalOcean')
  await expect(value(page, 'Registered in')).toHaveText('United States')
  await expect(value(page, 'Tor')).toHaveText('No onion address')
  await expect(card(page).getByText('TLS')).toHaveCount(0)

  // IPv4 only: no IPv6 address anywhere in the card.
  const text = (await card(page).innerText()).replace(/\s+/g, ' ')
  expect(text).not.toMatch(/\b[0-9a-f]{0,4}(:[0-9a-f]{0,4}){3,}\b/i)
})

test('the card sits between Mint info and the rest, and Mint info keeps its rows', async ({ page }) => {
  await open(page, withNetwork({}))
  const titles = await page.locator('.md-left .md-panel-title').allInnerTexts()
  const i = titles.findIndex(t => /^Network/i.test(t))
  expect(i).toBeGreaterThan(0)
  expect(titles[i - 1]).toMatch(/Mint info/i)
  const mintInfo = page.locator('.md-panel', { has: page.locator('.md-panel-title', { hasText: /^Mint info$/i }) })
  await expect(mintInfo.locator('.md-info-label').first()).toHaveText('Name')
  await expect(mintInfo.getByText('Discovered', { exact: true })).toBeVisible()
  // label left, value right, hairline divider (both info cards share the recipe)
  for (const row of [mintInfo.locator('.md-info-row').first(), card(page).locator('.md-info-row').first()]) {
    const m = await row.evaluate(r => {
      const l = r.querySelector('.md-info-label')!.getBoundingClientRect()
      const v = r.querySelector('.md-info-value')!.getBoundingClientRect()
      return { labelLeft: l.left, valueRight: v.right, rowLeft: r.getBoundingClientRect().left, rowRight: r.getBoundingClientRect().right, border: getComputedStyle(r).borderBottomWidth, align: getComputedStyle(r.querySelector('.md-info-value')!).textAlign }
    })
    expect(m.labelLeft - m.rowLeft).toBeLessThan(2)
    expect(m.rowRight - m.valueRight).toBeLessThan(2)
    expect(m.align).toBe('right')
    expect(m.border).not.toBe('0px')
  }
})

test('the registration row says what it is and carries the caveat as an info tooltip', async ({ page }) => {
  await open(page, withNetwork({}))
  await expect(rowOf(page, 'Registered in')).toContainText('United States')
  await expect(card(page).locator('.md-info-label', { hasText: /^Country$/ })).toHaveCount(0)
  await rowOf(page, 'Registered in').locator('.info-tooltip').hover()
  await expect(rowOf(page, 'Registered in').getByRole('tooltip')).toContainText('Country where the IP block is registered, not where the server stands.')
})

test.describe('IP row', () => {
  test('no address yet: the row is hidden', async ({ page }) => {
    await open(page, withNetwork({}))
    await expect(rowOf(page, 'IP')).toHaveCount(0)
    await expect(card(page).locator('.md-info-label')).toHaveText(['Network', 'Registered in', 'Tor'])
  })
  test('offline mint without an address: the IP row says Offline', async ({ page }) => {
    await open(page, { alpha: { ...NO_8333, online: false }, cz: NOT_COVERED })
    await expect(value(page, 'IP')).toHaveText('Offline')
  })
  test('hostile address is dropped, not printed', async ({ page }) => {
    await open(page, withNetwork({}, {}, { ipAddress: XSS }))
    await expect(rowOf(page, 'IP')).toHaveCount(0)
  })
  test('a mint without a cashu.info detail still shows the IP row alone, without the source tag', async ({ page }) => {
    await open(page, { alpha: { ...NO_8333, ipAddress: IP }, cz: NOT_COVERED })
    await expect(card(page)).toBeVisible()
    await expect(card(page).locator('.md-info-label')).toHaveText(['IP'])
    await expect(value(page, 'IP')).toHaveText(IP)
    await expect(card(page).locator('.md-panel-title')).not.toContainText(/cashu\.info/i)
  })
})

test('Tor row: onion address available', async ({ page }) => {
  await open(page, withNetwork({}, { onion: true }))
  await expect(value(page, 'Tor')).toHaveText('Onion address available')
})

test.describe('no network data: the card is not rendered', () => {
  test('no detail stored', async ({ page }) => {
    await open(page, { alpha: NO_8333, cz: auditCzResponse({ detail: null }) })
    await expect(page.locator('.md-panel-title', { hasText: /^Mint info$/i })).toBeVisible()
    await expect(card(page)).toHaveCount(0)
  })
  test('detail without a network block', async ({ page }) => {
    const { network: _n, ...rest } = czDetail()
    void _n
    await open(page, { alpha: NO_8333, cz: auditCzResponse({ detail: rest }) })
    await expect(page.locator('.md-panel-title', { hasText: /^Mint info$/i })).toBeVisible()
    await expect(card(page)).toHaveCount(0)
  })
  test('mint not covered', async ({ page }) => {
    await open(page, { alpha: NO_8333, cz: NOT_COVERED })
    await expect(page.locator('.md-panel-title', { hasText: /^Mint info$/i })).toBeVisible()
    await expect(card(page)).toHaveCount(0)
  })
})

test('hostile network strings are shown as text: no element, no dialog, no request', async ({ page }) => {
  const h = await open(page, withNetwork({ asName: XSS, country: XSS }))
  await expect(value(page, 'Network')).toHaveText(`AS14061 ${XSS}`)
  await expect(rowOf(page, 'Registered in')).toHaveCount(0) // not a country code: the row is hidden, nothing printed
  await expect(card(page).locator('img')).toHaveCount(0)
  await expect(page.locator('[onerror], img[src="x"]')).toHaveCount(0)
  expect(h.requests.filter(u => new URL(u).pathname === '/x')).toEqual([])
  expect(h.dialogs).toEqual([])
  await page.evaluate(() => { alert('canary') })
  expect(h.dialogs).toEqual(['canary'])
})

test('the browser asks only our own backend for it', async ({ page }) => {
  const h = await open(page, withNetwork({}))
  await expect(card(page)).toBeVisible()
  const origin = new URL(page.url()).origin
  expect(h.requests.filter(u => /^https?:/.test(u) && new URL(u).origin !== origin && /cashu\.info|audit/i.test(u))).toEqual([])
  expect(h.czQueries().length).toBeGreaterThan(0)
})

test.describe('390px viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('a long network name is capped and nothing overflows sideways', async ({ page }) => {
    await open(page, withNetwork({ asName: `X - ${'W'.repeat(120)}` }))
    await expect(card(page)).toBeVisible()
    expect(Array.from(((await value(page, 'Network').innerText()).replace(/^AS14061 /, ''))).length).toBeLessThanOrEqual(48)
    const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, right: document.querySelector('[data-testid="mint-network-card"]')!.getBoundingClientRect().right }))
    expect(m.doc).toBeLessThanOrEqual(m.client)
    expect(m.right).toBeLessThanOrEqual(390 + 1)
  })
})
