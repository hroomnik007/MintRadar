# MintRadar — Reviews feature, Nostr pool singleton (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Nostr pool singleton

`src/core/nostr/pool.ts` exports `sharedPool` — a single `SimplePool` instance patched with exponential backoff (1s base, doubles per attempt, 5-min cap, ±20% jitter). All frontend Nostr reads/writes must use `sharedPool`. Never call `sharedPool.destroy()`.

## Reviews Feature (Mint Detail)

All review-related relay lists live in `src/core/nostr/relays.ts`:
- **REVIEW_READ_RELAYS** (added 2026-08-30) — curated 7-relay fast-path used by `src/hooks/useMintReviews.ts` for the client-side read. `querySync` resolves only once EVERY listed relay EOSEs or times out, so this is deliberately small and only relays measured to connect+EOSE <600ms. Excludes `relay.8333.space` (EHOSTUNREACH), `relay.snort.social` (503 on anon REQ), `nostr.wine` (403), and the slower long-tail. Paired with `{ maxWait: 2000 }` on the querySync call (without it, nostr-tools falls back to a 4400ms per-relay EOSE ceiling — that was the bulk of the old client-side review-load delay).
- **REVIEW_RELAYS** (= DISCOVERY_RELAYS + `relay.minibits.cash`) — no longer used for the read path; kept only as the base for REVIEW_PUBLISH_RELAYS.
- **REVIEW_PUBLISH_RELAYS** (= REVIEW_RELAYS + 7 extra relays: bitcoiner.social, nostr.mom, oxtr.dev, mostr.pub, noswhere.com, pyramid.fiatjaf.com, lopp.social) — wider net used only by `src/hooks/useSubmitReview.ts` when publishing, for propagation reach
- **PROFILE_RELAYS** — unchanged, used for kind:0 profile lookups only

Backend `REVIEW_SYNC_RELAYS` (`backend/src/reviewsSync.ts`, re-exported from `index.ts` as `NOSTR_REVIEWS_RELAYS`) is the broad list used by the hourly background sync — it has a generous time budget so it favours coverage over latency (opposite trade-off from REVIEW_READ_RELAYS). **As of the 2026-09-19 audit it is no longer a straight mirror of the old REVIEW_RELAYS** — see "Discovery relays" above for its current composition (`DISCOVERY_RELAYS` + minibits.cash + mom + eden.nostr.land + nostr21.com). `backend/src/__tests__/nostrReviewsRelays.test.ts` pins the exact array as a drift tripwire, and now also cross-checks `DISCOVERY_RELAYS` directly against the frontend's own array. The frontend fast-path list is deliberately NOT mirrored.

## Reviews sync (hourly, batched, incremental, paced — 2026-10-05)

**Why one hour.** A review published by someone else used to show on MintRadar only after up to 6 hours (the sync rode on the 6h discovery cycle): a kashu.me review published at 16:11 UTC was not there two hours later because the last sync had ended at 15:45. One hour is the owner's decision. To make it cheap for the relays (reads cost them work even though we publish nothing) the sync was rebuilt so each relay sees a handful of requests per hour, not 76 in a burst.

**Schedule** (`reviewsSchedule.ts`, started in `cron.ts`): its own timer, independent of discovery (the discovery cycle no longer calls the sync). `REVIEWS_SYNC_PERIOD_MS` = 60 min, `REVIEWS_SYNC_START_OFFSET_MS` = 3 min after boot, plus a random jitter of up to `REVIEWS_SYNC_JITTER_MAX_MS` = 5 min **per tick** (ticks sit on an hourly grid, each moved by its own jitter, so a long run never shifts the grid) so the load does not line up with the 5-minute probe, the `:03/:13/...` audit sync or the daily jobs. **Single-flight:** a tick that finds the previous run still going is skipped with one log line (`isReviewSyncRunning`, `reviewsSync.ts`); allowlist mode skips the tick silently (no relay traffic).

