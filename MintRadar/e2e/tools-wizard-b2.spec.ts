import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Best Mint wizard additions (Task B2): reason line under each result, "Preferred software", "Max latency".
// src/utils/wizardPick.ts, Tools.tsx. The wizard measures /v1/info from the browser for its top candidates on every
// "Find my mint" click; the limit only filters that measurement, so the number of connections must not change.

const base = MOCK_KNOWN_MINTS[0]!
const OLD = new Date(Date.now() - 400 * 86_400_000).toISOString()
const mk = (id: string, version: string, score: number) => ({ ...base, url: `https://${id}.mint.example`, name: `${id[0]!.toUpperCase()}${id.slice(1)} Mint`, version, reliabilityScore: score, discoveredAt: OLD, online: true, lastCheckedAt: new Date().toISOString(), units: ['sat'] })
// alpha 92 Nutshell, delta 90 CDK, echo 80 Nutshell, foxtrot 70 CDK
const KNOWN = [mk('alpha', 'Nutshell/0.16.0', 92), mk('delta', 'cdk-mintd/0.9.1', 90), mk('echo', 'Nutshell/0.17.0', 80), mk('foxtrot', 'cdk-mintd/0.9.0', 70)]
// Browser-side latency of each mint's /v1/info (ms of artificial delay); null = the mint answers 500.
const DEFAULT_DELAYS: Record<string, number | null> = { alpha: 40, delta: 420, echo: 850, foxtrot: null }

// The dev server's CSP (connect-src 'self' wss: ws:, vite.config.ts) blocks a real fetch to a mint host before the network layer,
// so page.route() cannot answer it (production's CSP allows https:). Like tools.spec.ts, fetch is patched in the page: a request to
// a mint host's /v1/info is recorded in window.__mintHits and answered after the mint's artificial delay (or with a 500).
async function open(page: Page, size: [number, number], delays: Record<string, number | null> = DEFAULT_DELAYS) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
  await page.addInitScript((d: Record<string, number | null>) => {
    const w = window as unknown as { __mintHits: string[] }
    w.__mintHits = []
    const real = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const m = /^https:\/\/([a-z]+)\.mint\.example\/v1\/info$/.exec(url)
      if (!m) return real(input, init)
      w.__mintHits.push(m[1]!)
      const delay = d[m[1]!] ?? null
      if (delay === null) return Promise.resolve(new Response('{}', { status: 500 }))
      return new Promise<Response>(resolve => setTimeout(() => resolve(new Response(JSON.stringify({ name: 'Mint', nuts: {} }), { status: 200 })), delay))
    }
  }, delays)
  await page.setViewportSize({ width: size[0], height: size[1] })
  await page.goto('/tools')
  await expect(page.getByRole('radio', { name: 'SAT', exact: true })).toBeVisible()
  return () => page.evaluate(() => (window as unknown as { __mintHits: string[] }).__mintHits.slice())
}
const toStep2 = async (page: Page) => {
  await page.getByRole('radio', { name: 'SAT', exact: true }).click()
  await page.locator('.wizard-opt', { hasText: 'Small' }).click()
}
const check = (page: Page, label: string) => page.locator('.wizard-opt', { hasText: label }).click()
// "Preferred software" and "Max latency" sit inside the collapsed "Advanced options": open it first when it is closed.
const pick = async (page: Page, group: string, name: string) => {
  const toggle = page.locator('.wizard-adv-toggle')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true }).click()
}
const find = (page: Page) => page.getByRole('button', { name: /Find my mint/ }).click()
const rows = (page: Page) => page.locator('.wizard-rec-row')
const names = async (page: Page) => (await page.locator('.wizard-rec-name').allInnerTexts()).map(t => t.trim())
const LAT = 'Max latency (measured from your browser)'

