import { test, expect, type Page, type Locator } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Every modal dialog in the app × the dialog requirements: role="dialog" + aria-modal + accessible
// name, initial focus inside, Tab / Shift+Tab trap, focus restored to the trigger, Escape (an open
// tooltip closes first), outside click, a visible and named close button, and no horizontal overflow
// at 390 / 320px. Disclosure panels (account menu, Filters) are deliberately NOT here: they are
// aria-expanded panels, not modal dialogs (see docs/claude/mobile-and-tooltips.md).
// MODAL_AUDIT=1 prints one JSON line per modal with every cell, for building the pass/fail table.

const ALPHA = MOCK_MINTS[0]!.url
const DETAIL = `/mint/${encodeURIComponent(ALPHA)}`
const CELLS = [
  'role', 'ariaModal', 'name', 'focusIn', 'trap', 'restore', 'escape', 'tooltipEscape', 'outside',
  'closeBtn', 'closeBtnName', 'scrollLock', 'fits390', 'fits320',
] as const
type Cell = (typeof CELLS)[number]
type Result = boolean | null // null = not applicable

// Locator helpers: the dialog is found by CSS (not by role) so a modal without a role can still be audited.
const css = (sel: string) => (page: Page) => page.locator(sel)

interface ModalCase {
  id: string
  /** Expected accessible name. */
  name: RegExp
  /** Session the page needs before it loads. */
  login?: boolean
  /** Stats pages: many mints with distinct locations, so the geo / "other locations" modals exist. */
  statsMints?: boolean
  viewport?: { width: number; height: number }
  /** Loads the page. */
  prepare: (page: Page) => Promise<void>
  /** The control that opens the dialog; null when no control is involved. */
  trigger: ((page: Page) => Locator) | null
  /** Opens the dialog from the closed state (clicks the trigger, plus any follow-up steps). */
  open: (page: Page, trigger: Locator | null) => Promise<void>
  dialog: (page: Page) => Locator
  /** The visible close control inside the dialog; null = the modal has none. */
  close: string | null
  /** An ⓘ tooltip inside the dialog: the element to hover and the popup it opens. */
  tooltip?: { target: (page: Page) => Locator; popup: (page: Page) => Locator }
}

const clickTrigger = async (_p: Page, t: Locator | null) => { await t!.click() }

const statsMints = () => Array.from({ length: 30 }, (_, i) => ({
  ...MOCK_KNOWN_MINTS[0]!,
  url: `https://stats${i}.mint.example`,
  name: `Stats ${i} Mint`,
  online: true,
  serverLocation: `City${String(i).padStart(2, '0')}, DE`,
}))

async function goto(page: Page, url: string, ready: string) {
  await page.goto(url)
  await expect(page.locator(ready).first()).toBeVisible()
}