**One run** (`runReviewsSync` in `reviewsSync.ts`, relay side in `reviewsRelayFetch.ts`; relay list: see "Relays added 2026-10-06" below):
- **One connection per relay per run**, closed at the end, talking plain `ws` (not `SimplePool`, which hides CLOSED reasons and NOTICEs). Relays run in parallel, each one strictly **one REQ in flight**, with a random **1–2 s pause between batches** to the same relay.
- **Batching:** one REQ per batch of `REVIEW_BATCH_SIZE` (20) mints: `{kinds:[38000], "#u":[<=20 urls>], limit:500[, since]}`. Events are mapped back to mints by their `u` tag with the same exact-string match as before (`groupEventsByMint`; an event naming two tracked mints belongs to both), so which review belongs to which mint is unchanged. If an answer reaches `limit` the batch is asked again in halves (down to single mints) so a busy mint cannot push the oldest reviews of the others out of the answer. No NIP-11 document is fetched anywhere in the backend, so the batch size is always the default (the number of tag values a relay accepts is not known).
- **Incremental:** per relay, `since` = start of the last *clean* run on THAT relay minus `REVIEW_SINCE_OVERLAP_S` (2 h). Progress is kept per relay in the table **`reviews_sync_relay_state`** (`last_ok_started_at`, `last_full_at`; survives restarts) and only moves for a relay that answered every batch, and only if everything fetched was stored. After a failure the state stays put, so the next run reaches further back. **Full sweep:** a relay with no state, or whose last full sweep is ≥ 24 h old (minus a 10 min slack for the offset and jitter, so it does not slip to ~25 h), runs without `since`; edited, old or relay-delayed events are picked up there. A failed sweep leaves `last_full_at` alone, so it is retried on the next run. If the state table cannot be read the run is a full sweep.
- **Back-off:** a CLOSED whose reason contains "rate-limited", "too many" or "blocked", a NOTICE of that kind, or the relay closing the connection after a REQ: the relay is skipped for the rest of the run and counted as failed. **3 consecutive failed batches** (timeout, other CLOSED, socket error) skip it too (`REVIEW_MAX_CONSECUTIVE_FAILURES`); a success resets the counter. An unreachable relay fails at connect with no REQ. A failed batch is not retried within the run (the next run reaches back further). Each skipped/failed relay logs one line with the relay URL and a fixed reason code (never relay-supplied text). **Risk to watch after the first deploy:** a relay that rejects 20 tag values with a "too many ..." CLOSED is skipped every run; the per-relay lines show it and the fix is a smaller `REVIEW_BATCH_SIZE`.
- **Maximum run time:** `REVIEW_MAX_RUN_MS` = 10 min; after that the run stops cleanly, logs it, and relays that did not finish are not marked clean.
- **Storage is unchanged:** signature (`verifyEvent`, once per distinct event across relays) and kind are checked, then `dedupeAndParseReviewEvents` → `persistMintReviews` per mint (empty-review and operator rules in `aggregateReviews`, `ON CONFLICT ... WHERE created_at <`, nothing is ever deleted). Only mints that at least one relay answered for are written and stamped (`reviews_checked_at`), so `lastReviewsSyncAt` advances hourly; if no relay answers, nothing is stamped.
- **Log:** one line per run with counts only: `[reviews-sync] done: mints=… relays_used=… relays_failed_or_skipped=… reqs=… events=… reviews_stored=… mints_updated=… full_sweep_relays=… duration=…s`. No keys, no event content.