for (const size of [[1440, 900], [390, 844]] as [number, number][]) {
  test(`${size[0]}px: reason lines hold only the facts of what was selected, in the fixed order`, async ({ page }) => {
    await open(page, size)
    await toStep2(page)
    await check(page, 'Fast from here')
    await check(page, 'Reliable')
    await check(page, 'Lightning in and out')
    await page.locator('.wizard-adv-toggle').click()
    await check(page, 'Restore from seed')
    await check(page, 'Locked payments')
    await check(page, 'Live updates')
    await pick(page, 'Preferred software', 'Nutshell')
    await find(page)
    await expect(rows(page)).toHaveCount(3, { timeout: 15_000 })
    const alpha = rows(page).filter({ hasText: 'Alpha Mint' }).locator('.wizard-rec-facts')
    await expect(alpha).toHaveText(/^Lightning in and out · Restore \(NUT-09\) · Locked payments \(NUT-11\) · Live updates \(NUT-17\) · Reliability 92 · \d+ ms from your browser · Nutshell$/)
    // The CDK mint does not match the preference: the same line without the software name.
    const delta = rows(page).filter({ hasText: 'Delta Mint' }).locator('.wizard-rec-facts')
    await expect(delta).toHaveText(/^Lightning in and out · Restore \(NUT-09\) · Locked payments \(NUT-11\) · Live updates \(NUT-17\) · Reliability 90 · \d+ ms from your browser$/)
    expect(await alpha.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12)
  })

  test(`${size[0]}px: only the selected priorities appear in the line`, async ({ page }) => {
    await open(page, size)
    await toStep2(page)
    await check(page, 'Reliable')
    await find(page)
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 })
    const lines = await page.locator('.wizard-rec-facts').allInnerTexts()
    expect(lines.length).toBe(3)
    for (const l of lines) expect(l.trim()).toMatch(/^Reliability \d+$/)
  })

  test(`${size[0]}px: a preferred software is a small credit: it moves a mint 2 points behind up, and not one 10 points behind`, async ({ page }) => {
    // Equal latency everywhere, so only the Reliability Scores differ: alpha 92 Nutshell, delta 90 CDK, echo 80 Nutshell, foxtrot 70 CDK.
    await open(page, size, { alpha: 100, delta: 100, echo: 100, foxtrot: 100 })
    await toStep2(page)
    await check(page, 'Reliable')
    await find(page)
    await expect(rows(page)).toHaveCount(3, { timeout: 15_000 })
    expect(await names(page)).toEqual(['Alpha Mint', 'Delta Mint', 'Echo Mint'])
    await page.getByRole('button', { name: /Start over/ }).click()
    await toStep2(page)
    await check(page, 'Reliable')
    await pick(page, 'Preferred software', 'CDK-Mintd')
    await find(page)
    await expect(rows(page)).toHaveCount(3, { timeout: 15_000 })
    // Delta (CDK, 2 points behind Alpha) moves up; Alpha is still shown right behind it; Foxtrot (CDK, 10 points behind Echo) does not jump ahead.
    expect(await names(page)).toEqual(['Delta Mint', 'Alpha Mint', 'Echo Mint'])
  })

  test(`${size[0]}px: a latency limit keeps only measured mints under it and says how many were measured`, async ({ page }) => {
    await open(page, size)
    await toStep2(page)
    await check(page, 'Reliable')
    await pick(page, LAT, 'Under 600 ms')
    await find(page)
    await expect(rows(page)).toHaveCount(2, { timeout: 15_000 })
    expect(await names(page)).toEqual(['Alpha Mint', 'Delta Mint']) // echo is slower, foxtrot did not answer
    await expect(page.getByTestId('wizard-latency-note')).toHaveText('The latency limit applies to the 3 of 4 mints measured from your browser.')
    await expect(rows(page).first().locator('.wizard-rec-facts')).toContainText('ms from your browser')
    await page.getByRole('button', { name: /Start over/ }).click()
    await toStep2(page)
    await check(page, 'Reliable')
    await pick(page, LAT, 'Under 300 ms')
    await find(page)
    await expect(rows(page)).toHaveCount(1, { timeout: 15_000 })
    expect(await names(page)).toEqual(['Alpha Mint'])
  })
}

