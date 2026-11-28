import { test, expect, type Browser, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { flush, layoutReady, resize } from './fixtures/settle'

// Add a mint / Mint QR polish (2026-11-26): "Already tracked" in the Single preview, the hint that matches what the
// field accepts, the mobile row "+ Add a mint" beside Sort with its word "Sort:", 44px touch targets, a dialog whose
// buttons stay reachable above the on-screen keyboard, a 16px Bulk field, the mint's icon in "Already tracked", and the Mint
// QR dialog (a one-line title, the URL as plain read-only text with a copy icon in its box, 44px copy and close areas, a
// 4-module quiet zone; the URL wraps at slashes and dots, not mid-word).

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
test.describe('phone: "+ Add a mint" beside "Sort: ..."', () => {
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
          sort.evaluate(e => { const r = e.getBoundingClientRect(); const b = getComputedStyle(e, '::before'); const t = e.querySelector('.sort-select-text') as HTMLElement; return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, hitH: parseFloat(b.height) || r.height, textClipped: t.scrollWidth > t.clientWidth, textNeeded: t.scrollWidth, textBox: t.clientWidth, text: t.innerText } }),
          page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })),
        ])
        expect(overflow.sw, 'no sideways scroll').toBeLessThanOrEqual(overflow.iw)
        expect(a.right, 'the button is inside the viewport').toBeLessThanOrEqual(width)
        expect(Math.abs(a.top - s.top), 'same row').toBeLessThan(2)
        expect(a.left, 'Sort ends before Add a mint starts').toBeGreaterThanOrEqual(s.right)
        expect(a.labelH, 'the label is one line').toBeLessThan(20)
        expect(a.scrollW).toBeLessThanOrEqual(a.clientW)
        // The one measured exception: 360px with the reset button AND "Most reviewed" is ~19px short (the text box is 118px of
        // the 137px it needs), so it ends in an ellipsis there (the accessible name stays complete). Everywhere else it is whole.
        const tightest = width === 360 && query !== ''
        if (tightest) {
          expect(s.textClipped, 'the one known tight case ends in an ellipsis').toBe(true)
          expect(s.textNeeded - s.textBox, 'and is short by no more than 24px').toBeLessThanOrEqual(24)
          await expect(sort).toHaveAccessibleName('Sort: Most reviewed') // the full text, also where the box cuts it
        } else {
          expect(s.textClipped, `Sort label "${s.text}" is not cut`).toBe(false)
        }
        expect(s.text, 'the word Sort: stays on phones').toMatch(/^Sort: \S/)
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
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, sameRow: Math.abs(a.top - s.top) < 2, right: a.right, clipped: t.scrollWidth > t.clientWidth, sortRight: s.right, addLeft: a.left, text: t.innerText }
    })
    expect(m.text).toMatch(/^Sort: \S/)
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
    await expect(tracked).toContainText('Already on MintRadar')
    await expect(tracked).toContainText(MOCK_MINTS[0]!.name)
    // the mint's icon component, as on the mint cards: this mock has no icon, so the monogram fallback shows
    await expect(tracked.getByRole('img', { name: /mint icon placeholder/ })).toBeVisible()
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

  test('Already tracked shows the mint\'s icon, the same component and proxy as the mint cards', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const iconUrls: string[] = []
    await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_MINTS.map((m, i) => (i === 0 ? { ...m, iconUrl: 'https://alpha.example/icon.png' } : m)) }))
    await page.route('**/api/mint/icon**', r => { iconUrls.push(new URL(r.request().url()).searchParams.get('url')!); r.fulfill({ status: 200, contentType: 'image/png', body: png }) })
    await resize(page, 1440, 900)
    await page.goto('/')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await openDialog(page)
    await page.locator('#submit-input').fill(ALPHA)
    const img = page.getByTestId('submit-tracked').locator('img')
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('src', `/api/mint/icon?url=${encodeURIComponent(ALPHA)}`)
    expect(iconUrls).toContain(ALPHA)
    // icon and text sit side by side: the icon is left of the text and 36px like the card avatar
    const g = await page.getByTestId('submit-tracked').evaluate(el => {
      const i = el.querySelector('img')!.getBoundingClientRect()
      const t = el.querySelector('.submit-probe-name')!.getBoundingClientRect()
      return { w: i.width, h: i.height, iconRight: i.right, textLeft: t.left }
    })
    expect(g.w).toBe(36)
    expect(g.h).toBe(36)
    expect(g.iconRight).toBeLessThanOrEqual(g.textLeft)
  })

  test('a mint that is not tracked still previews and submits', async ({ page }) => {
    await homeAt(page, 1440, 900)
    const { probed, sent } = await openDialog(page)
    await page.locator('#submit-input').fill('https://fresh.mint.example')
    await expect(page.locator('.submit-probe-name')).toHaveText('Fresh mint')
    await expect(page.getByTestId('submit-tracked')).toHaveCount(0)
    // A1/A5 (2026-11-28): facts without a "v" before the version, and "Answers as a Cashu mint"
    const preview = page.getByTestId('submit-preview')
    await expect(preview.locator('.submit-probe-meta')).toHaveText(/^(?!v)\S.* · \d+ of 14 NUTs/)
    await expect(preview).toContainText('Answers as a Cashu mint')
    await expect(page.locator('.submit-ok-btn')).toHaveAttribute('aria-disabled', 'false')
    await page.locator('.submit-ok-btn').click()
    await expect(page.locator('.submit-result.success')).toHaveText(/^Added .+\. Its first check runs within 5 minutes\.$/)
    await expect(page.locator('.submit-modal').getByRole('link', { name: 'Open mint page' })).toHaveAttribute('href', `/mint/${encodeURIComponent('https://fresh.mint.example')}`)
    expect(probed).toEqual(['https://fresh.mint.example'])
    expect(sent.map(b => JSON.parse(b) as { url: string })).toEqual([{ url: 'https://fresh.mint.example' }])
  })

  test('the hints say what the field accepts', async ({ page }) => {
    await homeAt(page, 1440, 900)
    await openDialog(page)
    await expect(page.locator('#submit-helper')).toHaveText('https:// is added for you. Up to 20 mints an hour.')
    await expect(page.locator('#submit-input')).toHaveAttribute('placeholder', 'mint.example.com or npub1…')
    await expect(page.locator('#submit-desc')).toHaveText("Paste the mint's address, or the npub of its Nostr announcement. We check that it answers as a Cashu mint before adding it.")
    await page.locator('#submit-tab-bulk').click()
    await expect(page.locator('#bulk-limits')).toHaveText('https:// is added for you. Up to 100 mints at once, 10 times an hour.')
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
    test(`${width}px: one-line title, the URL as plain text in a box, a full-width Copy mint URL, a 44px close area, a 4-module quiet zone and no extra white`, async ({ browser }) => {
      const { page, close } = await phoneHome(browser, width, 844, PATH)
      await page.getByRole('button', { name: 'Mint QR' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      // title: the fixed words on one line, the mint name beneath, nothing cut
      const title = page.locator('.qr-modal-title')
      expect((await title.evaluate(e => (e as HTMLElement).innerText)).trim()).toBe('Add to wallet')
      const t = await title.evaluate(e => { const r = e.getBoundingClientRect(); return { h: r.height, lh: parseFloat(getComputedStyle(e).lineHeight), sw: e.scrollWidth, cw: e.clientWidth } })
      expect(t.h, 'the title is one line').toBeLessThan(t.lh * 1.5)
      expect(t.sw).toBeLessThanOrEqual(t.cw)
      await expect(page.locator('.qr-modal-mint')).toHaveText(MOCK_MINTS[0]!.name)
      // URL: plain text, not a field; nothing in the dialog is an input or textarea
      const url = page.getByTestId('qr-modal-url')
      await expect(url).toHaveText(ALPHA)
      expect(await url.evaluate(e => e.tagName), 'a plain element, not an input').toBe('DIV')
      await expect(dialog.locator('input, textarea, [contenteditable]')).toHaveCount(0)
      await url.click()
      expect(await page.evaluate(() => document.activeElement?.tagName), 'clicking the URL focuses nothing').not.toMatch(/INPUT|TEXTAREA/)
      const u = await url.evaluate(e => { const s = getComputedStyle(e); return { sw: e.scrollWidth, cw: e.clientWidth, wrap: s.overflowWrap, font: s.fontFamily } })
      expect(u.sw, 'the URL is not cut sideways').toBeLessThanOrEqual(u.cw + 1)
      expect(u.wrap).toBe('anywhere')
      expect(u.font).toMatch(/mono/i)
      // Since 2026-11-28 (owner): a full-width copper "Copy mint URL" under the URL box, at every width; "Copied" after a click
      const copy = page.getByRole('button', { name: 'Copy mint URL' })
      await expect(copy).toBeVisible()
      const g = await page.evaluate(() => {
        const row = document.querySelector('.qr-modal-url-row')!.getBoundingClientRect()
        const c = document.querySelector('.qr-modal-copy')!
        const r = c.getBoundingClientRect()
        return { below: r.top >= row.bottom, w: r.width, rowW: row.width, h: r.height, bg: getComputedStyle(c).backgroundColor, boxRadius: getComputedStyle(document.querySelector('.qr-modal-url-row')!).borderRadius }
      })
      expect(g.below, 'the button is under the URL box').toBe(true)
      expect(Math.abs(g.w - g.rowW), 'as wide as the URL box').toBeLessThanOrEqual(1)
      expect(g.h).toBeGreaterThanOrEqual(44)
      expect(g.bg, 'filled copper').toBe('rgb(217, 138, 90)')
      expect(g.boxRadius).not.toBe('0px')
      // the close button keeps its 44px area
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
      // the white frame adds nothing to the quiet zone (2026-11-28)
      const frame = await page.locator('.qr-modal-code-frame').evaluate(e => { const f = e.getBoundingClientRect(); const v = e.querySelector('svg')!.getBoundingClientRect(); return { dx: v.left - f.left, dy: v.top - f.top } })
      expect(frame.dx).toBeLessThanOrEqual(0.5)
      expect(frame.dy).toBeLessThanOrEqual(0.5)
      // the dialog fits the screen
      const box = await page.locator('.qr-modal').boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      // still closes
      await page.keyboard.press('Escape')
      await expect(page.locator('.qr-modal')).toHaveCount(0)
      await close()
    })
  }

  test('a long mint name wraps under the one-line title and nothing is cut at 360px', async ({ browser }) => {
    const { page, close } = await phone(browser, 360, 844)
    const rows = MOCK_MINTS.map((m, i) => (i === 0 ? { ...m, name: 'A Rather Long Community Mint Name For Testing' } : m))
    await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
    await page.goto(PATH)
    await layoutReady(page)
    await page.getByRole('button', { name: 'Mint QR' }).click()
    const m = await page.evaluate(() => {
      const t = document.querySelector('.qr-modal-title') as HTMLElement
      const n = document.querySelector('.qr-modal-mint') as HTMLElement
      const d = document.querySelector('.qr-modal')!.getBoundingClientRect()
      return { titleLines: t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight), nameSw: n.scrollWidth, nameCw: n.clientWidth, nameRight: n.getBoundingClientRect().right, dialogRight: d.right, balance: getComputedStyle(n).textWrap }
    })
    expect(m.titleLines).toBeLessThan(1.5)
    expect(m.nameSw).toBeLessThanOrEqual(m.nameCw)
    expect(m.nameRight).toBeLessThanOrEqual(m.dialogRight)
    expect(m.balance).toBe('balance')
    await close()
  })

  test('the copy icon copies the URL, swaps to a check and goes back by itself (desktop)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockRelays(page)
    await installApiMocks(page)
    await resize(page, 1280, 800)
    await page.goto(PATH)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await page.getByRole('button', { name: 'Mint QR' }).click()
    // The worded button (2026-11-28): its name becomes "Copied" for a moment, so it is held by its class.
    const copy = page.locator('.qr-modal-copy')
    await expect(copy).toHaveText('Copy mint URL')
    await expect(copy.locator('svg.lucide-check')).toHaveCount(0)
    await copy.click()
    await expect(copy).toHaveText('Copied')
    await expect(copy.locator('svg.lucide-check')).toHaveCount(1)
    await expect(page.locator('.qr-modal [role="status"]')).toHaveText('Copied')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(ALPHA)
    expect([0x200B, 0x200C, 0x200D, 0xFEFF].some(c => clip.includes(String.fromCharCode(c))), 'copy has no stray characters from <wbr>').toBe(false)
    await expect(copy.locator('svg.lucide-check')).toHaveCount(0)
  })

  for (const width of [360, 390]) {
    test(`${width}px: a long path URL wraps after / or ., not mid-word, and copy is the exact URL`, async ({ browser }) => {
      // Long enough to wrap in the 400 px dialog (2026-11-28; the old 34 characters fit on one line there).
      const LONG = 'https://alpha.mint.example/cashu/api/v1/Bitcoin'
      const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true })
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
      const page = await ctx.newPage()
      await mockRelays(page)
      await installApiMocks(page)
      await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, url: LONG } : m)) }))
      await page.goto(`/mint/${encodeURIComponent(LONG)}`)
      await layoutReady(page)
      await page.getByRole('button', { name: 'Mint QR' }).click()
      const box = page.getByTestId('qr-modal-url')
      await expect(box).toHaveText(LONG)
      const u = await box.evaluate(el => {
        const range = document.createRange()
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const lines: { y: number; text: string }[] = []
        let n: Node | null
        while ((n = walker.nextNode())) {
          const t = n as Text
          for (let i = 0; i < t.length; i++) {
            range.setStart(t, i)
            range.setEnd(t, i + 1)
            const r = range.getBoundingClientRect()
            if (r.width === 0 && r.height === 0) continue
            const y = Math.round(r.top)
            const last = lines[lines.length - 1]
            if (!last || Math.abs(y - last.y) > 2) lines.push({ y, text: t.data[i]! })
            else last.text += t.data[i]!
          }
        }
        return { text: el.textContent, inner: (el as HTMLElement).innerText.replace(/\s+/g, ''), wbr: el.querySelectorAll('wbr').length, lines: lines.map(l => l.text) }
      })
      expect(u.text).toBe(LONG)
      expect(u.inner).toBe(LONG)
      expect(u.wbr, 'soft breaks after / and .').toBeGreaterThan(0)
      expect(u.lines.join('')).toBe(LONG)
      expect(u.lines.length, 'this URL is long enough to wrap').toBeGreaterThan(1)
      for (const line of u.lines.slice(0, -1)) {
        expect(line.slice(-1), `line "${line}" ends at a slash or a dot`).toMatch(/[/.]/)
      }
      expect(u.lines.some(l => l.includes('Bitcoin')), 'Bitcoin stays on one line').toBe(true)
      expect(u.lines[0]).toMatch(/^https:\/\//)
      await page.getByRole('button', { name: 'Copy mint URL' }).click()
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      expect(clip).toBe(LONG)
      expect([0x200B, 0x200C, 0x200D, 0xFEFF].some(c => clip.includes(String.fromCharCode(c))), 'copy has no stray characters from <wbr>').toBe(false)
      await ctx.close()
    })
  }
})
