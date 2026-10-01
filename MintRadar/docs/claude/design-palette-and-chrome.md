# MintRadar — Patina/Copper palette, typography, cross-page chrome width (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Cross-page chrome width unification — `--dash-chrome-max` (2026-09-11)

A same-day wave of CSS-only refactors made every "dashboard-chrome" page (Stats, Watchlist,
Tools, Learn, Wallets) share Dashboard's content column width, so a card grid's left edge lines
up across pages instead of each page picking its own width independently.

**1) What `--dash-chrome-max` is and where it's defined**

`src/index.css` (`:root`, alongside `--page-pad`):
```css
--dash-chrome-max: calc(300px * 4 + 16px * 3 + var(--page-pad) * 2);
```
i.e. 4 cards at their 300px max width + 3× 16px inter-card gaps + the two `--page-pad` side
gutters (border-box, so the gutters are included in the cap, not added on top). It's the single
source of truth for "the page-content shell width used by every dashboard-chrome page" — any page
whose card grid should left-align with Dashboard's `.mint-grid` uses this exact `max-width`
(with `margin-inline: auto` + `padding-inline: var(--page-pad)`, or the equivalent) so the first
card's left edge lines up across pages. It moved here from being locally duplicated on
`.dashboard` and `.watchlist-page` (commit `6222f29`) specifically so Learn/Wallets could adopt
the identical value without a second copy drifting out of sync.

**2) Which pages/components use it now**

`Dashboard.css` (`.stats-bar`, `.dashboard-controls`-adjacent chrome, `.mint-grid`, plus a
`calc(var(--dash-chrome-max) - var(--page-pad) * 2)` variant for one inner panel that needs the
box width *without* re-adding the gutters), `Watchlist.css` (`.wl-body-two-col`/`.wl-controls`/
`.wl-grid`), `Stats.css` (`.stats-metrics` hero row, `.stats-hero-grid`, `.stats-cards-grid`),
`Tools.css` (`.tools-grid`), `Learn.css` (index header + card grid) and `LearnModule.css`
(article pages, so index → module navigation doesn't shift content width), and `Wallets.css`
(header, card grid, "Run your own mint" block) — three separate `max-width: var(--dash-chrome-max)`
declarations there for its three content blocks. Decorative full-bleed bands (`.learn-hero`,
`.wallets-hero`, `.stats-header`, the site nav) are deliberately **not** capped — only content
columns that hold card grids or controls are.

**3) State before this wave**

Each page defined its own width independently, so first-card left edges did not line up across
pages: `.dashboard`/`.watchlist-page` each hardcoded their own copy of the same 4-card formula
(already identical in value, just duplicated); Stats' hero tile row and panel grids, Tools'
`.tools-grid`, Learn's index/module pages, and Wallets had no shared cap at all — some were wider/
full-bleed with more empty space around fewer cards (explicitly called out for Watchlist's old
grid in `20275db`), and Watchlist's card grid additionally centered itself independently inside
its flex column rather than sharing one width-capped box with the rest of the page (`18482fc`).
Landing order: `20275db` (Watchlist grid width/gap only) → `18482fc` (Watchlist's whole content
column, not just the grid) → `6222f29` (lifts the token onto `:root`, applies to Learn/Wallets/
Watchlist) → `32bbe47` (Tools + Stats) → `a688aee` (caps the Stats-page-style `.stats-bar` hero
row specifically, matching `.mint-grid`/`.dashboard-controls`) → `fcea79e`/`1dd9cba` (Stats panels
reuse Dashboard's actual card classes/tokens, not just the same outer width — see below).

- **`fcea79e`** — Stats' 5 hero tiles (Mints Tracked / Online Now / Avg mint uptime 24h / Median
  Latency / NUTs in Spec — no tile added/removed) switched from Stats' own `.stats-metric-card`/
  `.smc-*` rules to Dashboard's actual `.stat-card`/`.stat-label`/`.stat-row`/`.stat-icon`/
  `.stat-figure`/`.stat-value`/`.stat-note`/`.stat-unit` classes, so they match Dashboard's stat
  cards pixel-for-pixel (height, padding, radius, border, icon-well fills). The uptime tile keeps
  its own dynamic `uptimeColor()` value and its (i) tooltip trigger (`.smc-label-info`) as the one
  Stats-only addition on top of the shared classes.
