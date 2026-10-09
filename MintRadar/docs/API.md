# MintRadar Public API

MintRadar provides a public read-only API for querying Cashu mint data. All endpoints are served under the same origin as the web app (`https://mintradar.org/api/`).

**Versioning:** every endpoint below is also reachable under `/api/v1/` (e.g. `/api/v1/mints/known`) — same response shape, same rate limits, no behavior differences. `/api/v1` is the preferred path going forward; the unversioned `/api/*` shown below is kept as a legacy alias and may be removed in a future release.

---

## Rate Limits

| Endpoint type | Limit |
|---|---|
| All read endpoints | **60 requests / minute / IP** |
| `/api/mint/submit` (POST) | **20 requests / hour / IP** |
| `/api/mints/discover` (POST) | **10 requests / hour / IP** |
| `/api/mint/probe` for a URL that is **not** a tracked mint | additionally **10 requests / minute**, **60 requests / hour** and **3 concurrent probes** per IP (tracked mints: global limit only) |

Rate limit headers are returned on all non-exempt endpoints:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
```

Exceeding the limit returns HTTP `429 Too Many Requests`:

```json
{ "error": "Too many requests" }
```

---

## Endpoints

`GET /api` (also `/api/` and `/api/v1`) returns a small JSON pointer: `{"name":"MintRadar API","docs":"<this document on GitHub>","health":"/api/v1/health"}`.

### `GET /health` and `GET /api/v1/health`

Health check. Available at `/health` and `/api/v1/health` (identical payload). There is no `/api/health`. No rate limiting on either path.

**Response:**
```json
{ "status": "ok", "timestamp": "2026-06-25T10:00:00.000Z", "lastProbeAt": "2026-06-25T09:58:12.000Z", "lastAuditSyncAt": "2026-06-25T06:00:03.000Z", "lastReviewsSyncAt": "2026-06-25T07:12:44.000Z", "auditUpstream": "ok", "auditUpstreamCheckedAt": "2026-06-25T06:00:01.000Z",
  "auditCz": { "lastSyncAt": "2026-06-25T09:53:00.000Z", "mintsStored": 62, "swapsStored": 98, "skipped": { "mints": 0, "swaps": 2 } } }
```

`lastProbeAt` is when the 5-minute probe cycle last finished sweeping every mint (not merely "process is alive") — `null` until the first cycle completes after a restart.

`lastAuditSyncAt` is the newest `audit_synced_at` in the database (`MAX(audit_synced_at)` over all mints, cached in-process for 30s), so it **survives restarts and deploys**. It is `null` only if no mint has ever synced. If it stays old, the audit.8333.space data (Audit tab, `auditRecent*`) is stale; the Reliability Score's audit part does not depend on it (it uses cashu.info, see `auditCzFetchedAt`).

`lastReviewsSyncAt` is the newest `reviews_checked_at` in the database (`MAX(reviews_checked_at)`, read in the same query and the same 30s cache as `lastAuditSyncAt`), so it also **survives restarts**. It is `null` only if no mint has ever been reviews-synced. It is stamped for every mint that at least one relay answered for (and whose DB write completed) in the hourly reviews sync, even when nothing changed, so it should advance about every 60 minutes (+ up to a few minutes of start offset and jitter). Caveat: an answer with no events still counts, so this proves the sync job is running and at least one relay is reachable, not that every relay is. If no relay answers at all, nothing is stamped.

`auditUpstream` is `"ok"`, `"down"` or `"unknown"` and `auditUpstreamCheckedAt` is an ISO timestamp or `null`. They report the outcome of the **last audit sync attempt** (the 6h discovery cron against api.audit.8333.space), **not a live check**: `/health` never calls the upstream. A successful list fetch is `ok`; a non-OK HTTP response, timeout, network error or malformed body is `down`. The state is in-memory only, so after a restart or deploy it is `"unknown"` (with `auditUpstreamCheckedAt: null`) until the next sync, up to 6h later.

`auditCz` reports the **last cashu.info sync cycle** (every 10 minutes, see `GET /api/mints/audit-cz`), in memory only: `lastSyncAt` is when that cycle finished, `mintsStored` / `swapsStored` are the rows written (`null` when that response failed and nothing was written), `skipped` the number of items dropped as malformed or unknown per response. All fields are `null` until the first cycle after a restart. A `skipped` above 0 means the upstream sent something we do not parse. Counts only — no item contents, URLs or error strings.

Only timestamps, counts and this three-value enum are exposed — no error messages, upstream URL or status codes.

---

### `GET /api/mints/known`

All known mints with current online status, latency, reliability score, and metadata. Returns **every row** the server knows, including archived mints (offline 30+ days) — nothing is filtered out; use the `archived` and `degraded` flags on each object to tell them apart.

**Response:** Array of mint objects.

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
    "lastCheckedAt": "2026-06-25T09:55:00.000Z"
  }
]
```

