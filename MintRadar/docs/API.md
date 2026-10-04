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

### `GET /health` and `GET /api/v1/health`

Health check. Available at `/health` and `/api/v1/health` (identical payload). There is no `/api/health`. No rate limiting on either path.

**Response:**
```json
{ "status": "ok", "timestamp": "2026-06-25T10:00:00.000Z", "lastProbeAt": "2026-06-25T09:58:12.000Z", "lastAuditSyncAt": "2026-06-25T06:00:03.000Z", "lastReviewsSyncAt": "2026-06-25T07:12:44.000Z", "auditUpstream": "ok", "auditUpstreamCheckedAt": "2026-06-25T06:00:01.000Z",
  "auditCz": { "lastSyncAt": "2026-06-25T09:53:00.000Z", "mintsStored": 62, "swapsStored": 98, "skipped": { "mints": 0, "swaps": 2 } } }
```

`lastProbeAt` is when the 5-minute probe cycle last finished sweeping every mint (not merely "process is alive") — `null` until the first cycle completes after a restart.

`lastAuditSyncAt` is the newest `audit_synced_at` in the database (`MAX(audit_synced_at)` over all mints, cached in-process for 30s), so it **survives restarts and deploys**. It is `null` only if no mint has ever synced. If it stays old, audit-derived data (Recent reliability, the Audit component of the Reliability Score) is stale.

`lastReviewsSyncAt` is the newest `reviews_checked_at` in the database (`MAX(reviews_checked_at)`, read in the same query and the same 30s cache as `lastAuditSyncAt`), so it also **survives restarts**. It is `null` only if no mint has ever been reviews-synced. It is stamped for every mint whose relay query and DB write completed in the 6h reviews sync, even when nothing changed. Caveat: a relay query that returns no events (including every relay being unreachable) still counts as a completed pass, so this proves the sync job is running, not that relays were reachable.

`auditUpstream` is `"ok"`, `"down"` or `"unknown"` and `auditUpstreamCheckedAt` is an ISO timestamp or `null`. They report the outcome of the **last audit sync attempt** (the 6h discovery cron against api.audit.8333.space), **not a live check**: `/health` never calls the upstream. A successful list fetch is `ok`; a non-OK HTTP response, timeout, network error or malformed body is `down`. The state is in-memory only, so after a restart or deploy it is `"unknown"` (with `auditUpstreamCheckedAt: null`) until the next sync, up to 6h later.

`auditCz` reports the **last audit.cashu.cz sync cycle** (every 10 minutes, see `GET /api/mints/audit-cz`), in memory only: `lastSyncAt` is when that cycle finished, `mintsStored` / `swapsStored` are the rows written (`null` when that response failed and nothing was written), `skipped` the number of items dropped as malformed or unknown per response. All fields are `null` until the first cycle after a restart. A `skipped` above 0 means the upstream sent something we do not parse. Counts only — no item contents, URLs or error strings.

Only timestamps, counts and this three-value enum are exposed — no error messages, upstream URL or status codes.

---

### `GET /api/mints/known`

All known mints with current online status, latency, reliability score, and metadata. Returns **every row** the server knows, including archived mints (offline 30+ days) — nothing is filtered out; use the `archived` and `degraded` flags on each object to tell them apart.

**Response:** Array of mint objects.

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
    "reliabilityScore": 88,
    "uptimePct24h": 100,
    "discoveredAt": "2025-11-01T12:00:00.000Z",
    "serverLocation": "Frankfurt am Main, DE",
    "lastCheckedAt": "2026-06-25T09:55:00.000Z"
  }
]
```

`degraded` = mint has been offline for 24h+. `nutsLimits` keys are NUT numbers as strings.

---

**Audit timestamps (per mint, both ISO 8601 UTC):** `auditCheckedAt` is the auditor's own last check (audit.8333.space `updated_at`); `auditSyncedAt` is when MintRadar's 6-hourly job last wrote that mint's audit data. They can differ a lot — `auditCheckedAt` may be days or months old while `auditSyncedAt` is recent, or both may age together while the upstream is unreachable. `auditRecentTotal`/`auditRecentErrors` are the rolling-window figures the Audit score component uses (`auditRecentTotal` below 3 or `null` scores a neutral 12.5/25). The score is not adjusted for the age of this data.

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

Software version timeline for a single mint.

**Query parameters:** `url` (required, `https://…`)