**Relays added 2026-10-06: `nostr-01.yakihonne.com`, `relay.nostr.wirednet.jp`** (`REVIEW_SYNC_RELAYS` is now 18). Server-side only; the browser lists (`REVIEW_READ_RELAYS`, `PROFILE_RELAYS`, `DISCOVERY_RELAYS`) did not change, so the About page, `privacy-and-about.md` and `third-party-requests.md` (all about what the visitor's browser contacts; the sync list is not mentioned there) stay as they are.
- **Why these two:** a read-only measurement of 58 relays (2026-10-06) found 68 kind:38000 events on no sync relay. yakihonne held 55 unique ones, wirednet.jp 12; every other candidate at most 1. Compared with the database only 2 real reviews were missing (Minibits `/Bitcoin` 2024 "[5/5] nice", on yakihonne + data.haus; a 21mint.me operator review on wirednet.jp, which is not counted anyway). So the gain is small and the main value is a safety net for relays that may disappear.
- **Why not `nostr.data.haus`:** it is a near copy of yakihonne (same corpus, 57 vs 55 unique); adding both doubles the requests for no unique gain.
- **New relay = full sweep:** neither relay has a row in `reviews_sync_relay_state`, so `planRelayQuery` returns a full sweep (no `since`) on its first run, then the usual incremental runs and one daily sweep. Cost is the same as any other relay: ⌈76/20⌉ = 4 REQs per run.
- **Re-measure before removing anything:** `nostr.oxtr.dev` (handshake timeout) and `relay.nostr.net` (answers, but capped at 100 events) looked weak in that one test, which ran from a sandbox, not from the server. Do not drop either on that evidence: re-measure them from the server logs (the per-relay failed/skipped lines of `[reviews-sync]`) after a week first.

**REQ load per relay** (76 mints served by `/api/mints/known`, 18 relays in `REVIEW_SYNC_RELAYS`; `getKnownMints()` reads every `mints` row, so the real count can be slightly higher):

| | before (6 h, per mint) | after (hourly, batched) |
|---|---|---|
| REQs per relay per run | 76 (1 216 across 16 relays; 18 since 2026-10-06), 3 at a time, in a burst | ⌈76/20⌉ = **4**, one at a time, 1–2 s apart |
| Runs per day | 4 | 24 |
| REQs per relay per day | 304 | **96** (+ one full sweep per day, still 4, + halving when a batch hits `limit`) |
| Connections per relay per day | 4 | 24 (one per run, closed at the end) |
| Freshness of a new review | up to 6 h | up to ~1 h (+ jitter) |

Tests: `reviewsRelayFetch.test.ts` (since plan: first run / after a failure / after a full sweep; batching; pacing; back-off and failure counter; real `ws` stub relay for CLOSED/NOTICE/close-after-REQ), `reviewsSchedule.test.ts` (fake timers: offset and jitter bounds, tick skipped while running), `reviewsSyncRun.test.ts` (run with stub relays: state, grouping, validation, log line).

**Reviewer profiles on the server (2026-10-06, `backend/src/profilesSync.ts`).** A fallback so the review list can show a name for reviewers the visitor's browser found no profile for. Table **`nostr_profiles`** (`pubkey` PK, `name`, `display_name`, `nip05`, `event_created_at`, `fetched_at`, `found`; unix seconds; additive, `IF NOT EXISTS`). Nothing like it existed before (the backend never stored kind 0 of reviewers; `nip05Verify.ts` only has an in-process cache).
- **Where it runs:** at the end of each hourly reviews run, inside `refreshAllMintReviews()` (same single-flight `reviewSyncRunning`, deadline = run start + `REVIEW_MAX_RUN_MS`). It reuses `connectRelayWs` / `RelayConnection.query` from `reviewsRelayFetch.ts` (one connection per relay, one REQ in flight, 1–2 s between batches, the same back-off: pushback skips the relay, 3 failed batches in a row stop it). The relays are two constants, `wss://profiles.nostr1.com` (primary) and `wss://relay.nos.social` (fallback); **no relay is ever taken from event data**, so no DNS pinning is needed (same rule as the reviews sync).
- **Selection:** up to 200 pubkeys that are review authors (`mint_reviews`) or the announcement (`mints.nostr_announce_pubkey`) / contact (`contact_nostr`, at most 3 entries, same parsing limits as `operatorPubkeys`) keys of tracked mints and have no row, a found row older than 7 days, or a not-found row older than 24 hours (no row first, then the oldest). One REQ `{kinds:[0], authors:[≤50]}` per batch, at most 8 REQs per run over both relays; the fallback is asked only for authors the primary did not have.
- **What is stored:** per author the kind 0 event with the highest `created_at` after `verifyEvent` (an event for an author that was not asked for, another kind or a bad signature is dropped). Content is read only if shorter than 8 KB, and only `name`, `display_name`, `nip05` as strings, each cleaned (NFC; control, zero-width and bidi characters removed; whitespace collapsed; trimmed) and capped (names 48 grapheme clusters; NIP-05 100 characters, **dropped, not cut**, when longer, and dropped when it is not `name@domain` or `domain`). `picture`, `about`, banner, website and every other field are never stored. An author nobody had gets `found=false` (asked again after 24 h); an author no relay answered for gets no row (retried next run). A found profile is kept (only `fetched_at` moves) when the indexers do not have it on a later run, and an older event never replaces a newer stored one.
- **Cleanup:** rows of pubkeys that are no longer a review author or a mint contact/announcement key are deleted when `fetched_at` is older than 30 days.
- **Log:** one line per run with counts only: `[profiles-sync] done: selected=… found=… not_found=… reqs=… relays_failed=… duration=…s`. No names, no keys.
- **API:** `GET /api/mints/nostr-reviews` LEFT JOINs `nostr_profiles` and adds `authorName` (`display_name`, else `name`) and `authorNip05`, only for `found` rows (documented in `docs/API.md`). They never influence the rating, the operator rule or any score.
- **Frontend:** `withServerProfileFallback` (`reviewUtils.ts`) applied in `MintDetail.tsx` after the stored/live merge: the browser's own profile wins whenever it has a name; otherwise `authorName` fills in (and `authorNip05`, unless the browser had one), marked `fromServer`. Text only; the NIP-05 shows as "claimed NIP-05: …" unless `useVerifiedNip05` verifies it (then the existing verified style); initials tile only; the short npub stays next to the name. Server names count as named for "Hide anon". **The browser relay lists and the browser's lookups are unchanged.**
- **Texts:** the About page is NOT updated (owner decision); the gap is recorded in `privacy-and-about.md` ("Known gaps").
- Tests: `profilesSync.test.ts` (selection, cleaning/parsing, newest-wins, batching and the 8-REQ cap, back-off, cleanup), `integration/nostr-reviews.test.ts`, `reviewUtils.test.ts`, `e2e/mint-detail-server-profiles.spec.ts`.

**Two independent review-fetch mechanisms, by design (documented 2026-08-29; reworked 2026-08-30 for load perf):**
- **Primary — `useMintReviews.ts`**: live, client-side, no cache, fetched fresh on every Mint Detail visit via REVIEW_READ_RELAYS + maxWait 2000ms. Still what lets a user see their own review immediately after posting one (`useSubmitReview.ts`). It's now the *background refresh*, not the gate for first paint.
- **Secondary — `GET /api/mints/nostr-reviews`**: as of 2026-08-30 this is a **DB read from `mint_reviews`** (was a live per-request relay query, ~3s — the single biggest Mint Detail load cost). The rows come from the hourly `refreshAllMintReviews()` sync. `MintDetail.tsx`'s `mergedReviews` still only adds reviews the primary fetch didn't find — never shown twice.
- **Community-rating stat tile** reads `knownMint.reviewCount` / `reviewAvgRating` (the `mints` rollup, in `/api/mints/known`) while the live fetch is still running — `tileReviewCount` / `tileAvgRating` in `MintDetail.tsx`. This replaced a ~4s window where the empty live array made the tile flash a wrong "No reviews yet". `null` on both the rollup and the live side renders a "…" skeleton (same idea as the existing "Loading live mint data" placeholder).
- Do not remove either mechanism without re-confirming with the maintainer — see the review-fetch investigation report for the full reasoning.

**Operator reviews are labelled and not counted (2026-10-05; rule tightened the same day).** A review
written by the mint's own operator key is shown with a text badge "Operator" but is NOT in the Community
Rating or the review count. **A key is the operator ONLY when BOTH sources agree:** it is (a) listed in the
mint's NUT-06 `contact` entries with method `nostr` as an npub, nprofile or 64-char hex (optional `nostr:`
prefix; at most 3 entries, 300 chars each) AND (b) the author of the NIP-87 announcement (kind:38172) for the
mint's URL (`mints.nostr_announce_pubkey`). `operatorPubkeys(source)` (`backend/src/shared/operatorPubkeys.ts`,
identical frontend copy `src/utils/operatorPubkeys.ts`, pinned by `sharedModules.test.ts`) returns that
intersection (lowercase hex); empty when either source is missing or they disagree — then no review is
labelled or excluded. **Threat it prevents:** the `contact` list is written by the mint and the
announcement can be published by any Nostr user, so either source alone could be abused — a hostile mint
listing a critic's key as its contact would get that review badged "Operator" and left out of the rating.
Now a forger would also need an announcement for that mint signed by the critic's key.
**Only the NEWEST announcement's author is stored** (`discovery.ts` keeps the newest kind:38172 per URL;
`nostr_announce_pubkey` is a single column), so a key that signed an OLDER announcement does not count. This
fails safe: if someone publishes a newer announcement for the URL, the real operator stops matching and
their review counts again (nothing is hidden by mistake). Keeping the set of all authors would need a new
column/array, a discovery change and an additive `/api/mints/known` field — not done. A mint whose
announcement is not known to the backend (`nostrAnnouncePubkey` null) has no operator under this rule.
**NIP-05 contacts (`name@domain`) are NOT resolved**: the backend's `verifyNip05` cache is in-process, keyed
by an already-known pubkey and never persisted, so there is no stored resolution to use, and resolving one
would be a new outbound request. Mitigations still in place: at most 3 contact keys are read, nothing is
deleted, the tile and the badge say why a review is excluded.
- **Backend:** the probe stores the raw `nostr` contact strings in `mints.contact_nostr` (JSONB, rewritten on
  every successful probe, never returned by an endpoint). `reviewsSync.ts` `aggregateReviews()` is the single
  counting rule (empty events and operator reviews excluded) used by `persistMintReviews` and
  `recomputeReviewCountRollups` (now computed in JS from the stored rows; the operator set is taken from
  the mints rows at aggregation time). It writes `review_count`, `review_avg_rating` and the new
  `review_operator_count`; stored `mint_reviews` rows are never changed or deleted. Everything derived
  (`reviewWeightedRating`, `reviewSurge` baseline) follows automatically. `/api/mints/known` returns the
  additive `operatorReviewCount`. A contact/announcement change shows in the rollups at the next review
  sync (hourly) or the boot-time recompute.