test('a limit with no measured mint under it says so; without a limit nothing about latency is added', async ({ page }) => {
  await open(page, [1440, 900], { alpha: 400, delta: 500, echo: 800, foxtrot: 900 })
  await toStep2(page)
  await check(page, 'Reliable')
  await pick(page, LAT, 'Under 300 ms')
  await find(page)
  await expect(page.locator('.wizard-no-results')).toHaveText('No measured mint is under 300 ms. Try a higher limit.', { timeout: 15_000 })
  await expect(rows(page)).toHaveCount(0)
  await expect(page.getByTestId('wizard-latency-note')).toHaveText('The latency limit applies to the 4 of 4 mints measured from your browser.')
})

test('the options are in the order priorities, advanced options, preferred software, max latency; Any is the default', async ({ page }) => {
  await open(page, [1440, 900])
  await toStep2(page)
  await page.locator('.wizard-adv-toggle').click()
  const q = await page.locator('#wizard-advanced .wizard-opt-label').allInnerTexts()
  expect(q).toEqual(['Restore from seed', 'Locked payments', 'Live updates', 'Preferred software', 'Max latency'])
  const soft = page.getByRole('radiogroup', { name: 'Preferred software' }).getByRole('radio')
  await expect(soft).toHaveText(['Any', 'CDK-Mintd', 'Nutshell']) // the Dashboard order: most mints first, ties alphabetical
  await expect(soft.first()).toHaveAttribute('aria-checked', 'true')
  const lat = page.getByRole('radiogroup', { name: LAT }).getByRole('radio')
  await expect(lat).toHaveText(['Any', 'Under 300 ms', 'Under 600 ms'])
  await expect(lat.first()).toHaveAttribute('aria-checked', 'true')
})

test('a latency limit causes no extra connection to any mint host', async ({ page, context }) => {
  const hitsWithout = await open(page, [1440, 900])
  await toStep2(page)
  await check(page, 'Reliable')
  await find(page)
  await expect(rows(page).first()).toBeVisible({ timeout: 15_000 })
  const without = await hitsWithout()
  const page2 = await context.newPage()
  const hitsWith = await open(page2, [1440, 900])
  await toStep2(page2)
  await check(page2, 'Reliable')
  await pick(page2, LAT, 'Under 300 ms')
  await find(page2)
  await expect(page2.getByTestId('wizard-latency-note')).toBeVisible({ timeout: 15_000 })
  const withLimit = await hitsWith()
  expect(without.length).toBe(4) // the four candidates, once each
  expect(withLimit.length).toBe(without.length)
  expect([...withLimit].sort()).toEqual([...without].sort())
})

for (const w of [390, 360, 320]) {
  test(`${w}px: the new options and the reason lines do not overflow or clip`, async ({ page }) => {
    await open(page, [w, 800])
    await toStep2(page)
    await check(page, 'Reliable')
    await check(page, 'Lightning in and out')
    await pick(page, 'Preferred software', 'CDK-Mintd')
    await pick(page, LAT, 'Under 600 ms')
    for (const g of ['Preferred software', LAT]) {
      const box = (await page.getByRole('radiogroup', { name: g }).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(w)
      for (const r of await page.getByRole('radiogroup', { name: g }).getByRole('radio').all()) {
        const b = (await r.boundingBox())!
        expect(b.height).toBeGreaterThanOrEqual(36)
        expect(await r.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12)
      }
    }
    await find(page)
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const f = page.locator('.wizard-rec-facts').first()
    const fb = (await f.boundingBox())!
    expect(fb.x + fb.width).toBeLessThanOrEqual(w)
    expect(await f.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12)
  })
}
