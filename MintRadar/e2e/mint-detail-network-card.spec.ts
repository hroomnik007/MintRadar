import { test, expect } from '@playwright/test'
import { D, LNPAY_DETAIL, NO_8333, NOT_COVERED, auditCzResponse, czDetail, gotoAuditTab } from './fixtures/auditCz'

type Page = import('@playwright/test').Page

// Overview "Network" card (src/components/MintNetworkCard.tsx, src/utils/networkInfo.ts): public network
// facts about the mint host from the cashu.info detail our backend stores. Mocked endpoints only.

const card = (page: Page) => page.getByTestId('mint-network-card')
const rowOf = (page: Page, label: string) => card(page).locator('.md-info-row', { has: page.locator('.md-info-label', { hasText: new RegExp(`^${label}`) }) })
const value = (page: Page, label: string) => rowOf(page, label).locator('.md-info-value')
const XSS = '<img src=x onerror=alert(1)>'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` }

const withNetwork = (net: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ alpha: NO_8333, cz: auditCzResponse({ detail: czDetail({ network: { ...LNPAY_DETAIL.network, ...net }, ...extra }) }) })

const open = (page: Page, setup: Parameters<typeof gotoAuditTab>[1]) => gotoAuditTab(page, setup, false)

test('LNpay-like detail: title with the source tag and the five rows', async ({ page }) => {
  const expires = Date.now() + 60 * D
  await open(page, withNetwork({ tlsExpiresAt: new Date(expires).toISOString() }))
  await expect(card(page)).toBeVisible()
  await expect(card(page).locator('.md-panel-title')).toHaveText(/^network\s*via cashu\.info$/i, { useInnerText: true })
  await expect(card(page).locator('.md-info-label')).toHaveText(['IP', 'Network', 'Country', 'Tor', 'TLS'])
  await expect(value(page, 'IP')).toHaveText('IPv4 and IPv6')
  await expect(value(page, 'Network')).toHaveText('AS14061 DigitalOcean')
  await expect(value(page, 'Country')).toHaveText('United States')
  await expect(value(page, 'Tor')).toHaveText('No onion address')
  await expect(value(page, 'TLS')).toHaveText(`Let's Encrypt, expires ${dayLabel(expires)}`)
  await expect(value(page, 'TLS')).toHaveAttribute('data-tls', 'ok')

  // No Address row and no IP address anywhere in the card.
  await expect(card(page).getByText('Address', { exact: true })).toHaveCount(0)
  const text = (await card(page).innerText()).replace(/\s+/g, ' ')
  expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/)
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

test('the country row carries the registration caveat as an info tooltip', async ({ page }) => {
  await open(page, withNetwork({}))
  await rowOf(page, 'Country').locator('.info-tooltip').hover()
  await expect(rowOf(page, 'Country').getByRole('tooltip')).toHaveText('Country where the network block is registered, not necessarily where the server stands.')
})

test.describe('IP wording', () => {
  for (const [name, net, expected] of [
    ['IPv4 only', { ipv4: true, ipv6: false }, 'IPv4 only'],
    ['IPv6 only', { ipv4: false, ipv6: true }, 'IPv6 only'],
  ] as const) {
    test(name, async ({ page }) => {
      await open(page, withNetwork(net))
      await expect(value(page, 'IP')).toHaveText(expected)
    })
  }
  test('both false: the row is hidden', async ({ page }) => {
    await open(page, withNetwork({ ipv4: false, ipv6: false }))
    await expect(rowOf(page, 'IP')).toHaveCount(0)
    await expect(card(page).locator('.md-info-label')).toHaveText(['Network', 'Country', 'Tor', 'TLS'])
  })
})

test.describe('TLS states', () => {
  test('expired: "expired {date}" in the warning colour', async ({ page }) => {
    const t = Date.now() - 3 * D
    await open(page, withNetwork({ tlsExpiresAt: new Date(t).toISOString() }))
    await expect(value(page, 'TLS')).toHaveText(`Let's Encrypt, expired ${dayLabel(t)}`)
    await expect(value(page, 'TLS')).toHaveAttribute('data-tls', 'expired')
    const [c, amber, normal] = await page.evaluate(() => {
      const probe = (v: string) => { const e = document.createElement('i'); e.style.color = v; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c }
      const span = document.querySelector('[data-tls] span') as HTMLElement
      return [getComputedStyle(span).color, probe('var(--amber)'), getComputedStyle(document.querySelector('[data-testid="mint-network-card"] .md-info-value')!).color]
    })
    expect(c).toBe(amber)
    expect(c).not.toBe(normal)
  })

  test('fewer than 14 days left: "expires soon" appended in the warning colour', async ({ page }) => {
    const t = Date.now() + 5 * D
    await open(page, withNetwork({ tlsExpiresAt: new Date(t).toISOString() }))
    await expect(value(page, 'TLS')).toHaveText(`Let's Encrypt, expires ${dayLabel(t)} · expires soon`)
    await expect(value(page, 'TLS')).toHaveAttribute('data-tls', 'soon')
    const soon = value(page, 'TLS').locator('span').last()
    await expect(soon).toHaveText('· expires soon')
    const [c, amber] = await soon.evaluate(e => {
      const x = document.createElement('i'); x.style.color = 'var(--amber)'; document.body.appendChild(x)
      const a = getComputedStyle(x).color; x.remove(); return [getComputedStyle(e).color, a]
    })
    expect(c).toBe(amber)
  })

  test('15 days left: plain, no warning', async ({ page }) => {
    await open(page, withNetwork({ tlsExpiresAt: new Date(Date.now() + 15 * D).toISOString() }))
    await expect(value(page, 'TLS')).not.toContainText('soon')
    await expect(value(page, 'TLS')).toHaveAttribute('data-tls', 'ok')
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
  const h = await open(page, withNetwork({ asName: XSS, tlsIssuer: XSS, country: XSS }))
  await expect(value(page, 'Network')).toHaveText(`AS14061 ${XSS}`)
  await expect(value(page, 'TLS')).toContainText(XSS)
  await expect(rowOf(page, 'Country')).toHaveCount(0) // not a country code: the row is hidden, nothing printed
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