- **`1dd9cba`** — Stats' panel chrome (`.stats-panel`, `.stats-nut-rows-grid`) switched from a
  hardcoded 10px-radius recipe to the same literal tokens `.mint-card`/`.stat-card` use
  (`var(--surface)`, `var(--border)`, `var(--r)`); `.stats-panel-title` now matches Dashboard's
  `.stat-label` typography (10px uppercase, 0.1em tracking, `var(--text-dim)`/`--t2`, body font)
  instead of its own 12px/mono heading style; the Software-in-Use row chrome (`.sw-row`) now
  shares Most Reliable/Movers' `.stats-top5-row` border+radius recipe, unifying all 3 inner
  list-row types onto one chrome. Also **dropped the green/copper alternating decorative bar
  colors** on Software in Use and Geographic Distribution (forced to one mint-green fill,
  `!important` over the per-row inline color `Stats.tsx` computes) — NUT Coverage's adoption
  bars, the "Behind current release" freshness bar, and Reliability Score Movers' up/down deltas are
  untouched since those colors are real signal, not decoration. No formula/NHI/modal changes.

**4) Geographic Distribution refactors (`6812cf9` / `d87e462` / `360f285` / `59a3984`)**

Four passes, same day, landing in this order:
- **`6812cf9` — two-column layout, show all current locations.** `geoDist.top` now renders as
  two `.stats-geo-cols` CSS-grid columns (`grid-auto-flow: column`, column 1 fills top-to-bottom
  before column 2, same sort order as before); `Stats.tsx` computes `geoRows = ceil(top.length/2)`
  as the explicit `grid-template-rows` so both columns balance evenly. `computeGeoDistribution`'s
  `topN` argument went **10 → 20** — two 10-row columns keep the panel at its old single-column
  height while covering essentially every distinct location the network currently has, so "View
  others" drops out on its own once everything fits (its gating condition is unchanged). New
  480px breakpoint reverts to one column on narrow phones. `geoLabel()`/`CDN_BUCKET` grouping and
  `computeGeoDistribution`'s own default/unit tests are untouched — only this call site's `topN`.
