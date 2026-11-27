# MintRadar internal API routes

These routes serve the MintRadar website. They are **internal**: they may change or disappear without notice and carry no stability guarantee. Wallets and other integrations use the [API for wallets (v1)](API.md#api-for-wallets-v1) (quick start on [mintradar.org/for-wallets](https://mintradar.org/for-wallets)). Rate limits and error responses are described in [API.md](API.md#rate-limits).

Split out of `docs/API.md` on 2026-11-27 (owner: the public document had grown to about 15,000 words, half of it these routes).


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

**Access (changed 2026-10-20):** this is the website's own data feed, an **internal** route. A browser request from another origin gets `403` `{"error":{"code":"cors_forbidden",…}}` and the answer carries no `Access-Control-Allow-Origin: *` (it was public with `*` before); the website's own origins, servers and tools that send no `Origin` header work as before. It counts against the general limit of **60 requests / minute / IP** (it was exempt); the website needs about one request per page load (it caches the answer for 5 minutes in the browser). Wallets should use [`/api/v1/wallets/mints`](API.md#api-for-wallets-v1), a compact summary with a stability guarantee that is open to any origin.

**Response:** Array of mint objects. Every response carries `Cache-Control: public, max-age=300` and an `ETag` (`If-None-Match` gives `304`; see "Caching" for the weak form). This array also carries website-only fields (`ipAddress`, `netAsn`, …) that may change.

`scoreBreakdown` (additive, 2026-10-25) is the **stored** breakdown of `reliabilityScore` (the record written together with the score: `{ uptime, audit, nuts, version, contact: { points, max }, newMintCap: { points, cap }, sum }` plus, since methodology version 7, `uptimeParts` and `uptimeInputs`; the same shape as the wallet API field), or `null` when none is stored (records from before the breakdown was stored, or an invalid one). Mint Detail's score modal shows these points; it never recomputes them from live data while a stored breakdown exists.

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

Data from the third-party audit service cashu.info for one mint, refreshed server-side every 10 minutes (feeds) and every 30 minutes (the per-mint `detail` and the 30-day swap graph); the endpoint reads the database only and never calls cashu.info. This endpoint itself is display only and never merged into any MintRadar value; the Reliability Score's audit part reads two numbers of the same stored `detail` (`swaps7d.all.total`, `swaps7d.errorsBlamed`) through `auditCzTotal` / `auditCzBlamed` / `auditCzFetchedAt` of `/api/mints/known`. Also reachable as `/api/v1/mints/audit-cz`; it is not rate-limit exempt (the global 60 requests / minute / IP applies).

**Query parameters:**

| Parameter | Required | Meaning |
|---|---|---|
| `url` | yes | The mint URL: `https://…`, at most 500 characters, no whitespace or credentials, a well-formed public host (no private/loopback IP literals). The DNS record is **not** looked up. A mint matches by its URL or by one of the aliases cashu.info lists (compared after URL normalisation and without a trailing slash). |
| `direction` | no | Which swaps to return: `from` (this mint is the source = a melt), `to` (this mint is the destination = a mint) or `both` (default, also when the parameter is absent). The match is case-sensitive; any other value, an empty value (`direction=`) or a repeated parameter gives `400`. |
| `limit` | no | Number of newest swaps to return, an integer from `1` to `500`, default `20`. A decimal is rounded down (`2.9` → `2`), `0` and negative numbers become `1`, anything above `500` becomes `500`. A missing, non-numeric (`abc`, `1e2`) or repeated value keeps the default `20`. Bound as an SQL parameter. `stats7d` and the per-mint `detail` are not affected by `limit`, `direction` or `days`. |
| `days` | no | Optional filter on the swap list: `7` or `30`. When set, only swaps with `at` in the last that many days are returned (still ordered newest first and still capped by `limit`). When omitted, the list is the newest `limit` stored swaps with no date filter (the feed itself is kept for 30 days). Any other value, an empty value (`days=`) or a repeated parameter gives `400`. |

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
    "swaps7d": { "all": { "total": 126, "success": 107, "failed": 19, "avgMs": 8289, "amount": 16052, "fees": 302 }, "asSource": { "total": 64, "success": 51, "failed": 13, "avgMs": 11719, "amount": 12642, "fees": 156 }, "asDest": { "total": 62, "success": 56, "failed": 6, "avgMs": 5166, "amount": 3410, "fees": 146 }, "errorsBlamed": 0, "dleq": { "valid": 56, "invalid": 0, "missing": 0 } },
    "integrity": { "proof_state": { "checked": 9, "spent": 0, "pending": 0 } },
    "network": { "asn": 14061, "asName": "DIGITALOCEAN-ASN - DigitalOcean, LLC, US", "country": "US" },
    "onion": false,
    "fetchedAt": "2026-10-07T07:08:41.120Z"
  },
  "daily7d": [{ "day": "2026-11-15", "ok": 12, "failed": 2, "other": 0 }],
  "long": { "windowDays": 21, "swaps": 360, "attributedFailures": 1 },
  "since": { "day": "2026-11-07", "swaps": 480, "attributedFailures": 1 },
  "weeks": [
    { "start": "2026-11-07", "end": "2026-11-14", "swaps": 120, "attributedFailures": 0,
      "failed": null, "succeeded": null, "failedElsewhere": null, "avgMs": null, "amount": null, "fees": null,
      "deposits": null, "withdrawals": null },
    { "start": "2026-11-14", "end": "2026-11-21", "swaps": 126, "attributedFailures": 0,
      "failed": 19, "succeeded": 107, "failedElsewhere": 19, "avgMs": 8289, "amount": 16052, "fees": 302,
      "deposits": { "total": 62, "success": 56, "failed": 6, "avgMs": 5166, "amount": 3410, "fees": 146 },
      "withdrawals": { "total": 64, "success": 51, "failed": 13, "avgMs": 11719, "amount": 12642, "fees": 156 } }
  ],
  "totals": {
    "d7": { "days": 7, "weeks": 1, "start": "2026-11-14", "end": "2026-11-21", "swaps": 126, "attributedFailures": 0,
            "outcomes": { "since": "2026-11-14", "swaps": 126, "succeeded": 107, "failedElsewhere": 19, "attributedFailures": 0 },
            "directions": { "since": "2026-11-14", "deposits": { "total": 62, "success": 56, "failed": 6 }, "withdrawals": { "total": 64, "success": 51, "failed": 13 } } },
    "d28": { "days": 14, "weeks": 2, "start": "2026-11-07", "end": "2026-11-21", "swaps": 246, "attributedFailures": 0,
             "outcomes": { "since": "2026-11-14", "swaps": 126, "succeeded": 107, "failedElsewhere": 19, "attributedFailures": 0 },
             "directions": { "since": "2026-11-14", "deposits": { "total": 62, "success": 56, "failed": 6 }, "withdrawals": { "total": 64, "success": 51, "failed": 13 } } },
    "all": { "days": 14, "weeks": 2, "start": "2026-11-07", "end": "2026-11-21", "swaps": 246, "attributedFailures": 0,
             "outcomes": { "since": "2026-11-14", "swaps": 126, "succeeded": 107, "failedElsewhere": 19, "attributedFailures": 0 },
             "directions": { "since": "2026-11-14", "deposits": { "total": 62, "success": 56, "failed": 6 }, "withdrawals": { "total": 64, "success": 51, "failed": 13 } } }
  },
  "periods": {
    "d7": { "days": 7, "swaps": 126, "succeeded": 107, "failedElsewhere": 19, "attributedFailures": 0, "avgMs": 8289, "amount": 16052,
            "deposits": { "success": 56, "total": 62, "failed": 6 }, "withdrawals": { "success": 51, "total": 64, "failed": 13 },
            "fetchedAt": "2026-10-07T07:08:41.120Z" },
    "d30": { "days": 30, "swaps": 400, "succeeded": 380, "failedElsewhere": 15, "attributedFailures": 5, "avgMs": 1200, "amount": 9000,
             "deposits": { "success": 180, "total": 190, "failed": 10 }, "withdrawals": { "success": 200, "total": 210, "failed": 10 },
             "fetchedAt": "2026-10-07T07:18:00.000Z" }
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
| `swaps` | array | Up to `limit` newest swaps for the chosen `direction` (and `days`, when set), ordered by `at` descending (no tie-break). `[]` when none stored. |
| `swapsSince` | string (ISO) \| null \| absent | Oldest stored swap for this mint, independent of `limit` and `days`. `null` when none are stored. Absent when not covered. (Additive, 2026-11-22.) |
| `swaps[].id` | string | The source's swap id. |
| `swaps[].at` | string (ISO) | When the swap happened. |
| `swaps[].status` | string | `success`, `failed`, `pending`, or any other short lowercase token the source sends (`^[a-z][a-z_-]{0,29}$`). |
| `swaps[].stage` | string \| null | Same token format, e.g. `melt`, `mint`, `limits`, `balance`; `null` when the source sends none. |
| `swaps[].error` | string \| null | **External text**, at most 300 characters. |
| `swaps[].amount` / `fee` / `durationMs` | number \| null | `amount` and `fee` are in sat — an assumption: the feed has no unit field, but cashu.info's methodology page states every limit and amount in sat and its error strings read "need 25 sat, have 20 sat". |
| `swaps[].direction` | `"from"` \| `"to"` | `from` when this mint is the source, `to` when it is the destination. A swap that matches this mint on both sides is returned once, as `from`. |
| `swaps[].otherMintUrl` / `otherMintName` | string \| null | The counterpart of the swap: the destination for `from`, the source for `to` (name at most 100 characters). |
| `stats7d` | object \| null | Counted by MintRadar, see below; `null` only when not covered. |
| `detail` | object \| null \| absent | Validated subset of cashu.info's per-mint detail plus `fetchedAt`; `null` when covered but none stored yet; absent when not covered. See below. |
| `daily7d` | array \| absent | MintRadar's own count of stored swaps per UTC day, last 7 days, oldest first, zero-filled (`[{ day, ok, failed, other }]`). Absent when not covered. |
| `long` | object \| null \| absent | The score's long window (`{ windowDays, swaps, attributedFailures }`) from non-overlapping `audit_cz_daily` rows; `null` while only one 7-day total is stored. Absent when not covered. Unchanged: this is still what the score reads (through `mints.audit_cz_long_*`, not this field). |
| `since` | object \| null \| absent | `{ day, swaps, attributedFailures }`: every stored non-overlapping 7-day row added up; `day` is the first day covered (`end − 7 days` of the oldest week). `null` when nothing is stored. Absent when not covered. |
| `weeks` | array \| absent | The same non-overlapping snapshots as `since`, oldest first (additive, 2026-11-21). See below. Absent when not covered. |
| `totals` | object \| absent | `{ d7, d28, all }` sums of `weeks` for the 7-day, 28-day and all-history views (additive, 2026-11-21). See below. Absent when not covered. |
| `periods` | object \| absent | Official 7-day and 30-day views for the Audit tab (additive, 2026-11-22). See below. Absent when not covered. |

Which swaps are returned: with `direction=from` the swaps whose source is this mint (or one of its aliases), with `direction=to` those whose destination is this mint, with `direction=both` either. A swap that has this mint on both sides appears in all three, labelled `from`.

`stats7d` is **counted by MintRadar** over the swaps it stored with `at` in the last 7 days where `from_url` or `to_url` matches the mint (URL or alias) — it is not a figure published by cashu.info. A swap where this mint is the source (`from`) is a **melt**, where it is the destination (`to`) a **mint**; a swap matching on both sides is counted once, as a melt. `paid` = status `success`, `failed` = status `failed`, anything else is `pending` (excluded from paid/failed); `paid + failed + pending` over both directions equals `swapsCounted`. `amountPaid` / `feesPaid` are sums over paid swaps (a null fee counts as 0), `avgDurationMsPaid` is the mean `durationMs` of paid swaps that have one (else `null`).

`detail` is **published by cashu.info** (`GET /api/v1/mints/{id}`), validated and stored by a 30-minute job; every field is optional and a malformed field is simply absent. Numbers are non-negative; counts are integers. Strings are external text (sanitised: NFC, no control / zero-width / bidi characters, whitespace collapsed, capped). It never contains an IP address, the onion address, score, reviews, TLS, step timings, latency or Frankfurt data.

| Field | Type | Meaning |
|---|---|---|
| `detail.swaps7d.all` / `asSource` / `asDest` | `{ total, success, failed, avgMs, amount, fees }` (each number, optional) | 7-day swap counts of the mint: all swaps, as source (melts / withdrawals) and as destination (mints / deposits); `avgMs` in milliseconds; `amount` and `fees` in sat. |
| `detail.swaps7d.errorsBlamed` | number | Failures cashu.info attributes to this mint. |
| `detail.swaps7d.dleq` | `{ valid, invalid, missing }` | DLEQ proof checks of the swaps. |
| `detail.integrity.proof_state` | `{ checked, spent, pending }` | The auditor's proof-state check of its own ecash. |
| `detail.network` | `{ asn: number, asName: string ≤80, country: "XX" }` | Public network facts about the mint host (no address). |
| `detail.onion` | boolean | Whether the mint advertises an onion address (the address is not stored). |
| `detail.fetchedAt` | string \| null | When the row was stored. |

`detail7d` (the old derived summary) was **removed** when the new Audit tab shipped; read `detail.swaps7d` instead.

`weeks` (additive, 2026-11-21) is the stored history of cashu.info's 7-day snapshots, not a calendar-day series: each `audit_cz_daily` row is itself a rolling 7-day window, so only rows 7 days apart are kept (the same stride as `since` / the score's long window). Oldest first. `end` is the UTC day the snapshot was first stored; `start` is 7 days before (the first day that window covers). `swaps` / `attributedFailures` are always present. `failed`, `succeeded` (`total − failed`), `failedElsewhere` (`failed − attributedFailures`), `avgMs`, `amount`, `fees`, `deposits` and `withdrawals` are `null` when that field was not stored for the week (rows from before 2026-11-21, or a direction cashu.info omitted). `deposits` is cashu.info `asDest`, `withdrawals` is `asSource`. Display only — this array is not an input of the Reliability Score.

`totals` (additive, 2026-11-21) sums those weeks for three views of the stored history: `d7` (today's snapshot), `d28` (the same weeks as `long` / the score's long window: today and 7, 14 and 21 days back, stopping at the first gap, at most four), `all` (every stored week). Each value is `null` when that view has no weeks, otherwise `{ days, weeks, start, end, swaps, attributedFailures, outcomes, directions }`. `swaps` / `attributedFailures` always add every week in the view. `outcomes` and `directions` add up only the newest contiguous suffix of weeks that have those fields (walking backward and stopping at the first week that lacks them) so a total is never invented for a period that was only partly stored; `since` on each is the `start` of the oldest week in that suffix — the day the split applies from. `directions.deposits` / `withdrawals` are `{ total, success, failed }`.

`periods` (additive, 2026-11-22) is what the Audit tab's 7 days / 30 days switch reads. Display only — not an input of the Reliability Score, and not present on the Wallet API. `d7` is built from the stored per-mint detail (`swaps7d`); `d30` is built from the stored 30-day swap graph (`GET /api/v1/network?range=30d`, dest = deposits / mint, source = withdrawals / melt) plus `mint.attributedFailures` from the list feed (cashu.info's rolling 30-day blamed count). `d30` is `null` until the first successful graph sync. Each side is `{ days, swaps, succeeded, failedElsewhere, attributedFailures, avgMs, amount, deposits, withdrawals, fetchedAt }` or `null`. `succeeded + failedElsewhere + attributedFailures` equals `swaps`. The tab's success rate is `succeeded / swaps`, the same calculation as before. `deposits` / `withdrawals` are `{ success, total, failed }`. The 30-day graph has no fees; the tab does not show fees.

