import { test, expect, type Browser, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { flush, layoutReady, resize } from './fixtures/settle'

// Add a mint / Mint QR polish (2026-11-26): "Already tracked" in the Single preview, the hint that matches what the
// field accepts, the mobile row "+ Add a mint" beside a shortened Sort button, 44px touch targets, a dialog whose buttons
// stay reachable above the on-screen keyboard, a 16px Bulk field, and the Mint QR dialog (whole URL, full-width Copy,
// 44px Copy and close, a 4-module quiet zone).

const ALPHA = MOCK_MINTS[0]!.url
const PATH = `/mint/${encodeURIComponent(ALPHA)}`

async function homeAt(page: Page, width: number, height: number, query = '') {
  await mockRelays(page)
  await installApiMocks(page)
  await resize(page, width, height)
  await page.goto(`/${query}`)
  await expect(page.locator('.mint-card').first()).toBeVisible()
  await layoutReady(page)
}

/** A phone: touch, so (pointer: coarse) applies and the layout viewport is the width (a resize after the start does not work with isMobile). */
async function phone(browser: Browser, width: number, height: number): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await mockRelays(page)
  await installApiMocks(page)
  return { page, close: () => ctx.close() }
}
async function phoneHome(browser: Browser, width: number, height: number, path = '/') {
  const p = await phone(browser, width, height)
  await p.page.goto(path)
  await layoutReady(p.page)
  return p
}

// ── the mobile row ────────────────────────────────────────────────────────────────────────────────────────────────
test.describe('phone: "+ Add a mint" beside the shortened Sort button', () => {
  for (const width of [360, 390, 420]) {
    for (const [name, query] of [['default view', ''], ['reset button and the longest sort label', '?status=all&sort=reviewCount']] as const) {
      test(`${width}px, ${name}: one row, no overflow, 44px targets`, async ({ browser }) => {
        const { page, close } = await phoneHome(browser, width, 800, `/${query}`)
        await expect(page.locator('.mint-card').first()).toBeVisible()
        const add = page.getByRole('button', { name: 'Add a mint' })
        const sort = page.locator('.sort-select')
        await expect(add).toBeVisible()
        await expect(add).toContainText('Add a mint')
        const [a, s, overflow] = await Promise.all([
          add.evaluate(e => { const r = e.getBoundingClientRect(); const b = getComputedStyle(e, '::before'); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width, hitH: parseFloat(b.height) || r.height, labelH: (e.querySelector('.submit-btn-label') as HTMLElement).getBoundingClientRect().height, scrollW: (e as HTMLElement).scrollWidth, clientW: (e as HTMLElement).clientWidth } }),
          sort.evaluate(e => { const r = e.getBoundingClientRect(); const b = getComputedStyle(e, '::before'); const t = e.querySelector('.sort-select-text') as HTMLElement; return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, hitH: parseFloat(b.height) || r.height, textClipped: t.scrollWidth > t.clientWidth, text: t.innerText } }),
          page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })),
        ])
        expect(overflow.sw, 'no sideways scroll').toBeLessThanOrEqual(overflow.iw)
        expect(a.right, 'the button is inside the viewport').toBeLessThanOrEqual(width)
        expect(Math.abs(a.top - s.top), 'same row').toBeLessThan(2)
        expect(a.left, 'Sort ends before Add a mint starts').toBeGreaterThanOrEqual(s.right)
        expect(a.labelH, 'the label is one line').toBeLessThan(20)
        expect(a.scrollW).toBeLessThanOrEqual(a.clientW)
        expect(s.textClipped, `Sort label "${s.text}" is not cut`).toBe(false)
        expect(s.text).not.toContain('Sort:')
        expect(a.hitH).toBeGreaterThanOrEqual(44)
        expect(s.hitH).toBeGreaterThanOrEqual(44)
        await expect(page.locator('.submit-btn-more')).toBeVisible()
        await close()
      })
    }
  }

  test('320px: the label shortens to "+ Add", the name stays "Add a mint", one row, nothing cut or overflowing', async ({ browser }) => {
    const { page, close } = await phoneHome(browser, 320, 800, '/?status=all&sort=reviewCount')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    const add = page.getByRole('button', { name: 'Add a mint' })
    await expect(add).toBeVisible()
    expect((await add.evaluate(e => (e as HTMLElement).innerText)).trim(), 'the visible label').toBe('Add')
    await expect(page.locator('.submit-btn-more')).toBeHidden()
    const m = await page.evaluate(() => {
      const a = document.querySelector('.submit-btn')!.getBoundingClientRect()
      const s = document.querySelector('.sort-select')!.getBoundingClientRect()
      const t = document.querySelector('.sort-select-text') as HTMLElement
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, sameRow: Math.abs(a.top - s.top) < 2, right: a.right, clipped: t.scrollWidth > t.clientWidth, sortRight: s.right, addLeft: a.left }
    })
    expect(m.sw).toBeLessThanOrEqual(m.iw)
    expect(m.sameRow).toBe(true)
    expect(m.right).toBeLessThanOrEqual(320)
    expect(m.sortRight).toBeLessThanOrEqual(m.addLeft)
    await close()
  })

  test('on the desktop the plus keeps "Add a mint" and Sort keeps its word', async ({ page }) => {
    await homeAt(page, 1440, 900)
    await expect(page.locator('.submit-btn')).toContainText('Add a mint')
    await expect(page.locator('.sort-select')).toContainText('Sort: Reliability')
    await expect(page.locator('.sort-select-icon')).toBeHidden()
  })
})