- **Mint Detail:** every review by an operator key carries `.review-operator-badge` ("Operator", tooltip
  "Published by a key that is listed as this mint's contact and announced this mint on Nostr."). The Community rating tile
  (`tileReviewCount` / `tileAvgRating`) is computed from the merged list minus operator keys, using the LIVE
  probe's contact list + `knownMint.nostrAnnouncePubkey`; while the live contact list or the known-mints
  row is unavailable (loading or offline mint) the tile keeps the backend rollup, which applies the same rule. When
  at least one operator review is excluded, an ⓘ (`.operator-excluded-info`) says "Excludes N review(s)
  written by the mint's operator." The list and its filter chips still count/show ALL reviews (the chip
  group's tooltip says so when it differs from the tile). Cards, Compare and the Rating sort read the
  backend rollup and are therefore operator-free.
- About page sentence and `privacy-and-about.md` updated accordingly.

**Rating sort uses a weighted/Bayesian rating, not the raw average (2026-09-03).**
`/api/mints/known` also returns `reviewWeightedRating` per mint — the IMDB formula
`WR = (v/(v+m))·R + (m/(v+m))·C` (`backend/src/weightedRating.ts`): `R` = `reviewAvgRating`,
`v` = `reviewCount`, `m = 8` (≈ p75 / mean of review counts among the 51 rated mints — median 3,
mean 8.73, max 102; a mint must reach the top quartile of review volume before its own average
outweighs the crowd), `C` = mean `reviewAvgRating` over all mints with ≥1 review and a non-null
average. `C` is computed in the `/api/mints/known` handler (which already loads every mint in one
query) — NOT in `reviewsSync`'s per-mint rollup, which would need a full-table scan per mint to
get `C`. **Display is unchanged** — the Community Rating badge still shows `reviewAvgRating` /
`reviewCount`. Tests: `backend/src/__tests__/weightedRating.test.ts`
+ a case in `integration/mints-known.test.ts` (1×5.0 review ranks below 99×4.7).

