# MintRadar — Mobile responsive fixes, tooltip positioning (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Mobile Responsive Fixes (as of 2026-06-30)

- **Filter panel (Dashboard only as of 2026-09-04 — see "Watchlist changes" below):** (NUT chips removed — see stats-dashboard-watchlist-ui.md) STATUS + MIN RELIABILITY SCORE side by side (50/50) using `filter-group-row-top` wrapper with `display: contents` on desktop (transparent to flex layout) and `display: flex; flex-direction: row` at ≤768px
- **Stats page:** Sections stack vertically on mobile; NUT Coverage bars don't overflow (`overflow: hidden`, shorter progress bar max-width)
- **Mint Detail:** Public key truncated on mobile (first+last 8 chars), full hex on desktop

### White focus ring on chart tap (2026-08-07) — the element is the `<g>`, not the `<svg>`

**GOTCHA — two earlier fixes targeted the wrong element and shipped without effect.**

Tapping any Recharts chart on mobile painted a white, rounded rectangle around the
chart's plot area. Root cause: Recharts 3.x renders its internal z-index layers as
`<g tabindex="-1">` inside the chart `<svg>` (`recharts/zIndex/ZIndexPortal.js` —
`.recharts-zIndex-layer_100` for Area, `_400` for Line, and so on; the tooltip wrapper
in `component/TooltipBoundingBox.js` is the same). `tabindex="-1"` is not
keyboard-reachable, but Chrome **does** focus such an element when it is tapped, and
then paints its default two-tone focus ring (`outline: auto` — white outer ring, dark
`rgb(16,16,16)` inner ring, rounded corners) around that `<g>`'s box.

Why the earlier attempts missed it:
- `.recharts-surface:focus { outline: none }` — `.recharts-surface` is the `<svg>`. The
  innermost focusable element under the finger is the `<g>` inside it, so the `<svg>`
  only ever gets focus when the tap lands on the chart's blank outer margin.
- `-webkit-tap-highlight-color` — that controls the Android tap *flash*, a different
  mechanism entirely from a focus ring.

Fix (`src/index.css`): `.recharts-wrapper [tabindex="-1"]:focus{,-visible}` → `outline: none`.
Matching on the attribute rather than the generated class name survives recharts
renaming its layers. Zero a11y cost — `tabindex="-1"` can never be reached by keyboard,
and the keyboard ring on the `<svg>` (`tabIndex={0}`) is deliberately kept.

**Diagnostic method that found it** (use it again for any "mystery visual state on tap"):
`page.touchscreen.tap()` on an emulated mobile device, then walk the full ancestor chain
from `document.elementFromPoint(x,y)` to `<html>` and diff `getComputedStyle()` before vs.
immediately after the tap — never assume which element is involved. Automated assertions
alone were what let the two bad fixes pass; a clipped screenshot before/after at
production contrast is what actually proved the ring's position and shape.

Regression test: `e2e/chart-tap-focus.spec.ts` (Pixel 7 emulation). It asserts that *no*
element in the chain under the tap point has a non-`none` `outline-style`, so it stays
correct even if recharts moves the focus to a different node. Verified the test actually
fails without the CSS rule (not just that it passes with it) before landing.

**Verified on Chromium/Android only** (Playwright + Pixel 7 emulation). iOS Safari/WebKit
has NOT been verified — WebKit handles focus on `tabindex="-1"` differently from Chrome,
so if the white ring reappears on iOS this needs its own targeted diagnostic pass, not an
assumption that the same fix covers it.

### Navbar — one row between 641px and where it fits (2026-09-29, `AppShell.css`)

The 640px two-row breakpoint is unchanged. Above it, the single-row navbar used to overflow every
page (140px at 700, 72px at 768, 40px at 800; logged-in up to ~980px) because the Login button /
profile chip is `flex-shrink: 0` + `nowrap`. Natural widths (measured with transitions off — `.nav-tab`
used to have `transition: all`, which made live-resize measurements lie; since 2026-09-30 it only transitions
`color`/`background-color`/`border-color`, hover and active look identical. Still `transition: all` in
`AppShell.css`, deliberately untouched: `.navbar-login-btn`, `.navbar-disconnect-btn`, `.nostr-cancel-btn`,
`.nostr-connect-btn` — the first two change padding at the ≤765/≤660px steps and so can still animate it): logo 124 (icon only 28), tabs 520
(tightened 426), Login 144 (short 75), profile chip + Disconnect 281 (135 without name/badge/npub);
the row needs those + 72px (36 padding + 3×12 gaps). Each step starts at the width where it is first
needed; wider viewports look as before. `.navbar-inner` gets `.is-authed` when logged in.

