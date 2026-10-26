# MintRadar — e2e conventions (Playwright)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.

How the specs in `e2e/` are written, what the permanent specs protect, and the application findings they turned up (2026-10-14/15, task "P4b").
Run commands and mocking strategy: CLAUDE.md ("Testing Infrastructure"). Tooltip component and its contract: `mobile-and-tooltips.md`.

## Rules for every new or touched test

- **Skips conditioned on the run mode or the viewport are allowed** (the `SHOTS=<dir>` screenshot tests, the tooltip text updater `TT_WRITE_TEXTS=1`, mobile-only or desktop-only cases): the `test.skip` carries the reason as its message. Skipping a test to hide a failure stays forbidden, and so does `test.fixme` (see the next rule).
- **No `waitForTimeout`.** There is none left in `e2e/` (grep proves it); do not add one. No longer global timeouts, no `test.retry`, no `test.fixme` / `test.skip` (a spec that does not apply to a state is not generated for it), no weakened assertions.
- **Wait for something the browser can report.** An auto-retrying `expect`, an awaited mocked response, a visible and stable element. `e2e/fixtures/settle.ts` has the helpers:
  - `frames(page, n)` — n painted animation frames (not usable after `page.clock.install()`).
  - `layoutReady(page)` — web fonts loaded + 2 frames. Use it before a measurement or screenshot instead of a sleep.
  - `resize(page, w, h)` — `setViewportSize`, then waits until `innerWidth` says so + 2 frames.
  - `scrollToStable(locator)` — `scrollIntoView`, `toBeInViewport()`, and a bounding box that is identical across two frames.
  - `flush(page)` — the barrier for **negative** assertions ("nothing was requested", "the list did not change"): 2 frames, one message-channel task and a request to a route the test serves itself. Requests are intercepted in the order the page issued them, so when the barrier is answered, every request the page had already started has reached its route handler. It does not prove that nothing happens *later*; it proves nothing the page had already started is still on its way. Always call it AFTER the positive condition the test awaited (a pill that flipped, a card that left), never instead of it.
  - `trackRequests(page)` / `networkQuiet(page)` — in-flight request set + "none in flight across 3 frames" (replaces `networkidle`, which always pays 500 ms). Call `trackRequests` before the first navigation.