`degraded` = mint has been offline for 24h+. `nutsLimits` keys are NUT numbers as strings. `ipAddress` (public IPv4 of the mint host, our own DNS lookup), `netAsn` / `netOrg` / `netCountry` (AS number, organisation and ISO country of that IP block, from ipinfo.io) and `hasOnion` (the mint's `/v1/info` lists a `.onion` address) are measured by MintRadar itself; each is `null` until first measured.

---

**Audit timestamps (per mint, both ISO 8601 UTC):** `auditCheckedAt` is the auditor's own last check (audit.8333.space `updated_at`); `auditSyncedAt` is when MintRadar's 6-hourly job last wrote that mint's audit data. They can differ a lot — `auditCheckedAt` may be days or months old while `auditSyncedAt` is recent, or both may age together while the upstream is unreachable. `auditRecentTotal`/`auditRecentErrors` are the audit.8333.space rolling-window figures of the Audit tab; since 2026-10-08 they are an archive and no longer feed the Reliability Score. **Audit inputs of the Reliability Score (additive, `null` when absent):** `auditCzTotal` (swaps in cashu.info's 7-day window), `auditCzBlamed` (the swaps whose failure cashu.info attributes to the mint) and `auditCzFetchedAt` (ISO 8601 UTC, when that detail was stored). The audit component is 0–25 from `auditCzBlamed / auditCzTotal` (0 % = 25, <1 % = 20, <5 % = 15, <15 % = 10, else 5); fewer than 10 swaps, null values, or a `auditCzFetchedAt` more than 168 hours old score a neutral 12.5.

### `GET /api/stats`

Network-wide statistics. `totalMints` counts **all mints known to the server, archived ones included** — it equals the length of the `/api/mints/known` array.

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
  "prevUptimePct": 98,
  "prevAvgLatencyMs": 152
}
```

`reliabilityScore` in segments is `null` for records before reliability score history was introduced (historical backfill not available).

---

### `GET /api/mints/version-history`

Software version timeline for a single mint. `latestGlobalVersion` is `<family>/<major>.<minor>`, the same value `/api/mints/known` sends as `softwareLatest` for this mint's software family (`null` for unknown software).

**Query parameters:** `url` (required, `https://…`)

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

### `GET /api/mints/daily-uptime`

Daily uptime counts for the last 30 days for a single mint.

**Query parameters:** `url` (required, `https://…`)

**Response:**
```json
[
  { "date": "2026-06-25", "onlineCount": 288, "totalCount": 288 }
]
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
  "source": "audit.cashu.cz",
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
| `source` | string | Always `"audit.cashu.cz"`: the historical identifier of the source, kept so clients do not break. The service now lives at cashu.info (the same project, "Cashu Mints Auditor"). |
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

**Not covered:** still `200`, `{ "source": "audit.cashu.cz", "sourceUrl": null, "fetchedAt": <newest feed fetch or null>, "covered": false, "mint": null, "swaps": [], "stats7d": null }` — no `detail` key. This happens for any well-formed `https://` URL that is not in their feed, and `direction` / `limit` are still validated first.

**Errors:** `400` `{"error":"Missing required query parameter: url"}` (missing, empty or repeated `url`), `{"error":"url must start with https://"}`, `{"error":"url exceeds maximum length of 500 characters"}`, `{"error":"Invalid url"}` (not well-formed, has whitespace or credentials, private/loopback host), `{"error":"direction must be from, to, or both"}`; `429` from the global rate limit; `500` `{"error":"Internal server error"}`. Successful responses carry `Cache-Control: max-age=60`.

---

### `GET /api/mint/probe`

On-demand live probe of a single mint URL. Triggers an outbound fetch.

**Query parameters:** `url` (required, `https://…`)

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

NIP-87 kind:38000 reviews for a single mint fetched live from Nostr relays.

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
    "authorName": "Alice",
    "authorNip05": "alice@example.com"
  }
]
```

`authorName` and `authorNip05` are optional and present only when the server has found the author's public Nostr profile (kind 0, from a profile indexer). `authorName` is the profile's `display_name`, else its `name`; `authorNip05` is the profile's **unverified** NIP-05 claim. Both are untrusted display text (cleaned, `authorName` at most 48 characters, `authorNip05` at most 100): render as plain text, never as verified, and never use them for a rating or any score.

---

### `POST /api/mint/submit`

Submit a new mint URL for monitoring. Triggers a live probe before insertion.

**Body:** `{ "url": "https://…" }`

**Response (success):** `{ "success": true, "name": "Mint Name" }`

**Response (error):** `{ "error": "description" }`

Rate limit: **20 requests / hour / IP**.

---

### `POST /api/mints/discover`

Batch insert discovered mint URLs (max 100 per request).

**Body:** `{ "urls": ["https://…", "https://…"] }`

**Response:** `{ "added": 3 }`

Rate limit: **10 requests / hour / IP**.

---

## Error Responses

| Status | Meaning |
|---|---|
| `400` | Bad request — missing or invalid parameter |
| `429` | Rate limit exceeded |
| `500` | Internal server error |
