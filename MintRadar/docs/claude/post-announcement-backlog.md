# Post-announcement backlog (written 2026-10-22, task E1)

What is planned after the public announcement. Nothing in the "By feedback only" table is started without a reason from users or wallet teams.

## Week 1 after the announcement

| Item | Detail |
|---|---|
| Wallet teams and gorrdy | Answer their questions; make small doc/API fixes from their feedback |
| Minibits courtesy note | Tell them their Nostr contact value is shown in a shortened "npub..." form |
| Monitoring | PageSpeed, `/health`, the new kind 30385 event, error logs |
| Server clean-up (after one week) | server clean-up after the announcement; tracked privately |
| About 2026-10-30 | SQL report on the relay delivery counters |

## Weeks 2-3 (small, low risk)

| Item | Detail |
|---|---|
| strfry HEALTHCHECK | Compose change, needs a server apply |
| Stale limits | Unify `KNOWN_MINTS_STALE_LIMIT` and `STATS_STALE_LIMIT` to 5 minutes (done in task E1) |
| DNS retry | One DNS retry on timeout for e-mail contact checks, no storage of contact values (done in task E1) |
| `/mint/<URL ending in .svg/.png/.js>` | Answers 404 because the static-asset regex has precedence over the `/mint/` prefix; fix it |
| Start-up order | `app.listen` before `initDb`, with a test |
| "proofs" wording | Compare "Backup" tooltip (done in task E1) |
| `h7` aggregate | `EXPLAIN (ANALYZE, BUFFERS)` on the production database for the 7-day aggregate before deciding on an index `mint_history(checked_at)` |
| brotli on nginx | **Declined 2026-10-25** (needs a third-party nginx module; minimal external dependencies). Built-in `gzip_static` with build-time gzip -9 instead, see `deploy-and-infra.md`, "Precompressed .gz assets". |
| Inline critical CSS | Render-blocking today; needs a CSP check |

## By feedback only

Do not start without a reason from users or wallet teams.

| Item | Note |
|---|---|
| Methodology v4 | For real, through a shadow phase |
| "Best mint for me" | |
| Nutzap: kind 10019 adoption signal | **BUILD LATER** (Task E5, measured 2026-10-22). 455 distinct authors across damus, nos.lol, primal and our relay (our relay holds 1 event); 325 of them (71 %) list the Minibits default mint, so the signal mostly reflects one wallet's default. Start only after wallet-team or user feedback. First step: daily relay sweep, `verifyEvent`, newest event per author, at most 10 mint tags, `normalizeUrl`, one integer column on `mints`, shown only above a threshold (e.g. >= 5), never part of the Trust Score, optional additive API field. |
| Nutzap: "capable" verdict, "which mint to put your 10019 on" hint | **Do not build** (a verdict and a recommendation, see Task U). |
| Nutzap: Cashu-native donation | Deferred by the owner; no design is recorded. |
| Watchlist without login | |
| DM notification settings | **DO NOT BUILD** (Task E5). Triggers unchanged: dozens of subscribers, a complaint, or a flapping mint with a subscription (mute was dropped on 2026-10-02). Smallest step when a trigger comes: two separate pills for key rotation and fee change, then a global pause. No digest, no quiet hours without a reason. |
| Atomic deploy | |
| Icon resize | **Declined 2026-10-25:** built in Stage 2 with `sharp`, reverted before release (minimal external dependencies). Icons get a 7-day cache + `stale-while-revalidate` + ETag, `loading=lazy`, `decoding=async`, width/height instead. Revisit only with a dependency-free approach. |
| Deferring vendor-nostr and vendor-db | **Done 2026-10-25** (Stage 2 perf): out of the initial modulepreload, loaded on first use / after first paint; see `deploy-and-infra.md`, "Code splitting & bundle layout". |
| SSR | |
| JetBrains Mono | |
| OSV scanning | Deferred |
| Real HTTP 404 for unknown paths | Soft 404 stays; the decision record and the triggers are in `docs/claude/deploy-and-infra.md` (next to the nginx soft-404 section) |

## Fixed dates

| Date | What |
|---|---|
| 2026-10-30 | SQL report on relay delivery counters |
| About 2026-11-09 | Monthly audit score analysis |
| Monthly | Docker / NodeSource updates |
| 2027-01-01 | Year label of the 90-day trend |
| 2027-01-26 | Sunset of `/api/v1/mints/recommend` |
| First real mint change | Test the change log, the DM and the feed tag |
