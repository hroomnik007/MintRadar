import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'
import { DOC_WIDTHS, recordHosts, expectNoHorizontalOverflow, expectBoxesInsideViewport } from './fixtures/docPage'
import { WALLET_API_BASE, WALLET_EXAMPLES } from '../src/constants/forWalletsPage'

// /for-wallets "Build a request" (components/WalletRequestBuilder.tsx): state only, no storage, no request.

const BARE = `${WALLET_API_BASE}/wallets/mints`
const builder = (page: Page) => page.locator('.wg-builder')
const curlPre = (page: Page) => page.locator('pre[aria-label="Request builder: curl"]')
const fetchPre = (page: Page) => page.locator('pre[aria-label="Request builder: fetch"]')
const moreBtn = (page: Page) => builder(page).getByRole('button', { name: /More options/ })

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

async function open(page: Page, width = 1440): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/for-wallets#request-builder')
  await expect(page.getByRole('heading', { level: 2, name: 'Build a request' })).toBeVisible()
}

async function selectEverything(page: Page): Promise<void> {
  if ((await moreBtn(page).getAttribute('aria-expanded')) === 'false') await moreBtn(page).click()
  for (const c of await builder(page).locator('.wg-chip input[type=checkbox]').all()) await c.check({ force: true })
  for (const c of await builder(page).locator('.wg-check input[type=checkbox]').all()) await c.check()
  await builder(page).getByRole('radio', { name: 'SAT' }).check({ force: true })
}

