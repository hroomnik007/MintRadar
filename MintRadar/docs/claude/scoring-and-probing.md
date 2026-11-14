# MintRadar — Reliability Score, NUT list, probing, NUT tracking scope (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## A score is points, never a percent (2026-10-20)

The Reliability Score is a number of POINTS from 0 to 100, not a percentage. Rule for every place that shows it:
- **Compact places** (the ring and the gauge on Mint Detail, the breakdown dialog hero, the Dashboard card, the Compare table, the Watchlist recommendation badge, the Token Inspector cell, the NUT / software / location modal rows, the Stats trend summary "Current / 30d High / 30d Low", the chart axis and tooltip of the Reliability Score metric, the "Reliability ≥ N" filter): the **plain number** ("92").
- **Running text, aria-labels, share and OG text:** **"92/100"** (Mint Detail meta description, `og:description` / `twitter:description`: "Reliability Score: 92/100 · Online", `backend/src/og.ts`).
- **Reliability Score movers:** the column is a change in points (`backend/src/reliabilityMovers.ts`: `latestScore - oldScore`), shown as "+12" / "-9", no unit.
- **Stays a percent sign:** uptime, NUT and software adoption, the outdated-software share, the share of a component's maximum in the Network Health Index rows, the component weights ("Uptime (40%)", tooltips and the Learn module). These are real percentages (or shares of the weights).
- Tests: `src/__tests__/reliabilityScoreNoPercent.test.tsx` renders the card, the Compare modal, Mint Detail and Stats with a fixture and scans for a percent sign; `backend/src/__tests__/og.test.ts` pins the OG text. A new place that shows a score uses the plain number or "n/100".

## Reliability Score calculation (server-side, in prober.ts)

**Public reference (2026-10-13):** `/methodology` describes this formula for visitors and wallet developers and carries the change log; every number on it is tested against the code. **A formula change must add a `METHODOLOGY_CHANGES` entry and bump `METHODOLOGY_VERSION`** (backend + frontend copy) and update `src/constants/methodologyPage.ts` in the same commit — see `methodology-and-wallet-pages.md`.

**Current weights (verified against `backend/src/shared/reliabilityScore.ts`/`auditScore.ts`,
2026-09-19; unchanged by methodology 7, which only split the uptime 40): Uptime 40% · Audit reliability 25% · NUT Support 15% · Version freshness 15% ·
Contact info 5%.** These were reweighted 2026-09-12 (commit `6ae582b`, "reweight toward
audit") from an earlier 45/5/30/15/5 split — **Uptime 45%→40%, Audit reliability 5%→25% (its
own internal scale also moved from 1–5 points to 5–25 points, see below), NUT Support
30%→15%**; Version freshness (15%) and Contact (5%) were unchanged. That commit updated the
code but left this section's prose at the old 45/30/5 numbers for a week — if a percentage
anywhere in this file ever disagrees with the two files above, **the code is authoritative,
not this document**. Same source list used by Learn Module 3's breakdown
(`src/pages/learn/Module3.tsx`).