// ── Add a mint dialog ─────────────────────────────────────────────────────────────────────────────────────────────
async function openDialog(page: Page) {
  const probed: string[] = []
  const sent: string[] = []
  await page.route('**/api/mint/probe**', r => {
    const u = new URL(r.request().url()).searchParams.get('url')!
    probed.push(u)
    r.fulfill({ json: { url: u, online: true, latencyMs: 40, info: { name: 'Fresh mint', version: 'x', nuts: {} } } })
  })
  await page.route('**/api/mint/submit', r => { sent.push(String(r.request().postData())); r.fulfill({ json: { success: true, isNew: true } }) })
  await page.getByRole('button', { name: 'Add a mint' }).click()
  await expect(page.locator('.submit-modal')).toBeVisible()
  return { probed, sent }
}

test.describe('Add a mint dialog', () => {
  test('a mint that is already tracked says so, is not probed and cannot be submitted', async ({ page }) => {
    await homeAt(page, 1440, 900)
    const { probed, sent } = await openDialog(page)
    const input = page.locator('#submit-input')
    const ok = page.locator('.submit-ok-btn')
    await input.fill(ALPHA)
    const tracked = page.getByTestId('submit-tracked')
    await expect(tracked).toContainText('Already tracked')
    await expect(tracked).toContainText(MOCK_MINTS[0]!.name)
    await expect(ok).toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('.submit-probe-loading')).toHaveCount(0)
    await input.press('Enter')
    await ok.click({ force: true }) // aria-disabled keeps the button clickable: the handler itself must refuse
    await flush(page)
    expect(sent, 'nothing was submitted').toEqual([])
    expect(probed, 'a tracked mint is not probed').toEqual([])
    // the same mint typed without https:// and with a different case in the host is still the same mint
    await input.fill(ALPHA.replace('https://', '').toUpperCase().replace(/\/.*$/, (m) => m.toLowerCase()))
    await expect(tracked).toBeVisible()
    // the link opens the mint page and closes the dialog
    await tracked.getByRole('link', { name: 'Open mint page' }).click()
    await expect(page).toHaveURL(/\/mint\//)
    await expect(page.locator('.submit-modal')).toHaveCount(0)
  })

  test('a mint that is not tracked still previews and submits', async ({ page }) => {
    await homeAt(page, 1440, 900)
    const { probed, sent } = await openDialog(page)
    await page.locator('#submit-input').fill('https://fresh.mint.example')
    await expect(page.locator('.submit-probe-name')).toHaveText('Fresh mint')
    await expect(page.getByTestId('submit-tracked')).toHaveCount(0)
    await expect(page.locator('.submit-ok-btn')).toHaveAttribute('aria-disabled', 'false')
    await page.locator('.submit-ok-btn').click()
    await expect(page.locator('.submit-result.success')).toBeVisible()
    expect(probed).toEqual(['https://fresh.mint.example'])
    expect(sent.map(b => JSON.parse(b) as { url: string })).toEqual([{ url: 'https://fresh.mint.example' }])
  })

  test('the hints say what the field accepts', async ({ page }) => {
    await homeAt(page, 1440, 900)
    await openDialog(page)
    await expect(page.locator('#submit-helper')).toHaveText('https:// is added to a bare address, http:// is not accepted · 20 per hour.')
    await page.locator('#submit-tab-bulk').click()
    await expect(page.locator('#bulk-limits')).toHaveText('https:// is added to a bare address, http:// is not accepted · up to 100 mints · 10 per hour.')
    // and it is true: a bare address is taken, http:// is refused
    await page.locator('#submit-tab-single').click()
    await page.locator('#submit-input').fill('http://fresh.mint.example')
    await expect(page.locator('.submit-reason')).toHaveText('The URL must start with https://.')
  })

  test('the Bulk field is 16px on a phone (iOS does not zoom the page)', async ({ browser }) => {
    const { page, close } = await phoneHome(browser, 390, 844)
    await openDialog(page)
    await page.locator('#submit-tab-bulk').click()
    expect(await page.locator('#bulk-input').evaluate(e => getComputedStyle(e).fontSize)).toBe('16px')
    await close()
  })

  for (const width of [360, 390]) {
    test(`${width}px, a 350px tall screen (keyboard up): Cancel and Add mint stay inside the dialog`, async ({ page }) => {
      await homeAt(page, width, 350)
      await openDialog(page)
      await page.locator('#submit-input').fill('https://fresh.mint.example')
      await expect(page.locator('.submit-probe-name')).toBeVisible()
      const box = async () => page.evaluate(() => {
        const m = document.querySelector('.submit-modal')!.getBoundingClientRect()
        const a = document.querySelector('.submit-ok-btn')!.getBoundingClientRect()
        const c = document.querySelector('.submit-cancel-btn')!.getBoundingClientRect()
        return { vh: window.innerHeight, modalTop: m.top, modalBottom: m.bottom, okTop: a.top, okBottom: a.bottom, cancelBottom: c.bottom }
      })
      const b = await box()
      expect(b.modalTop).toBeGreaterThanOrEqual(0)
      expect(b.modalBottom).toBeLessThanOrEqual(b.vh)
      expect(b.okTop).toBeGreaterThanOrEqual(b.modalTop)
      expect(b.okBottom, 'Add mint is visible without scrolling').toBeLessThanOrEqual(b.modalBottom)
      expect(b.cancelBottom).toBeLessThanOrEqual(b.modalBottom)
      // scrolled to the top of the dialog the buttons are still in view (they are pinned to its bottom)
      await page.locator('.submit-modal').evaluate(e => { e.scrollTop = 0 })
      const top = await box()
      expect(top.okBottom).toBeLessThanOrEqual(top.modalBottom)
      expect(top.okBottom).toBeLessThanOrEqual(top.vh)
    })
  }

  test('the dialog follows the visible part of the page (--vv-h / --vv-top, set by the keyboard-aware hook)', async ({ page }) => {
    await homeAt(page, 390, 844)
    await openDialog(page)
    // What a phone browser reports with the keyboard up: a visual viewport shorter than the layout viewport.
    await page.evaluate(() => { document.documentElement.style.setProperty('--vv-top', '0px'); document.documentElement.style.setProperty('--vv-h', '380px') })
    await expect.poll(() => page.locator('.submit-modal').evaluate(e => Math.round(e.getBoundingClientRect().bottom))).toBeLessThanOrEqual(380)
    const b = await page.evaluate(() => ({
      overlayH: Math.round(document.querySelector('.submit-modal-overlay')!.getBoundingClientRect().height),
      okBottom: Math.round(document.querySelector('.submit-ok-btn')!.getBoundingClientRect().bottom),
    }))
    expect(b.overlayH).toBe(380)
    expect(b.okBottom).toBeLessThanOrEqual(380)
  })
})

