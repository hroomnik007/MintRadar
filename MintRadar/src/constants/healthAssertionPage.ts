// Facts and code of the /for-wallets section "Signed health assertions on Nostr (early version)". The tag table comes
// from utils/healthAssertionConstants.ts, the verification code from constants/verifyHealthSnippet.ts. The numbers
// below are compared with the publisher in backend/src/__tests__/verifyHealthSnippet.test.ts. Relative imports on
// purpose: the backend test loads this file without the "@" alias.

import { nip19 } from 'nostr-tools'
import { ATTESTATION_PUBKEY_HEX } from '../utils/healthAssertionConstants'
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
  /** limit of the query for every mint. */
  queryLimit: 500,
} as const

export const HEALTH_FILTER_ALL = `{ kinds: [30385], authors: ['${ATTESTATION_PUBKEY_HEX}'], limit: ${HEALTH_FACTS.queryLimit} }`
export const HEALTH_FILTER_ONE = `{ kinds: [30385], authors: ['${ATTESTATION_PUBKEY_HEX}'], '#d': ['https://mint.example.com'] }`

export const HEALTH_RUN_EXAMPLE = 'npm install nostr-tools\nnode verify-health.mjs https://mint.example.com'

export const HEALTH_EXAMPLE_URL = `${REPO_BLOB_URL}/docs/examples/verify-health.mjs`
export const HEALTH_SPEC_URL = `${REPO_BLOB_URL}/docs/nostr-health-assertions.md`
/** The table of the d tag (URL normalisation) in the spec. */
export const HEALTH_SPEC_TAGS_URL = `${HEALTH_SPEC_URL}#tags`