**Rating sort changed to a confidence-adjusted average (2026-10-09, owner decision).** The IMDB value
above is still computed and returned, but the frontend no longer sorts by it: with `C` ≈ 4.58 (reviews are
overwhelmingly positive) and `m = 8`, a mint with 83 reviews at 4.8 sat on rank 8 behind mints with 3–6
five-star reviews. The Rating sort now orders by `bayesianRating(avg, n, { prior = 3.5, weight = 5 }) =
(n·avg + weight·prior) / (n + weight)` (`src/utils/bayesianRating.ts`, pure, runs on the already loaded
list): 1×5.0 → 3.75, 83×4.8 → 4.73, 30×4.0 → 3.93. Inputs are exactly what the card shows: `reviewAvgRating`
(average over RATED reviews, operator reviews excluded) and `reviewRatedCount` — a new additive field of
`/api/mints/known` (`mints.review_rated_count`, written by the same `aggregateReviews()` rule in
`persistMintReviews` and `recomputeReviewCountRollups`; the startup recount (~12 s after boot) backfills it,
so it is filled right after a deploy; until then the sort falls back to `reviewCount`, which also counts
comment-only reviews). Mints without a rated review sort after every rated mint (key −1); ties keep the list
order (stable sort — the rating branch never had a tie-breaker). Used by: Dashboard card sort and list sort
(`Dashboard.tsx` ×2) and the rating tie-break of the Reliability Score sort (`listRating` in
`reliabilitySort.ts`). The Watchlist has no rating sort (alphabetical); Compare, Stats and the Best Mint
wizard do not rank by rating. Display is unchanged (stars, average, the count in brackets, chips, Community
rating tile). The sort buttons have no tooltip, so "Mints with few reviews rank lower (confidence-adjusted
average)." lives here and in docs/API.md only. Tests: `src/__tests__/bayesianRating.test.ts`, the "Rating"
case in `e2e/dashboard.spec.ts`, `reviewsSync.test.ts` / `mints-known.test.ts` for the new field.

