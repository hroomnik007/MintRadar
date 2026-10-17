// The documented shape of the wallet API v1 (docs/API.md "API for wallets (v1)"): envelope fields, the mint
// object, the list query parameters and the error codes, as data. The /for-wallets page renders its tables from
// these lists, so the page cannot drift from the API: src/__tests__/forWalletsPage.test.tsx compares them with
// the real mapper (toWalletMint), the real envelopes and the real query parser in walletApi.ts.
//
// Inside v1 a field is never renamed or removed; a new field in WalletMint needs a line here in the same commit
// (that test fails otherwise). This file has no imports, so this frontend copy is byte-identical to
// backend/src/shared/walletFields.ts (code, comments aside); src/__tests__/sharedModules.test.ts fails when they
// drift. SOURCE OF TRUTH is the backend file: change it there first and mirror the change here.

export interface WalletField {
  /** Key of the JSON object; a key inside a nested object is written "parent.child". */
  name: string
  /** JSON type as shown to developers. */
  type: string
  /** true when the value can be null. */
  nullable: boolean
  meaning: string
}

export const WALLET_ENVELOPE_FIELDS: readonly WalletField[] = [
  { name: 'methodology', type: 'integer', nullable: false, meaning: 'Version of the Reliability Score formula. Scores of different numbers are not comparable. See /methodology.' },
  { name: 'generatedAt', type: 'string (ISO 8601, UTC)', nullable: false, meaning: 'When the snapshot behind the answer was read from the database (at most 60 seconds old).' },
  { name: 'count', type: 'integer', nullable: false, meaning: 'List only: the number of objects in mints.' },
  { name: 'mints', type: 'object[]', nullable: false, meaning: 'List only: the mint objects below.' },
  { name: 'mint', type: 'object', nullable: false, meaning: 'Single mint only: the mint object below.' },
]

export const WALLET_MINT_FIELDS: readonly WalletField[] = [
  { name: 'url', type: 'string', nullable: false, meaning: 'Normalised mint URL: https, lower-case host, no trailing slash after a bare host; a path is kept as it is.' },
  { name: 'name', type: 'string', nullable: true, meaning: 'Cleaned display name. null means show the hostname. Untrusted text: render it as plain text.' },
  { name: 'status', type: '"online" | "offline" | "degraded" | "archived"', nullable: false, meaning: 'online: the latest probe succeeded. offline: it failed, or the mint was never probed. degraded: the latest probe failed and either at least 4 probes in the last 24 hours all failed or that failed probe is more than 24 hours old. archived: the latest probe failed and the last successful probe was more than 30 days ago (checked first; a mint that never succeeded is not archived).' },
  { name: 'score', type: 'integer 0 to 100', nullable: true, meaning: 'Reliability Score, an operational health signal. null until the first probe: "no data yet", not a bad score.' },
  { name: 'scoreCappedNew', type: 'boolean', nullable: false, meaning: 'true while the mint is younger than 30 days; its score is capped at 75.' },
  { name: 'uptime24hPct', type: 'integer', nullable: true, meaning: 'Share of successful probes in the last 24 hours, in percent.' },
  { name: 'uptime7dPct', type: 'integer', nullable: true, meaning: 'Share of successful probes in the last 7 days, in percent.' },
  { name: 'lastCheckedAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Time of the latest probe.' },
  { name: 'units', type: 'string[]', nullable: true, meaning: 'Units the mint lists (sat, usd, eur, ...). null when unknown.' },
  { name: 'nuts', type: 'string[]', nullable: true, meaning: 'NUT numbers the mint advertises, ascending, as strings. null when unknown.' },
  { name: 'software', type: 'string', nullable: true, meaning: 'The mint\'s own version string, for example Nutshell/0.21.0. Untrusted text, at most 100 characters.' },
  { name: 'outdated', type: 'boolean', nullable: true, meaning: 'true: two or more minor versions behind the newest stable release. false: not outdated. null: unknown software, no or unreadable version, or no reference release.' },
  { name: 'isTest', type: 'boolean', nullable: false, meaning: 'On MintRadar\'s manual test-mint list. Test mints are never recommended.' },
  { name: 'audit', type: 'object', nullable: true, meaning: 'cashu.info\'s swap statistics for the mint. null when none are stored. The Reliability Score treats fewer than 10 swaps or data older than 168 hours as neutral.' },
  { name: 'audit.swaps7d', type: 'integer', nullable: false, meaning: 'All swaps in the last 7 days.' },
  { name: 'audit.attributedFailures', type: 'integer', nullable: false, meaning: 'Failures cashu.info attributes to this mint.' },
  { name: 'audit.fetchedAt', type: 'string (ISO 8601, UTC)', nullable: false, meaning: 'When MintRadar stored this data.' },
  { name: 'reviews', type: 'object', nullable: false, meaning: 'Community Rating from NIP-87 reviews. Separate from the score and never part of it.' },
  { name: 'reviews.count', type: 'integer', nullable: false, meaning: 'Counted reviews.' },
  { name: 'reviews.ratedCount', type: 'integer', nullable: false, meaning: 'How many of them carry a rating.' },
  { name: 'reviews.avg', type: 'number', nullable: true, meaning: 'Average rating over the rated reviews, one decimal. null when there are none.' },
  { name: 'reviews.operatorCount', type: 'integer', nullable: false, meaning: 'Reviews by the mint\'s own operator, which the other three leave out.' },
  { name: 'eligibleForRecommendation', type: 'boolean', nullable: false, meaning: 'true when the mint is online, has a score, is not a test mint and was first seen at least 14 days ago.' },
]

export interface WalletQueryParam {
  name: string
  type: string
  default: string
  meaning: string
}

/** The optional list query parameters; a present but invalid value is a 400, unknown parameters are ignored. */
export const WALLET_QUERY_PARAMS: readonly WalletQueryParam[] = [
  { name: 'unit', type: 'string', default: 'any', meaning: 'Keep mints that list this unit (sat, usd, eur, ...; case-insensitive; 1 to 16 letters, digits, _ or -). Mints whose units are unknown never match.' },
  { name: 'minScore', type: 'integer 0 to 100', default: 'none', meaning: 'Keep mints with score >= minScore. A mint without a score never matches.' },
  { name: 'includeOffline', type: 'true | false', default: 'false', meaning: 'Also return offline and degraded mints.' },
  { name: 'includeArchived', type: 'true | false', default: 'false', meaning: 'Also return archived mints (see status).' },
  { name: 'includeTest', type: 'true | false', default: 'false', meaning: 'Also return mints from the test-mint list (isTest: true).' },
  { name: 'includeUnscored', type: 'true | false', default: 'false', meaning: 'Also return mints whose score is null.' },
  { name: 'limit', type: 'integer 1 to 200', default: '100', meaning: 'Maximum number of mints returned.' },
]

export interface WalletError {
  status: number
  code: string
  when: string
}

/** Error bodies are { "error": { "code", "message" } }; a 429 also carries retryAfterSec. */
export const WALLET_ERRORS: readonly WalletError[] = [
  { status: 400, code: 'invalid_parameter', when: 'A list query value is present but invalid.' },
  { status: 400, code: 'invalid_url', when: 'The {url} is not valid percent-encoding or not a well-formed public https:// URL.' },
  { status: 404, code: 'mint_not_found', when: 'No tracked mint has this URL.' },
  { status: 404, code: 'not_found', when: 'Unknown route below /api/wallets.' },
  { status: 429, code: 'rate_limited', when: 'More than 300 requests per minute from one IP.' },
  { status: 500, code: 'internal_error', when: 'Server error.' },
]
