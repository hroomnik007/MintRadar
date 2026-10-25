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
- **Logged-out and empty-state copy (rewritten 2026-09-05, made notification-honest 2026-10-03).** Logged-out gate (`profile === null`):
  "Log in with Nostr to sync your watchlist across devices." (body font, 13px/1.5 like `.wallets-subtitle` /
  `.learn-page-subtitle`; the old mono font is gone) + hint "Stored on Nostr. Optional DMs when a watched
  mint goes down or comes back up, plus key and fee changes." (shortened 2026-10-04, key/fee added Task G3). Empty watchlist (logged in, zero mints): "No mints watched yet" / "Add mints
  from the Dashboard with + Watch. Your list syncs over Nostr. Turn on Nostr DMs per mint if you want to
  hear when its status, key or fee changes." with a "Go to Dashboard" CTA (navigates to `/`; `/dashboard` is not a route).
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

### Watchlist notification toggles — truthful state (2026-10-03)

- **Footer strip, Watchlist cards only.** `NotifyStrip.tsx` (rendered by `MintCard` when `showNotifyToggles`; replaces the old `Down`/`Up` `.notify-toggle-btn` buttons that lived in `.card-actions`, CSS block "Watchlist-only footer strip" in `Dashboard.css`): divider (`border-top`), `NOTIFY` label + bell, two pills **"Goes down"** / **"Goes up"** (`role="group"` labelled `Notifications for <name>`; pills `aria-pressed`, names `Notify when <name> goes down` / `Notify when <name> goes up`; the visible text is contained in the accessible name). The second pill read "Back up" (commit `9a198b3`) until 2026-10-06; that wording decision is **replaced** by "Goes up". Only the label and its accessible name changed: the field `notifyOnUp`, the `up` flag, the API and the stored state keep their names. 26px visible, 44px touch target via `::before` (`top/bottom:-10px` — the 1px border makes the padding box 24px) under `(pointer: coarse), (max-width: 600px)`. On = `--accent-dim` fill + `--accent-brd` border + check; off = outline only. A 10px slot holds the check/spinner in every state, so widths never change. Watchlist cards are ~28px taller than before (206px vs 178px at 1440; the Dashboard card is 164px, decided); Dashboard cards are untouched (screenshots byte-identical).
- **A pill is "on" only when the SERVER confirmed it.** `WatchlistEntry.notifyConfirmedAt` (Dexie, non-indexed, no version bump) is set after every successful subscribe/unsubscribe; `confirmedNotify(entry)` (`utils/notifyState.ts`) returns `{down, up}` = the flags only when `notifyConfirmedAt` exists, else both off. The UI and `refreshAllSubscriptions` both read the flags through it. There is no server read route (only `POST subscribe|unsubscribe`), so this stored confirmation is the only truth the client has.
- **Defaults:** a newly watched mint (`addMint`, and `useWatchlistSync` for urls not yet in Dexie) starts with BOTH flags false and no confirmation — starring never creates a server subscription. `useWatchlistSync` preserves `notifyConfirmedAt` of existing rows.
- **Legacy rows** (flags on, no confirmation — the old on/on default, many with a server row created by the login sync) show as OFF, are NOT refreshed at login any more, and their server rows lapse within 30 days of the last refresh. The first toggle on is the idempotent upsert (body = exactly what the UI shows), toggle off is the DELETE.
- **Press flow** (`setNotifyFlag` in `notificationSubscription.ts`): pill disabled + spinner (`aria-busy`) while pending, BOTH pills of the card disabled (one request per mint at a time); target computed from the confirmed state when the request runs; local flags + `notifyConfirmedAt` written only after the server said ok; both flags off → `/unsubscribe`, else `/subscribe`. A per-mint FIFO (`runExclusive`) serialises toggle / login refresh / (later) removal, and a synchronous `busy` ref drops double clicks. `refreshAllSubscriptions` joins a running refresh (React StrictMode re-runs the sync effect in dev).
- **Failures are visible.** `postWithNip98` never throws and logs nothing (no mint URL, no error); it returns `{ok:false, reason}`: `signer-unavailable` / `signer-declined` / `signer-timeout` (60s) / `unreachable` (network or 15s) / `rate-limited` (429) / `limit` (409) / `rejected` (anything else). `.notify-strip-msg` (`role="status"`, always in the DOM, `:empty` hidden) shows "Signer declined the request." / "Couldn't reach the server. Try again." / "Too many requests. Try again later." / "Couldn't turn on|off notifications. Try again." until the next successful toggle; the pill returns to its previous state.
- **More alerts pills (2026-10-10):** the collapsed "More alerts" row under NOTIFY holds three more pills — "Mint/melt issues", "Version outdated", "Lost NUT04/05" — built by the same `pill()`/`press()` as Goes down/up in `NotifyStrip.tsx` (same `.notify-pill` size, spinner/check slot, 6px gap, on only after the server confirmed). Flags: Dexie `notifyOnMintMeltIssues` / `notifyOnVersionOutdated` / `notifyOnNutLoss` (optional, read via `confirmedMoreNotify`, count only while `notifyConfirmedAt` is set). `setNotifyFlag` always sends all five flags; the server unsubscribes only when all five are off, and the login refresh and `removeWatchedMint` treat any of the five as "subscribed". The server sends the DMs (see backend-api-and-data.md "More alerts" DMs). **Real limits (2026-10-12):** Goes down / Goes up at most one per mint and direction per hour; Mint/melt issues at most one per mint per 12 h; Version outdated and Lost NUT04/05 at most one per mint per 24 h, and only after the condition has been clear for 12 consecutive probes (about an hour); at most 40 DMs per day per subscriber across everything, then one summary DM and the rest dropped. A DM is a fixed text + the mint's host name + a mintradar.org link, never text from the mint. The pills carry no tooltip that states a frequency (only `aria-label`s), so nothing there needed changing; the frequency is stated in the explainer below and (for deletion) the About item; the README only says that alerts are rate-limited and gives no numbers. Since 2026-10-14 an open row also shows `.notify-more-note` (what triggers each alert, at most one message per 12 h for mint/melt and 24 h for the others), built by `moreAlertsNote()` in `src/utils/tooltipTexts.ts`.
- **Explainer** (once, above the grid, hidden for an empty watchlist, 11.5px `--text3`; wording fixed 2026-10-03): "Optional Nostr DMs: one when a watched mint goes down, one when it's back (max once an hour each, 40 a day in total). With any alert on, you also get key and fee changes. Needs a Nostr client with private messages." (Shortened 2026-10-22, Task G2, from a 6-line text at 390 px; the dropped "even if this tab is closed" and "More alerts" clauses are not pinned any more. History: More-alerts clause added 2026-10-12; the key/fee sentence added 2026-10-22, Task G1: `notifyMintChanges` sends those two DMs to every subscriber of the mint with at least one of the five flags on, there is no pill for them, so the text says so. The current text is pinned by `src/__tests__/displayedNumbers.test.ts`, `e2e/notification-copy.spec.ts` and `e2e/watchlist-notify-toggles.spec.ts`.) The server's 60-minute cooldown is per direction (`last_notified_down_at` / `last_notified_up_at`), so it is "one of each per hour", not "one per mint per hour". It can only arrive when the subscription exists, the server has `NOTIFICATION_SERVICE_NSEC` (the client cannot tell) and the user's Nostr app reads NIP-17 from one of the target relays (stored NIP-65 read relays ∪ the server's default list, no kind:10050 lookup) — so no text promises delivery.
- **Copy rule (2026-10-03):** notifications are opt-in, so no string may promise automatic ones. Reworded: both watch-login modals (`MintCard`, `MintDetail`: "…You can then turn on an optional Nostr DM for this mint when it goes offline or comes back online."), the login gate + hint, the empty state, the explainer, the Watchlist meta description ("…optionally get a Nostr DM when one goes offline or comes back online.") and Learn Module 5. The root README (since 2026-10-20 the only README) says DMs "can arrive even with the browser tab closed … delivery is not guaranteed". `index.html` descriptions never promised notifications. `e2e/notification-copy.spec.ts` scans the Watchlist page, gate, empty state, both modals and the meta description for "you'll get / you will get … notif|message|alert", "get notified", "notifies you" and "the moment", and requires "optional" wording in the gate and modals.
- **Notifications are sent ONLY by the server (2026-10-04).** The browser never publishes a DM on its own: the old in-browser hook `useWatchlistNotifications` (called from `Dashboard.tsx`) was removed. It published a NIP-17 DM to the user's own identity (a) when a watched mint's Reliability Score moved 10+ points between two fetches — even with every pill off, which contradicted "optional, off by default" and caused 2–3 unrequested signer approval prompts — and (b) on down/up transitions when a pill was on, duplicating the server's DM (the server has the per-direction hourly cooldown, the browser path had none). Now the only signer use for notifications is the NIP-98 signature of a pill press / the login-time `refreshAllSubscriptions`; there is no score-change message at all. `NOTIFICATION_RELAYS` (fallback relays sent to the server when the user has no NIP-65 read relays) now lives in `notificationSubscription.ts`; the backend keeps its own copy.
- Tests: `e2e/watchlist-notify-toggles.spec.ts`, `src/__tests__/notificationSubscription.test.ts`, `notifyState.test.ts`, `useWatchlistSync.test.ts`; `watchlist-card-action-row.spec.ts` now sweeps the strip's pills.

### One-time notice for notifications that were switched off (2026-10-03)

- `useLegacyNotifyNotice(pubkey)` (`hooks/useLegacyNotifyNotice.ts`, used by `Watchlist.tsx`) shows `.queued-banner.queued-banner-info.wl-legacy-notice` (`role="status"`, × dismiss, above the explainer and the cards; the `.wl-legacy-notice` override makes the shared banner fill the page column): "Notifications are now confirmed with the server before they show as on. The ones you had turned on before are shown as off. Turn them on again for the mints you want."
- **Who:** `hasLegacyUnconfirmedFlag(entries)` (`utils/notifyState.ts`) = some watched mint has a local flag ON without `notifyConfirmedAt`. Nothing creates such a row any more (`addMint` and `useWatchlistSync` default to off; `setNotifyFlag` writes the flags and `notifyConfirmedAt` in one `update`), so it is only the pre-change population. It is a live Dexie query, so the notice **disappears by itself** once every such mint is re-enabled (confirmed) or removed; it never shows for a new watchlist or for someone who never had a flag on.
- **Dismissal** is stored per account in Dexie `meta` under `legacyNotifyNoticeDismissed:<pubkey>` (same store as `watchlistOwner` and the flags; survives reload and logout; another account's dismissal does not count). Purely local: no request, no signer prompt, no logging.
- Tests: `e2e/watchlist-legacy-notify-notice.spec.ts`, `src/__tests__/notifyState.test.ts`.

### Removing a watched mint cancels its notifications (2026-10-03)

- Both star handlers (`MintCard`, `MintDetail`) call `removeWatchedMint(url, displayName)` (`core/nostr/removeWatchedMint.ts`) instead of the store's `removeMint`. It reads the Dexie entry, **removes the mint locally first** (never waits for the request), and then — only if a local flag is on (confirmed OR an unconfirmed legacy flag, whose server row the old login sync may have created) or a toggle request for that mint is still running — sends ONE `cancelSubscription(url)` (`/unsubscribe`, one NIP-98 signature from the user's own click, queued behind any running request for the mint via `runExclusive`). Both flags off/unconfirmed-false → no request, no signer prompt. Re-adding a mint starts with both pills off (fresh Dexie row, no `notifyConfirmedAt`).
- **Failure** (network, 429, 5xx, signer declined/unavailable): the mint stays removed and `useWatchlistStore.pushNotice()` queues "Couldn't turn off notifications for <name>. They stop within 30 days." — rendered by `AppShell` as `.queued-banner.queued-banner-info.watchlist-notice` (`role="status"`, × dismiss, max 3 kept; the same banner pattern as the stale-nsec notice, so it shows on whichever page the removal happened). Nothing is logged.
- Not covered (user-initiated removals only): a mint that disappears because the synced kind:10003 list changed on another device, or a logout, does not unsubscribe — those server rows lapse via the 30-day prune.
- Tests: `e2e/watchlist-remove-cancels-notifications.spec.ts` (shared setup in `e2e/fixtures/watchlistNotify.ts`).

### Watchlist — "Recommended by follows" below the list (2026-10-02)

- **No side column any more.** `.wl-body-two-col` / `.wl-side-col` (380px sticky column, ≤900px stacked) are gone; `.wl-body` is one centred `--dash-chrome-max` column, so `.wl-grid` has the full page width like the Dashboard grid (4 cards per row at 1440 instead of 2).
- **`FollowRecommendations` renders below the grid** (inside `.wl-main-col`, after the pagination sentinel — same position in every state, so the card grid never changes with this data). **Loading → nothing** (the old 3-row skeleton is deleted, no flash of the empty line). **Query error (`isError`) → nothing.** **No recommendations → `.wl-rec-slim`**: one line, `min-height: 44px`, same panel look (`.wl-rec-panel`): label "RECOMMENDED BY FOLLOWS" (`.wl-rec-panel-title`, uppercased in CSS) · `NIP-87` badge · muted 11.5px "None from your follows yet" (`.wl-rec-slim-text`). It wraps (≈62px) only where the three parts can't share a line (phones). **With recommendations** → the same panel with heading + subheader, rows in `.wl-recs-list`, now a `repeat(auto-fill, minmax(260px, 300px))` grid (1 column ≤600px) like `.wl-grid`.
- **Data flow untouched** (`useFollowRecommendations`: kind:3 → kind:38000 on `FOLLOW_RELAYS`, 8s/12s timeouts, 5-min staleTime, UI keeps online + not-yet-watched, max 3). Gotcha: `fetchFollowRecs` swallows relay errors/timeouts into an empty result, so a relay failure still shows the "None from your follows yet" line; only a thrown error (`isError`) hides the section.
- Tests: `e2e/watchlist-recommendations.spec.ts` (empty / with recs / loading / error, identical card layout in both states at 1440/768/390, no overflow at 320–1920; `SHOTS=<dir>` writes screenshots). The error case reroutes the dev-served `useFollowRecommendations.ts` module so `fetchFollowRecs` throws.

### Watchlist — "Showing X of Y" only when cut short (2026-10-02)

- The footer line (`.wl-showing`, `Watchlist.tsx`) renders only when `showWatchlistCount(shown, total)` (`utils/watchlistCount.ts`) is true: `total > 0 && shown < total`. Complete list → no element at all (no empty block, no spacing). The Watchlist has no filter/search, so this only happens past one 20-card page that has not been scrolled to the end yet. The Dashboard's `.grid-showing-note` is a separate element and unchanged. Tests: `src/__tests__/watchlistCount.test.ts`, `e2e/watchlist-showing-count.spec.ts`.
- **Pagination observer fix (2026-10-03):** the `IntersectionObserver` effect in `Watchlist.tsx` used to depend only on `listKey`. The sentinel `<div>` exists only after the skeleton is gone (`knownLoading || syncStatus === 'pending'`), so a list that arrived from Dexie (or the relay) while the skeleton was still up found no sentinel, and the effect never re-ran once the grid appeared — a watchlist of more than 20 mints stayed at "Showing 20 of N" forever. The deps are now `[listKey, knownLoading, syncStatus, visibleCount]` — `visibleCount` re-creates the observer after every page, because an IntersectionObserver reports only CHANGES and a sentinel that stays in view after a page was appended (browser scroll anchoring) never fired again (seen as an intermittent "Showing 40 of 60" stall). Page size and layout unchanged. Test: `e2e/watchlist-load-more.spec.ts` (60 mints: list from IndexedDB during the sync skeleton, list ready before the known-mints skeleton ends, list from the relay; all 60 cards after scrolling, `.wl-showing` gone).

## Stats board grid (2026-10-15) — current layout, supersedes the grid description in the sections below

`.stats-board-grid` (Stats.css) is one CSS grid with named areas; only layout changed, no text, data or component behaviour.

| Breakpoint | Areas |
|---|---|
| desktop, 1280 px and up | `nhi nhi now now` / `top nut nut geo` / `mov trend trend trend` on four tracks 353 : 107 : 246 : 294 (row 1 about 46/54, row 2 about 3 : 3 : 2.5, row 3 about 35/65) |
| tablet, 768 to 1279 px | two equal columns: `nhi now` / `top nut` / `geo mov` / `trend trend` |
| mobile, below 768 px | one column: nhi, now, top, nut, geo, mov, trend |

Areas: `nhi` Network health index, `now` The network right now, `top` `.stats-stack` (Top by Reliability Score above Software in use), `nut` NUT coverage, `geo` Geographic distribution, `mov` Reliability Score movers, `trend` Reliability Score trend.
The NHI breakdown dialog still keys off the JS `isMobile` (768 px and below), not off the grid.

- **DOM order rule:** the markup order is the reading order at every breakpoint (nhi, now, top, nut, geo, mov, trend). No CSS `order`, no placement that puts a card visually before an earlier one, so keyboard Tab order follows the visual order. Change the markup when the order changes.
- **Gap:** one token, `--stats-board-gap` (16 px, 10 px at 768 px and below), for rows, columns and the stack.
- **Equal height:** `align-items: stretch`; content stays at the top of each card.
- **Reserved heights** (typical loaded height, so the page does not jump when data lands; cards may still grow): geo 300 px, movers 280 px, trend 240 px (260 / 240 / 220 px at 768 px and below). The Network health index, the left stack, the page header and the loading screen reserve theirs too: see "Layout shift rule" below.
- **Desktop geo list:** the narrow third column shows cities and the CDN bucket as one list (the inline two-column row template is reset at 1280 px and up).
- **Layout fixes (2026-10-15, 1280 px and up unless noted):**
  - **Geography list row pitch:** 26 px (24 px minimum row + 2 px row gap), one column; text and flags unchanged, same click behaviour. A 21-row list at the old 36 px pitch made the geography card 845 px tall and stretched row 2 (NUT coverage and Software in use had 170 to 250 px empty). Do not cap, group or scroll the list. Tablet keeps its two columns.
  - **Left stack:** `.stats-stack` cards grow by their natural size (`flex: 1 1 auto`), so the Software card does not get half of a large surplus.
  - **Movers:** Risers and Fallers sit side by side (grid on the aria-busy wrapper; DOM order stays label, rows, label, rows), so row 3 is low (about 300 px).
  - **Trend chart fills the card:** the chart wrapper is a flex child (`flex: 1 1 0`, `min-height: 120px`, `position: relative`; its inline `height: 120px` is overridden with `!important`) and the recharts container is `position: absolute; inset: 0`. The chart must NOT drive the row height: with a normal in-flow `height: 100%` chart the card and the chart would size each other (resize loop or a taller row). The row height comes from the movers card. Tablet and mobile keep the 120 px chart.
  - **One accepted exception to the DOM order rule (below 768 px only):** The network right now is shown first and Network health index second (the two names are swapped in the mobile `grid-template-areas`; `order` would not work on cards placed by area). The DOM order is unchanged, so on phones with a hardware keyboard Tab visits Network health index before The network right now.
- **Row 1 look (1280 px and up, 2026-10-15):** The network right now has centred tiles with the dividers and the outdated-software bar as a boxed amber row. The Network health index factors sit next to the ring with 6 px bars and even spacing, and the legend (Healthy, Moderate, At Risk) stays above them on one row (12 px, 8 px gap; it wraps only if the column is too narrow). A one-line "label | bar | value" row was tried and dropped: the label carries weight and tooltip, the value carries percentage and points, so no usable bar is left at this width. Tablet and mobile are unchanged. **Outdated row box (2026-10-16):** the outdated-software row has the same amber box (border, tint, 10 px radius, 12px 16px padding) at every width, declared once in the base `.stats-now-behind > div` rule; only the tile centring stays 1280 px and up. At 320 px the label wraps and the percentage stays on the first line. Test: `e2e/stats-widgets.spec.ts` ("keeps the same box on phones").
- **New card:** add it to the markup after the trend card with the class `stats-extra-panel`; it fills a full-width row after the named rows. To put it in a named row instead, add an area name to all three `grid-template-areas` blocks (desktop, tablet, mobile) and keep the DOM position equal to the reading position.

## Layout shift rule (2026-10-20)


**Lazy route fallbacks (Task X, 2026-10-21).** The footer is part of the layout shift too: when a short fallback ("Loading…") is replaced by a long page, the footer leaves the first screen and counts as a shift (0.104 on `/tools` at 390 x 844, 0.0564 before Task U made the page taller; 0.14 on Mint Detail). `App.tsx` therefore gives Stats, Tools and Mint Detail one `viewportFallback` (`min-height: 100vh`), and Mint Detail's root has `min-height: 100vh / 100dvh` in every state (Task Y M, `card-and-mint-detail-ui.md` "Mint Detail minimum height"; it first was `.mint-detail-pending { min-height: 100vh }`, pending state only). Measured with a layout-shift observer on a production build, 3 loads each (identical every time): `/tools` 390 px 0.104 -> 0, 1440 px 0.003 -> 0.0063 (the footer moves INTO view once: the page is shorter than the viewport there); Mint Detail Overview 390 px 0.178 (with the pending stage) / 0.143 -> 0.0605, 1440 px 0.076 -> 0.060. `/tools` was 0.0564 at `68db837d` (W5a) and `1fbd6c8d` (W7a), 0.104 at `4c44f5e9` (after Task U). What remains on Mint Detail is the About and Get in touch panels, which come with the mint's live `/v1/info` data (description, contacts): their size is the mint's, so it is not reserved. Spec: `e2e/layout-shift-tools-mint.spec.ts` (budgets: `/tools` 0.05 at 390 px and 0.02 at 1440 px, Mint Detail load 0.1, a tab change 0.02); mutation-checked (the Tools fallback back to the short one: 0.104 fails; `.mint-detail-pending` emptied: 0.178 fails).
**Rule: any card whose data arrives later reserves its LOADED height** (a `min-height` in its CSS, taken from a measurement of the loaded state at each breakpoint, never from an estimate), so nothing visible moves when the data lands. A reservation is the smallest loaded height of its width band, so it never exceeds the loaded height by more than a few px and never clips. Spec: `e2e/stats-layout-shift.spec.ts` (every endpoint held in turn, plus "all at once" and "known last": layout shift below 0.02 at 1440, 1024, 768, 390 and 320; the reservations against the loaded heights). Fixture: `e2e/fixtures/statsLayout.ts` (50 online mints, 20 geography rows with a CDN row, 5 software families, 3 risers and 3 fallers, a 30 day trend; `mockStatsEndpoints(page, held)` holds an endpoint until the request reached the mock).

What moved, measured on that fixture before the change (phone: Lighthouse reported 0.247 on the live page; the same page measured 1.08 here):

| What | Why it moved |
|---|---|
| Footer (up to 0.9 at 390 px) | While `/api/stats` is pending the page is a short "Loading…" screen with the footer in view; the board then pushes the footer out of view. The route fallback had the same problem one step earlier. |
| Page header (about 0.02 at 1440, 0.04 at 390) | (History: the loading screen had the short `.stats-header` (59 px) and the loaded page the taller `PageHead`; both are `StatsPageHead` now) (75 to 109 px). React reuses the DOM node, so the board starts 29 to 50 px lower than the waiting block did. |
| Network health index (0.07 to 0.37) | Its card is not rendered until `/api/mints/known` arrives, so row 1 was only as tall as "The network right now" and everything below moved down 90 to 130 px. |
| Left stack (`.stats-stack`) | Top by Reliability Score shows "No data yet" and Software in use shows "No data" while known mints load; the stack grew from 250 to 561 px on a phone. |
| Waiting block width (1440 px) | The full-width "Loading…" block became the centred board (`--dash-chrome-max`), a 58 px sideways move. |

The reservations (all in `Stats.css`, values as `--stats-reserve-*` custom properties on `.stats-page`, one value per width band, minimum of the band):

| Block | Rule | Values (px) by width |
|---|---|---|
| Page header | none since Task D3b: the loading and error screens render the same `StatsPageHead` as the loaded page | 96 up to 518, 75 for 519 to 640, 109 for 641 to 670, 88 from 671 |
| Waiting block | `.stats-loading { min-height }` (becomes the board in place; also takes the board's max width and centring) | 2730 up to 767, 1616 at 768, 1822 for 769 to 1279, 1326 from 1280 (keeps the footer below the fold) |
| Network health index | `.stats-board-grid::before { grid-area: nhi; min-height }` (an empty box: the card does not exist before its data does; the card later sits in the same area) | 181 up to 767, 275 at 768, 355 for 769 to 1007, 333 for 1008 to 1269, 310 for 1270 to 1279, 346 from 1280 |
| Left stack | `.stats-stack { min-height }` = Top by Reliability Score + Software in use + gap | 618 up to 329, 583 for 330 to 359, 561 for 360 to 409, 521 for 410 to 767, 538 at 768, 659 for 769 to 799, 618 from 800 |

Also: the `/stats` route fallback (`statsFallback` in `App.tsx`) is as tall as the viewport (`min-height: 100vh`), because the footer must be below the fold from the first painted frame. It has no `.stats-*` classes: `Stats.css` is in the lazy chunk and is not loaded while the fallback shows. Since Task D3b (2026-10-22) it paints the page header (`StatsPageHead`, `src/components/stats/StatsPageHead.tsx`, not lazy, no data: the single source of the title and the description) and a "Loading…" note with the box of `.stats-loading`; the loading, error and loaded states of Stats.tsx render the same component, so the header never changes text or height. Local 150 ms / 1.6 Mbit/s / CPU 4x, median of 3: `/stats` LCP 2592 -> 2184 ms (3344 ms before Recharts went lazy). Pinned by `e2e/stats-header-first.spec.ts`.

Result (same fixture, worst case of every endpoint held 1.5 s, all released at once, known last): layout shift 0.0000 to 0.0019 at 1440, 1280, 1024, 768, 390 and 320 px; the document height and the boxes of the main cards after loading are unchanged (0 px, at most 0.3 px). A reserved block with nothing to fill it (known mints fail: no Network health index) leaves an empty area of its reserved height.

**How to re-measure** (after a change to a card, a font, the header text or the breakpoints; the spec's `LOADED` table fails by name and band when the loaded page drifted):
1. A scratch Playwright script OUTSIDE the repo (a folder with a `node_modules` symlink to the app's, a config whose `webServer` is `npm run dev` with `cwd` the app and `reuseExistingServer: true`), importing `mockStatsEndpoints` from `e2e/fixtures/statsLayout.ts`.
2. Layout shift: an init script with `new PerformanceObserver(...).observe({ type: 'layout-shift', buffered: true })` (skip `hadRecentInput`), keep `value` and `sources` (node, previous and current rect), `takeRecords()` before reading.
3. Per viewport (and for a width sweep 320 to 1600 in steps of 10, then 1 px steps around every change) and per held endpoint: hold the endpoint, wait until `gate.reached`, wait 1.5 s, release, wait for `networkQuiet` and `layoutReady`, read the shift total and its sources; for the loaded heights read `.page-head`, `.stats-nhi-panel`, `.stats-stack` and `.stats-board-grid`, for the waiting state `.stats-header` and `.stats-loading` with everything held.
4. Set each `--stats-reserve-*` value to the smallest loaded height of its band (a band ends where the loaded height changes), update `LOADED` in the spec, and run the spec. Rects of a layout-shift source are clipped to the viewport (a card that moves out of view reports `[0, 0, 0, 0]`), so read heights from `getBoundingClientRect`, not from the sources.

**Movers note reservation (2026-10-21, refined the same day).** The muted methodology note under the movers (see "Movers note" below) makes the board taller. Stats.tsx adds `has-movers-note` and `movers-note-n<1|2|3>` (number of changes in the window, capped at 3) to `.stats-page` from the SAME condition that shows the note (`moversMethodologyNote(methodologyChangesInWindow(selected window)) !== ''`, so it follows the real date and the 7d/30d toggle). Stats.css turns that into `--stats-reserve-note`, the note's REAL height (8 px margin + 6 px padding + lines), added to `.stats-loading` (the waiting block, always the default 7d window) and to the movers card's `min-height` (280 / 240 px at 768 px and below). The note is part of the first paint of the board (it depends on date and period, not on data). The note is 12 px at 767 px and below (phone text floor, `e2e/mobile-polish.spec.ts`; it was 11.5 px and failed there) and 11.5 px above. Values measured at every width 320 to 1600 px (1 px steps) for 1, 2 and 3 changes: one line 31.25 px (768 px and up) / 32 px (phones), two lines 48.5 px / 50 px. Where the line count flips: n1 wraps up to 372 px; n2 wraps up to 449 px, at 768 to 919 px and from 1280 px; n3 wraps up to 533 px, at 768 to 1087 px and from 1280 px (1 change is 45 characters, 2 about 56, 3 about 68 at the dates of the tests). **Limit:** the edges depend on the text length, which depends on the dates (`9 Oct` vs `21 Oct`); a window with four or more changes is treated as three, and a text at an edge can differ from the reservation by one line. Re-measure with the sweep described under "How to re-measure" when a methodology entry is added. `e2e/stats-layout-shift.spec.ts` runs with the real date (its `LOADED` table has the board WITHOUT the note plus a `note` column); the `movers note reservation` cases (5 widths x 6 dates, 1 / 2 / 3 / no changes, 7d and 30d) pin a date on purpose, because with the real date the 7d note disappears a week after a change, and assert reserved against the real note height within 1 px. Mutation-checked: 11.5 px on phones fails mobile-polish; reserving one line where the note wraps fails 15 cases; reserving without the condition or not at all fails the not-shown / shown cases.

Mutation-checked: removing the stack's `min-height` fails the reserved-heights test at every width and the "stack and the cards after it already stand where they will" test at 768 px and below; doubling it fails "loaded stack" at every width. (The shift limit alone does not catch the stack: on desktop the row is held by NUT coverage, on a phone the stack's own growth happens below the first screen; the height assertions do.)

## Recharts loads when the chart is drawn (Task D3b, 2026-10-22)

`ReliabilityTrendChart.tsx` (card body, `ReliabilityTrendView`) no longer imports Recharts. The chart itself is `ReliabilityTrendPlot.tsx`, loaded with `React.lazy` inside a `Suspense` whose fallback is the loading note, in the fixed 120 px `.stats-trend-body`, so nothing moves when it lands. The Stats route chunk therefore does not pull `vendor-charts` (~99 kB gzip): `/stats` LCP 3344 -> 2592 ms (local 150 ms / 1.6 Mbit/s / CPU 4x, median of 3). The chart appears later than before (it is fetched once the trend data has arrived). The Stats-tab warm-up and `/` no longer download `vendor-charts`. Pinned by `src/__tests__/statsChartLazy.test.ts`. Mint Detail (`MintDetailHistoryChart`) and the Compare modal keep their own recharts imports.

## Stats idle warm-up starts after the mint list (Task P2 part 2, 2026-10-21)

`AppShell` warms the Stats page (lazy chunk + `/api/stats`; Recharts is no longer part of it since Task D3b) in an idle moment so a first click without a hover finds it loaded. It used to start at app start, in the same seconds in which `/` downloads the mint list and the icons. Now `scheduleStatsWarmup()` (`src/core/mint/prefetch.ts`) waits until the `['mints-known']` query (`KNOWN_MINTS_QUERY_KEY`) has settled (data or error), then one painted frame (the cards are in the DOM), then `requestIdleCallback`. It runs once per session. If nothing ever asks for the list (About, Methodology, ...) it starts after `STATS_WARMUP_FALLBACK_MS` (5 s); while the list is being fetched it waits however long that takes.

**`/stats` itself is not skipped and does not wait** (`waitForList = false`): the task text suggested skipping it there, but the warm-up on `/stats` fetches `/api/stats` in parallel with the lazy chunk, and skipping it made the Stats LCP ~200 ms later (3144 -> 3352 ms, local 150 ms / 1.6 Mbit/s / CPU 4x). The hover/focus/touch warm-up of the Stats tab is unchanged. Pinned by `src/__tests__/statsWarmup.test.ts` and `e2e/stats-prefetch-order.spec.ts` (nothing of Stats is requested while the list is held at the mock; chunk and data start after the first `.mint-card`; hover still warms at once; fallback on `/about`; `/stats` not delayed). Because the warm-up now happens later (after the list), a spec that asserts "nothing is requested" on a page that reads the list has to let it finish first: `payment-request.spec.ts` (decoding sends nothing) waits for the `/api/stats` request and `networkQuiet` before it starts watching. After Part 1 the lab order on `/` was already "card first" by accident of main-thread load; with a slower list API (+1.5 s) the old code started the chunk before the cards (2050 vs 2985 ms), the new code after them (2967 vs 2759 ms, and the cards arrive ~226 ms earlier).

## Methodology markers, modal populations, hints (W5a, 2026-10-20)

- **Methodology marker on the Reliability Score trend.** `ReliabilityTrendChart` draws a thin dashed copper vertical line (`ReferenceLine`, class `stats-trend-marker`) with a `v<N>` label at each `METHODOLOGY_CHANGES` entry whose date lies inside the shown data (30d and 90d). Entry 0 (the initial formula, v1) is not a change and is never marked. The line sits on the first data date on or after the change date. Logic in `src/utils/methodologyMarkers.ts` (`trendMarkers`, `placeMarkerLabels`: a label goes right of its line, or left of it when a line follows closely (so the labels read in the order of their lines) or the plot edge or another label is in the way, and drops one 12 px row when both sides are taken, so two adjacent days (v2 8 Oct, v3 9 Oct) never overlap). It is plain SVG inside the existing chart: the X ticks, the reserved heights and the card layout are unchanged. Text alternative: a `.sr-only` line in `.stats-trend-body` ("Methodology changed to v3 on 9 Oct."), one sentence per marker. Specs: `src/__tests__/methodologyMarkers.test.ts`, `e2e/stats-methodology-marker.spec.ts` (1440/768/390/320 px, 30d and 90d).
- **Movers note.** When the selected movers window (7d or 30d, ending now, UTC dates) contains a methodology change, the panel's `footer` slot shows one muted line (`.stats-movers-note`, 11.5 px mono `--text3`, same as `.stats-movers-empty`; both are 12 px at 767 px and below, the empty line since Task X: `e2e/mobile-polish.spec.ts` route `stats-no-movers` scans the Stats page with empty movers): "Includes a methodology change on 9 Oct (v3)." or, for several, "Includes methodology changes on 8 Oct (v2), 9 Oct (v3).".
- **Cards and their modals count the same mints.** The cards count ONLINE mints (NUT coverage via `/api/stats` `nutAdoption`, Software in use and Geographic distribution from the online known mints), but the modals behind them listed offline mints too (35 vs 32, Nutshell 0.21.0 11 vs 14, CDN 16 vs 18). The NUT coverage modal (`nutModalMints`), the Software in use mint list (`drilledMints`) and the Geographic modal (`cityMints`) now filter `online === true`, and each shows the muted footnote "Offline mints are not counted." (`.nut-modal-note`). The footer still reads "N online · 0 offline". The "Other locations" modal and the version list already counted online mints. A new card/modal pair must filter the same population as its card.
- **Hints must match the click.** The Software in use card says "Click for versions" (it said "Click to filter", but the click opens the version breakdown). The other hints on `/stats` ("Click a row to list them" on NUT coverage) were checked and are right.

## Reliability Score trend: axis and loading (2026-10-16)

Code: `src/components/stats/ReliabilityTrendChart.tsx` (chart + card body), `src/utils/trendTicks.ts` (tick choice), `src/hooks/useReliabilityTrend.ts` (query + prefetch). Specs: `src/__tests__/trendTicks.test.ts`, `src/__tests__/reliabilityTrendLoading.test.tsx`, `e2e/stats-trend-axis.spec.ts` (fixture `e2e/fixtures/trendSeries.ts`). The Y axis (0 to 100), the tooltip, the summary line and the data are unchanged.

- **X axis rule.** Ticks are chosen BY DATE, not by index: the newest data date minus multiples of a step of 7, 14, 21 or 28 days. The step is the smallest of these that leaves at least 64 px between neighbouring labels at the current chart width (the first-to-last-point span, container width minus 36 px; recomputed on resize through `ResponsiveContainer onResize`). If even 28 days is tighter than 64 px, 28 is used. The newest date is always the last tick. The label is the short format ("16 Oct"); when the ticks cross a calendar year, the first label of the new year also shows it ("1 Jan 2027"). The last label is right aligned (`textAnchor: end`) so it ends at the chart edge, the label of the oldest point (when it is a tick) is left aligned, the others are centred. **Desktop is denser (above 768 px, `useIsMobile`):** steps 2, 3, 7, 14 or 28 days and a 56 px minimum (`DESKTOP_TREND_TICK_STEPS`, `DESKTOP_TREND_TICK_MIN_SPACING`), because a wide chart with the mobile rule got big gaps. Expected at 1440 px: 30d every 3 days (10 labels), 90d weekly (13); mobile (768 px and below) uses 7/14/21/28 and 64 px: 390 px 5 labels in BOTH periods (90d every 21 days, added 2026-10-16 so a phone shows the same count in 30d and 90d), 768 px 30d 5, 90d 7; 320 px 3 and 4.
- **Categorical axis, nearest point.** The chart is categorical (`dataKey="date"`, one point per day, evenly spaced). `XAxis ticks={dates} interval={0}` takes values that exist in the data, so each target date is mapped to the NEAREST data point; with a gap in the series two targets can land on one point (deduped, spacing measured between the chosen points). A series shorter than the step shows only the newest date. Known edge: a "1 Jan 2027" label next to the right-aligned last label has less than 8 px of gap at exactly 64 px spacing (not hit by 30d/90d at the tested widths).
- **Custom tick.** A function tick does not receive the `tick` styles of the axis: the font (9 px mono, `--text3`) is applied in the component (`AXIS_TICK`).
- **Loading rule.** `useReliabilityTrend` uses `placeholderData: keepPreviousData`. While the other period loads, the previous chart stays in the DOM, dimmed (`.stats-trend-body.is-pending`: opacity 0.5, `pointer-events: none`, `aria-busy`), and the toggle already shows the requested period as active (`trendDays` is component state, not query data). The summary line names the period of the data on screen (`periodDays` of the response), so "90d High" never shows 30d numbers. First load with nothing to show: the existing `LoadingNote`. **"No data yet" only for a SUCCESSFUL response with an empty `trend`.** A failed request shows `LoadError` (same sentence as the page-level statistics error, Try again refetches); before this change the chart had no error state and a failed request showed "No data yet". The card body keeps its reserved 120 px (and the card its min-height) in every state.
- **Cause of the old flash.** The query key includes the period and had no placeholder data, so after a click `data` was `undefined` until the response arrived, and `!trendData` rendered "No data yet" for the full request time.
- **Prefetch decision: yes.** The 90d response is about 90 rows, about 3.9 KB raw and 0.5 KB gzipped (measured on a 90-row payload of the endpoint's shape; the endpoint has no cache header). It is below the 20 KB bar, so after the first SUCCESSFUL load the other period is prefetched once when the browser is idle (`requestIdleCallback`, `setTimeout` fallback) with `retry: false`. A failed first load never prefetches. `staleTime` is 10 minutes, so switching back and forth issues no request.
- **Server side time (measured 2026-10-16, fixed the same day).** `EXPLAIN (ANALYZE, BUFFERS)` on production: the 90d aggregate was a Seq Scan over 1.34 M of 1.57 M rows, 1308 ms; 30d 683 ms; `MIN(checked_at)` 326 ms (parallel seq scan); `mint_history` 526 MB. No index helps (the 90d window is 85% of the table; all indexes lead with `url`). The 2 to 3 s the owner saw was this scan under load. Fix (backend, `index.ts`): each period is cached in process for 10 minutes (`Cache-Control: public, max-age=600`, strong ETag, same shape as reliability-movers), concurrent misses share one query pair, both periods are computed at startup and refreshed every 9 minutes (`setInterval`, `unref`), so a visitor normally never pays for the scan; an error answers 500 and is not cached. Tests: `backend/src/__tests__/integration/reliability-trend.test.ts`, `cache-headers.test.ts`. A rollup table is the next step only if the table grows far beyond 90 days of probes.

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
  behind latest release"**, shown under the panel title. **Replaced 2026-10-09:** the bar is now
  **"Tracked mints running outdated software"** — the share (`swFreshnessSummary.pct`) of the
  Nutshell / cdk-mintd mints that are OUTDATED (two or more minor versions behind the newest stable
  release of their software, `shared/versionRule.ts`); other software is not in the denominator. The (i) tooltip says exactly that.
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
  known"; median latency notes "from Nuremberg". Avg mint uptime subtitle: `f2b25ff` set it to
  "across all known (offline pulls it down)"; `781617d` trimmed the parenthetical → **"across
  all known"**.
- **NHI "Online mints" row tooltip** (`f2b25ff`) — now explicitly says `"<n>/30 are NHI points
  (this row is 30% of the index), not <n> mints online. Dashboard listed/online counts are a
  different set."` so it can't be confused with the Dashboard's online headcount. The
  panel-level ⓘ makes the same point.
  **Superseded 2026-10-14:** the wording is now generated by `nhiOnlineRowText()` (see "Network Health
  Index definition and tooltip texts" at the end of this file); the "Dashboard default grid" claim
  was wrong and is gone.
- **Most Reliable panel opens on the Reliability tab (2026-10-07)** — `reliableTab` default is `'reliability'` ("Top Reliability Score"); the Uptime tab ("Top Uptime · 7D") is one click away. Tab order and labels unchanged.
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
- **Movers exclude test mints (2026-10-09):** `computeReliabilityMovers()` (`backend/src/reliabilityMovers.ts`) drops every mint for which `isTestMint(url)` (`backend/src/testMints.ts`, the same manual list as the `/api/stats` leaderboards) is true BEFORE the threshold and the top-3 cut, in both windows (7d, 30d), so a test mint never takes a slot from the next mint. The filter is server-side only (the panel renders what the endpoint returns); stored scores and the rollup are untouched. The panel's `.stats-panel-desc` reads "Test mints are not included." (shortened 2026-10-17; the title already says what the panel shows) The backend list is a manual mirror of `src/constants/testMints.ts`; `src/__tests__/sharedModules.test.ts` fails when the two drift.
- **Audit-source note under Reliability Score movers — REMOVED 2026-10-09 on request** (the "How scoring works" link, `auditSourceSwitch.ts`, its tests, `.stats-movers-note`). `ReliabilityMoversPanel` keeps its optional `footer` prop, unused. Same day: the Uptime tab title is "Top uptime" (no "· 7D"); the Network health ⓘ tooltip opens downward, anchored left (the tooltip itself was removed 2026-10-14, see mobile-and-tooltips.md); compact breakdown rows and the legend use larger type.
- **Software in Use panel** (`781617d`) — "Running outdated or older versions" →
  "Behind current release" + a `.stats-sw-behind-info` (i): "we compare the version each
  mint reports to the latest known release for that implementation — not a CVE or security
  score." **Superseded 2026-09-12 (`c3523db`):** the subtitle text itself was changed again, to
  **"% of tracked mints behind latest release"** — see "Stats Page Layout" above. The (i)
  tooltip content and the old 75% rank-based formula were replaced on 2026-10-09 (see above).
- Tests: `e2e/stats-widgets.spec.ts`, `e2e/stats-nhi-gauge.spec.ts`,
  `src/__tests__/geoDistribution.test.ts` (`normalizeGeoLoc`).

## Mint counts — single helper, archived included (2026-09-30)

**Supersedes the "archived excluded" rule and the "Online X/Y (Y = non-degraded)" wording below.**
`src/utils/mintCounts.ts` (`trackedCount`, `onlineCount`, `isPoolHidden`, `hiddenByDefaultCount`;
tests `src/__tests__/mintCounts.test.ts`, `e2e/mint-counts.spec.ts`) is the one definition used by
Dashboard and Stats. **"Tracked" = every mint in the DB, archived included** (= `/api/stats` `totalMints`
= `/api/mints/known` length; the public API is unchanged and the UI says what it says).
- Dashboard header: `<online> online mints` · `<tracked> tracked mints` (both counts show an em dash while `/api/mints/known` is pending, never 0); grid footer
  "Showing X of <tracked>" (the Filters panel shows the same numbers on its "Show X of <tracked>" button, for the draft); Stats "Mints Tracked" / "Online Now" use the same helper.
- Counts in visible text go through `pluralize(count, noun)` (`src/utils/plural.ts`): "1 mint hidden", "2 mints hidden"; never write `{n} mints` by hand where `n` can be 1.
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

Verified: typecheck ✅, build ✅, unit tests ✅ (counts: "Test suites" in CLAUDE.md), Playwright confirmed both scenarios (Status=Offline shows offline mints including 24h+; Reset restores default state).

### Dashboard controls row (2026-09-05)

- **"Most reviewed" sort** — a 5th sort button (`sortBy: 'reviewCount'`), placed before
  Rating, ordering mints by `reviewCount` descending; mints with `reviewCount` 0 or `null`
  always sort last regardless of direction toggle. Same `reviewCount ?? 0`-last convention
  used for tie-breaking as the Rating sort (see "Rating sort uses a weighted/Bayesian
  rating" and the 2026-10-09 confidence-adjusted change in reviews-and-nostr.md). e2e coverage in `e2e/dashboard.spec.ts`.
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
- **Stats hero notes (2026-09-30):** `.stats-metrics .stat-note` may wrap so "of all known" / "active mints" / "from Nuremberg" stay inside the tile when the five-up row shrinks (~1140px). Labels and counts unchanged.

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

**Why mints vanish under a Unit filter (2026-10-02):** (1) the "UNIT" label sits in `.filter-field-labelcell` (same fixed width as the Status label, so segmented controls stay aligned) next to an `InfoTooltip` (`.filter-unit-tip`, `openOnFocus`, 12px, popup anchored `left: -27px` so it stays on-screen at 320px, 44px `::before` hit area on touch) explaining that mints with unknown or non-SAT/USD/EUR units are hidden; the label itself remains plain text. (2) `UnitHiddenNote` appends a muted `· N hidden: units unknown | other units | units unknown or other` to the existing "Showing X of Y" line (grid + list) only while a unit is selected and N > 0. N = mints that pass every *other* filter (Status, Reliability, test-mints, text search) but have `units` null/empty ("unknown") or no SAT/USD/EUR at all ("other", e.g. msat). A mint that is merely on another of the three units (USD while SAT is selected) is ordinary filtering and not counted. Computed in `Dashboard.tsx` (`unitExcluded` memo, one extra `applyFilters` pass) via `countUnitHidden`/`unitHiddenNote` in `unitFilter.ts`. Panel height unchanged (176px at 390, 56px wide, no unit tag). Filter logic, URL params and the "Show N of M" button untouched.

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
One layout for every width, `.filter-bar` = flex-wrap (Dashboard.tsx / Dashboard.css). Children in order: **Status** `.filter-field` = plain-text `.filter-field-label` (id `filter-status-label`; mono 10px uppercase `--text3` like the Reliability label, no fill/border/divider, `cursor:default`, not focusable, fixed width shared with the Unit label so both controls start at the same left edge) + `.filter-seg` (`role="radiogroup" aria-labelledby`, native `input[type=radio] name="filter-status"` inside each `label.filter-seg-opt`, input is `opacity:0` + `inset:0` so it stays focusable/arrow-key native; selected = `.active` + patina tint), **Unit** `.filter-field` (label id `filter-unit-label`) + `.filter-seg` (`role="group" aria-labelledby`, buttons keep `.filter-unit-chip[data-unit]` + `aria-pressed`), **Reliability** `.filter-rel` (label `RELIABILITY ≥ N%` with a `4ch` min-width value + the unchanged range input), **`.filter-footer`** = `Hide test mints` checkbox (`.filter-check`) + `.filter-actions-row` (Reset · primary **"Show N of M"**). **Option look (2026-10-01):** the segmented control is a button row — 1px `--border-strong` frame (`::after` overlay so options stay 28px), each option filled `--surface-3` with `--border2` dividers, hover (`@media (hover:hover)`) = lighter overlay + `--border-strong` inset border, `:active` = `--surface-2`, focus-visible = 2px `--accent` outline offset 2px (z-index 1), selected = accent-dim tint over the raised fill + `--accent` text + inset `--accent-brd` border. One row fits down to 1125px (was 1140); panel heights unchanged (56 wide / 100 tablet / 176 at 390 / 220 at 320); no label-above fallback needed down to 320px.
- The segmented control mirrors `.wizard-unit-seg` (Tools): 28px visible (the 1px frame is a `::after` overlay so the segments inside are the full 28px), option text 12.5px (`font-size` of `.filter-seg-opt`; it was briefly 10px in `6ed4592`/`20b0541` and became 12.5px in `8225e41`, 2026-10-08), `min-width: 44px` and `padding: 0 8px` per option (`min-width: 0` at ≤600px). The 44px touch target is an invisible `::before` of each option extending 8px above and below only (28 + 8 + 8 = 44, never sideways), active under `@media (pointer: coarse), (max-width: 600px)`, so with a mouse above 600px the hit area is just the 28px. Rows are `--filter-row-gap: 16px` apart (also in the stacked layout at ≤600px) so the 8px bands of neighbouring rows meet exactly instead of overlapping. (Reset has a border so its `::before` is -5px.) Hover only under `@media (hover: hover)`. The slider paragraph below still quotes the old 36px / 4px numbers and has not been re-measured.
- **Reliability slider touch target (2026-10-02):** under `@media (pointer: coarse)` only, `.filter-slider` is `height: 44px; margin-block: -8px; position: relative; z-index: 1` — a range input can't take a `::before`, so the input itself grows while the negative margin keeps its 28px layout box (panel/row heights identical to a mouse context at 1440/900/390/360/320; native track + thumb stay centred, ≤1px antialiasing difference on the thumb). **Trade-off:** the 8px gap to the Unit row above / footer row below is shared with those rows' 4px `::before` bands; the slider wins that overlap (z-index), so those controls lose the 4px band on the slider-facing side (visible 36px untouched, hit area 40 instead of 44 there). The `hit areas are ≥ 44px with a coarse pointer` test accepts a point inside the slider's box as the slider's. Tests: `Reliability slider touch target` in `e2e/dashboard-filters-panel.spec.ts` (touch contexts, CDP touch drag, tap, panel metrics vs mouse context).
- **"Show N of M"** replaced both the old `Apply filter` button text and the separate `Showing N of M` line. It commits the draft exactly like the old button (state + URL, panel closes, scroll to top). `N` = `draftCount`, a `useMemo` over the same pure `applyFilters` + pool chain as `filteredMints` but fed with the **draft** (`pendingFilters`) — the old line used the *committed* `activeFilters`, so it did not follow the draft; both agree whenever draft == committed. Only computed while the panel is open. `M` = `knownTotal`. `aria-label="Show N of M mints"`, deliberately **no `aria-live`** (every slider step would be announced). `font-variant-numeric: tabular-nums` + `min-width: calc(15ch + 24px)` so the width never changes with the count. N = 0 keeps the button enabled (applies an empty result, as before). **Width test (2026-10-03):** the button is 700-weight JetBrains Mono with `font-display: swap` and its `min-width` is `calc(15ch + 24px)`, so until the Bold face has arrived its width steps through fallback values (123 → 125.5 → 127 → 129px, reproduced by delaying `/fonts/**`). `document.fonts.ready` alone does not cover it (the face is requested only after the button's first layout), so the tests (`button width does not change with the count`, `…does not jump between one-digit and three-digit counts` with 120 mints) call `document.fonts.load('700 11px "JetBrains Mono"')`, wait for the measured width to stop changing and then allow 1px. Settled widths: 129px for `Show 120 of 120`, `Show 1 of 120`, `Show 0 of 120` — no app bug; without the `min-width` the three-digit test fails (129 → 115px).
- Panel edges: `width: calc(100% - 2 * var(--page-pad))` (max `--dash-chrome-max` − 2·pad), so below the chrome max it is inset like the Search row and cards (it used to run edge to edge on phones).
- Measured thresholds (cards view, 12 mints): wide row (56px) from ≈1135px; below that the footer wraps to a 2nd line (100px). Mobile (≤600px): 174–176px at 361–600px (Status, Unit, Reliability, footer rows); footer fits one row down to **360px**; at ≤359px the checkbox gets its own row and Reset + Show share the next (≈220px).
- Tests: `e2e/dashboard-filters-panel.spec.ts` (radio click/arrows, unit multi-select, live count, Reset, edges at 390/1440, no overflow 320–1920, heights, 36px, coarse-pointer hit areas), `e2e/dashboard-unit-filter.spec.ts`, `e2e/mint-counts.spec.ts`.

## Geographic Distribution layout (2026-10-07, owner mockup)
Title row (icon kept) + subtitle "City from the IP address, not where the operator is." (`.stats-geo-sub`). The CDN / anycast bucket (`CDN_BUCKET`) is NOT a city: it gets its own full-width row above the cities (`.stats-geo-cdn`: 🌐 + label + count in the first column, the note "these are not a city." in the second; one column on ≤700px) and is excluded from `geoCities`, which split into two balanced columns (`ceil(n/2)` rows). City rows: flag in a fixed 26px cell (`.stats-geo-flag`, emoji flag, so Windows shows letters as before), name in the body font 15px, count muted; no underline any more (the pointer + hover background stay). Every row, CDN included, still opens the same city modal (`setCityModal`); "View others →" and "Geolocation unavailable" lines are unchanged. Tests: `e2e/stats-widgets.spec.ts` (Geographic cases), `e2e/modal-dialog-semantics.spec.ts`.

- **Software cards and modal labels (2026-10-09):** the version list shows only **`latest`** (green) and **`outdated`** (amber) chips from the one shared rule (`classifyVersion`, `shared/versionRule.ts`; latest = `softwareLatest` sent by `/api/mints/known`). The old rank-based `latest / outdated / old` labelling (rank 0 / 1 / rest) and the red `old` chip are gone: a version one minor behind, a pre-release of the current line and unknown software get no chip. Versions are sorted with `compareMintVersionNumbers` (`0.20.3.1` above `0.20.3`, a stable version above its pre-releases). The Stats note under "Reliability movers" is untouched. Tests: `e2e/stats-software-modal.spec.ts`, `e2e/stats-widgets.spec.ts`, `e2e/badge-contrast.spec.ts`.

## Network Health Index definition and tooltip texts (2026-10-14)
`src/utils/networkHealthIndex.ts` holds the weights (`NHI_WEIGHTS`: online 30, reliability 25, diversity 15, advanced 15, stability 15 — they add up to 100), the advanced-feature list (`ADVANCED_NUTS`), `DEGRADED_AFTER_HOURS` and every text that describes them. `Stats.tsx` computes the index from the same constants (the score arithmetic is bit-identical to the old `* 0.30 …` literals: `30/100 === 0.30`), so a changed weight or feature list changes the tooltip with it. `src/__tests__/networkHealthIndex.test.ts` pins that, plus `e2e/tooltip-facts.spec.ts` for what the browser shows.

Inputs, as computed:
- **Online mints (30):** share of mints with `online === true` among mints whose `degraded` is not true — i.e. all mints except those that are offline with a last probe older than 24 h (or 4+ probes all failed; `backend/src/degraded.ts`). Test mints are included. Mints never probed count as not online. `DEGRADED_AFTER_HOURS` is the frontend twin of `STALE_OFFLINE_MS`; the test compares them.
- **Avg. Reliability Score (25):** `/api/stats` `avgReliabilityScore` = mean of `last_reliability_score` over mints whose latest probe is online; a null score counts as 0; test mints included; `null` (nobody online) → 0.
- **Software diversity (15):** `(1 − HHI) × 100` over the software-name distribution of online mints that report a version (`versionDist`).
- **Advanced feature adoption (15):** plain average over `ADVANCED_NUTS` (11, 12, 14, 17, 21, 22, 25, 30 — NUT-27 and NUT-28 were in the list until 2026-10-14, see the last paragraph). NUT-11/12/14/17/21/22 use `nutAdoption[NUT-nn].percent` (`/api/stats`, over online mints that have a stored `nuts_limits`; a NUT it does not return counts as 0%). **BOLT12 (25) and on-chain (30) are payment METHODS advertised inside NUT-04/05, not `nuts` keys (W5a, 2026-10-20):** their entries carry `method` ('bolt12', 'onchain') and `methodAdoptionPercent()` counts, over the SAME population as `/api/stats` (online mints with a stored `nuts_limits`, test mints included), the mints that list the method in `mintMethods` OR `meltMethods` of `/api/mints/known` (`methodsHaveMethod`, case-insensitive), rounded like `/api/stats`. Before this, the keys 25/30 were looked up in `nuts`, where they never appear, so both counted 0%. No scoring or weight change, no methodology version bump (the NHI is not the Reliability Score).
- **Tracking history (15)** (was "Network stability" until 2026-10-20; the label never said what is measured): share of ALL known mints (offline ones too) whose `mintAgeBadge` is not "Fresh", i.e. whose `discoveredAt` (the day MintRadar first saw the mint) is at least `FRESH_MINT_MONTHS` (1 month = 30.44 days) ago; a mint without `discoveredAt` counts as known for a month or more. It measures how long MintRadar has known the mints, not how stable the network is; a stand-in for churn. Text: `TRACKING_HISTORY_TEXT` (`tooltipTexts.ts`). The weight key in `NHI_WEIGHTS` is still `stability` (internal).

**Measured 2026-10-14 (read-only):** of 24 online mints that answered `GET /v1/info` (cdk-mintd and Nutshell), all report 11/12/14/17; none reports 21, 22, 25, 27, 28 or 30. The probe stores the whole `nuts` object verbatim in `nuts_limits` (`prober.ts`), `/api/mints/known` returns it unchanged, and across all 73 known mints the union of keys is 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 17, 19, 20, 29. So nothing is dropped; 27/28 are simply not offered (they are wallet-side specs, see `TRACKED_NUTS` in `src/constants/nuts.ts`), and `/api/stats` does not list them (`MINT_ADVERTISED_NUT_KEYS`), which reads as 0%. Result: advanced adoption was 39.2 of 100 (4 of 10 features nonzero) and cannot reach 100 while 27/28 stay listed. The index definition was deliberately left unchanged; the texts now say it ("a feature no mint offers counts as 0%"). Open owner decision: keep 27/28 in (permanent ceiling) or take them out of the index.

Wording rules: no "Dashboard default grid" (the Dashboard default is online-only, the NHI/uptime sets are not); the Online share is called "share of online mints", never "uptime"; the average-uptime tile skips mints without probe data and includes test mints.

**NUT-27 and NUT-28 left the index (2026-10-14, owner decision).** They are wallet-side specs that no mint ever advertises (see `TRACKED_NUTS` in `src/constants/nuts.ts`), so they were permanently 0% and capped the component: with all 10 features the live value was 39.2, with the 8 that remain it is 49.0 (the same four features at 100/100/98/94, divided by 8 instead of 10). Only `ADVANCED_NUTS` changed — the generated tooltip no longer names "Nostr backup" or "pay-to-blinded-key". Mint-side features stay in the list even when nobody advertises them yet (NUT-21, 22, 25 and 30: 0 of 24 sampled mints on 2026-10-14), because they can be adopted. Untouched: `NHI_WEIGHTS`, `DEGRADED_AFTER_HOURS`, the Reliability Score, `/api/stats` and the backend (`MINT_ADVERTISED_NUT_KEYS` still lacks 27/28, which is now irrelevant to the index). The "NUT coverage" panel iterates `TRACKED_NUTS` only, so it never showed 27/28 and is unchanged. The index arithmetic moved into `nhiScore()` in `src/utils/networkHealthIndex.ts` (same operations, so the rounding is identical) so a test can pin it by hand.


## Error states: an API failure is never shown as a mint state (2026-10-14)

**Rule.** When `/api/mints/known` fails (HTTP error or no network after the query's 2 retries), the page shows the error state instead of anything derived from the missing list. It never shows a mint as offline, unknown or absent, never "Not a tracked mint", and never zero counts ("0 online mints · 0 tracked mints"). This is not a mint state: it is "we could not ask".

**Component.** `src/components/LoadError.tsx` (+ `.css`, built from the `RouteError` card styles): `<LoadError message onRetry />` renders `role="alert"` with a fixed sentence and a **Try again** button; `MINT_LIST_ERROR` = "Could not load the mint list. Please try again."; `<LoadingNote />` is the quiet `role="status"` "Loading…". Callers pass literal sentences only — never `error.message` or anything from the server body. Try again calls the query's `refetch()` (no other request); while it runs the query is pending again, so the page shows its normal loading state, then the data or the error state again.

**Where.**
- Mint Detail (`MintDetail` wrapper, before the URL is resolved): header with Back + `LoadError`; while the list is still loading, `LoadingNote` (it used to be an empty page with only the back arrow, also after a failed request). "Not a tracked mint" only appears for a list that loaded and does not contain the slug.
- Watchlist: `LoadError` in place of the grid when there are watched mints and the list failed (cards built from the fallback object read "offline" / "n/a"). With nothing watched, the normal empty state stays.
- Home (`Dashboard`): `LoadError` in place of the grid; the `.dash-status` strip is not rendered while the list failed.
- Only when nothing is loaded: a failed background refresh with data in the cache keeps showing the data.
- Mint Detail's live probe (`/api/mint/probe`, 2026-10-17): a failed call (HTTP error, no network, timeout) makes `probeMint` throw instead of returning `online:false` / "Mint unreachable"; `useMintProbe` then does not write an offline check to the local history, the page keeps rendering from the stored mint (`isOnline = data?.online ?? knownMint?.online`) and the Mint info panel shows `LoadError` (`LIVE_DATA_ERROR`, Try again = `refetch`). `ComparisonModal`'s fee cell reads "n/a" for a failed probe. Tests: `src/__tests__/probeMintProxy.test.ts`, `e2e/error-states.spec.ts` ("failing live probe"), backend `mint-probe.test.ts`.

Tests: `src/__tests__/loadErrorStates.test.tsx` (component + each page's error branch), `e2e/error-states.spec.ts` (500, network error and a slow response that then fails: error state, no mint state, Try again recovers once the mock is healthy). **Stats and NUT Explorer (2026-10-14):** they own their data (`/api/stats`, `/api/nuts`) and use the same `LoadError`: "Could not load the statistics. Please try again." and "Could not load the NUT data. Please try again." with Try again (`refetch`); the old "Failed to load …" lines are gone. Tests: `src/__tests__/statsNutsLoadError.test.tsx`, and the second loop of `e2e/error-states.spec.ts` (500 and network error, then healthy and Try again). The other pages keep their own lines (not touched).


## Stats modals: footers and the CDN row (2026-10-20)
The footers of the NUT coverage, Software in use and Geographic distribution modals read "N online" (the "· 0 offline" part is gone: offline mints are filtered out and the note under the footer says so). The "CDN / anycast addresses are not a city" explanation moved from a `title` on the card's CDN row to a visible `.nut-modal-note` line in the CDN bucket's modal. Tests: `stats-card-modal-counts`, `stats-nut-coverage-modal`, `stats-software-modal`, `stats-widgets` specs. CLS of `/tools` at 390x844 is 0.056 both before and after W5a (the footer is pushed out when the lazy page replaces its fallback, 0.051, plus the wizard options, 0.005); not a W5a effect, not fixed.

## Dashboard: no-results state, refresh vs reset, archived movers, phone list cut (2026-10-25)

- **No results** (`NoMintsMatch` in `Dashboard.tsx`, `data-testid="no-mints-match"`, `role="status"`): shown in both views when the list is empty because of a search or a filter. Title "No mints match “q”" (search) or "No mints match these filters"; when both are on, a line says filters may hide mints too. Buttons "Clear search" (clears `q`, focuses the search box) and "Reset filters" (only while a filter is on), and a link-style "Know a mint we don’t list? Add mint" that opens the Submit dialog. An empty tracked list with no search / filter keeps the old behaviour.
- **Refresh is only a refresh.** The toolbar's icon button is "Refresh mint list" (aria-label and title): it re-fetches `['mints-known']` and leaves search, sort and filters alone. Resetting the filters is the filter panel's "Reset" (same `resetFilters()`: draft and committed filters back to `DEFAULT_FILTERS`). The old combined "Reset filters & refresh" is gone.
- **"Add a mint" from another page:** navigating to `/` with `state: { openAddMint: true }` (the bad-naddr page does) opens the Submit dialog once (keyed by `location.key`) and the history entry is replaced without the state, so Back or a reload never reopens it.
- **Stats Reliability movers without archived mints** (`src/utils/reliabilityMovers.ts`): the rows from `/api/stats/reliability-movers` are filtered against the known-mints list (`archived === true` leaves). Until that list has loaded, the rows show unchanged. The panel can therefore show fewer than 5 rows; that is deliberate (an archived mint is no longer probed, its "movement" is history ageing).
- **Phone list: first 10 online mints** (`src/utils/mobileCollapse.ts`): at ≤640 px, in the default view (no search, `countActiveFilters() === 0`, Status "Online") both views show the first `MOBILE_COLLAPSED_ONLINE` (10) ONLINE mints in the current sort order, then a full-width "Show all N" button (`data-testid="show-all-mints"`, N = online mints in the result, 44 px tall). Only online mints are cut: mints revealed by the "N mints hidden (offline 24h+) Show" toggle keep their place and that toggle is unchanged. "Showing X of Y" counts the rows actually shown; **while the list is cut** (2026-10-25, `showingNoteText`) it counts online mints only — "Showing 10 of 50 online" (plus " · N offline" when the hidden-mints toggle revealed rows) — because the tracked total (e.g. 62) next to "Show all 50" read as a contradiction. Uncut (desktop, tablet, expanded phone list, search/filter) the copy is unchanged. Expanding is remembered for the tab (`sessionStorage` `mintradar:dash-expanded`) so Back from a mint page restores the same rows and scroll. A search, any non-default filter or Status All / Offline shows everything. Tablet (641 px+) and desktop never cut. Tests: `src/__tests__/uiQuickWins.test.tsx`, `e2e/ui-quick-wins.spec.ts`.
- **Compare:** the audit row is "No mint fault (7d)" (`COMPARE_AUDIT_LABEL`, was "Audit success"; it is the x / y of swaps WITHOUT a failure attributed to the mint, not the overall success rate, so "success" overstated it; 18 characters fit the 160 px label column with its ⓘ). "NUT Support" has an ⓘ (`COMPARE_NUT_SUPPORT_TEXT`): green = the mint lists the NUT in its `/v1/info` as supported, grey = it does not list it or marks it `{ supported: false }`. The chips and the Backup row use `supportedNutKeys` (`utils/nutSupport.ts`), the same rule as the score and the Mint Detail NUTs tab (before 2026-10-25 Compare tested `nutsLimits[key] != null`, so `{ supported: false }` showed green).