- Uptime 40%: **four parts since methodology 7 (2026-11-10)**, see "Uptime component: 24 hours and 30 days" below. Only when the 30-day figures are not known (a chart bucket of the past, the frontend fallback) is it still `round(uptimePct * 0.40)`.
- Audit data age: `src/utils/auditFreshness.ts` (the audit.8333.space age rules of the Audit tab) was removed on 2026-11-08 with the 8333 view (`card-and-mint-detail-ui.md`). The Reliability Score row has its own freshness rule (168 h, below).
- **Audit part since methodology 8 (2026-11-13): the WORSE of two windows.** `auditComponent(blamed, total, fetchedAt, now, long)` (`shared/auditScore.ts`, frontend copy `src/utils/auditScore.ts`) computes the same error-rate band for the 7-day window (`mints.audit_cz_total` / `audit_cz_blamed`) and for the long window (`mints.audit_cz_long_total` / `audit_cz_long_blamed` / `audit_cz_long_days`, up to `AUDIT_LONG_WINDOW_DAYS` = 28) and returns the lower one, so a fresh failure counts at once and an old one keeps counting for up to 28 days (before: it was gone after 7). A window with fewer than `AUDIT_MIN_SAMPLES` swaps has no band; a mint with too few swaps in 7 days is scored from the long window alone when that has enough (`auditDataState` then says `scored`). Stale or missing 7-day data stays neutral whatever the long window holds. **Where the long window comes from:** cashu.info publishes only rolling 7-day totals and no blame per swap, so the detail cron (`auditCzDetail.ts`, `storeDailyAndSumLong`) stores the FIRST usable totals of each UTC day in `audit_cz_daily` (`ON CONFLICT DO NOTHING`) and adds up rows exactly 7, 14 and 21 days older than today's (`sumLongWindow`, pure): four 7-day spans that do not overlap. The first missing row ends the sum (no gap inside the window); `audit_cz_long_days` is 7, 14, 21 or 28, and with 7 the long window holds nothing new and is ignored. Storing began on 2026-11-13, so the window reaches 28 days on 2026-12-04. The long window ends at the start of the UTC day (the day's first cron run); swaps since then are in the 7-day window. Rows of `audit_cz_daily` are never deleted (the Audit tab shows the sum of every stored span, "Since …"). Frontend: `src/utils/auditWindows.ts` (`auditLongOf`, `decidingAuditWindow`: the window whose numbers the breakdown row shows, with " · 28d" after them when it is the long one). Tests: `backend/src/__tests__/auditLongWindow.test.ts`, `auditLongWindow.pg.test.ts` (real Postgres), `src/__tests__/methodologyPage.test.tsx`.
- Audit reliability 25% — **source switched 2026-10-08 from audit.8333.space to the stored cashu.info detail.** Input = `errorsBlamed / swaps7d.all.total` of the 7-day window of the stored detail (`audit_cz_detail`), i.e. the share of swaps whose failure cashu.info attributes to the mint itself (Lightning routing failures are by default not blamed on the mint; attempts the auditor stops itself before sending — too little balance, an amount outside the mint's limits — are not swaps and are not in the total; cashu.info's own score/scoreParts are never read or stored). `auditComponent(blamed, total, fetchedAt, now)` in `backend/src/shared/auditScore.ts` (frontend copy `src/utils/auditScore.ts`, compared by `src/__tests__/sharedModules.test.ts`): bands unchanged (0 → 25, <1 % → 20, <5 % → 15, <15 % → 10, else 5; `blamed` above `total` is clamped to `total`); **neutral 12.5** when an input is null/non-finite/negative, when `total < AUDIT_MIN_SAMPLES` (**10**, was 3), or when the stored detail is older than `AUDIT_MAX_AGE_HOURS` (**168 h**, measured from `audit_cz_fetched_at` at probe time; a future timestamp counts as fresh). `auditDataState()` names the reason (`scored | no-data | too-few | too-old`) for the breakdown row. **Storage (option A):** `mints.audit_cz_total`, `audit_cz_blamed`, `audit_cz_fetched_at`, written by the 30-minute detail cron (`auditCzDetail.ts`) in ONE statement with the `audit_cz_detail` upsert (CTE) for every tracked mint the mapping resolves — exact normalised URL (`rtrim(url,'/')`) or an alias listed in `audit_cz_aliases`; unusable numbers → NULLs (neutral), a failed fetch writes nothing. `initDb()` adds the columns and runs an idempotent backfill from `audit_cz_detail` (`AUDIT_CZ_BACKFILL_SQL` in `db.ts`) so a deploy never dips scores to neutral. The prober reads the three columns in the same single SELECT as before (`prober.ts`); no JSON parsing at probe time. **A mint with no cashu.info detail scores neutral; the old audit.8333.space data (`audit_recent_total`/`audit_recent_errors`, `audit_n_*`, `mint_audit_swaps`) is NOT a fallback anywhere in scoring** — it stays stored, in `/api/mints/known` and on the Audit tab (source switcher). The 8333 tab keeps its own 3-sample label floor (`AUDIT_TAB_MIN_SAMPLES`, `isAuditUnknown()`). Expected effect (read-only simulation 2026-10-08 on 67 scored mints): about 21 mints at 25, 8 at 15, 4 at 10, 8 at 5, 26 neutral; mean 66.0 → 72.6, median 75 → 81, 17 mints cross 90; `mint.instant.gr` −12, `cashu.centurymetadata.org` and `mint.ucash.space` −8 (the 8333 sync had been stale for 11 days). Two tracked pairs share one cashu.info mint through aliases (`mint.sharegap.net` = `mint.nostrodomo.net`, `satscribe.me/cashu` = `mint.satscribe.me`: same name, version, NUT count, ASN) and so get the same inputs. **Breakdown row (Mint Detail)** — short value (`blamed / total` or `neutral`) and the points, no sentence under a scored row; only the neutral states add a full-width line `.rb-row-detail`: `Not enough audit data yet (fewer than 10 swaps in the last 7 days): neutral` / `No cashu.info audit data: neutral` / `Audit data older than 7 days: neutral`; a quiet `data N days old` note (from `auditCzFetchedAt`) only above 24 h and below 168 h. The row and its ⓘ ("Failures that cashu.info attributes to this mint, out of its swaps in the last 7 days (not the overall success rate). Under 10 swaps or no recent data: neutral 12.5 of 25.") use only `auditCzTotal/Blamed/FetchedAt`; the audit detail request loads only with the Audit tab. Compare's "No mint fault (7d)" row (renamed 2026-10-25 from "Audit success") reads the same fields (`n/a` unless the row is scored). API: `/api/mints/known` adds `auditCzTotal`, `auditCzBlamed`, `auditCzFetchedAt`. Stats shows a one-time note under Reliability movers for 30 days (see `stats-dashboard-watchlist-ui.md`). Tests: `auditScore.test.ts`, `reliabilityScore.test.ts` (both packages), `prober-audit-inputs.test.ts`, `dbAuditCzMigration.test.ts`, `auditCzDetail.test.ts`, `mints-known.test.ts`. **Wording (2026-10-09):** the Audit tab's attributed tile is "Caused by this mint" (big number = `errorsBlamed`, caption "of N failed swaps"); the breakdown row shows only `blamed / total` and the points (no sentence under a scored row, 2026-10-09); the overall success rate never enters the score. Details in docs/claude/card-and-mint-detail-ui.md.
  - **Audit tab layout:** the audit.8333.space summary strip (Mints · Melts · Recent success rate · Avg swap time, 2026-09-03) was removed on 2026-11-08; the tab is the cashu.info view (`card-and-mint-detail-ui.md`, "Audit tab: cashu.info view").
  - **`auditReliabilityColor()` (`src/utils/mintFormatting.ts`, 2026-09-04) is a separate, UI-only coloring function — deliberately NOT the same thresholds as `auditComponent()`'s 5–25 scoring bands above**, and it does not feed the Reliability Score number. It colors directly off the raw error rate: `var(--fast)` (green) at ≤5% errors, `var(--med)` (amber) at ≤25%, `var(--slow)` (red) above that — `< 3` samples renders muted (`var(--t3)`). The bucket scoring is much stricter (e.g. a 5% error rate already scores 15/25, two tiers down from the max), which read as misleadingly alarming at a glance for what's actually a 95%-success mint; the amber cutoff was widened from an initial 15% to 25% the same day after review. Used by the Audit summary strip's 8333 cell (3-sample floor, default `minSamples = 3`) and, with `minSamples = AUDIT_MIN_SAMPLES` (10) over the cashu.info window, by the Reliability Score Breakdown's "Audit reliability" row.
