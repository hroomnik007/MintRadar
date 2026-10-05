# MintRadar — Tools page, Best Mint Wizard, Token Inspector (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
### "Look up a mint" card — added then removed (2026-09-09 → 2026-09-10, commits `af595c4`/`efb19ec`)

A third Tools card (`MintLookup` component) briefly existed as an entry point into Mint Detail:
took a mint URL/hostname and navigated to `/mint/{encodeURIComponent(trimmed)}`, relying on
`resolveMintDetailUrl`'s existing bare-host canonicalization — no mint-info UI of its own. Removed
the next day: the component, its `.mint-lookup-*` CSS, the `#lookup` deep-link hash branch/anchor,
and the `tools-mint-lookup` e2e spec are all deleted. **Tools currently has just the Wizard +
Inspector row** — no third card. `resolveMintDetailUrl` and the `/mint/:slug` route themselves are
untouched, so pasting a bare host into the address bar still resolves correctly; only the Tools-page
entry point for doing that was removed.

### Tools page layout — iterations and final state

Two desktop-layout attempts for the Tools page (`Tools.css`/`Tools.tsx`) were tried and reverted before landing on the final, minimal fix:
- **Attempt 1 (rejected):** `max-width: 420px` on individual elements (`.token-input`, `.tool-btn-primary`, a `.wizard-options-compact` modifier on the Small/Medium/Large option rows). Created dead space inside the panels on wide screens.
- **Attempt 2 (rejected):** `max-width` on the whole content grid via a centered container. Created empty margins on very wide monitors (32"+).
- **Final state:** layout reverted to full width everywhere — panels, the token textarea, and the Small/Medium/Large option rows are all 100% width again, matching the pre-iteration baseline. The only surviving change is the "Inspect Token" button: it got its own `inspect-token-btn` class (kept separate from the shared `.tool-btn-primary`), with `max-width: 280px` and centered, desktop-only.
- Mobile layout was never touched across any of these iterations — confirmed correct throughout.
- The "Tools desktop fix" and "Tools v2" tabs documenting the two rejected attempts lived in `mintradar_redesign_mockup.html`, which has since been deleted (see "Visual Redesign" above) — this list is now the only record of what was tried and why it didn't work.
- **2026-09-20 — wizard button width matched to `inspect-token-btn`.** The wizard's "Find my mints →" button (renamed **"Find my mint →"**, singular) used to render at the full column width on desktop, visibly wider than the Token Inspector's button beside it — it had only `.tool-btn-primary` (100% width), never `.inspect-token-btn`'s desktop-only cap. It now also carries a `.find-my-mint-btn` class, added to the same `@media (min-width: 901px) { max-width: 280px; margin: 0 auto; }` rule as `.inspect-token-btn`, so the two buttons line up at the same width. Mobile (full-width) is unchanged for both. Same pass: **"← Start over"** (the results-screen reset, distinct from the mid-wizard "← Back") got its own `.wizard-start-over-btn` class — the same tonal outline recipe used by `.submit-btn`/`+Watch`/etc. app-wide (`--green-soft` background, `--green-soft-strong` border, `--green-bright` text, `var(--radius-m)`) — instead of sharing `.wizard-back-btn`'s tiny 11px muted text-link style, which read as an afterthought next to the rest of the results UI. `.wizard-back-btn` itself (the mid-wizard step-back link) is unchanged.

### Best Mint Wizard result cards — mobile compaction pass (2026-09-12, commits `d7055b8`→`ccf5ba8`)

Four iterative CSS/markup rounds on `Tools.css`/`Tools.tsx` fixing mobile overflow/wrap in the
wizard's result cards: stacked layout on mobile, then progressively compacted and re-enlarged type
sizes on both mobile and desktop. Final state also **dropped the `<n> NUTs` meta chip** (latency +
uptime % only now) and **compacted large limit numbers** — `formatCompactAmount()` renders
`1_000_000` as `"1M"` / `1_500` as `"1.5k"` instead of `.toLocaleString()`'s `"1,000,000"`, so
`formatLimits()` output fits the narrower card. Score/reliability formatting (`cardReliabilityLabel()` +
`cardLightningLabel()`) from the `781617d` pass below is unchanged.

### Best Mint Wizard (`Tools.tsx` `BestMintWizard`) — 2026-09-08 (commit `781617d`)

- **Disclaimer** — `.wizard-disclaimer` under the "Best Mint for Me" title reads exactly
  **"Suggestions from our measurements, not an endorsement."**
- **Test mints excluded** (`!isNotRecommendedMint(m)`, which is `isTestMint`; see "Not recommended" in discovery-and-relays.md) — `candidates` already filters `!isTestMint(m.url)` (line ~499, see
  "Best Mint Wizard recommendation age gate" below for the 2026-09-19 addition of the
  `isEligibleForRecommendation()` filter right after it); unchanged, but now explicitly a
  requirement.
- **Result rows** — use `displayName(rec.mint)` for the name, and the **card formatting** for
  the score: `IcShield` + `cardReliabilityLabel()` colored by band (`.wizard-rec-reliability`) plus a
  `cardLightningLabel()` `<Zap>` chip (`.wizard-rec-ln`) — replacing the old bare `NN%`
  `.wizard-rec-score`. Per-unit NUT-04/05 limits and the whole-mint caveat note are unchanged.
- Token Inspector is untouched by this pass.

### Best Mint Wizard steps 1–2 redesign (2026-09-28)

Presentation-only; scoring/filters, results, the six `WizardCheck` booleans and the step-1 size
options are unchanged.
- **Step 1 currency** — the native `<select>` is now a `role="radiogroup"` segmented control
  (`.wizard-unit-seg` / `.wizard-unit-opt`, accent-dim tint on the selected segment). As of
  2026-09-29 it is ONE joined control: single 1px outer border + radius, 1px dividers between
  segments, no gaps, selected = accent-dim background + accent text with no border of its own; full
  width on mobile, content-sized on desktop (≥701px); visible height is 36px everywhere. On mobile each
  segment has an invisible `::before` (4px above/below only, no sideways reach) for a 44px tap
  target, so `.wizard-unit-seg` must NOT have `overflow:hidden` (first/last segment carry the
  corner radius instead). Units still
  come from what online mints advertise; display order is the canonical card/filter order from `sortUnits()` (SAT, USD, EUR,
  then other units such as MSAT; changed from SAT, MSAT, EUR, USD on 2026-10-02), default selection = first = SAT.
- **Size labels follow the unit (2026-09-28):** Small/Medium/Large sub-labels come from the static
  `SIZE_HINTS` table in `Tools.tsx` (sat: < 10k / 10k–100k / > 100k sats; msat, EUR, USD: the same
  tiers as ~10M/100M msat, ~€10/100, ~$10/100). **The MSAT/EUR/USD thresholds are approximate on
  purpose** (hence the `~`) — no FX rate is fetched. A unit not in the table shows no hint. `size`
  is only a bucket key (`'large'` adds +0.15 reliability weight in `weightsFor`, and gates
  `ready`); it is never compared with an amount, converted or sent to the backend.
- **Touch hover (2026-09-28):** the wizard's `.wizard-opt`, `.wizard-unit-opt` and
  `.wizard-adv-toggle` `:hover` rules live in `@media (hover: hover)` — on touch, `:hover` sticks
  after a tap and the accent border looked "selected" on a deselected card. Selected state is
  driven only by `.active` / `aria-checked`; keyboard focus rings (`:focus-visible`) are untouched.
  This is the first `@media (hover: hover)` in the codebase; other `:hover` rules are unchanged.
- **Step 2** — Fast / Reliable / Lightning in and out always visible; Restore from seed / Locked
  payments / Live updates sit behind an "Advanced options" disclosure (`aria-expanded`, unmounted
  when collapsed, toggle reads "· N selected" so filters are never hidden). Line icons come from
  `lucide-react` (`Zap`, `ShieldCheck`, `PlugZap`, `KeyRound`, `Lock`, `Satellite`); NUT numbers no
  longer appear in visible text. "Pick at least one" hint shows while nothing is selected.

### Best Mint Wizard recommendation age gate (2026-09-19, audit run-3 follow-up)

**Clarification, since this was re-investigated from scratch before the gap below was found:**
the wizard's result rows (`.wizard-rec-row`, see the two sections above) already rendered as
real, clickable mint cards — favicon, Reliability badge, LN chip, latency/uptime, per-unit
NUT-04/05 limits, click-through to `/mint/:url` — as far back as `781617d` (2026-09-08). It
was never a plain-text recommendation; that was a wrong assumption going into this pass, not
an actual prior state of the code.

The real gap: `candidates` filtered `online`, `!isTestMint()`, and unit support, but was
**missing `isEligibleForRecommendation()`** — the same 14-day minimum-age gate wired into the
backend `top5ByReliabilityScore` and frontend `top5ByReliability` (see "Recommendation-surface minimum age
gate" above), added 2026-09-19 but never applied here even though the wizard is exactly the
kind of "recommendation surface" that gate exists for. Fixed by adding the same
`.filter(m => isEligibleForRecommendation(m.discoveredAt))` call to the wizard's candidate
pipeline (`Tools.tsx`). No other wizard logic (scoring weights, unit/backup-pref filtering,
latency probing) was touched.

Also added: a `.wizard-rec-count-note` line ("Only N matching mints found for `<unit>`...")
when the age gate (or any other filter) leaves fewer than 3 eligible candidates — previously
the wizard silently showed however many rows survived with no explanation for why it wasn't
3; the existing zero-candidates `.wizard-no-results` empty state was already fine and is
unchanged. Tests: `e2e/tools.spec.ts` gained cases for the age-gate exclusion (2 of 3 sat
candidates eligible) and the zero-candidates empty state (the only usd mint in the fixture is
too young); the pre-existing "excludes mints that do not issue the chosen unit" test overrides
that one fixture mint's `discoveredAt` locally via `page.route` + `page.reload()` so it keeps
testing unit-filtering in isolation from the age gate. A pre-existing, unrelated test failure
was also fixed in the same pass — `.wizard-rec-limits` assertions still expected the old
`.toLocaleString()`-style `"1,000,000"` formatting; `formatLimits()`/`formatCompactAmount()`
switched to compact `"1M"`/`"500k"` output back in the 2026-09-12 mobile-compaction pass above
and the test was never updated to match.

### Token Inspector (2026-09-05, `Tools.tsx` + `src/utils/cashuToken.ts`)

- **Memo display** — a decoded token's `memo` field (when present) renders as its own row
  (`.token-memo-row`) in the inspection result.
- **Mint risk badge — REMOVED 2026-09-28.** `mintRiskLevel()` and its `Low/Medium/High risk` /
  `Unknown` badge were deleted (it was only a relabeling of `online`/`degraded`/the Reliability
  Score, and "Low risk" next to an amount read as a safety claim the score doesn't make — it is a
  health signal, not solvency). The Reliability Score and Online/Offline cells are unchanged.
- **"Check if spent" (NUT-07)** — `checkTokenSpentState()` (`src/utils/cashuToken.ts`) asks
  the token's own mint directly whether its proofs have already been redeemed, returning a
  `TokenSpentCheck`. A button in the inspector result triggers this on demand (not automatic
  — doing so tells the mint someone is checking that specific token right now, which the UI
  discloses via a tooltip).
- **`assertProbeableMintUrl()` (`src/utils/cashuToken.ts`, 2026-09-07 audit L4)** — both
  `decodeTokenWithMint()` and `checkTokenSpentState()` call it before `new Wallet(mint)`.
  `info.mint` comes from a fully attacker-controlled pasted token and was handed straight to
  cashu-ts (no host/scheme allowlist), so a crafted token could make the victim's browser
  hit `http://localhost:9200`, `javascript:`, or an internal IP. The guard requires
  `https://`, length ≤ 500, and a public host (rejects loopback / RFC1918 / link-local /
  CGNAT / IPv6 loopback+ULA+link-local) — same policy as `core/mint/api.ts`'s `validateUrl()`
  and the MintDetail "Test latency" guard. Throws a typed `InvalidMintUrlError`; `Tools.tsx`
  renders it as a distinct `"bad-mint-url"` result and makes **no** network request.
- **`InfoTooltip`** (`src/components/InfoTooltip.tsx` + co-located `.css`) — the shared ⓘ
  hover-on-desktop / tap-on-mobile tooltip (`text` / `width` / `iconSize` / `className` /
  `tone` / `label` props; wraps `useTapTooltip`; popup is `role="tooltip"` with its own
  `.info-tooltip-pop` styling so it renders identically regardless of which page stylesheet is
  loaded). Promoted out of `Tools.tsx` (2026-09-08). **Current uses:** DLEQ / NUT-07 in Tools,
  and the `reviewSurge` **⚠** flag (`tone="warn"`) on the Community Rating tile
  (`.review-surge-flag`) + mint card ★ badge (`.card-review-surge-flag`). **The plain caveat
  (i) on `.community-rating-info` / `.card-rating-info` was REMOVED 2026-09-08** — the
  self-published-reviews caveat now lives only in the Reviews-tab `.reviews-disclaimer`.
  Don't re-add a page-local copy of the component.
- **`normalizeMintUrl()` moved to `src/utils/mintFormatting.ts`** (was previously local to
  `Tools.tsx`) — lowercases the hostname, forces `https:`, strips a trailing `/` on a bare
  root path. Import it from there if another page needs the same normalization.

### Token Inspector redesign (2026-09-28)

**Privacy, exactly (this is what the UI line under the textarea says and what the code does):**
the token is decoded in the browser and never sent to MintRadar's servers — it lives only in React
state (no storage API, no query cache, no logging; cashu-ts runs with its NullLogger). Two things
do leave the browser or are handed on, and the copy must not be softened past them: (1) **Inspect & Verify**
contacts the mint named in the token — `GET /v1/info`, `/v1/keysets`, `/v1/keys`, none carrying
token data — and **Check if spent** repeats those and adds `POST /v1/checkstate` with each proof's
`Y = hashToCurve(secret)` (never the secret); (2) **Open in cashu.me** links to
`https://wallet.cashu.me/#token=<raw token>` — the token is in the URL **fragment**, which browsers
never send to a server, so it is not in any query string; but the wallet leaves it in the address bar
(it does not clear it) and so in browser history. wallet.cashu.me reads the fragment verbatim
(`hash.split("token=")[1]` in WalletPage.vue, no URL-decoding), hence the raw token, not
`encodeURIComponent`. **Redeem to Lightning** links to the bare `https://redeem.cashu.me/` — no token,
no query: redeem.cashu.me only pre-fills the token when `lightning`/`ln`/`to` is also present, so a
`?token=` was sent for nothing; the user pastes the token there (hint "Paste your token on the redeem
page." under the action row, hidden when Redeem is disabled). `rel="noopener noreferrer"` + nginx
`Referrer-Policy: no-referrer` keep the page URL out of the Referer header. Verified live 2026-10-02
with a fake token: `/#token=…` opens "Receive Ecash" with the token in the field, `redeem.cashu.me/`
loads with empty fields. A pasted token can also name any public https host, so
verifying can make the browser contact a host the token's creator chose (`assertProbeableMintUrl`
blocks only non-public hosts).

- **Signature check states** — `classifySignatureCheck()` (`cashuToken.ts`) maps per-proof DLEQ
  results to one state: `valid` (every proof carries a DLEQ and all verify — green), `invalid`
  (a present DLEQ was checked and failed — red), `partial` (only some proofs carry a DLEQ, those
  verify — neutral), `unresolved` (a keyset couldn't be resolved — copper), `no-dleq` (no proof
  carries one — neutral). Plus `unreachable` (copper) and `bad-mint-url` (red) from `Tools.tsx`.
  **Fixed on purpose:** partial DLEQ and unresolved keysets used to fall into the red "At least one
  proof failed its DLEQ check". "Valid" says nothing about spent-ness (a spent token still verifies).
- **Spent check** — `classifySpentCheck()`: all-spent (red), all-unspent (green), **all-pending
  (neutral, "the mint is still processing")**, else partial (copper).
- **Input** — `stripTokenWhitespace()` removes ALL whitespace (not just the ends) before parsing
  and before the "Open in cashu.me" `#token=` link is built.
- **UI** — emoji replaced by lucide icons; result copy in the sans font; empty input shows
  "Paste a token first". E2E for the signature states runs real DLEQ proofs against an in-page
  fake mint (`makeDleqMint` / `serveMintInPage` in `e2e/fixtures/mocks.ts`).
- **Guided action flow (2026-09-29)** — order: Check row → its caption or result → action row
  (Redeem to Lightning, View Mint Detail, Open in cashu.me). The old line under the actions ("These open cashu.me with your full token in the link.") was removed 2026-09-29; the privacy line under the textarea was last reworded 2026-10-02 to the `#fragment` / bare-redeem-link wording above ("Decoded in your browser, so MintRadar's servers never see your token; checking contacts the mint named in it. "Open in cashu.me" puts the token in the link's #fragment, … "Redeem to Lightning" opens the redeem page without the token, so you paste it there.") Exactly one action
  carries `.token-action-accent` at a time, decided by the pure `tokenActionState(spent)`
  (`cashuToken.ts`, unit-tested per state): no usable result yet / error / unreachable →
  **Check if spent**; all unspent → **Redeem**; partial and all-pending → nobody accented, Redeem
  enabled; all spent → Redeem becomes a non-navigating `<span aria-disabled="true">` (no href,
  opacity .45), **Open in cashu.me is hidden** (don't hand a spent token to a third party) and the
  note reads "Nothing left to redeem." (the only state-specific note left). After a spent check has
  settled (any result, errors included) the check button reads **"Check again"**; before the first
  check, and after editing the textarea, it reads "Check if spent". Editing the textarea resets to the initial state.
  All actions share `.token-action-btn` (quiet: 0.5px neutral border, `--text2`); the two links
  stay `<a>` with unchanged target/rel (hrefs: see the privacy paragraph above). Desktop: one wrapping row; ≤700px: Redeem
  full width on its own row, View Mint Detail + Open in cashu.me side by side in two equal columns
  below it (labels may wrap inside the button; at 360px both fit on one line), 44px min height. A
  lone second-row button (all-spent, or untracked mint) takes the full width. The caption "Asks the mint. It will see that you
  checked." sits UNDER the Check button and only while no spent result is shown (the result takes
  its place).
- **Centering** — on desktop (≥701px) "Inspect & Verify Token" and its "Paste a token first"
  hint are centered like the wizard's "Find my mint"; privacy line, result grid and action rows
  stay left/full width.
- **Result grid typography (2026-09-29)** — mint name (`.trc-name`) is the UI font
  (`--font-body`), 16px/500, hostname under it stays mono; Amount keeps the large mono number but in
  `--text` (no accent green — green in this grid only means healthy/positive: Online, score band).
  Amount, status and Reliability Score (`.trc-value`) are weight 500, not 700, so the mint name
  isn't outweighed. They use `--font-mono-data` (a *system* mono stack, not the self-hosted
  JetBrains Mono), so 500 renders as Medium only where the OS mono font has it and otherwise as 400;
  the computed weight is 500 either way. No font files added.
<!-- moved to CLAUDE.md, Hard invariants -->
  the "Token Inspector mint icon" e2e tests.
- **Display rules** — offline line "This mint didn't answer its last check, so checking or
  redeeming may not work." shows above the Check row only for a tracked mint with `online ===
  false` (not unknown, not untracked). The Amount cell hides its unit label when
  `amountCarriesCurrencySymbol(unit)` (usd/eur/… — formatted text already has the symbol); sat,
  msat and raw-integer fallbacks keep it. No-DLEQ copy no longer says "common".

### Token Inspector: request cancellation + timeouts (2026-09-29)

Both network paths (Inspect & Verify: `loadMint` = GET `/v1/info`, `/v1/keysets`, `/v1/keys`; Check if
spent: `loadMint` then POST `/v1/checkstate`, chunked) are cancellable and time-limited. Before this, editing
the textarea only reset the panels: the old request kept running and its result was later written into state
under the new text, and a dead mint left the UI stuck for cashu-ts's default 300 s.

- **Design:** cashu-ts 4.11.0 has no public signal option (`loadMint(forceRefresh?)`, `checkProofsStates(proofs)`
  take none). The only way in is `new Wallet(new Mint(url, { customRequest }), { unit })`, where `customRequest`
  wraps the library's own default request function and adds an `AbortSignal`. That default is not exported; it
  is reachable only through the **private field `mint._request`**. `src/utils/mintRequest.ts` (`createMintWallet`)
  is the ONLY place that touches it. Rejected: our own fetch inside `customRequest` (loses big-integer JSON
  parsing and the library's error mapping) and `setGlobalRequestOptions({ signal })` (one process-wide signal
  would abort unrelated runs).
- **Private-field dependency + guard:** verified against `@cashu/cashu-ts` 4.11.0 (`package.json` has `^4.11.0`,
  the lockfile pins 4.11.0). If `_request` is not a function at runtime the adapter silently falls back to a plain
  `Wallet` (nothing cancellable; the run-id guard and the timers below still recover the UI). Because that would
  hide a broken upgrade, `src/__tests__/mintRequest.contract.test.ts` runs the REAL cashu-ts with a mocked
  `fetch` that never resolves and asserts `_request` is a function and that aborting `loadMint()` /
  `checkProofsStates()` rejects with `name === "CallerAbortError"`. It must fail loudly on an upgrade that removes or
  renames the field: re-verify against the new source, then update `mintRequest.ts`.
- **Version policy: the range stays `^4.11.0` (no pinning) — cashu-ts is updated often and we stay current.** The
  guards are the lockfile (CI and both deploy steps use `npm ci`, which honours it) plus the contract test (part of
  `npm test`, which the deploy workflow's `test` job runs before `deploy`, so a failure blocks the deploy).
- **Upgrade procedure when bumping `@cashu/cashu-ts`:** (1) `npm test` — the contract test
  (`mintRequest.contract.test.ts`) must pass; (2) read the library's changelog for changes to requests, `Mint` or
  `Wallet` (a renamed/removed `_request`, changed `customRequest` args, changed abort/error classes); (3) run
  `npx playwright test e2e/tools.spec.ts` (CI does not run e2e); (4) only then commit the new `package-lock.json`.
- **Runs:** `src/utils/tokenRun.ts`. `startTokenRun()` gives one `AbortController`-backed `TokenRun` per Inspect
  and per Check; `Tools.tsx` aborts it on textarea edit, on a new run of the same kind and on unmount (Inspect and
  Check are guarded separately, so starting one never discards the other).
- **Timeouts:** `REQUEST_TIMEOUT_MS = 10_000` per request and `OPERATION_TIMEOUT_MS = 30_000` per operation
  (Inspect and Check each), both in `tokenRun.ts`. Manual timers, not `AbortSignal.any`: they set `timedOut` first
  and then `abort()`, so a timeout is distinguishable from an edit-abort. A request timeout aborts the whole run,
  so the sibling requests of `loadMint` (`Promise.all`) stop too. The abort covers a stall after the response
  headers as well (verified: the connection closes).
- **Error classification** (`classifyRunError`, pure): test `CallerAbortError` FIRST and by `e.name` (it and
  `UncancellableReadError` are subclasses of `NetworkError` in cashu-ts, so `instanceof NetworkError` would swallow
  an abort). Abort with our `timedOut` flag → `timeout`; any other abort (edit / new run / unmount) → `ignore`
  (silent, no state writes, never "unreachable"); everything else → the existing handling. `TokenRun.race()` also
  rejects with our own `RunAbortError` when the run aborts, so a path the library cannot cancel still settles.
- **UI on timeout (existing states only):** Inspect → the `unreachable` signature-check state; Check → the error
  panel with "The mint didn't answer in time." (never raw library text). The button returns to idle and "Check if
  spent" stays accented; nothing else changed.
- **Run-id guard** (`createRunGuard`): belt and braces. Every async path captures an id and discards its result
  if the id moved on (also after the 300 ms minimum display waits).
- **Tests:** `tokenRun.test.ts`, `mintRequest.test.ts`, `mintRequest.contract.test.ts`; e2e in `tools.spec.ts`
  ("Token Inspector cancellation and timeouts"). Those e2e tests use REAL network requests to a fixture mint via
  `page.route()`, with the document's CSP header stripped (test-only; the dev CSP would otherwise block them) so
  Chromium can report `net::ERR_ABORTED`; timeouts use `page.clock.fastForward()`. CI does not run e2e.
- **Not done:** mint responses have no size limit (cashu-ts reads the body with `res.text()`); only the time limits
  above bound a hostile mint now.