- **`d87e462` — adoption/coverage bars removed.** Geographic Distribution rows dropped their
  `.dist-track`/`.dist-fill` progress bar entirely, keeping just the city/label and count (the
  per-row `barColor`/`pct`/`idx` that only fed the bar are gone from the row map). `geoColor`
  (used for the label's own text color) is unchanged. The same commit also removed NUT Coverage's
  adoption bar (`.snr-bar-track`/`.snr-bar-fill`) — kept the chip/name/`"N/N"` count, whose color
  still tracks the adoption ratio (`barColor` logic unchanged, just no bar to paint); the row grid
  columns collapse accordingly. Software in Use's own bars (and the "Behind current release" bar)
  are untouched — those classes are still used there, just no longer by Geographic Distribution.
- **`360f285` — city-label ellipsis-cut fix.** Two-layer bug: (1) JS — `shortenCity()` in
  `Stats.tsx` was slicing any city name over 12 chars to 11 chars + `…` **before** it reached the
  DOM, so no amount of CSS could undo the already-truncated string; the length-based cut was
  removed (the deliberate `CITY_SHORT` renames — `"Frankfurt am Main"` → `"Frankfurt"`, `"Saint
  Petersburg"` → `"St. Petersburg"` — are kept, those aren't truncation). (2) CSS —
  `.dist-label-city` now overrides the base `.dist-label`'s nowrap/ellipsis with
  `white-space: normal` + `overflow-wrap: break-word` so a full name can wrap onto a second line;
  scoped to `.dist-label-city` only, Software in Use's plain `.dist-label` keeps single-line
  truncation. `.dist-row` also gained `min-width: 0` — inside `.stats-geo-cols`' grid columns, a
  grid item's implicit `min-width: auto` otherwise lets an unbroken long word blow out the column
  regardless of `overflow-wrap`.
- **`59a3984` — responsive row cap.** Desktop (>700px) unchanged (`topN=20`, two columns).
  Mobile (≤700px) is now capped to the **top 5** locations in a single column (same
  `computeGeoDistribution` `topN` param, no aggregation change) — previously mobile inherited the
  desktop `topN=20` list, producing 10–20 stacked rows on a phone; "View others" now opens the
  same `MoreLocationsModal` with whatever didn't make the cut. New `useMediaQuery(query)` in
  `useIsMobile.ts` (`useIsMobile` is now a thin wrapper over it) lets this panel use its own
  **700px** breakpoint instead of the app's standard 768px; `.stats-geo-cols`' single-column
  media query was widened from 480px to the same 700px to match.

**5) Typographic passes (`2f7eb8e` / `afca9f5`)**

- **`2f7eb8e` — mint card Reliability Score / rating type sizes.** `.card-reliability-score`: 25px → 27px
  desktop, 26px at the existing ≤600px breakpoint. `.card-reliability-rating`: 12px → 14px, and gained
  `font-weight: 500` (was unset/400). Latency block, card name, and `.card-pills` untouched — see
  "MintCard Reliability block" above for where `.card-reliability` itself lives on the card.
  **2026-09-19 follow-up:** `.card-reliability-star` (the ★ glyph itself, next to `.card-reliability-rating`'s
  number) was still 13px — small enough on desktop to read as an afterthought next to the bumped
  rating number beside it — bumped to 16px.
- **`afca9f5` — Tools/Stats "larger, more legible list rows" pass.** Tools page: `.tool-title`
  (card titles — "Token Inspector" / "Best Mint for Me") 12px `var(--text2)` → **16px**
  `var(--text)` (uppercase/letter-spacing/mono kept, only size+color changed); `.tool-subtitle`
  11px `var(--text3)` → 13px `var(--text2)`; `.wizard-q` (wizard step questions) 14px → 16px.
  Stats list rows, 11–12px → **13px**: `.dist-label` (Geographic Distribution city names —
  Software in Use's own name span keeps its separate 13px inline override, so only the geo panel
  visibly changed here), `.snr-nut-name` (NUT Coverage row titles), the Most Reliable name div
  (both Reliable/Reliability tabs), Reliability Score Movers' name div (its hostname subtitle stays 10px).
  `.stats-panel-title` (section titles like "GEOGRAPHIC DISTRIBUTION") was already 10px uppercase
  and confirmed unchanged. Dashboard hero/explainer/mint cards untouched — no Dashboard files in
  this diff. Geographic names' wrap-not-truncate behavior (`360f285`, above) was verified to still
  hold at the new 13px size.

## Typography & Design System Notes

Self-hosted font weights (unchanged by the 2026-07-24 color redesign — see "Visual Redesign" section below):
- **DM Sans** — variable, weights 100–900; `--font-body`, `--font-display`, `--sans`
- **JetBrains Mono** — 400 Regular, 500 Medium, 700 Bold; `--font-mono` (non-numeric mono text: pubkeys, URLs, version strings). Bold was added in `public/fonts/JetBrainsMono-Bold.woff2` + `@font-face` because weight 700 previously triggered faux bold.
- **`--font-mono-data`** (new, 2026-07-24) — system `ui-monospace` stack (no webfont), used exclusively for numeric/data values (latency, %, NUT counts). See "Visual Redesign" section.

**Stat box padding** — Desktop: Dashboard `.stat-card` and Stats `.stats-metric-card` both use `14px 20px`. MintDetail `.md-sc` uses `12px 16px` intentionally (tighter layout, product decision — do not "unify" without confirmation). Mobile: Dashboard reduces to `10px 14px` at `≤600px`; Stats reduces to `10px 14px` at `≤700px`.

**Mint Info value rows** (MintDetail) — all value `<span>` elements use `.md-info-value` class only, with no inline color/weight/family overrides. Inline `color: var(--text2)` previously made bold text look dim. Full description keeps `style={{textAlign:'left', maxWidth:'none', lineHeight:1.5}}` for layout only.

**Text colors (as of 2026-07-24 redesign)** — `--text` (`#f2f7f4`) for primary/bold values, `--text2`/`--text-dim` (`#b7c8c0`) for secondary/muted, `--text3`/`--t3`/`--text-faint` (`#9aada4`) for tertiary labels. These replace the old DM Sans v2 values (`#F0F2F7`/`#8B90A0`/`#AAB4C7`). **2026-09-04:** `--t3` was `#86988f`, which measured only **4.03:1** on `--surface-card` (`#223a2f`, the mint-card background) — below the WCAG 2.1 AA 4.5:1 threshold for normal text, and `.card-host` / `.latency-label` / `.latency-value.muted` on every Dashboard/Watchlist mint card use it. Bumped to `#9aada4`: now 5.18:1 on `--surface-card`, 7.14:1 on `--bg`, 6.73:1 on `--surface`, 6.26:1 on `--elevated` — AA-clean on every real background. Still clearly the muted tier (L\* 0.39 vs `--t2` 0.55 / `--t1` 0.92).

## Visual Redesign — "Patina/Copper" Palette (2026-07-24)

**Why:** the original palette (pure `#000` background + full neon green) had low contrast on
secondary text and a "punk"/cheap look on buttons (solid color fill, large pill radius with
no subtlety). The new palette fixes both.

**Source of truth:** the design system now lives directly in code, not in a separate
mockup file. Colors/tokens are defined in `src/index.css` (see the CSS custom properties
listed below); component patterns are established by existing shared components (e.g.
`src/components/mint/MintCard.tsx`, `src/components/learn/KeyTakeaway.tsx`). Check those
before changing colors or introducing new component patterns.
(`mintradar_redesign_mockup.html`, previously kept at the repo root as a reference mockup
for this redesign, was deleted once the palette/components below landed in code — do not
recreate it or reference it as if it still exists.)

**New design tokens (`src/index.css`):**
- `--bg` / `--surface` / `--surface-2` / `--surface-3` — dark "verdigris/patina" green-gray instead of pure black (`--bg: #10201c`)
- `--text` / `--text-dim` / `--text-faint` — see Typography section above for exact values and contrast verification
- `--green` / `--green-bright` — muted "patina" green instead of neon (reference: patina on coins)
- `--copper` — new secondary accent (reference: coin minting); alternates with green on the Stats page's Software-in-Use and Geographic-Distribution bars
- `--amber`, `--red` — semantic colors (fresh/warning, offline/error)
- every color has a `-soft` and `-soft-strong` variant, used for tonal backgrounds/borders instead of solid fills (`--red-soft-strong` rgba(219,106,93,.3) added 2026-10-01 so red has the same trio as green/amber/copper)
- `--font-mono-data` — system `ui-monospace` stack for numeric values only (see Typography section)
- `--radius-m` (10px) — smaller radius for buttons, replacing the old large pill shape
- fonts remain 100% system/self-hosted — no Google Fonts, no external CDN, zero tracking

**Component changes:**
- Buttons (`Login via Nostr`, `Connect`, `+Submit mint`, `+Watch`, `Compare`) — solid neon fill → tonal outline style
- Dashboard mint cards — removed the per-status colored border/gradient (previously every card had a green-tinted border/background regardless of online/offline state); now a neutral border, with color reserved for the status dot and the reliability-score chip only
- Login modal — option cards (Nostr extension/nsec/Amber) get a green tonal border+background only when selected; the nsec security notice box changed from yellow to copper
- Reliability Score ring (Mint Detail) — fixed `--green-bright` ring color (no longer colored by score band), track `--surface-3` — the ring is now purely visual, the score band ("High/Moderate/Low Reliability") is still conveyed by the badge text below it
- `mintAgeBadge()` (`src/utils/mintFormatting.ts`) — Established badge → new tonal green, Fresh badge → copper/amber (was blue); Veteran/OG badges intentionally unchanged (out of scope). **Superseded 2026-09-08: the card no longer shows these badges at all — see "Card badges" below.**
- Stats page — progress bars alternate green/copper by row index instead of one fixed color for all

**Audit reliability score:** see the shared-module note under "Reliability Score calculation" above.

**Audit data source (resolved 2026-08-06):** `audit.8333.space`'s `GET /mints/` API (paginated,
100/page) returns cumulative lifetime counts for `n_mints`/`n_melts`/`n_errors` — these are kept
(as `audit_n_*`) purely for the display-only all-time line on the Audit tab. The Reliability Score's audit
component now matches the reference `pablof7z/cashu-mint-audit` project's approach: it uses a
rolling window of each mint's last ~100 swaps, fetched per-mint from `GET /swaps/mint/{id}`
(`audit_recent_total`/`audit_recent_errors`) — see "Discovery pipeline" above. A mint with fewer
than 3 recent swaps scores as "Unknown" (2.5, same neutral default as no audit data at all)
instead of a misleadingly precise error rate from a tiny sample.