- NUT Support 15%: min(nutCount/14, 1) * 15 — 14 is the number of mint-side NUTs actually tracked (`TRACKED_NUTS` in `src/constants/nuts.ts`, mirrored as `TRACKED_NUT_COUNT`/`TRACKED_NUT_KEYS` in `backend/src/shared/reliabilityScore.ts`). **Since 2026-10-21 (methodology 4) a NUT entry with `"supported": false` in `/v1/info` is NOT counted:** `nutCount` counts the tracked keys for which `isNutDeclaredSupported(nuts[key])` (`backend/src/shared/nutSupport.ts`, byte-identical frontend copy `src/utils/nutSupport.ts`, one table of cases in `src/__tests__/nutSupportCases.ts` run against both copies by `sharedModules.test.ts`) holds: absent / `null` = not declared, `{supported:false}` = not supported, `supported:true`, an object without the key, `{}` and any other non-null value = supported. The same helper decides the wallet API `nuts` field and `nuts=` filter (and `/api/mints/recommend`), `authRequired` (NUT-21/22), `/api/stats` `nutAdoption`, the probe preview keys and the change log's `nuts` list. Measured before the change (2026-10-21, public `/api/mints/known`): 2 of 61 mints had `supported:false` entries (`lekmint.cash/api` NUT 8, 9, 10, 11: 66 → 61; `mint.lndiscs.duckdns.org` NUT 14: 66 → 65); their scores change on the next probe, no DB write. Tests: `prober-nut-support.test.ts`, `integration/nut-supported-false.test.ts`, `nutSupport.test.ts` (both packages). Not covered on purpose: `alertTriggers.ts` (`nut_loss` for NUT-04/05 reads `disabled !== true`, not `supported`). Shrunk from 25 to 14 on 2026-09-14 — see "NUT tracking scope: mint-side vs. wallet-only" below. `nutCount` itself (the `mints.nut_count` column, written by `prober.ts`) now counts only the intersection of a mint's `/v1/info` `nuts` keys with `TRACKED_NUT_KEYS` — previously it was `Object.keys(nuts).length`, which let auth (21/22) and payment-method (23/25/30) keys inflate this component even though they were never part of the denominator's intent.
  - **Switched-off NUT-04/05 (2026-10-27):** the wallet API adds `mintDisabled` / `meltDisabled` (additive, null when the NUTs are unknown); the website shows the NUT as disabled and its lists and filters and `/api/stats` `nutAdoption` use `isNutOffered`. The wallet API `nuts` field and its `nuts=` filter still list a switched-off NUT (it is declared).
  - **Methodology 5 (2026-10-27): a switched-off NUT does not count for the score.** `prober.ts` writes `nutCount` (`mints.nut_count`) as the tracked keys for which `isNutOffered(nuts[key])` holds (declared and not `disabled: true`), so the score, the stored `scoreBreakdown.nuts` and the stored count shown in the Dashboard list, Compare and the Mint detail header all use the offered count (the frontend no longer subtracts; `offeredNutCount` was removed). Mint detail's fallback score and NUT row use `offeredNuts` and the row reads "11 / 14 NUTs · 2 disabled". The probe preview (`/api/mint/probe`, unknown URL) keeps `{ disabled: true }` on a switched-off key so the page counts it the same way. Stored counts and scores change at each mint's next probe; no migration. Test: `prober-nut-support.test.ts`.
  - **Frontend filters (Stage 2, 2026-10-25):** the Best Mint wizard's seed/P2PK/WebSocket checks (NUT-9/11/17, `passesWizardNutChecks`), the Stats NUT coverage modal list (`onlineMintsSupportingNut`) and the Dashboard `?nuts=` filter (`hasRequiredNuts`) — all in `src/utils/nutFilters.ts` on top of `mintSupportsNut` (added to BOTH `nutSupport` copies) — used `nutsLimits[key] != null`, so a `{ supported: false }` entry passed. They now use the shared rule. The Network Health Index BOLT12/on-chain adoption (`methodAdoptionPercent`) skips a method whose NUT-04/05 entry is `supported: false`; its population (online with a stored `nuts` object) is unchanged and still matches `/api/stats`. Tests: `nutFilters.test.ts`, `networkHealthIndex.test.ts`, `sharedModules.test.ts`, backend `nutSupport.test.ts`.
  - **Frontend reading (Task Y H, 2026-10-21):** `supportedNutKeys()` (both copies of `nutSupport`) uses the declared-as-supported rule — a `null` value is NOT a NUT, like absent and `supported: false` — and Mint Detail takes its one `supportedNutNumbers` set from it (the fallback score of a mint without a stored score, the NUT row of the breakdown, the NUT grid, its modal and the backup check). Before this, the fallback and the NUT row counted `Object.keys` (presence) and could differ from the stored score. The shared table of cases (`nutSupportCases.ts`) pins `inKeys` for both copies.
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
- The stored server-side score is authoritative. `MintDetail.tsx` computes a score itself only as a fallback — when `knownMint.reliabilityScore` is missing, or for a historical chart bucket with no stored `reliability_score`. That fallback needs the 24 h uptime history: until it has arrived (or when its request failed) the page shows a placeholder, not a score computed with uptime 0 (`docs/claude/card-and-mint-detail-ui.md`, "Score placeholder").
- Rounding: each component rounds individually, then the total gets exactly one outer `Math.round` before the cap — `Math.min(100, Math.round(sum))`, followed by `applyNewMintCap()`. Both copies must keep this ordering or a mint's breakdown rows won't add up to its stored total.
- **Stored breakdown for the wallet API (2026-10-20, formula untouched):** `backend/src/scoreBreakdown.ts` (`computeScoreBreakdown`, backend only, calls the same component functions) returns `{ uptime, audit, nuts, version, contact }` as `{ points, max }` (maxima 40/25/15/15/5), `newMintCap: { points, cap: 75 }` and `sum`. `points` of the cap is `capped - uncapped` (0 or negative), `sum = min(100, round(parts)) + newMintCap.points` = the stored score. The neutral audit value is 12.5, so the parts may end in .5; the single outer rounding is why `sum` is not the plain total of the parts. `prober.ts` `recordProbeResult` calls both functions with ONE `now` and writes the JSON into `mints.score_breakdown` in the same `UPDATE` as `last_reliability_score` (never recomputed at read time; NULL until the first probe after the deploy). `scoreBreakdown.test.ts` checks `sum === computeReliabilityScore(...)` on a grid of more than 10,000 inputs, `prober-audit-inputs.test.ts` checks the UPDATE parameters. Any change to the formula must keep both in step (the test fails otherwise).

