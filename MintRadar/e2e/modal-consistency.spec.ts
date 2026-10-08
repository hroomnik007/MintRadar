import { test, expect, type Page, type Locator } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

// A modal must look the same whichever page opened it. History: the close button of the "Watch this mint"
// modal was squeezed on cards because a CSS rule (flex-shrink: 0) existed only in MintDetail.css, so the
// modal looked different depending on which route CSS had been loaded (fixed in 5df5c9b).
//
// Each origin is a FRESH page (new tab, full page.goto, no client-side navigation between them), so the
// route CSS chunks that are loaded differ per origin. For one modal at one viewport every measured property
// must be equal across all origins.
//
// Origins per modal: the login modal is opened from the navbar, which every page has, so it is checked from
// all four pages. "Watch this mint" opens from a star on a mint card or the Mint Detail hero star; Watchlist
// (logged out it shows only the login gate) and Stats have no star, so that modal has two origins.

const ALPHA = MOCK_MINTS[0]!.url
const DETAIL = `/mint/${encodeURIComponent(ALPHA)}`

interface Origin {
  name: string
  url: string
  ready: string
  /** Opens "Watch this mint"; absent when the page has no star. */
  watchTrigger?: (page: Page) => Locator
}

const ORIGINS: Origin[] = [
  {
    name: 'Dashboard', url: '/?status=all', ready: '.mint-card',
    watchTrigger: p => p.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('.card-star'),
  },
  { name: 'Mint Detail', url: DETAIL, ready: '.md-tabs', watchTrigger: p => p.locator('.md-watch-star-hero').first() },
  { name: 'Watchlist', url: '/watchlist', ready: '.wl-login-gate' },
  { name: 'Stats', url: '/stats', ready: '.stats-panel' },
]

interface ModalSpec {
  id: string
  dialog: string
  close: string
  title: string
  primary: string
  open: (page: Page, origin: Origin) => Promise<void>
  origins: (o: Origin) => boolean
}

const MODALS: ModalSpec[] = [
  {
    id: 'Watch this mint',
    dialog: '.rv-modal', close: '.rv-modal-close', title: '.rv-modal-title', primary: '.rv-btn-login',
    open: async (page, o) => { await o.watchTrigger!(page).click() },
    origins: o => !!o.watchTrigger,
  },
  {
    id: 'Login',
    dialog: '.nostr-modal', close: '.nostr-modal-close', title: '.nostr-modal-title',
    // The method picker has no button; its first method card is the primary action.
    primary: '.nostr-method-card',
    open: async page => { await page.locator('.navbar-login-btn').click() },
    origins: () => true,
  },
]

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]

async function measure(page: Page, m: ModalSpec) {
  const dialog = page.locator(m.dialog)
  await expect(dialog).toBeVisible()
  // Fonts must be loaded before sizes are read, otherwise the fallback font changes the heights.
  await page.evaluate(() => document.fonts.ready)
  return dialog.evaluate((d, sel) => {
    const q = (s: string) => d.querySelector(s) as HTMLElement
    const cs = (el: Element) => getComputedStyle(el)
    const box = (el: Element) => el.getBoundingClientRect()
    const close = q(sel.close)
    const title = q(sel.title)
    const primary = q(sel.primary)
    const dcs = cs(d)
    return {
      dialogWidth: box(d).width,
      padding: [dcs.paddingTop, dcs.paddingRight, dcs.paddingBottom, dcs.paddingLeft].join(' '),
      closeWidth: box(close).width,
      closeHeight: box(close).height,
      closeFlexShrink: cs(close).flexShrink,
      titleFontFamily: cs(title).fontFamily,
      titleFontSize: cs(title).fontSize,
      titleFontWeight: cs(title).fontWeight,
      primaryHeight: box(primary).height,
    }
  }, { close: m.close, title: m.title, primary: m.primary })
}

for (const m of MODALS) {
  for (const vp of VIEWPORTS) {
    test(`${m.id} modal looks the same from every page @ ${vp.width}px`, async ({ context }) => {
      const results: Record<string, Awaited<ReturnType<typeof measure>>> = {}
      for (const origin of ORIGINS.filter(m.origins)) {
        // A new tab per origin: nothing (CSS, JS state) carries over from the previous page.
        const page = await context.newPage()
        await mockRelays(page)
        await installApiMocks(page)
        await page.setViewportSize(vp)
        await page.goto(origin.url)
        await expect(page.locator(origin.ready).first()).toBeVisible()
        await m.open(page, origin)
        results[origin.name] = await measure(page, m)
        await page.close()
      }

      const names = Object.keys(results)
      expect(names.length).toBeGreaterThanOrEqual(2)
      const ref = results[names[0]!]!
      for (const name of names) {
        const r = results[name]!
        // 1px tolerance only for the widths and heights: they are fractional layout boxes (percentage
        // widths, rem line heights) and can differ by a subpixel between pages. Every style value
        // (padding, font, flex-shrink) is compared exactly.
        const ctx = `${m.id} from ${name} vs ${names[0]}`
        expect.soft(Math.abs(r.dialogWidth - ref.dialogWidth), `${ctx}: dialog width`).toBeLessThanOrEqual(1)
        expect.soft(Math.abs(r.closeWidth - ref.closeWidth), `${ctx}: close width`).toBeLessThanOrEqual(1)
        expect.soft(Math.abs(r.closeHeight - ref.closeHeight), `${ctx}: close height`).toBeLessThanOrEqual(1)
        expect.soft(Math.abs(r.primaryHeight - ref.primaryHeight), `${ctx}: primary button height`).toBeLessThanOrEqual(1)
        expect.soft(r.padding, `${ctx}: dialog padding`).toBe(ref.padding)
        expect.soft(r.closeFlexShrink, `${ctx}: close flex-shrink`).toBe(ref.closeFlexShrink)
        expect.soft(r.titleFontFamily, `${ctx}: title font family`).toBe(ref.titleFontFamily)
        expect.soft(r.titleFontSize, `${ctx}: title font size`).toBe(ref.titleFontSize)
        expect.soft(r.titleFontWeight, `${ctx}: title font weight`).toBe(ref.titleFontWeight)
        // The close control must stay a real touch/click target everywhere.
        expect.soft(r.closeWidth, `${ctx}: close button is at least 32px wide`).toBeGreaterThanOrEqual(32)
        expect.soft(r.closeHeight, `${ctx}: close button is at least 32px tall`).toBeGreaterThanOrEqual(32)
      }
    })
  }
}