test.describe('Request builder on /for-wallets', () => {
  test('sits between Quick start and Polling and caching, with one h2 and no new h1', async ({ page }) => {
    await open(page)
    const ids = await page.locator('h2[id]').evaluateAll(els => els.map(e => e.id))
    expect(ids.indexOf('request-builder')).toBe(ids.indexOf('quick-start') + 1)
    expect(ids.indexOf('polling')).toBe(ids.indexOf('request-builder') + 1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(builder(page).getByRole('heading')).toHaveCount(0)
    await expect(curlPre(page)).toHaveText(`curl -s "${BARE}"`)
  })

  for (const width of DOC_WIDTHS) {
    test(`no horizontal overflow at ${width}px, collapsed, expanded and with everything selected`, async ({ page }) => {
      await open(page, width)
      await expectNoHorizontalOverflow(page, `builder collapsed ${width}px`)
      await moreBtn(page).click()
      await expectNoHorizontalOverflow(page, `builder expanded ${width}px`)
      await selectEverything(page)
      await builder(page).getByLabel(/Changed since/).fill('2026-10-20T10:00:00+02:00')
      await builder(page).getByLabel(/Max input fee/).fill('1000000')
      await builder(page).getByLabel(/^Limit/).fill('200')
      await expectNoHorizontalOverflow(page, `builder everything selected ${width}px`)
      await expectBoxesInsideViewport(page, '.wg-builder, .wg-builder .doc-code', width)
      const m = await page.locator('.wg-builder .doc-code-pre').evaluateAll(els => els.map(e => getComputedStyle(e).overflowX))
      expect(m).toEqual(['auto', 'auto'])
    })
  }

  test('More options expands and collapses with the mouse and the keyboard', async ({ page }) => {
    await open(page)
    const btn = moreBtn(page)
    const panel = page.locator(`#${await btn.getAttribute('aria-controls')}`)
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).toBeHidden()
    await btn.click()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await expect(panel).toBeVisible()
    await btn.click()
    await expect(panel).toBeHidden()
    await btn.focus()
    await page.keyboard.press('Enter')
    await expect(panel).toBeVisible()
    await page.keyboard.press('Space')
    await expect(panel).toBeHidden()
    await expect(btn).toBeFocused()
  })

  test('selecting options changes both code blocks, and the counter follows', async ({ page }) => {
    await open(page)
    await builder(page).getByRole('radio', { name: 'SAT' }).check({ force: true })
    await builder(page).getByLabel(/Minimum score/).fill('70')
    await expect(curlPre(page)).toHaveText(WALLET_EXAMPLES.find(e => e.id === 'list-curl')!.code)
    await expect(fetchPre(page)).toHaveText(WALLET_EXAMPLES.find(e => e.id === 'list-fetch')!.code)
    await builder(page).getByRole('checkbox', { name: /NUT-11/ }).check({ force: true })
    await builder(page).getByRole('radio', { name: 'bolt11' }).check({ force: true })
    await expect(curlPre(page)).toContainText('unit=sat&minScore=70&nuts=11&method=bolt11')
    await expect(fetchPre(page)).toContainText('unit=sat&minScore=70&nuts=11&method=bolt11')
    await moreBtn(page).click()
    await builder(page).getByRole('checkbox', { name: /Offline/ }).check()
    await expect(moreBtn(page)).toContainText('(1 set)')
    await expect(curlPre(page)).toContainText('includeOffline=true')
    await builder(page).getByLabel(/^Limit/).fill('500')
    await expect(builder(page).getByText(/limit must be an integer from 1 to 200/)).toBeVisible()
    await expect(curlPre(page)).not.toContainText('limit=')
    await builder(page).getByRole('button', { name: 'Reset' }).click()
    await expect(curlPre(page)).toHaveText(`curl -s "${BARE}"`)
    await expect(moreBtn(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('each Copy button copies exactly the visible snippet', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page)
    await builder(page).getByRole('radio', { name: 'USD' }).check({ force: true })
    await builder(page).getByLabel(/Minimum score/).fill('55')
    for (const [title, pre] of [['Request builder: curl', curlPre(page)], ['Request builder: fetch', fetchPre(page)]] as const) {
      const shown = (await pre.textContent())!
      expect(shown).toContain('unit=usd&minScore=55')
      const button = page.getByRole('button', { name: `Copy: ${title}` })
      await button.click()
      await expect(button).toHaveText('Copied')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown)
    }
  })

  test('Tab order follows the visual order of the form', async ({ page }) => {
    await open(page)
    // Start on the first control (the Unit group) and record every stop until the Reset button.
    await builder(page).getByRole('radio', { name: 'Any' }).first().focus()
    const name = () => page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement & HTMLElement
      const label = el.labels?.[0]?.textContent ?? el.getAttribute('aria-label') ?? el.textContent ?? ''
      return `${el.tagName.toLowerCase()}|${el.type ?? ''}|${label.trim().replace(/\s+/g, ' ')}`
    })
    const seen = [await name()]
    for (let i = 0; i < 60 && !/Reset$/.test(seen[seen.length - 1]!); i++) {
      await page.keyboard.press('Tab')
      seen.push(await name())
    }
    const at = (re: RegExp) => seen.findIndex(s => re.test(s))
    const order = [/^input\|radio\|Any/, /^input\|range\|Minimum score/, /^input\|checkbox\|NUT-04/, /^input\|checkbox\|NUT-29/,
      /^input\|radio\|(Any|bolt11)/, /^input\|number\|Limit/, /^button\|.*More options/, /^button\|.*Copy: Request builder: curl/,
      /^pre\|/, /^button\|.*Copy: Request builder: fetch/, /^button\|.*Reset$/]
    let last = -1
    for (const re of order) {
      const from = seen.findIndex((x, k) => k > last && re.test(x))
      expect(from, `${re} after position ${last} in ${JSON.stringify(seen)}`).toBeGreaterThan(last)
      last = from
    }
    expect(at(/More options/)).toBeLessThan(at(/Reset$/))
    // The form fields come before the output and the focus ring is the keyboard one.
    expect(await page.evaluate(() => document.activeElement!.matches(':focus-visible'))).toBe(true)
    // A collapsed panel adds no tab stops: nothing between More options and the first Copy button.
    expect(seen.slice(at(/More options/) + 1, at(/Copy: Request builder: curl/))).toEqual([])
  })

  test('no request leaves the app and none goes to the API; nothing is stored', async ({ page }) => {
    const rec = recordHosts(page)
    const apiCalls: string[] = []
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(new URL(r.url()).pathname) })
    await open(page)
    await page.waitForLoadState('networkidle')
    const before = apiCalls.length
    const hostsBefore = rec.hosts().length
    await selectEverything(page)
    await builder(page).getByLabel(/^Limit/).fill('500')
    await builder(page).getByRole('button', { name: 'Reset' }).click()
    await page.waitForLoadState('networkidle')
    expect(rec.hosts()).toEqual(['localhost:5173'])
    expect(rec.hosts().length).toBe(hostsBefore)
    expect(apiCalls.slice(before)).toEqual([])
    expect(apiCalls.filter(p => p.startsWith('/api/v1/wallets') || p.startsWith('/api/wallets'))).toEqual([])
    const stored = await page.evaluate(() => ({ l: Object.keys(localStorage).filter(k => /wg|builder|request/i.test(k)), s: Object.keys(sessionStorage).filter(k => /wg|builder|request/i.test(k)) }))
    expect(stored).toEqual({ l: [], s: [] })
    expect(new URL(page.url()).search).toBe('')
  })

  test('the section shows no undefined, NaN or null', async ({ page }) => {
    await open(page)
    await selectEverything(page)
    const text = (await builder(page).innerText())
    expect(text).not.toMatch(/\bundefined\b|\bNaN\b|\bnull\b/)
    const snippets = [await curlPre(page).textContent(), await fetchPre(page).textContent()].join('\n')
    expect(snippets).not.toMatch(/\bundefined\b|\bNaN\b/)
  })
})
