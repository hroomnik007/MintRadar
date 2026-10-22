// The documented shape of the wallet API v1 (docs/API.md "API for wallets (v1)"): envelope fields, the mint
// object, the list query parameters and the error codes, as data. The /for-wallets page renders its tables from
// these lists, so the page cannot drift from the API: src/__tests__/forWalletsPage.test.tsx compares them with
// the real mapper (toWalletMint), the real envelopes and the real query parser in walletApi.ts.
//
// Inside v1 a field is never renamed or removed; a new field in WalletMint needs a line here in the same commit
// (that test fails otherwise). This file has no imports, so the frontend copy src/utils/walletFields.ts is
// byte-identical (code, comments aside); src/__tests__/sharedModules.test.ts fails when they drift.

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
  { name: 'total', type: 'integer', nullable: false, meaning: 'List only: how many mints match the filters before limit is applied. Added 2026-10-20.' },
  { name: 'truncated', type: 'boolean', nullable: false, meaning: 'List only: true when total is greater than count, that is limit cut the list. Added 2026-10-20.' },
  { name: 'mints', type: 'object[]', nullable: false, meaning: 'List only: the mint objects below.' },
  { name: 'mint', type: 'object', nullable: false, meaning: 'Single mint only: the mint object below, with every field including the ones the list only returns for include.' },
  { name: 'canonicalUrl', type: 'string', nullable: true, meaning: 'Single mint only: null when the URL you asked for is the stored one. Otherwise the stored URL: the request differed from it only in the letter case of the path and exactly one mint matched. Added 2026-10-20.' },
]