Key implementation details:
- Rating parsed from `content` via regex `/\[(\d)\/5\]/` — the `rating` tag does not exist in practice
- **REQ `limit` is 500** (`useMintReviews.ts` + backend `/api/mints/nostr-reviews`), raised from 50 on 2026-08-30 — with limit 50 the dominant relays all returned the same newest 50 events, so the pool union barely exceeded 50 and undercounted mints like `mint.minibits.cash/Bitcoin` (~85 real reviews, cashumints.space shows 82) by ~40%.
- Rating-less / comment-less kind:38000 events are **kept and counted** as reviews (a bare event pointing at a mint is still an endorsement — matches how cashumints.space counts). `sortReviewsByNewest()` in `reviewUtils.ts` no longer filters them (was `filterAndSortReviews`). The **average-★ calculation excludes them** (`MintDetail.tsx` `ratedReviews = mergedReviews.filter(r => r.rating !== null)`) so they never dilute the score; the UI list renders them with no stars.
- The header count ("X reviews · via NIP-87") reflects `mergedReviews.length` — the exact array rendered in the list — not the primary browser fetch alone.
- Author Nostr profiles (name + avatar) are fetched inline inside `useMintReviews.ts` via **PROFILE_RELAYS** — a separate `useNostrProfiles` hook was removed due to a React state sync bug
- Author Nostr profiles (name + avatar) are fetched inline inside `useMintReviews.ts` via **PROFILE_RELAYS** — a separate `useNostrProfiles` hook was removed due to a React state sync bug
- Security: `profile.picture` is rendered only if it starts with `https://`

**Hide anon chip alignment (2026-09-30):** at ≤430px `.reviews-filter-row` is `flex-start` so a wrapped "Hide anon" lines up with All; desktop still `space-between`. Behaviour and counts unchanged.

**Reviews tab filter chips + Hide anon (2026-09-04, `MintDetail.tsx`):** the Reviews tab has
an All/5★/Critical filter chip group (`reviews-filter-chip`, one active at a time,
`reviewFilterState` keyed by mint `url`) plus an independent "Hide anon" toggle chip
(`reviewHideAnonState`) applied on top. Critical = `rating !== null && rating <= 2`
(explicitly excludes rating-less endorsement events, not just "≤2 or null"). **Chip counts
follow the Hide anon toggle, not the full review corpus** — `reviewCountBase` is
`mergedReviews` filtered to named authors when Hide anon is on, else the full list; every
chip count (`All`, `5★`, `Critical`) derives from `reviewCountBase` so the numbers on the
chips always match what's actually visible. The "Hide anon" chip's own count is always the
full anonymous-review count (`reviewFilterAnonCount`), independent of its own on/off state.
**Empty reviews are omitted (2026-09-30 collapsed line → replaced by omission, commits `df06678`/`c99cc56`; `isEmptyReview`/`visibleReviews` in `reviewUtils.ts`):** a kind:38000 event with `rating === null` AND an empty/whitespace-only comment is not a review. `processReviewEvents` and the Mint Detail list (`visibleReviews(mergeStoredAndLiveReviews(...))` in `MintDetail.tsx`) drop it, so it is in no card, no chip count (`All · N` etc.) and no pagination, and there is no "N reviews without a rating or comment · Show|Hide" line any more (the `.reviews-empty-line` button and its CSS are gone; `splitEmptyReviews` is still exported and unit-tested but unused by the UI). The backend does the same: `review_count` excludes empty events and the average is over rated reviews only (`reviewsSync.ts`). Rated-only and text-only reviews stay visible. Tests: `e2e/mint-detail-empty-reviews.spec.ts` (asserts no `.reviews-empty-line`, 3 cards + `All · 3` for a mixed set), `reviewUtils.test.ts`.
A `.reviews-disclaimer` line sits above the chip row, unconditionally. As of 2026-09-08
(sybil Community Rating mitigation, step 1) it reads: "Reviews are self-published Nostr
events (NIP-87). Anyone can create a new key, so a rating can be artificially inflated —
treat it as a directional signal, not proof. Counts may also differ from other sites."
(The `InfoTooltip` (i) that briefly also carried this caveat on the Community Rating tile
`.community-rating-info` and the mint card ★ badge `.card-rating-info` was **removed
2026-09-08** — the Reviews-tab disclaimer is now the only place it lives; the `.review-surge-flag`
⚠ on those two surfaces is unchanged.) Separately, a Community Rating average
backed by fewer than `MIN_MEANINGFUL_REVIEWS` (3, in `mintFormatting.ts`) is de-emphasised
(`opacity: 0.6` on the badge/value, "· too few to be reliable" on the tile sub-line) — this
is display-only; the Rating *sort* handles thin samples via `bayesianRating` (`src/utils/bayesianRating.ts`, see above). e2e: `e2e/community-rating-caveat.spec.ts`.

