import { test, expect } from '@playwright/test'
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts'
import { installApiMocks, mockRelays, probePayload, makeCashuToken, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'
import { AUDIT_ROUTES, loadRoute, type AuditRoute } from './fixtures/pageAudit'
import { trendDaysOf, trendPayload } from './fixtures/trendSeries'
import { frames, layoutReady, networkQuiet, resize, trackRequests } from './fixtures/settle'

// Phone polish (docs/claude/mobile-and-tooltips.md, "Phone text floor"): no HTML text below 12px at <=767px, the
// "Show details" button of the Network health index is a 24x24 target, and the Home status strip does not move
// anything when /api/mints/known arrives. Mocks only; nothing waits on a timer.

const PHONES = [{ width: 390, height: 844 }, { width: 320, height: 640 }] as const
const MIN_TEXT_PX = 12
const MIN_TARGET_PX = 24

interface SmallText { selector: string; size: number; text: string }
interface ScanResult { examined: number; small: SmallText[] }

// Every visible text node of the page that is HTML: not SVG, not inside an image-like element, not screen-reader-only.
// The allow-list is the `exempt` function below; it is applied in the page so the result is what is left over.
function scanText(minPx: number): ScanResult {
  // Allow-list (each entry says why):
  //  1. text inside role="img": the two-letter monogram of a mint without an icon (MintFavicon) stands in for an
  //     image and is sized as a fraction of its tile (42% of 22px = 9px in the Stats rows); it is decoration with
  //     an aria-label, not text to read, and a 12px monogram would not fit the 22px tile.
  //  2. Recharts' off-screen measuring span (a direct child of <body>, id recharts_measurement_span): it measures
  //     tick labels, is never painted in view and carries the 9px tick size; it only exists once a chart has data.
  const exempt = (el: Element): boolean => el.closest('[role="img"]') !== null || el.id === 'recharts_measurement_span'
  const describe = (el: Element): string => {
    const cls = Array.from(el.classList).slice(0, 2).map(c => `.${c}`).join('')
    const parent = el.parentElement
    return `${parent ? `${parent.tagName.toLowerCase()}${parent.classList[0] ? `.${parent.classList[0]}` : ''} > ` : ''}${el.tagName.toLowerCase()}${cls}`
  }
  const small: SmallText[] = []
  let examined = 0
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set<Element>()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || seen.has(el) || !(n.textContent ?? '').trim()) continue
    if (el.closest('svg, script, style, noscript, .sr-only')) continue
    seen.add(el)
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue
    examined++
    const size = parseFloat(style.fontSize)
    if (size < minPx && !exempt(el)) small.push({ selector: describe(el), size, text: (n.textContent ?? '').trim().slice(0, 24) })
  }
  return { examined, small }
}

// States the plain mocks leave out and production data has: a Stats trend with data (the Current / High / Low row),
// Stats movers with no risers and fallers (the "No significant changes this period" lines) and a mint that reports
// its clock and Lightning methods (the "in sync" label, the method chips).
const EXTRA_ROUTES: AuditRoute[] = [
  {
    id: 'stats-no-movers', path: '/stats', ready: '.stats-movers-empty',
    before: async page => { await page.route('**/api/stats/reliability-movers**', r => r.fulfill({ json: { period: '7d', risers: [], fallers: [] } })) },
  },
  {
    id: 'stats-with-trend', path: '/stats', ready: '.trend-summary-row',
    before: async page => { await page.route('**/api/stats/reliability-trend**', r => r.fulfill({ json: trendPayload(trendDaysOf(r.request().url())) })) },
  },
  {
    id: 'mint-clock-and-methods', path: AUDIT_ROUTES.find(r => r.id === 'mint')!.path, ready: '.md-tabs',
    before: async page => {
      await page.route('**/api/mint/probe**', route => {
        const p = probePayload(MOCK_MINTS[0]!.url)
        return route.fulfill({ json: { ...p, info: { ...p.info, time: Math.floor(Date.now() / 1000) } } })
      })
    },
  },
]