**Manually added mint:** `mint.hanbitkorea.org` was found via an `audit.8333.space` cross-check
and was missing from the DB; added manually.

### Post-redesign fixes (commit 3af7e6f)

Follow-up fix commit addressing regressions/missed spots from the original redesign above:
- Nav bar (`AppShell.css`) — background changed from hardcoded `rgba(15,17,21,.92)` to `var(--bg)`, removing a visible "seam" against the page body
- Stats — Software in Use expand panel (`Stats.css`, `.sw-ver-panel`) — hardcoded `#0d1117` → `var(--surface-2)`
- Stats — Geographic Distribution modal (`Stats.tsx`, `CityMintsModal`) — rebuilt to match the Reliability Score/NUT modal pattern (flag+name+count chip+close header, status dot/name/badge/reliability % rows, footer summary); status dot and reliability colors moved to the new tokens, percentage uses `--font-mono-data`; functionality (click-through to detail, sorting) unchanged
- Mint Detail — "Show QR code" and "Copy" buttons (`MintDetail.tsx`) — solid neon fill → tonal outline, matching "Compare"/"+ Watch"
- Watchlist — Login button (`Watchlist.tsx`) — added ⚡ icon, now identical to the nav button

A before/after reference mockup for all 5 items (tab "Opravy") was included in this commit as `mintradar_redesign_mockup.html`; the file has since been deleted (design system fully landed in code — see "Visual Redesign" above), so this is historical context only, not a file that still exists in the repo.

