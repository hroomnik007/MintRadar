# MintRadar — Discovery pipeline, test-mint detection, relay lists (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Discovery pipeline

`discoverMintsFromNostr()` in `backend/src/discovery.ts` runs 3 sources in parallel via `Promise.allSettled`:
- **kind:38172** — NIP-87 mint announcements (direct `u` tag)
- **kind:38000** — reviews; `#u` tag mining extracts reviewed mint URLs
- **audit.8333.space** — external audit API. `discoverMintsFromApi()` does 2 passes over the ~65 mints audit.8333.space knows about: (1) one paginated `GET /mints/` call (100/page) for discovery + cumulative lifetime counts (`audit_n_mints`/`audit_n_melts`/`audit_n_errors`, display-only, feeds the Audit tab's all-time line) and each mint's audit refresh time (`audit_synced_at = NOW()`) and to capture each mint's audit.8333.space `id` (stored as `audit_id`); (2) a sequential per-mint `GET /swaps/mint/{id}?limit=100` pass (~65 extra requests, 150ms apart) for the rolling-window reliability score (`audit_recent_total`/`audit_recent_errors`, feeds Reliability Score — see above) — as of 2026-09-12 this same pass also parses and persists the full per-swap detail into `mint_audit_swaps` and computes `audit_avg_time_ms` (see the "mint_audit_swaps" DB Tables entry above). Runs once per 6h discovery cycle, so ~65 extra requests/6h — not throttled further, well within reasonable API use.

<!-- moved to CLAUDE.md, Hard invariants -->

Approximate yields (as of 2026-06-29): kind:38172 ~33 mints, kind:38000 ~37 mints, audit.8333.space ~61 mints. Total DB: ~97 mints.

**URL normalization:** `normalizeUrl()` lowercases the hostname before every INSERT. Applied in 4 places: `discoverMintsFromNostr`, `discoverMintsFromApi`, `POST /api/mint/submit`, `POST /api/mints/discover`. Prevents duplicates like `https://Mint.coinos.io` vs `https://mint.coinos.io` (the capital-M variant was a seed bug and was manually deleted).

## Test mint detection (2026-09-04)

`src/constants/testMints.ts` (frontend) + `backend/src/testMints.ts` (manually-synced mirror,
same no-workspace caveat as `auditScore.ts`/`reliabilityScore.ts`) hold `TEST_MINT_URLS` — a
**manually curated set of 6 known dev/test-only mint URLs** (`8333.space:3338`,
`testnut.cashu.space`, `nofee.testnut.cashu.space`, `rugs.cashu.exchange`,
`rugs01.cashu.exchange`, `cashu.centurymetadata.org`) — and `isTestMint(url)`.

A pure keyword match on `/v1/info`'s `description`/`description_long` was deliberately
rejected as the runtime mechanism: wording isn't consistent across mints, generic risk
disclaimers on real production mints (Minibits, Sovran: "use at your own risk", "still in
development") would false-positive, and at least one mint's warning text changed to
something benign between probes — none of that should silently change what gets hidden from
recommendations. The short `description` field (where this warning text actually lives) also
isn't persisted to the DB today.

Test and demo mints are marked only through the manual list in constants/testMints; there is no text-based detection (it was tried and removed because it flagged normal mints).

These mints are **not hidden from the app** — they still appear in `/api/mints/known`, are
still probed/tracked normally, and get a "Test mint" badge (`MintCard.tsx`, `MintDetail.tsx`,
always rendered last among a card's badges). They ARE excluded from anything that implies a
recommendation: the Best Mint Wizard (`Tools.tsx`), "Recommended by Follows"
(`useFollowRecommendations.ts`), the backend's `top5ByReliabilityScore` (`backend/src/index.ts`,
`GET /api/stats`), and (as of 2026-09-19, closing a real gap — see below) the Stats page's own
**`top5ByReliability`** (`Stats.tsx`), which previously had no test-mint exclusion at all despite
this section's claim. Update `TEST_MINT_URLS` manually (both copies) if a new dev/test mint
surfaces — grep fresh `/v1/info` responses for phrases like "for testing and development
purposes" or "fakewallet", but confirm it isn't a real mint with a mere risk disclaimer first.

### "Not recommended" = test-badged (2026-10-05)

"Not recommended" is exactly `isTestMint(url)` (`src/utils/notRecommended.ts`; the helper stays
because Dashboard, Stats and Tools share it). It is used only for sorting, filtering and labelling,
never for the Reliability Score.

- Best Mint never returns such mints (no toggle; muted line "Test mints are never recommended
  here." under the results); Stats `top5ByUptime` / `top5ByReliability` skip them, and so does the
  backend's `top5ByReliabilityScore` (via `isTestMint`).
- Dashboard grid and list apply a stable partition AFTER the sort and direction flip so test-badged
  mints come after every other mint in every sort mode (there is no pagination, every mint is
  rendered).
- "Hide test mints" hides test-badged mints only ("Show N of M" uses the same `applyFilters`).
- `useFollowRecommendations` is unchanged (it only has URLs, no known-mint data).
- Operator reviews (see reviews-and-nostr.md) and mint name cleaning are separate and unaffected.

### Recommendation-surface minimum age gate (2026-09-19, audit run-3 MEDIUM finding)

A brand-new mint (hours-to-days of track record) could reach a "recommendation" surface's
top-5 purely on a high Reliability Score — `NEW_MINT_RELIABILITY_CAP` (see "Reliability Score calculation"
above) only discounts a new mint's *score* (capped at 75 for its first `NEW_MINT_MAX_DAYS` =
30 days), which doesn't by itself stop a well-configured new mint from still out-ranking
everything else online. `isEligibleForRecommendation(discoveredAt)` /
`MIN_RECOMMENDATION_AGE_DAYS` (14) — in `backend/src/shared/reliabilityScore.ts`, mirrored in
`src/utils/reliabilityScore.ts` (same no-workspace caveat as the rest of that file) — is an
*additive* gate on `discovered_at` alone (there's no `probe_count` column to check instead;
`discovered_at` is `NOT NULL` on every `mints` row). Wired into:

- **Backend `top5ByReliabilityScore`** (`GET /api/stats`) — `discovered_at` added to that query's
  `SELECT`, filtered alongside the existing `!isTestMint()` check.
- **Frontend `top5ByReliability`** (`Stats.tsx` Reliability tab) — same filter, using `KnownMint.discoveredAt`.

**Deliberately NOT applied to `top5ByUptime`** ("Most Reliable" tab, same page) — that panel
reports a measured uptime fact, not a recommendation, and a mint with high uptime over its
measurement window is telling the truth about that window regardless of how old the mint is.
(The window itself moved from 24h to 7d the same day — see "Most Reliable panel — 7-day
default window" below; that's an unrelated change about window *length*, not mint age.)

### Most Reliable panel — 7-day default window (2026-09-19)

`top5ByUptime` (`Stats.tsx`) now ranks by **`uptimePct7d`**, not `uptimePct24h` — on a 24h
window most of the network sits at 100% uptime, so the ranking barely differentiated a mint
that's been reliable for a while from one that just got lucky on the last few 5-minute probe
cycles. The panel label changed from **"Most Reliable · 24H"** to **"Most Reliable · 7D"**.
This is unrelated to the age gate above: `isEligibleForRecommendation()` is about how old the
*mint* is (`discovered_at`), this is about how long the *uptime measurement window* is —
`top5ByUptime` still deliberately has no age gate, only test-mint exclusion.

- **Backend:** `/api/mints/known` (`backend/src/index.ts`) gained a second bulk uptime
  aggregate alongside the existing 24h one — a `LEFT JOIN` subquery over `mint_history`
  grouped by `url` with a `WHERE checked_at > NOW() - INTERVAL '7 days'` filter (computed as
  its own pre-aggregated subquery, not a second raw `LEFT JOIN mint_history` alias like the
  24h one, to avoid a Cartesian blow-up between two independently-filtered joins on the same
  table), exposed as **`uptimePct7d`** using the same `total === 0 ? null : Math.round(...)`
  pattern as `uptimePct24h`. `uptimePct24h` itself is unchanged and still used everywhere
  else (mint cards, the Stats "avg uptime 24h" hero tile, `computeDegraded()`).
- **Frontend:** `KnownMint` (`src/hooks/useKnownMints.ts`) gained `uptimePct7d?: number |
  null`. Only `top5ByUptime`'s filter/sort and its row display (`mint.uptimePct7d`) switched
  fields — no other `uptimePct24h` call site in the app was touched.
- **No new UI element** — there was no existing 24h/7d/30d/90d period selector on this panel
  (unlike Mint Detail's chart), so per the request this landed as a plain default-source
  change, not a new toggle. The panel keeps its existing Reliable/Reliability tab toggle
  (`reliableTab` state) unchanged.
- Tests: `backend/src/__tests__/integration/mints-known.test.ts` (uptimePct7d computed
  independently of uptimePct24h; null when the mint has no 7-day history) and
  `e2e/stats-widgets.spec.ts` ("Most Reliable panel is labeled 7D and ranks by uptimePct7d,
  not uptimePct24h" — uses deliberately opposite 24h/7d values per mint to prove the panel
  reads the right field). `e2e/fixtures/mocks.ts`'s `MockMint`/`knownMintPayload()` gained an
  optional `uptimePct7d` that defaults to `uptimePct24h` when a spec doesn't set it, so
  pre-existing specs didn't need per-row changes. The pre-existing "Reliability tab still shows it"
  half of the test-mint-exclusion test was also fixed in the same pass — it had gone stale
  independently, from the `isEligibleForRecommendation()`/test-mint work above landing in
  `top5ByReliability` without this test being updated (see that section).

**`useFollowRecommendations.ts` ("Recommended by Follows", Watchlist page) is a genuinely
independent third mechanism, not a shared copy of this logic** — it ranks by how many of the
viewing user's own Nostr follows have reviewed/mentioned a mint (`kind:38000` `#u` tag count),
not by Reliability Score, and was checked but deliberately left without this age gate: the ranking
signal there is real distinct humans (the user's follows) recommending a URL, which isn't the
"score gamed by a brand-new mint" vulnerability class this gate addresses. It already has its
own `isTestMint()` filter (`fetchFollowRecs`), unchanged.

<!-- moved to CLAUDE.md, Hard invariants -->
**Superseded 2026-09-19 by a live audit — see below for the current 10-relay list and why.**
The 17-relay list below is left as historical context for the additions/removals documented
in this section; do not treat it as the current `DISCOVERY_RELAYS` contents.

wss://relay.damus.io, wss://nos.lol, wss://purplepag.es, wss://relay.snort.social,
wss://relay.primal.net, wss://relay.cashumints.space, wss://relay.azzamo.net,
wss://eden.nostr.land, wss://nostr.wine, wss://nostr-pub.wellorder.net,
wss://offchain.pub, wss://relay.8333.space, wss://nostr.oxtr.dev, wss://relay.nostr.net,
wss://nostr21.com, wss://nostr.bitcoiner.social, wss://nostr.cypherpunk.today

**2026-08-16 — `nostr.bitcoiner.social` and `nostr.cypherpunk.today` added**, alongside
`relay.snort.social` filling in wherever it was still missing. Verified reachable (TCP:443
connect) before adding. Requested to go into every relay list in the project, not just the
unified discovery set above — also added to `REVIEW_PUBLISH_RELAYS`/`PROFILE_RELAYS`
(`src/core/nostr/relays.ts`), `META_RELAYS`/`NOTIFICATION_RELAYS` (backend `nostrService.ts`
+ frontend `client.ts`/`notificationSubscription.ts`), `NIP46_RELAYS` (`client.ts`),
`BOOTSTRAP_RELAYS` (`useUserRelays.ts`), `FOLLOW_RELAYS` (`useFollowRecommendations.ts`), and
`WATCHLIST_RELAYS` (`watchlistSync.ts`) — i.e. every relay array in the codebase, not just
the 4 "unified" discovery/review locations this section otherwise tracks. `REVIEW_PUBLISH_RELAYS`'s
own explicit `nostr.bitcoiner.social` entry was removed since it's now inherited via
`DISCOVERY_RELAYS` (same dedup pattern as the `nostr.oxtr.dev` case below).

`wss://relay.8333.space` was added to every discovery/review relay list in the project —
same operator as `audit.8333.space`, likely higher density of Cashu-specific NIP-87 events.

**2026-09-02 — `META_RELAYS` (`client.ts`) is now a deliberate exception to the
"every relay array" rule above.** It is the post-login bootstrap set (kind:0 profile +
kind:10002 relay list, fetched in one `subscribeMany` by `bootstrapUserData()`) and was
cut to a 4-relay fast path — `purplepag.es`, `relay.primal.net`, `relay.damus.io`,
`nos.lol` — for login latency (name/avatar was taking ~4s; the slow/unreachable relays
each cost up to ~3s of dead wait on that path for no extra yield). Do NOT re-add the
broad set here. `useUserRelays.ts`'s old `BOOTSTRAP_RELAYS` array is gone — that fetch is
now the same `bootstrapUserData()` call. `useFollowRecommendations` is no longer
prefetched from `AppShell` on login (it loads lazily from the Watchlist page only).
`nip65Relays` is persisted in `auth.store` `partialize` so a reload skips the fetch.

**Immediate logged-in state + `subscribeFirstEvent()` (`client.ts`):** `loginWithNip07()`
returns `{ pubkey, npub }` the instant `window.nostr.getPublicKey()` resolves — the navbar
renders logged-in (short npub as the name fallback) before any relay round-trip. Name/avatar
and the NIP-65 relay list are then filled in by `bootstrapUserData()`, triggered from
`useUserRelays` once the auth store holds a pubkey. Both `fetchNostrProfile()` (single kind:0)
and `bootstrapUserData()` (kind:0 + kind:10002 together) resolve via `subscribeFirstEvent()` —
a helper that finishes as soon as the first `verifyEvent()`-passing event arrives on ANY
relay in the set, instead of `SimplePool.querySync()`'s old behavior of waiting for every
listed relay to EOSE (a ~4.4s per-relay ceiling that dominated login latency). Falls back to
`null` on all-EOSE-empty or a 6s timeout (`USER_BOOTSTRAP_TIMEOUT_MS`).

**2026-08-15 — `relay.nostr.band` replaced, 3 relays added (all 4 relay-list locations):**
User noticed devtools showing `relay.nostr.band` (`NS_ERROR_UNKNOWN_HOST`/timeout) and
`relay.8333.space` (`NS_ERROR_CONNECTION_REFUSED`) failing, plus `relay.damus.io`
returning occasional 503s. Investigated each:
- `relay.nostr.band` — genuinely down (TCP handshake to `95.216.33.150:443` hangs/times
  out; confirmed not a general network issue since other Hetzner-hosted relays, e.g.
  `nos.lol`, connect fine). **Replaced** with `eden.nostr.land` everywhere it appeared.
- `relay.8333.space` — also down right now (`EHOSTUNREACH`), but **kept** in the list (its
  Cashu-specific NIP-87 density is worth it once it recovers — same operator as
  `audit.8333.space`, which is up).
- `relay.damus.io` 503s — NOT a bug, confirmed by hammering it with 10 sequential
  WebSocket connects: ~20% hit HTTP 503 (Cloudflare load-shedding), ~80% open in
  ~200-400ms. `sharedPool` already races all relays in a list simultaneously
  (`querySync`/`subscribeMany`), so this doesn't cause user-visible failures — it was
  flagged in devtools but the login flow succeeded regardless. No fix needed.
- **Added** `nostr.oxtr.dev` (99ms connect — already trusted, was previously only in
  `REVIEW_PUBLISH_RELAYS`'s own extra list; that duplicate entry was removed since it's
  now inherited via `DISCOVERY_RELAYS`), `relay.nostr.net` (284ms), and `nostr21.com`
  (483ms) — all verified reachable via a direct `ws` handshake test before adding.
  `relay.current.fyi` (DNS doesn't resolve) and `relay.nostrati.com`/`relayable.org`
  (502/timeout) were also tried as candidates and rejected as unreliable.
<!-- moved to CLAUDE.md, Hard invariants -->

**Streaming vs. batch discovery:** considered and deliberately rejected. Discovery runs in
the background with no live UI to update, so a streaming subscription (incremental
per-event handling) wouldn't produce any visible benefit over the current EOSE/timeout
batch pattern (`querySync` + race against a timeout, or `subscribeMany` resolved on
`oneose`). Do not "improve" this to streaming without a concrete reason.

### 2026-09-19/20 — live relay audit (NIP-11 + WS REQ, replaces the "verified reachable via
TCP handshake" spot-checks above with an actual read-yield measurement)

Ran a live audit against every relay in `DISCOVERY_RELAYS`/`REVIEW_SYNC_RELAYS`/
`REVIEW_READ_RELAYS`/`REVIEW_PUBLISH_RELAYS`/`PROFILE_RELAYS`/`NOTIFICATION_RELAYS`: NIP-11
`GET` + a WS `REQ` for `kind:38172` and `kind:38000` (`limit: 5`), 3 measurement cycles for
the "soft cut" candidates, plus a write test for the one new candidate proposed
(`relay.nostr.band`, kind:38000, throwaway key). Full measured table (host, NIP-11 status,
EOSE time, event counts) is in the session transcript, not reproduced here — this section
records the resulting constant changes and why.

**Current `DISCOVERY_RELAYS` (10, both `src/core/nostr/relays.ts` and backend
`discovery.ts`):**

```
wss://relay.damus.io, wss://nos.lol, wss://relay.primal.net, wss://relay.cashumints.space,
wss://relay.azzamo.net, wss://nostr.oxtr.dev, wss://offchain.pub,
wss://nostr.bitcoiner.social, wss://nostr.cypherpunk.today, wss://nostr-pub.wellorder.net
```

- **Dropped, confirmed dead/broken:** `relay.8333.space` (still `EHOSTUNREACH`),
  `relay.nostr.net` (NIP-11 still HTTP 500 — same finding as 2026-08-15, never recovered),
  `nostr.wine` (403 on anon REQ, all 3 cycles).
- **Dropped, thin/zero measured yield across 3 cycles:** `purplepag.es` (0/5 events either
  kind — it's a kind:0/10002/51 directory, not a NIP-87/38000 host; stays in
  `PROFILE_RELAYS`), `relay.snort.social` (only 1/5 kind:38172, 0/5 kind:38000).
- **Moved out of general discovery into backend-only `REVIEW_SYNC_RELAYS`:**
  `eden.nostr.land` and `nostr21.com` — both paid/restricted-write, but both measured strong
  kind:38000 yield (5/5 each); fine for a read-only cron, not fine for `DISCOVERY_RELAYS` or
  `REVIEW_PUBLISH_RELAYS` (write cost) or `PROFILE_RELAYS`.
- **Revived:** `nostr-pub.wellorder.net` — the 2026-08-15 entry above replaced it as
  "genuinely down"; re-measured now as consistently healthy (0/5 kind:38172 but **5/5
  kind:38000, all 3 cycles**). Whatever caused the 2026-08-15 TCP hang no longer reproduces.
- **`nostr.oxtr.dev` — sandbox-vs-production discrepancy, not a relay problem:** the auditing
  sandbox could not open a raw TCP connection to its IP at all (confirmed with a bare
  `/dev/tcp` test, independent of any Nostr/WS code) — re-verified live from the production
  VPS instead: 37ms connect, 5/5 + 5/5 events, EOSE <60ms. Kept; this was an environment
  artifact of the audit, not evidence against the relay.
- **`relay.nostr.band` (the one new candidate this audit evaluated) — confirmed dead from
  BOTH the sandbox and the production VPS** (NIP-11 fetch failed, WS handshake timed out).
  Matches the 2026-08-15 finding (`95.216.33.150` still doesn't respond). **Not added
  anywhere** — and since it was already confirmed dead, it was also removed 2026-09-20 from
  `NOTIFICATION_RELAYS` (frontend `notificationSubscription.ts` — moved there 2026-10-04 when the in-browser DM hook was removed — + backend
  `nostrService.ts`), the one place it still lived. No replacement needed there —
  `resolveNotificationRelays` already caps at 10, and `nostr-pub.wellorder.net` (revived
  above) was already present in that list.

**`REVIEW_SYNC_RELAYS` (backend `reviewsSync.ts`) is no longer a straight mirror of
`DISCOVERY_RELAYS`/the old `REVIEW_RELAYS`** — it's now `DISCOVERY_RELAYS` (10) +
`relay.minibits.cash` + `nostr.mom` + `eden.nostr.land` + `nostr21.com` (14 total). See its
own file comment. `backend/src/__tests__/nostrReviewsRelays.test.ts` was extended in the same
pass to cross-check `DISCOVERY_RELAYS` directly against the frontend's own array (not just a
hand-copied snapshot) — backend `discovery.ts`'s `DISCOVERY_RELAYS` is now `export`ed for
this; the two npm packages still share no workspace, but `relays.ts` has zero runtime
dependencies so importing it directly from a backend test file works fine.

**`REVIEW_PUBLISH_RELAYS`** dropped `pyramid.fiatjaf.com` (NIP-11 `restricted_writes: true`)
and `nostr.lopp.social` (0/5 events either kind, all 3 cycles — no revival); everything else
in it (the new `REVIEW_RELAYS` base + `nostr.mom`/`relay.mostr.pub`/`relay.noswhere.com`)
measured real yield.

**`REVIEW_READ_RELAYS`** and **`PROFILE_RELAYS`** each just lost `relay.nostr.net` (still
500) — no other changes; this audit measured kind:38172/38000 yield, not kind:0, so there was
no evidence to justify touching the rest of `PROFILE_RELAYS`.

**Out of scope for this audit, deliberately untouched:** `META_RELAYS` and `NIP46_RELAYS`
(`client.ts` + backend `nostrService.ts`'s own separate `META_RELAYS` copy) — the audit and
its two follow-up commits were scoped to `relays.ts` + its backend mirrors +
`NOTIFICATION_RELAYS` only.