| Step | Logged out | Logged in |
|---|---|---|
| tabs `padding 6px 9px`, `gap 2px` | ≤ 840px | ≤ 996px |
| "Login via Nostr" → "Login" (`.navbar-login-extra` visually hidden, name unchanged) | ≤ 765px | — |
| wordmark hidden (`.navbar-wordmark` visually hidden; home link has `title="MintRadar"`) | ≤ 696px | ≤ 902px |
| profile name + badge + npub hidden (`.navbar-profile-text`; name is the chip's `title`) | — | ≤ 806px |
| Disconnect label hidden (glyph only, like ≤640px) | — | ≤ 660px |

Logged-out fits untouched from 840px, logged-in from 997px. Not done on purpose: making the auth
area shrinkable (no effect — nowrap contents just clip) and a separate "hide npub only" step (the
npub sits under the name row, so hiding it saves height, not width). Long display names are clamped from
641px (2026-09-30, see "Layout overflow fixes" below). Between 841 and 858px the logged-out row already has less
than its 18px right padding (content fits, but a slower font swap can push it over — the e2e test
waits for `document.fonts.ready`). Tests: `e2e/navbar-tablet-layout.spec.ts`. The two Dashboard overflows seen while measuring (`.submit-btn` at
~901–990px, `.sort-segment` at 360px) were fixed 2026-09-30, see below.

**Phones ≤430px — tab links on one row (2026-09-29):** the six labels are ≈296px of text in a 324px row at
360px, so the 16px column gap plus the inline Watchlist count badge (rendered only when logged in with
watched mints) pushed "Learn" onto a second row. `@media (max-width: 430px)`: `justify-content:
space-between; column-gap: 6px`, and `.nav-tab-badge` is absolutely positioned on the label's top-right
corner (takes no width). One row from 360px up; below ~350px the labels still wrap (`flex-wrap` kept).
Test: `navbar-mobile-layout.spec.ts` ("tab links stay on one row…", badge injected into the DOM).

### Layout overflow fixes (2026-09-30)

Measured with `scrollWidth` vs `clientWidth` at 320–1440px on Dashboard (cards/list, Filters open/closed,
logged out/in), Watchlist, Stats, Tools, Wallets, Learn and a tracked Mint Detail. Watchlist does NOT share
the Dashboard toolbar (its Filters/sort row was removed 2026-09-04) and never overflowed.

1. **Dashboard `.submit-btn` at 901–990px.** Overflow 90px at 901, 41 at 950, 1 at 990, 0 from 991; identical in
   every state. Cause: `.dashboard-controls` (non-wrapping flex row; search + Filters + sort segment + view
   toggle + refresh + Submit) needs 991px, and `.submit-btn` is `flex-shrink: 0` with its right edge at 991px.
   The ≤900px block (`flex-wrap`) did not cover 901+. Fix (`Dashboard.css`): `@media (min-width: 901px) and
   (max-width: 1000px)` wraps the row and gives only `.search-wrap` its own line (Filters joins the sort row);
   controls keep desktop size, Submit stays in the toolbar, 9px slack above the 991px limit.
2. **Dashboard `.sort-segment` at ≤360px.** Its five buttons have a 351px minimum (`flex: 1 1 100%`, implicit
   `min-width: auto`); the row has 332px at 360px (5px over), 312 at 340 (25), 292 at 320 (45). 375px and up fit.
   Fix: `@media (max-width: 370px)` — `.sort-btn` horizontal padding 3px (fits 340–370px, no scrolling) and
   `.sort-segment { min-width: 0; overflow-x: auto }` (scrollbar hidden) so 320px scrolls inside the segment
   only. `Dashboard.tsx` keeps the active option centred in view via `sortSegmentRef` when the segment overflows
   (the default "Reliability Score" is the last button).
3. **Navbar long display name above 640px.** `.navbar-username` (≥641px) is single-line, `overflow: hidden`,
   `text-overflow: ellipsis`; the full name is the `title` of both the chip and the name span. **A fixed
   max-width cannot work:** at the start of each navbar step the row has no slack (807px: a 10-char name already
   uses it all; a 19-char name overflowed 45px at 807/903/997 and 2px at 850 before), so the name gets
   what is left of the row: `max-width: min(240px, calc(100cqw − Npx))`, with N = fixed row width − 36px padding
   + 2px safety per step (807–902: 685, 903–996: 781, 997+: 875; fixed part measured 719/815/909px page width).
   `.navbar-inner` is a size container (`container-type: inline-size`, ≥641px) because `cqw`, unlike `vw`,
   excludes a classic scrollbar. **If a navbar step's width changes (new element, different padding), re-measure
   and update these three numbers.** Consequence: a normal-length name can now be cut at 807–~850, 903–~950 and
   997–~1050px where it used to overflow the page; elsewhere it is unchanged (10-char name never truncated).
   Navbar steps and breakpoints untouched.

**Rule applied:** wrap or shrink the smallest thing inside the toolbar that overflows, in a media query that
covers only the overflowing range; never hide or move a control. Everything else in the matrix
(320…1440px, all pages, logged out/in) has `scrollWidth <= clientWidth`. Tests: `e2e/layout-overflow.spec.ts`.

4. **Mint Detail `.md-summary` at 769–864px (2026-09-30, the "intermittent" `.md-sc` overflow).** Not timing and
   not login: it depends on the Community-rating tile. A *rated* tile (`★★★★☆ 4.2` + "N reviews") has an
   unshrinkable min-content (~224px card), and the five `.md-sc` flex items (`flex: 1`, implicit
   `min-width: auto`) together need ~845px ("1 review") to ~865px ("12 reviews"). Above 768px `.md-summary` is a
   non-wrapping flex row (≤768px it is a 2-col grid), so 769–864px pushed the page sideways (html is
   `overflow-x: visible`, only body clips — the page really scrolled: 73px at 769, 42 at 800; logged in and out
   alike). It looked intermittent only because the tile flips between states: until the stored reviews load it
   shows the `/api/mints/known` rollup (`reviewCount`/`reviewAvgRating` → stars), then "No reviews yet" when the
   stored list is empty (the e2e mocks: rollup says 12 reviews, stored list is empty → overflow at first paint
   only, gone at network idle). Real mints with ≥1 rated review overflowed permanently. Fix (`MintDetail.css`):
   `.md-summary { flex-wrap: wrap }` — tiles wrap to a second row only where the row would not fit (769–860px
   with a rated tile), one row from ~861px and unchanged when the tile is "No reviews yet"/"Unrated".
   **Rule: a `display: flex` row of tiles with `min-width: auto` items needs `flex-wrap: wrap` (or `min-width: 0`
   plus wrapping content) — a tile whose content can change after load (rating, badges) will widen the row.**
   Tests (fonts delayed 1.5s, late and stored reviews, moments a/b/c): `e2e/layout-overflow.spec.ts` "Mint Detail".
   The 4px `.md-sc`/`.md-tab` overflow at 320px noted earlier did not reproduce (321px, rated tile: 0px) and was
   not touched; a `.md-tab` overflow was not re-investigated.

## Tooltip positioning in scrollable/small containers

**Pattern:** in a small or scrollable container (e.g. the Network Health Index Breakdown
modal), a tooltip that always pops in one fixed direction (e.g. always upward) gets
clipped for rows near the edge that don't have room in that direction.

**Fix applied in `NetworkHealthModal` (`Stats.tsx`):** direction is chosen dynamically by
position in the list — the last 2 rows pop downward, the rest pop upward (rather than
one fixed direction for every row).

Same fix pattern as the existing precedent in `MintDetail.tsx:616` — when a similar
tooltip-clipping issue shows up in a small container elsewhere in the app, check this
pattern first before inventing a new one.

**Established visual rule:** info icons attached to a badge (e.g. "Backup supported", the
error badge) must be a separate sibling element placed next to the badge — never nested
inside the same pill-shaped container as the badge. This convention is used consistently
across the app.

