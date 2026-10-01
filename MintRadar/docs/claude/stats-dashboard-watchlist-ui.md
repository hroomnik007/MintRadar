# MintRadar — Compare, Watchlist changes, Stats page, Dashboard UI (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Compare feature — shared picker + mobile layout

- **`MintComparePicker`** (`src/components/MintComparePicker.tsx` + its own `.css`) is the
  shared "Compare with..." mint-selection UI, opened from both Dashboard's per-card ⇄ Compare
  button and MintDetail's header Compare button, ahead of `ComparisonModal`. **History:** it
  used to borrow CSS classes from `MintDetail.css`, which isn't loaded on the Dashboard route
  — the picker rendered unstyled there until it was extracted into this standalone
  component+stylesheet pair (2026-09-02/03, PRs #78/#79). Filters candidates to online mints
  and closes on Escape. Callers pass a pre-filtered `candidates` pool and get back the
  selected URLs via `onConfirm`.
- **Mobile stacked/tabbed layout (≤768px, 2026-09-04):** `ComparisonModal`'s desktop
  side-by-side table is replaced on mobile (gated by `useIsMobile()`, same 768px breakpoint)
  with `.cmp-mobile-tabs` (one tab per compared mint, horizontally scrollable) +
  `.cmp-mobile-stack` (that mint's rows shown one at a time, `.cmp-mobile-row` /
  `.cmp-mobile-row-wrap` for rows needing to wrap to a second line). The CSS for all of this
  lives in `Dashboard.css`, not `Watchlist.css` — this is the file to check when a compare-modal
  style looks unstyled on either page.
- **Version History rows** are two-line (`.cmp-mobile-vh` / the desktop `.cmp-vh-scroll`
  variant) rather than the original single-line `nowrap` layout, so a long version string no
  longer clips or forces horizontal scroll.
- **`?compare=` URL persistence (2026-09-19, Dashboard + Watchlist only — not MintDetail)** —
  `src/utils/compareUrlParam.ts` (`parseCompareParam`/`buildCompareParam`/`resolveComparedMints`,
  `MAX_COMPARE_MINTS` = 4). The confirmed selection from `MintComparePicker` is written to
  `?compare=` (comma-joined mint URLs) via each page's `useSearchParams` — Dashboard folds it
  into the existing `parseFilterParams`/`buildFilterParams` URL-state pattern (so it survives
  search/sort/filter changes); Watchlist (which had no Compare entry point before this) got its
  own `MintComparePicker`/`ComparisonModal` wiring plus `onCompare` on its `MintCard` calls,
  using the same helper. `ComparisonModal` itself renders whenever `resolveComparedMints(...)`
  yields ≥2 currently-tracked mints — an untracked/stale URL in the param is silently dropped
  (never a crash), and a resolved list of exactly 1 simply doesn't open the modal. **Values are
  written as raw, un-encoded URLs** — `URLSearchParams.set()` percent-encodes the whole value
  automatically (colons/slashes AND the `,` separator), so pre-encoding each URL with
  `encodeURIComponent()` first (the pattern used for the one-off `/mint/${encodeURIComponent(url)}`
  route link) would double-encode here; reading back via `searchParams.get('compare')` already
  reverses it, no manual decode needed. Closing the modal clears `?compare=` via a
  `useCallback`-wrapped functional `setSearchParams(prev => …)` update (not a full
  `buildFilterParams` rebuild) specifically so the shared `mintradar:escape` window-event handler
  can't act on a stale closure of the other filter state. Tests:
  `e2e/compare-url-persistence.spec.ts`.
- **Input fee row (2026-10-01):** `ComparisonModal` shows "Input fee" right after Latency (desktop `.cmp-grid` + mobile `.cmp-mobile-stack`, ⓘ tooltip in the Audit-success pattern). The fee is NOT in the DB or `/api/mints/known`; it comes from the existing on-demand probe (`GET /api/mint/probe` → live `/v1/keysets`, the same `data.keysets` Mint Detail's Keysets panel reads) via a dedicated `useQueries` entry (`['mint','compare-probe',url]`, `probeMint`, no IndexedDB history write — unlike `useMintProbe`). `pickInputFee()` (`utils/mintProbeDisplay.ts`) takes the ACTIVE keyset(s) of the primary unit (`sat` if present, else the first active keyset's unit); if several active keysets of that unit disagree the range is shown ("0–100 ppk"); formatting reuses `formatKeysetFee` (`free` / `N ppk`) + a muted unit suffix; "n/a" when keysets are unknown/no active keyset reports `input_fee_ppk` (incl. offline mints), "…" while loading. Cost: one extra probe per compared mint (≤4) when the modal opens. Tests: `pickInputFee.test.ts`, `e2e/compare-input-fee.spec.ts`.
- `ComparisonModal` also renders a Community Rating row (★ badge, "—" fallback when no reviews)
  and a shield-badge Reliability Score (see "Reliability Score vs Community Rating" above) — added 2026-09-03.

## Watchlist changes (2026-09-04/05)

- **Filters + sort row removed entirely.** Watchlist previously had its own local
  filter/sort UI (duplicating the Dashboard's NUT/status/reliability filter panel); that logic was
  local-only (no relay/DB dependency) and was deleted outright, not hidden — `Watchlist.tsx`
  no longer imports `NUT_FILTER_KEYS` or renders a filter panel. Dashboard's own filter/sort
  is unaffected.
- **Logged-out and empty-state copy rewritten.** Logged-out gate (`profile === null`):
  "Log in with Nostr to sync your watchlist across devices and get a message when a mint
  goes offline or comes back online." Empty watchlist (logged in, zero mints): "No mints
  watched yet" / "Add mints from the Dashboard with + Watch. Your list syncs over Nostr -
  you'll get alerts if status changes." with a "Go to Dashboard" CTA.
- **`+Watch` without being logged in (`MintDetail.tsx`)** now shows a confirm modal
  (`showWatchLoginModal` state, `rv-modal-overlay`) — "Login via Nostr" / "Cancel", closable
  via Escape — instead of the watch action silently no-op-ing or the button being hidden.
- **Empty-state gate uses `syncStatus`, not `knownLoading` (2026-09-05).** The watchlist
  page's skeleton-vs-empty decision is `knownLoading || syncStatus === 'pending'` — pulling
  the `WatchlistSyncStatus` (`'pending' | 'done' | 'error'`) from `useWatchlistStore` — so the
  "No mints watched yet" empty state can no longer flash before the Nostr sync has actually
  finished (previously gated on `knownLoading` alone, which settles as soon as `/api/mints/known`
  responds, well before `useWatchlistSync` resolves the user's real list). `syncStatus === 'error'`
  additionally renders a `.wl-sync-error-banner` ("Couldn't sync with Nostr relays...").

## Stats Page Layout (as of 2026-09-12, commits `f4e92ec`/`c3523db` — supersedes the old 3-column `.stats-cards-grid`-only layout below)

**`.stats-hero-grid`** — an always-2-column grid (`grid-template-columns: 1fr 1fr`, 1 column at
≤768px), holding exactly 4 panels in DOM order **Software in Use → Most Reliable → Geographic
Distribution → Network Health Index** (this order is also the mobile single-column stack order —
reordering the JSX reorders both, there's no separate mobile-only rule). `align-items: stretch` so
each row's two panels match the taller one's height. Each panel title carries a small muted
**icon well** (`.stats-panel-icon`, green/orange/gray — same recipe as Dashboard's `.stat-icon`):
`IcSwLayers` (gray) for Software in Use, `IcShield` (green) for Most Reliable, `IcGeoGlobe` (gray)
for Geographic Distribution, `IcHealthPulse` (orange) for Network Health Index. Most Reliable rows
also show the mint's city when `serverLocation` is already known (no new data source). This
replaced the older `.stats-left-col` (Software + Geo, 2 cols) / `.stats-right-col` (Most Reliable +
Reliability Score Trend stacked, `grid-row: span 2`) split described lower in this section, which was a
4-across row at the top of the page — the "Network Health Index — final layout" history below is
now itself superseded (NHI moved out of `.stats-right-col` into this hero grid).

- **`.stats-cards-grid`** (below the hero grid, unchanged in kind but now holds fewer panels) —
  4-column grid (2 cols ≤1300px, 1 col ≤768px) holding **only** NUT Coverage Across the Network
  (`grid-column: span 3`, 2 cols ≤1300px), Reliability Score Movers (`span 1`), and Reliability Score Trend
  (always full width `1 / -1`). The 2×2 hero panels moved out of this grid entirely into
  `.stats-hero-grid` above.
- **Software in Use subtitle (`c3523db`):** "Behind current release" → **"% of tracked mints
  behind latest release"**, shown under the panel title. The 75% `swFreshnessSummary.pct`
  bar/value and the methodology (i) tooltip text are unchanged (see "Stats widgets — 2026-09-08
  changes" below for that tooltip's own history).
- **Network Health Index donut (`c3523db`):** desktop gauge enlarged **84px → 112px** (~1.33x,
  filling empty space the panel already had next to the legend); number font scaled to match.
  Legend position, breakdown-bar placement, mobile gauge size, and the score formula are
  unchanged. Uses the shared `reliabilityDonutArc()` geometry helper — see that section above.

### Network Health Index — pre-hero-grid layout history (commit 92c28d8, several iterations; superseded 2026-09-12 by the `.stats-hero-grid` restructure above)

Before the 2×2 hero grid, NHI went through multiple repositioning attempts:
- Landed in its own panel in `.stats-right-col`, stacked between "Most Reliable" and "Reliability Score
  Trend" — not merged with either.
- **Rejected earlier attempt:** living inside the left 3-column block alongside Software in Use +
  Geographic Distribution. Reverted.
- Card format (horizontal — ring on the left, badge on the right) and `align-items: start`/
  `stretch` reasoning carried forward into the current hero-grid panel.

**Lesson learned:** when a layout "looks different" or "looks empty" mid-iteration, ask immediately for a `getComputedStyle`/pixel probe instead of judging from a screenshot — visual estimation on this task burned several unnecessary rounds before the probe was requested.

### Stats widgets — 2026-09-08 changes (commits `f2b25ff` / `781617d`)

- **`displayName()` everywhere** (`f2b25ff`) — Most Reliable, Reliability Score Movers, software
  drilldown, geo modal and NUT-support modal now render mint titles via the shared
  `displayName()` denylist fallback instead of raw `info.name`, so `"Cashu mint"` etc. fall
  back to the hostname (matches the Dashboard cards).
- **Header tile subtitles** (`f2b25ff`) — "Mints Tracked"/"Online Now" get "all known"/"of all
  known"; median latency notes "from Frankfurt". Avg mint uptime subtitle: `f2b25ff` set it to
  "across all known (offline pulls it down)"; `781617d` trimmed the parenthetical → **"across
  all known"**.
- **NHI "Online mints" row tooltip** (`f2b25ff`) — now explicitly says `"<n>/30 are NHI points
  (this row is 30% of the index), not <n> mints online. Dashboard listed/online counts are a
  different set."` so it can't be confused with the Dashboard's online headcount. The
  panel-level ⓘ makes the same point.
- **Most Reliable list excludes `isTestMint()`** (`781617d`) — `top5ByUptime` filters them out.
  (An earlier pass, `f2b25ff`, only *badged* them here; `781617d` actually excludes them from
  the Reliable list.) **Superseded 2026-09-19 (audit run-3 MEDIUM finding):** the Reliability tab
  (`top5ByReliability`) previously had **no test-mint exclusion at all** — a gap versus both
  `top5ByUptime` above and the backend's own `top5ByReliabilityScore` (`backend/src/index.ts`, which
  always had `!isTestMint()`). `top5ByReliability` now filters `!isTestMint(m.url)` too, and the
  🧪 Test badge that used to render in its row markup was removed as dead code (it can never
  fire once test mints are filtered out of the list feeding it). See "Recommendation-surface
  minimum age gate" below for the companion fix landed in the same pass.
- **Geographic Distribution — "CDN / anycast" bucket** (`781617d`) — `normalizeGeoLoc()` +
  `CDN_BUCKET` in `src/utils/geoDistribution.ts`: a `serverLocation` matching
  `cloudflare|cdn|aws|amazon|anycast|akamai|fastly|gcp|google cloud|azure|edgecast|bunny|stackpath|cloudfront`
  (case-insensitive) collapses to one **"CDN / anycast"** row (counts merged in
  `computeGeoDistribution`; `Stats.geoLabel` + the `cityMints` modal filter also normalize).
  **The GeoIP lookup / backend is unchanged** — this is display/aggregation only.
- **Movers + Most Reliable rows** (`781617d`) — the hostname subtitle `<div>` is omitted when
  `displayName === hostname` (same rule as the mint cards).
- **Software in Use panel** (`781617d`) — "Running outdated or older versions" →
  "Behind current release" + a `.stats-sw-behind-info` (i): "we compare the version each
  mint reports to the latest known release for that implementation — not a CVE or security
  score." **Superseded 2026-09-12 (`c3523db`):** the subtitle text itself was changed again, to
  **"% of tracked mints behind latest release"** — see "Stats Page Layout" above. The (i)
  tooltip content and **the 75% `swFreshnessSummary.pct` formula are unchanged.**
- Tests: `e2e/stats-widgets.spec.ts`, `e2e/stats-nhi-gauge.spec.ts`,
  `src/__tests__/geoDistribution.test.ts` (`normalizeGeoLoc`).

## Mint counts — single helper, archived included (2026-09-30)

**Supersedes the "archived excluded" rule and the "Online X/Y (Y = non-degraded)" wording below.**
`src/utils/mintCounts.ts` (`trackedCount`, `onlineCount`, `isPoolHidden`, `hiddenByDefaultCount`;
tests `src/__tests__/mintCounts.test.ts`, `e2e/mint-counts.spec.ts`) is the one definition used by
Dashboard and Stats. **"Tracked" = every mint in the DB, archived included** (= `/api/stats` `totalMints`
= `/api/mints/known` length; the public API is unchanged and the UI says what it says).
- Dashboard header: `<online> online mints` · `<tracked> tracked mints`; grid footer
  "Showing X of <tracked>" (the Filters panel shows the same numbers on its "Show X of <tracked>" button, for the draft); Stats "Mints Tracked" / "Online Now" use the same helper.
- Banner "N mints hidden (offline 24h+)": N = mints the default view hides, computed from the Status radio
  only (online → every non-online mint: degraded + archived + <24h offline; all → nothing (2026-10-01: All = every tracked mint, "Show 76 of 76", no banner);
  offline → banner hidden). The wording "(offline 24h+)" is deliberately kept although the set also holds
  <24h-offline mints; the degraded rule is untouched. Reliability slider / Hide test mints / search never change N.
- **Show now reveals ALL hidden mints** (was: degraded only), so the footer reads "Showing <tracked> of <tracked>".
  Archived cards then appear in the grid with no "Archived" label. Status=Offline also includes archived mints.
- Compare candidates and Watchlist recommendations filter `online === true`, so archived mints never enter them.

## Dashboard Mint Count Distinction (deliberate product decision — 2026-06-20; partly superseded, see above)

The Dashboard stat bar intentionally shows TWO different denominators that represent TWO different concepts:

- **"ONLINE MINTS X/Y" denominator** — "active" mints only (excludes mints that have been offline for 24h+, which are hidden from the grid by default behind a "N mints hidden (offline 24h+) — Show" toggle). Matches what's visible in the grid.
- **"KNOWN MINTS"** — absolute total mint count across the whole system (same source as Stats page "MINTS TRACKED", same as `rows.length` from `/api/stats`). Includes long-offline mints.

These are intentionally different numbers (e.g. "ONLINE MINTS 50/69" vs "ALL KNOWN 88"). "Online X/Y" (Y = non-degraded) and "All Known" (the full set) are still a deliberate distinction — do NOT "fix" that.

The grid's default behavior of hiding 24h+ offline mints is intentional decluttering. The footer shows: "Showing X of N" (`.grid-showing-note`) + a separate "N mints hidden (offline 24h+) — Show" note.

**Single source of truth for the total (2026-09-08, commit `03f1aeb`):** the Dashboard used to
merge `useNostrMints()` — a *live client-side* kind:38172 discovery query — into `allMints` and
the footer total, which produced a real mismatch (**footer "of 102" vs "All Known" tile / Stats
"94"**). Those extra URLs were raw Nostr announcements the backend had **rejected** via
`isValidCashuMint()` in `/api/mints/discover` — not tracked mints. `useNostrMints` was removed
from Dashboard entirely (`useNostrDiscovery()`, which POSTs new URLs to `/api/mints/discover`
for backend validation, stays). Now **`knownTotal = knownMintsData?.length ?? 0`** is the one
number behind the "All Known" tile *and* the grid footer's "of N" — and it already equals
`/api/stats.totalMints` server-side (both are an unfiltered `SELECT … FROM mints`, locked by
`integration/known-count-consistency.test.ts`). The footer now always reads "Showing `<shown>`
of `<knownTotal>`" regardless of filters/hiding. `useNostrMints.ts` / `mintDiscovery.ts` are now
a dead chain (left in place, not deleted).

### Dashboard filter bugs (fixed)

- **Reset button (↻):** previously only did `queryClient.invalidateQueries` (refetched data) without resetting search/sort/filters/`showDegraded`. Fixed — now resets everything to default (search cleared, sort **`reliability`/`desc`** — updated 2026-09-09 from the original `name`/`asc`, see "Dashboard default view" below — `activeFilters`/`pendingFilters` → `DEFAULT_FILTERS`, `showDegraded=false`, closes filter panel) and only then refetches.
- **Status=Offline filter returning empty results:** root cause — `allMints` was computed by hiding degraded mints via `showDegraded` *before* `applyFilters()` ran, so Status=Offline and the default `showDegraded=false` behaved like an AND and cancelled each other out. Fix: `effectiveShowDegraded = showDegraded || activeFilters.status === 'offline'` — explicitly picking the Offline filter now overrides the default hiding. The "N mints hidden" message only shows when the Status filter isn't "Offline" (otherwise it would be misleading).
- File: `Dashboard.tsx`
- **Status "All" showed only the online-pool (2026-10-01):** clicking All in the Filters panel left "Show 51 of 76" and the "25 mints hidden" banner, because the pool still stripped degraded (24h+ offline) + archived mints for every status except Offline. Pointer/overlay was NOT the cause (the radio under the pointer is the real input; same behaviour before the panel redesign). Fix: `poolForStatus()` / `revealsHiddenMints()` in `src/utils/mintCounts.ts` — All and Offline both reveal the whole tracked set, only Online (with "Show" off) strips it; used by both the grid pool and the panel's `draftCount`. All = every tracked mint (incl. test mints unless Hide test mints is ticked), `?status=all`.

Verified: typecheck ✅, build ✅, 70/70 unit tests ✅, Playwright confirmed both scenarios (Status=Offline shows offline mints including 24h+; Reset restores default state).

### Dashboard controls row (2026-09-05)

- **"Most reviewed" sort** — a 5th sort button (`sortBy: 'reviewCount'`), placed before
  Rating, ordering mints by `reviewCount` descending; mints with `reviewCount` 0 or `null`
  always sort last regardless of direction toggle. Same `reviewCount ?? 0`-last convention
  used for tie-breaking as the weighted-rating sort (see "Rating sort uses a weighted/Bayesian
  rating" above). e2e coverage in `e2e/dashboard.spec.ts`.
- **Floating controls row** — the single shared border+background box that used to wrap
  search/Filters/sort/view-toggle/Submit-mint as one bar was removed. Each control group now
  floats independently with its own border/background (`.search-input`, `.filter-btn`,
  `.sort-segment`, `.view-toggle`, `.submit-btn`, `.refresh-btn`), matching the `.stat-card`
  row's visual pattern above it — `.dashboard-controls` itself carries no border/background
  anymore.
- **New `900px` breakpoint** (separate from the general `768px` one) — adding the 5th sort
  button meant the row no longer fit on one line as far up as ~900px; above 768px the
  search+Filters pairing is still desktop-style, so this breakpoint only wraps the row and
  shrinks the sort buttons rather than restructuring search/Filters like the 768px block does.
- **Search + Filters one row on phones (2026-09-30):** at ≤768px `.controls-search-line` is a nowrap flex row; search takes leftover width (`min-width: 140px`), Filters stays content-sized with its label. Applies at 320px too. Watchlist does not share this toolbar. 901–1000px rule unchanged.
- **Stats hero notes (2026-09-30):** `.stats-metrics .stat-note` may wrap so "of all known" / "active mints" / "from Frankfurt" stay inside the tile when the five-up row shrinks (~1140px). Labels and counts unchanged.

### Dashboard filter panel — Mint age removed (2026-09-08, commit `c02bdac`)

The **"Mint age" (Fresh/Established/Veteran/OG) filter block is gone** — the whole state chain
was removed: `FilterState.mintAges`, `AGE_LABELS`, the `applyFilters` branch,
`countActiveFilters` term, the `?age=` URL param + its filter-tag chip, and the panel group.
At the time, the panel became just **Status** + **Min. Reliability Score**. Rationale: those four labels
stopped being a product concept once the card badge set shrank (see "Card badges" above). On
mobile the two remaining groups sit side by side (`.filter-row` → `row / nowrap`) so the sheet is
shorter. **Superseded 2026-09-10 (`26c4111`):** the separate Capabilities (Restore/Bolt12/LN)
group was also dropped and a **"Hide test mints"** checkbox was added — see "Dashboard default
view + Capabilities filters removed" above for the panel's current, up-to-date contents.
`requiredNuts` filter state is left in place but is URL-only (`?nuts=`), no panel UI.

### Dashboard unit filter (2026-10-01)

Filters panel has a multi-select **Unit** chip group (SAT / USD / EUR, `.filter-unit-chip` + `.filter-seg-opt`, `aria-pressed`; 44px hit area on touch — see "Filters panel layout" below). `FilterState.units` (default `[]`) follows the same draft → Apply / Reset / filter-badge (+1 when non-empty) / dismissible "Unit: …" tag / "Show N of M" button pattern as Reliability; the hidden-mints banner stays Status-only. Helpers are pure and live in `src/utils/unitFilter.ts`: `mintMatchesUnits` (empty = no filtering; a mint passes if it advertises ≥1 selected unit, case-insensitive on `KnownMint.units`; `null`/other units like `msat` never match an active filter), `parseUnitParam`/`buildUnitParam`. URL: `?unit=sat,usd` — whitelist `sat|usd|eur`, case-insensitive on read, canonical order + de-duplicated on write, param omitted when empty. Live data 2026-10-01 (76 mints): sat 60, usd 7, eur 1, msat 1, `units: null` 16 (units not yet probed); no `auth`. Best Mint wizard (`Tools.tsx`) derives its unit list independently from online mints' raw units and is unchanged. Tests: `src/__tests__/unitFilter.test.ts`, `e2e/dashboard-unit-filter.spec.ts`.

### Dashboard default view + Capabilities filters removed (2026-09-09/10, commits `6bd10ce`/`091231e`/`26c4111`)

**Current defaults** (`DEFAULT_FILTERS` in `Dashboard.tsx`): `status: 'online'`, `minReliabilityScore: 0`,
`requiredNuts: []`, **`hideTestMints: false`** — plus sort **`reliability`/`desc`** (not part of
`FilterState`, held as separate `sortBy`/`sortDir` state). A fresh Dashboard load therefore shows
online mints only, sorted by Reliability Score descending, **with test mints visible** (they still carry
a "Test mint" badge; `?testmints=hide` only appears once the user turns the checkbox on).

This landed in two passes that briefly disagreed with each other — worth knowing if an older note
or commit message says otherwise:
- `6bd10ce` (2026-09-09) set the new online-only + Reliability-sort default **and** defaulted
  `hideTestMints` to `true` ("no test mints"). This is the change that lifted the original
  Name-sort freeze from earlier design passes.
- `091231e` (2026-09-10) flipped `hideTestMints` back to `false` ("show test mints by default")
  as part of a hero-tile/filter-bar pass — this is the value in the code today. Only the
  test-mint-visibility default was reverted; online-only status and Reliability-desc sort from `6bd10ce`
  are unchanged.
- `26c4111` (2026-09-10) separately **removed the Capabilities filter group** (Restore / Bolt12 /
  LN checkboxes) — `FilterState` never had a `capabilities` field distinct from `requiredNuts`;
  this removed a different, since-deleted filter block. The panel is now **Status + Min. Reliability
  Score + a "Hide test mints" checkbox** (Mint age was already gone, see the section below). Same
  commit also made a NUT row on the Stats "NUT Coverage Across the Network" panel open a
  `NutMintsModal` listing the mints supporting that NUT, instead of (or in addition to) any
  Dashboard filter deep-link.

### Filters panel layout (2026-10-01)
One layout for every width, `.filter-bar` = flex-wrap (Dashboard.tsx / Dashboard.css). Children in order: **Status** `.filter-field` = plain-text `.filter-field-label` (id `filter-status-label`; mono 10px uppercase `--text3` like the Reliability label, no fill/border/divider, `cursor:default`, not focusable, fixed width shared with the Unit label so both controls start at the same left edge) + `.filter-seg` (`role="radiogroup" aria-labelledby`, native `input[type=radio] name="filter-status"` inside each `label.filter-seg-opt`, input is `opacity:0` + `inset:0` so it stays focusable/arrow-key native; selected = `.active` + patina tint), **Unit** `.filter-field` (label id `filter-unit-label`) + `.filter-seg` (`role="group" aria-labelledby`, buttons keep `.filter-unit-chip[data-unit]` + `aria-pressed`), **Reliability** `.filter-rel` (label `RELIABILITY ≥ N%` with a `4ch` min-width value + the unchanged range input), **`.filter-footer`** = `Hide test mints` checkbox (`.filter-check`) + `.filter-actions-row` (Reset · primary **"Show N of M"**). **Option look (2026-10-01):** the segmented control is a button row — 1px `--border-strong` frame (`::after` overlay so options stay 36px), each option filled `--surface-3` with `--border2` dividers, hover (`@media (hover:hover)`) = lighter overlay + `--border-strong` inset border, `:active` = `--surface-2`, focus-visible = 2px `--accent` outline offset 2px (z-index 1), selected = accent-dim tint over the raised fill + `--accent` text + inset `--accent-brd` border. One row fits down to 1125px (was 1140); panel heights unchanged (56 wide / 100 tablet / 176 at 390 / 220 at 320); no label-above fallback needed down to 320px.
- The segmented control mirrors `.wizard-unit-seg` (Tools): 36px visible (the 1px frame is a `::after` overlay so the segments inside are the full 36px), 44px touch target via an invisible `::before` (`@media (pointer: coarse), (max-width: 600px)`; Reset has a border so its `::before` is -5px), hover only under `@media (hover: hover)`. Mobile rows are 8px apart so the 4px extensions of neighbouring rows meet instead of overlapping.
- **"Show N of M"** replaced both the old `Apply filter` button text and the separate `Showing N of M` line. It commits the draft exactly like the old button (state + URL, panel closes, scroll to top). `N` = `draftCount`, a `useMemo` over the same pure `applyFilters` + pool chain as `filteredMints` but fed with the **draft** (`pendingFilters`) — the old line used the *committed* `activeFilters`, so it did not follow the draft; both agree whenever draft == committed. Only computed while the panel is open. `M` = `knownTotal`. `aria-label="Show N of M mints"`, deliberately **no `aria-live`** (every slider step would be announced). `font-variant-numeric: tabular-nums` + `min-width: calc(15ch + 24px)` so the width never changes with the count. N = 0 keeps the button enabled (applies an empty result, as before).
- Panel edges: `width: calc(100% - 2 * var(--page-pad))` (max `--dash-chrome-max` − 2·pad), so below the chrome max it is inset like the Search row and cards (it used to run edge to edge on phones).
- Measured thresholds (cards view, 12 mints): wide row (56px) from ≈1135px; below that the footer wraps to a 2nd line (100px). Mobile (≤600px): 174–176px at 361–600px (Status, Unit, Reliability, footer rows); footer fits one row down to **360px**; at ≤359px the checkbox gets its own row and Reset + Show share the next (≈220px).
- Tests: `e2e/dashboard-filters-panel.spec.ts` (radio click/arrows, unit multi-select, live count, Reset, edges at 390/1440, no overflow 320–1920, heights, 36px, coarse-pointer hit areas), `e2e/dashboard-unit-filter.spec.ts`, `e2e/mint-counts.spec.ts`.