**Response:**
```json
{
  "url": "https://mint.example.com",
  "history": [
    { "version": "0.16.3", "firstSeenAt": "2026-05-10T08:00:00.000Z" }
  ],
  "latestGlobalVersion": "0.16.3"
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

Data from the third-party audit service audit.cashu.cz for one mint, refreshed server-side every 10 minutes. Display only: it is **not** part of the Reliability Score and is never merged into any MintRadar value.

**Query parameters:** `url` (required, `https://…`, max 500 characters)

**Response (covered):**
```json
{
  "source": "audit.cashu.cz",
  "sourceUrl": "https://audit.cashu.cz/mint/abc",
  "fetchedAt": "2026-10-04T10:03:01.000Z",
  "covered": true,
  "mint": { "state": "ok", "uptime24h": 99.5, "uptime7d": 98.1, "uptime30d": 97.4, "attributedFailures": 1, "lastCheck": "2026-10-04T09:58:00.000Z" },
  "swaps": [
    { "id": "s1", "at": "2026-10-04T09:00:00.000Z", "status": "failed", "stage": "melt", "error": "…", "amount": 10, "fee": 1,
      "durationMs": 900, "direction": "from", "otherMintUrl": "https://other.example", "otherMintName": "Other" }
  ],
  "stats7d": {
    "windowDays": 7,
    "collectedSince": "2026-09-27T14:56:14.546Z",
    "melts": { "paid": 18, "failed": 5, "pending": 1, "amountPaid": 11100, "feesPaid": 60 },
    "mints": { "paid": 23, "failed": 22, "pending": 0, "amountPaid": 1752, "feesPaid": 0 },
    "avgDurationMsPaid": 4213.4,
    "swapsCounted": 69
  }
}
```
`state` is `ok`, `warn` or `error` — audit.cashu.cz's own verdict, not MintRadar's.

`stats7d` is **counted by MintRadar** over the swaps it stored with `at` in the last 7 days where `from_url` or `to_url` matches the mint (URL or alias) — it is not a figure published by audit.cashu.cz (`null` when the mint is not covered). A swap where this mint is the source (`from`) is a **melt**, where it is the destination (`to`) a **mint**; a swap matching on both sides is counted once, as a melt. `paid` = status `success`, `failed` = status `failed`, anything else is `pending` (excluded from paid/failed); `paid + failed + pending` over both directions equals `swapsCounted`. `amountPaid` / `feesPaid` are sums over paid swaps (a null fee counts as 0), `avgDurationMsPaid` is the mean `durationMs` of paid swaps that have one (else `null`). `collectedSince` is the `at` of the oldest swap in `audit_cz_swaps` — the window start the counts can claim (a value newer than 7 days ago means the numbers cover less than 7 days). **Unit:** `amount` / `fee` are in sat — an assumption: the feed has no unit field, but audit.cashu.cz's methodology page states every limit and amount in sat (fee = amount sent − amount minted − change) and its error strings read "need 25 sat, have 20 sat"; observed range amount 5–203, fee 0–10. `swaps` holds up to 20 newest swaps where the mint is `from` or `to`; `error` is untrusted text (≤300 characters). A mint matches by its URL or by one of the aliases audit.cashu.cz lists. When the mint is not in their feed the response is still `200` with `covered: false`, `mint: null`, `swaps: []` (`sourceUrl` null; `fetchedAt` is the newest fetch of the feed, or null). `Cache-Control: max-age=60`.

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
    "source": "nostr"
  }
]
```

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
