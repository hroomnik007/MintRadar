// Facts and code of the /for-wallets section "Signed health assertions on Nostr (early version)". The tag table comes
// from utils/healthAssertionConstants.ts, the verification code from constants/verifyHealthSnippet.ts. The numbers
// below are compared with the publisher in backend/src/__tests__/verifyHealthSnippet.test.ts. Relative imports on
// purpose: the backend test loads this file without the "@" alias.

// The nip19 entry alone (bech32 only): this module is reachable from the initial bundle, the full nostr-tools is not.
import * as nip19 from 'nostr-tools/nip19'
import { ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from '../utils/healthAssertionConstants'
import { REPO_BLOB_URL } from './contact'

export const HEALTH_SECTION_ID = 'signed-health-assertions'
export const HEALTH_SECTION_TITLE = 'Signed health assertions on Nostr (early version)'

/** Derived from the hex (never typed by hand), so the page cannot show another key than the code pins. */
export const ATTESTATION_NPUB = nip19.npubEncode(ATTESTATION_PUBKEY_HEX)

export const HEALTH_FACTS = {
  expiryHours: 48,
  minIntervalHours: 6,
  minRankDelta: 2,
  refreshHours: 24,
  auditMaxAgeHours: 168,
  /** A status change is published at the next publisher run (every 15 minutes), not after minIntervalHours. */
  runIntervalMinutes: 15,
  /** Least time between two events of one mint when a status change causes the second one. */
  stateChangeMinGapMinutes: 5,
  /** Most status-change events per hour over all mints; the rest waits for the next run. */
  stateChangeMaxPerHour: 30,
  /** limit of the query for every mint. */
  queryLimit: 500,
} as const

export const HEALTH_FILTER_ALL = `{ kinds: [30385], authors: ['${ATTESTATION_PUBKEY_HEX}'], limit: ${HEALTH_FACTS.queryLimit} }`
export const HEALTH_FILTER_ONE = `{ kinds: [30385], authors: ['${ATTESTATION_PUBKEY_HEX}'], '#d': ['https://mint.example.com'] }`

export const HEALTH_RECORD_READ_TITLE = 'Find the record of a mint from the API'
/**
 * The same sentences and the same code are in docs/API.md (forWalletsPage.test.tsx compares them, ignoring backticks):
 * what the API gives (the url field) and what a wallet builds from it. The API itself returns no naddr and no link.
 */
export const HEALTH_RECORD_READ_TEXT = [
  'To read the signed record of a mint you found through the API, use its url field as the d tag, query the relays published with the signed health assertions with the filter for one mint, and check the signature against the pinned MintRadar Health key.',
  'The record also has an address (naddr) that Nostr clients understand: kind 30385, the MintRadar Health key, the d tag, and the relays as hints.',
  'For people, https://njump.me/<naddr> opens the record in a browser. njump.me is an external site, so offer the link as an option.',
  'The API returns neither the naddr nor the link: build them from the url field, as below.',
] as const
export const HEALTH_RECORD_READ_CODE = `// mint.url is the url field of the wallet API
const filter = { kinds: [30385], authors: ['${ATTESTATION_PUBKEY_HEX}'], '#d': [mint.url] }
const naddr = nip19.naddrEncode({
  kind: 30385,
  pubkey: '${ATTESTATION_PUBKEY_HEX}',
  identifier: mint.url,
  relays: [${ATTESTATION_RELAYS_PUBLIC.map(r => `'${r}'`).join(', ')}],
})
const njump = \`https://njump.me/\${naddr}\` // optional, for people`

export const HEALTH_RUN_EXAMPLE = 'npm install nostr-tools\nnode verify-health.mjs https://mint.example.com'

export const HEALTH_EXAMPLE_URL = `${REPO_BLOB_URL}/docs/examples/verify-health.mjs`
export const HEALTH_SPEC_URL = `${REPO_BLOB_URL}/docs/nostr-health-assertions.md`
/** The table of the d tag (URL normalisation) in the spec. */
export const HEALTH_SPEC_TAGS_URL = `${HEALTH_SPEC_URL}#tags`
