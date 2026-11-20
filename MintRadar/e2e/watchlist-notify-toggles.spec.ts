import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'
import { measureEffective } from './fixtures/contrast'
import {
  KNOWN, ALPHA, BRAVO, CHARLIE, DELTA, NAME, mockNotifyApi, openWatchlist,
  card, alerts, openMore, msg, flags, subscribeCalls,
} from './fixtures/watchlistNotify'
import { flush, layoutReady, resize } from './fixtures/settle'

// Watchlist row alerts (2026-11-19 mockup alignment): one "Alerts" switch turns "goes down" and "goes up" on or off
// together in ONE request; "More alerts" opens the other three as pills. Every control is on only after the server
// confirmed it.

const SHOTS = process.env['SHOTS']

test.describe('Watchlist alerts', () => {
  test('row: a named group with the switch, off by default; More alerts is closed', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page)
    const group = card(page, ALPHA).getByRole('group', { name: `Alerts for ${NAME[ALPHA]}` })
    await expect(group).toBeVisible()
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'false')
    await expect(alerts(page, ALPHA)).toHaveAccessibleName(`Alerts for ${NAME[ALPHA]}: a private message when it goes down or comes back`)
    await expect(group.getByRole('button', { name: /More alerts/ })).toHaveAttribute('aria-expanded', 'false')
    await expect(card(page, ALPHA).locator('.notify-more-pills')).toHaveCount(0)
    // The alerts belong to the Watchlist only.
    await page.goto('/?status=all')
    await expect(page.locator('.mint-card').first()).toBeVisible()
    await expect(page.locator('.notify-strip, .wl-switch')).toHaveCount(0)
  })

  test('login restores the account settings from the server (POST /api/notifications/list), apart from the toggle requests', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    await expect.poll(() => api.lists, { message: 'restoreServerSettings ran at login' }).toBeGreaterThan(0)
    expect(api.calls).toHaveLength(0)
  })

  test('success: off → pending (disabled, spinner) → on only after the server answered, both flags in one request; again → off', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    api.mode = 'gate'
    const sw = alerts(page, ALPHA)
    await sw.click()
    await expect(sw).toBeDisabled()
    await expect(sw).toHaveAttribute('aria-busy', 'true')
    await expect(sw).toHaveAttribute('aria-checked', 'false') // never "on" before the answer
    await expect(sw.locator('.notify-spinner')).toBeVisible()
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
    await api.release()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(sw).toBeEnabled()
    expect(await flags(page, ALPHA)).toEqual({ down: true, up: true, confirmed: true })
    expect(subscribeCalls(api)).toHaveLength(1)
    expect(subscribeCalls(api)[0]!.body).toMatchObject({ mintUrl: ALPHA, notifyOnDown: true, notifyOnUp: true })

    // Off with nothing else on → unsubscribe.
    api.mode = 'ok'
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(api.calls.map(c => c.path)).toEqual(['subscribe', 'unsubscribe'])
    expect(api.calls[1]!.body).toEqual({ mintUrl: ALPHA })
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: true })
  })

  test('More alerts pills: pending until the server answers, five flags sent, the switch is unchanged', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    await openMore(page, ALPHA)
    const more = card(page, ALPHA).locator('.notify-more-pills')
    await expect(more.getByRole('button')).toHaveText(['Mint/melt issues', 'Version outdated', 'Lost NUT04/05'])
    for (const b of await more.getByRole('button').all()) {
      await expect(b).toHaveClass(/notify-pill/)
      await expect(b).toHaveAttribute('aria-pressed', 'false')
      expect((await b.boundingBox())!.height).toBeCloseTo(26, 0)
    }
    api.mode = 'gate'
    const pill = more.getByRole('button', { name: /mint or melt issues/ })
    await pill.click()
    await expect(pill).toBeDisabled()
    await expect(alerts(page, ALPHA)).toBeDisabled() // one request per mint at a time
    await expect(pill).toHaveAttribute('aria-pressed', 'false')
    await expect(pill.locator('.notify-spinner')).toBeVisible()
    await api.release()
    await expect(pill).toHaveAttribute('aria-pressed', 'true')
    expect(subscribeCalls(api)[0]!.body).toMatchObject({
      mintUrl: ALPHA, notifyOnDown: false, notifyOnUp: false,
      notifyOnMintMeltIssues: true, notifyOnVersionOutdated: false, notifyOnNutLoss: false,
    })
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'false')
    await expect(card(page, ALPHA).getByRole('button', { name: /More alerts/ })).toHaveText(/More alerts \(1 on\)/)
    api.mode = 'ok'
    await pill.click()
    await expect(pill).toHaveAttribute('aria-pressed', 'false')
    expect(api.calls.map(c => c.path)).toEqual(['subscribe', 'unsubscribe'])
  })

  for (const [mode, text] of [
    ['500', "Couldn't turn on notifications. Try again."],
    ['429', 'Too many requests. Try again later.'],
    ['abort', "Couldn't reach the server. Try again."],
  ] as const) {
    test(`failure (${mode}): the switch stays off, the message appears, the next success clears it`, async ({ page }) => {
      const api = await mockNotifyApi(page)
      await openWatchlist(page)
      api.mode = mode
      await alerts(page, ALPHA).click()
      await expect(msg(page, ALPHA)).toHaveText(text)
      await expect(msg(page, ALPHA)).toHaveAttribute('role', 'status')
      await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'false')
      await expect(alerts(page, ALPHA)).toBeEnabled()
      expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
      await expect(msg(page, BRAVO)).toBeEmpty() // other rows are untouched
      api.mode = 'ok'
      await alerts(page, ALPHA).click()
      await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'true')
      await expect(msg(page, ALPHA)).toBeEmpty()
    })
  }

  test('failure: a signer that rejects — the switch stays off, the message names the signer, no request is sent', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    await page.evaluate(() => { (window as unknown as { __rejectSign: boolean }).__rejectSign = true })
    await alerts(page, ALPHA).click()
    await expect(msg(page, ALPHA)).toHaveText('Signer declined the request.')
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'false')
    await flush(page)
    expect(api.calls).toHaveLength(0)
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
  })

  test('failure when turning OFF keeps the switch on and says so', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: true, confirmed: true }] })
    api.mode = '500'
    await alerts(page, ALPHA).click()
    await expect(msg(page, ALPHA)).toHaveText("Couldn't turn off notifications. Try again.")
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'true')
    expect(await flags(page, ALPHA)).toMatchObject({ down: true, up: true, confirmed: true })
  })

  test('an entry with only one of the two on shows the switch on; switching off clears both', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: ALPHA, down: true, up: false, confirmed: true }] })
    await alerts(page, ALPHA).click()
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'false')
    expect(api.calls.map(c => c.path)).toEqual(['unsubscribe'])
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: true })
  })

  test('pressing while pending does nothing: a double click sends exactly one request', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page)
    api.mode = 'gate'
    await alerts(page, ALPHA).dblclick()
    await expect.poll(() => api.calls.length, { message: 'the pending request reached the mock' }).toBe(1)
    await expect(alerts(page, ALPHA)).toBeDisabled()
    await alerts(page, ALPHA).click({ force: true }).catch(() => {})
    await flush(page)
    expect(api.calls).toHaveLength(1)
    await api.release()
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'true')
    expect(api.calls).toHaveLength(1)
  })

  test('a newly starred mint shows the switch off and sends no subscribe request', async ({ page }) => {
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
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'false')
    expect(await flags(page, ALPHA)).toEqual({ down: false, up: false, confirmed: false })
    await flush(page)
    expect(api.calls).toHaveLength(0)
  })

  test('legacy unconfirmed local flags show as off, are not re-subscribed at login, and the first switch is a plain upsert', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [
      { url: ALPHA, down: true, up: true, confirmed: false },   // legacy default, never confirmed
      { url: BRAVO, down: true, up: false, confirmed: true },   // confirmed by the server
    ] })
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'false')
    await expect(alerts(page, BRAVO)).toHaveAttribute('aria-checked', 'true')

    // Next login-time sync: only the CONFIRMED mint is refreshed.
    await page.reload()
    await expect(page.locator('.wl-grid .wl-switch')).toHaveCount(4)
    await expect.poll(() => api.calls.length, { timeout: 8000 }).toBeGreaterThanOrEqual(1)
    await flush(page)
    // The dev server runs the login sync twice (React StrictMode), so BRAVO may be refreshed twice; never ALPHA.
    expect([...new Set(subscribeCalls(api).map(c => c.body['mintUrl']))]).toEqual([BRAVO])
    expect(subscribeCalls(api)[0]!.body).toMatchObject({ notifyOnDown: true, notifyOnUp: false })

    // The first switch on the legacy mint sends what the UI shows, then it is confirmed.
    api.calls.length = 0
    await alerts(page, ALPHA).click()
    await expect(alerts(page, ALPHA)).toHaveAttribute('aria-checked', 'true')
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]!.body).toMatchObject({ mintUrl: ALPHA, notifyOnDown: true, notifyOnUp: true })
    expect(await flags(page, ALPHA)).toEqual({ down: true, up: true, confirmed: true })
  })

  test('on and off look different (copper when on); the switch keeps its size in every state', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: BRAVO, down: true, up: true, confirmed: true }] })
    const style = (loc: ReturnType<typeof alerts>) => loc.evaluate(async el => {
      await Promise.allSettled(el.getAnimations({ subtree: true }).map(a => a.finished))
      const r = el.getBoundingClientRect()
      return { bg: getComputedStyle(el).backgroundColor, w: r.width, h: r.height }
    })
    const off = await style(alerts(page, ALPHA))
    const on = await style(alerts(page, BRAVO))
    expect(on.bg).not.toBe(off.bg)
    const copper = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--action)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c })
    expect(on.bg).toBe(copper)
    expect(on.w).toBeCloseTo(off.w, 1)
    api.mode = 'gate'
    await alerts(page, ALPHA).click()
    await expect(alerts(page, ALPHA)).toBeDisabled()
    const pending = await style(alerts(page, ALPHA))
    expect(pending.w).toBeCloseTo(off.w, 1)
    expect(pending.h).toBeCloseTo(off.h, 1)
    await api.release()
  })

  test('the switch label, the More alerts toggle and the explainer reach 4.5:1', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page)
    expect((await measureEffective(card(page, ALPHA).locator('.wl-switch-label'))).ratio).toBeGreaterThanOrEqual(4.5)
    expect((await measureEffective(card(page, ALPHA).locator('.notify-more-toggle'))).ratio).toBeGreaterThanOrEqual(4.5)
    expect((await measureEffective(page.locator('.wl-notify-explainer'))).ratio).toBeGreaterThanOrEqual(4.5)
  })

  test('the explainer appears once, above the first card', async ({ page }) => {
    await mockNotifyApi(page)
    await openWatchlist(page)
    const explainer = page.locator('.wl-notify-explainer')
    await expect(explainer).toHaveCount(1)
    await expect(explainer).toHaveText("Optional alerts come as Nostr private messages, at most 40 a day. Any alert also tells you when the mint's key or fee changes.")
    expect(await explainer.evaluate(el => getComputedStyle(el).fontSize)).toBe('12px')
    const e = (await explainer.boundingBox())!
    const first = (await page.locator('.wl-grid .mint-card').first().boundingBox())!
    expect(e.y + e.height).toBeLessThanOrEqual(first.y + 1)
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

  test('no horizontal overflow at 320, 360, 390, 768 and 1440px (with an error message and More alerts open)', async ({ page }) => {
    const api = await mockNotifyApi(page)
    await openWatchlist(page, { seed: [{ url: BRAVO, down: true, up: true, confirmed: true }] })
    api.mode = '429'
    await alerts(page, ALPHA).click()
    await expect(msg(page, ALPHA)).toHaveText('Too many requests. Try again later.')
    await openMore(page, BRAVO)
    for (const width of [320, 360, 390, 768, 1440]) {
      await resize(page, width, 900)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `page overflow at ${width}px`).toBeLessThanOrEqual(0)
      const out = await page.evaluate(() => [...document.querySelectorAll('.wl-grid .mint-card')].flatMap(row => {
        const c = row.getBoundingClientRect()
        return [...row.querySelectorAll('button, .notify-strip-msg, .notify-more-pills')]
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > c.right + 0.5 || r.left < c.left - 0.5) })
          .map(el => el.className)
      }))
      expect(out, `controls outside their row at ${width}px`).toEqual([])
      // The switch, its label and More alerts share one line.
      const lines = await page.evaluate(() => [...document.querySelectorAll('.notify-strip-row')].map(r => new Set([...r.children].map(b => Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2))).size))
      expect(lines.every(n => n === 1), `alerts on one line at ${width}px`).toBe(true)
    }
  })

  test.describe('touch', () => {
    test.use({ hasTouch: true, isMobile: true })
    test('the switch has a 44px tall hit area (visible height 20px)', async ({ page }) => {
      await mockNotifyApi(page)
      await openWatchlist(page, { size: { width: 1100, height: 900 } })
      const sw = alerts(page, ALPHA)
      await sw.scrollIntoViewIfNeeded()
      const box = (await sw.boundingBox())!
      expect(box.height).toBeCloseTo(20, 0)
      const hits = await sw.evaluate((el, b) => {
        const x = b.x + b.width / 2
        const at = (dy: number) => { const t = document.elementFromPoint(x, b.y + b.height / 2 + dy); return !!t && (t === el || el.contains(t)) }
        return { inside: at(-21) && at(21), outside: at(-25) || at(25) }
      }, box)
      expect(hits.inside, JSON.stringify(hits)).toBe(true)
      expect(hits.outside).toBe(false)
    })
  })

  // Screenshots for review: SHOTS=<dir> npx playwright test e2e/watchlist-notify-toggles.spec.ts -g screenshot
  for (const [width, height] of [[1440, 900], [390, 1200]] as const) {
    test(`screenshot: all states ${width}px`, async ({ page }) => {
      test.skip(!SHOTS, 'set SHOTS=<dir> to write screenshots')
      const api = await mockNotifyApi(page)
      await openWatchlist(page, { size: { width, height }, seed: [
        { url: ALPHA, down: true, up: true, confirmed: true },
        { url: BRAVO, down: true, up: false, confirmed: true },
      ] })
      await layoutReady(page)
      await page.screenshot({ path: `${SHOTS}/notify-after-states-${width}.png`, fullPage: true })
      api.byUrl[DELTA] = '500'
      await alerts(page, DELTA).click()
      await expect(msg(page, DELTA)).not.toBeEmpty()
      api.byUrl[CHARLIE] = 'gate'
      await alerts(page, CHARLIE).click()
      await expect(alerts(page, CHARLIE)).toBeDisabled()
      await layoutReady(page)
      await page.screenshot({ path: `${SHOTS}/notify-after-pending-error-${width}.png`, fullPage: true })
      await api.release()
    })
  }
})