// ── Mint QR ───────────────────────────────────────────────────────────────────────────────────────────────────────
test.describe('Mint QR dialog', () => {
  for (const width of [360, 390]) {
    test(`${width}px: the whole URL, a 44px Copy under it, a 44px close area, a 4-module quiet zone`, async ({ browser }) => {
      const { page, close } = await phoneHome(browser, width, 844, PATH)
      await page.getByRole('button', { name: 'Mint QR' }).click()
      const url = page.locator('.qr-modal-url')
      await expect(url).toHaveValue(ALPHA)
      const u = await url.evaluate(e => { const t = e as HTMLTextAreaElement; return { sh: t.scrollHeight, ch: t.clientHeight, sw: t.scrollWidth, cw: t.clientWidth } })
      expect(u.sh, 'the URL is not cut vertically').toBeLessThanOrEqual(u.ch + 1)
      expect(u.sw, 'nor sideways').toBeLessThanOrEqual(u.cw + 1)
      const copy = await page.locator('.qr-modal-copy').boundingBox()
      expect(copy!.height).toBeGreaterThanOrEqual(44)
      const modal = await page.locator('.qr-modal').boundingBox()
      expect(copy!.width).toBeGreaterThan(modal!.width * 0.7) // full width of the box
      const closeArea = await page.locator('.qr-modal-close').evaluate(e => { const b = getComputedStyle(e, '::before'); return { w: parseFloat(b.width), h: parseFloat(b.height) } })
      expect(closeArea.w).toBeGreaterThanOrEqual(44)
      expect(closeArea.h).toBeGreaterThanOrEqual(44)
      // quiet zone: the code's first dark module sits 4 modules in (the SVG draws the white margin itself)
      const q = await page.locator('.qr-modal-code-frame svg').evaluate(svg => {
        const vb = svg.getAttribute('viewBox')!.split(' ').map(Number)
        const fg = svg.querySelectorAll('path')[1]!.getAttribute('d')!
        const m = /^M(\d+)[ ,](\d+)/.exec(fg)!
        const r = svg.getBoundingClientRect()
        return { size: vb[2]!, firstX: Number(m[1]), px: r.width }
      })
      expect(q.firstX).toBe(4)
      expect(q.px / q.size, 'a module is at least 4 CSS px wide').toBeGreaterThanOrEqual(4)
      // still closes and copies
      await page.locator('.qr-modal-copy').click()
      await expect(page.locator('.qr-modal-copy')).toHaveText('Copied')
      await page.keyboard.press('Escape')
      await expect(page.locator('.qr-modal')).toHaveCount(0)
      await close()
    })
  }
})