**Recent review surge flag (2026-09-08, sybil Community Rating mitigation step 2 — "option D"):**
`/api/mints/known` carries a `reviewSurge: boolean` per mint. It is **forgery-resistant** — it
is NOT derived from the Nostr events (an attacker controls `created_at`, author keys, etc.),
only from what MintRadar's own backend observed: the stored `review_count` now vs. a rolling
~1-week-ago snapshot (`review_count_7d_ago` / `_at`, advanced daily — see Cron jobs). Logic in
`backend/src/reviewSurge.ts` (`hasRecentReviewSurge`, unit-tested): flag when the count gained
≥ `SURGE_ABSOLUTE_GAIN` (10) OR at least doubled from a base of ≥ `SURGE_RATIO_MIN_BASELINE`
(5); false-safe on null / >14-day-stale snapshot. Tuned so ordinary organic growth (a few
reviews a week) never trips it, only a sharp jump (e.g. 3→28 between sync cycles). Approach
(b) from the analysis — one sliding snapshot column, not a history table — mirroring the
`reliability_score_7d_ago` rollup; rationale in `reviewSurgeRollup.ts`. **Informational only —
never feeds Reliability Score or `reviewWeightedRating`.** Frontend: `InfoTooltip` gained a
`tone="warn"` variant (quiet amber ⚠ instead of ⓘ); rendered next to the Community Rating on
the Mint Detail tile (`.review-surge-flag`) and mint card ★ badge (`.card-review-surge-flag`)
with the text "This mint's review count grew unusually fast recently — worth a closer look
before trusting the rating." 7-day warm-up after deploy (baselines seed to current count on
the first rollup, can't flag until they've aged). e2e in the same spec above.


## Stale nsec session after reload (2026-10-01)
The Zustand-persisted auth state (`profile`, `method`, `nip65Relays` in sessionStorage) survives a page reload, but the nsec key (module-scoped `activeNsecPrivkey`) never does. `clearStaleNsecSession()` (`auth.store.ts`, called once from `main.tsx` right after `restoreBunkerSession()` and **before the first render** — sessionStorage hydration is synchronous, so it cannot race a fresh login, which installs the key before setting the state) resets a persisted `method === 'nsec'` session with no key held via the normal `logout()` (no server/relay call; Dexie watchlist untouched, `resetInMemory()` NOT called) and sets the in-memory-only `sessionNotice` ("Your key was cleared when the page reloaded. Log in again to sign."). `AppShell` renders it above `<main>` reusing the Dashboard `.queued-banner queued-banner-info` styles (+ `.session-notice` top margin), `role="status"`, dismissible; it is not in `partialize`, so it is shown once and never after the next reload.
- **nip07 is deliberately not checked** (`window.nostr` can be injected after load). **remote-signer is left alone**: `restoreBunkerSession()` reinstalls the shim from the persisted `bunkerURI`/`bunkerClientSecretKey`/`bunkerPubkey` on load and calls `logout()` itself if `connect()` fails.
- **E2E:** a session seeded via `loginAs(page, name, 'nsec')` is now (correctly) cleared at startup. Specs needing a logged-in nsec user call `page.goto()` first and then `loginAsNsecLive(page, name)` (`e2e/fixtures/mocks.ts`, installs a real throwaway key through the app's own client module). Tests: `e2e/stale-nsec-session.spec.ts`, `src/__tests__/clearStaleNsecSession.test.ts`.
