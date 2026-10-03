# MintRadar — Mobile responsive fixes, tooltip positioning (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Mobile Responsive Fixes (as of 2026-06-30)

- **Filter panel (Dashboard only as of 2026-09-04 — see "Watchlist changes" below):** (NUT chips removed — see stats-dashboard-watchlist-ui.md) STATUS + MIN RELIABILITY SCORE side by side (50/50) using `filter-group-row-top` wrapper with `display: contents` on desktop (transparent to flex layout) and `display: flex; flex-direction: row` at ≤768px
- **Stats page:** Sections stack vertically on mobile; NUT Coverage bars don't overflow (`overflow: hidden`, shorter progress bar max-width)
- **Mint Detail:** Public key truncated on mobile (first+last 8 chars), full hex on desktop

## Rule: data-driven text must never widen the page (2026-10-02)

Mint names, hostnames, URLs, operator notices (MOTD / description), NIP-05 values, reviewer names, version strings and review texts come from third parties, so any length of them must fit at every width from 320px up — no horizontal page scroll, no card / tile / chip pushed off screen.

- **Grid and flex items need `min-width: 0`.** A `nowrap` + `text-overflow: ellipsis` title only truncates when its grid/flex ancestors can shrink; otherwise the item's min-content width is the full text and a `1fr` track grows past the viewport (the 2026-10 bug: a mint name over ~31 characters pushed the whole mobile grid off the left edge). Already applied to `.mint-card`, `.stats-panel`, `.tool-anchor`.
- **Single-line titles** (card name / host, list rows, compare version): keep `nowrap` + ellipsis and put the full text in a `title` attribute. **Free text** (`.md-name`, `.md-sc-value`, `.md-motd-text`, `.md-mint-alert-text`, `.review-comment`): `overflow-wrap: anywhere` so a 60-character word with no spaces wraps.
- Render the data as plain React text; fix it with CSS, not by slicing the string.
- `e2e/long-text-overflow.spec.ts` checks `scrollWidth <= clientWidth` and that cards / tiles / chips stay inside the viewport at 320 / 360 / 390 / 768px for extreme names, hostnames, notices, NIP-05 values, reviewer names and versions on Dashboard (grid + list), Watchlist, Compare, Stats, Tools and every Mint Detail tab. Add a case there when a new surface shows third-party text.
- Audit tab "Recent success rate" tile: below a 445px strip width the `N / 100` and `NN% ok` sit on two lines (container query on `.audit-summary-strip`).

## Modal dialogs — semantics + focus handling (2026-10-03)

Every modal now has `role="dialog"` + `aria-modal="true"` + an accessible name (`aria-labelledby` an id on the visible title, or `aria-label` where the title is computed), and gets its focus behaviour from one shared hook, **`src/hooks/useModalFocus.ts`**:

```tsx
const dialogRef = useModalFocus()            // or useModalFocus('.md-picker-search') to start in a field
{open && <div role="dialog" aria-modal="true" aria-labelledby="…" ref={dialogRef}>…</div>}
```

It is a React 19 callback ref (works for dialogs rendered conditionally inside a big page component; the returned cleanup runs on unmount). On mount it remembers `document.activeElement` as the trigger and focuses the dialog container (`tabindex=-1`, outline off, so nothing looks different) or the `initialFocus` selector; Tab / Shift+Tab wrap inside the topmost open dialog (a stack handles two dialogs mounted in one commit), a `focusin` guard pulls back focus that escapes some other way; on unmount focus returns to the trigger if it is still in the DOM. **Escape, outside click and the close button are NOT in the hook** — each modal already had its own (window `keydown` listener, overlay `onClick`); an open ⓘ tooltip still swallows Escape first via `useTapTooltip`'s capture-phase listener. A new modal = `role`/`aria-modal`/name + `ref={useModalFocus()}`; give its close glyph button `aria-label="Close"`.

