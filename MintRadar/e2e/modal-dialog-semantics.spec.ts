import { test, expect, type Page, type Locator } from '@playwright/test'
import { CASES, setupPage, type ModalCase } from './fixtures/dialogCases'

// Every modal dialog in the app × the dialog requirements: role="dialog" + aria-modal + accessible
// name, initial focus inside, Tab / Shift+Tab trap, focus restored to the trigger, Escape (an open
// tooltip closes first), outside click, a visible and named close button, and no horizontal overflow
// at 390 / 320px. Disclosure panels (account menu, Filters) are deliberately NOT here: they are
// aria-expanded panels, not modal dialogs (see docs/claude/mobile-and-tooltips.md).
// MODAL_AUDIT=1 prints one JSON line per modal with every cell, for building the pass/fail table.

const CELLS = [
  'role', 'ariaModal', 'name', 'focusIn', 'trap', 'restore', 'escape', 'tooltipEscape', 'outside',
  'closeBtn', 'closeBtnName', 'scrollLock', 'fits390', 'fits320',
] as const
type Cell = (typeof CELLS)[number]
type Result = boolean | null // null = not applicable


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
  // Tabbing through the dialog may have stopped on a tooltip trigger (keyboard focus opens its tooltip); that
  // tooltip takes the first Escape (see tooltip-escape.spec.ts), so close it before testing the dialog's own Escape.
  if ((await page.getByRole('tooltip').count()) > 0) await page.keyboard.press('Escape')

  // Close button: visible, inside the dialog, and named "Close".
  const closeBtn = c.close ? dlg.locator(c.close).first() : null
  r.closeBtn = closeBtn ? await closeBtn.isVisible() : false
  r.closeBtnName = closeBtn && r.closeBtn
    ? /close/i.test(await closeBtn.evaluate(b => b.getAttribute('aria-label') ?? b.getAttribute('title') ?? ''))
    : false

  // Page behind: scroll-locked (useModalFocus) or inert.
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
      expect.soft(cells[cell], `${c.id} · ${cell}: ${mark(cells[cell])}`).not.toBe(false)
    }
  })
}
