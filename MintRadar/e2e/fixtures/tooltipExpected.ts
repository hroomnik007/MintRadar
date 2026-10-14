import { TOOLTIP_STATES, VIEWPORTS } from './tooltipStates'

// What tooltips-contract.spec.ts must find in every state, per viewport. Without this a state that LOSES all its
// tooltips (or whose triggers can no longer be reached) would pass silently: the contract only checks the triggers it
// finds. Each entry is [triggers, opened] for the viewports 320, 390, 768, 1024, 1440 (VIEWPORTS order):
//   triggers = visible [data-tooltip-trigger] elements in the state (a MINIMUM: a new tooltip does not fail the spec),
//   opened   = distinct triggers that were hovered / tapped, at most 8 per state (MAX_OPENED_PER_STATE), a MINIMUM too.
//   null     = the state does not exist at this viewport (its run() resolves false) and must keep not existing.
// Derived from a full run on 2026-10-14 (same numbers for the mouse and the touch pointer). To change a number:
// run the spec, read the failure message, and say in the commit why the page gained or lost a tooltip.
// A state with 0 triggers is deliberate and says why.
type Cell = [triggers: number, opened: number] | null
const same = (c: Cell): Cell[] => [c, c, c, c, c]

export const EXPECTED_TOOLTIPS: Record<string, Cell[]> = {
  home: same([4, 3]),
  'home-filters': same([5, 4]),
  'home-filters-hidetest': same([5, 4]),
  // 0: the notification strip's explanations are visible text since 2026-10-14 (tooltip-promoted-lines.spec.ts); the cards carry no ⓘ.
  'watchlist-3-notify': same([0, 0]),
  // The outdated-software ⓘ is the only one below 1024 px; the wide layout adds the Network Health Index rows.
  stats: [[1, 1], [1, 1], [1, 1], [6, 6], [6, 6]],
  // 0 opened: a modal covers the page, its own content (software list) has no ⓘ, the page's triggers are behind the overlay.
  'stats-software-modal': [[1, 0], [1, 0], [1, 0], [6, 0], [6, 0]],
  // The Network Health Index dialog is reachable at 768 px and below only (run() resolves false above).
  'stats-nhi-dialog': [[6, 5], [6, 5], [6, 5], null, null],
  // 0: the Tools page has explanatory text only; tooltips appear on a token RESULT (next state).
  tools: same([0, 0]),
  'tools-token-test-mint': same([2, 2]),
  // 0 on the content pages: their explanations are visible text (the pages hold no InfoTooltip).
  wallets: same([0, 0]),
  learn: same([0, 0]),
  'learn-module': same([0, 0]),
  about: same([0, 0]),
  methodology: same([0, 0]),
  'for-wallets': same([0, 0]),
  nuts: same([0, 0]),
  'mint-alpha-overview': [[3, 3], [3, 3], [8, 8], [8, 8], [8, 8]],
  'mint-alpha-history': [[2, 2], [2, 2], [7, 7], [7, 7], [7, 7]],
  'mint-alpha-nuts': [[3, 3], [3, 3], [8, 8], [8, 8], [8, 8]],
  'mint-alpha-audit': [[7, 7], [7, 7], [12, 8], [12, 8], [12, 8]],
  'mint-alpha-audit-cz': [[7, 7], [7, 7], [12, 8], [12, 8], [12, 8]],
  'mint-alpha-audit-8333': [[7, 7], [7, 7], [12, 8], [12, 8], [12, 8]],
  'mint-alpha-reviews': [[3, 3], [3, 3], [8, 8], [8, 8], [8, 8]],
  // The Reliability Score dialog is reachable below 768 px only (run() resolves false above).
  'mint-alpha-score-dialog': [[8, 5], [8, 5], null, null, null],
  'mint-offline-overview': [[2, 2], [2, 2], [7, 7], [7, 7], [7, 7]],
  'mint-test-overview': [[2, 2], [2, 2], [7, 7], [7, 7], [7, 7]],
  'mint-test-audit': [[7, 7], [7, 7], [12, 8], [12, 8], [12, 8]],
  'mint-new-overview': [[2, 2], [2, 2], [7, 7], [7, 7], [7, 7]],
  'mint-new-nuts': [[3, 3], [3, 3], [8, 8], [8, 8], [8, 8]],
  'mint-operator-overview': [[2, 2], [2, 2], [7, 7], [7, 7], [7, 7]],
  'mint-operator-reviews': [[3, 3], [3, 3], [8, 8], [8, 8], [8, 8]],
  'compare-modal': same([7, 3]),
  // 0 opened: the Submit dialog has no ⓘ of its own; the page's four triggers sit behind its overlay.
  'submit-modal': same([4, 0]),
  // 0 opened: same for the login dialog.
  'login-modal': same([4, 0]),
}

/** The expected cell of a state at a viewport width (throws when the table has no row: a new state needs one). */
export function expectedTooltips(stateId: string, width: number): Cell {
  const row = EXPECTED_TOOLTIPS[stateId]
  if (!row) throw new Error(`tooltipExpected.ts has no row for the state "${stateId}"`)
  const i = VIEWPORTS.findIndex(v => v.width === width)
  if (i < 0) throw new Error(`unknown viewport width ${width}`)
  return row[i]!
}

/** Every state has a row and every row names a state (a renamed state must not leave a stale expectation behind). */
export function expectedTableProblems(): string[] {
  const ids = new Set(TOOLTIP_STATES.map(s => s.id))
  return [
    ...[...ids].filter(id => !(id in EXPECTED_TOOLTIPS)).map(id => `no expectation for state "${id}"`),
    ...Object.keys(EXPECTED_TOOLTIPS).filter(id => !ids.has(id)).map(id => `expectation for unknown state "${id}"`),
  ]
}