| Modal | File | Name from |
|---|---|---|
| Login | `AppShell.tsx` | `#nostr-modal-title` (both views) |
| Watch this mint (card / Mint Detail) | `MintCard.tsx` / `MintDetail.tsx` | `aria-label` |
| Write a review | `MintDetail.tsx` | `aria-label` (already had role + aria-modal before) |
| Mint QR · Reliability breakdown · NUT detail | `MintDetail.tsx` | `#qr-modal-title` / `#reliability-breakdown-title` / `#nut-modal-title` |
| Submit a mint | `Dashboard.tsx` | `#submit-modal-title` |
| Compare picker (Dashboard / Watchlist / Mint Detail) | `MintComparePicker.tsx` | `#md-picker-title` — starts in the search field (`autoFocus` replaced by `useModalFocus('.md-picker-search')`) |
| Comparison | `ComparisonModal.tsx` | `#cmp-modal-title` |
| Stats: software versions / location mints / NUT coverage / other locations / Network Health | `Stats.tsx` | `aria-label` |

- **Close button added** only to the Submit modal (`.submit-modal-close`, ✕, absolutely positioned in the corner like `.nut-modal-close`; `.submit-modal` got `position: relative`, nothing reflows). Every other modal already had one; the glyph-only ones (`×`, `✕`, `IcClose`) got `aria-label="Close"`.
- **Submit modal Single input (2026-10):** `src/utils/submitInput.ts` `classifySubmitInput()` sorts the field into empty / https URL (parsed, normalised like backend `normalizeUrl`, ≤500) / npub (bech32-decoded) / invalid npub / nsec1 / hex / nprofile / http / spaces / too-long / junk. ONLY `url` and `npub` may cause a `/api/mint/probe` or relay request; everything else stays in the browser (verified by counting WS frames + probe requests). npub only — no hex/nprofile. The key lookup queries the same 6 `NOSTR_LOOKUP_RELAYS` one subscription each so a real EOSE (<4 s) is told apart from nostr-tools' own 4.4 s EOSE timeout → distinct messages (found / none found / relays unreachable / non-https announcement); only events of kind 38172 authored by the typed key are used. The Submit button uses `aria-disabled` (focusable, click guarded in `handleSubmitMint`), and the reason + lookup + preview share one `#submit-status` live region.
- **Submit modal Bulk (2026-10):** `src/utils/bulkInput.ts` `parseBulkInput()` reuses the Single classifier per line (trim, blanks ignored, https only, de-duplicated after `normalizeMintUrl`, npub/hex/nsec lines invalid — an nsec line is never echoed). A debounced (400 ms) live summary (`N valid · N invalid · N duplicates · N already tracked`) sits in `#bulk-status`; the button reads `Submit N mints`, is `aria-disabled` at 0 and above `MAX_BULK_URLS` (100, mirrors `MAX_DISCOVER_BATCH`) where nothing is sent. Results show full normalised URLs; server error strings are only mapped to a class (`classifyBulkError`). Response rows map to sent lines by index only if `results.length` equals the lines sent, else one whole-submission error. 502/503/504, network errors and non-JSON answers give one 'took too long' message and return to the form with the text kept. Summary/banner tone: success / warning (amber, banner `info`) / error (`queued-banner-error`). Known limit: the backend probes sequentially (up to 10 s per mint) and the repo's nginx sets no `proxy_read_timeout` (default 60 s), so a large batch of slow mints can 504 although the server keeps going.
- **Not modals, left alone:** the account menu panel (`AccountMenu.tsx`) and the Filters panel are disclosure panels (`aria-expanded`, no overlay, no trap).
- **Known gaps, not changed:** the page behind is neither inert nor scroll-locked (`aria-modal` + the overlay only); several triggers are non-focusable `div`s (NUT card on Mint Detail, `.sw-row`, `.stats-nut-row`, `.dist-row-clickable`, `.dist-more-row` on Stats), so there is nothing to restore focus to when those modals close — making them buttons is a separate change.
- Test: `e2e/modal-dialog-semantics.spec.ts` (one test per modal × requirement; `MODAL_AUDIT=1` prints a JSON line per modal for the pass/fail table; also 390 / 320px overflow). `e2e/mint-detail-review-modal.spec.ts` now finds the review modal by `getByRole('dialog', { name: 'Write a review' })`. **Both were written without being run** (2026-10-03, on request: no test runs) — run `npx playwright test e2e/modal-dialog-semantics.spec.ts` before relying on them.

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
`AppShell.css`, deliberately untouched: `.navbar-login-btn`, `.nostr-cancel-btn`,
`.nostr-connect-btn` — the first two change padding at the ≤765/≤660px steps and so can still animate it): logo 124 (icon only 28), tabs 520
(tightened 426), Login 144 (short 75), profile chip + Disconnect 281 (135 without name/badge/npub) — superseded 2026-10-01, see "Account chip + panel";
the row needs those + 72px (36 padding + 3×12 gaps). Each step starts at the width where it is first
needed; wider viewports look as before. `.navbar-inner` gets `.is-authed` when logged in.