const CASES: ModalCase[] = [
  {
    id: 'Login modal', name: /connect with nostr/i,
    prepare: p => goto(p, '/', '.mint-card'),
    trigger: p => p.locator('.navbar-login-btn'), open: clickTrigger,
    dialog: css('.nostr-modal'), close: '.nostr-modal-close',
  },
  {
    id: 'Watch-login modal (card)', name: /watch this mint/i,
    prepare: p => goto(p, '/?status=all', '.mint-card'),
    trigger: p => p.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('.card-star'), open: clickTrigger,
    dialog: css('.rv-modal'), close: '.rv-modal-close',
  },
  {
    id: 'Watch-login modal (Mint Detail)', name: /watch this mint/i,
    prepare: p => goto(p, DETAIL, '.md-tabs'),
    trigger: p => p.locator('.md-watch-star-hero').first(), open: clickTrigger,
    dialog: css('.rv-modal'), close: '.rv-modal-close',
  },
  {
    id: 'Review modal (Mint Detail)', name: /write a review/i, login: true,
    prepare: async p => {
      await goto(p, DETAIL, '.md-tabs')
      await p.locator('.md-tab', { hasText: 'Reviews' }).click()
    },
    trigger: p => p.locator('.reviews-write-btn'), open: clickTrigger,
    dialog: css('.rv-modal'), close: '.rv-modal-close',
  },
  {
    id: 'Submit a mint modal', name: /submit a mint/i,
    prepare: p => goto(p, '/', '.mint-card'),
    trigger: p => p.locator('.submit-btn'), open: clickTrigger,
    dialog: css('.submit-modal'), close: '.submit-modal-close',
  },
  {
    id: 'Compare picker', name: /compare/i,
    prepare: p => goto(p, '/?status=all', '.mint-card'),
    trigger: p => p.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn'), open: clickTrigger,
    dialog: css('.md-picker-modal'), close: '.md-picker-header button',
  },
  {
    id: 'Comparison modal', name: /mint comparison/i,
    prepare: p => goto(p, '/?status=all', '.mint-card'),
    trigger: p => p.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn'),
    open: async (p, t) => {
      await t!.click()
      await p.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
      await p.locator('.md-picker-confirm').click()
    },
    dialog: css('.cmp-modal'), close: '.cmp-modal-header button',
    tooltip: {
      target: p => p.locator('.cmp-modal .cmp-lbl', { hasText: 'Input fee' }).locator('svg').first(),
      popup: p => p.getByText(/Input fee per 1000 proofs/),
    },
  },
  {
    id: 'Mint QR modal', name: /wallet|qr/i,
    prepare: p => goto(p, DETAIL, '.md-tabs'),
    trigger: p => p.locator('.md-quick-btn', { hasText: 'Mint QR' }), open: clickTrigger,
    dialog: css('.qr-modal'), close: '.qr-modal-header button',
  },
  {
    id: 'Reliability breakdown (Mint Detail)', name: /reliability score breakdown/i,
    prepare: p => goto(p, DETAIL, '.md-tabs'),
    trigger: p => p.locator('.md-sc-reliability').locator('visible=true').first(), open: clickTrigger,
    dialog: p => p.getByRole('dialog'), close: 'button:text-is("×")',
  },
  {
    id: 'NUT detail modal (Mint Detail)', name: /\S/,
    prepare: async p => {
      await goto(p, DETAIL, '.md-tabs')
      await p.locator('.md-tab', { hasText: 'NUTs' }).click()
    },
    trigger: p => p.locator('.nut-card').first(), open: clickTrigger,
    dialog: p => p.getByRole('dialog'), close: 'button:text-is("×")',
  },
  {
    id: 'Stats: software versions', name: /nutshell/i, statsMints: true,
    prepare: p => goto(p, '/stats', '.sw-row'),
    trigger: p => p.locator('.sw-row', { hasText: 'Nutshell' }), open: clickTrigger,
    dialog: css('.nut-modal'), close: '.nut-modal-close',
  },
  {
    id: 'Stats: NUT coverage', name: /nut-09/i, statsMints: true,
    prepare: p => goto(p, '/stats', '.stats-nut-row'),
    trigger: p => p.locator('.stats-nut-row', { hasText: 'NUT-09' }), open: clickTrigger,
    dialog: css('.nut-modal'), close: '.nut-modal-close',
  },
  {
    id: 'Stats: location mints', name: /city00/i, statsMints: true,
    prepare: p => goto(p, '/stats', '.dist-row-clickable'),
    trigger: p => p.locator('.dist-row-clickable', { hasText: 'City00' }), open: clickTrigger,
    dialog: css('.nut-modal'), close: '.nut-modal-close',
  },
  {
    id: 'Stats: other locations', name: /other locations/i, statsMints: true,
    prepare: p => goto(p, '/stats', '.dist-more-row'),
    trigger: p => p.locator('.dist-more-row', { hasText: 'View others' }), open: clickTrigger,
    dialog: css('.nut-modal'), close: '.nut-modal-close',
  },
  {
    id: 'Stats: Network Health breakdown (mobile)', name: /network health index/i, statsMints: true,
    viewport: { width: 390, height: 844 },
    prepare: p => goto(p, '/stats', '.stats-panel'),
    trigger: p => p.getByRole('button', { name: 'Details ›' }), open: clickTrigger,
    dialog: css('.nut-modal'), close: '.nut-modal-close',
  },
]

async function setupPage(page: Page, c: ModalCase) {
  await mockRelays(page)
  await installApiMocks(page)
  if (c.statsMints) await page.route('**/api/mints/known', r => r.fulfill({ json: statsMints() }))
  if (c.login) await loginAs(page, 'peter.bliznak', 'nip07')
  await page.setViewportSize(c.viewport ?? { width: 1440, height: 900 })
  await c.prepare(page)
}

const inside = (dlg: Locator) => dlg.evaluate(d => d.contains(document.activeElement) && document.activeElement !== document.body)

