# Post-announcement backlog (written 2026-10-22, task E1; statuses checked 2026-11-08)

What is planned after the public announcement. Nothing in the "By feedback only" table is started without a reason from users or wallet teams.
Every status below was checked against the code, the docs or the live site on 2026-11-08; "Owner" means it cannot be checked from the repo.

## Open

| Item | Status 2026-11-08 |
|---|---|
| SQL report on the relay delivery counters (was due about 2026-10-30) | **Overdue, not recorded anywhere.** The counters exist (`reviewsRelayStats.ts`, `reviews-and-nostr.md` "Relay delivery counters"); the report needs a read on the production database. |
| First real mint change: test the change log, the DM and the feed tag | **Change log and feed tag verified 2026-11-08:** `/api/mints/changes` holds 48 changes of 11 types on the tracked mints (first 2026-10-22); 17 signed kind 30385 events on `wss://nostr.mintradar.org` carry `mint_last_change`, each equal to the newest `observedAt` of that mint (e.g. minibits 2026-11-07 00:25, cashu.cz 2026-11-03 18:10, lnw.cash 2026-10-31 11:37). **DM still unverified:** the DM-triggering changes so far are `pubkey_changed` (mint.lnw.cash, 2026-10-31 10:50) and `input_fee_changed` (mint.lnpay.cz, 2026-10-30 13:57); nothing on the server records a sent DM beyond 2 days (`notification_dm_quota`), so only a subscriber of those mints can confirm it (owner). |
| Condense `docs/claude` | Parked by the owner 2026-11-08: only the 4 largest files (stats-dashboard-watchlist-ui, backend-api-and-data, card-and-mint-detail-ui, deploy-and-infra, about 450 KB), one at a time with owner review; keep the rules, move history verbatim to `docs/claude/archive/`. |

## Owner (cannot be checked from the repo)

| Item | Detail |
|---|---|
| Wallet teams and gorrdy | Answer their questions; small doc/API fixes from their feedback |
| Minibits courtesy note | Tell them their Nostr contact value is shown in a shortened "npub..." form |
| Monitoring | PageSpeed, `/health`, the kind 30385 event, error logs |
| Server clean-up after the announcement | Tracked privately |

## Recurring and fixed dates

| Date | What |
|---|---|
| Monthly | Docker / NodeSource updates |
| Monthly (next about 2026-12-08) | Audit-part check: add a row to `scoring-and-probing.md`, "Monthly audit-part check" (first done 2026-11-08) |
| 2027-01-01 | Check the year label of the 90-day trend. The rule is already built ("1 Jan 2027" on the first tick of a new year, `stats-dashboard-watchlist-ui.md`, "X axis rule"); only the look on the day is left to check. |
| 2027-01-26 | Sunset of `/api/v1/mints/recommend`. The `Deprecation` and `Sunset: Tue, 26 Jan 2027` headers are live; on the day the route goes. |

## Done (verified 2026-11-08)

| Item | Where |
|---|---|
| strfry HEALTHCHECK | Task E3 (`deploy/strfry/docker-compose.strfry.yml`); the relay container reports `healthy` on server01 |
| `/mint/<URL ending in .svg/.png/.js>` answered 404 | Task E3, `location ^~ /mint/`; live: such a URL gets the "Mint not found" page |
| Start-up order (`app.listen` before `initDb`, with a test) | Task E4 readiness gate (`index.ts` start block, `integration/readiness.test.ts`) |
| `h7` aggregate `EXPLAIN (ANALYZE, BUFFERS)` | Tasks E2/E2b: the 7-day aggregate is about 0.3 s; JIT off fixed the 3.9 s query; the `mint_history(checked_at)` index is deferred until about 0.5 s becomes a problem (`backend-api-and-data.md`) |
| Stale limits unified to 5 minutes | Task E1 |
| One DNS retry for e-mail contact checks | Task E1 |
| "proofs" wording of the Compare "Backup" tooltip | Task E1 (now `COMPARE_BACKUP_TEXT` in `tooltipTexts.ts`) |
| Deferring vendor-nostr and vendor-db | Stage 2 perf, 2026-10-25 (`deploy-and-infra.md`, "Code splitting & bundle layout") |
| Real HTTP 404 for unknown paths | Stage 3 SEO, applied 2026-10-26: unknown paths and unknown mints answer 404 with the "Page not found" / "Mint not found" page (the old "soft 404 stays" decision is superseded) |
| Inline critical CSS | Done 2026-11-08: the entry CSS is inline (`vite-inline-css.ts`); FCP 1 040 -> 320 ms on Slow 4G (`deploy-and-infra.md`, "Code splitting & bundle layout") |
| Stats note about the 2026-10-08 audit source switch | Replaced by `moversMethodologyNote()`: the movers panel names every methodology change inside its 7/30-day window and the note goes away by itself |

## Declined

| Item | Why |
|---|---|
| brotli on nginx | Declined 2026-10-25: needs a third-party nginx module; built-in `gzip_static` with build-time gzip -9 instead (`deploy-and-infra.md`, "Precompressed .gz assets") |
| Icon resize | Declined 2026-10-25: built with `sharp`, reverted before release (minimal external dependencies). Icons get a 7-day cache + `stale-while-revalidate` + ETag, `loading=lazy`, `decoding=async`, width/height instead. Revisit only with a dependency-free approach. |
| Moving inline styles to CSS as its own task | Owner 2026-11-08: only when a component is reworked anyway (a mechanical move changes CSS precedence) |

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
| SSR | |
| JetBrains Mono | |
| OSV scanning | Deferred |
