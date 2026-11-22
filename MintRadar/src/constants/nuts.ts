// Single source of truth for the list of Cashu NUTs this app tracks, and their
// display metadata.

export interface NutMeta {
  /** Short label shown on cards and rows. */
  short: string
  /** One-sentence description. */
  desc: string
  /** Zero-padded spec number, used to build the cashubtc/nuts spec link. */
  specNum: string
}

/**
 * Every mint-side NUT the app tracks for the Reliability Score / NUT-support
 * denominator, in canonical (ascending) order.
 *
 * Mandatory NUTs (00-03, 06) are deliberately excluded — every mint implements
 * them, so tracking them carries zero information.
 *
 * Wallet-only NUTs are excluded — a mint never advertises these in /v1/info,
 * so they'd be structurally stuck at 0% forever: NUT-13 (deterministic
 * secrets), NUT-16 (animated QR), NUT-18 (payment requests), NUT-24 (HTTP 402
 * Payment Required — a generic HTTP layer, not a cashu-mint capability),
 * NUT-26 (Bech32m payment request encoding), NUT-27 (Nostr mint backup),
 * NUT-28 (Pay-to-Blinded-Key — the mint "remains unaware of the blinding").
 *
 * Also excluded from this list (but NOT hidden from the app — they're real
 * mint-side features, just not part of the NUT-support score):
 * - NUT-21/22 (clear/blind authentication) — an access-control mechanism, not
 *   a token capability; shown as an auth badge where present.
 * - NUT-23/25/30 (BOLT11/BOLT12/onchain payment methods) — these extend
 *   NUT-04/05 rather than being standalone features; shown in the Units &
 *   Methods panel instead.
 *
 * This list's length is the denominator of the Reliability Score's NUT-support
 * component — keep it equal to TRACKED_NUT_COUNT in src/utils/reliabilityScore.ts
 * (and its backend twin, backend/src/shared/reliabilityScore.ts).
 */
export const TRACKED_NUTS: string[] = [
  'NUT-04', 'NUT-05', 'NUT-07', 'NUT-08', 'NUT-09', 'NUT-10', 'NUT-11',
  'NUT-12', 'NUT-14', 'NUT-15', 'NUT-17', 'NUT-19', 'NUT-20', 'NUT-29',
]

/**
 * Numeric keys of TRACKED_NUTS ('NUT-04' → '4'), matching how a mint's
 * /v1/info `nuts` object and the stored `nuts_limits` column are keyed.
 */
export const TRACKED_NUT_KEYS: string[] = TRACKED_NUTS.map(
  nut => String(parseInt(nut.slice(4), 10))
)

/**
 * One plain name per tracked NUT (D4, UI/UX report 2026-11-22): Stats, the NUT dialogs, the For wallets request builder and
 * the Mint Detail NUTs tab all read it, so the same NUT never has two names (it was "Pay-to-PK" on Stats and "Pay to public
 * key" on the NUTs tab). The names are the NUTs tab's (2026-11-19 redesign, phase 4d).
 */
export const NUT_NAMES: Readonly<Record<string, string>> = {
  'NUT-04': 'Mint tokens',
  'NUT-05': 'Melt tokens',
  'NUT-07': 'Token state',
  'NUT-08': 'Overpay refund',
  'NUT-09': 'Restore',
  'NUT-10': 'Spending conditions',
  'NUT-11': 'Pay to public key',
  'NUT-12': 'DLEQ proofs',
  'NUT-14': 'Hash locks',
  'NUT-15': 'Multi-mint payments',
  'NUT-17': 'Live updates',
  'NUT-19': 'Safe retries',
  'NUT-20': 'Signed mint quotes',
  'NUT-29': 'Batched minting',
}

/** Display metadata per NUT. */
export const NUT_META: Record<string, NutMeta> = {
  'NUT-04': { short: NUT_NAMES['NUT-04']!, desc: 'Minting new Cashu tokens against a Lightning invoice.', specNum: '04' },
  'NUT-05': { short: NUT_NAMES['NUT-05']!, desc: 'Melting Cashu tokens to pay a Lightning invoice.', specNum: '05' },
  'NUT-07': { short: NUT_NAMES['NUT-07']!, desc: 'Checking whether a coin has been spent or is still valid.', specNum: '07' },
  'NUT-08': { short: NUT_NAMES['NUT-08']!, desc: 'Overpaying melt fees and receiving change tokens back.', specNum: '08' },
  'NUT-09': { short: NUT_NAMES['NUT-09']!, desc: 'Restoring blinded signatures from mint backup data.', specNum: '09' },
  'NUT-10': { short: NUT_NAMES['NUT-10']!, desc: 'Spending conditions that must be met to use a coin.', specNum: '10' },
  'NUT-11': { short: NUT_NAMES['NUT-11']!, desc: 'Lock tokens to a specific public key for secure transfers.', specNum: '11' },
  'NUT-12': { short: NUT_NAMES['NUT-12']!, desc: 'Discrete Log Equality proofs for verifiable blind signatures.', specNum: '12' },
  'NUT-14': { short: NUT_NAMES['NUT-14']!, desc: 'Hash Time Locked Contracts for atomic swaps.', specNum: '14' },
  'NUT-15': { short: NUT_NAMES['NUT-15']!, desc: 'Split a single Lightning payment across multiple mints simultaneously.', specNum: '15' },
  'NUT-17': { short: NUT_NAMES['NUT-17']!, desc: 'Real-time mint updates via WebSocket subscription.', specNum: '17' },
  'NUT-19': { short: NUT_NAMES['NUT-19']!, desc: 'Mints cache successful responses so wallets can replay after a network error.', specNum: '19' },
  'NUT-20': { short: NUT_NAMES['NUT-20']!, desc: 'Mint signs quote requests for authenticity.', specNum: '20' },
  'NUT-29': { short: NUT_NAMES['NUT-29']!, desc: 'Wallets can mint tokens for multiple quotes in a single atomic request.', specNum: '29' },
}

/** cashubtc/nuts spec URL for a tracked NUT, or null if it isn't tracked. */
export function nutSpecUrl(nut: string): string | null {
  const meta = NUT_META[nut]
  return meta ? `https://github.com/cashubtc/nuts/blob/main/${meta.specNum}.md` : null
}
