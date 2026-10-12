# MintRadar Public API

MintRadar provides a public read-only API for querying Cashu mint data. All endpoints are served under the same origin as the web app (`https://mintradar.org/api/`).

**Versioning:** every endpoint is also reachable under `/api/v1/` (e.g. `/api/v1/mints/known`) — same response shape, same rate limits, no behavior differences. `/api/v1` is the preferred path going forward; the unversioned `/api/*` is kept as a legacy alias and may be removed in a future release.

**Stable for wallets:** only [API for wallets (v1)](#api-for-wallets-v1) carries a stability guarantee. `GET /api/mints/known` and `GET /api/mints/recommend` are public with the same CORS and caching rules, but their shape may still grow. Every other route is **internal**: it serves the MintRadar website, may change without notice and has no stability guarantee (`/api/mints/outages`, `swaps`, `audit-cz`, `nostr-reviews`, `history`, `version-history`, `daily-uptime`, `/api/nuts`, `/api/stats`, `/api/stats/reliability-trend`, `/api/stats/reliability-movers`, `/api/mint/icon`, `/api/nip05/verify`, `/api/og/mint`, `/sitemap.xml`, the notification routes; those from `history` to `nostr-reviews`, `stats` and `probe` are described below as a convenience).

---

## API for wallets (v1)

A small, stable, read-only API for wallet developers: one compact health summary per Cashu mint. It is served from the same snapshot as `/api/mints/known` (one database read per 60 seconds for all callers), under `https://mintradar.org/api/v1/wallets/…`.

> **Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar's probes and third-party audit data; it can be wrong or out of date.**

### Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/v1/wallets/mints` | List of mints with filters (below) |
| `GET /api/v1/wallets/mints/{url}` | One mint; `{url}` is the mint URL, percent-encoded (`https%3A%2F%2Fmint.example.com`) |

Machine-readable description: [`docs/openapi/wallets-v1.yaml`](openapi/wallets-v1.yaml) (OpenAPI 3.1). `/api/wallets/…` (without `v1`) is the same route.

**List query parameters** (all optional; a present but invalid value is a `400`, unknown parameters are ignored):

| Parameter | Default | Meaning |
|---|---|---|
| `unit` | — | Keep mints that list this unit (`sat`, `usd`, `eur`, …; case-insensitive). Mints whose units are unknown (`units: null`) never match. |
| `minScore` | — | Integer 0 to 100: keep mints with `score >= minScore` (a mint without a score never matches). |
| `includeOffline` | `false` | Also return `offline` and `degraded` mints. |
| `includeArchived` | `false` | Also return `archived` mints (offline for 30+ days). This flag alone is enough for them. |
| `includeTest` | `false` | Also return mints from MintRadar's manual test-mint list (`isTest: true`). |
| `includeUnscored` | `false` | Also return mints whose `score` is `null` (not probed yet). |
| `limit` | `100` | Integer 1 to 200 (`400` outside that range). |

Order: `score` descending (`null` last), then `uptime7dPct` descending (`null` last), then `name` (the hostname when `name` is `null`), then `url`.

### Response

```json
{
  "methodology": 3,
  "generatedAt": "2026-10-12T18:30:12.345Z",
  "count": 1,
  "mints": [
    {
      "url": "https://mint.example.com",
      "name": "Example Mint",
      "status": "online",
      "score": 92,
      "scoreCappedNew": false,
      "uptime24hPct": 100,
      "uptime7dPct": 99,
      "lastCheckedAt": "2026-10-12T18:29:41.000Z",
      "units": ["sat"],
      "nuts": ["4", "5", "7", "8", "9", "10", "11", "12"],
      "software": "Nutshell/0.21.0",
      "outdated": false,
      "isTest": false,
      "audit": { "swaps7d": 104, "attributedFailures": 0, "fetchedAt": "2026-10-12T17:40:00.000Z" },
      "reviews": { "count": 12, "ratedCount": 10, "avg": 4.6, "operatorCount": 1 },
      "eligibleForRecommendation": true
    }
  ]
}
```

`GET /api/v1/wallets/mints/{url}` returns `{ "methodology", "generatedAt", "mint": { … } }` with the same mint object. The URL is normalised exactly like stored mint URLs (`https`, lower-case host, no trailing slash) and checked for a well-formed public `https://` URL without any DNS lookup or outbound request: a malformed URL is `400 invalid_url`, an unknown mint `404 mint_not_found`. A test, archived or offline mint is returned when asked for by URL; `status` and `isTest` tell them apart.

| Envelope field | Type | Notes |
|---|---|---|
| `methodology` | integer | Version of the Reliability Score formula (`METHODOLOGY_VERSION`, see "Stability"). |
| `generatedAt` | string, ISO 8601 UTC | When the snapshot behind the answer was read from the database (at most 60 s old; identical for every caller of one snapshot). |
| `count` | integer | Length of `mints` (list only). |

| Mint field | Type | Notes |
|---|---|---|
| `url` | string | Normalised mint URL. |
| `name` | string \| null | The cleaned display name the website uses; `null` means show the hostname (also for mints on MintRadar's hidden-names list). Untrusted text: render as plain text. |
| `status` | `"online"` \| `"offline"` \| `"degraded"` \| `"archived"` | `online`: the latest probe succeeded. `offline`: the latest probe failed (or the mint was never probed). `degraded`: no successful probe in the last 24 hours. `archived`: offline for 30+ days. |
| `score` | integer 0–100 \| null | The stored Reliability Score (operational health: uptime 40, audit 25, NUTs 15, software version 15, contact 5). `null` until the first probe. |
| `scoreCappedNew` | boolean | `true` while the mint is younger than 30 days: its score is capped at 75. |
| `uptime24hPct`, `uptime7dPct` | integer \| null | Share of successful probes (percent, rounded). |
| `lastCheckedAt` | string, ISO 8601 UTC \| null | Latest probe. |
| `units` | string[] \| null | Units the mint's keysets list; `null` when unknown. |
| `nuts` | string[] \| null | NUT numbers the mint advertises (ascending, as strings); `null` when unknown. |
| `software` | string \| null | The mint's own version string (`Nutshell/0.21.0`); untrusted text, at most 100 characters. |
| `outdated` | boolean \| null | `true`: two or more minor versions behind the newest stable release of that software family. `false`: not outdated. `null`: unknown software, no or unreadable version, or no reference release. |
| `isTest` | boolean | On MintRadar's manual test-mint list. Test mints are never recommended. |
| `audit` | object \| null | cashu.info's 7-day window: `swaps7d` (all swaps), `attributedFailures` (failures cashu.info attributes to this mint), `fetchedAt` (ISO 8601). `null` when no data is stored. Fewer than 10 swaps or data older than 168 hours scores neutral in the Reliability Score. |
| `reviews` | object | Community Rating, same definitions as the website: `count` (counted NIP-87 reviews), `ratedCount` (how many carry a rating), `avg` (average rating over those, one decimal, `null` when none), `operatorCount` (reviews by the mint's own operator, which are left out of the other three). |
| `eligibleForRecommendation` | boolean | `true` when the mint is online, has a score, is not a test mint and was first seen at least 14 days ago. |

The wallet responses never contain IP addresses or other network data, onion data, reviewer public keys or review texts, contact details, or the mint's NUT-06 public key.

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

`/api/v1/wallets/*`, `/api/v1/mints/known`, `/api/v1/mints/recommend` and `/api/v1/health` (and the unversioned paths) answer **any origin**: `Access-Control-Allow-Origin: *` for `GET`, `HEAD` and `OPTIONS`, no credentials, with `Access-Control-Expose-Headers: ETag, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset`. A preflight (`OPTIONS`) is answered with `204` and is not counted against any limit. Every other route (notably `probe`, `submit`, `discover` and `notifications`) only serves the MintRadar website's own origins; a browser request from another origin to one of them gets `403` with `{"error":{"code":"cors_forbidden","message":"…"}}`. Requests without an `Origin` header (servers, curl, native apps) are never affected.

### Caching

Every successful `GET` of `/api/v1/wallets/*`, `/api/v1/mints/known` and `/api/v1/mints/recommend` carries `Cache-Control: public, max-age=300` and a strong `ETag` over the body, on a cache hit as well as a miss. Send `If-None-Match` to get `304 Not Modified` (same headers, no body). The data moves with the 5-minute probe cycle, so **poll at most every 5 minutes**; a wallet that fetches the list once when it starts and then every 10 minutes is well within the limits. Error responses are not cached.

### Rate limits

| Routes | Limit |
|---|---|
| `/api/v1/wallets/*` | **300 requests / minute / IP** (its own counter) |
| `/health`, `/api/mints/known`, `/api/stats`, `/api/mint/icon` | no limit (read-only, cached) |
| every other read route, including `/api/mints/recommend` | **60 requests / minute / IP** |

Responses of limited routes carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix time, seconds, when the window ends). Every `429` carries `Retry-After` (seconds). Preflight requests are not counted. Counters are kept in memory and reset on a restart.

### Errors

The wallet routes answer errors as JSON:

```json
{ "error": { "code": "invalid_parameter", "message": "minScore must be an integer from 0 to 100" } }
```

| Status | `code` | When |
|---|---|---|
| `400` | `invalid_parameter` | a list query value is present but invalid |
| `400` | `invalid_url` | the `{url}` is not valid percent-encoding or not a well-formed public `https://` URL |
| `404` | `mint_not_found` | no tracked mint has this URL |
| `404` | `not_found` | unknown route below `/api/wallets` |
| `429` | `rate_limited` | over 300 requests per minute; also carries `retryAfterSec` |
| `500` | `internal_error` | server error |

The other routes keep their older shape `{ "error": "text" }` (see "Error Responses"), except the CORS rejection above.

### Stability

- Inside v1 a field is **never renamed or removed**, and its type does not change; changes are **additive** (new fields, new optional parameters). Clients must ignore fields they do not know.
- A deprecation is announced with `Deprecation` and `Sunset` response headers at least **90 days** before anything is removed, and in this document.
- `methodology` is an integer that changes **whenever the score formula changes** (weights, audit rule, version rule, new-mint cap). `score` values from different `methodology` numbers are not comparable. The history lives in `backend/src/shared/methodology.ts` (`METHODOLOGY_CHANGES`):

| Version | Date | Change |
|---|---|---|
| 1 | 2026-09-12 | Initial formula: uptime 40, audit 25 (audit.8333.space), NUTs 15, software version 15, contact 5; new mints capped at 75 for 30 days. |
| 2 | 2026-10-08 | Audit part now from cashu.info: failures attributed to the mint divided by swaps in 7 days; neutral under 10 swaps or without recent data. |
| 3 | 2026-10-09 | Version part follows one rule: outdated means two or more minor versions behind the newest stable release; zero or one behind scores full points. |

- Everything under "Internal routes" below has **no stability guarantee**.

---

## Rate Limits

| Endpoint type | Limit |
|---|---|
| `/api/v1/wallets/*` | **300 requests / minute / IP** |
| Read endpoints **except** `/health`, `/api/mints/known`, `/api/stats` and `/api/mint/icon` (these four are exempt) | **60 requests / minute / IP** |
| `/api/mint/submit` (POST) | **20 requests / hour / IP** |
| `/api/mints/discover` (POST) | **10 requests / hour / IP** |
| `/api/mint/probe` for a URL that is **not** a tracked mint | additionally **10 requests / minute**, **60 requests / hour** and **3 concurrent probes** per IP (tracked mints: global limit only) |

Rate limit headers are returned on every non-exempt read endpoint:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1760293860
```

Exceeding a limit returns HTTP `429 Too Many Requests` with a `Retry-After` header (seconds):

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

**Response:** Array of mint objects. Public with `Access-Control-Allow-Origin: *`; every response carries `Cache-Control: public, max-age=300` and a strong `ETag` (`If-None-Match` gives `304`). Wallets should prefer [`/api/v1/wallets/mints`](#api-for-wallets-v1), a compact summary with a stability guarantee; this array also carries website-only fields (`ipAddress`, `netAsn`, …) that may change.

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

`reviewCount` = counted NIP-87 reviews of the mint (the operator's own are left out; empty events are not counted); `reviewAvgRating` = their average over the rated ones (one decimal, `null` when none is rated); `reviewRatedCount` = how many of them carry a rating, the n behind the average (additive field, `null` until the backend's startup recount or the next review sync has filled it). The website's Dashboard "Rating" sort orders by the confidence-adjusted average `(n·avg + 5·3.5) / (n + 5)` over `reviewAvgRating` and `reviewRatedCount` (mints with few reviews rank lower; unrated mints last); the displayed values are not changed. `reviewWeightedRating` (an older server-side weighted value) is still returned, but the website no longer sorts by it. `degraded` = mint has been offline for 24h+. `nutsLimits` keys are NUT numbers as strings. `ipAddress` (public IPv4 of the mint host, our own DNS lookup), `netAsn` / `netOrg` / `netCountry` (AS number, organisation and ISO country of that IP block, from ipinfo.io) and `hasOnion` (the mint's `/v1/info` lists a `.onion` address) are measured by MintRadar itself; each is `null` until first measured.

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
| `403` | A browser request from an origin that is not allowed on a non-public route: `{"error":{"code":"cors_forbidden","message":"…"}}` |
| `429` | Rate limit exceeded (`Retry-After` header) |
| `500` | Internal server error |

The error shape of the wallet routes (`{ "error": { "code", "message" } }`) is described in "API for wallets (v1)".

---

## For wallet developers

`GET /api/v1/mints/recommend` returns a short list of currently healthy mints suitable for a wallet’s default or suggested list.

**Query parameters**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `unit` | `sat` | Unit the mint must support |
| `minScore` | `80` | Minimum reliability score (0–100) |
| `limit` | `5` | Max results (1–10) |
| `nuts` | — | Comma-separated NUT numbers the mint must support (e.g. `4,5`) |

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
  "generatedAt": "2026-10-10T19:00:00.000Z"
}
```

Results change every few minutes (probe cycle). A wallet should still let the user override and pin a preferred mint.