**Navbar width + Login button (2026-10-01):** `.navbar-inner` uses `max-width: var(--dash-chrome-max)` and `padding: 0 var(--page-pad)` — the same variables as the page content — so its edges equal the content edges at every width (was a fixed 1400px, 58px wider per side at 1920). The `.navbar` background/border stays full-bleed. The Login button is always just "Login" (lucide `Zap` line icon — outline, no fill, no ⚡ character — `aria-label="Login via Nostr"`); the old ≤765px label switch and `.navbar-login-extra` span are gone, so "Login 144" above is now ≈ 90 (short 75). Login modal header badge uses the same `Zap` line icon (18px, stroke 1.75) instead of ⚡ (it was `LogIn` for one commit, swapped back to the bolt on 2026-10-01). Test: `navbar inner row edges equal the content edges` in `e2e/navbar-tablet-layout.spec.ts`. LN pills on mint cards, Watchlist/MintCard/MintDetail login prompts (`⚡ Login via Nostr`) were deliberately left unchanged. **Follow-up (2026-10-01):** the modal's nsec/extension `Connect` and `Retry` buttons now use the same lucide `Zap` outline (13px, stroke 2.4, `aria-hidden`) instead of ⚡; the nsec warning box uses a lucide `TriangleAlert` (13px, copper, `aria-hidden`, flex-aligned to the first line) instead of ⚠️ and the text is shortened ("Pasting a private key into a browser is risky. Prefer a NIP-07 extension or a remote signer, and only use this on a device you trust."); nsec subtitle is "Your key is held in this browser's memory for this session, cleared on logout." (matches the in-memory-only + `removeNsecShim()` behaviour). The remote-signer paste-row `Connect` (same `.nostr-connect-btn` class, separate `<button>`) got the same `Zap` later the same day; the icon stays rendered in the loading state (label `…`) so it never toggles. Test: `e2e/login-nip07.spec.ts`.

| Step | Logged out | Logged in |
|---|---|---|
| tabs `padding 6px 9px`, `gap 2px` | ≤ 840px | ≤ 996px |
| wordmark hidden (`.navbar-wordmark` visually hidden; home link has `title="MintRadar"`) | ≤ 696px | ≤ 902px |

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
3. **Navbar long display name above 640px.** Superseded 2026-10-01: the `100cqw − N` constants (685/781/875) and `container-type` on `.navbar-inner` are gone — the chip and `.navbar-auth` (logged in) are shrinkable flex items and `.navbar-username` is `flex: 0 1 auto; max-width: 200px` with an ellipsis, so the name takes whatever room the row has left. Measured min name width 50px at 641px (80-char name), so the name never has to be dropped in the one-row layout.

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

**Escape closes an open tooltip first (2026-10-02, `useTapTooltip.ts`):** while any ⓘ tooltip
is open (hover, tap or keyboard focus), Escape closes only that tooltip — a capture-phase
`keydown` listener on `window` calls `stopPropagation()` before the surrounding container sees
it, and focus is not moved. A second Escape then closes the container as before. This works
because every container (Filters panel via `mintradar:escape` from `AppShell.tsx`, the account
menu's `document` listener, every modal's `window` listener) listens in the **bubble** phase —
**a new Escape handler for a dialog/panel must not use the capture phase**, or it would bypass
this. Applies to every `useTapTooltip` consumer (`InfoTooltip`, the Reliability breakdown rows,
Comparison/Stats modals), not only `InfoTooltip`. `InfoTooltip`'s old own `onKeyDown` Escape
handler was removed (redundant). e2e: `e2e/tooltip-escape.spec.ts`.


## Mobile navbar row 1 (2026-09-30)
Logo + auth stay on one row at ≤640px. Npub line is hidden; display name ellipsizes (72px, 56px at ≤360px); method badge hides at ≤360px. Tabs still wrap to row 2.


## Account chip + panel (2026-10-01)