export const WALLET_MINT_FIELDS: readonly WalletField[] = [
  { name: 'url', type: 'string', nullable: false, meaning: 'Normalised mint URL: https, lower-case host, no trailing slash after a bare host; a path is kept as it is.' },
  { name: 'name', type: 'string', nullable: true, meaning: 'Cleaned display name. null means show the hostname. Untrusted text: render it as plain text.' },
  { name: 'status', type: '"online" | "offline" | "degraded" | "archived"', nullable: false, meaning: 'online: the latest probe succeeded. offline: it failed, or the mint was never probed. degraded: the latest probe failed and either at least 4 probes in the last 24 hours all failed or that failed probe is more than 24 hours old. archived: the latest probe failed and the last successful probe was more than 30 days ago (checked first; a mint that never succeeded is not archived).' },
  { name: 'score', type: 'integer 0 to 100', nullable: true, meaning: 'Reliability Score, an operational health signal. null until the first probe: "no data yet", not a bad score.' },
  { name: 'scoreStale', type: 'boolean', nullable: false, meaning: 'true when status is not "online" (offline, degraded or archived), false when it is online. The score of a mint that is not online is the last measured one: the mint is not reachable now, so it says nothing about the present. Derived from status only; the score value is not changed. Added 2026-10-21.' },
  { name: 'scoreCappedNew', type: 'boolean', nullable: false, meaning: 'true while the mint is younger than 30 days; its score is capped at 75.' },
  { name: 'uptime24hPct', type: 'integer', nullable: true, meaning: 'Share of successful probes in the last 24 hours, in percent.' },
  { name: 'uptime7dPct', type: 'integer', nullable: true, meaning: 'Share of successful probes in the last 7 days, in percent.' },
  { name: 'lastCheckedAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Time of the latest probe.' },
  { name: 'units', type: 'string[]', nullable: true, meaning: 'Units the mint lists (sat, usd, eur, ...). null when unknown. units and the unit= filter list the units for which the mint declares a payment method (NUT-04/05); units that appear only in keysets (include=keysets) are not included, so a mint with no declared methods has units: null.' },
  { name: 'nuts', type: 'string[]', nullable: true, meaning: 'NUT numbers the mint advertises, ascending, as strings. A NUT whose /v1/info entry has "supported": false is not listed. null when unknown.' },
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
  { name: 'reviews.operatorCount', type: 'integer', nullable: false, meaning: 'Reviews from a key that is both listed as the mint\'s Nostr contact and the author of its NIP-87 announcement. The other three leave them out.' },
  { name: 'eligibleForRecommendation', type: 'boolean', nullable: false, meaning: 'true when the mint is online, has a score, is not a test mint and was first seen at least 14 days ago.' },
  // Added 2026-10-20 (all additive). downSince, hasOnion, authRequired and auditNeutralReason are on every object; the others only
  // with the matching include= value or on the single-mint endpoint.
  { name: 'pubkey', type: 'string', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). The mint\'s public NUT-06 key as MintRadar last stored it (66 hex characters). null when none is stored. Public data the mint publishes itself.' },
  { name: 'firstSeenAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). When MintRadar first saw the mint (the date eligibleForRecommendation counts from).' },
  { name: 'lastOnlineAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). Time of the latest successful probe. null when the mint never answered.' },
  { name: 'downSince', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Start of the current offline streak: the first failed probe after lastOnlineAt (the first failed probe kept in the 90-day history for a mint that never answered). null while status is online.' },
  { name: 'hasOnion', type: 'boolean', nullable: false, meaning: 'true when the mint advertises a Tor (.onion) address. false when it does not or when that is not known.' },
  { name: 'authRequired', type: 'object', nullable: true, meaning: 'What the mint ADVERTISES about authentication: clear is true when it lists NUT-21 (clear auth) and does not mark it "supported": false, blind when it lists NUT-22 (blind auth) likewise. MintRadar does not parse protected_endpoints, so true does not say which endpoints (mint, melt, swap, ...) need a token. null when the mint\'s NUTs are unknown.' },
  { name: 'authRequired.clear', type: 'boolean', nullable: false, meaning: 'The mint advertises NUT-21.' },
  { name: 'authRequired.blind', type: 'boolean', nullable: false, meaning: 'The mint advertises NUT-22.' },
  { name: 'sample', type: 'object', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). How much data the numbers above rest on.' },
  { name: 'sample.probes24h', type: 'integer', nullable: true, meaning: 'Only with include=facts. Probes recorded in the last 24 hours (about 288 for a mint probed every 5 minutes). null only if the figure is unavailable.' },
  { name: 'sample.swaps7d', type: 'integer', nullable: true, meaning: 'Only with include=facts. Swaps in the stored cashu.info 7-day window, the number the audit part of the score uses. null when no detail is stored.' },
  { name: 'contactChecks', type: 'object[]', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). Facts about the contact entries the mint lists in its /v1/info, one object per entry (at most 10 entries, at most 3 of kind email): { kind, formatValid, domainResolves, checkedAt }. kind is email, nostr, twitter, x, telegram, signal, url (the mint\'s "website" entry) or other. formatValid: true when MintRadar recognises the format of the value for its kind (e-mail syntax; for nostr an npub or nprofile with a valid checksum, 64 hex characters or a NIP-05 style name@domain, with an optional nostr: prefix; https URL with a public host name; otherwise printable text). false means only "format not recognised by MintRadar", never that the contact is wrong, fake or unusable. domainResolves: e-mail entries and NIP-05 style nostr entries only; true when DNS has MX (else A/AAAA) records for the domain, false when DNS says it has none, null when not applicable or the lookup failed or timed out; for a NIP-05 style entry it says nothing about whether the name exists, because /.well-known/nostr.json is never requested. checkedAt: ISO 8601 UTC. No value and no domain is returned or stored, no request is made to a contact value, and a mint is re-checked at most once a day (and once more after a change of these format rules). An empty array when nothing was checked. Facts with a time, not a judgement; they are not part of the score. Added 2026-10-20.' },
  { name: 'auditNeutralReason', type: '"low_sample" | "stale" | "no_data"', nullable: true, meaning: 'Why the audit part of the score is the neutral value 12.5 instead of a measured one: low_sample (fewer swaps than the minimum), stale (the stored detail is older than the maximum age), no_data (nothing stored). null while the audit part is measured. Same rules and thresholds as the score, read when the response is built.' },
  { name: 'keysets', type: 'object[]', nullable: false, meaning: 'Only with include=keysets (always on the single-mint endpoint). The keysets the latest successful check found, ordered by id: { id, unit, active, inputFeePpk, finalExpiry, idVersion, idValid }. inputFeePpk is null when the mint did not state a valid fee, finalExpiry is an ISO 8601 time or null, idVersion is "v1", "v2" or "legacy", idValid is true or false after MintRadar compared the id with the keys, null when it could not be verified. An empty array when the mint was never checked.' },
  { name: 'keysetsCheckedAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Only with include=keysets. Time of the latest successful keysets check. null when there was none.' },
  { name: 'methods', type: 'object', nullable: true, meaning: 'Only with include=methods (always on the single-mint endpoint). The payment methods the mint advertises in NUT-04 (mint) and NUT-05 (melt), such as bolt11, bolt12 or onchain. null when neither is stored.' },
  { name: 'methods.mint', type: 'object[]', nullable: false, meaning: 'NUT-04 entries: { method, unit, minAmount, maxAmount }. The amounts are integers or null when the mint states none. Empty when none are stored.' },
  { name: 'methods.melt', type: 'object[]', nullable: false, meaning: 'NUT-05 entries, same shape as methods.mint.' },
  { name: 'scoreBreakdown', type: 'object', nullable: true, meaning: 'Only with include=breakdown (always on the single-mint endpoint). What the score used at its last computation, written in the same step as the score. The parts uptime, audit, nuts, version and contact are { points, max } (max 40, 25, 15, 15 and 5); newMintCap is { points, cap } with points 0 or negative; sum is the score. Neutral audit data counts 12.5 points, so the five parts can end in .5: sum = the parts added, rounded once, plus newMintCap.points. null until the first probe after this field was introduced.' },
  { name: 'scoreBreakdown.uptime', type: 'object', nullable: false, meaning: '{ points, max } for uptime over the last 24 hours.' },
  { name: 'scoreBreakdown.audit', type: 'object', nullable: false, meaning: '{ points, max } for the audit part (see auditNeutralReason).' },
  { name: 'scoreBreakdown.nuts', type: 'object', nullable: false, meaning: '{ points, max } for NUT support.' },
  { name: 'scoreBreakdown.version', type: 'object', nullable: false, meaning: '{ points, max } for software freshness.' },
  { name: 'scoreBreakdown.contact', type: 'object', nullable: false, meaning: '{ points, max } for published contact methods.' },
  { name: 'scoreBreakdown.newMintCap', type: 'object', nullable: false, meaning: '{ points, cap }: the correction the cap for mints younger than 30 days made (0 or negative) and the cap itself.' },
  { name: 'scoreBreakdown.sum', type: 'integer', nullable: false, meaning: 'Equal to score as it was stored with this breakdown.' },
  { name: 'changes', type: 'object[]', nullable: false, meaning: 'Only with include=changes (always on the single-mint endpoint). Confirmed changes in the mint\'s public data, newest first: { type, field, oldValue, newValue, observedAt, firstSeenAt }. type is one of pubkey_changed, input_fee_changed, keyset_added, keyset_removed, keyset_deactivated, keyset_reactivated, keyset_final_expiry_changed, motd_changed, name_changed, description_changed, contact_changed, version_changed, nuts_changed, methods_changed. A change is recorded only after two consecutive successful observations; observedAt is when the second one confirmed it and firstSeenAt when the new value was first seen. oldValue and newValue are plain text of at most 200 characters (URLs replaced by [link]; contacts as method kinds and a count, never a contact value; null when there is no old or new side). A day with more than 20 changes of one mint ends in a single row per type whose newValue is "multiple changes". At most 50 on the single-mint endpoint, 10 with include=changes on the list; an empty array when there are none. Facts with a source and a time, not a verdict. Added 2026-10-20.' },
  // Added 2026-10-21 (W6b, additive): only with include=facts, always on the single-mint endpoint.
  { name: 'feeExamples', type: 'object[]', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). What the input fee comes to in plain amounts, for each unit that has an active keyset: { unit, inputFeePpk, examples: [{ proofs, fee }] }. inputFeePpk is the largest input_fee_ppk among the active keysets of that unit (a keyset that states none, or an unusable value, counts as 0, the NUT-02 default); the examples are for spending 1, 16 and 100 proofs, computed as in NUT-02 (the sum of the proofs\' input_fee_ppk divided by 1000, rounded up), in the unit. Computed from the stored keysets, not from a request to the mint. Empty when no keyset check has stored an active keyset yet.' },
  { name: 'limits', type: 'object', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). The limits the mint declares in its /v1/info for NUT-04 (mint, Lightning deposits) and NUT-05 (melt, Lightning withdrawals), per method and unit. null when neither is stored. Lightning fee reserves are not here: they depend on the invoice and are only known when a quote is requested.' },
  { name: 'limits.mint', type: 'object[]', nullable: false, meaning: 'NUT-04 entries: { method, unit, min, max }. min and max are integers, or null when the mint does not declare that limit. Empty when none are stored.' },
  { name: 'limits.melt', type: 'object[]', nullable: false, meaning: 'NUT-05 entries, same shape as limits.mint.' },
  { name: 'auditByDirection', type: 'object', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). cashu.info\'s swaps of the last 7 days split by direction, the same data the audit part of the score counts in total. The score uses the combined number, not these.' },
  { name: 'auditByDirection.mint', type: 'object', nullable: true, meaning: 'Swaps in which this mint was the destination (a Lightning deposit, NUT-04): { attempts, failures, windowDays, source, syncedAt }. failures counts every failed swap of that direction, including the ones cashu.info does not blame on the mint. syncedAt is the time MintRadar stored the data. null when no numbers are stored.' },
  { name: 'auditByDirection.melt', type: 'object', nullable: true, meaning: 'Swaps in which this mint was the source (a Lightning withdrawal, NUT-05), same shape as auditByDirection.mint. null when no numbers are stored.' },
]

