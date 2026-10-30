# MintRadar Public API

MintRadar provides a public read-only API for querying Cashu mint data. All endpoints are served under the same origin as the web app (`https://mintradar.org/api/`).

**Versioning:** every endpoint is also reachable under `/api/v1/` (e.g. `/api/v1/mints/known`) — same response shape, same rate limits, no behavior differences. `/api/v1` is the preferred path going forward; the unversioned `/api/*` is kept as a legacy alias and may be removed in a future release.

**Stable for wallets:** only [API for wallets (v1)](#api-for-wallets-v1) carries a stability guarantee. `GET /api/mints/recommend` is public with the same CORS and caching rules, but it is **deprecated** (since 2026-10-20, see "Stability"); use the list route of the wallet API instead. Every other route is **internal**: it serves the MintRadar website, may change without notice and has no stability guarantee (`/api/mints/known` (see below), `/api/mints/outages`, `swaps`, `audit-cz`, `nostr-reviews`, `history`, `version-history`, `/api/stats`, `/api/stats/reliability-trend`, `/api/stats/reliability-movers`, `/api/mint/icon`, `/api/nip05/verify`, `/api/og/mint`, `/sitemap.xml`, the notification routes; those from `history` to `nostr-reviews`, `outages`, `stats` and `probe` are described below as a convenience).

---

## API for wallets (v1)

A small, stable, read-only API for wallet developers: one compact health summary per Cashu mint. It is served from the same snapshot as `/api/mints/known` (one database read per 60 seconds for all callers), under `https://mintradar.org/api/v1/wallets/…`. A quick start with runnable examples is on [mintradar.org/for-wallets](https://mintradar.org/for-wallets); the exact rules of the score are on [mintradar.org/methodology](https://mintradar.org/methodology).

> **Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar's probes and third-party audit data; it can be wrong or out of date.**

### Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/v1/wallets/mints` | List of mints with filters (below) |
| `GET /api/v1/wallets/mints/{url}` | One mint; `{url}` is the mint URL, percent-encoded (`https%3A%2F%2Fmint.example.com`) |

Machine-readable description: [`docs/openapi/wallets-v1.yaml`](openapi/wallets-v1.yaml) (OpenAPI 3.1). `/api/wallets/…` (without `v1`) is the same route.

**List query parameters** (all optional; a present but invalid value is a `400`, a repeated parameter counts as invalid, unknown parameters are ignored; the four `include…` flags and `eligible` take exactly `true` or `false` in lower case). `nuts` and `eligible` were **added on 2026-10-20**, and so were `method`, `maxInputFeePpk` and `include` the same day; `changedSince` and the `include` value `changes` came with the mint change log (also 2026-10-20). They are additions, nothing that existed changed:

Without the `include…` flags the list holds only mints that are online (`status` is `online`), not on the test-mint list and with a score; the flags below add the others.

| Parameter | Default | Meaning |
|---|---|---|
| `unit` | — | Keep mints that list this unit (`sat`, `usd`, `eur`, …; case-insensitive; 1 to 16 letters, digits, `_` or `-`, an empty value is a `400`). Mints whose units are unknown (`units: null`) never match. `units` and the `unit=` filter list the units for which the mint declares a payment method (NUT-04/05); units that appear only in keysets (`include=keysets`) are not included, so a mint with no declared methods has `units: null`. |
| `minScore` | — | Integer 0 to 100: keep mints with `score >= minScore` (a mint without a score never matches). |
| `includeOffline` | `false` | Also return `offline` and `degraded` mints (see `status` for the exact rule). |
| `includeArchived` | `false` | Also return `archived` mints (see `status`). This flag alone is enough for them. |
| `includeTest` | `false` | Also return mints from MintRadar's manual test-mint list (`isTest: true`). |
| `includeUnscored` | `false` | Also return mints whose `score` is `null` (not probed yet). |
| `nuts` | — | Comma-separated NUT numbers, for example `4,5`: keep mints that advertise **all** of them (compared with the `nuts` field, so a NUT with `"supported": false` does not match; leading zeros are ignored, a repeated number counts once). 1 to 32 numbers of 1 to 3 digits, spaces around a number are trimmed; an empty value, an empty element (`4,,5`) or anything else is a `400`. A mint whose `nuts` are unknown (`null`) never matches. |
| `eligible` | — | `true`: keep only mints with `eligibleForRecommendation: true`, the mints the deprecated `/mints/recommend` returns. `false`: keep only the others. Absent: no filter. |
| `method` | — | `bolt11`, `bolt12` or `onchain` (lower case or upper case): keep mints that advertise this payment method in NUT-04 (mint) **or** NUT-05 (melt), on any unit; when `unit` is also given, on **that** unit (the method entry must carry that unit). A side the mint has switched off (`mintDisabled` / `meltDisabled` is `true`: NUT-04 / NUT-05 with `"disabled": true`) does not count, even though `methods` still lists its entries (refined 2026-10-27, as the mintradar.org Dashboard filter). A mint whose methods are unknown (`methods: null`) never matches. Any other value, an empty value or a repeated parameter is a `400`. |
| `maxInputFeePpk` | — | Integer 0 to 1000000: keep mints whose **active** keysets for `unit` (every unit when `unit` is not given) **all** have `inputFeePpk <= maxInputFeePpk`. A mint whose fee is unknown (`null`) for any keyset in that scope, a mint without an active keyset in that scope and a mint whose keysets were never checked are **excluded** when this filter is used. Anything else is a `400`. |
| `changedSince` | — | Keep mints with at least one confirmed change (see `changes`) **observed after** this time. Accepted: an ISO 8601 time with `Z` or an offset (`2026-10-20T12:00:00Z`; encode a `+` as `%2B`), a bare date (`2026-10-20`, meaning 00:00 UTC) or UNIX seconds (9 to 11 digits). Anything else (no zone on a time, a month 13, an empty value, a repeated parameter) is a `400` `invalid_parameter`. `total` and `truncated` count the matches. The JSON API writes times as ISO 8601; the Nostr tags use UNIX seconds. |
| `include` | — | Comma-separated, exactly the values `facts`, `keysets`, `methods`, `breakdown`, `changes`: add the heavier fields to **every object of the list** (`facts` brings `pubkey`, `firstSeenAt`, `lastOnlineAt`, `sample`, `contactChecks`, `feeExamples`, `limits`, `auditByDirection`, `latency24h` and `nip87`; `keysets` brings `keysets` and `keysetsCheckedAt`; `methods` brings `methods`; `breakdown` brings `scoreBreakdown`; `changes` brings the newest 10 `changes` of each mint and `changesPending`). Without it the list objects do not carry them (it keeps the default list about 20% larger than before the additions instead of about 60%); the single-mint endpoint always does. An unknown value, an empty value or a repeated parameter is a `400` `invalid_parameter`. |
| `limit` | `100` | Integer 1 to 200 (`400` outside that range). |

Order: `score` descending (`null` last), then `uptime7dPct` descending (`null` last), then `name` (the hostname when `name` is `null`), then `url`.

**Example, `nuts`:** `GET /api/v1/wallets/mints?nuts=11,12` returns the mints that declare **both** NUT-11 (P2PK) and NUT-12 (DLEQ proofs) in their `/v1/info` (an entry with `"supported": false` is not a declaration), which are the two a Nutzap (NIP-61) relies on. The mint list is still the default one (online, scored, not a test mint); the filter only narrows it. It states what a mint declares, nothing more.

**Replacing `/mints/recommend`:** `GET /api/v1/wallets/mints?eligible=true&unit=sat&minScore=80&nuts=4,5&limit=5` returns the same mints in the same order as `GET /api/v1/mints/recommend?unit=sat&minScore=80&nuts=4,5&limit=5` (the defaults of `/mints/recommend` are `unit=sat`, `minScore=80`, `limit=5`; the list route has no `unit` default and a larger `limit` range). A test compares the two on a fixture.

### Response

```json
{
  "methodology": 5,
  "generatedAt": "2026-10-12T18:30:12.345Z",
  "count": 1,
  "mints": [
    {
      "url": "https://mint.example.com",
      "name": "Example Mint",
      "status": "online",
      "score": 92,
      "scoreStale": false,
      "scoreCappedNew": false,
      "uptime24hPct": 100,
      "uptime7dPct": 99,
      "uptime30dPct": 98,
      "lastCheckedAt": "2026-10-12T18:29:41.000Z",
      "units": ["sat"],
      "nuts": ["4", "5", "7", "8", "9", "10", "11", "12"],
      "mintDisabled": false,
      "meltDisabled": false,
      "software": "Nutshell/0.21.0",
      "outdated": false,
      "isTest": false,
      "audit": { "swaps7d": 104, "attributedFailures": 0, "fetchedAt": "2026-10-12T17:40:00.000Z" },
      "reviews": { "count": 12, "ratedCount": 10, "avg": 4.6, "operatorCount": 1 },
      "eligibleForRecommendation": true,
      "downSince": null,
      "hasOnion": false,
      "authRequired": { "clear": false, "blind": false },
      "auditNeutralReason": null
    }
  ]
}
```

(`total` and `truncated` are in the envelope of the example: `"count": 1, "total": 1, "truncated": false`.) With `include=facts,keysets,methods,breakdown,changes` every object additionally carries:

```json
"pubkey": "02a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f0",
"firstSeenAt": "2026-01-01T00:00:00.000Z",
"lastOnlineAt": "2026-10-12T18:29:41.000Z",
"sample": { "probes24h": 288, "swaps7d": 104 },
"contactChecks": [{ "kind": "email", "formatValid": true, "domainResolves": true, "checkedAt": "2026-10-20T12:00:00.000Z" }, { "kind": "nostr", "formatValid": true, "domainResolves": null, "checkedAt": "2026-10-20T12:00:00.000Z" }],
"feeExamples": [{ "unit": "sat", "inputFeePpk": 100, "examples": [{ "proofs": 1, "fee": 1 }, { "proofs": 16, "fee": 2 }, { "proofs": 100, "fee": 10 }] }],
"limits": { "mint": [{ "method": "bolt11", "unit": "sat", "min": 1, "max": 100000 }], "melt": [{ "method": "bolt11", "unit": "sat", "min": null, "max": null }] },
"latency24h": { "p50Ms": 138, "p95Ms": 412, "samples": 286 },
"nip87": { "announcement": "seen", "dMatchesInfoPubkey": true, "eventCreatedAt": "2026-03-14T09:20:00.000Z", "checkedAt": "2026-10-31T06:00:12.000Z" },
"auditByDirection": { "mint": { "attempts": 62, "failures": 6, "windowDays": 7, "source": "cashu.info", "syncedAt": "2026-10-21T04:00:00.000Z" }, "melt": { "attempts": 64, "failures": 13, "windowDays": 7, "source": "cashu.info", "syncedAt": "2026-10-21T04:00:00.000Z" } },
"keysets": [{ "id": "00aaaaaaaaaaaaaa", "unit": "sat", "active": true, "inputFeePpk": 100, "finalExpiry": null, "idVersion": "v1", "idValid": true }],
"keysetsCheckedAt": "2026-10-12T18:00:03.000Z",
"methods": { "mint": [{ "method": "bolt11", "unit": "sat", "minAmount": 1, "maxAmount": 100000 }], "melt": [{ "method": "bolt11", "unit": "sat", "minAmount": null, "maxAmount": null }] },
"scoreBreakdown": { "uptime": { "points": 40, "max": 40 }, "audit": { "points": 25, "max": 25 }, "nuts": { "points": 12, "max": 15 }, "version": { "points": 15, "max": 15 }, "contact": { "points": 0, "max": 5 }, "newMintCap": { "points": 0, "cap": 75 }, "sum": 92 },
"changes": [{ "type": "input_fee_changed", "field": "input_fee", "oldValue": "sat: 0 ppk", "newValue": "sat: 100 ppk", "observedAt": "2026-10-19T09:05:11.000Z", "firstSeenAt": "2026-10-19T08:05:09.000Z" }]
```

`GET /api/v1/wallets/mints/{url}` returns `{ "methodology", "generatedAt", "mint": { … }, "canonicalUrl" }` with the same mint object, **including** `contactChecks`, `feeExamples`, `limits`, `auditByDirection`, `keysets`, `keysetsCheckedAt`, `methods`, `scoreBreakdown`, `changes` and `changesPending`. If no mint has exactly the normalised URL but **exactly one** mint has a URL that differs from it only in the **letter case of the path** (same scheme and host), that mint is returned with `200` and `canonicalUrl` set to its stored URL; with several such mints, or none, the answer is the `404` below. `canonicalUrl` is `null` when the URL you asked for is the stored one. The URL is normalised exactly like stored mint URLs (scheme `https`, lower-case host, a lone trailing slash after the bare host removed; a path is kept as it is, including its case) and checked for a well-formed public `https://` URL (at most 500 characters, no user name or password, a host name with at least one dot or a public IP address) without any DNS lookup or outbound request: a URL with any scheme other than `http` or `https` (`ftp://…`, `javascript:…`, `data:…`) or a malformed one is `400 invalid_url` (`http://` is still normalised to `https://`), an unknown mint `404 mint_not_found`. A test, archived or offline mint is returned when asked for by URL; `status` and `isTest` tell them apart.

| Envelope field | Type | Notes |
|---|---|---|
| `methodology` | integer | Version of the Reliability Score formula (`METHODOLOGY_VERSION`, see "Stability"). |
| `generatedAt` | string, ISO 8601 UTC | When the snapshot behind the answer was read from the database (at most 60 s old; identical for every caller of one snapshot). |
| `count` | integer | Length of `mints` (list only). |
| `total` | integer | How many mints match the filters **before** `limit` is applied (list only; added 2026-10-20). |
| `truncated` | boolean | `true` when `total` is greater than `count`, that is `limit` cut the list (list only; added 2026-10-20). |
| `canonicalUrl` | string \| null | Single-mint endpoint only (added 2026-10-20): `null` when the URL you asked for is the stored one, otherwise the stored URL (see above). |

| Mint field | Type | Notes |
|---|---|---|
| `url` | string | Normalised mint URL (see above). |
| `name` | string \| null | The cleaned display name the website uses; `null` means show the hostname (also for mints on MintRadar's hidden-names list). Untrusted text: render as plain text. |
| `status` | `"online"` \| `"offline"` \| `"degraded"` \| `"archived"` | `online`: the latest probe succeeded. `offline`: the latest probe failed (or the mint was never probed). `degraded`: the latest probe failed and either the mint has at least 4 probes in the last 24 hours and none of them succeeded, or that failed probe is more than 24 hours old. `archived`: the latest probe failed and the last successful probe was more than 30 days ago (checked first; a mint that never had a successful probe is not archived). The website uses the same rule (shared code), so it shows the same state: `degraded` reads "Degraded" there. |
| `score` | integer 0–100 \| null | The stored Reliability Score (operational health: uptime 40, audit 25, NUTs 15, software version 15, contact 5). `null` until the first probe. |
| `scoreStale` | boolean | `true` when `status` is not `online` (offline, degraded or archived), `false` when it is online. The `score` of a mint that is not online is the **last measured one**: the mint is not reachable now, so the score says nothing about the present. Derived from `status` only; the score value is not changed. Always present, also in the default list. (Added 2026-10-21.) |
| `scoreCappedNew` | boolean | `true` while the mint is younger than 30 days: its score is capped at 75. |
| `uptime24hPct`, `uptime7dPct`, `uptime30dPct` | integer \| null | Share of successful probes in the last 24 hours / 7 days / 30 days (percent, rounded); `null` when there was no probe in the window. `uptime30dPct` was added on 2026-10-25 (on every object, the default list included). |
| `lastCheckedAt` | string, ISO 8601 UTC \| null | Latest probe. |
| `units` | string[] \| null | Units the mint lists (`sat`, `usd`, `eur`, …); `null` when unknown. `units` and the `unit=` filter list the units for which the mint declares a payment method (NUT-04/05); units that appear only in keysets (`include=keysets`) are not included, so a mint with no declared methods has `units: null`. |
| `nuts` | string[] \| null | NUT numbers the mint advertises (ascending, as strings); a NUT whose `/v1/info` entry has `"supported": false` is **not** counted as supported and is not listed (since methodology 4, 2026-10-21); `null` when unknown. |
| `mintDisabled`, `meltDisabled` | boolean \| null | `true` when the mint lists NUT-04 (minting) / NUT-05 (melting) in its `/v1/info` with `"disabled": true`: it does not issue new ecash / does not pay out right now. `false` when the NUT is listed without it or not listed; `null` when the mint's NUTs are unknown. The NUT itself stays in `nuts` (it is declared), so `nuts` and the `nuts=` filter are unchanged; check these two before you offer a mint for deposits or withdrawals. On every object, the default list included. (Added 2026-10-27.) |
| `software` | string \| null | The mint's own version string (`Nutshell/0.21.0`); untrusted text, at most 100 characters. |
| `outdated` | boolean \| null | `true`: two or more minor versions behind the newest stable release of that software family. `false`: not outdated. `null`: unknown software, no or unreadable version, or no reference release. |
| `isTest` | boolean | On MintRadar's manual test-mint list. Test mints are never recommended. |
| `audit` | object \| null | cashu.info's 7-day window: `swaps7d` (all swaps), `attributedFailures` (failures cashu.info attributes to this mint, never more than `swaps7d`), `fetchedAt` (ISO 8601). `null` when no data is stored. Fewer than 10 swaps or data older than 168 hours scores neutral in the Reliability Score. |
| `reviews` | object | Community Rating, same definitions as the website: `count` (counted NIP-87 reviews), `ratedCount` (how many carry a rating; always an integer, `0` only when no counted review carries one), `avg` (average rating over those, one decimal, `null` when none), `operatorCount` (reviews from a key that is both listed as the mint's Nostr contact and the author of its NIP-87 announcement; they are left out of the other three). |
| `eligibleForRecommendation` | boolean | `true` when the mint is online, has a score, is not a test mint, was first seen at least 14 days ago and its newest probe (`lastCheckedAt`) is at most 3 hours old. |
| `pubkey` | string \| null | **Only with `include=facts`; always on the single-mint endpoint.** The mint's public NUT-06 key as MintRadar last stored it (66 hex characters); `null` when none is stored. Public data the mint publishes itself. (Added 2026-10-20.) |
| `firstSeenAt` | string, ISO 8601 UTC \| null | **Only with `include=facts`; always on the single-mint endpoint.** When MintRadar first saw the mint; `eligibleForRecommendation` counts from this date. |
| `lastOnlineAt` | string, ISO 8601 UTC \| null | **Only with `include=facts`; always on the single-mint endpoint.** Time of the latest successful probe; `null` when the mint never answered. |
| `downSince` | string, ISO 8601 UTC \| null | Start of the **current offline streak**: the first failed probe **after `lastOnlineAt`** (for a mint that never answered: its first failed probe still kept in the 90-day history, so it is never older than that). `null` while `status` is `online`. It is the time of a probe, so it can be up to one probe interval (5 minutes) later than the real outage start. |
| `hasOnion` | boolean | `true` when the mint advertises a Tor (`.onion`) address; `false` when it does not or when that is not known. |
| `authRequired` | object \| null | What the mint **advertises** about authentication: `clear` is `true` when it lists NUT-21 (clear auth) and does not mark it `"supported": false`, `blind` when it lists NUT-22 (blind auth) likewise. MintRadar reads only whether the NUT is listed and does **not** parse `protected_endpoints`, so `true` does not say which endpoints (mint, melt, swap, …) need a token and says nothing about enforcement. `null` when the mint's NUTs are unknown. |
| `sample` | object | **Only with `include=facts`; always on the single-mint endpoint.** How much data the numbers rest on: `probes24h` (probes recorded in the last 24 hours, about 288 for a mint probed every 5 minutes; counted when the snapshot is built) and `swaps7d` (swaps in the stored cashu.info 7-day window, the same number the audit part of the score uses; `null` when no detail is stored). |
| `contactChecks` | object[] | **Only with `include=facts`; always on the single-mint endpoint.** Facts about the contact entries the mint lists in its `/v1/info`, one object per entry (at most 10 entries, at most 3 of kind `email`): `{ kind, formatValid, domainResolves, checkedAt }`. `kind` is `email`, `nostr`, `twitter`, `x`, `telegram`, `signal`, `url` (the mint's `website` entry) or `other`. `formatValid`: `true` when MintRadar **recognises the format** of the value for its kind (e-mail syntax with a punycode-converted domain; for `nostr`, after trimming whitespace and removing an optional `nostr:` prefix: an `npub` or `nprofile` with a valid bech32 checksum and a 32-byte public key (all lower case or all upper case, mixed case is not accepted), 64 hex characters, or a NIP-05 style `name@domain` (name of `a-z 0-9 - _ .`, a public domain name); an `https` URL with a public host name; for every other kind printable text of a sane length). **`false` means "format not recognised by MintRadar"**: it does not say that the contact is wrong, fake or unusable (it may be a form MintRadar does not know), and it is not a warning. `domainResolves`: **e-mail entries and NIP-05 style `nostr` entries only**, `true` when DNS has MX records for the domain (else A/AAAA records, the implicit-MX rule of RFC 5321), `false` when DNS says there are none (including a null MX, RFC 7505), `null` when it does not apply (not an e-mail, an IP literal, `localhost`, a private or reserved name) or the lookup failed or timed out: **`null` means unknown, never `false`**. `domainResolves` is `null` when the DNS check could not be completed at the last check (for example a timeout) or does not apply to the contact; it is checked again on the next contact check, about every 24 hours. If a later check cannot be completed, an earlier true is kept for up to 48 hours after that answer (checkedAt is then the time of that answer); a real false always replaces it. NXDOMAIN and a domain with no mail records (no MX and no A/AAAA records, or a null MX) give `false`. `checkedAt` is ISO 8601 UTC. MintRadar makes **no HTTP request** to any contact value (a URL is checked for its shape only, a Nostr key is not looked up on a relay, and for a NIP-05 style name `/.well-known/nostr.json` is never requested, so `true` does not say that the name exists), asks DNS only for the domain of an e-mail address or a NIP-05 style name, stores **neither the value nor the domain** (only these four fields), re-checks a mint at most once every 24 hours (sooner only when the kinds of its entries changed, and once more after a change of the format rules above) and caches a domain answer for 7 days. An empty array (never `null`) when nothing was checked. These are facts with a time, not a judgement: a failed check is not a warning, the Contact part of the score still means "the mint lists a contact", and the score does not use them. (Added 2026-10-20.) |
| `feeExamples` | object[] | **Only with `include=facts`; always on the single-mint endpoint.** The input fee in plain amounts, for each unit that has an active keyset: `{ unit, inputFeePpk, examples: [{ proofs, fee }] }`. `inputFeePpk` is the largest `input_fee_ppk` among the **active** keysets of that unit (the same "effective fee" as the change log); a keyset that states no `input_fee_ppk`, or a value that is not an integer from 0 to 1,000,000, counts as `0` (the NUT-02 default for a missing field; the `keysets` field still shows `null` for both). `examples` has three entries, for spending 1, 16 and 100 proofs, computed as in NUT-02: the sum of the spent proofs' `input_fee_ppk` divided by 1000, **rounded up**, in the unit (`inputFeePpk` 100: 1 proof costs 1, 16 proofs cost 2, 100 proofs cost 10). Computed from the stored keysets, **not** from a request to the mint. Units without an active keyset are left out; an empty array (never `null`) when no keyset check has stored an active keyset yet. Facts, not a judgement; the score does not use them. (Added 2026-10-21.) |
| `limits` | object \| null | **Only with `include=facts`; always on the single-mint endpoint.** The limits the mint **declares** in its `/v1/info` for NUT-04 (`mint`, Lightning deposits) and NUT-05 (`melt`, Lightning withdrawals): `{ "mint": [{ method, unit, min, max }], "melt": [{ method, unit, min, max }] }`. `min` and `max` are non-negative integers, or `null` when the mint does not declare that limit (or states it in a form that is not a non-negative integer). `null` when neither NUT-04 nor NUT-05 entries are stored. Lightning fee reserves are **not** here: they depend on the invoice and are only known when a quote is requested. The same entries as `methods`, with the amounts under shorter names. (Added 2026-10-21.) |
| `auditByDirection` | object | **Only with `include=facts`; always on the single-mint endpoint.** cashu.info's swaps of the last 7 days split by direction, the same stored data that the audit part of the score counts in total (the score uses the combined number, not these): `{ "mint": { attempts, failures, windowDays, source, syncedAt } \| null, "melt": { … } \| null }`. `mint` = swaps in which this mint was the **destination** (a Lightning deposit, NUT-04), `melt` = swaps in which it was the **source** (a Lightning withdrawal, NUT-05). `attempts` and `failures` are non-negative integers (`failures` counts every failed swap of that direction, including those cashu.info does not blame on the mint, and is never larger than `attempts`), `windowDays` is `7`, `source` is `"cashu.info"`, `syncedAt` is the time MintRadar stored the data (ISO 8601 UTC). A direction is `null` when no numbers are stored for it; a small number of attempts is returned as it is. (Added 2026-10-21.) |
| `latency24h` | object \| null | **Only with `include=facts`; always on the single-mint endpoint.** Response time of the successful probes of the last 24 hours: `{ p50Ms, p95Ms, samples }`, the median and the 95th percentile in whole milliseconds (`percentile_cont` over the probes, not over hourly averages) and how many probes they rest on. `null` when there is no successful probe with a measured time in that window. (Added 2026-10-25.) |
| `nip87` | object | **Only with `include=facts`; always on the single-mint endpoint.** The mint's NIP-87 announcement (Nostr kind 38172) as MintRadar's discovery last stored it from its relays: `{ announcement, dMatchesInfoPubkey, eventCreatedAt }`. `announcement` is `"seen"` (seen on our relays) or `"not_seen"` (none seen on our relays; it may still exist elsewhere). `dMatchesInfoPubkey` is `true` / `false` when the event's `d` tag is shaped like a mint pubkey (66 hex characters, 02/03 prefix) and the mint's /v1/info pubkey is stored, else `null` (not comparable; NIP-87 says the `d` tag SHOULD be the mint pubkey, and anyone can publish an announcement, so a match describes the event, not its publisher). `eventCreatedAt` is the event's `created_at` (ISO 8601), `null` when not seen. `checkedAt` (ISO 8601) is when MintRadar's discovery last ran with a relay completing the kind 38172 query; the key is **omitted** until there has been such a run, and an unsuccessful run (every relay failed or timed out) does not change it. (Added 2026-10-30; `checkedAt` added 2026-10-30.) |
| `auditNeutralReason` | `"low_sample"` \| `"stale"` \| `"no_data"` \| null | Why the audit part of the score is the neutral value 12.5: `low_sample` (fewer swaps than the minimum of 10), `stale` (the stored detail is older than 168 hours), `no_data` (nothing stored). `null` while the audit part is measured. It uses the audit rule of the score (no separate thresholds) and is evaluated when the response is built, so right after a change of the stored detail it can be one probe cycle ahead of `scoreBreakdown.audit`. |
| `keysets` | object[] | **Only with `include=keysets`; always on the single-mint endpoint.** The keysets found by the latest successful check (MintRadar asks each mint once an hour), ordered by `id`: `id`, `unit`, `active`, `inputFeePpk` (integer, or `null` when the mint stated no valid fee), `finalExpiry` (ISO 8601 or `null`), `idVersion` (`v1`, `v2` or `legacy`) and `idValid` (`true` or `false` after MintRadar compared the keyset id with the keys it derives from them; `null` means it could not be verified, for example an inactive keyset or a legacy id). A keyset the mint no longer lists is left out. An empty array when the mint was never checked. |
| `keysetsCheckedAt` | string, ISO 8601 UTC \| null | **Only with `include=keysets`; always on the single-mint endpoint.** Time of the latest successful keysets check; `null` when there was none. |
| `methods` | object \| null | **Only with `include=methods`; always on the single-mint endpoint.** The payment methods the mint advertises, from its stored NUT-04 (`mint`) and NUT-05 (`melt`) entries: `{ "mint": [{ method, unit, minAmount, maxAmount }], "melt": [...] }`. `method` is what the mint advertises (`bolt11`, `bolt12`, `onchain`, …), the amounts are integers or `null` when the mint states none. `null` when neither list is stored; one side is an empty array when only the other is stored. |
| `changes` | object[] | **Only with `include=changes` (the newest 10 per mint); always on the single-mint endpoint (the newest 50).** Confirmed changes in the mint's public data, newest first; an empty array (never `null`) when there are none. Each item is `{ type, field, oldValue, newValue, observedAt, firstSeenAt }`: `type` is one of `pubkey_changed`, `input_fee_changed`, `keyset_added`, `keyset_removed`, `keyset_deactivated`, `keyset_reactivated`, `keyset_final_expiry_changed`, `motd_changed`, `name_changed`, `description_changed`, `contact_changed`, `version_changed`, `nuts_changed`, `methods_changed`; `field` is a short name (`pubkey`, `motd`, `name`, `description`, `description_long`, `contact`, `version`, `nuts`, `methods`, `keyset`, `input_fee`); `observedAt` (ISO 8601 UTC) is when the change was **confirmed** and `firstSeenAt` when the new value was first seen. A difference is recorded only after **two consecutive successful observations** (two probes of `/v1/info`, or two hourly keysets checks), so `observedAt` is later than the first sighting by one interval; a failed or partial answer never counts. `oldValue` and `newValue` are plain text of at most 200 characters, or `null` when there is no old or new side (a keyset added or removed): URLs are replaced by `[link]`, control characters are removed, contacts are only the method kinds and a count (`"email, nostr (2)"`, never a contact value), the version is the string as reported, a public key is its full hex, NUTs and methods are sorted lists (`"4, 5, 7"`, `"mint:bolt11/sat, melt:bolt11/sat"`), an input fee is the largest fee among the active keysets per unit (`"sat: 100 ppk"`). At most 20 rows per mint and UTC day are kept; further changes of that day become one row per `type` whose `newValue` is `"multiple changes"`. Rows are kept for 365 days. These are facts with a source and a time, not a judgement: a change is not a warning and MintRadar does not rate it. The signed health event carries the time of the newest one as `mint_last_change` (UNIX seconds). (Added 2026-10-20.) |
| `changesPending` | object \| null | **Only with `include=changes`; always on the single-mint endpoint.** The differences MintRadar has seen **once** and that wait for their confirming observation: `{ firstSeenAt, diff }`, each `diff` item `{ type, field, oldValue, newValue, firstSeenAt }` in the same text form as `changes` (no `observedAt`); `firstSeenAt` of the object is the earliest one. A pending keysets difference is the difference between the stored keysets and the list seen once (so a new keyset that replaces an old one shows `keyset_added`, `keyset_deactivated` and, when the fee differs, `input_fee_changed`). The next successful observation with the same value confirms it (it then moves to `changes`), a different value replaces it, the old value cancels it. `null` when nothing is pending. Never part of `changes`, never counted by `changedSince` or `mint_last_change`, never announced on Nostr or by DM: a pending difference is not a change and may never become one. (Added 2026-10-25.) |
| `scoreBreakdown` | object \| null | **Only with `include=breakdown`; always on the single-mint endpoint.** The points the score used **at its last computation**: it is written in the same step as `score` (never recomputed when you ask), so its `sum` equals `score` as stored with it. `uptime`, `audit`, `nuts`, `version`, `contact` are `{ points, max }` (maxima 40, 25, 15, 15, 5); `newMintCap` is `{ points, cap }` where `points` is the correction (0 or negative) the 75-point cap for mints younger than 30 days made. Neutral audit data counts 12.5 points, so the five parts can end in `.5`: `sum` = the five parts added, rounded once, plus `newMintCap.points`. `null` until the first probe after this field was introduced (at most one 5-minute cycle). |

The wallet responses never contain IP addresses, AS numbers, hosting organisations, server locations or error messages, reviewer public keys or review texts, or contact details. They do carry the mint's public NUT-06 key (`pubkey`) and whether it advertises a Tor address (`hasOnion`).

**Privacy of your request.** To learn which mints are good without telling MintRadar which one you care about, **download the whole list and filter locally** (the list answer is identical for every caller of one snapshot and can be cached). The single-mint endpoint tells MintRadar which mint you asked about.

### Requests

```bash
# Mints that list sat, score 70 or better (offline, test, archived and unscored mints are left out by default)
curl -s "https://mintradar.org/api/v1/wallets/mints?unit=sat&minScore=70&limit=20"

# One mint
curl -s "https://mintradar.org/api/v1/wallets/mints/https%3A%2F%2Fmint.example.com"

# Conditional request: 304 with no body while nothing changed
curl -si -H 'If-None-Match: "<etag from the last answer>"' "https://mintradar.org/api/v1/wallets/mints?unit=sat"
```

```ts
// Browser or Node 18+; any origin may call these routes
const res = await fetch('https://mintradar.org/api/v1/wallets/mints?unit=sat&minScore=70')
if (!res.ok) throw new Error((await res.json()).error.message)
const { methodology, mints } = await res.json()
```

### CORS

`/api/v1/wallets/*`, `/api/v1/mints/recommend` and `/api/v1/health` (and the unversioned paths) answer **any origin**: `Access-Control-Allow-Origin: *` for `GET`, `HEAD` and `OPTIONS`, no credentials, with `Access-Control-Expose-Headers: ETag, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Deprecation, Sunset, Link` (since 2026-10-20; the last three let a browser wallet read the deprecation notice of `/api/v1/mints/recommend`). A preflight (`OPTIONS`) is answered with `204` and is not counted against any limit. Every other route (notably `probe`, `submit`, `discover` and `notifications`) only serves the MintRadar website's own origins; a browser request from another origin to one of them gets `403` with `{"error":{"code":"cors_forbidden","message":"…"}}`. Requests without an `Origin` header (servers, curl, native apps) are never affected. Since 2026-10-20 `/api/mints/known` is no longer in the list of public routes: it answers only the MintRadar website's own origins (a browser request from another origin gets the same `403`), while requests without an `Origin` keep working.

### Caching

Every successful `GET` of `/api/v1/wallets/*`, `/api/v1/mints/known` and `/api/v1/mints/recommend` carries `Cache-Control: public, max-age=300` and an `ETag` over the body, on a cache hit as well as a miss. The `ETag` is strong on an uncompressed answer; when the web server compresses the answer (every client that sends `Accept-Encoding: gzip`, including browsers and `fetch`) the same value arrives in the weak form `W/"…"`. Treat it as an opaque string and send it back unchanged. Send `If-None-Match` to get `304 Not Modified` (same headers, no body). The data moves with the 5-minute probe cycle, so **poll at most every 5 minutes**; a wallet that fetches the list once when it starts and then every 10 minutes is well within the limits. Error responses are not cached. The read routes of the website that show shared data use the same header form and the same kind of `ETag` with their own `max-age`: `/api/stats` 60 s (`max-age=60`), `/api/stats/reliability-trend` 10 min (`max-age=600`), `/api/stats/reliability-movers` 10 min (`max-age=600`), `/api/mints/swaps` 5 min (`max-age=300`), `/api/mints/audit-cz` 60 s (`max-age=60`), `/api/mints/nostr-reviews` 2 min (`max-age=120`); they are internal and carry no stability guarantee.

### Rate limits

| Routes | Limit |
|---|---|
| `/api/v1/wallets/*` and `/api/v1/mints/recommend` | **300 requests per minute per IP address**, one counter shared by `/api/v1/wallets/*` and `/api/v1/mints/recommend` (the unversioned `/api/...` paths count the same); separate from the 60/min counter |
| `/health`, `/api/stats`, `/api/mint/icon` | no limit (read-only, cached) |
| the website's own read routes: `/api/v1/mints/{known,history,version-history,outages,changes,nostr-reviews,swaps,audit-cz}`, `/api/v1/stats/{reliability-trend,reliability-movers}` (since 2026-10-21) | **150 requests / minute / IP**, one counter for all of them |
| every other read route (`/api/v1/mint/probe` included) | **60 requests / minute / IP** |

Responses of limited routes carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix time, seconds, when the window ends). Every `429` carries `Retry-After` (seconds). Preflight requests are not counted. Counters are kept in memory and reset on a restart.

### Errors

The wallet routes answer errors as JSON:

```json
{ "error": { "code": "invalid_parameter", "message": "minScore must be an integer from 0 to 100" } }
```

| Status | `code` | When |
|---|---|---|
| `400` | `invalid_parameter` | a list query value is present but invalid |
| `400` | `invalid_url` | the `{url}` is not valid percent-encoding, has a scheme other than `http`/`https`, or is not a well-formed public `https://` URL |
| `404` | `mint_not_found` | no tracked mint has this URL |
| `404` | `not_found` | unknown route below `/api/v1` (or `/api/wallets`) |
| `429` | `rate_limited` | over 300 requests per minute; also carries `retryAfterSec` |
| `500` | `internal_error` | server error |

Every unknown path below `/api/v1/` is a JSON `404` in this envelope (`/api/v1/foo` gives `{"error":{"code":"not_found","message":"Unknown API route"}}`); an unknown path below the unversioned `/api/` is a JSON `404` `{"error":"Not found"}`. Neither is ever an HTML page. The other routes keep their older shape `{ "error": "text" }` (see "Error Responses"), except the CORS rejection above.

### Stability

- Inside v1 a field is **never renamed or removed**, and its type does not change; changes are **additive** (new fields, new optional parameters). Clients must ignore fields they do not know.
- A removal is announced in this document and on [mintradar.org/for-wallets](https://mintradar.org/for-wallets#stability) at least **90 days** before it takes effect. A route that is going away also says so in its responses: `Deprecation: @<unix seconds>` (RFC 9745, the day of the announcement), `Sunset: <HTTP-date>` (the earliest day of removal) and `Link: <successor>; rel="successor-version"`. Only the route below sends them today; every other route does not.
- **Deprecated: `GET /api/v1/mints/recommend`** (and the unversioned `/api/mints/recommend`, the same route), **since 2026-10-20, sunset 2027-01-26** (98 days). It keeps answering exactly as before until then and sends `Deprecation: @1792454400`, `Sunset: Tue, 26 Jan 2027 00:00:00 GMT` and `Link: <https://mintradar.org/api/v1/wallets/mints?eligible=true&unit=sat&minScore=80&limit=5>; rel="successor-version"`. Replacement: `GET /api/v1/wallets/mints?eligible=true&unit=sat&minScore=80&nuts=4,5&limit=5` (see "Replacing `/mints/recommend`").
- **Additions to v1** (nothing was renamed, removed or changed): 2026-10-20 — the list parameters `nuts` and `eligible`; unknown paths below `/api/v1/` answer a JSON `404`. 2026-10-20 (second addition) — the list parameters `method`, `maxInputFeePpk` and `include`; the list envelope fields `total` and `truncated`; the single-mint envelope field `canonicalUrl` and the case-insensitive path lookup behind it (a `404` that used to be returned for a path that differed only in case can now be a `200`); the mint fields `downSince`, `hasOnion`, `authRequired`, `auditNeutralReason` (on every object) and `pubkey`, `firstSeenAt`, `lastOnlineAt`, `sample`, `keysets`, `keysetsCheckedAt`, `methods`, `scoreBreakdown` (single-mint endpoint and `include=`); the exposed CORS headers `Deprecation`, `Sunset` and `Link`. The mint object now carries `pubkey` and `hasOnion`, which earlier text of this document excluded; the rest of the privacy list is unchanged. 2026-10-20 (third addition) — the mint field `changes` (single-mint endpoint and `include=changes`), the list parameter `changedSince` and the `include` value `changes`; the default list is unchanged. 2026-10-20 (fourth addition) — the mint field `contactChecks` (single-mint endpoint and `include=facts`); the default list is unchanged. 2026-10-21 (fifth addition) — the mint fields `feeExamples`, `limits` and `auditByDirection` (single-mint endpoint and `include=facts`); the default list is unchanged. 2026-10-25 — the mint field `changesPending` (single-mint endpoint and `include=changes`; never counted by `changedSince`); the default list is unchanged. 2026-10-25 (second addition) — the mint field `uptime30dPct` (on every object, the default list included) and the mint field `latency24h` (single-mint endpoint and `include=facts`). 2026-10-30 — the mint field `nip87` (single-mint endpoint and `include=facts`); the default list is unchanged. 2026-10-21 — the mint field `scoreStale` (on every object, the default list included: a boolean that is `true` when `status` is not `online`; the score of such a mint is the last measured one; the score itself is unchanged).
- **Refinements in v1** (no field or parameter renamed, removed or retyped; a result can differ): 2026-10-27 — the `method` filter no longer counts a NUT-04 or NUT-05 side that the mint has switched off (`"disabled": true`, reported as `mintDisabled` / `meltDisabled`), matching the mintradar.org Dashboard method filter. A mint that lists a method only on a switched-off side drops out of that `method=` result; `methods`, `limits`, `nuts` and the `nuts=` filter are unchanged.
- `methodology` is an integer that changes **whenever the score formula changes** (weights, audit rule, version rule, NUT rule, new-mint cap). `score` values from different `methodology` numbers are not comparable. The history lives in `backend/src/shared/methodology.ts` (`METHODOLOGY_CHANGES`) and is shown on [mintradar.org/methodology](https://mintradar.org/methodology):

| Version | Date | Change |
|---|---|---|
| 1 | 2026-09-12 | Initial formula: uptime 40, audit 25 (audit.8333.space), NUTs 15, software version 15, contact 5; new mints capped at 75 for 30 days. |
| 2 | 2026-10-08 | Audit part now from cashu.info: failures attributed to the mint divided by swaps in 7 days; neutral under 10 swaps or without recent data. |
| 3 | 2026-10-09 | Version part follows one rule: outdated means two or more minor versions behind the newest stable release; zero or one behind scores full points. |
| 4 | 2026-10-21 | NUT part: a NUT entry with "supported": false in /v1/info no longer counts as support for the NUT component; a NUT counts when the mint lists it and does not mark it as not supported. |
| 5 | 2026-10-27 | NUT part: a NUT the mint has switched off (NUT-04 minting or NUT-05 melting with "disabled": true in /v1/info) no longer counts for the NUT component. |
| 6 | 2026-10-28 | Recommendation gate: a mint is eligible only if its newest probe is at most 3 hours old; the score formula is unchanged. |

- **Signed health assertions on Nostr** (kind 30385, early version, published under the key `health@mintradar.org`) carry the same `score` as `rank` and the same `methodology` integer. They are not part of this HTTP API; see [mintradar.org/for-wallets](https://mintradar.org/for-wallets#signed-health-assertions) and [nostr-health-assertions.md](nostr-health-assertions.md).

  **Find the record of a mint from the API**

  To read the signed record of a mint you found through the API, use its `url` field as the `d` tag, query the relays published with the signed health assertions with the filter for one mint, and check the signature against the pinned MintRadar Health key. The record also has an address (naddr) that Nostr clients understand: kind `30385`, the MintRadar Health key, the `d` tag, and the relays as hints. For people, `https://njump.me/<naddr>` opens the record in a browser. njump.me is an external site, so offer the link as an option. The API returns neither the naddr nor the link: build them from the `url` field, as below.

  ```js
  // mint.url is the url field of the wallet API
  const filter = { kinds: [30385], authors: ['2ddd7ce9833d2ed8a0bfaaf903cc71f65641f20d8f8142130163a625aa6b941c'], '#d': [mint.url] }
  const naddr = nip19.naddrEncode({
    kind: 30385,
    pubkey: '2ddd7ce9833d2ed8a0bfaaf903cc71f65641f20d8f8142130163a625aa6b941c',
    identifier: mint.url,
    relays: ['wss://nostr.mintradar.org', 'wss://nos.lol', 'wss://relay.primal.net'],
  })
  const njump = `https://njump.me/${naddr}` // optional, for people
  ```

- Everything under "Internal routes" below has **no stability guarantee**.

---

## Rate Limits

| Endpoint type | Limit |
|---|---|
| `/api/v1/wallets/*` and `/api/v1/mints/recommend` | **300 requests per minute per IP address**, one counter shared by `/api/v1/wallets/*` and `/api/v1/mints/recommend` (the unversioned `/api/...` paths count the same); separate from the 60/min counter |
| The website's own read endpoints: `/api/mints/{known,history,version-history,outages,changes,nostr-reviews,swaps,audit-cz}`, `/api/stats/{reliability-trend,reliability-movers}` (`/api/mints/known` was exempt until 2026-10-20; the separate bucket exists since 2026-10-21) | **150 requests / minute / IP**, one counter for all of them, separate from the 60/min counter |
| Every other read endpoint **except** the wallet routes and `/health`, `/api/stats` and `/api/mint/icon` (these three are exempt), `/api/mint/probe` included | **60 requests / minute / IP** |
| `/api/mint/submit` (POST) | **20 requests / hour / IP** |
| `/api/mints/discover` (POST) | **3 requests / hour / IP** by default (`"source": "auto"`), **10 requests / hour / IP** with `"source": "bulk"` (two independent counters) |
| `/api/mint/probe` for a URL that is **not** a tracked mint | additionally **10 requests / minute**, **60 requests / hour** and **3 concurrent probes** per IP (tracked mints: global limit only) |

Rate limit headers are returned on every non-exempt read endpoint:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1760293860
```

(`/api/v1/wallets/*` and `/api/v1/mints/recommend` report `X-RateLimit-Limit: 300`, the website read endpoints above `150`.)

Exceeding a limit returns HTTP `429 Too Many Requests` with a `Retry-After` header (seconds). The wallet routes answer with the error envelope described under "API for wallets (v1)"; every other route with:

```json
{ "error": "Too many requests" }
```

---

## Endpoints

`GET /api/` (also `/api/v1`) returns a small JSON pointer (`/api` without the trailing slash is redirected to `/api/` with a `301` by the web server; follow redirects): `{"name":"MintRadar API","docs":"<this document on GitHub>","health":"/api/v1/health"}`.

### `GET /health` and `GET /api/v1/health`

Health check. Available at `/health` and `/api/v1/health` (identical payload). There is no `/api/health`. No rate limiting on either path.

**Response:**
```json
{ "status": "ok", "ready": true, "timestamp": "2026-06-25T10:00:00.000Z", "lastProbeAt": "2026-06-25T09:58:12.000Z", "lastVantageOutageAt": null, "lastAuditSyncAt": "2026-06-25T06:00:03.000Z", "lastReviewsSyncAt": "2026-06-25T07:12:44.000Z", "auditUpstream": "ok", "auditUpstreamCheckedAt": "2026-06-25T09:53:00.000Z",
  "auditCz": { "lastSyncAt": "2026-06-25T09:53:00.000Z", "mintsStored": 62, "swapsStored": 98, "skipped": { "mints": 0, "swaps": 2 } },
  "sources": { "ownProbe": { "usedForScore": true, "lastProbeAt": "2026-06-25T09:58:12.000Z" },
    "cashuInfo": { "usedForScore": true, "lastSyncAt": "2026-06-25T09:53:00.000Z", "status": "ok" },
    "reviews": { "usedForScore": false, "lastSyncAt": "2026-06-25T07:12:44.000Z" },
    "audit8333": { "usedForScore": false, "lastSyncAt": "2026-06-25T06:00:03.000Z", "status": "ok" } } }
```

`ready` is a boolean: `false` while the backend is starting (database routes under `/api/` and `/sitemap.xml` answer `503` with `{"error":"starting"}` and `Retry-After: 2` then), `true` afterwards. `/health` itself always answers `200`; while `ready` is `false` it makes no database call, so `lastAuditSyncAt` and `lastReviewsSyncAt` are `null` (and `lastProbeAt` is `null` too until the first probe cycle).

`lastProbeAt` is when the 5-minute probe cycle last finished sweeping every mint (not merely "process is alive") — `null` until the first cycle completes after a restart.

`lastVantageOutageAt` is when a probe cycle was last classified as a suspected outage on MintRadar's own side (ISO 8601 UTC), or `null`. A cycle is classified when at least half of the mints that were online (and at least 20) fail from our server with network errors while cashu.info, which probes on its own, still sees them up; the failures of that cycle are then not recorded, so they leave a gap in the history and trigger no notification. In memory only: `null` after every restart until the next such cycle, and in normal operation it stays `null`.

`lastAuditSyncAt` is the newest `audit_synced_at` in the database (`MAX(audit_synced_at)` over all mints, cached in-process for 30s), so it **survives restarts and deploys**. It is `null` only if no mint has ever synced. If it stays old, the audit.8333.space data (Audit tab, `auditRecent*`) is stale; the Reliability Score's audit part does not depend on it (it uses cashu.info, see `auditCzFetchedAt`).

`lastReviewsSyncAt` is the newest `reviews_checked_at` in the database (`MAX(reviews_checked_at)`, read in the same query and the same 30s cache as `lastAuditSyncAt`), so it also **survives restarts**. It is `null` only if no mint has ever been reviews-synced. It is stamped for every mint that at least one relay answered for (and whose DB write completed) in the hourly reviews sync, even when nothing changed, so it should advance about every 60 minutes (+ up to a few minutes of start offset and jitter). Caveat: an answer with no events still counts, so this proves the sync job is running and at least one relay is reachable, not that every relay is. If no relay answers at all, nothing is stamped.

`auditUpstream` is `"ok"`, `"partial"`, `"down"` or `"unknown"` and `auditUpstreamCheckedAt` is an ISO timestamp or `null`. Since 2026-10-29 they describe **cashu.info**, the audit source of the Reliability Score, and are the same values as `sources.cashuInfo.status` and `auditCz.lastSyncAt`: the outcome of the **last cashu.info sync cycle** (every 10 minutes), **not a live check** — `/health` never calls the upstream. `ok` = both feeds were stored in that cycle, `partial` = one, `down` = none, `unknown` (with `auditUpstreamCheckedAt: null`) = no cycle yet since the last restart or deploy, at most about 10 minutes. Before 2026-10-29 these two fields described the legacy audit.8333.space; that outcome is now only in `sources.audit8333.status`. The field names are kept so existing clients keep working; note the new value `partial`.

`auditCz` reports the **last cashu.info sync cycle** (every 10 minutes, see `GET /api/mints/audit-cz`), in memory only: `lastSyncAt` is when that cycle finished, `mintsStored` / `swapsStored` are the rows written (`null` when that response failed and nothing was written), `skipped` the number of items dropped as malformed or unknown per response. All fields are `null` until the first cycle after a restart. A `skipped` above 0 means the upstream sent something we do not parse. Counts only — no item contents, URLs or error strings.

`sources` (additive, 2026-10-20) groups the same facts by input, so it is clear what feeds the Reliability Score. Every entry has `usedForScore` (boolean) and a time; `status` is a short word. Nothing else is in it — no host name, URL or relay.

| Entry | Fields | Feeds the Reliability Score |
|---|---|---|
| `sources.ownProbe` | `lastProbeAt` (the same value as top-level `lastProbeAt`) | **yes** — MintRadar's own 5-minute probes: uptime, NUTs, software version and contact |
| `sources.cashuInfo` | `lastSyncAt` (the last cashu.info sync cycle, as `auditCz.lastSyncAt`), `status` | **yes** — the audit part (25 points) comes from cashu.info's 7-day swap data. `status`: `ok` (both feeds stored in the last cycle), `partial` (one), `down` (none), `unknown` (no cycle yet since the last restart) |
| `sources.reviews` | `lastSyncAt` (as top-level `lastReviewsSyncAt`) | no — Community Rating is shown next to the score and never part of it |
| `sources.audit8333` | `lastSyncAt` (as top-level `lastAuditSyncAt`), `status` (the last audit.8333.space sync attempt, 6h cron: `ok`, `down`, `unknown`; no longer the top-level `auditUpstream`) | **no — legacy, display only.** audit.8333.space data is shown on a mint's Audit tab; since methodology 2 (2026-10-08) it is not an input of the score |

Only timestamps, counts and these short status words are exposed — no error messages, upstream URL or status codes.

---

### `GET /api/mints/known`

All known mints with current online status, latency, reliability score, and metadata. Returns **every row** the server knows, including archived mints (offline 30+ days) — nothing is filtered out; use the `archived` and `degraded` flags on each object to tell them apart.

**Access (changed 2026-10-20):** this is the website's own data feed, an **internal** route. A browser request from another origin gets `403` `{"error":{"code":"cors_forbidden",…}}` and the answer carries no `Access-Control-Allow-Origin: *` (it was public with `*` before); the website's own origins, servers and tools that send no `Origin` header work as before. It counts against the general limit of **60 requests / minute / IP** (it was exempt); the website needs about one request per page load (it caches the answer for 5 minutes in the browser). Wallets should use [`/api/v1/wallets/mints`](#api-for-wallets-v1), a compact summary with a stability guarantee that is open to any origin.

**Response:** Array of mint objects. Every response carries `Cache-Control: public, max-age=300` and an `ETag` (`If-None-Match` gives `304`; see "Caching" for the weak form). This array also carries website-only fields (`ipAddress`, `netAsn`, …) that may change.

`scoreBreakdown` (additive, 2026-10-25) is the **stored** breakdown of `reliabilityScore` (the record written together with the score: `{ uptime, audit, nuts, version, contact: { points, max }, newMintCap: { points, cap }, sum }`, the same shape as the wallet API field), or `null` when none is stored (records from before the breakdown was stored, or an invalid one). Mint Detail's score modal shows these points; it never recomputes them from live data while a stored breakdown exists.

`softwareLatest` (additive, 2026-10-09) is `{ "major": 0, "minor": 21 }`, the latest release line of **this mint's own software family** (Nutshell, cdk-mintd), or `null` for other software and for mints without a version. It is the ONE "latest" the stored `reliabilityScore` (version component) and every "outdated" label are measured against: a mint is "outdated" when it is two or more minor versions behind it (`docs/claude/scoring-and-probing.md`). It comes from the GitHub release catalog (no pre-releases, 14-day grace period) and falls back to the highest stable version that at least two distinct tracked mints report exactly (no value, `null`, when none qualifies).

```json
[
  {
    "url": "https://mint.example.com",
    "name": "Example Mint",
    "iconUrl": null,
    "degraded": false,
    "online": true,
    "latencyMs": 142,
    "version": "0.16.3",
    "nutCount": 11,
    "tosUrl": null,
    "descriptionLong": null,
    "nutsLimits": { "4": {}, "5": {}, "7": {} },
    "auditNMints": 1200,
    "auditNMelts": 950,
    "auditNErrors": 3,
    "auditCheckedAt": "2026-06-24T08:00:00.000Z",
    "auditSyncedAt": "2026-06-25T06:00:03.000Z",
    "auditRecentTotal": 100,
    "auditRecentErrors": 2,
    "auditCzTotal": 104,
    "auditCzBlamed": 0,
    "auditCzFetchedAt": "2026-06-25T09:30:00.000Z",
    "reliabilityScore": 88,
    "uptimePct24h": 100,
    "discoveredAt": "2025-11-01T12:00:00.000Z",
    "serverLocation": "Frankfurt am Main, DE",
    "ipAddress": "188.166.166.165",
    "netAsn": 14061,
    "netOrg": "DigitalOcean, LLC",
    "netCountry": "US",
    "hasOnion": false,
    "lastCheckedAt": "2026-06-25T09:55:00.000Z",
    "reviewCount": 90,
    "reviewAvgRating": 4.8,
    "reviewRatedCount": 83
  }
]
```

`reviewCount` = counted NIP-87 reviews of the mint (reviews from a key that is both listed as the mint's Nostr contact and the author of its NIP-87 announcement are left out; empty events are not counted); `reviewAvgRating` = their average over the rated ones (one decimal, `null` when none is rated); `reviewRatedCount` = how many of them carry a rating, the n behind the average (additive field, `null` until the backend's startup recount or the next review sync has filled it). The website's Dashboard "Rating" sort orders by the confidence-adjusted average `(n·avg + 5·3.5) / (n + 5)` over `reviewAvgRating` and `reviewRatedCount` (mints with few reviews rank lower; unrated mints last); the displayed values are not changed. `reviewWeightedRating` (an older server-side weighted value) is still returned, but the website no longer sorts by it. `degraded` and `archived` follow the rules under `status` in "API for wallets (v1)" (`degraded`: the latest probe failed and either at least 4 probes in the last 24 hours all failed or that failed probe is more than 24 hours old). `nutsLimits` keys are NUT numbers as strings. `ipAddress` (public IPv4 of the mint host, our own DNS lookup), `netAsn` / `netOrg` / `netCountry` (AS number, organisation and ISO country of that IP block, from ipinfo.io) and `hasOnion` (the mint's `/v1/info` lists a `.onion` address) are measured by MintRadar itself; each is `null` until first measured. Fields the example leaves out (website-only, they may change): `nameFull` (only when `name` was shortened), `lastOnlineAt`, `archived`, `softwareLatest`, `units`, `mintMethods`, `meltMethods`, `pubkey`, `auditAvgTimeMs`, `nostrAnnouncedAt`, `nostrAnnounceId`, `nostrAnnouncePubkey`, `nostrAnnounceD`, `lastError`, `uptimePct7d`, `operatorReviewCount`, `reviewSurge`, `reviewWeightedRating`. `uptimePct24h` and `uptimePct7d` are `null` when there was no probe in the window.

---

**Audit timestamps (per mint, both ISO 8601 UTC):** `auditCheckedAt` is the auditor's own last check (audit.8333.space `updated_at`); `auditSyncedAt` is when MintRadar's 6-hourly job last wrote that mint's audit data. They can differ a lot — `auditCheckedAt` may be days or months old while `auditSyncedAt` is recent, or both may age together while the upstream is unreachable. `auditRecentTotal`/`auditRecentErrors` are the audit.8333.space rolling-window figures of the Audit tab; since 2026-10-08 they are an archive and no longer feed the Reliability Score. **Audit inputs of the Reliability Score (additive, `null` when absent):** `auditCzTotal` (swaps in cashu.info's 7-day window), `auditCzBlamed` (the swaps whose failure cashu.info attributes to the mint) and `auditCzFetchedAt` (ISO 8601 UTC, when that detail was stored). The audit component is 0–25 from `auditCzBlamed / auditCzTotal` (0 % = 25, <1 % = 20, <5 % = 15, <15 % = 10, else 5); fewer than 10 swaps, null values, or a `auditCzFetchedAt` more than 168 hours old score a neutral 12.5.

### `GET /api/stats`

Network-wide statistics. `totalMints` counts **all mints known to the server, archived ones included** — it equals the length of the `/api/mints/known` array. `onlineMints` / `offlineMints` count mints whose latest probe succeeded / failed (a mint that was never probed is in neither). `avgReliabilityScore` is the mean over online mints (`null` when none); `reliabilityDistribution` counts online mints with a score below 40 (`low`), 40 to 69 (`moderate`) and 70 or more (`high`); `avgLatency24h` is the **median** latency in ms of successful probes in the last 24 hours (probes of 0 ms or 10 s and more are ignored); `nutAdoption` covers online mints that report NUTs; `top5ByReliabilityScore` leaves out test mints and mints first seen less than 14 days ago.

**Response:**
```json
{
  "totalMints": 97,
  "onlineMints": 72,
  "offlineMints": 25,
  "avgReliabilityScore": 71,
  "avgLatency24h": 210,
  "reliabilityDistribution": { "low": 12, "moderate": 28, "high": 32 },
  "nutAdoption": [
    { "nut": "NUT-04", "count": 68, "percent": 94 }
  ],
  "top5ByReliabilityScore": [
    { "url": "https://mint.example.com", "name": "Example Mint", "reliabilityScore": 93 }
  ]
}
```

---

### `GET /api/mints/history`

Bucketed uptime/latency/reliability history for a single mint.

**Query parameters:**

| Parameter | Required | Values | Default |
|---|---|---|---|
| `url` | ✅ | `https://…` | — |
| `period` | ❌ | `24h`, `7d`, `30d`, `90d` | `24h` |

**Response:**
```json
{
  "url": "https://mint.example.com",
  "period": "7d",
  "segments": [
    {
      "bucket": "2026-06-18T00:00:00.000Z",
      "online": true,
      "latencyMs": 138,
      "total": 288,
      "onlineCount": 288,
      "uptimePct": 100,
      "reliabilityScore": 91
    }
  ],
  "uptimePct": 99,
  "avgLatencyMs": 145,
  "p50LatencyMs": 131,
  "p95LatencyMs": 402,
  "prevUptimePct": 98,
  "prevAvgLatencyMs": 152
}
```

`p50LatencyMs` / `p95LatencyMs` (additive, 2026-10-25): the median and the 95th percentile of the response time of the **successful probes with a measured latency** in the selected period (`percentile_cont` over the single probes, not over the bucket averages), whole milliseconds; `null` when the period has none. `avgLatencyMs` stays the mean.

`reliabilityScore` in segments is `null` for records before reliability score history was introduced (historical backfill not available). The response also carries `earliestCheckedAt` (first probe ever stored for the mint, or `null`), `periodDays`, `daysOfDataAvailable`, `prevPeriodInsufficientHistory` (boolean) and a legacy `history` array (`online`, `latencyMs`, `checkedAt` per segment). An unknown `period` falls back to `24h` (no `400`); the older `days=7` is read as `period=7d`.

---

### `GET /api/mints/outages`

Outage blocks of one mint for Mint Detail (History tab). **Query parameters:** `url` (required, `https://…`), `days` (optional, 1–90, default 30). An outage is a run of **at least 2** consecutive failed probes (a single failed probe is ignored as noise).

**Response:**
```json
{
  "sinceLastOutageMs": null,
  "avgRecoveryMs": 5400000,
  "outageCount": 3,
  "recoveredCount": 2,
  "ongoing": true,
  "currentOutage": { "startedAt": "2026-10-25T06:00:00.000Z", "durationMs": 21600000 },
  "outages": [
    { "startedAt": "2026-10-25T06:00:00.000Z", "durationMs": 21600000, "error": "offline", "ongoing": true, "truncatedAtWindowStart": false }
  ]
}
```

- `ongoing` / `currentOutage` (additive, 2026-10-25): `true` and `{ startedAt, durationMs }` when the newest probe of the window is part of an outage; its duration runs to the time of the answer. `false` / `null` otherwise.
- `avgRecoveryMs`: the mean duration of the **recovered** outages only (an ongoing outage has no recovery time yet), whole milliseconds; `null` when none recovered (changed 2026-10-25: it used to include the open block). `recoveredCount` (additive) is how many it rests on.
- `sinceLastOutageMs`: time since the end of the newest recovered outage; `null` while an outage is ongoing (changed 2026-10-25) and when there was none.
- `outageCount`: all outages in the window, the ongoing one included. `outages`: the newest 20, oldest first.
- Per outage, `ongoing` (additive) and `truncatedAtWindowStart` (additive): the block begins with the first probe of the window, so it may have started earlier and its real duration is unknown. `error` is always `"offline"` (kept for compatibility; it is not the probe's error).

---

### `GET /api/mints/version-history`

Software version timeline for a single mint. `latestGlobalVersion` is `<family>/<major>.<minor>`, the same value `/api/mints/known` sends as `softwareLatest` for this mint's software family (`null` for unknown software).

**Query parameters:** `url` (required, `https://…`). `history` is newest first, at most 50 entries.

**Response:**
```json
{
  "url": "https://mint.example.com",
  "history": [
    { "version": "0.16.3", "firstSeenAt": "2026-05-10T08:00:00.000Z" }
  ],
  "latestGlobalVersion": "nutshell/0.21"
}
```

---

### `GET /api/mints/audit-cz`

Data from the third-party audit service cashu.info for one mint, refreshed server-side every 10 minutes (feeds) and every 30 minutes (the per-mint `detail`); the endpoint reads the database only and never calls cashu.info. This endpoint itself is display only and never merged into any MintRadar value; the Reliability Score's audit part reads two numbers of the same stored `detail` (`swaps7d.all.total`, `swaps7d.errorsBlamed`) through `auditCzTotal` / `auditCzBlamed` / `auditCzFetchedAt` of `/api/mints/known`. Also reachable as `/api/v1/mints/audit-cz`; it is not rate-limit exempt (the global 60 requests / minute / IP applies).

**Query parameters:**

| Parameter | Required | Meaning |
|---|---|---|
| `url` | yes | The mint URL: `https://…`, at most 500 characters, no whitespace or credentials, a well-formed public host (no private/loopback IP literals). The DNS record is **not** looked up. A mint matches by its URL or by one of the aliases cashu.info lists (compared after URL normalisation and without a trailing slash). |
| `direction` | no | Which swaps to return: `from` (this mint is the source = a melt), `to` (this mint is the destination = a mint) or `both` (default, also when the parameter is absent). The match is case-sensitive; any other value, an empty value (`direction=`) or a repeated parameter gives `400`. |
| `limit` | no | Number of newest swaps to return, an integer from `1` to `100`, default `20`. A decimal is rounded down (`2.9` → `2`), `0` and negative numbers become `1`, anything above `100` becomes `100`. A missing, non-numeric (`abc`, `1e2`) or repeated value keeps the default `20`. Bound as an SQL parameter. `stats7d` and `detail7d` are not affected by `limit` or `direction`. |

**Response (covered), `200`:**
```json
{
  "source": "cashu.info",
  "sourceUrl": "https://cashu.info/mint/abc12345",
  "fetchedAt": "2026-10-04T10:03:01.000Z",
  "covered": true,
  "mint": { "state": "ok", "uptime24h": 99.5, "uptime7d": 98.1, "uptime30d": 97.4, "attributedFailures": 1,
            "minted": 29, "melted": 23, "lastCheck": "2026-10-04T09:58:00.000Z" },
  "swaps": [
    { "id": "s1", "at": "2026-10-04T09:00:00.000Z", "status": "failed", "stage": "melt", "error": "…", "amount": 10, "fee": 1,
      "durationMs": 900, "direction": "from", "otherMintUrl": "https://other.example", "otherMintName": "Other" }
  ],
  "stats7d": {
    "windowDays": 7,
    "melts": { "paid": 18, "failed": 5, "pending": 1, "amountPaid": 11100, "feesPaid": 60 },
    "mints": { "paid": 23, "failed": 22, "pending": 0, "amountPaid": 1752, "feesPaid": 0 },
    "avgDurationMsPaid": 4213.4,
    "swapsCounted": 69
  },
  "detail": {
    "swaps7d": { "all": { "total": 126, "success": 107, "failed": 19, "avgMs": 8289 }, "asSource": { "total": 64, "success": 51, "failed": 13, "avgMs": 11719 }, "asDest": { "total": 62, "success": 56, "failed": 6, "avgMs": 5166 }, "errorsBlamed": 0, "dleq": { "valid": 56, "invalid": 0, "missing": 0 } },
    "integrity": { "proof_state": { "checked": 9, "spent": 0, "pending": 0 } },
    "network": { "asn": 14061, "asName": "DIGITALOCEAN-ASN - DigitalOcean, LLC, US", "country": "US" },
    "onion": false,
    "fetchedAt": "2026-10-07T07:08:41.120Z"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `source` | string | Always `"cashu.info"` (since 2026-10-25; it was the historical `"audit.cashu.cz"` before). The service is the "Cashu Mints Auditor" at cashu.info. The stored rows keep the old identifier in the database; only the answer changed. |
| `sourceUrl` | string \| null | The mint's page on cashu.info (always `https://cashu.info/mint/<id>`, **built by MintRadar** from the id after `^[A-Za-z0-9]{8,64}$` validation, never copied from the feed; rows stored under the old host `audit.cashu.cz` are rewritten at startup and on read); `null` when not covered. |
| `fetchedAt` | string (ISO) \| null | When MintRadar last stored this mint from their feed (covered), or the newest fetch of the whole feed (not covered; `null` if nothing was ever fetched). |
| `covered` | boolean | `true` when the mint is in their feed. |
| `mint` | object \| null | `null` when not covered. |
| `mint.state` | string | `ok`, `warn` or `error` — cashu.info's own verdict, not MintRadar's. |
| `mint.uptime24h` / `uptime7d` / `uptime30d` | number \| null | Percent, as published by the source. |
| `mint.attributedFailures` | number \| null | Failures the source attributes to this mint (its own window). |
| `mint.minted` / `mint.melted` | number \| null | Counts from the source's mint list feed (`null` when it omits them). |
| `mint.lastCheck` | string (ISO) \| null | The source's last check of the mint. |
| `swaps` | array | Up to `limit` newest swaps for the chosen `direction`, ordered by `at` descending (no tie-break). `[]` when none stored. |
| `swaps[].id` | string | The source's swap id. |
| `swaps[].at` | string (ISO) | When the swap happened. |
| `swaps[].status` | string | `success`, `failed`, `pending`, or any other short lowercase token the source sends (`^[a-z][a-z_-]{0,29}$`). |
| `swaps[].stage` | string \| null | Same token format, e.g. `melt`, `mint`, `limits`, `balance`; `null` when the source sends none. |
| `swaps[].error` | string \| null | **Untrusted text**, at most 300 characters. |
| `swaps[].amount` / `fee` / `durationMs` | number \| null | `amount` and `fee` are in sat — an assumption: the feed has no unit field, but cashu.info's methodology page states every limit and amount in sat and its error strings read "need 25 sat, have 20 sat". |
| `swaps[].direction` | `"from"` \| `"to"` | `from` when this mint is the source, `to` when it is the destination. A swap that matches this mint on both sides is returned once, as `from`. |
| `swaps[].otherMintUrl` / `otherMintName` | string \| null | The counterpart of the swap: the destination for `from`, the source for `to` (name at most 100 characters). |
| `stats7d` | object \| null | Counted by MintRadar, see below; `null` only when not covered. |
| `detail` | object \| null \| absent | Validated subset of cashu.info's per-mint detail plus `fetchedAt`; `null` when covered but none stored yet; absent when not covered. See below. |

Which swaps are returned: with `direction=from` the swaps whose source is this mint (or one of its aliases), with `direction=to` those whose destination is this mint, with `direction=both` either. A swap that has this mint on both sides appears in all three, labelled `from`.

`stats7d` is **counted by MintRadar** over the swaps it stored with `at` in the last 7 days where `from_url` or `to_url` matches the mint (URL or alias) — it is not a figure published by cashu.info. A swap where this mint is the source (`from`) is a **melt**, where it is the destination (`to`) a **mint**; a swap matching on both sides is counted once, as a melt. `paid` = status `success`, `failed` = status `failed`, anything else is `pending` (excluded from paid/failed); `paid + failed + pending` over both directions equals `swapsCounted`. `amountPaid` / `feesPaid` are sums over paid swaps (a null fee counts as 0), `avgDurationMsPaid` is the mean `durationMs` of paid swaps that have one (else `null`).

`detail` is **published by cashu.info** (`GET /api/v1/mints/{id}`), validated and stored by a 30-minute job; every field is optional and a malformed field is simply absent. Numbers are non-negative; counts are integers. Strings are untrusted text (sanitised: NFC, no control / zero-width / bidi characters, whitespace collapsed, capped). It never contains an IP address, the onion address, score, reviews, TLS, step timings, latency or Frankfurt data.

| Field | Type | Meaning |
|---|---|---|
| `detail.swaps7d.all` / `asSource` / `asDest` | `{ total, success, failed, avgMs }` (each number, optional) | 7-day swap counts of the mint: all swaps, as source (melts) and as destination (mints); `avgMs` in milliseconds. |
| `detail.swaps7d.errorsBlamed` | number | Failures cashu.info attributes to this mint. |
| `detail.swaps7d.dleq` | `{ valid, invalid, missing }` | DLEQ proof checks of the swaps. |
| `detail.integrity.proof_state` | `{ checked, spent, pending }` | The auditor's proof-state check of its own ecash. |
| `detail.network` | `{ asn: number, asName: string ≤80, country: "XX" }` | Public network facts about the mint host (no address). |
| `detail.onion` | boolean | Whether the mint advertises an onion address (the address is not stored). |
| `detail.fetchedAt` | string \| null | When the row was stored. |

`detail7d` (the old derived summary) was **removed** when the new Audit tab shipped; read `detail.swaps7d` instead.

**Not covered:** still `200`, `{ "source": "cashu.info", "sourceUrl": null, "fetchedAt": <newest feed fetch or null>, "covered": false, "mint": null, "swaps": [], "stats7d": null }` — no `detail` key. This happens for any well-formed `https://` URL that is not in their feed, and `direction` / `limit` are still validated first.

**Errors:** `400` `{"error":"Missing required query parameter: url"}` (missing, empty or repeated `url`), `{"error":"url must start with https://"}`, `{"error":"url exceeds maximum length of 500 characters"}`, `{"error":"Invalid url"}` (not well-formed, has whitespace or credentials, private/loopback host), `{"error":"direction must be from, to, or both"}`; `429` from the global rate limit; `500` `{"error":"Internal server error"}`. Successful responses carry `Cache-Control: public, max-age=60` and an `ETag`.

---

### `GET /api/mint/probe`

On-demand live probe of a single mint URL. Triggers an outbound fetch.

**Query parameters:** `url` (required, `https://…`, at most 500 characters). Errors: `400` `{"error":"Missing required query parameter: url"}`, `{"error":"url must start with https://"}`, `{"error":"url exceeds maximum length of 500 characters"}`; a deployment configured with a fixed mint allowlist answers `403` for other URLs.

**Rate limit (unknown URLs only, added 2026-10-03):** a URL that is not a tracked mint is also charged to a dedicated per-IP budget — 10 / minute, 60 / hour, and at most 3 such probes in flight at once. Exceeding any of them returns `429` `{"error":"Too many requests. Try again later."}` with a `Retry-After` header in seconds (time until the relevant window frees up; `5` for the concurrency cap). A rejected request consumes no budget. Tracked mints are subject to the global 60 requests / minute limit only. The counters are in memory — a backend restart resets them. This `429` means *MintRadar* limited the caller; it is unrelated to `errorKind: rate_limited_by_host` (the mint's host limiting us, returned with HTTP 200).

**Response:**
```json
{
  "url": "https://mint.example.com",
  "online": true,
  "latencyMs": 143,
  "info": { "name": "Example Mint", "version": "0.16.3", "nuts": {} },
  "keysets": [{ "id": "abc123", "unit": "sat", "active": true }],
  "checkedAt": "2026-06-25T10:00:00.000Z"
}
```

**Known mints only (additive):** `contactChecks` (facts about the stored contact entries, never a value), `lastContacts` / `lastContactsAt` (the last published contacts, only when stored) and, since 2026-10-25, `lastInfo`: `{ "motd": string | null, "description": string | null, "seenAt": ISO 8601 UTC | null }`, the last **confirmed** MOTD and short description of the change log baseline (`mint_change_state.info`: plain text, links replaced by `[link]`, at most 200 characters), for Mint Detail while the live `/v1/info` is missing. `seenAt` is the mint's last successful probe (`mints.last_online_at`), not the time the value was confirmed; a value that changed and is still waiting for its second observation is not shown, so `lastInfo` can be older than `seenAt`. The key is absent when neither a MOTD nor a description is stored, and is never in the answer for an unknown URL.

For a URL that is **not** a tracked mint the response is reduced: `keysets` is `null` and `info` carries only `name`, `version` and the NUT numbers as keys of `nuts` (each with `{}`); the example above is the answer for a tracked mint.

**Server error:** a failure of MintRadar itself (a database error) is `500` `{"error":"Internal server error"}`, never an `online: false` answer.

**Failure** (HTTP 200, `online: false`): `error` is always the literal `"Mint unreachable"`; the additive `errorKind` says why. It is an enum — never raw error text, headers, IPs or response bodies:

| `errorKind` | Meaning |
|---|---|
| `blocked_by_host` | 401/403, a `cf-mitigated` header, or a Cloudflare HTML page instead of JSON (e.g. a Managed Challenge) |
| `rate_limited_by_host` | 429 |
| `host_error` | other 5xx (including Cloudflare 5xx pages) |
| `timeout` | no answer within the probe deadline |
| `dns` | the host name did not resolve — **also** what a name resolving to a private/loopback/link-local/otherwise blocked address (and a redirect to one, or a blocked IP literal) reports, so the two cannot be told apart |
| `tls` | certificate could not be verified |
| `not_cashu` | the host answered, but `/v1/info` is a 404, not JSON, or has no `nuts` |
| `unreachable` | any other connection failure |

`errorKind` is also returned (same enum) in the `400` body of `POST /api/mint/submit` and in per-line `results[]` entries of `POST /api/mints/discover` whose `error` is `"URL does not appear to be a valid Cashu mint"`. The pre-validation errors (`Invalid url`, scheme, length) carry no `errorKind`. Clients must treat a missing or unknown `errorKind` as "no detail".

---

### `GET /api/mints/nostr-reviews`

NIP-87 kind:38000 reviews for a single mint, read from the database (`mint_reviews`, filled by the hourly reviews sync; this route makes no relay query), newest first. Reviews from a key that is both listed as the mint's Nostr contact and the author of its NIP-87 announcement are included here; the counts in the other routes leave them out. If the database read fails the route answers `200` with `[]`.

**Query parameters:** `url` (required, `https://…`)

**Response:**
```json
[
  {
    "id": "abc123…",
    "pubkey": "deadbeef…",
    "content": "Great mint",
    "rating": 4,
    "createdAt": 1750000000,
    "source": "nostr",
    "listedAsContact": false,
    "authorName": "Alice",
    "authorNip05": "alice@example.com"
  }
]
```

`listedAsContact` (boolean, added 2026-10-21, on every item) is `true` when the author's key is one of the Nostr contacts the mint itself lists in its `/v1/info` (hex, `npub`, `nprofile`, optional `nostr:` prefix; at most the first three Nostr entries are read) **and** the review is not excluded from the counts. A review is excluded only when its key is both a listed Nostr contact and the author of the mint's NIP-87 announcement, so a key that is only listed as a contact is counted and is flagged here. A mint writes its contact list itself, so the flag is a fact about what the mint lists, not about who wrote the review; the website shows it as the neutral label "Key listed as this mint's contact". It never changes a count, an average or a score, and no contact value is returned.

`authorName` and `authorNip05` are optional and present only when the server has found the author's public Nostr profile (kind 0, from a profile indexer). `authorName` is the profile's `display_name`, else its `name`; `authorNip05` is the profile's **unverified** NIP-05 claim. Both are untrusted display text (cleaned, `authorName` at most 48 characters, `authorNip05` at most 100): render as plain text, never as verified, and never use them for a rating or any score.

---

### `POST /api/mint/submit`

Submit a new mint URL for monitoring. Triggers a live probe before insertion.

**Body:** `{ "url": "https://…" }`

**Response (success):** `{ "success": true, "isNew": true, "added": true, "alreadyTracked": false, "name": "Mint Name", "aliasOf": [] }`. `isNew` and `added` are the same value, `alreadyTracked` is its negation; `aliasOf` lists other tracked mints with the same NUT-06 public key (`[{ "url", "name" }]`, only for a new mint; a hint, nothing is merged).

**Response (error):** `{ "error": "description" }`: `400` for a missing `url`, `url must start with https://`, a URL over 500 characters, `Invalid url`, or `URL does not appear to be a valid Cashu mint` (with `errorKind`); `429` `{"error":"Too many requests. Try again later."}`; `500`.

Rate limit: **20 requests / hour / IP**.

---

### `POST /api/mints/discover`

Batch insert discovered mint URLs (max 100 per request).

**Body:** `{ "urls": ["https://…", "https://…"], "source": "bulk" }` (`source` is optional: `"bulk"` for an explicit bulk submission, anything else counts as `"auto"`).

**Response:** `{ "added": 3, "total": 3, "results": [{ "url", "success", "isNew", "error"?, "errorKind"?, "aliasOf"? }] }`. A non-string entry in `urls` is skipped without a result. `400` for `urls` that is not an array (`urls must be array`) or has more than 100 entries; `429` with `Retry-After`.

Rate limit: **3 requests / hour / IP** for `"source": "auto"` (the default), **10 requests / hour / IP** for `"source": "bulk"`.

---

## Error Responses

| Status | Meaning |
|---|---|
| `400` | Bad request — missing or invalid parameter |
| `404` | Unknown route (`{"error":"Not found"}`, or the wallet envelope below `/api/v1/`) |
| `403` | A browser request from an origin that is not allowed on a non-public route: `{"error":{"code":"cors_forbidden","message":"…"}}` |
| `429` | Rate limit exceeded (`Retry-After` header) |
| `500` | Internal server error |

The error shape of the wallet routes (`{ "error": { "code", "message" } }`) is described in "API for wallets (v1)".

---

## `GET /api/v1/mints/recommend`

> **Deprecated since 2026-10-20; sunset 2027-01-26.** Every response carries `Deprecation: @1792454400`, `Sunset: Tue, 26 Jan 2027 00:00:00 GMT` and `Link: <https://mintradar.org/api/v1/wallets/mints?eligible=true&unit=sat&minScore=80&limit=5>; rel="successor-version"`. Replace it with `GET /api/v1/wallets/mints?eligible=true&unit=sat&minScore=80&nuts=4,5&limit=5`, which returns the same mints in the same order (see "Replacing `/mints/recommend`"). Until the sunset date the behaviour and the body are unchanged. The unversioned `/api/mints/recommend` is the same route and carries the same headers.

A short list of currently healthy mints for a wallet's default or suggested list. For a full, stable view of every mint use [`/api/v1/wallets/mints`](#api-for-wallets-v1); this route keeps the shape it was introduced with on 2026-10-10 (new fields may be added). Built on the same data and the same filter function as the wallet API; public with `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=300` and an `ETag` (poll at most every 5 minutes); it uses the same per-IP limit as the wallet API, **300 requests / minute / IP** (one counter shared with `/api/v1/wallets/*`, same `X-RateLimit-*` headers and `Retry-After`; see "Rate limits").

**Only mints with `eligibleForRecommendation` are returned** (since 2026-10-12): online, scored, not on the manual test-mint list, not archived, first seen at least 14 days ago, and probed within the last 3 hours (since 2026-10-28; methodology version 6). Test mints, mints under 14 days and mints without a recent probe never appear.

**Query parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `unit` | `sat` | Unit the mint must list (an empty value turns the filter off) |
| `minScore` | `80` | Minimum reliability score (0–100) |
| `limit` | `5` | Max results (1–10), applied after all filters |
| `nuts` | — | Comma-separated NUT numbers the mint must advertise (e.g. `4,5`) |

An invalid `minScore` or `limit` falls back to its default (`minScore` not a whole number, `limit` not a whole number) or is clamped (`minScore` above 100 becomes 100, `limit` is held between 1 and 10); this route does not return `400` for them. In each result `units` is the mint's own unit list (`null` when unknown), the same as in the wallet API; the requested `unit` only filters. Results are ordered by score (descending), then 7-day uptime, then name.

**Example**

```bash
curl "https://mintradar.org/api/v1/mints/recommend?unit=sat&minScore=85&limit=3&nuts=4,5"
```

**Response**

```json
{
  "recommended": [
    {
      "url": "https://mint.example.com",
      "name": "Example Mint",
      "reliabilityScore": 96,
      "uptimePct24h": 100,
      "latencyMs": 180,
      "version": "Nutshell/0.21.0",
      "units": ["sat"]
    }
  ],
  "generatedAt": "2026-10-12T18:30:12.345Z",
  "methodology": 5
}
```

`generatedAt` is the time of the data snapshot (at most 60 seconds old); `methodology` is the version of the score formula (see "Stability"). Errors keep the older shape `{ "error": "text" }` (also the `429`: `{ "error": "Too many requests" }` with `Retry-After`). A wallet should still let the user override and pin a preferred mint.
