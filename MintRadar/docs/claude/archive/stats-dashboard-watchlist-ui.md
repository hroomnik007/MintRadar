# Archive of stats-dashboard-watchlist-ui.md
> History only: sections moved out of `docs/claude/stats-dashboard-watchlist-ui.md` because they describe superseded or removed behaviour. Do not read this for current rules.

### Dashboard filter bugs (fixed)

- **Reset button (↻):** previously only did `queryClient.invalidateQueries` (refetched data) without resetting search/sort/filters/`showDegraded`. Fixed — now resets everything to default (search cleared, sort **`reliability`/`desc`** — updated 2026-09-09 from the original `name`/`asc`, see "Dashboard default view" below — `activeFilters`/`pendingFilters` → `DEFAULT_FILTERS`, `showDegraded=false`, closes filter panel) and only then refetches.
- **Status=Offline filter returning empty results:** root cause — `allMints` was computed by hiding degraded mints via `showDegraded` *before* `applyFilters()` ran, so Status=Offline and the default `showDegraded=false` behaved like an AND and cancelled each other out. Fix: `effectiveShowDegraded = showDegraded || activeFilters.status === 'offline'` — explicitly picking the Offline filter now overrides the default hiding. The "N mints hidden" message only shows when the Status filter isn't "Offline" (otherwise it would be misleading).
- File: `Dashboard.tsx`
- **Status "All" showed only the online-pool (2026-10-01):** clicking All in the Filters panel left "Show 51 of 76" and the "25 mints hidden" banner, because the pool still stripped degraded (24h+ offline) + archived mints for every status except Offline. Pointer/overlay was NOT the cause (the radio under the pointer is the real input; same behaviour before the panel redesign). Fix: `poolForStatus()` / `revealsHiddenMints()` in `src/utils/mintCounts.ts` — All and Offline both reveal the whole tracked set, only Online (with "Show" off) strips it; used by both the grid pool and the panel's `draftCount`. All = every tracked mint (incl. test mints unless Hide test mints is ticked), `?status=all`.

Verified: typecheck ✅, build ✅, unit tests ✅ (counts: "Test suites" in CLAUDE.md), Playwright confirmed both scenarios (Status=Offline shows offline mints including 24h+; Reset restores default state).

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