export interface WalletQueryParam {
  name: string
  type: string
  default: string
  meaning: string
}

/** The optional list query parameters; a present but invalid value is a 400, unknown parameters are ignored. */
export const WALLET_QUERY_PARAMS: readonly WalletQueryParam[] = [
  { name: 'unit', type: 'string', default: 'any', meaning: 'Keep mints that list this unit (sat, usd, eur, ...; case-insensitive; 1 to 16 letters, digits, _ or -). Mints whose units are unknown never match. units and the unit= filter list the units for which the mint declares a payment method (NUT-04/05); units that appear only in keysets (include=keysets) are not included, so a mint with no declared methods has units: null.' },
  { name: 'minScore', type: 'integer 0 to 100', default: 'none', meaning: 'Keep mints with score >= minScore. A mint without a score never matches.' },
  { name: 'includeOffline', type: 'true | false', default: 'false', meaning: 'Also return offline and degraded mints.' },
  { name: 'includeArchived', type: 'true | false', default: 'false', meaning: 'Also return archived mints (see status).' },
  { name: 'includeTest', type: 'true | false', default: 'false', meaning: 'Also return mints from the test-mint list (isTest: true).' },
  { name: 'includeUnscored', type: 'true | false', default: 'false', meaning: 'Also return mints whose score is null.' },
  { name: 'nuts', type: 'comma-separated NUT numbers', default: 'none', meaning: 'Keep mints that advertise all of these NUTs, for example 4,5 (1 to 32 numbers of up to 3 digits; compared with the nuts field, so a NUT with "supported": false does not match). A mint whose nuts are unknown never matches.' },
  { name: 'eligible', type: 'true | false', default: 'none', meaning: 'true: keep only mints with eligibleForRecommendation: true, the ones the deprecated /mints/recommend would return. false: keep only the others. Combine with unit, minScore, nuts and limit to replace /mints/recommend.' },
  { name: 'method', type: 'bolt11 | bolt12 | onchain', default: 'none', meaning: 'Keep mints that advertise this payment method in NUT-04 or NUT-05, on any unit; with unit also given, on that unit. A mint whose methods are unknown never matches. Added 2026-10-20.' },
  { name: 'maxInputFeePpk', type: 'integer 0 to 1000000', default: 'none', meaning: 'Keep mints whose active keysets for unit (every unit when unit is not given) all have inputFeePpk <= this value. A mint with an unknown fee, or without an active keyset in scope, is excluded. Added 2026-10-20.' },
  { name: 'include', type: 'comma-separated: facts, keysets, methods, breakdown, changes', default: 'none', meaning: 'Add the heavier fields to every object of the list: facts (pubkey, firstSeenAt, lastOnlineAt, sample, contactChecks, feeExamples, limits and auditByDirection), keysets (and keysetsCheckedAt), methods, breakdown (scoreBreakdown), changes (the newest 10 per mint). Unknown values are a 400. Added 2026-10-20.' },
  { name: 'changedSince', type: 'ISO 8601 UTC time or UNIX seconds', default: 'none', meaning: 'Keep mints with at least one confirmed change observed after this time. Accepted: an ISO 8601 time with Z or an offset (2026-10-20T12:00:00Z; encode + as %2B), a bare date (00:00 UTC), or UNIX seconds (9 to 11 digits). Anything else is a 400. The JSON API writes times as ISO 8601; the Nostr tags use UNIX seconds. Added 2026-10-20.' },
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
  { status: 404, code: 'not_found', when: 'Unknown route below /api/v1 (or /api/wallets).' },
  { status: 429, code: 'rate_limited', when: 'More than 300 requests per minute from one IP.' },
  { status: 500, code: 'internal_error', when: 'Server error.' },
]
