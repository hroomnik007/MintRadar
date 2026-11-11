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
  { name: 'total', type: 'integer', nullable: false, meaning: 'List only: how many mints match the filters before limit is applied.' },
  { name: 'truncated', type: 'boolean', nullable: false, meaning: 'List only: true when total is greater than count, that is limit cut the list.' },
  { name: 'mints', type: 'object[]', nullable: false, meaning: 'List only: the mint objects below.' },
  { name: 'mint', type: 'object', nullable: false, meaning: 'Single mint only: the mint object below, with every field including the ones the list only returns for include.' },
  { name: 'canonicalUrl', type: 'string', nullable: true, meaning: 'Single mint only: null when the URL you asked for is the stored one; otherwise the stored URL (the request differed from it only in the letter case of the path and exactly one mint matched).' },
]

export const WALLET_MINT_FIELDS: readonly WalletField[] = [
  { name: 'url', type: 'string', nullable: false, meaning: 'Normalised mint URL: https, lower-case host, no trailing slash after a bare host; a path is kept as it is.' },
  { name: 'name', type: 'string', nullable: true, meaning: 'Cleaned display name. null means show the hostname. Untrusted text: render it as plain text.' },
  { name: 'status', type: '"online" | "offline" | "degraded" | "archived"', nullable: false, meaning: 'online: the latest probe succeeded. offline: it failed, or the mint was never probed. degraded: the latest probe failed and either at least 4 probes in the last 24 hours all failed or that failed probe is more than 24 hours old. archived: the latest probe failed and the last successful probe was more than 30 days ago.' },
  { name: 'score', type: 'integer 0 to 100', nullable: true, meaning: 'Reliability Score, an operational health signal. null until the first probe: "no data yet", not a bad score.' },
  { name: 'scoreStale', type: 'boolean', nullable: false, meaning: 'true when status is not "online" (offline, degraded or archived): the score is then the last measured one and says nothing about the present. Derived from status only; the score value is not changed.' },
  { name: 'scoreCappedNew', type: 'boolean', nullable: false, meaning: 'true while the mint is younger than 30 days; its score is capped at 75.' },
  { name: 'uptime24hPct', type: 'integer', nullable: true, meaning: 'Share of successful probes in the last 24 hours, in percent.' },
  { name: 'uptime7dPct', type: 'integer', nullable: true, meaning: 'Share of successful probes in the last 7 days, in percent.' },
  { name: 'uptime30dPct', type: 'integer', nullable: true, meaning: 'Share of successful probes in the last 30 days, in percent. null when there is no probe in that window.' },
  { name: 'lastCheckedAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Time of the latest probe.' },
  { name: 'units', type: 'string[]', nullable: true, meaning: 'Units the mint lists (sat, usd, eur, ...). null when unknown. units and the unit= filter list the units for which the mint declares a payment method (NUT-04/05); units that appear only in keysets (include=keysets) are not included, so a mint with no declared methods has units: null.' },
  { name: 'nuts', type: 'string[]', nullable: true, meaning: 'NUT numbers the mint advertises, ascending, as strings. A NUT whose /v1/info entry has "supported": false is not listed. null when unknown.' },
  { name: 'mintDisabled', type: 'boolean', nullable: true, meaning: 'true when the mint lists NUT-04 (minting) in its /v1/info with "disabled": true: it does not issue new ecash right now. false when NUT-04 is listed without it or not listed; null when the mint\'s NUTs are unknown. NUT-04 stays in nuts.' },
  { name: 'meltDisabled', type: 'boolean', nullable: true, meaning: 'true when the mint lists NUT-05 (melting) in its /v1/info with "disabled": true: it does not pay out right now. false when NUT-05 is listed without it or not listed; null when the mint\'s NUTs are unknown. NUT-05 stays in nuts.' },
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
  { name: 'reviews.operatorCount', type: 'integer', nullable: false, meaning: 'Reviews from a key that is both listed as the mint\'s Nostr contact and the author of its NIP-87 announcement. They are not included in count, ratedCount or avg.' },
  { name: 'eligibleForRecommendation', type: 'boolean', nullable: false, meaning: 'true when the mint is online, has a score, is not a test mint, was first seen at least 14 days ago, its newest probe is at most 3 hours old and its uptime in the last 30 days is at least 95 %, compared unrounded (94.5 % does not pass although uptime30dPct shows 95).' },
  // Added 2026-10-20 (all additive). downSince, hasOnion, authRequired and auditNeutralReason are on every object; the others only
  // with the matching include= value or on the single-mint endpoint.
  { name: 'pubkey', type: 'string', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). The mint\'s public NUT-06 key as MintRadar last stored it (66 hex characters). null when none is stored. Public data the mint publishes itself.' },
  { name: 'firstSeenAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). When MintRadar first saw the mint (the date eligibleForRecommendation counts from).' },
  { name: 'lastOnlineAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). Time of the latest successful probe. null when the mint never answered.' },
  { name: 'downSince', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Start of the current offline streak: the first failed probe after lastOnlineAt (the first failed probe kept in the 90-day history for a mint that never answered). null while status is online.' },
  { name: 'hasOnion', type: 'boolean', nullable: false, meaning: 'true when the mint advertises a Tor (.onion) address. false when it does not or when that is not known.' },
  { name: 'authRequired', type: 'object', nullable: true, meaning: 'What the mint ADVERTISES about authentication: clear is true when it lists NUT-21 (clear auth), blind when it lists NUT-22 (blind auth), unless marked "supported": false. It does not say which endpoints need a token; null when the mint\'s NUTs are unknown.' },
  { name: 'authRequired.clear', type: 'boolean', nullable: false, meaning: 'The mint advertises NUT-21.' },
  { name: 'authRequired.blind', type: 'boolean', nullable: false, meaning: 'The mint advertises NUT-22.' },
  { name: 'sample', type: 'object', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). How much data the numbers above rest on.' },
  { name: 'sample.probes24h', type: 'integer', nullable: true, meaning: 'Only with include=facts. Probes recorded in the last 24 hours (about 288 for a mint probed every 5 minutes). null only if the figure is unavailable.' },
  { name: 'sample.swaps7d', type: 'integer', nullable: true, meaning: 'Only with include=facts. Swaps in the stored cashu.info 7-day window, the number the audit part of the score uses. null when no detail is stored.' },
  { name: 'contactChecks', type: 'object[]', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). One object per contact the mint lists in /v1/info (at most 10): { kind, formatValid, domainResolves, checkedAt }. formatValid says whether MintRadar recognises the format for that kind; false never means the contact is wrong. domainResolves (e-mail and NIP-05 style entries only) says whether DNS has mail records for the domain. domainResolves is null when the DNS check could not be completed at the last check (for example a timeout) or does not apply to the contact; it is checked again on the next contact check, about every 24 hours. If a later check cannot be completed, an earlier true is kept for up to 48 hours after that answer (checkedAt is then the time of that answer); a real false always replaces it. NXDOMAIN and a domain with no mail records (no MX and no A/AAAA records, or a null MX) give false. Checked about once a day. No contact value is returned or contacted. Facts with a time, not part of the score.' },
  { name: 'auditNeutralReason', type: '"low_sample" | "stale" | "no_data"', nullable: true, meaning: 'Why the audit part of the score is the neutral value 12.5: low_sample (fewer swaps than the minimum), stale (the stored detail is older than the maximum age) or no_data (nothing stored). null while the audit part is measured.' },
  { name: 'keysets', type: 'object[]', nullable: false, meaning: 'Only with include=keysets (always on the single-mint endpoint). The keysets the latest successful check found, ordered by id: { id, unit, active, inputFeePpk, finalExpiry, idVersion, idValid }; idValid is null when the id could not be verified. An empty array when the mint was never checked.' },
  { name: 'keysetsCheckedAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'Only with include=keysets. Time of the latest successful keysets check. null when there was none.' },
  { name: 'methods', type: 'object', nullable: true, meaning: 'Only with include=methods (always on the single-mint endpoint). The payment methods the mint advertises in NUT-04 (mint) and NUT-05 (melt), such as bolt11, bolt12 or onchain. null when neither is stored.' },
  { name: 'methods.mint', type: 'object[]', nullable: false, meaning: 'NUT-04 entries: { method, unit, minAmount, maxAmount }. The amounts are integers or null when the mint states none. Empty when none are stored.' },
  { name: 'methods.melt', type: 'object[]', nullable: false, meaning: 'NUT-05 entries, same shape as methods.mint.' },
  { name: 'scoreBreakdown', type: 'object', nullable: true, meaning: 'Only with include=breakdown (always on the single-mint endpoint). What the score used at its last computation: uptime, audit, nuts, version and contact are { points, max } (max 40, 25, 15, 15 and 5), newMintCap is { points, cap }, sum is the score; neutral audit data counts 12.5, so parts can end in .5. null until the first probe after this field was introduced.' },
  { name: 'scoreBreakdown.uptime', type: 'object', nullable: false, meaning: '{ points, max } for uptime: the sum of the four parts in uptimeParts.' },
  { name: 'scoreBreakdown.uptimeParts', type: 'object', nullable: false, meaning: 'Since methodology 7 (absent in a breakdown stored before it). The four parts of uptime, each { points, max }: last24h (max 20), last30d (max 10), longestOutage (max 6) and outageCount (max 4).' },
  { name: 'scoreBreakdown.uptimeInputs', type: 'object', nullable: false, meaning: 'Present together with uptimeParts. The figures those parts used: uptime24hPct, uptime30dPct, uptime30dExactPct (the same share unrounded, two decimals rounded down, the figure of the 95 % recommendation gate; absent in a breakdown stored before 2026-11-11), outageCount30d (outages of two or more failed probes in a row), longestOutage30dMs and ongoingOutage.' },
  { name: 'scoreBreakdown.audit', type: 'object', nullable: false, meaning: '{ points, max } for the audit part (see auditNeutralReason).' },
  { name: 'scoreBreakdown.nuts', type: 'object', nullable: false, meaning: '{ points, max } for NUT support.' },
  { name: 'scoreBreakdown.version', type: 'object', nullable: false, meaning: '{ points, max } for software freshness.' },
  { name: 'scoreBreakdown.contact', type: 'object', nullable: false, meaning: '{ points, max } for published contact methods.' },
  { name: 'scoreBreakdown.newMintCap', type: 'object', nullable: false, meaning: '{ points, cap }: the correction the cap for mints younger than 30 days made (0 or negative) and the cap itself.' },
  { name: 'scoreBreakdown.sum', type: 'integer', nullable: false, meaning: 'Equal to score as it was stored with this breakdown.' },
  { name: 'changes', type: 'object[]', nullable: false, meaning: 'Only with include=changes (always on the single-mint endpoint). Confirmed changes in the mint\'s public data, newest first: { type, field, oldValue, newValue, observedAt, firstSeenAt }. A change is recorded after two consecutive successful observations; values are plain text of at most 200 characters. At most 50 per mint (10 in the list).' },
  { name: 'changesPending', type: 'object', nullable: true, meaning: 'Only with include=changes (always on the single-mint endpoint). Differences seen once and waiting for the next observation to confirm them: { firstSeenAt, diff }, in the text form of changes. Never part of changes or announced; null when nothing is pending.' },
  { name: 'changesPending.firstSeenAt', type: 'string (ISO 8601)', nullable: false, meaning: 'The earliest firstSeenAt of the diff items: when MintRadar first saw the oldest still unconfirmed difference.' },
  { name: 'changesPending.diff', type: 'object[]', nullable: false, meaning: 'The unconfirmed differences { type, field, oldValue, newValue, firstSeenAt }, in the text form of changes; what would be recorded if the next observation confirms it.' },
  // Added 2026-10-21 (W6b, additive): only with include=facts, always on the single-mint endpoint.
  { name: 'feeExamples', type: 'object[]', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). Per unit with an active keyset: { unit, inputFeePpk, examples: [{ proofs, fee }] }, the fee for spending 1, 16 and 100 proofs (NUT-02, rounded up), computed from the stored keysets. Empty when none is stored.' },
  { name: 'limits', type: 'object', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). The limits the mint declares in its /v1/info for NUT-04 (mint) and NUT-05 (melt), per method and unit; null when neither is stored. Lightning fee reserves are not here: they depend on the invoice.' },
  { name: 'limits.mint', type: 'object[]', nullable: false, meaning: 'NUT-04 entries: { method, unit, min, max }. min and max are integers, or null when the mint does not declare that limit. Empty when none are stored.' },
  { name: 'limits.melt', type: 'object[]', nullable: false, meaning: 'NUT-05 entries, same shape as limits.mint.' },
  { name: 'auditByDirection', type: 'object', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). cashu.info\'s swaps of the last 7 days split by direction, the same data the audit part of the score counts in total. The score uses the combined number, not these.' },
  { name: 'auditByDirection.mint', type: 'object', nullable: true, meaning: 'Swaps in which this mint was the destination (a Lightning deposit, NUT-04): { attempts, failures, windowDays, source, syncedAt }. failures counts every failed swap, including ones cashu.info does not blame on the mint; null when none are stored.' },
  { name: 'auditByDirection.melt', type: 'object', nullable: true, meaning: 'Swaps in which this mint was the source (a Lightning withdrawal, NUT-05), same shape as auditByDirection.mint. null when no numbers are stored.' },
  { name: 'latency24h', type: 'object', nullable: true, meaning: 'Only with include=facts (always on the single-mint endpoint). Response time of the successful probes of the last 24 hours: { p50Ms, p95Ms, samples }, the median and 95th percentile in whole milliseconds and the number of probes. null when there is none.' },
  { name: 'latency24h.p50Ms', type: 'integer', nullable: false, meaning: 'Median response time, ms.' },
  { name: 'latency24h.p95Ms', type: 'integer', nullable: false, meaning: '95th percentile response time, ms.' },
  { name: 'latency24h.samples', type: 'integer', nullable: false, meaning: 'Successful probes with a measured time in the last 24 hours.' },
  { name: 'nip87', type: 'object', nullable: false, meaning: 'Only with include=facts (always on the single-mint endpoint). The mint\'s NIP-87 announcement (Nostr kind 38172) as MintRadar\'s discovery stored it from its relays: { announcement, dMatchesInfoPubkey, eventCreatedAt } plus checkedAt for not_seen.' },
  { name: 'nip87.announcement', type: '"seen" | "not_seen"', nullable: false, meaning: 'seen: an announcement event was seen by discovery at some point and stored; it is not re-checked against the relays afterwards. not_seen: none was seen on our relays; it may still exist elsewhere.' },
  { name: 'nip87.dMatchesInfoPubkey', type: 'boolean', nullable: true, meaning: 'Whether the announcement\'s d tag equals the pubkey in the mint\'s /v1/info. null when not comparable (no announcement seen, a d tag that is not a mint pubkey, or no stored pubkey). A match is a fact about the event, not about who published it.' },
  { name: 'nip87.eventCreatedAt', type: 'string (ISO 8601, UTC)', nullable: true, meaning: 'created_at of the stored announcement event; null when none was seen.' },
  { name: 'nip87.checkedAt', type: 'string (ISO 8601, UTC)', nullable: false, meaning: 'Time of the last discovery run that reached the relays. Present only when announcement is "not_seen"; omitted for "seen" and until there has been such a run.' },
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
  { name: 'eligible', type: 'true | false', default: 'none', meaning: 'true: only mints with eligibleForRecommendation: true, the ones the deprecated /mints/recommend returns. false: only the others. Combine with unit, minScore, nuts and limit to replace /mints/recommend.' },
  { name: 'method', type: 'bolt11 | bolt12 | onchain', default: 'none', meaning: 'Keep mints that advertise this payment method in NUT-04 or NUT-05, on any unit; with unit also given, on that unit. A mint whose methods are unknown never matches.' },
  { name: 'maxInputFeePpk', type: 'integer 0 to 1000000', default: 'none', meaning: 'Keep mints whose active keysets for unit (every unit when unit is not given) all have inputFeePpk <= this value. A mint with an unknown fee, or without an active keyset in scope, is excluded.' },
  { name: 'include', type: 'comma-separated: facts, keysets, methods, breakdown, changes', default: 'none', meaning: 'Add heavier fields to every object of the list: facts (pubkey, firstSeenAt, lastOnlineAt, sample, contactChecks, feeExamples, limits, auditByDirection, latency24h and nip87), keysets (and keysetsCheckedAt), methods, breakdown (scoreBreakdown), changes (the newest 10 per mint and changesPending). Unknown values are a 400.' },
  { name: 'changedSince', type: 'ISO 8601 UTC time or UNIX seconds', default: 'none', meaning: 'Keep mints with at least one confirmed change observed after this time: ISO 8601 with Z or an offset (encode + as %2B), a bare date (00:00 UTC) or UNIX seconds. Anything else is a 400.' },
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
