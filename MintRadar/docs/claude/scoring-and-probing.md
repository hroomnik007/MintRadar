# MintRadar — Reliability Score, NUT list, probing, NUT tracking scope (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Reliability Score calculation (server-side, in prober.ts)

**Current weights (verified against `backend/src/shared/reliabilityScore.ts`/`auditScore.ts`,
2026-09-19): Uptime 40% · Audit reliability 25% · NUT Support 15% · Version freshness 15% ·
Contact info 5%.** These were reweighted 2026-09-12 (commit `6ae582b`, "reweight toward
audit") from an earlier 45/5/30/15/5 split — **Uptime 45%→40%, Audit reliability 5%→25% (its
own internal scale also moved from 1–5 points to 5–25 points, see below), NUT Support
30%→15%**; Version freshness (15%) and Contact (5%) were unchanged. That commit updated the
code but left this section's prose at the old 45/30/5 numbers for a week — if a percentage
anywhere in this file ever disagrees with the two files above, **the code is authoritative,
not this document**. Same source list used by Learn Module 3's breakdown
(`src/pages/learn/Module3.tsx`).

- Uptime 40%: uptimePct * 0.40 (from 24h mint_history)
- Audit data age (display only for the Audit tab, since the 2026-10-08 source switch): `src/utils/auditFreshness.ts` holds `AUDIT_DATA_OLD_DAYS = 7` / `AUDIT_SYNC_STALE_HOURS = 24` and still decides when the Audit tab defaults to cashu.info instead of the stale audit.8333.space data (`auditNeedsFallback` in `MintDetail.tsx`) and the Stats-page note about a stale 8333 feed. **It no longer touches the Reliability Score row**: that row has its own freshness rule (168 h, below). The old breakdown-row notes (`data N days old` from `auditCheckedAt`, `sync Nh old`) are gone with the 8333 input.
- Audit reliability 25% — **source switched 2026-10-08 from audit.8333.space to the stored cashu.info detail.** Input = `errorsBlamed / swaps7d.all.total` of the 7-day window of the stored detail (`audit_cz_detail`), i.e. the share of swaps whose failure cashu.info attributes to the mint itself (not amounts below its minimum, the auditor's balance or Lightning routing; cashu.info's own score/scoreParts are never read or stored). `auditComponent(blamed, total, fetchedAt, now)` in `backend/src/shared/auditScore.ts` (frontend copy `src/utils/auditScore.ts`, compared by `src/__tests__/sharedModules.test.ts`): bands unchanged (0 → 25, <1 % → 20, <5 % → 15, <15 % → 10, else 5; `blamed` above `total` is clamped to `total`); **neutral 12.5** when an input is null/non-finite/negative, when `total < AUDIT_MIN_SAMPLES` (**10**, was 3), or when the stored detail is older than `AUDIT_MAX_AGE_HOURS` (**168 h**, measured from `audit_cz_fetched_at` at probe time; a future timestamp counts as fresh). `auditDataState()` names the reason (`scored | no-data | too-few | too-old`) for the breakdown row. **Storage (option A):** `mints.audit_cz_total`, `audit_cz_blamed`, `audit_cz_fetched_at`, written by the 30-minute detail cron (`auditCzDetail.ts`) in ONE statement with the `audit_cz_detail` upsert (CTE) for every tracked mint the mapping resolves — exact normalised URL (`rtrim(url,'/')`) or an alias listed in `audit_cz_aliases`; unusable numbers → NULLs (neutral), a failed fetch writes nothing. `initDb()` adds the columns and runs an idempotent backfill from `audit_cz_detail` (`AUDIT_CZ_BACKFILL_SQL` in `db.ts`) so a deploy never dips scores to neutral. The prober reads the three columns in the same single SELECT as before (`prober.ts`); no JSON parsing at probe time. **A mint with no cashu.info detail scores neutral; the old audit.8333.space data (`audit_recent_total`/`audit_recent_errors`, `audit_n_*`, `mint_audit_swaps`) is NOT a fallback anywhere in scoring** — it stays stored, in `/api/mints/known` and on the Audit tab (source switcher). The 8333 tab keeps its own 3-sample label floor (`AUDIT_TAB_MIN_SAMPLES`, `isAuditUnknown()`). Expected effect (read-only simulation 2026-10-08 on 67 scored mints): about 21 mints at 25, 8 at 15, 4 at 10, 8 at 5, 26 neutral; mean 66.0 → 72.6, median 75 → 81, 17 mints cross 90; `mint.instant.gr` −12, `cashu.centurymetadata.org` and `mint.ucash.space` −8 (the 8333 sync had been stale for 11 days). Two tracked pairs share one cashu.info mint through aliases (`mint.sharegap.net` = `mint.nostrodomo.net`, `satscribe.me/cashu` = `mint.satscribe.me`: same name, version, NUT count, ASN) and so get the same inputs. **Breakdown row (Mint Detail)** — short value (`blamed / total` or `neutral`) and the points, no sentence under a scored row; only the neutral states add a full-width line `.rb-row-detail`: `Not enough audit data yet (fewer than 10 swaps in the last 7 days): neutral` / `No cashu.info audit data: neutral` / `Audit data older than 7 days: neutral`; a quiet `data N days old` note (from `auditCzFetchedAt`) only above 24 h and below 168 h. The row and its ⓘ ("Failures that cashu.info attributes to this mint, out of its swaps in the last 7 days (not the overall success rate). Under 10 swaps or no recent data: neutral 12.5 of 25.") use only `auditCzTotal/Blamed/FetchedAt`; the audit detail request loads only with the Audit tab. Compare's "Audit success" row reads the same fields (`n/a` unless the row is scored). API: `/api/mints/known` adds `auditCzTotal`, `auditCzBlamed`, `auditCzFetchedAt`. Stats shows a one-time note under Reliability movers for 30 days (see `stats-dashboard-watchlist-ui.md`). Tests: `auditScore.test.ts`, `reliabilityScore.test.ts` (both packages), `prober-audit-inputs.test.ts`, `dbAuditCzMigration.test.ts`, `auditCzDetail.test.ts`, `mints-known.test.ts`. **Wording (2026-10-09):** the Audit tab's attributed tile is "Caused by this mint" (big number = `errorsBlamed`, caption "of N failed swaps"); the breakdown row shows only `blamed / total` and the points (no sentence under a scored row, 2026-10-09); the overall success rate never enters the score. Details in docs/claude/card-and-mint-detail-ui.md.
  - **Audit tab layout (2026-09-03):** the tab leads with a compact **`.audit-summary-strip`** — a 4-cell 5-second overview: **Mints** (`auditNMints`) · **Melts** (`auditNMelts`) · **Recent success rate** (`formatAuditSuccessRatio(auditRecentTotal, auditRecentErrors)` → `"<successes> / <total>"` — **fixed 2026-09-11/12: renamed from "Recent errors"/`formatAuditErrorRatio`, which showed the error count as the headline number; the cell now leads with successes**, coloured by `auditReliabilityColor()` so it can't disagree at a glance with the sidebar Reliability Score Breakdown; sub-line is `"<n>% ok"` / `"too few to score"` (via `isAuditUnknown()`) / `"no recent swaps"`) · **Last checked** (`formatTimeAgo(auditSyncedAt)` — **our** cron's write time, NOT `auditCheckedAt`). The strip sits *outside* the mobile collapse (always visible). Below it, inside the collapse, a single **`.audit-alltime-line`** carries the lifetime totals + `%` and the "Recent errors feeds Reliability Score" note, plus a short explainer sentence (added 2026-09-04) clarifying that the recent-errors figure — not the all-time one — drives the Reliability Score. This **replaced** the old 3-card all-time `.audit-stats-grid` + separate green "Recent reliability" `.audit-recent-card` band (both duplicated the same numbers). `formatTimeAgo`/`formatAuditErrorRatio` live in `src/utils/mintFormatting.ts` (unit-tested); e2e in `e2e/mint-detail-audit-summary-strip.spec.ts`. Window size = `AUDIT_SWAPS_WINDOW` (100) in `backend/src/discovery.ts`.  - **2026-09-12 additions (frontend, consuming the `mint_audit_swaps`/`audit_avg_time_ms` backend work above):** the strip's "Recent success rate" sub-line now shows the actual percentage (`"<n>% ok"`, computed client-side from `auditRecentTotal`/`auditRecentErrors`) instead of the bare word "ok". A 5th strip cell, **Avg swap time**, renders `knownMint.auditAvgTimeMs` as `"<n> ms"` or `"n/a"`. Below the strip: an **outcome bar** (`.audit-swap-bar`, ≤44 marks, newest left — mint-green `.audit-swap-bar-ok` / red `.audit-swap-bar-fail`) and a **Recent swaps table** (`.audit-recent-swaps`, last 8 rows — To host via `mintHostname()`, Amount `sat`, Fee, Duration `ms`, State; failed rows muted red via `.audit-swap-row-fail`), both fed by a new `useQuery(['mint','audit-swaps',url])` against `GET /api/mints/swaps?url=` — lazily fetched only once the Audit tab is opened (`enabled: activeTab === 'audit'`), still never audit.8333.space directly from the browser. Neither the bar nor the table renders anything (no fake/placeholder marks) until that fetch actually resolves with a non-empty `swaps` array. A text link **"Open on audit.8333.space →"** (`.audit-external-link`, new tab, `rel="noopener noreferrer"`) points at the auditor's homepage, not a per-mint deep link — its own SPA bundle was checked and has no `/mint/:id`-style route (only `"/"` and a catch-all), so a guessed deep link would 404; `audit_id` itself is still not exposed by any API and wasn't added for this. Reliability Score math, other tabs, and probes are unchanged.
  - **`auditReliabilityColor()` (`src/utils/mintFormatting.ts`, 2026-09-04) is a separate, UI-only coloring function — deliberately NOT the same thresholds as `auditComponent()`'s 5–25 scoring bands above**, and it does not feed the Reliability Score number. It colors directly off the raw error rate: `var(--fast)` (green) at ≤5% errors, `var(--med)` (amber) at ≤25%, `var(--slow)` (red) above that — `< 3` samples renders muted (`var(--t3)`). The bucket scoring is much stricter (e.g. a 5% error rate already scores 15/25, two tiers down from the max), which read as misleadingly alarming at a glance for what's actually a 95%-success mint; the amber cutoff was widened from an initial 15% to 25% the same day after review. Used by the Audit summary strip's 8333 cell (3-sample floor, default `minSamples = 3`) and, with `minSamples = AUDIT_MIN_SAMPLES` (10) over the cashu.info window, by the Reliability Score Breakdown's "Audit reliability" row.