Verified: typecheck, ESLint, 70/70 unit tests, production build all pass; visually confirmed via Playwright.

### Post-redesign fixes round 2 (commit f98694a)

- New shared component `src/components/mint/MintCard.tsx` — used by both Dashboard and Watchlist (Watchlist previously had its own, non-redesigned copy of the mint card). If the card style changes again, change only this file.
- Shared utilities moved into `mintFormatting.ts`: `mintAgeBadge`, `uptimeColor`, `formatTimeAgo` — Watchlist no longer has its own duplicate version.
- New design token `--surface-card` (slightly lighter than `--surface`) + `inset` top highlight on `.mint-card` — visually distinguishes mint cards from other panels.
- Watchlist CTA (empty state) — `.wl-add-btn` is a solid primary button (`var(--green)` fill), deliberately distinct from the smaller outline nav button (secondary vs. primary action).
- Offline/degraded mint cards — opacity 0.7, "Offline 24h+" badge, "Last seen" instead of latency. **Fixed 2026-09-19:** was reading `lastCheckedAt` (the last *probe* time — always recent, since the 5-min cron never stops probing an offline mint), which made a mint that's been down for days claim it was "seen" minutes ago. Now reads `lastOnlineAt` (`mints.last_online_at`, updated only on a successful probe — see `prober.ts`) — the genuine last-seen-online time — and falls back to **"Never seen online"** when that column is `null`. `lastCheckedAt` is unaffected everywhere else it's used (online cards, Audit tab).
- Mint Detail mobile header — compact version on the mobile breakpoint only (icon back button, online pill on the same row, Watch/Compare 50/50); desktop layout unchanged.
- "Show my latency" button unified with the others (tonal outline).
- "NIP-87" badge on Watchlist: purple → copper (`--copper`).

