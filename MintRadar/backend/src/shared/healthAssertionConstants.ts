// Public facts about the signed health assertions (Nostr kind 30385) that the /for-wallets page shows and the
// publisher produces. PURE, no imports: the backend and the frontend each carry a byte-identical copy
// (backend/src/shared/healthAssertionConstants.ts and src/utils/healthAssertionConstants.ts; sharedModules.test.ts
// fails when they drift). SOURCE OF TRUTH is the backend file: change it there first and mirror the change.
// Draft spec: docs/nostr-health-assertions.md. Design: docs/claude/nostr-health-assertions.md.

/** Public key (hex) of the MintRadar Health attestation identity. A public key: no secret. It must not be written
 *  out anywhere else in the code; healthAssertions.ts re-exports it. */
export const ATTESTATION_PUBKEY_HEX = '2ddd7ce9833d2ed8a0bfaaf903cc71f65641f20d8f8142130163a625aa6b941c'

/** NIP-05 name of that key (public/.well-known/nostr.json, name "health"). */
export const ATTESTATION_NIP05 = 'health@mintradar.org'

/** The relays the PUBLIC pages name for reading. The publisher's own list (ATTESTATION_RELAYS in healthAssertions.ts)
 *  is a superset and may contain relays that accept only part of the events; it is deliberately not changed here. */
export const ATTESTATION_RELAYS_PUBLIC = [
  'wss://nostr.mintradar.org',
  'wss://nos.lol',
  'wss://relay.primal.net',
] as const

export type HealthTagSource = 'NIP-85' | 'NIP-40' | 'MintRadar'

export interface HealthAssertionTag {
  name: string
  /** The shape of the value. */
  type: string
  /** Who defines the tag: NIP-85, NIP-40 (expiration) or MintRadar itself (agreed between provider and clients). */
  source: HealthTagSource
  /** When the tag is in an event. */
  presence: string
  meaning: string
}

/** Every tag the builder (buildHealthEvent) can emit, in the order it emits them. */
export const HEALTH_ASSERTION_TAGS: readonly HealthAssertionTag[] = [
  { name: 'd', type: 'text (URL)', source: 'NIP-85', presence: 'always', meaning: 'The mint URL, normalised (https, lower-case host, no default port, no trailing slash on a bare host, no fragment). It identifies the mint.' },
  { name: 'k', type: 'text', source: 'NIP-85', presence: 'always', meaning: 'Always web: the NIP-73 type of the d value.' },
  { name: 'rank', type: 'integer 0 to 100', source: 'NIP-85', presence: 'always', meaning: 'The Reliability Score of the mint (the same number as score in the API).' },
  { name: 'mint_status', type: 'online | offline | degraded', source: 'MintRadar', presence: 'always', meaning: 'State at the last probe. degraded: no successful probe in the last 24 hours.' },
  { name: 'mint_uptime_24h', type: 'integer 0 to 100', source: 'MintRadar', presence: 'when known', meaning: 'Percentage of successful probes in the last 24 hours.' },
  { name: 'mint_uptime_7d', type: 'integer 0 to 100', source: 'MintRadar', presence: 'when known', meaning: 'Percentage of successful probes in the last 7 days.' },
  { name: 'mint_software', type: 'text, up to 64 characters', source: 'MintRadar', presence: 'when the version string is short and plain', meaning: 'The version string the mint reports about itself. It comes from the mint: show it as plain text only.' },
  { name: 'mint_outdated', type: '0 | 1', source: 'MintRadar', presence: 'when the version rule can decide', meaning: '1: the software is two or more minor versions behind the newest stable release of its family.' },
  { name: 'mint_audit_swaps_7d', type: 'integer', source: 'MintRadar', presence: 'only while the audit data is at most 168 hours old', meaning: 'Swaps in the 7-day third-party audit window.' },
  { name: 'mint_audit_attributed_7d', type: 'integer', source: 'MintRadar', presence: 'only while the audit data is at most 168 hours old', meaning: 'Failures in that window that the audit attributes to the mint itself.' },
  { name: 'mint_audit_at', type: 'UNIX seconds', source: 'MintRadar', presence: 'only while the audit data is at most 168 hours old', meaning: 'When the audit data was fetched.' },
  { name: 'mint_test', type: '0 | 1', source: 'MintRadar', presence: 'always', meaning: '1: the mint is on MintRadar\'s list of test mints.' },
  { name: 'mint_new_capped', type: '0 | 1', source: 'MintRadar', presence: 'always', meaning: '1: the mint is younger than 30 days and rank is limited to 75.' },
  { name: 'mint_checked_at', type: 'UNIX seconds', source: 'MintRadar', presence: 'when a probe time is known', meaning: 'Time of the last probe.' },
  { name: 'methodology', type: 'integer', source: 'MintRadar', presence: 'always', meaning: 'Version of the scoring method. Ranks of different versions are not comparable. It equals the number on the methodology page.' },
  { name: 'methodology_url', type: 'URL', source: 'MintRadar', presence: 'always', meaning: 'Where that method is described.' },
  { name: 'expiration', type: 'UNIX seconds', source: 'NIP-40', presence: 'always', meaning: 'The event expires 48 hours after created_at.' },
]