- NUT Support 15%: min(nutCount/14, 1) * 15 — 14 is the number of mint-side NUTs actually tracked (`TRACKED_NUTS` in `src/constants/nuts.ts`, mirrored as `TRACKED_NUT_COUNT`/`TRACKED_NUT_KEYS` in `backend/src/shared/reliabilityScore.ts`). Shrunk from 25 to 14 on 2026-09-14 — see "NUT tracking scope: mint-side vs. wallet-only" below. `nutCount` itself (the `mints.nut_count` column, written by `prober.ts`) now counts only the intersection of a mint's `/v1/info` `nuts` keys with `TRACKED_NUT_KEYS` — previously it was `Object.keys(nuts).length`, which let auth (21/22) and payment-method (23/25/30) keys inflate this component even though they were never part of the denominator's intent.
- Version freshness 15%: Software versions — ONE rule (owner decision 2026-10-09, `shared/versionRule.ts` + the byte-identical frontend copy `src/utils/versionRule.ts`; `sharedModules.test.ts` fails when they drift): `classifyVersion(software, version, latest)` decides EVERYTHING — Stats cards/modal/summary bar, the Mint Detail badge and breakdown row, Compare and the score. **"outdated" = two or more MINOR versions behind the newest STABLE version of the same software family; "latest" = that version and any higher one; everything else has no label (there is no "old" label).** A pre-release (rc…) counts as its base version for the distance and is never labelled "latest" nor "outdated" against its own minor line; a fourth segment (`0.20.3.1`) is ignored for the distance and used only for ordering (`compareMintVersionNumbers`: `0.20.3.1` > `0.20.3`; stable > its pre-releases; `0.18.1` > `0.18.1-rc.2` > `0.18.1-rc.1`). Points of the 15-point component: **0 or 1 minor behind = 15, 2 = 9, 3 = 6, 4 = 3, 5 or more (or a lower major) = 0**; unknown software (`Nutshell-CF`, `LekMint`, a string without `/`) = 4, a recognised software with an unreadable version = 5, no version = 0, a recognised family with no latest at all = 4 (those three keep what they always got). Families: `nutshell`, `cdk`/`cdk-mintd` (case-insensitive, exact match), leading `v` stripped. **"latest" is ONE value per family**: the `software_versions` cache (GitHub release catalog, no pre-releases/drafts, 14-day grace period, `versionCatalog.ts` `getLatestVersionsMap()`); a family without a usable row falls back to the **highest stable version that at least two DISTINCT tracked mints report exactly** (`newestStableByFamily()`, one entry per mint, `MIN_MINTS_FOR_FALLBACK_LATEST = 2`; the software-name spelling, its case and a leading `v` do not matter, a pre-release never counts; hardening 2026-10-09 so one hostile mint reporting a made-up `0.99.0` cannot move "latest"); if no version qualifies the family has no latest (its mints are not labelled and score the neutral 4). The API sends it with every mint as `softwareLatest` (`{ major, minor }` of that mint's own family, `null` for unknown software) on `/api/mints/known`; the frontend uses only that value (there is no static ladder any more — `NUTSHELL_VERSIONS`/`CDK_VERSIONS`/`STATIC_LATEST_VERSIONS` were removed) so the Mint Detail breakdown row equals the version points inside the stored score. Version strings from mints are untrusted: cut to 100 characters, bounded linear-time patterns, only ever rendered as text. Tests: `versionRule.test.ts` (both packages, one table of cases), `reliabilityScore.test.ts`, `versionCatalog.test.ts`, `mints-known.test.ts`, e2e `mint-detail-score-version-row`, `mint-detail-outdated-badge`, `compare-outdated-badge`, `stats-software-modal`, `stats-widgets`.
- Contact info 5%: `mints.contact_count` stores the last successfully observed count. A probe that can't reach `/v1/info` learns nothing about contacts, so it falls back to the stored value instead of scoring the mint as having none (previously a failed probe silently zeroed this component). `contactComponent()` clamps the count to **3** before scoring (`Math.min(contactCount, 3) / 3 * 5`) — 3+ contacts award the full 5 points and never more. This clamp is an explicit anti-inflation guard: `contact_count` is the raw length of the mint's own `/v1/info` `contact` array (untrusted operator input), and without it a mint advertising e.g. 60 contact entries scored 100 on this component alone, saturating its whole Reliability Score (2026-09-07 security audit, finding H1). The frontend's `contactCountOf()` already passes at most 3 (it only looks at email/twitter/nostr fields); the clamp closes the backend path. Unchanged by the 2026-09-12 reweight.
- **New-mint score cap (added in the same 2026-09-12 `6ae582b` reweight):** `NEW_MINT_RELIABILITY_CAP`
  (75) / `NEW_MINT_MAX_DAYS` (30), `applyNewMintCap()` in `backend/src/shared/reliabilityScore.ts` —
  `computeReliabilityScore()`'s final step caps the summed total at 75 for a mint's first 30 days
  after `discovered_at`, regardless of how high its five components would otherwise sum. This
  discounts a brand-new mint's *score* but does not by itself remove it from a top-5 ranking —
  see "Recommendation-surface minimum age gate" below for the separate, newer (2026-09-19)
  `isEligibleForRecommendation()` gate that additionally excludes anything younger than 14 days
  from recommendation surfaces outright, regardless of its (capped or uncapped) score.
- Stored in mints.last_reliability_score after each probe
- **The whole computation lives in `backend/src/shared/reliabilityScore.ts`** (`computeReliabilityScore()` plus the per-component `uptimeComponent`/`nutComponent`/`versionComponent`/`contactComponent` helpers). `prober.ts` re-exports it as `computeServerReliabilityScore` for its existing call sites and tests. `src/utils/reliabilityScore.ts` is the manually-synced frontend copy (same no-workspace caveat as `auditScore.ts`) — edit both if the logic changes. The frontend used to carry a second, silently divergent implementation in `MintDetail.tsx` (its own `NUTSHELL_VERSIONS` list topped out at 0.21 vs. the backend's 0.16, so the Reliability Score Breakdown's Version row could disagree with the total it was breaking down); that duplicate is gone.
- The stored server-side score is authoritative. `MintDetail.tsx` computes a score itself only as a fallback — when `knownMint.reliabilityScore` is missing, or for a historical chart bucket with no stored `reliability_score`.
- Rounding: each component rounds individually, then the total gets exactly one outer `Math.round` before the cap — `Math.min(100, Math.round(sum))`, followed by `applyNewMintCap()`. Both copies must keep this ordering or a mint's breakdown rows won't add up to its stored total.

## Reliability Score donut arc — shared geometry helper (2026-09-04)

`reliabilityDonutArc(pct)` in `src/utils/mintFormatting.ts` is the single source of truth for the
Reliability Score gauge's SVG stroke-dasharray geometry, used by both the Mint Detail donut
(`MintDetail.tsx`) and the Stats page's Network Health Index gauge (`Stats.tsx`). It clamps
the input to 0-100, computes `filled = (pct/100) * RELIABILITY_DONUT_CIRCUMFERENCE` against the
gauge's `r=27` SVG circle (circumference ≈ 169.646), and returns `{ dashArray: "filled gap",
dashOffset: 0, filled }`. **Fixed bug:** both call sites previously also applied a spurious,
independently-computed `strokeDashoffset` (42.4-ish) on top of the dasharray split — the two
values fought each other and visibly under-filled the arc relative to the percentage shown as
text next to it. `dashOffset` is now hardcoded to `0` inside the shared helper (the SVG's own
`transform="rotate(-90 36 36)"` already handles the 12-o'clock start point), so there is
nothing left for a caller to double-apply. Unit-tested in `src/__tests__/mintFormatting.test.ts`.

## Reliability Score vs Community Rating — visual separation

Reliability Score (server-computed, 0-100) and Community Rating (crowd-sourced NIP-87 average, 1-5★)
are deliberately distinguished by icon, not just by label, everywhere they appear side by side
(`MintCard.tsx`, `ComparisonModal.tsx`, `MintDetail.tsx`): Reliability Score carries a shield icon,
Community Rating a green star. The shield is `IcShield` (`src/components/mint/IcShield.tsx`) —
a small shared SVG component (`size` prop, default 13px, `currentColor` stroke) — also reused
by the Best Mint wizard's result rows (`Tools.tsx`) and
`LearnIcons.tsx`. Do not duplicate this shield inline in a new component; import `IcShield`.

Community Rating excludes the mint's own operator's reviews (labelled "Operator"; operator = contact key that also authored the mint's announcement, see "Operator reviews are
labelled and not counted" in reviews-and-nostr.md); the Reliability Score formula is unaffected.

## NUT list — single source of truth (2026-08-19)

`src/constants/nuts.ts` is the only place the tracked-NUT list and its display metadata
live: `TRACKED_NUTS` (14 entries, ascending), `TRACKED_NUT_KEYS` (the unpadded `'4'`/`'5'`…
form used by `/v1/info`'s `nuts` object and the `nuts_limits` column), `NUT_META`
(short label / description / `specNum`) and `nutSpecUrl()`.

It replaced four drifting copies: `MintDetail.tsx`'s `ALL_NUTS`, `Stats.tsx`'s `NUT_ORDER`
(plus its own near-identical `NUT_META`), `ComparisonModal.tsx`'s `NUT_FILTER_KEYS`, and
`NutExplorer.tsx`'s `NUT_META`. `src/__tests__/nuts.test.ts` pins the invariants, including
`TRACKED_NUTS.length === TRACKED_NUT_COUNT` (the Reliability Score's NUT divisor).

**`Dashboard.tsx`'s `NUT_FILTER_KEYS`** is now just `TRACKED_NUT_KEYS` re-exported under the
old local name (2026-09-14) — it used to be its own hardcoded 25-entry list that deliberately
included `'13'` (which `TRACKED_NUTS` excludes); that divergence was removed as part of the
mint-side-vs-wallet-only scope cut, see "NUT tracking scope: mint-side vs. wallet-only" below.

**Still deliberately NOT folded in** — a different list, not a copy:
- `NUT_DESCRIPTIONS` in `MintDetail.tsx` — a richer structure (`features`, `useCase`) that
  also covers the mandatory NUTs 00-03/06 for the NUT detail modal. **Its `short`/`desc` for the 14 tracked
  NUTs are still a partial copy of `NUT_META` and differ in 4 places (checked 2026-09-30, left as is because it
  is not clear which wording is intended):** NUT-08 desc ("change back" vs "change tokens back"), NUT-10 short
  ("Spending cond." vs "Spending conditions"), NUT-15 and NUT-19 desc (MintDetail's are longer). Pick one
  wording before merging them; the other consumers (`Stats.tsx`, `NutExplorer.tsx`) read only `NUT_META`.

## Mint Probe — Degraded/Offline Detection

**isSafeUrl** returns `'safe' | 'blocked' | 'dns-error'` — DNS failures are now written to `mint_history` as `online: false` instead of being silently skipped.

**Degraded logic** (in `backend/src/index.ts`):
```
degraded = (total24h >= 4 && onlineCount === 0) || isStaleOffline
isStaleOffline = last known state is offline AND older than 24h
```

Frontend hides degraded mints by default (`showDegraded=false`); footer shows "N mints hidden (offline 24h+) — Show" (N = every tracked mint the default view hides, see `src/utils/mintCounts.ts`; the degraded rule itself is unchanged).

**Known edge case:** After the first DNS-failure write, a mint may briefly show `degraded=false` for ~20 min until 4 probe records accumulate. Self-correcting, no intervention needed.

## NUT tracking scope: mint-side vs. wallet-only (2026-09-14)

The 25-NUT list from the 2026-07-02 expansion below was audited against the current
cashubtc/nuts spec (NUT-00 through NUT-30) and cut back to **14** — the NUTs a mint
actually implements and advertises in `/v1/info`, which is the only thing the Reliability
Score's NUT-support component and the Detail/Stats/Compare NUT UI can verify.

- **Reliability denominator now 14:** NUT-04, 05, 07, 08, 09, 10, 11, 12, 14, 15, 17, 19, 20, 29.
  `TRACKED_NUTS`/`TRACKED_NUT_COUNT` in `src/constants/nuts.ts` + `src/utils/reliabilityScore.ts`,
  mirrored by `TRACKED_NUT_KEYS`/`TRACKED_NUT_COUNT` in `backend/src/shared/reliabilityScore.ts`.
- **Removed as wallet-only** (a mint never advertises these — they'd be structurally stuck
  at 0% forever): NUT-13 (already excluded pre-2026-09-14), 16 (animated QR), 18 (payment
  requests), 24 (HTTP 402 — a generic HTTP layer, not a cashu-mint capability), 26 (Bech32m
  payment-request encoding), 27 (Nostr mint backup), 28 (Pay-to-Blinded-Key).
- **Removed from the reliability denominator but still real mint-side features, shown
  elsewhere:** NUT-21/22 (clear/blind auth — an access-control mechanism, would be an auth
  badge if/when built) and NUT-23/25/30 (BOLT11/BOLT12/onchain — these extend NUT-04/05 as
  payment methods and already render in the "Units & Methods" panel, independent of the
  NUT grid/`TRACKED_NUTS`).
- **`prober.ts`'s `nut_count` fixed to match:** it was `Object.keys(nuts).length` (every key
  the mint's `/v1/info` reported), which let the excluded auth/method keys inflate the
  NUT-support score. Now `TRACKED_NUT_KEYS.filter(key => nuts[key] != null).length`.
  `/api/nuts` and `/api/stats`'s `nutAdoption` also switched their own hardcoded 25-key
  arrays to import `TRACKED_NUT_KEYS` instead of duplicating it.
- Detail NUT grid/modal, Stats adoption bars, and Compare's NUT rows all already derived
  their NUT list from `TRACKED_NUTS`/`TRACKED_NUT_KEYS`, so shrinking that one export was
  enough to hide the wallet-only NUTs everywhere at once — no per-page filtering added.

### NUT tracking expansion (2026-07-02) — superseded by the cut above

- Tracking 26 NUTs now (was 14) — added: 13, 16, 18, 21, 22, 23, 24, 25, 26, 27, 28, 30
- Mandatory NUTs (00-03, 06) are deliberately never tracked — implicitly 100% supported, zero information value
- Reliability Score NUT divisor changed from /14 to /26 in `prober.ts` — existing mints get a lower/more accurate score at their next probe cycle
  - **Correction (2026-08-19):** the divisor that actually shipped is **/25**, not /26, and NUT-13 is not tracked — it is a wallet-side spec a mint never advertises, so the list above ("added: 13, 16, …") overcounts by one. The live list is `TRACKED_NUTS` in `src/constants/nuts.ts` (25 entries); the divisor is `TRACKED_NUT_COUNT` in `backend/src/shared/reliabilityScore.ts`.
  - **Superseded 2026-09-14:** the divisor is back down to /14 — see "NUT tracking scope: mint-side vs. wallet-only" above.
- NUT-24 (HTTP 402) has 0% adoption across the ecosystem — expected, no implementation exists yet anywhere, and it's no longer tracked at all as of 2026-09-14 (wallet-only)

## Probe fixes — HTTP status handling

- HTTP 429 → probe cycle is skipped entirely (nothing written to `mint_history`); mint stays at its last known state instead of a false-positive offline
- HTTP 502/503/504 → one retry after 2s before recording offline (handles transient server-side blips like restarts/deploys)
  - The on-demand `/api/mint/probe` does the same since 2026-10-03, inside one shared 12 s deadline (see backend-api-and-data.md, probe bullet); the cron path is unchanged.
- "Show my latency" (client-side test in MintDetail) fixed — previously used `mode: 'no-cors'` which hid the HTTP error status, so `fetch` resolved "successfully" even on a 502 and showed a fake latency. Now uses standard cors mode, reads `res.ok`/`res.status`, and shows `Unreachable (HTTP XXX)` instead of a bogus number
- Tooltip on the HTTP error badge (Mint Detail header) — maps 429/502/503/504 to an explanatory message for less technical users

## Mint Age Badge — known data limitation

- **`mintAgeBadge()` no longer drives the mint card or any Dashboard filter (2026-09-08).** The
  card's age signal is now the binary **"New"** badge (`isNewMint()`, < 30d); Established /
  Veteran / OG were dropped and the "Mint age" filter block was removed (see "Card badges" and
  "Dashboard filter panel — Mint age removed" above). `mintAgeBadge()` (shared helper + local
  copies in `ComparisonModal.tsx` and `Stats.tsx`) is **still used** by the Compare modal, the
  Stats geo/NUT modals + software-freshness count, and the Dashboard **list-view "Age" column**.
- `mintAgeBadge()` thresholds are in **months**: `< 1` Fresh, `< 6` Established, `< 12` Veteran,
  `≥ 12` OG.
- Input is `mints.discovered_at` — when MintRadar discovered/inserted the mint, NOT the mint's
  true birth. Bulk-seeded mints all share a mid-2026 `discovered_at`, so the badge only starts
  differentiating as the data naturally ages — not a bug.


## Probe location label (2026-10-04)

The production server is a Hetzner Cloud vServer in **Nuremberg, Germany** (datacenter `nbg1-dc3`, region `eu-central`);
earlier text said Frankfurt, which was wrong. The label shown wherever latency is attributed to the probe (mint card
`· Nuremberg`, Mint Detail latency tile + tooltip, Stats "from Nuremberg") comes from ONE constant,
`PROBE_LOCATION` in `src/constants/probeLocation.ts`. If the server ever moves, change that value, the README
"Real-Time Monitoring" line and the SECURITY.md "single … IP" limitation, and update the e2e specs that pin the label
(`e2e/mint-card-badges-copy.spec.ts`, `e2e/long-text-overflow.spec.ts`) plus `src/__tests__/mintFormatting.test.ts`.
The backend stores/returns no probe location (`serverLocation` in `/api/mints/known` is the *mint's* location), so there
is no API field, database column or environment variable to change; historical rows are untouched.