## Uptime component: 24 hours and 30 days (methodology 7, 2026-11-10)

**Why.** Until version 6 the 40 uptime points came from the last 24 hours only, so a mint was back at 40/40 one day after an outage. Measured on 2026-11-10: `mint.lnpay.cz` scored 100 and ranked first with 77 % uptime over 30 days (one outage of 6.8 days that had ended 11 days before, plus 7 short ones). Owner decision the same day: keep the public weights (40 / 25 / 15 / 15 / 5) and split the 40 points.

**The four parts** (`uptimeParts()` in `backend/src/shared/reliabilityScore.ts`, frontend copy `src/utils/reliabilityScore.ts`; all integers, their sum is the component):

| Part | Max | Rule | Constant |
|---|---|---|---|
| Last 24 hours | 20 | `round(pct24h * 0.20)` | `UPTIME_24H_MAX` |
| Last 30 days | 10 | one point per whole percent above 90 %, `clamp(round(pct30d) - 90, 0, 10)` | `UPTIME_30D_MAX`, `UPTIME_30D_FLOOR_PCT` |
| Longest outage in 30 days | 6 | under 1 h 6, under 6 h 4, under 24 h 2, a day or more 0 | `LONGEST_OUTAGE_BANDS` |
| Outages in 30 days | 4 | 0–2 → 4, 3–5 → 3, 6–10 → 2, 11–20 → 1, more → 0; **0 while an outage is ongoing** | `OUTAGE_COUNT_BANDS` |

- **An outage** is two or more failed probes in a row: the blocks of `backend/src/outages.ts` `summarizeOutages`, the same function `/api/mints/outages` and the History tab use, so the tab and the score count the same thing. A single failed probe is not an outage. An ongoing outage is measured up to the probe; a block that starts at the window start is measured inside the window. `summarizeOutages` returns `longestOutageMs` over ALL outages of the window (the listed `outages` are only the newest 20).
- **Inputs at probe time:** `uptimeInputFor()` in `prober.ts` reads the mint's `mint_history` rows of the last `UPTIME_WINDOW_DAYS` (30) days (one indexed query per probe, about 8,640 rows per mint) and returns `UptimeInput { pct24h, pct30d, outageCount30d, longestOutageMs30d, ongoingOutage }`. A mint tracked for less than 30 days is measured on the rows that exist. Rows held back as a suspected vantage outage were never written, so they are not outages.
- **The "ongoing → 0" rule** exists so that a mint which has been down for the whole window (one truncated, ongoing outage) does not gain 4 points for "few outages"; without it dead mints would have scored higher than under version 6.
- **Plain number.** `uptimeComponent()` and `computeReliabilityScore()` take `number | UptimeInput`. A plain number means "only the 24-hour percentage is known" and scores `round(pct * 0.40)`, the old formula: the Mint Detail chart buckets of the past and the frontend fallback (a mint without a stored score) use it. Do not pass a plain number from the prober.
- **Stored with the score:** `scoreBreakdown.uptimeParts` (`last24h`, `last30d`, `longestOutage`, `outageCount`, each `{ points, max }`) and `scoreBreakdown.uptimeInputs` (`uptime24hPct`, `uptime30dPct`, `outageCount30d`, `longestOutage30dMs`, `ongoingOutage`), written in the same `UPDATE` as the score. No new column. `readStoredBreakdown` drops the two keys (and keeps the rest) when they are missing, malformed, without inputs, or when the parts do not add up to `uptime.points`; a breakdown stored before version 7 has neither. Scores and breakdowns change at each mint's next probe after the deploy (at most one 5-minute cycle), no migration.
- **`uptimePct30d` on `/api/mints/known`** (additive) and the wallet API's `uptime30dPct`: the figure stored with the score (`uptimeInputs.uptime30dPct`), and only until a probe has stored one the live count of the snapshot query (`uptime30dPctOf` in `knownMintsSnapshot.ts`). One figure for the page, the wallet API and the gate.
- **Simulation before the change** (public API, 2026-11-10, the 44 mints that passed the gate): 30 unchanged or −1, 3 at −2..−3, 6 at −4..−9, 5 at −10 or more, none higher. `mint.lnpay.cz` 100 → 82 (rank 1 → 21), `mint.mikelcalvo.net` 97 → 88 (35 short outages), `mint.fredix.xyz` 86 → 70, `mint.satscribe.me` 83 → 68, `mint.nuts.cash` 76 → 63, `lekmint.cash/api` 58 → 48.
- **Known and accepted:** a mint can still read "High Reliability" (70+) shortly after a long outage (lnpay at 82); the owner accepted the bands as proposed. Changing a band is a formula change (version bump, page data, tests).
- Tests: backend `reliabilityScore.test.ts` (parts, bands, the lnpay case), `scoreBreakdown.test.ts` (parts add up, JSON round trip, partial records), `prober-network-failure-score.test.ts` (inputs stored with the score), `outages.test.ts` (`longestOutageMs`); frontend `methodologyPage.test.tsx` (page data against both copies and against `prober.ts` / `outages.ts`), `mintDetailFacts.test.ts`, `uptime30dDisplay.test.tsx`, `sharedModules.test.ts`.

