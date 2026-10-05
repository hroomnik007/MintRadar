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

Backend `REVIEW_SYNC_RELAYS` (`backend/src/reviewsSync.ts`, re-exported from `index.ts` as `NOSTR_REVIEWS_RELAYS`) is the broad list used by the 6h background sync — it has a generous time budget so it favours coverage over latency (opposite trade-off from REVIEW_READ_RELAYS). **As of the 2026-09-19 audit it is no longer a straight mirror of the old REVIEW_RELAYS** — see "Discovery relays" above for its current composition (`DISCOVERY_RELAYS` + minibits.cash + mom + eden.nostr.land + nostr21.com). `backend/src/__tests__/nostrReviewsRelays.test.ts` pins the exact array as a drift tripwire, and now also cross-checks `DISCOVERY_RELAYS` directly against the frontend's own array. The frontend fast-path list is deliberately NOT mirrored.

**Two independent review-fetch mechanisms, by design (documented 2026-08-29; reworked 2026-08-30 for load perf):**
- **Primary — `useMintReviews.ts`**: live, client-side, no cache, fetched fresh on every Mint Detail visit via REVIEW_READ_RELAYS + maxWait 2000ms. Still what lets a user see their own review immediately after posting one (`useSubmitReview.ts`). It's now the *background refresh*, not the gate for first paint.
- **Secondary — `GET /api/mints/nostr-reviews`**: as of 2026-08-30 this is a **DB read from `mint_reviews`** (was a live per-request relay query, ~3s — the single biggest Mint Detail load cost). The rows come from the 6h `refreshAllMintReviews()` sync. `MintDetail.tsx`'s `mergedReviews` still only adds reviews the primary fetch didn't find — never shown twice.
- **Community-rating stat tile** reads `knownMint.reviewCount` / `reviewAvgRating` (the `mints` rollup, in `/api/mints/known`) while the live fetch is still running — `tileReviewCount` / `tileAvgRating` in `MintDetail.tsx`. This replaced a ~4s window where the empty live array made the tile flash a wrong "No reviews yet". `null` on both the rollup and the live side renders a "…" skeleton (same idea as the existing "Loading live mint data" placeholder).
- Do not remove either mechanism without re-confirming with the maintainer — see the review-fetch investigation report for the full reasoning.

**Operator reviews are labelled and not counted (2026-10-05).** A review written by the mint's own
operator key is shown with a text badge "Operator" but is NOT in the Community Rating or the review
count. `operatorPubkeys(source)` (`backend/src/shared/operatorPubkeys.ts`, identical frontend copy
`src/utils/operatorPubkeys.ts`, pinned by `sharedModules.test.ts`) returns the lowercase hex keys from
(a) the mint's NUT-06 `contact` entries with method `nostr` that are an npub, nprofile or 64-char hex
(optional `nostr:` prefix; at most 3 entries, 300 chars each) and (b) the NIP-87 announcement author
(`mints.nostr_announce_pubkey`). **NIP-05 contacts (`name@domain`) are NOT resolved**: the backend's
`verifyNip05` cache is in-process, keyed by an already-known pubkey and never persisted, so there is no
stored resolution to use, and resolving one would be a new outbound request.
**Known trust limits (security review 2026-10-05, accepted as specified):** both sources are claims by
parties who are not the key holder. The `contact` list is written by the mint, so a hostile mint can name
a critic's key and get that review left out of the count (it stays listed, but wrongly badged "Operator");
the announcement author is the author of the NEWEST kind:38172 for the URL (`discovery.ts`), which any
Nostr user can publish. Mitigations in place: at most 3 contact keys are read, nothing is deleted, the tile
and the badge say why a review is excluded. Recommended hardening if abuse appears: count a key as operator
only when BOTH sources agree (key listed in `contact` AND equal to the announcement author).
- **Backend:** the probe stores the raw `nostr` contact strings in `mints.contact_nostr` (JSONB, rewritten on
  every successful probe, never returned by an endpoint). `reviewsSync.ts` `aggregateReviews()` is the single
  counting rule (empty events and operator reviews excluded) used by `persistMintReviews` and
  `recomputeReviewCountRollups` (now computed in JS from the stored rows; the operator set is taken from
  the mints rows at aggregation time). It writes `review_count`, `review_avg_rating` and the new
  `review_operator_count`; stored `mint_reviews` rows are never changed or deleted. Everything derived
  (`reviewWeightedRating`, `reviewSurge` baseline) follows automatically. `/api/mints/known` returns the
  additive `operatorReviewCount`. A contact/announcement change shows in the rollups at the next review
  sync (6h) or the boot-time recompute.
- **Mint Detail:** every review by an operator key carries `.review-operator-badge` ("Operator", tooltip
  "Published by a key listed as this mint's contact or announcement author."). The Community rating tile
  (`tileReviewCount` / `tileAvgRating`) is computed from the merged list minus operator keys, using the LIVE
  probe's contact list + `knownMint.nostrAnnouncePubkey`; while the live contact list is unavailable
  (loading or offline mint) the tile keeps the backend rollup, which already excludes the operator. When
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
`reviewCount`. Frontend Rating sort (`Dashboard.tsx` ×2, `Watchlist.tsx`) orders by
`reviewWeightedRating ?? reviewAvgRating ?? -1`. Tests: `backend/src/__tests__/weightedRating.test.ts`
+ a case in `integration/mints-known.test.ts` (1×5.0 review ranks below 99×4.7).

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
is display-only; the Rating *sort* handles thin samples via the m=8 Bayesian weighting in
`backend/src/weightedRating.ts`. e2e: `e2e/community-rating-caveat.spec.ts`.

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