**Not covered:** still `200`, `{ "source": "cashu.info", "sourceUrl": null, "fetchedAt": <newest feed fetch or null>, "covered": false, "mint": null, "swaps": [], "stats7d": null }` — no `detail`, `daily7d`, `long`, `since`, `weeks`, `totals` or `periods` key. This happens for any well-formed `https://` URL that is not in their feed, and `direction` / `limit` are still validated first.

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

`authorName` and `authorNip05` are optional and present only when the server has found the author's public Nostr profile (kind 0, from a profile indexer). `authorName` is the profile's `display_name`, else its `name`; `authorNip05` is the profile's **unverified** NIP-05 claim. Both are external display text (cleaned, `authorName` at most 48 characters, `authorNip05` at most 100): render as plain text, never as verified, and never use them for a rating or any score.

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

### `POST /api/notifications/list`

Returns the **authenticated account's own** mint notification settings, so the MintRadar website can show them correctly after a login on another device or browser. Used by the website only (same-origin; other browser origins get `403`).

**Auth:** NIP-98 (`Authorization: Nostr <base64 kind 27235 event>`) signed for this exact URL and method `POST`, within the 60-second window; a token is single-use (a replayed one gets `401`). Only rows of the signing pubkey are read.

**Body:** `{}` (ignored).

**Response:** `{ "subscriptions": [{ "mintUrl", "notifyOnDown", "notifyOnUp", "notifyOnMintMeltIssues", "notifyOnVersionOutdated", "notifyOnNutLoss" }] }` — one entry per mint with active DM notifications (`mintUrl` normalized as stored, the five flags booleans). Nothing else is returned: no relays, no timestamps, no pubkey. A subscription not renewed in 30 days is deleted by the daily cleanup and then no longer listed. Always `Cache-Control: private, no-store`.

**Errors:** `401` missing/invalid/expired/replayed NIP-98 token (`{ "error": "…" }`); `429` `{"error":"Too many requests. Try again later."}` with `Retry-After`; `500` `{"error":"Internal server error"}`.

Rate limit: **30 requests / hour / pubkey**.

---