- **Held mocks release only after the request reached the mock.** The pattern of `fixtures/watchlistNotify.ts` (`await api.release()` polls until a gated request is waiting) is the model; `watchlist-recommendations.spec.ts` (`release()` / `requested()`), `submit-modal-lookup.spec.ts` (`inFlight(key)` / `release(key)`), `fixtures/auditCz.ts` (`heldAtMock()`), `error-states.spec.ts` (`slowGate()`), `layout-overflow.spec.ts` (fonts and late reviews) follow it. A mock that sleeps (`setTimeout(…, 2500)`) to "be slow" is not allowed: hold it and let it through.
- **Read state only after the thing that produces it.** A click that triggers a mocked request is followed by the observable result (a pill, a text, the request landing in the mock's list) before the test reads anything derived from it. The Token Inspector tooltip state read the page before the inspection result existed (1 run in 6 saw no trigger at 1024 px); `mint-detail-audit-cz.spec.ts` read tile colours before the tiles existed. Both were races of this kind.
- **Explicit expected counts.** A check that iterates "whatever it finds" passes with nothing to iterate. `e2e/fixtures/tooltipExpected.ts` lists, per tooltip state and viewport, the minimum number of triggers and of opened triggers (`null` = the state does not exist there). A state with 0 says why.
- **Measure the placed tooltip.** `open()` in `tooltips-contract.spec.ts` waits for `visibility: visible`: the box exists first at left/top 0 (hidden); reading its rectangle earlier always lands inside the viewport. Before 2026-10-15 this made the "inside the viewport" check vacuous for placement.
- **No real network.** Every spec mocks `/api/**` (`fixtures/mocks.ts`) and the relay sockets (`routeWebSocket`). `page-hygiene.spec.ts` additionally aborts-and-fails any request to a host other than the app and reports any `/api/` request no mock handles (the dev proxy would answer 502).

## The permanent specs and what each protects

| Spec | Protects |
|---|---|
| `tooltips-contract.spec.ts` (+ `fixtures/tooltipStates.ts`, `tooltipExpected.ts`, `tooltipExtract.ts`, `tooltipHitArea.ts`, `tooltip-texts.json`) | The one tooltip component on every page and state: button, named, ≥24×24, no overlap; hover/tap opens exactly one box wired by `aria-describedby`, inside the viewport (also for a trigger pinned to the left and right edge: the horizontal clamp), not covering the trigger; Escape; keyboard; second tap / tap outside; dialogs; no navigation from a card trigger; survives a refetch; texts equal the fixture (1440 and 390 px). Mouse at 320 / 390 / 768 / 1024 / 1440, touch at 320 / 390 / 768 (see below). |
| `modal-dialog-semantics.spec.ts` | Per dialog: role, `aria-modal`, accessible name, initial focus, Tab / Shift+Tab trap, focus back to the trigger, Escape (tooltip first), outside click, a named close button, scroll lock (CSS), no side scroll at 390 / 320. |
| `dialogs-contract.spec.ts` | Per dialog at 1440×900 and 320×640 (Login also 390×844): close button ≥32×32 and not clipped (its centre hits the button), dialog box inside the viewport and scrolling inside itself when taller, a wheel over the backdrop does not move the page (the page is made scrollable with a spacer first). Dialog list: `fixtures/dialogCases.ts`, shared with the semantics spec. |
| `modal-consistency.spec.ts` | Login and Watch-login look the same (width, close box, title font) from the Dashboard, a mint page, the Watchlist and Stats. |
| `copy-buttons.spec.ts` | Every copy button not covered elsewhere: the clipboard holds exactly the expected string, a confirmation shows and goes away by itself (Mint Detail public key / URLs / contacts / reviewer npub / review link / QR dialog; every code block on `/for-wallets`, the attestation npub and hex, the curl example). Also asserts the Methodology page and the Watchlist have no copy button. Elsewhere: account menu (`profile-dropdown`), share link (`mint-detail`), pairing link (`login`), keyset id (`mint-detail-keysets`). |
| `keyboard-and-landmarks.spec.ts` | On 11 routes + a rich Mint Detail state: lang, one h1, one main / footer, nav count, no skipped heading level, every link / button / field named (own DOM walk **and** the accessibility tree via `ariaSnapshot()`), every img with `alt`, no duplicate id, first interactive element within 3 Tab stops, first 12 stops in DOM order with a focus indicator that differs from the unfocused style (element, its pseudo-elements, 3 ancestors), none hidden or zero-size. |
| `page-hygiene.spec.ts` | On the same routes at 390×844 and 320×640: no console message of type error or warning (no allow-list), no page error, no response ≥ 400, no failed request, no unmocked `/api/`, no stranger host, no `securitypolicyviolation`, no horizontal overflow, no element wider than the viewport, no visible `undefined` / `NaN` / `null` / `[object` / `{{` / `Infinity` (code blocks are skipped; `/for-wallets` documents `null`, so only that word is exempt there), every image loaded; a mint icon the (mocked) proxy answers 204 for falls back to the monogram. States `home` and `mint-icon` (Mint Detail whose mint claims an icon) assert that the icon proxy was really requested. |
| `stats-trend-axis.spec.ts` (+ `fixtures/trendSeries.ts`) | Stats Reliability Score trend: X axis labels (few, 8 px apart, inside the chart, newest last, equal 7/14/28 day steps) at 1440/768/390/320 px for 30d and 90d; the previous chart stays dimmed while the other period is held at the mock, "No data yet" only for a successful empty response, load error on a 500, prefetch of the other period, no request when switching back, no layout shift. See `stats-dashboard-watchlist-ui.md`. |
| `stats-layout-shift.spec.ts` (+ `fixtures/statsLayout.ts`) | `/stats` does not move while its data arrives: each endpoint held in turn (released only after the request reached the mock), all at once and "known last" at 1440/1024/768/390/320 px, layout shift below 0.02; the reservations (`--stats-reserve-*`) match the loaded heights of the fixture within 12 px and the waiting block takes the board's place. See `stats-dashboard-watchlist-ui.md` ("Layout shift rule"). |
| `mobile-polish.spec.ts` | At 390 and 320 px: no HTML text below 12px on every audit route and every Mint Detail tab (allow-list: `role="img"` monograms, SVG, `.sr-only`), `.nhi-show-details` ≥ 24×24, no overflow and the sort buttons inside the viewport on Home, and the Home status strip: `/api/mints/known` is held until the request reached the mock, then the layout shift after release is < 0.02 and the strip, its items and the controls keep their boxes. See `mobile-and-tooltips.md` ("Phone text floor"). |
| `payment-request.spec.ts`, `token-inspector-decode-verify.spec.ts`, `mint-detail-nutzap.spec.ts` | W7a: the Payment request inspector (decodes locally — a test asserts that no request carries the pasted string; targets are text, never links; one calm message for malformed input; 320 px), the Token inspector's Decode / Verify split (Decode stays while Verify is pending or fails) and, on Mint Detail, the one Nutzap sentence under the NUT compatibility grid (`mint-detail-nutzap.spec.ts`; the Overview panel is gone since Task U). `mint-detail-fees-limits.spec.ts` now opens the NUTs tab (first card) and `mint-detail-change-log.spec.ts` the History tab (no card without rows; version_changed rows not listed). |
| `error-states.spec.ts`, `layout-overflow.spec.ts`, `long-text-overflow.spec.ts` | API failures never look like mint states; no horizontal overflow; third-party text never widens the page. |

### Tooltip contract: why touch has three widths

Mouse runs at 320, 390, 768, 1024 and 1440 px. Touch runs at 320, 390 and 768 px: `isMobile` is on up to 768 px, and 1024 / 1440 px are the same desktop layout the mouse run already covers; what is touch-specific (tap, second tap, tap outside, the clamp at 320 px) is exercised in full at the three widths. Mutation-checked: removing the horizontal clamp (`x = cx - width / 2` in `src/utils/tooltipPosition.ts`) fails `tooltip contract at 320x640, touch`.

### Regenerating the tooltip text fixture

After a tooltip text changes: `TT_WRITE_TEXTS=1 npx playwright test e2e/tooltip-texts-update.spec.ts` (several minutes), then read the diff of `e2e/fixtures/tooltip-texts.json` — it is the list of what users see. After a tooltip is added to or removed from a page: run `tooltips-contract.spec.ts`, read the failure (it names the state, viewport and the number), and update `fixtures/tooltipExpected.ts` with the reason in the commit message. Debugging: `TT_STATES=home,stats` runs only those states; `TT_TIMING=1` prints where the time goes.

## Allow-lists (and why)

- **page-hygiene: no console allow-list and no response ≥ 400 exception** (since 2026-10-20). It used to allow exactly one thing, `Failed to load resource … 404` of `/api/mint/icon` (the mocked proxy answered 404 for "no icon"). The real proxy now answers **204 No Content** for an icon it cannot serve (Chromium prints nothing for a 204 and still fires the `<img>` error event, so `MintFavicon` shows the monogram; measurement in `backend-api-and-data.md`, "Icon proxy"), and every icon mock in `e2e/` answers `status: 204` too. So the spec now requires an empty console and no response ≥ 400 on every route. Do not bring an entry back: an icon mock that answers 404 makes the spec fail on purpose (mutation-checked). Relay websocket warnings need **no** entry either: the relays are mocked, so a real-relay warning appearing here is a regression, not noise.
- **`KNOWN`** in `keyboard-and-landmarks.spec.ts`: removed 2026-10-16 (F4 fixed) — the spec now asserts that every nav has an accessible name and that the names on one page are distinct. A future known defect gets a new, commented entry here.

## Running a spec under load

A flaky test shows itself when the machine is busy. Prove a fixed spec with
`npx playwright test e2e/<spec> --repeat-each=40 --workers=1` (0 failures) and `--repeat-each=20 --workers=4` while a CPU stress runs: start it yourself (for example `for i in $(seq 8); do (while :; do :; done) & echo $! >> $S/pids; done`), and when done kill **only your own PIDs** (`kill $(cat $S/pids)`; check with `ps`). Do not start or stop dev servers by hand: the Playwright config starts its own; if port 5173 is held by a process you did not start, stop and report.

## Mutation proofs (not committed; app edited, spec run, `git checkout -- <file>`)

Each of these makes its spec fail: focus not returned after Escape; Tab trap removed; close button 20 px; dialog `min-width: 480px` at 320; page scroll lock removed; a copy button copying a wrong string (code block and Mint Detail public key); a button losing `title` and `aria-label`; a second `<h1>`; a duplicate `id`; a 900 px wide element in the footer; the tooltip horizontal clamp removed (touch 320); a state that loses all its tooltips (the Stats outdated-software ⓘ at 320).

## Findings — application issues the new specs found (NOT fixed; fix the app, then drop the matching exemption)

| # | Severity | Where | What | Reproduce |
|---|---|---|---|---|
| F1 | — | Home header strip | FIXED 2026-10-16: while `/api/mints/known` is pending the strip shows "— online mints · — tracked mints · last checked —" (never "0 online mints"); `error-states.spec.ts` asserts it and checks that Home shows no mint state while the request is in flight. | — |
| F2 | — | Comparison modal close button | FIXED 2026-10-16: `.cmp-modal-close` (`ComparisonModal.css`) is 32×32 like the other dialogs; `SMALL_CLOSE_FINDING` removed. | — |
| F3 | — | Mint Detail "URLs" copy buttons | FIXED 2026-10-16: the icon swaps to a check for 2 s (per row, via `copiedContact = url-<url>`) like the other copy buttons; `copy-buttons.spec.ts` asserts it. | — |
| F4 | — | Primary `<nav>` | FIXED 2026-10-16: the primary nav has `aria-label="Main"` (the doc pages keep "On this page"); `KNOWN.unnamedNavs` removed, `keyboard-and-landmarks.spec.ts` asserts named and distinct navs. | — |
| F5 | — | Token Inspector | FIXED 2026-10-16: `textarea.token-input` has the app-wide keyboard focus ring (`.token-input:focus-visible`, 2px accent, offset 2px); `NO_FOCUS_STYLE` removed. | — |
| F6 | — | Page structure | **won't fix (owner decision 2026-10-16)**: the flat structure is accepted, the exemption in the spec stays as it is. Home, Stats, Tools, Wallets, Learn, Watchlist and Mint Detail expose only the h1; their section titles are `div`s, so heading navigation finds nothing between the h1 and the footer. No level is *skipped* (the spec asserts that), the structure is flat. | Headings list of a screen reader on `/stats`. |

Not application findings but worth knowing: `installApiMocks` has no answer for `/api/mints/outages` (Mint Detail asks for it; the dev proxy answers 502) — `fixtures/pageAudit.ts` mocks it for the page specs; the older specs that open a mint page log that 502 without failing.

## Skip link and `ui-quick-wins.spec.ts` (2026-10-25)

- The first Tab stop of every page is now "Skip to content" (`a.skip-link`, visually hidden until focused, then fixed at the top left). It moves focus to `main#main-content` (`tabIndex={-1}`) by script, so hash routes are not touched. Specs that count Tab stops from the top start one stop later; `keyboard-and-landmarks.spec.ts` still finds the first control within 3 stops.
- `e2e/ui-quick-wins.spec.ts`: phone list cut (390 px touch, collapsed / expanded / search / filters), 768 and 1280 px not cut, no-results state, refresh keeps filters, skip link, Mint Detail h1 text, archived card / detail / Stats movers, bad naddr page.

## E2E mocking strategy (moved from CLAUDE.md, C3-8)

- **HTTP:** `page.route('**/api/**', …)` with deterministic fixtures in `e2e/fixtures/mocks.ts`
- **Nostr relays (wss):** `page.routeWebSocket(/^wss:\/\//)` stub — replies `["EOSE", subId]` to every `REQ`, `["OK", id, true, ""]` to every `EVENT`. Required because `SimplePool.querySync()` hangs until EOSE; simply closing the socket is not sufficient.
- **NIP-07 login:** `page.addInitScript()` injects `window.nostr` mock (getPublicKey/signEvent/nip04/nip44) and pre-seeds Zustand persist key `mintradar_session` in `sessionStorage`

Note (not a bug): The `+ Watch` button on Dashboard mint cards only renders when `isLoggedIn === true` (intentional — watchlist is identity-bound). E2E tests for the add-to-watchlist flow therefore require a mocked NIP-07 session.