for (const phone of PHONES) {
  test.describe(`${phone.width}x${phone.height}`, () => {
    for (const route of [...AUDIT_ROUTES.filter(r => r.id !== 'not-found'), ...EXTRA_ROUTES]) {
      test(`${route.id}: no HTML text below ${MIN_TEXT_PX}px`, async ({ page }) => {
        await page.setViewportSize(phone)
        await loadRoute(page, route)
        await layoutReady(page)
        const tabs = route.id.startsWith('mint') && route.id !== 'mint-rich' ? ['Overview', 'History', 'NUTs', 'Audit', 'Reviews'] : [null]
        for (const tab of tabs) {
          if (tab) {
            await page.locator('.md-tab', { hasText: new RegExp(`^${tab}`) }).click()
            await expect(page.locator('.md-tab.active')).toHaveText(new RegExp(`^${tab}`))
            await layoutReady(page)
          }
          const { examined, small } = await page.evaluate(scanText, MIN_TEXT_PX)
          // A scan that saw almost nothing proves nothing: every one of these pages has far more text than this.
          expect(examined, `${route.id}${tab ? ` ${tab}` : ''} was scanned`).toBeGreaterThan(8)
          expect(small, `${route.id}${tab ? ` ${tab}` : ''} text below ${MIN_TEXT_PX}px`).toEqual([])
        }
      })
    }

    test(`tools: the Token inspector result and the Payment request result have no HTML text below ${MIN_TEXT_PX}px`, async ({ page }) => {
      await page.setViewportSize(phone)
      await loadRoute(page, AUDIT_ROUTES.find(r => r.id === 'tools')!)
      // A test mint: its chip is part of the result and carries its own size.
      await page.locator('.token-input').fill(makeCashuToken('https://testnut.cashu.space', [21], 'sat', 'a memo'))
      await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
      await expect(page.locator('.token-result-grid')).toBeVisible()
      await expect(page.locator('.token-verify-result').first()).toBeVisible()
      await expect(page.locator('.token-test-mint-badge')).toBeVisible()
      await page.getByRole('textbox', { name: 'Payment request' }).fill(new PaymentRequest([{ type: PaymentRequestTransportType.POST, target: 'https://pay.example.com/cb' }], 'r1', 5, 'sat', [MOCK_MINTS[0]!.url, 'https://stranger.example'], 'd', true).toEncodedCreqA())
      await expect(page.getByTestId('pr-result')).toBeVisible()
      await layoutReady(page)
      const { examined, small } = await page.evaluate(scanText, MIN_TEXT_PX)
      expect(examined, 'tools result was scanned').toBeGreaterThan(30)
      expect(small, `tools result text below ${MIN_TEXT_PX}px`).toEqual([])
    })

    test('stats: "Show details" of the Network health index is at least 24x24', async ({ page }) => {
      await page.setViewportSize(phone)
      await loadRoute(page, AUDIT_ROUTES.find(r => r.id === 'stats')!)
      await layoutReady(page)
      const button = page.locator('button.nhi-show-details')
      await expect(button).toBeVisible()
      const box = await button.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThanOrEqual(MIN_TARGET_PX)
      expect(box!.height).toBeGreaterThanOrEqual(MIN_TARGET_PX)
    })

    test('home: no horizontal overflow and the sort buttons stay inside the viewport', async ({ page }) => {
      await page.setViewportSize(phone)
      await loadRoute(page, AUDIT_ROUTES.find(r => r.id === 'home')!)
      await layoutReady(page)
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      expect(sw).toBeLessThanOrEqual(cw)
      const boxes = await page.locator('.sort-btn').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right } }))
      expect(boxes).toHaveLength(5)
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(0)
        expect(b.right).toBeLessThanOrEqual(phone.width)
      }
    })
  })
}

test.describe('home status strip: the data arriving moves nothing', () => {
  // 12 mints that are all online: two-digit counts, the widest case the strip has to reserve room for.
  const MANY = Array.from({ length: 12 }, (_, i) => ({ ...MOCK_KNOWN_MINTS[0]!, url: `https://m${i}.mint.example`, name: `Mint ${i}`, online: true }))

  for (const phone of PHONES) {
    test(`${phone.width}px: layout shift after the response is below 0.02 and the strip keeps its boxes`, async ({ page }) => {
      trackRequests(page)
      await mockRelays(page)
      await installApiMocks(page)
      // The response is held until the request has reached this handler, then released by the test.
      let arrived!: () => void
      const requestReachedMock = new Promise<void>(resolve => { arrived = resolve })
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      await page.route('**/api/mints/known', async route => {
        arrived()
        await gate
        await route.fulfill({ json: MANY })
      })
      await page.addInitScript(() => {
        const w = window as unknown as { __shifts: Array<{ value: number; hadRecentInput: boolean }> }
        w.__shifts = []
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) w.__shifts.push({ value: (e as unknown as { value: number }).value, hadRecentInput: (e as unknown as { hadRecentInput: boolean }).hadRecentInput })
        }).observe({ type: 'layout-shift', buffered: true })
      })
      await resize(page, phone.width, phone.height)
      await page.goto('/')
      await requestReachedMock
      await expect(page.locator('.dash-status-item b').first()).toHaveText('—')
      await layoutReady(page)

      const strip = () => page.evaluate(() => {
        const rect = (sel: string) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10) }
        const items = Array.from(document.querySelectorAll('.dash-status-item')).map(e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.height].map(v => Math.round(v * 10) / 10) })
        return { strip: rect('.dash-status'), items: items.slice(0, 2), controls: rect('.dashboard-controls') }
      })
      const before = await strip()
      // Only what happens from here on is measured: the layout shifts of the first paint (fonts) are not the data's.
      await page.evaluate(() => { (window as unknown as { __shifts: unknown[] }).__shifts.length = 0 })

      release()
      await expect(page.locator('.dash-status-item b').first()).toHaveText('12')
      await expect(page.locator('.mint-card')).toHaveCount(12)
      await networkQuiet(page)
      await frames(page, 3)

      const after = await strip()
      expect(after.strip, 'the strip box').toEqual(before.strip)
      expect(after.items, 'the status items stay where they were (x, y, height)').toEqual(before.items)
      expect(after.controls, 'the controls below the strip').toEqual(before.controls)

      const shifts = await page.evaluate(() => (window as unknown as { __shifts: Array<{ value: number; hadRecentInput: boolean }> }).__shifts)
      const total = shifts.filter(s => !s.hadRecentInput).reduce((sum, s) => sum + s.value, 0)
      expect(total, `layout-shift total ${JSON.stringify(shifts)}`).toBeLessThan(0.02)
    })
  }
})
