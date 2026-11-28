import type { Locator, Page } from '@playwright/test'

// Compare modal after the 2026-11-28 redesign (ComparisonModal.tsx): one layout on every width. Mint cards on top
// (`[data-testid="cmp-card"]`, name in `.cx-name-text`, score in `.cx-score[data-row="reliability"]`), then rows
// `.cx-row[data-row=id]` whose `.cx-lbl` sits above one `.cx-val` per mint. Each value starts with the mint's name in an
// `.sr-only` span for screen readers; `cmpValues` leaves it out.

/** The mint names in card order. */
export async function cmpNames(page: Page): Promise<string[]> {
  return (await page.locator('[data-testid="cmp-card"] .cx-name-text').allTextContents()).map(t => t.trim())
}

/** One cell per mint for row `id` ("reliability" is the score on the cards). */
export function cmpCells(page: Page, id: string): Locator {
  return id === 'reliability'
    ? page.locator('[data-testid="cmp-card"] .cx-score[data-row="reliability"]')
    : page.locator(`.cx-val[data-row="${id}"]`)
}

/** The visible text of each mint's cell in row `id`, without the hidden mint name. */
export async function cmpValues(page: Page, id: string): Promise<string[]> {
  return cmpCells(page, id).evaluateAll(els => els.map(e => {
    const c = e.cloneNode(true) as HTMLElement
    c.querySelectorAll('.sr-only').forEach(s => s.remove())
    return (c.textContent ?? '').replace(/\s+/g, ' ').trim()
  }))
}

/** The ids of the rows shown in the section panels, in order (folded panels left out). */
export async function cmpRowIds(page: Page): Promise<string[]> {
  return page.locator('.cx-sections > section .cx-row').evaluateAll(els => els.map(e => e.getAttribute('data-row') ?? ''))
}

/** A row's label text. */
export async function cmpLabel(page: Page, id: string): Promise<string> {
  return ((await page.locator(`.cx-row[data-row="${id}"] .cx-lbl`).first().textContent()) ?? '').trim()
}

/** Opens a folded panel ("How each score is made" or "History"). */
export async function cmpOpenFold(page: Page, summary: 'How each score is made' | 'History'): Promise<void> {
  const s = page.locator('details.cx-fold > summary', { hasText: summary })
  if (!(await s.evaluate(el => (el.parentElement as HTMLDetailsElement).open))) await s.click()
}