async function measure(page: Page, c: ModalCase): Promise<Record<Cell, Result>> {
  const r = {} as Record<Cell, Result>
  await setupPage(page, c)
  const trigger = c.trigger ? c.trigger(page) : null
  const triggerFocusable = trigger ? await trigger.evaluate(el => (el as HTMLElement).tabIndex >= 0) : false
  const dlg = c.dialog(page)
  const openIt = async () => {
    if (trigger && triggerFocusable) await trigger.focus()
    await c.open(page, trigger)
    await expect(dlg).toBeVisible()
  }

  await openIt()
  const attrs = await dlg.evaluate(d => {
    const labelledby = d.getAttribute('aria-labelledby')
    const named = labelledby ? labelledby.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ') : ''
    return { role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), label: (d.getAttribute('aria-label') ?? named).trim() }
  })
  r.role = attrs.role === 'dialog' || attrs.role === 'alertdialog'
  r.ariaModal = attrs.modal === 'true'
  r.name = c.name.test(attrs.label)

  r.focusIn = await expect.poll(() => inside(dlg), { timeout: 1500 }).toBe(true).then(() => true, () => false)

  // Trap: more Tab / Shift+Tab presses than the dialog has controls — focus must never leave it.
  const stops = await dlg.evaluate(d => d.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length)
  const presses = Math.min(stops + 3, 30)
  let trapped = true
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(key)
      if (!(await inside(dlg))) { trapped = false; break }
    }
  }
  r.trap = trapped

  // Close button: visible, inside the dialog, and named "Close".
  const closeBtn = c.close ? dlg.locator(c.close).first() : null
  r.closeBtn = closeBtn ? await closeBtn.isVisible() : false
  r.closeBtnName = closeBtn && r.closeBtn
    ? /close/i.test(await closeBtn.evaluate(b => b.getAttribute('aria-label') ?? b.getAttribute('title') ?? ''))
    : false

  // Page behind: scroll-locked (or inert). Informational — the dialogs rely on aria-modal + the overlay.
  r.scrollLock = await page.evaluate(() => {
    const hidden = (el: Element) => getComputedStyle(el).overflow === 'hidden' || getComputedStyle(el).overflowY === 'hidden'
    return hidden(document.body) || hidden(document.documentElement) || !!document.querySelector('#root[inert], body > [inert]')
  })

  // Escape: an open tooltip closes first and leaves the dialog; the next Escape closes the dialog.
  if (c.tooltip) {
    await c.tooltip.target(page).hover()
    const tip = c.tooltip.popup(page)
    const opened = await expect(tip).toBeVisible({ timeout: 1500 }).then(() => true, () => false)
    await page.keyboard.press('Escape')
    const tipGone = (await tip.count()) === 0
    r.tooltipEscape = opened && tipGone && (await dlg.isVisible())
    await page.mouse.move(0, 0)
  } else {
    r.tooltipEscape = null
  }
  await page.keyboard.press('Escape')
  r.escape = await expect(dlg).toHaveCount(0, { timeout: 1500 }).then(() => true, () => false)
  r.restore = trigger && triggerFocusable
    ? await expect(trigger).toBeFocused({ timeout: 1500 }).then(() => true, () => false)
    : null

  // Outside click (reopen from the closed state).
  await openIt().catch(() => undefined)
  await dlg.locator('xpath=..').click({ position: { x: 4, y: 4 } }).catch(() => undefined)
  r.outside = await expect(dlg).toHaveCount(0, { timeout: 1500 }).then(() => true, () => false)
  if (!r.outside) await page.keyboard.press('Escape')

  // 390px and 320px: dialog and close button inside the viewport, page does not scroll sideways.
  for (const width of [390, 320] as const) {
    await page.setViewportSize({ width, height: 844 })
    await openIt().catch(() => undefined)
    const box = await dlg.boundingBox().catch(() => null)
    const closeBox = closeBtn ? await closeBtn.boundingBox().catch(() => null) : null
    const noSideScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    r[width === 390 ? 'fits390' : 'fits320'] = box !== null && noSideScroll && box.x >= -0.5 && box.x + box.width <= width + 0.5
      && (!closeBtn || (closeBox !== null && closeBox.x >= 0 && closeBox.x + closeBox.width <= width + 0.5))
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0, { timeout: 1500 }).catch(() => undefined)
  }
  return r
}

const mark = (v: Result) => (v === null ? 'n/a' : v ? 'pass' : 'FAIL')

for (const c of CASES) {
  test(`dialog requirements: ${c.id}`, async ({ page }) => {
    const cells = await measure(page, c)
    if (process.env.MODAL_AUDIT) console.log('AUDIT ' + JSON.stringify({ id: c.id, cells }))
    for (const cell of CELLS) {
      if (cell === 'scrollLock') continue // informational
      expect.soft(cells[cell], `${c.id} · ${cell}: ${mark(cells[cell])}`).not.toBe(false)
    }
  })
}