A before/after reference mockup for all items (tabs "Watchlist prihlásený", "Mint Detail mobil header", "Latency btn / Offline / Card elevation") was included in this commit as `mintradar_redesign_mockup.html`; the file has since been deleted (see "Visual Redesign" above), so this is historical context only, not a file that still exists in the repo.

Verified: typecheck, ESLint, 70/70 unit tests, production build all pass; visually confirmed via Playwright with mocked API (7 screenshots).

### Card elevation contrast fix (commit 9abda76)

The `--surface-card` token introduced in round 2 above was visually too subtle — on an actual screenshot it was nearly indistinguishable from `--bg`. Strengthened:
- `--surface-card`: `#1c2b25` → `#223a2f`
- `.mint-card` border: now `var(--border-strong)` directly (not just on `:hover`)
- Inset top highlight: opacity `.05` → `.07`

Applied automatically everywhere via the shared `MintCard.tsx` component (Dashboard and Watchlist both pick it up with no per-page changes needed) — see "MintCard.tsx — history" above for why that component being shared matters here.

### QR modal design fix + Mint Detail mobile header v2 (retry)

- QR "Add to wallet" modal — container hardcoded `#161b22`/`#30363d` → `var(--surface-2)`/`var(--border-strong)`; header icon replaced with `MintFavicon` directly; URL input → `var(--surface-3)`/`var(--border)`
- Mint Detail mobile header — finally implemented (it was prepared in an earlier prompt round but never actually shipped by mistake): back arrow (30px circle) on the same row as avatar/name/URL, status dot instead of a separate "Online" pill, age badge on the right. Desktop layout unchanged (new elements hidden outside `@media (max-width: 768px)`)
- Mobile stat tiles (Latency/Uptime/Version/NUTs) — at ≤768px the large icon is hidden, padding narrowed, value 15px/600 on `--font-mono-data`

## Token aliases + "semantic colours must be tokens" (2026-10-01)

**Alias map.** `src/index.css` keeps legacy names so old usages keep working, but since this change they are
`var(<canonical>)` references, not separate literals — edit the canonical token and every alias follows.
Do not add new usages of an alias; prefer the canonical name.

| Alias | → Canonical token |
|---|---|
| `--bg2` | `--surface` |
| `--bg3`, `--surface-2` | `--elevated` |
| `--bg4`, `--surface-3` | `--raised` |
| `--brd` | `--border` |
| `--brd-md` | `--border2` |
| `--brd-hi`, `--border-hi` | `--border-strong` |
| `--t1`, `--t2`, `--t3` | `--text`, `--text2`, `--text3` |
| `--text-dim`, `--text-faint` | `--text2`, `--text3` |
| `--green-bright`, `--fast` | `--accent` |
| `--accent-dim`, `--accent-brd` | `--green-soft`, `--green-soft-strong` |
| `--med`, `--yellow` | `--amber` |
| `--slow` | `--red` |

Canonical tokens: `--bg`, `--surface`, `--surface-card`, `--elevated`, `--raised`, `--border`, `--border2`,
`--border-strong`, `--text`, `--text2`, `--text3`, `--accent`, `--green`, `--green-soft`, `--green-soft-strong`,
`--copper*`, `--amber*`, `--red*`. Unused today: `--brd-md`, `--brd-hi`, `--raised` (canonical, kept),
`--accent-glow-lg`, `--mono`, `--mono-data`, `--sans`, `--header-h`, `--radius-lg`. `--incognito-glow` is referenced by the
unused `@keyframes pulse-incognito` but never defined (dead code).