### Recommendation gate: 95 % uptime in 30 days (methodology 7)

`hasSteadyUptime(uptimePct30d)` (`MIN_RECOMMENDATION_UPTIME_30D_PCT = 95`, both copies): unknown (`null`) is not eligible. It is one more condition next to `isEligibleForRecommendation` (14 days), `hasFreshProbe` (3 hours), online, scored, not a test mint. Applied in: the wallet API `eligibleForRecommendation` (and so the `eligible` filter and the deprecated `/api/mints/recommend`), `/api/stats` `top5ByReliabilityScore` (reads the stored figure straight from `score_breakdown`; before a probe has stored one the list is empty for that mint), the Stats "Most Reliable" panel (BOTH lists: by Reliability Score and by 7-day uptime, since a week-long outage that ended 8 days ago is 100 % on the 7-day window) and the Best Mint wizard. Not applied to the Dashboard order or to the Watchlist "recommended by follows" list. On 2026-11-10 the limit removed 4 of 44 mints (lnpay 77 %, fredix 84 %, satscribe 91 %, nuts 93 %); the next mint was at 96.5 %. 90 % would have removed 2, 98 % 6.

**Compared unrounded (2026-11-11).** The gate gets the UNROUNDED share, never the whole percent shown in the UI, so 94.5 % does not pass as 95 %. `exactPct(part, total)` (both copies) gives two decimals rounded DOWN; the prober stores it as `scoreBreakdown.uptimeInputs.uptime30dExactPct` beside the whole-percent `uptime30dPct` (`UptimeInput.pct30dExact`; the score's 30-day part still uses the whole percent). `/api/mints/known` carries `uptimePct30dExact` (stored figure, else the exact live count), the wallet API's `eligibleForRecommendation` reads `WalletExtra.uptime30dExactPct`, `/api/stats` reads `uptime30dExactPct` from `score_breakdown` (NULL in a breakdown stored before it, i.e. until the first probe after the deploy), and Stats / the Best Mint wizard call `hasSteadyUptime(m.uptimePct30dExact)` (a source test in `uptime30dDisplay.test.tsx` guards that). The card chip and every displayed figure keep the whole percent.

### Where the 30-day figure is shown

- **Card:** a `77% up 30d` chip (`data-testid="card-uptime-30d"`, `cardUptime30dChip` in `compareLabels.ts`) only when `isUptime30dLow` (known and below the gate limit); no chip on a steady mint (a chip on every card would be noise). Tone `var(--med)`, muted on an offline card like the other chips.
- **Mint Detail header:** a "30 days 77%" line under the Uptime 24h tile (`data-testid="md-uptime-30d"`), warning tone below the limit (`uptime30dColor`).
- **Breakdown, Uptime row:** with stored parts the value reads `100% · 30d 77%`. The row has the structure of the other four rows (heading with ⓘ, value, points, ONE source line, bar): there is NO line with the parts under it (removed 2026-11-11; `uptimePartsDetail` is gone). The four parts with this mint's figures and points are the text of the row's ⓘ, built by `uptimeRowTooltip(stored, formatDuration)` in `tooltipTexts.ts` from the stored record only (`scoreBreakdown.uptimeParts` for the points and maxima, `uptimeInputs` for the figures): `Last 24 h: 100% of probes succeeded (20 of 20 points). Last 30 days: 77% (0 of 10). Longest outage in 30 days: 6d 18h (0 of 6). Outages in 30 days: 8 (2 of 4).` No outage: `No outage in the last 30 days (6 of 6). Outages in 30 days: 0 (4 of 4).` An ongoing outage is named after the count (`1, ongoing` / `3, one ongoing`). A figure that is missing or not a finite number reads `no data` (never 0, `undefined` or `NaN`) and keeps the stored points; a missing part has no points bracket. Without stored parts (a record from before methodology 7, the live fallback) the ⓘ is the general `uptimeRowText()`. Tests: `tooltipTexts.test.ts` ("uptimeRowTooltip"), `e2e/mint-detail-uptime-row.spec.ts` (row structure, tooltip text, 320 / 390 / 768 px).
- **Compare:** row `uptime-30d` ("Uptime 30d") in the desktop grid and the mobile table, after "Uptime 24h".
- **History tab, Outages:** "longest 6d 18h" under "Time to recover" when there is more than one outage (the mean alone hid one long outage among short ones); `formatDuration` moved from `HistoryTab.tsx` to `mintDetailFacts.ts`.
- **Texts:** the Uptime row tooltip (`uptimeRowTooltip`, else the general `uptimeRowText`), `/methodology` (table `data-testid="uptime-parts-table"` from `METHODOLOGY_PAGE.uptime`), Learn module 3.

## Monthly audit-part check (cashu.info input)

One check a month of how the audit part (25 points, cashu.info's 7-day window, methodology 2 since 2026-10-08) behaves across the tracked mints. Data: the public `/api/mints/known` (`auditCzTotal`, `auditCzBlamed`, `auditCzFetchedAt`, `scoreBreakdown.audit.points`); no database access needed. Compare with the previous row; act only on a trend, not on one month.

| Date | Mints | Scored (≥ 10 swaps, fresh) | Neutral: < 10 swaps | Neutral: no cashu.info data | Audit points (count) | Scored with a blamed failure | Detail age |
|---|---|---|---|---|---|---|---|
| 2026-11-08 (first check, baseline) | 61 | 22 (36 %), swaps median 18, min 10 | 34 (56 %) | 5 (one of them online: `mint.nostrfeed.com`) | 12.5 ×39, 25 ×13, 5 ×6, 10 ×2, 15 ×1 | 9 of 22 | 0.3 h (none stale) |

Observations 2026-11-08: (1) most mints sit at the neutral 12.5 because cashu.info runs fewer than 10 swaps a week through them, so for 64 % of the mints the 25-point part says nothing either way; raising coverage is cashu.info's side, lowering `AUDIT_MIN_SAMPLES` would score mints on 3 to 9 swaps (noisy) and is a methodology change. (2) The lowest band (5 points) holds 6 mints with high attributed shares on small samples (`mint.mjex.me` 11/13, `mint.mintlnd.org` 7/12, `mint.nostrzap.me` 7/13, `mint.nostrodomo.net` and its alias `mint.sharegap.net` 4/12 each, `mint.lnw.cash` 8/50). (3) The detail cron is current. No action.

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

Community Rating excludes reviews from a key that is both a listed Nostr contact and the author of the mint's NIP-87 announcement (labelled "Operator"; a contact-only key is counted and only labelled, Task Y L; operator = contact key that also authored the mint's announcement, see "Operator reviews are
labelled and not counted" in reviews-and-nostr.md); the Reliability Score formula is unaffected.

## NUT list — single source of truth (2026-08-19)

`src/constants/nuts.ts` is the only place the tracked-NUT list and its display metadata
live: `TRACKED_NUTS` (14 entries, ascending), `TRACKED_NUT_KEYS` (the unpadded `'4'`/`'5'`…
form used by `/v1/info`'s `nuts` object and the `nuts_limits` column), `NUT_META`
(short label / description / `specNum`) and `nutSpecUrl()`.

It replaced drifting copies in `MintDetail.tsx` (`ALL_NUTS`), `Stats.tsx` (`NUT_ORDER` plus its own
near-identical `NUT_META`) and `ComparisonModal.tsx` (`NUT_FILTER_KEYS`); the fourth copy lived in the `/nuts` NUT Explorer
page, which was removed in N1 (2026-10-28). `src/__tests__/nuts.test.ts` pins the invariants, including
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
  wording before merging them; the other consumer (`Stats.tsx`) reads only `NUT_META` (the `/nuts` NUT Explorer page was removed in N1, 2026-10-28).

## Mint Probe — Degraded/Offline Detection

**isSafeUrl** returns `'safe' | 'blocked' | 'dns-error'` — DNS failures are now written to `mint_history` as `online: false` instead of being silently skipped.

**Degraded logic** (in `backend/src/index.ts`):
```
degraded = (total24h >= 4 && onlineCount === 0) || isStaleOffline
isStaleOffline = last known state is offline AND older than 24h
```

Frontend hides degraded mints by default (`showDegraded=false`); footer shows "N mints hidden (offline 24h+) — Show" (N = every tracked mint the default view hides, see `src/utils/mintCounts.ts`; the degraded rule itself is unchanged).

**Known edge case:** After the first DNS-failure write, a mint may briefly show `degraded=false` for ~20 min until 4 probe records accumulate. Self-correcting, no intervention needed.

**Invariant (2026-10-20): every recorded probe outcome, including network failures, updates the stored score and runs the transition logic.** All outcomes (online, HTTP error, invalid JSON, not Cashu, timeout/unreachable/TLS and the DNS error of the SSRF guard) end in `recordProbeResult` in `prober.ts`: history row, `invalid_since`/`last_online_at`, the online→offline / offline→online DM trigger, the alert conditions, and the recomputed `mints.last_reliability_score` (also copied to the new history row). The DNS-error branch used to write only a history row and `last_error`, so a mint whose DNS broke kept its old score (a mint at 0 % uptime showed 87) and never sent "Goes down"; it now calls `recordProbeResult`. Failures held back as a suspected vantage outage are still not written at all (`commit()` of `DeferredProbeFailure` runs this same function). There is no per-probe kind 30385 hook: the health publisher reads status and score from the database on its own timer, so it follows the stored score. Tests: `prober-network-failure-score.test.ts`.

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
  `/api/nuts` (removed in N1, 2026-10-28) and `/api/stats`'s `nutAdoption` also switched their own hardcoded 25-key
  arrays to import `TRACKED_NUT_KEYS` instead of duplicating it.
- Detail NUT grid/modal, Stats adoption bars, and Compare's NUT rows all already derived
  their NUT list from `TRACKED_NUTS`/`TRACKED_NUT_KEYS`, so shrinking that one export was
  enough to hide the wallet-only NUTs everywhere at once — no per-page filtering added.

### NUT tracking expansion (2026-07-02) — superseded by the cut above
Historical, no longer describes the current code: moved to `docs/claude/archive/scoring-and-probing.md`.

## Probe fixes — HTTP status handling

- HTTP 429 → the probe is skipped (nothing written to `mint_history`); mint stays at its last known state instead of a false-positive offline. **Bounded since 2026-10-28 (audit run-4):** after `RATE_LIMITED_PROBES_BEFORE_FAILURE` (12, about 1 h) consecutive 429s of one mint the probe is recorded as failed with `lastError` `HTTP 429` (in-memory counter per URL, reset by any other outcome; a restart only delays it), because a frozen score and "online" state would otherwise look fresh for as long as the 429s last (a mint answering 429 only to our IP). A recorded `HTTP 429` does NOT start the reap clock (`invalid_since`), and the daily revalidation treats a 429 on `/v1/info` as `unreachable`, not `not-a-mint` (so the 7-day `not-a-mint` reap no longer applies to such a mint; it is recorded as offline and `pruneAbandonedMints` removes it 90 days after its last successful probe, so the 429 is never a permanent exemption). **Probe-age gate (2026-10-28, methodology version 6):** `eligibleForRecommendation` of the wallet API (and with it `/api/mints/recommend`) and the backend's `/api/stats` `top5ByReliabilityScore` also require a probe at most `MAX_RECOMMENDATION_PROBE_AGE_HOURS` (3) old (`hasFreshProbe`, `shared/reliabilityScore.ts`, mirrored in `src/utils/reliabilityScore.ts`), because "online" alone only means "the newest stored probe succeeded", however old it is. `top5ByReliabilityScore` also requires `online` now (it listed offline mints by their stored score before). The `status` field itself is unchanged. The frontend lists that recommend a mint apply the same probe-age test (`hasFreshProbe(m.lastCheckedAt)`, client clock): the Stats "Top by uptime" and "Top by Reliability Score" panels and the Best Mint wizard (`Stats.tsx`, `Tools.tsx`; pinned by `e2e/stats-widgets.spec.ts` and `e2e/tools.spec.ts`). The Dashboard's online-only default view is a status filter, not a recommendation, and is unchanged. **A probe that finds the host resolving into a blocked range** (`checkUrlSafety` = `blocked`) is recorded as a failed probe (`Blocked address`, no request is made, no reap clock) instead of returning silently, so the last `online` row cannot stay frozen.
- HTTP 502/503/504 → one retry after 2s before recording offline (handles transient server-side blips like restarts/deploys)
  - The on-demand `/api/mint/probe` does the same since 2026-10-03, inside one shared 12 s deadline (see backend-api-and-data.md, probe bullet); the cron path is unchanged. Since 2026-10-25 a known mint whose last cron probe was offline gets a 4 s deadline and no retry, and offline on-demand results are cached 60 s (display only; see backend-api-and-data.md, "Known-down fast path").
- "Show my latency" (client-side test in MintDetail) fixed — previously used `mode: 'no-cors'` which hid the HTTP error status, so `fetch` resolved "successfully" even on a 502 and showed a fake latency. Now uses standard cors mode, reads `res.ok`/`res.status`, and shows `Unreachable (HTTP XXX)` instead of a bogus number
- Tooltip on the HTTP error badge (Mint Detail header) — maps 429/502/503/504 to an explanatory message for less technical users

## Suspected vantage outage (2026-10-20)

If OUR probe server loses its network, every mint fails at once. Without a guard every mint gets an offline row and every subscriber a "went offline" DM. The second vantage point is cashu.info (its own probe every 5 minutes, stored by us in `audit_cz_mints.state` / `last_check` by the feed sync). Code: `backend/src/vantageOutage.ts` (pure decision, all thresholds as named constants), `backend/src/probeCycle.ts` (the cycle: `runProbeCycle`, called by the 5-minute cron), `probeMintToDb(url, onDeferFailure?)` in `prober.ts`.

**The rule.** A cycle is classified as a suspected vantage outage only when ALL hold:
- (a) of the mints whose last stored status (newest `mint_history` row of the past hour, read BEFORE the cycle) was online, at least `VANTAGE_MIN_FAILED_PERCENT` (50 %) failed in this cycle and at least `VANTAGE_MIN_FAILED_COUNT` (20) did;
- (b) the failures that count are our network failures: `VANTAGE_NETWORK_KINDS` = `dns`, `timeout`, `unreachable`, `tls` (kinds of `classifyProbeFailure`). HTTP statuses (`host_error`, `blocked_by_host`, `rate_limited_by_host`) and `not_cashu` answers are the mint's and never count;
- (c) of those failed mints that cashu.info covers with a last check not older than `VANTAGE_MAX_CHECK_AGE_MS` (15 min), at least `VANTAGE_MIN_SEEN_UP_PERCENT` (70 %) are seen up (`state` is not `error`; `warn` counts as up). A check up to 60 s in the future (clock difference) is fresh, anything further is ignored;
- (d) at least `VANTAGE_MIN_COVERED` (10) failed mints are covered with a fresh check, otherwise the evidence is too thin.
Percentages are compared as integers (`part * 100 >= whole * percent`), so 49 vs 50 is exact. A mint matches cashu.info by its exact URL (`rtrim(url,'/')`) or an alias in `audit_cz_aliases`.

**Fail open.** Missing cashu.info rows, stale checks, a cashu.info lookup that throws, a failed previous-status read: the cycle is NOT classified and everything is recorded exactly as before. No new outgoing request, no canary, no new dependency: the evidence is data already in the database. The cashu.info query only runs when at least 20 failures were held back.

**What happens in a classified cycle.** `probeMintToDb` with a callback does not record a network failure but hands `{url, kind, commit}` to the cycle, which collects them in memory (one closure per failed mint, bounded by the number of mints). After every mint was probed the cycle decides. Classified: the held failures are dropped for ALL failed mints (also the ones that were already offline: the failure is ours) — no `mint_history` row, `mints.last_error`, `last_online_at`, `invalid_since` and `last_reliability_score` unchanged, no transition and therefore no DM and no alert. Not classified: the `commit`s run (same concurrency 10) and write exactly what the probe wrote before, only at the end of the cycle (`checked_at` a few seconds later). NOT held back and always recorded as normal: mints that answered (also in a classified cycle), HTTP error answers, `not_cashu`, 429 skips, and the on-demand/discovery/submit paths (they pass no callback). The gap in the history is left as it is: the uptime formula already works with the probes that exist. No change to the Reliability Score, the methodology version, the notification rules or the `uncaughtException`/`unhandledRejection` handlers.

**Reading it.** One log line per classified cycle, numbers only (no mint names, no URLs): `[probe] suspected vantage outage: F of N previously online mints failed (network errors), R of C covered failures seen up by cashu.info: this cycle's failures are not recorded` — F failed (network) of N previously online, R of the C covered-and-fresh failures seen up. In normal operation it never appears (`docker compose logs backend | grep -c "vantage outage"` is 0). `/api/v1/health` carries `lastVantageOutageAt` (ISO 8601 UTC, in memory, `null` until one happens after a restart); `getVantageOutageCount()` is the counter since start. Structural limit: a mint behind a challenge page that blocks only our server is a single failure of kind `blocked_by_host` or `host_error`, never a network failure, and rule (a) needs half of all previously online mints, so it is not affected. cashu.info checks every 5 minutes and our feed sync runs every 10, so a stored `last_check` is 0–15 min old: a mint near the limit is simply not evidence (fail open). Tests: `vantageOutage.test.ts` (boundaries), `probeCycle.test.ts` (the cycle with stubbed fetches), `integration/health.test.ts`; the Methodology page says it in one sentence (Data sources paragraph).

## Keysets and NUT-02 id check — `mint_keysets` (2026-10-20, task W2a)

Data collection only. **Nothing here feeds the Reliability Score** and `/methodology` is unchanged. Since 2026-10-20 (task W2b) the
wallet API exposes it: `keysets` / `keysetsCheckedAt` (keysets of the latest successful check) and the `maxInputFeePpk` filter, see
`backend-api-and-data.md` "Wallet API additive fields".

- **Table `mint_keysets`** (`db.ts`, additive and idempotent, runs at startup like every migration): `url` (FK to `mints`,
  `ON DELETE CASCADE`, so every prune path that deletes a mint removes its keysets), `keyset_id`, `unit`, `active`,
  `input_fee_ppk` (nullable), `final_expiry` (nullable), `id_version` (`v1` = `00…`, `v2` = `01…`, `legacy` = old base64-style
  id, `unknown`), `id_valid` (nullable: NULL = could not be checked), `first_seen_at`, `last_seen_at`, `last_checked_at`;
  primary key `(url, keyset_id)`, index on `url`. Plus `mints.keysets_checked_at` (nullable, no default).
- **Hourly job** (`keysetsSync.ts`, cron `2-57/5 * * * *` in `cron.ts`, outside the 5-minute probe cycle): every mint has one
  fixed slot of 12 (hash of its URL), a tick serves the online mints (latest history row online, not older than 15 min) of its
  slot, one at a time after a random 0–45 s start offset and a 1 s pause between mints. So each mint is visited once an hour
  and the load is spread over the whole hour. A tick within 10 minutes after a cycle classified as a suspected vantage outage
  (see below) does nothing.
- **Requests per mint and hour:** `GET /v1/keysets` plus `GET /v1/keys/{id}` for each *active* v1/v2 keyset (legacy ids are not
  fetched: they cannot be verified). Through `safeFetch` (SSRF guard, DNS pinning) with the response caps `mintKeysets` /
  `mintKeys`; at most 32 keysets per mint are processed, the rest is ignored and counted in the log line, never an error.
- **A failed fetch never overwrites** (same principle as `mints.pubkey` / `nuts_limits`): any failure of the keysets request
  (network, status, size, invalid JSON, schema surprise, an empty list) writes nothing, so the stored rows and
  `last_checked_at` stay as they were. A keyset that disappears from the list stays in the table (only `last_seen_at`
  stops advancing, its `active` is the value last seen). A failed `/v1/keys/{id}` keeps the row and leaves the stored `id_valid`
  (the upsert never replaces a verdict with NULL). One log line per tick, counts only (no URL, no body).
- **ID verification** (`keysetId.ts`, pure, unit-tested with the vectors of `cashubtc/nuts` `tests/02-tests.md` and compared with
  cashu-ts `deriveKeysetId`): v1 = `00` + first 14 hex of sha256 over the raw keys sorted by amount; v2 = `01` + sha256 of
  `amount:key` pairs joined by `,` + `|unit:` + (`|input_fee_ppk:` if non-zero) + (`|final_expiry:` if non-zero). `id_valid` is
  true/false only when the id and all its keys came from the same check. A *mismatch* is stored as `false` only after two
  consecutive hourly checks agree (in-memory, reset by a restart); until then `id_valid` keeps its previous value, so one odd
  response is never a stored conclusion.

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
earlier text said Frankfurt, which was wrong. The label shown wherever latency is attributed to the probe (the line above
the cards "latency from Nuremberg" on the Dashboard and the Watchlist, since 2026-11-10 instead of a suffix on every card;
Mint Detail latency tile + tooltip, Stats "from Nuremberg") comes from ONE constant,
`PROBE_LOCATION` in `src/constants/probeLocation.ts`. If the server ever moves, change that value, the root README
"Real-Time Monitoring" line (`src/__tests__/readmeFacts.test.ts` pins it to the constant) and the SECURITY.md "single … IP" limitation, and update the e2e specs that pin the label
(`e2e/mint-card-badges-copy.spec.ts`, `e2e/long-text-overflow.spec.ts`) plus `src/__tests__/mintFormatting.test.ts`.
The backend stores/returns no probe location (`serverLocation` in `/api/mints/known` is the *mint's* location), so there
is no API field, database column or environment variable to change; historical rows are untouched.
