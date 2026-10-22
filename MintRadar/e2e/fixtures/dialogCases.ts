import { expect, type Page, type Locator } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs, MOCK_MINTS, MOCK_KNOWN_MINTS } from './mocks'

// Every modal dialog of the app, as data: how to load its page, what opens it, where the dialog and its close control are.
// Shared by modal-dialog-semantics.spec.ts (roles, focus, Escape, ...) and dialogs-contract.spec.ts (geometry, scroll lock).
// Disclosure panels (account menu, Filters) are deliberately NOT here: they are aria-expanded panels, not modal dialogs.

const ALPHA = MOCK_MINTS[0]!.url
const DETAIL = `/mint/${encodeURIComponent(ALPHA)}`
// Locator helpers: the dialog is found by CSS (not by role) so a modal without a role can still be audited.
const css = (sel: string) => (page: Page) => page.locator(sel)

export interface ModalCase {
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

export const CASES: ModalCase[] = [
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
    id: 'Add a mint modal', name: /add a mint/i,
    prepare: p => goto(p, '/', '.mint-card'),
    trigger: p => p.locator('.submit-btn'), open: clickTrigger,
    dialog: css('.submit-modal'), close: '.submit-modal-close',
  },
  {
    id: 'Add a mint modal (Bulk tab)', name: /add a mint/i,
    prepare: p => goto(p, '/', '.mint-card'),
    trigger: p => p.locator('.submit-btn'),
    open: async (p, t) => {
      await t!.click()
      await p.locator('.submit-tab-btn', { hasText: 'Bulk' }).click()
      await expect(p.locator('.bulk-textarea')).toBeVisible()
    },
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
      popup: p => p.getByText(/Fee per 1000 coins spent/),
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
    // The only trigger is the compact tile .md-sc-reliability, displayed at ≤640px; the desktop sidebar shows the breakdown inline (no modal).
    viewport: { width: 390, height: 844 },
    prepare: p => goto(p, DETAIL, '.md-tabs'),
    trigger: p => p.locator('.md-sc-reliability').locator('visible=true').first(), open: clickTrigger,
    dialog: p => p.getByRole('dialog'), close: 'button[aria-label="Close"]',
  },
  {
    id: 'NUT detail modal (Mint Detail)', name: /\S/,
    prepare: async p => {
      await goto(p, DETAIL, '.md-tabs')
      await p.locator('.md-tab', { hasText: 'NUTs' }).click()
    },
    trigger: p => p.locator('.nut-card').first(), open: clickTrigger,
    dialog: p => p.getByRole('dialog'), close: 'button[aria-label="Close"]',
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
    trigger: p => p.getByRole('button', { name: 'Show details ›' }), open: clickTrigger,
    dialog: css('.nut-modal'), close: '.nut-modal-close',
  },
]

export async function setupPage(page: Page, c: ModalCase) {
  await mockRelays(page)
  await installApiMocks(page)
  if (c.statsMints) await page.route('**/api/mints/known', r => r.fulfill({ json: statsMints() }))
  if (c.login) await loginAs(page, 'peter.bliznak', 'nip07')
  await page.setViewportSize(c.viewport ?? { width: 1440, height: 900 })
  await c.prepare(page)
}