**Rule.** Semantic colours (online/good/success, offline/error/failed, warning) are **never** hard-coded:
- green → `var(--accent)`, `var(--green-soft)` (tonal bg), `var(--green-soft-strong)` (border), `var(--accent-glow)` (glow/pulse)
- red → `var(--red)`, `var(--red-soft)`, `var(--red-soft-strong)`
- amber → `var(--amber)`, `var(--amber-soft)`, `var(--amber-soft-strong)`
- `mintFormatting.ts` / `mintProbeDisplay.ts` return these tokens as strings (`'var(--accent)'` …) — fine for inline
  `style` and SVG presentation attributes. **Never append a hex alpha** (`color + '44'`) to such a value; return a
  `{color, bg, border}` triple of tokens instead (see the Watchlist recommendation chip and Stats software badges).
- Literal colours that remain on purpose: categorical series/identity colours (ComparisonModal `MINT_COLORS`, review
  avatar palette, OG purple), grey tints, overlays/shadows, QR colours, `public/mint-coin-placeholder.svg`
  (an `<img>`, `var()` does not work there — keep it equal to `--copper`), favicon/manifest/OG image (moved to the current palette 2026-10-01 — see "Brand assets" below).
- `src/__tests__/retiredColours.test.ts` fails when a retired literal (`#17E87F`, `#4ade80`, `#00E676`, `#E24B4A`,
  `#ff4d4d`, `#ffa500`, `#f59e0b`, `#c98058`, `rgba(74,222,128,`, `rgba(23,232,127,`, `rgba(255,61,107,`) reappears
  in non-test source; its explicit allowlist (file + reason) covers the two categorical `#17E87F` uses.

**Copper changed 2026-10-01:** `--copper` `#c98058` → `#d98a5a`, `--copper-soft` rgba(217,138,90,.15),
`--copper-soft-strong` rgba(217,138,90,.3). Contrast of copper text: on `--surface-card` 3.92 → 4.51, `--surface` 5.08 → 5.85,
`--bg` 5.39 → 6.21, `--elevated` 4.73 → 5.44 (copper on its own `-soft` chip over `--surface-card`: 3.25 → 3.64).
**Also on 2026-10-01:** every online/good green is now the single `--accent` `#5cc9a3` (online dot was `#17E87F`,
score greens `#4ade80`); Fresh and Veteran age badges are both `--amber` now (they were amber vs orange).

## Brand assets (2026-10-01)

Browser chrome and brand rasters use the settled palette: `--bg` `#10201c`, `--accent` `#5cc9a3` (they are plain files, so
`var()` cannot be used — keep them equal to the tokens; `src/__tests__/brandAssets.test.ts` pins this).

| File | What | Source |
|---|---|---|
| `index.html` `<meta name="theme-color">`, `vite.config.ts` manifest `theme_color` + `background_color` | `#10201c` (`--bg`) | hand-edited |
| `public/favicon.svg` | NavLogo shapes (`fill="none"` like NavLogo, so the ring interiors are transparent), `#5cc9a3` on a `#10201c` rx=6 tile | hand-edited |
| `public/favicon-16x16.png`, `favicon-32x32.png`, `favicon.ico` (one 32x32 PNG inside an ICO), `icons/icon-{72,96,128,152,192,384,512}x*.png` | rounded tile with transparent corners (192/512 are declared `maskable` in the manifest, unchanged) | rendered from `favicon.svg` |
| `public/apple-touch-icon.png` | 180x180, opaque `--bg`, same artwork (iOS masks the corners itself) | rendered from `favicon.svg` |
| `public/og-image.svg` / `og-image.png` | 1200x630. bg `--bg`, panel `--surface`, pills `--surface-card`, dividers/pill borders = `--border-strong` composited over `--surface` (`#414c47`), text `--text` / `--text2` / footer `--text3`, accent `--accent` | SVG hand-edited, PNG rendered from it |
| `public/mint-coin-placeholder.svg` | copper `#d98a5a` (already current) | hand-edited |