`src/components/layout/AccountMenu.tsx` (used by `AppShell.tsx`). The logged-in chip is a `<button class="navbar-profile">` — avatar (`.navbar-avatar`, a fixed 22px round slot; https-only `<img>` loaded exactly as before: direct URL, no proxy/cache/prefetch) + name + chevron (up while open) — and a disclosure (`aria-expanded`, `aria-controls="navbar-account-panel"`, no `role="menu"`). Badge, npub and Disconnect are no longer in the chip. ≤640px (two-row layout) the name is hidden: chip = avatar + chevron, accessible name `Account: <name>`.

Panel `#navbar-account-panel` (always rendered, `hidden` when closed): name (wraps) + method badge (`nsec` has the copper `--nsec` variant + title "key held in this browser"), the shortened npub as one full-width button (click → `navigator.clipboard.writeText(full npub)` in try/catch → "Copied" / "Copy failed" for 1.5s, `aria-live="polite"` sr-only region, timer cleared on close/unmount), and **Log out** (min-height 44px; same `handleLogout` as the old Disconnect — `logout()` + `resetInMemory()`). Closes on Escape (focus → chip), outside `pointerdown`, Log out, route change, and Tab leaving the widget (`focusout` with a non-null `relatedTarget`; null = pointer, handled by pointerdown — Safari doesn't focus buttons on click). Desktop: 264px, right-aligned under the chip; ≤640px: 244px, `max-width: calc(100vw - 24px)`, right edge 12px from the screen (`right: calc(12px - var(--page-pad))`). `position: absolute` inside `.navbar-account` (relative) — it overlays, never shifts layout; it lives in the sticky `.navbar` stacking context (z-index 100), above the page chrome (verified with `elementFromPoint` on 7 pages). `.navbar-inner` is no longer a size container, so nothing clips it. `(pointer: coarse)`: chip and npub row get 44px min-height. Tests: `e2e/profile-dropdown.spec.ts`. The 3 old mobile failures there (`.navbar-npub` was `display: none` ≤640px, test clicked it) were stale-test failures, fixed by the rework.

**Avatar fallback (2026-10-01):** no picture, a non-https URL or an `onError` → `.navbar-avatar--placeholder` of the same 22px size (so nothing shifts), tinted like `.nostr-modal-icon` (`--green-soft` / `--green-bright`), showing the first *grapheme* of the name (`Intl.Segmenter`, uppercased, rendered as React text) or a lucide `User` icon when the name is empty / an npub / null. The failed URL is kept in state (`failedSrc`) and compared with the current `profile.picture`, so a different URL shows the image again without an effect. Placeholder is `aria-hidden`; the chip's `aria-label` is `Account: <name>` (falls back to the pubkey prefix for an empty name) so the name is exposed even where the visible name is hidden (≤640px). Not changed on purpose (same `<img>` + `onError` pattern, own styling): `MintDetail.tsx` `.rv-signer-avatar` (hides on error), `Watchlist.tsx` `.wl-rec-avatar-img` (reveals its letter span), `MintDetail.tsx` `.review-avatar-img` (no onError), `MintFavicon.tsx` (mint icons, own failure cache). **Testing note:** the Vite dev server CSP is `img-src 'self' data: blob:` (production nginx allows `https:`), so remote avatars never load in dev/e2e — `e2e/navbar-avatar-fallback.spec.ts` uses `test.use({ bypassCSP: true })` plus `page.route`. Tests: `e2e/navbar-avatar-fallback.spec.ts`, `e2e/navbar-avatar-scheme-guard.spec.ts`.

**Control heights + UI font (2026-10-01):** from 641px `.navbar-inner` sets `--navbar-control-h: 43px` (the tab group's measured outer height: 3+3 padding, 2 border, 35 tab) and the tab group (`height`), the Login button and the account chip (both `height` + `padding-block: 0`, 8px radius, 1px border) all use it, so top/bottom edges line up on the row's centre axis (tabs 3.5→46.5 inside the 50px row). `--nav-h` and the navbar height (51px incl. border) are unchanged. The chip avatar is 30px there (placeholder letter 14px, icon 17px); below 641px sizes are untouched. On touch tablets (`pointer: coarse`, ≥641px) the chip is 43px, not 44 — equal height wins; the npub row and ≤640px keep 44px. The name in the chip (`.navbar-username`) and in the panel (`.navbar-account-name`) use `var(--font-body)` (the chip name used to be monospace via an explicit `--font-mono` rule copied from the old chip; the panel name inherited the body font); the npub row stays monospace. Re-swept 641–1920px/3px (logged out, short and 80-char name): one row, no overflow/overlap, ellipsis kept; the minimum name width at 641px dropped from 50 to 42px (wider avatar), no step needed changing. Tests: `navbar controls match the tab group height and edges` in `e2e/navbar-tablet-layout.spec.ts`.

## Small container overflows at 320 / 360 / 768px (2026-10-02)

Elements that did not widen the page but left their own container (scan: every child vs its nearest layout parent, Dashboard / Mint Detail all tabs / Stats / Watchlist / Tools / Wallets / Learn at 320/360/390/768 with the long-text fixtures). **Fixed (CSS only, except one className hook):** Dashboard sort buttons ≤349px (segment scrolled: 319px of buttons in 290px at 320 → 10px type, 1px padding, 1px gap); Stats hero `.stat-note` at 700–900px and ≤335px (`min-width: 0; overflow-wrap: anywhere`, 10px at 700–900 so "active" stays whole; "from Frankfurt" stuck out up to 24px); Mint Detail History summary cards at ≤340px (`.md-hist-summary` className added, inline styles need `!important`; third card stuck out 19px at 320); a very long `lastError` badge (`.md-hdr-error`/`.md-error-badge`, ran ~2000px past the header at every width; ≥641px capped at 60vw because `.md-hdr-center` never shrinks). **Deliberately not fixed:** (1) Mint Detail header buttons at 352–376px — equal-thirds row of 208px at 360; Cashu.me glyphs clipped by ≤3.3px (0 at ~378px) and the Mint QR icon is squeezed to 0 width at 360–~388px; only fixable by changing padding/wrapping at normal phone widths (≤350px already wraps Compare to its own row); (2) the 12px Unit info icon pokes 1.6px out of its fixed-width `.filter-field-labelcell` at every width (fixing it shifts the aligned segmented controls); (3) `.dist-row-clickable` Geography rows — intentional `margin: 0 -4px` hover bleed. Tests: `container overflows @ Npx` in `e2e/long-text-overflow.spec.ts`.

### Hero action buttons at 360–379px (2026-10-03, supersedes "deliberately not fixed (1)" above)
Measured with a Range over each button's contents vs its border box (the label is a bare text node, so child rects miss it): the one-row equal-thirds action row (`flex: 1 1 0`, `overflow: hidden`, content centred, wrap fallback only ≤359px) clipped "Cashu.me" by 3.3px at 360px (Compare 1.7px), fading to 0 at ~380px; 340/350px (wrapped) and ≥380px were clean. Side padding does not help (centred content is clipped at the border box), so `@media (min-width: 360px) and (max-width: 379px)` shrinks only gaps: 6→2px between buttons, 4→2px icon↔label, letter-spacing 0.03em→0. Font, height, colours, one-row layout and everything ≥380px unchanged (boxes at 390 and 1440 are pinned in the test). Not touched: the Mint QR icon is squeezed to ~0–2px by flex-shrink at 360–~390px (pre-existing, also at 390). Tests: `hero buttons are not clipped` / `hero button boxes are unchanged` in `e2e/long-text-overflow.spec.ts`.

### Stats hero notes wrap at spaces (2026-10-03, supersedes the a9e02c5 note rule above)
History of `.stats-metrics .stat-note`: 11px / `nowrap` is the original (`Dashboard.css .stat-note`); `Stats.css:62` (89b232f) added `white-space: normal; flex-shrink: 1`; 8.5px at ≤700px (22832b4). Commit 47638ce did not touch it. The **10px size and the mid-word break were a side effect of our own overflow fix a9e02c5** (`overflow-wrap: anywhere` + `font-size: 10px` at 700–900px), not original design: `anywhere` lets the flex column shrink to nothing, so at 720px (note column 29px) "known" broke as "know|n" over 4 lines. Layout fact: ≥701px the five tiles sit in one row (tile 123px at 701 → 163px at 900; icon 40px + 28px row gap), so the note column is only ~25px at 701, 39px at 768, 45px at 800, 65px at 900 (≤700px is a 3-column grid, 54px+). Now: `overflow-wrap: break-word` + `min-width: 0` (701–900px and ≤335px) and `font-size: clamp(8px, calc(5.3vw - 30.6px), 11px)` at 701–900px — about the largest size at which "active" (6 mono chars) still fits the column: 8px at 701, ~10.1px at 768, the original 11px from ~780px. Remaining mid-word breaks: "Frankfurt" while the column is narrower than the word (< ~870px, at any size) and "active" at 701–~725px (column < 30px; 7.6px would be needed, below the 8px floor). Hero tile heights changed only inside 701–900px (a few px, 143→123 etc. because notes now wrap at spaces); 320/390/640/700/901/1000/1440 are identical. Tests: `Stats notes …` and `Stats hero with long-text fixture …` in `e2e/long-text-overflow.spec.ts`.

### Hero buttons are text-only below 400px (2026-10-03, supersedes the 360–379px gap rule and the "squeezed Mint QR icon" note above)
The Mint QR icon was flex-shrunk to 0–2px at 360–399px (7.7px at 320, 5.3px at 400) while Cashu.me (7.3px) and Compare (11.3px) kept theirs. `@media (max-width: 399.98px)` now hides all three decorative icons (`.md-quick-btn > svg`, `.md-quick-btn > span[aria-hidden]`, `.md-compare-btn > span[aria-hidden]`; text labels are the accessible names). With no icons the febda7d reductions (row gap 6→2px, icon gap, letter-spacing) are no longer needed — a 330–400px sweep shows 0px clipping without them — so that block was removed and the normal 6px gap is back. Side effect: Mint QR is 27px high like the others (28px with its icon). ≥400px is unchanged, including the still-squeezed Mint QR icon at 400px (5.3px; 12px from ~430px). The buttons' hit area is the visible 27–28px box (there is no 44px `::before` on them; unchanged). Tests: `hero buttons are text-only`, `hero icons keep their size`, `hero button boxes are unchanged @ 400/1440` and the clipping cases (now incl. 399px) in `e2e/long-text-overflow.spec.ts`.

### Hero icons hidden below 420px (2026-10-03, supersedes the 400px breakpoint above)
Sweep 340–460px (normal + long name, icons forced on): the Mint QR icon is below its 12px size at every width up to 418px — 0px at 360, 1.3px at 388, 5.3px at 400, 9.3px at 412, 10px at 414, 10.7px at 416, 12px from 420px (≥11.5px at ≈418.4px, rounded up to 420); Cashu.me (7.3px) and Compare (11.3px) are constant. So `@media (max-width: 419.98px)` hides all three icons and from 420px all render at full size (12 / 7.3 / 11.3px; 12 / 7.4 / 12.4px at 1440). With icons hidden no button text is clipped at 400–419px (the clipping at 360–376px only came with the Cashu.me/Compare icons). Boxes ≥420px are unchanged (pinned in the test at 420 and 1440). Tests: `hero buttons are text-only` (320–414px), `hero icons keep their size` (420/430/1440), clipping cases at 340/360/375/412/414/428px.

### Hero buttons: 44px touch target (2026-10-03)
Measured (touch context): visible height 27px ≤640px (padding 7/8), 30px above (padding 8/15); `position: static`, `overflow: hidden` ≤640px; 6–8px gaps; the only things 8px above/below are the non-interactive First seen line / `md-hdr-left` container and the card padding (15px below, 23px at 1440). So the existing invisible-`::before` pattern fits without touching a clickable neighbour. `@media (pointer: coarse)`: buttons get `position: relative` and a vertical-only `::before` (inset ±8px → 44px on 30px buttons; ±9.5px → 44px on 27px buttons, because it is positioned from the padding box); ≤640px `overflow: hidden` is lifted on touch (it would clip the extension, and nothing clips now the icons are gone below 420px). **Exception:** at ≤359px the row wraps (Compare 6px under the other two), so the facing edges get 4px (3px beyond the border): hit area 38.5px there instead of 44px, to avoid overlapping the other row. Mouse/keyboard, focus ring, visible boxes and page height unchanged (compared against a mouse context in the test). Tests: `hero buttons have a … touch target` in `e2e/long-text-overflow.spec.ts` (360/390/768/1440 ≥44px, 320 ≥38px; scan by `elementFromPoint`).
