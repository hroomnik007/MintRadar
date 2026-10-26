// NUT data shared by the Mint Detail NUTs tab (NutsTab) and the NUT detail modal in MintDetail.tsx.
// Moved verbatim out of MintDetail.tsx (pure refactor, no wording change).

export interface NutMethod {
  method: string
  unit: string
  min_amount?: number
  max_amount?: number
}

export interface NutConfig {
  disabled?: boolean
  methods?: NutMethod[]
}

export const NUT_DESCRIPTIONS: Record<string, { short: string; desc: string; features: string[]; useCase: string }> = {
  'NUT-00': { short: 'Notation & crypto', desc: 'Cryptographic notation and the blind Diffie-Hellman key exchange (BDHKE) scheme underlying every Cashu operation.', features: ['Blind signatures (BDHKE)', 'Protocol notation', 'hash_to_curve mapping'], useCase: 'Defines the cryptographic foundation every other NUT builds on.' },
  'NUT-01': { short: 'Mint keys', desc: 'Retrieving public keys from the mint for each amount.', features: ['Amount-specific keypairs', 'Key retrieval API', 'Key validation'], useCase: 'Clients use mint keys to verify token signatures.' },
  'NUT-02': { short: 'Keysets & fees', desc: 'Keysets (grouped mint public keys with rotation) and the per-coin fee charged when spending a coin from them.', features: ['Keyset IDs', 'Active/inactive rotation', 'Per-input fees (input_fee_ppk)'], useCase: 'Allows mints to rotate keys, support multiple currencies, and charge spending fees.' },
  'NUT-03': { short: 'Swap', desc: 'Swapping coins for new ones of equal value.', features: ['Coin exchange', 'Change splitting', 'Privacy improvement'], useCase: 'Core operation for splitting and combining tokens.' },
  'NUT-04': { short: 'Mint tokens', desc: 'Minting new Cashu tokens against a Lightning invoice.', features: ['Lightning invoice creation', 'Token issuance', 'Amount verification'], useCase: 'Entry point for getting Cashu tokens from Lightning.' },
  'NUT-05': { short: 'Melt tokens', desc: 'Melting Cashu tokens to pay a Lightning invoice.', features: ['Invoice payment', 'Fee estimation', 'Change return'], useCase: 'Exit point for spending Cashu tokens via Lightning.' },
  'NUT-06': { short: 'Mint info', desc: 'Retrieving mint metadata, capabilities and contact info.', features: ['Version info', 'Supported NUTs', 'Contact details', 'MOTD'], useCase: 'Clients discover mint capabilities before interacting.' },
  'NUT-07': { short: 'Token state', desc: 'Checking whether a coin has been spent or is still valid.', features: ['Spent coin detection', 'Pending state', 'Batch checking'], useCase: 'Verify token validity without redeeming it.' },
  'NUT-08': { short: 'Overpay melt', desc: 'Overpaying melt fees and receiving change back.', features: ['Fee overpayment', 'Change tokens', 'Fee estimation'], useCase: 'Handle variable Lightning routing fees gracefully.' },
  'NUT-09': { short: 'Restore', desc: 'Restoring blinded signatures from mint backup data.', features: ['Signature restoration', 'Backup validation', 'Deterministic secrets'], useCase: 'Recover tokens from backup without double-spend risk.' },
  'NUT-10': { short: 'Spending cond.', desc: 'Spending conditions that must be met to use a coin.', features: ['Conditional spending', 'Script conditions', 'Extensible'], useCase: 'Base for advanced features like P2PK and HTLCs.' },
  'NUT-11': { short: 'Pay-to-PK', desc: 'Lock tokens to a specific public key for secure transfers.', features: ['Public key locking', 'Signature verification', 'Selective unlock'], useCase: 'Send tokens that only a specific recipient can spend.' },
  'NUT-12': { short: 'DLEQ proofs', desc: 'Discrete Log Equality proofs for verifiable blind signatures.', features: ['Cryptographic proofs', 'Signature verification', 'Privacy preserving'], useCase: 'Clients verify mint honesty without revealing token data.' },
  'NUT-14': { short: 'HTLCs', desc: 'Hash Time Locked Contracts for atomic swaps.', features: ['Hash preimage', 'Timelock expiry', 'Atomic swaps'], useCase: 'Enable trustless cross-mint or cross-chain swaps.' },
  'NUT-15': { short: 'Multi-mint MPP', desc: 'Split a single Lightning payment across multiple mints simultaneously, so wallets can pay one invoice using balances from several mints at once.', features: ['Multi-mint payments', 'Amount splitting', 'Atomic all-or-nothing'], useCase: 'Pay a large invoice by combining balances from multiple mints in one atomic payment.' },
  'NUT-16': { short: 'Animated QR', desc: 'Animated QR codes for transferring large tokens between devices.', features: ['Chunked QR frames', 'Large token transfer', 'Offline transfer'], useCase: 'Move big tokens between devices when no network is available.' },
  'NUT-17': { short: 'WebSocket', desc: 'Real-time mint updates via WebSocket subscription.', features: ['Live updates', 'Event subscription', 'Low latency'], useCase: 'Receive instant confirmation without polling.' },
  'NUT-18': { short: 'Payment req.', desc: 'Structured payment requests so wallets can pay a requested amount.', features: ['Structured requests', 'Amount + mint hints', 'Wallet interop'], useCase: 'Let a payee encode exactly what they want to be paid.' },
  'NUT-19': { short: 'Cached responses', desc: 'Mints cache successful responses for critical operations so wallets can replay after a network error.', features: ['Response caching', 'Network recovery', 'Idempotent replay'], useCase: 'Prevents loss of funds when a network interruption occurs during mint/swap/melt.' },
  'NUT-20': { short: 'Mint quote sig', desc: 'Mint signs quote requests for authenticity.', features: ['Quote signatures', 'Request authentication', 'Replay protection'], useCase: 'Prevent quote tampering between client and mint.' },
  'NUT-21': { short: 'Clear auth', desc: 'Clear-text (OAuth/OpenID) authentication for protected mint endpoints.', features: ['OAuth / OpenID', 'Access tokens', 'Protected endpoints'], useCase: 'Restrict mint access to authenticated users.' },
  'NUT-22': { short: 'Blind auth', desc: 'Blind authentication tokens for privacy-preserving mint access.', features: ['Blind auth tokens', 'Unlinkable access', 'Rate limiting'], useCase: 'Authenticate to a mint without revealing your identity.' },
  'NUT-23': { short: 'BOLT11', desc: 'BOLT11 Lightning invoices as a payment method for mint and melt.', features: ['Lightning invoices', 'Mint & melt method', 'Standard payments'], useCase: 'Fund and spend tokens via ordinary Lightning invoices.' },
  'NUT-24': { short: 'HTTP 402', desc: 'HTTP 402 Payment Required flow for paywalled resources using Cashu.', features: ['402 paywall flow', 'Machine payments', 'Resource access'], useCase: 'Pay for web resources programmatically with Cashu tokens.' },
  'NUT-25': { short: 'BOLT12', desc: 'BOLT12 offers as a payment method for mint and melt.', features: ['BOLT12 offers', 'Reusable payment codes', 'Mint & melt method'], useCase: 'Use reusable Lightning offers instead of single-use invoices.' },
  'NUT-26': { short: 'Bech32m req.', desc: 'Bech32m encoding for Cashu payment requests.', features: ['Bech32m encoding', 'Compact requests', 'Error detection'], useCase: 'Share payment requests as short, typo-resistant strings.' },
  'NUT-27': { short: 'Nostr backup', desc: 'Backing up wallet state to Nostr relays for cross-device recovery.', features: ['Nostr relay backup', 'Cross-device sync', 'Encrypted state'], useCase: 'Restore a wallet from Nostr on a new device.' },
  'NUT-28': { short: 'Pay-to-BK', desc: 'Lock tokens to a blinded public key for enhanced recipient privacy.', features: ['Blinded key lock', 'Recipient privacy', 'Selective unlock'], useCase: 'Send tokens to a recipient without exposing their public key.' },
  'NUT-29': { short: 'Batched minting', desc: 'Wallets can mint tokens for multiple quotes in a single atomic request.', features: ['Multi-quote batch', 'Atomic operation', 'Efficiency'], useCase: 'Reduces round-trips when minting from multiple paid invoices at once.' },
  'NUT-30': { short: 'Onchain', desc: 'On-chain Bitcoin as a payment method for mint and melt.', features: ['On-chain Bitcoin', 'Mint & melt method', 'Chain settlement'], useCase: 'Fund or redeem tokens directly with on-chain Bitcoin.' },
}