**Regenerate** (from `MintRadar/`, uses the existing `sharp` dev dependency — nothing is added to `package.json`):
`FONTCONFIG_FILE=<fonts.conf> node scripts/generate-icons.mjs`. The OG text is `font-family: monospace`; the committed PNG was
rasterised with **DejaVu Sans Mono**, so point `FONTCONFIG_FILE` at a fontconfig that has a `<dir>` with `DejaVuSansMono*.ttf`
and `<alias><family>monospace</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>` (any machine default
monospace gives different glyphs). Not covered: `public/icons/icon-N.png` (no `xN`; 8 files, not referenced by the manifest,
index.html or any code — leftovers from `logo-original.png`, left untouched) and `logo-original.png`.

**OG pills:** the first pill ("✓ Reliability Score", 19 mono chars ≈ 275px at 24px) is 333px wide (the others are 260px) so it keeps the same ~29px inner padding; the other two pills of row 1 are shifted right by 73px. Row 2 was left where it was (so it is no longer centred under row 1). The PNG is rendered straight from the SVG text.

**Cache-busting (2026-10-02):** `public/` brand files are not content-hashed by Vite, and the live nginx serves every
`.png/.svg/.ico` with `expires 1y` + `Cache-Control: public, immutable`. So `vite-brand-assets.ts` (no dependency) appends
`?v=<first 8 hex of sha256(file bytes)>` at **build time only** (dev leaves URLs untouched): a `transformIndexHtml` (order `post`)
step rewrites `og:image`, `twitter:image`, `apple-touch-icon`, `favicon.ico`, `favicon-32x32.png`, `favicon-16x16.png`
in `index.html`, and `vite.config.ts` wraps the 7 manifest icons in `icon(command, …)`. File names/paths are unchanged (nginx
ignores the query). The workbox precache is keyed by URL without query + a revision hash; `ignoreURLParametersMatching` now
includes `/^v$/` so `?v=` requests still hit it. Pinned by `src/__tests__/brandAssetCacheBust.test.ts`.
- **When an asset changes:** replace the file (e.g. `node scripts/generate-icons.mjs`), commit, deploy — the hash, and with it the
  URL, changes by itself. Nothing to bump by hand.
- **Not covered:** `backend/src/og.ts` (`OG_IMAGE_URL`, the per-mint bot HTML) and `backend/src/nostrService.ts` (profile picture)
  still use plain `/og-image.png` / `/icons/icon-512x512.png` — separate package, no build hash available.
- **Social platforms** keep their own copy of a card image per URL: after a deploy that changes `og-image.png`, re-scrape
  `https://mintradar.org/` in each platform's sharing debugger (Facebook/LinkedIn/X card validators etc.); the new `?v=` makes
  the og:image URL new, but the page itself still has to be re-fetched.
- **nginx (manual, not applied):** `deploy/nginx.conf` is reference-only; the live file is
  `/etc/nginx/sites-available/mintradar.org.conf`. Hashed `/assets/*` files currently share the one 1-year-immutable rule. To give
  the un-hashed brand files a short revalidating cache, add this block **above** the `location ~* \.(js|css|png|svg|ico|woff2|webmanifest)$`
  block (regex locations: first match wins):
  ```nginx
  location ~* ^/(?:og-image\.(?:png|svg)|favicon[^/]*|apple-touch-icon\.png|icons/.+|logo-original\.png|mint-coin-placeholder\.svg)$ {
      add_header Cache-Control "public, max-age=86400, must-revalidate";
      add_header X-Frame-Options "DENY" always;
      add_header X-Content-Type-Options "nosniff" always;
      add_header Referrer-Policy "no-referrer" always;
      add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
      add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
      add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';" always;
  }
  ```
  (no `expires` here — it would add a second `Cache-Control`). Steps: `sudo nano /etc/nginx/sites-available/mintradar.org.conf`,
  `sudo nginx -t`, `sudo systemctl reload nginx`, then `curl -sI https://mintradar.org/og-image.png | grep -i cache-control`;
  mirror the block in `deploy/nginx.conf` (the daily drift check compares the two).
