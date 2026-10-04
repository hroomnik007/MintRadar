import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'
import { measureEffective } from './fixtures/contrast'
import {
  KNOWN, ALPHA, BRAVO, CHARLIE, DELTA, NAME, mockNotifyApi, openWatchlist,
  card, down, up, msg, flags, subscribeCalls,
} from './fixtures/watchlistNotify'

// Watchlist card footer "NOTIFY · Goes down · Back up": a pill is on only after the server confirmed it.

const SHOTS = process.env['SHOTS']

test.describe('Watchlist notification toggles', () => {
  test('footer strip: label, group, named pills, aria-pressed off by default', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page)
    const strip = card(page, ALPHA).locator('.notify-strip')
    await expect(strip.getByRole('group', { name: `Notifications for ${NAME[ALPHA]}` })).toBeVisible()
    await expect(strip.locator('.notify-strip-label')).toHaveText('NOTIFY')
    await expect(strip.getByRole('button')).toHaveText(['Goes down', 'Back up'])
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    await expect(up(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    // The strip belongs to Watchlist cards only.
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await expect(page.locator('.notify-strip')).toHaveCount(0)
  })

  test('success: off → pending (disabled, spinner) → on only after the server answered; press again → off', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    api.mode = 'gate'
    const pill = down(page, ALPHA)
    await pill.click()
    await expect(pill).toBeDisabled()
    await expect(pill).toHaveAttribute('aria-busy', 'true')
    await expect(pill).toHaveAttribute('aria-pressed', 'false') // never "on" before the answer
    await expect(pill.locator('.notify-spinner')).toBeVisible()
    await expect(up(page, ALPHA)).toBeDisabled() // one request per mint at a time
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
    api.release()
    await expect(pill).toHaveAttribute('aria-pressed', 'true')
    await expect(pill).toBeEnabled()
    expect(await flags(page, ALPHA)).toEqual({ down: true, up: false, confirmed: true })
    expect(subscribeCalls(api)).toHaveLength(1)
    expect(subscribeCalls(api)[0]!.body).toMatchObject({ mintUrl: ALPHA, notifyOnDown: true, notifyOnUp: false })

    api.mode = 'ok'
    await up(page, ALPHA).click()
    await expect(up(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    expect(subscribeCalls(api)[1]!.body).toMatchObject({ notifyOnDown: true, notifyOnUp: true })
    // both off → unsubscribe
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    await up(page, ALPHA).click()
    await expect(up(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    expect(api.calls.map(c => c.path)).toEqual(['subscribe', 'subscribe', 'subscribe', 'unsubscribe'])
    expect(api.calls[3]!.body).toEqual({ mintUrl: ALPHA })
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: true })
  })

  for (const [mode, text] of [
    ['500', "Couldn't turn on notifications. Try again."],
    ['429', 'Too many requests. Try again later.'],
    ['abort', "Couldn't reach the server. Try again."],
  ] as const) {
    test(`failure (${mode}): the pill stays off, the message appears, the next success clears it`, async ({ page }) => {
      const api = await mockNotifyApi(page)
      await openWatchlist(page)
      api.mode = mode
      await down(page, ALPHA).click()
      await expect(msg(page, ALPHA)).toHaveText(text)
      await expect(msg(page, ALPHA)).toHaveAttribute('role', 'status')
      await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
      await expect(down(page, ALPHA)).toBeEnabled()
      expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
      // other cards are untouched
      await expect(msg(page, BRAVO)).toBeEmpty()
      api.mode = 'ok'
      await down(page, ALPHA).click()
      await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
      await expect(msg(page, ALPHA)).toBeEmpty()
    })
  }

  test('failure: a signer that rejects — pill stays off, message names the signer, no request is sent', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    await page.evaluate(() => { (window as unknown as { __rejectSign: boolean }).__rejectSign = true })
    await down(page, ALPHA).click()
    await expect(msg(page, ALPHA)).toHaveText('Signer declined the request.')
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    expect(api.calls).toHaveLength(0)
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
  })

  test('failure when turning OFF keeps the pill on and says so', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: false, confirmed: true }] })
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    api.mode = '500'
    await down(page, ALPHA).click()
    await expect(msg(page, ALPHA)).toHaveText("Couldn't turn off notifications. Try again.")
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    expect(await flags(page, ALPHA)).toMatchObject({ down: true, confirmed: true })
  })

  test('pressing while pending does nothing: a double click sends exactly one request', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    api.mode = 'gate'
    await down(page, ALPHA).dblclick()
    await down(page, ALPHA).click({ force: true }).catch(() => {})
    await up(page, ALPHA).click({ force: true }).catch(() => {})
    await page.waitForTimeout(300)
    expect(api.calls).toHaveLength(1)
    api.release()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    expect(api.calls).toHaveLength(1)
  })

  test('a newly starred mint shows both pills off and sends no subscribe request', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
    await loginAs(page)
    await page.goto('/')
    await page.waitForSelector('.mint-card')
    await page.locator('.mint-card', { hasText: NAME[ALPHA]! }).locator('.card-star').click()
    await page.getByRole('link', { name: 'Watchlist' }).click()
    await expect(page.locator('.wl-grid .mint-card')).toHaveCount(1)
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    await expect(up(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
    await page.waitForTimeout(500)
    expect(api.calls).toHaveLength(0)
  })

  test('legacy unconfirmed local flags show as off, are not re-subscribed at login, and the first toggle is a plain upsert', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [
      { url: ALPHA, down: true, up: true, confirmed: false },   // legacy default, never confirmed
      { url: BRAVO, down: true, up: false, confirmed: true },   // confirmed by the server
    ] })
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    await expect(up(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    await expect(down(page, BRAVO)).toHaveAttribute('aria-pressed', 'true')
    await expect(up(page, BRAVO)).toHaveAttribute('aria-pressed', 'false')

    // Next login-time sync: only the CONFIRMED mint is refreshed.
    await page.reload()
    await expect(page.locator('.wl-grid .notify-strip')).toHaveCount(4)
    await expect.poll(() => api.calls.length, { timeout: 8000 }).toBeGreaterThanOrEqual(1)
    await page.waitForTimeout(500)
    expect(subscribeCalls(api).map(c => c.body['mintUrl'])).toEqual([BRAVO])
    expect(subscribeCalls(api)[0]!.body).toMatchObject({ notifyOnDown: true, notifyOnUp: false })

    // First toggle on the legacy mint sends exactly what the UI shows (Down only), then it is confirmed.
    api.calls.length = 0
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    await expect(up(page, ALPHA)).toHaveAttribute('aria-pressed', 'false')
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]!.body).toMatchObject({ mintUrl: ALPHA, notifyOnDown: true, notifyOnUp: false })
    expect(await flags(page, ALPHA)).toEqual({ down: true, up: false, confirmed: true })
  })

  test('filled and outline states differ in background and border; widths are identical in every state', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: BRAVO, down: true, up: true, confirmed: true }] })
    const style = (loc: ReturnType<typeof down>) => loc.evaluate(el => {
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, border: cs.borderTopColor, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }
    })
    const off = await style(down(page, ALPHA))
    const on = await style(down(page, BRAVO))
    expect(on.bg).not.toBe(off.bg)
    expect(on.border).not.toBe(off.border)
    expect(off.bg).toBe('rgba(0, 0, 0, 0)') // outline only
    expect(on.width).toBeCloseTo(off.width, 1)
    // pending (same pill, request in flight)
    api.mode = 'gate'
    await down(page, ALPHA).click()
    await expect(down(page, ALPHA)).toBeDisabled()
    const pending = await style(down(page, ALPHA))
    expect(pending.width).toBeCloseTo(off.width, 1)
    expect(pending.height).toBeCloseTo(26, 0)
    api.release()
    await expect(down(page, ALPHA)).toHaveAttribute('aria-pressed', 'true')
    expect((await style(down(page, ALPHA))).width).toBeCloseTo(off.width, 1)
    // "Back up" too
    const upOff = await style(up(page, ALPHA))
    const upOn = await style(up(page, BRAVO))
    expect(upOn.width).toBeCloseTo(upOff.width, 1)
  })

  test('pill text reaches 4.5:1 in the off and the on state', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: BRAVO, down: true, up: true, confirmed: true }] })
    for (const [label, pill] of [['off', down(page, ALPHA)], ['on', down(page, BRAVO)]] as const) {
      const m = await measureEffective(pill)
      expect(m.ratio, `${label} pill text`).toBeGreaterThanOrEqual(4.5)
    }
    expect((await measureEffective(card(page, ALPHA).locator('.notify-strip-label'))).ratio).toBeGreaterThanOrEqual(4.5)
    expect((await measureEffective(page.locator('.wl-notify-explainer'))).ratio).toBeGreaterThanOrEqual(4.5)
  })

  test('the explainer appears once above the grid and not for an empty watchlist', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page)
    const explainer = page.locator('.wl-notify-explainer')
    await expect(explainer).toHaveCount(1)
    await expect(explainer).toHaveText('Optional: turn on Nostr DMs for a watched mint. You get one message when it goes down and one when it comes back (at most one of each per hour), even if this tab is closed. Your Nostr client must support private messages.')
    expect(await explainer.evaluate(el => getComputedStyle(el).fontSize)).toBe('11.5px')
    const e = (await explainer.boundingBox())!
    const g = (await page.locator('.wl-grid').boundingBox())!
    expect(e.y + e.height).toBeLessThanOrEqual(g.y + 1)
  })

  test('no explainer for an empty watchlist', async ({ page }) => {
    await mockNotifyApi(page)
    await mockRelays(page)
    await installApiMocks(page)
    await loginAs(page)
    await page.goto('/watchlist')
    await expect(page.getByText('No mints watched yet')).toBeVisible()
    await expect(page.locator('.wl-notify-explainer')).toHaveCount(0)
  })

  test('no horizontal overflow at 320, 360, 390, 768 and 1440px (with an error message showing)', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: BRAVO, down: true, up: true, confirmed: true }] })
    api.mode = '429'
    await down(page, ALPHA).click()
    await expect(msg(page, ALPHA)).toHaveText('Too many requests. Try again later.')
    for (const width of [320, 360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(100)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `page overflow at ${width}px`).toBeLessThanOrEqual(0)
      const over = await page.evaluate(() => [...document.querySelectorAll('.wl-grid .mint-card')].filter(c => c.scrollWidth > c.clientWidth + 1).length)
      expect(over, `card content overflow at ${width}px`).toBe(0)
      const stripOut = await page.evaluate(() => [...document.querySelectorAll('.notify-strip')].filter(s => {
        const c = s.closest('.mint-card')!.getBoundingClientRect(); const r = s.getBoundingClientRect()
        return r.right > c.right + 0.5 || [...s.querySelectorAll('button')].some(b => b.getBoundingClientRect().right > c.right)
      }).length)
      expect(stripOut, `strip outside its card at ${width}px`).toBe(0)
      const rows = await page.evaluate(() => [...document.querySelectorAll('.notify-strip-row')].map(r => new Set([...r.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().top))).size))
      expect(rows.every(n => n === 1), `pills share one row at ${width}px`).toBe(true)
    }
  })

  test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true })
    test('44px hit area with a coarse pointer (visible height stays 26px)', async ({ page }) => {
      await mockNotifyApi(page)
      await openWatchlist(page, { size: { width: 1100, height: 900 } })
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
      const pill = down(page, ALPHA)
      await pill.scrollIntoViewIfNeeded()
      const box = (await pill.boundingBox())!
      expect(box.height).toBeCloseTo(26, 0)
      const hits = await pill.evaluate((el, b) => {
        const x = b.x + b.width / 2
        const at = (dy: number) => { const t = document.elementFromPoint(x, b.y + b.height / 2 + dy); return !!t && (t === el || el.contains(t)) }
        return { inside21: at(-21) && at(21), outside24: at(-24) || at(24) }
      }, box)
      expect(hits.inside21, JSON.stringify(hits)).toBe(true)
      expect(hits.outside24).toBe(false)
    })
  })

  // Screenshots for review: SHOTS=<dir> npx playwright test e2e/watchlist-notify-toggles.spec.ts -g screenshot
  for (const [width, height] of [[1440, 900], [390, 1200]] as const) {
    test(`screenshot: all states ${width}px`, async ({ page }) => {
      test.skip(!SHOTS, 'set SHOTS=<dir> to write screenshots')
      const api = await mockNotifyApi(page)
      await openWatchlist(page, { size: { width, height }, seed: [
        { url: ALPHA, down: true, up: true, confirmed: true },    // both on
        { url: BRAVO, down: true, up: false, confirmed: true },   // one on
      ] })                                                          // Charlie, Delta: none
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${SHOTS}/notify-after-states-${width}.png`, fullPage: true })
      api.byUrl[DELTA] = '500'
      await down(page, DELTA).click()
      await expect(msg(page, DELTA)).not.toBeEmpty()
      api.byUrl[CHARLIE] = 'gate'
      await down(page, CHARLIE).click()
      await expect(down(page, CHARLIE)).toBeDisabled()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${SHOTS}/notify-after-pending-error-${width}.png`, fullPage: true })
      api.release()
    })
  }
})
