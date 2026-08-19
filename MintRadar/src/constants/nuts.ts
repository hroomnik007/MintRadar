// Single source of truth for the list of Cashu NUTs this app tracks, and their
// display metadata.
//
// Previously duplicated in four places — MintDetail.tsx (ALL_NUTS), Stats.tsx
// (NUT_ORDER + its own NUT_META), ComparisonModal.tsx (NUT_FILTER_KEYS) and
// NutExplorer.tsx (NUT_META) — which meant adding a NUT to the app took four
// coordinated edits and the copies had already drifted in wording.

export interface NutMeta {
  /** Short label shown on cards and rows. */
  short: string
  /** One-sentence description. */
  desc: string
  /** Zero-padded spec number, used to build the cashubtc/nuts spec link. */
  specNum: string
}

/**
 * Every optional NUT the app tracks, in canonical order.
 *
 * Mandatory NUTs (00-03, 06) are deliberately excluded — every mint implements
 * them, so tracking them carries zero information. NUT-13 (deterministic
 * secrets) is excluded too: it is a wallet-side spec that a mint never
 * advertises in /v1/info, so it would be structurally stuck at 0% forever.
 *
 * This list's length is the denominator of the Trust Score's NUT-support
 * component — keep it equal to TRACKED_NUT_COUNT in src/utils/trustScore.ts.
 */
export const TRACKED_NUTS: string[] = [
  'NUT-04', 'NUT-05', 'NUT-07', 'NUT-08', 'NUT-09', 'NUT-10', 'NUT-11',
  'NUT-12', 'NUT-14', 'NUT-15', 'NUT-16', 'NUT-17', 'NUT-18', 'NUT-19',
  'NUT-20', 'NUT-21', 'NUT-22', 'NUT-23', 'NUT-24', 'NUT-25', 'NUT-26',
  'NUT-27', 'NUT-28', 'NUT-29', 'NUT-30',
]

/**
 * Numeric keys of TRACKED_NUTS ('NUT-04' → '4'), matching how a mint's
 * /v1/info `nuts` object and the stored `nuts_limits` column are keyed.
 */
export const TRACKED_NUT_KEYS: string[] = TRACKED_NUTS.map(
  nut => String(parseInt(nut.slice(4), 10))
)

/** Display metadata per NUT. */
export const NUT_META: Record<string, NutMeta> = {
  'NUT-04': { short: 'Mint tokens', desc: 'Minting new Cashu tokens against a Lightning invoice.', specNum: '04' },
  'NUT-05': { short: 'Melt tokens', desc: 'Melting Cashu tokens to pay a Lightning invoice.', specNum: '05' },
  'NUT-07': { short: 'Token state', desc: 'Checking whether a proof has been spent or is still valid.', specNum: '07' },
  'NUT-08': { short: 'Overpay melt', desc: 'Overpaying melt fees and receiving change tokens back.', specNum: '08' },
  'NUT-09': { short: 'Restore', desc: 'Restoring blinded signatures from mint backup data.', specNum: '09' },
  'NUT-10': { short: 'Spending conditions', desc: 'Spending conditions that must be met to use a proof.', specNum: '10' },
  'NUT-11': { short: 'Pay-to-PK', desc: 'Lock tokens to a specific public key for secure transfers.', specNum: '11' },
  'NUT-12': { short: 'DLEQ proofs', desc: 'Discrete Log Equality proofs for verifiable blind signatures.', specNum: '12' },
  'NUT-14': { short: 'HTLCs', desc: 'Hash Time Locked Contracts for atomic swaps.', specNum: '14' },
  'NUT-15': { short: 'Multi-mint MPP', desc: 'Split a single Lightning payment across multiple mints simultaneously.', specNum: '15' },
  'NUT-16': { short: 'Animated QR', desc: 'Animated QR codes for transferring large tokens between devices.', specNum: '16' },
  'NUT-17': { short: 'WebSocket', desc: 'Real-time mint updates via WebSocket subscription.', specNum: '17' },
  'NUT-18': { short: 'Payment req.', desc: 'Structured payment requests so wallets can pay a requested amount.', specNum: '18' },
  'NUT-19': { short: 'Cached responses', desc: 'Mints cache successful responses so wallets can replay after a network error.', specNum: '19' },
  'NUT-20': { short: 'Mint quote sig', desc: 'Mint signs quote requests for authenticity.', specNum: '20' },
  'NUT-21': { short: 'Clear auth', desc: 'Clear-text (OAuth/OpenID) authentication for protected mint endpoints.', specNum: '21' },
  'NUT-22': { short: 'Blind auth', desc: 'Blind authentication tokens for privacy-preserving mint access.', specNum: '22' },
  'NUT-23': { short: 'BOLT11', desc: 'BOLT11 Lightning invoices as a payment method for mint and melt.', specNum: '23' },
  'NUT-24': { short: 'HTTP 402', desc: 'HTTP 402 Payment Required flow for paywalled resources using Cashu.', specNum: '24' },
  'NUT-25': { short: 'BOLT12', desc: 'BOLT12 offers as a payment method for mint and melt.', specNum: '25' },
  'NUT-26': { short: 'Bech32m req.', desc: 'Bech32m encoding for Cashu payment requests.', specNum: '26' },
  'NUT-27': { short: 'Nostr backup', desc: 'Backing up wallet state to Nostr relays for cross-device recovery.', specNum: '27' },
  'NUT-28': { short: 'Pay-to-BK', desc: 'Lock tokens to a blinded public key for enhanced recipient privacy.', specNum: '28' },
  'NUT-29': { short: 'Batched minting', desc: 'Wallets can mint tokens for multiple quotes in a single atomic request.', specNum: '29' },
  'NUT-30': { short: 'Onchain', desc: 'On-chain Bitcoin as a payment method for mint and melt.', specNum: '30' },
}

/** cashubtc/nuts spec URL for a tracked NUT, or null if it isn't tracked. */
export function nutSpecUrl(nut: string): string | null {
  const meta = NUT_META[nut]
  return meta ? `https://github.com/cashubtc/nuts/blob/main/${meta.specNum}.md` : null
}
