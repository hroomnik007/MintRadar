# MintRadar — MintCard, badges, Mint Detail UI, mint-formatting helpers (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Shared mint-formatting helpers (`src/utils/mintFormatting.ts`)

Pure, side-effect-free, unit-tested (`src/__tests__/mintFormatting.test.ts`). Import from here
instead of re-inlining — several of these exist specifically because the same logic had drifted
across components.

- **`mintHostname(url)`** — `new URL(url).hostname`, or the raw string if unparsable.
- **`displayName({ name, url })`** — the title shown on cards, in the Name sort, the Compare
  picker, and (as of `f2b25ff`) on the Stats page (Most Reliable, Reliability Score Movers, software
  drilldown, geo modal, NUT-support modal). Steps: trim → strip **one** pair of wrapping
  `"`/`'` quotes → if the result is empty or in `GENERIC_NAME_DENYLIST` (`cashu`, `cashu mint`,
  `mint`, case-insensitive) return the hostname → **suffix-collision guard (2026-09-08):** if
  the resolved name is a parent-domain suffix of the host (`host === name` or
  `host.endsWith('.' + name)`) return the full hostname. That last step fixes
  `bitcoin.aleafnd.org` vs `btc.aleafnd.org` both titling as `aleafnd.org`. `"Cashu test mint"`
  is deliberately NOT denylisted (real known test mint, kept verbatim).
- **Mint names: cleaning and the hidden list (2026-10-05).** A mint's `name` is untrusted text from its
  own `/v1/info`, so what we SHOW is cleaned; stored database values are never changed.
  `cleanMintName(raw, url)` (`backend/src/shared/cleanMintName.ts`, identical frontend copy
  `src/utils/cleanMintName.ts`, pinned by `sharedModules.test.ts`): NFC; removes control characters,
  zero-width/invisible characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM, soft hyphen, blank fillers), bidi
  marks/overrides/isolates, tag characters and variation-selector abuse (one U+FE0E/FE0F straight after a
  visible character is kept); collapses whitespace; caps any run of more than 3 consecutive emoji at 3;
  caps the name at 48 grapheme clusters (`Intl.Segmenter`, ending in `…`); nothing left -> the hostname.
  `cleanMintNameDetailed` also returns `full` (the control-cleaned name) only when the shown name was
  truncated or emoji-capped: that is the card/hero `title` tooltip (`KnownMint.nameFull`). Normal, CJK,
  accented and punctuation names are unchanged. (ZWJ is stripped, so a family emoji splits into its
  members; ZWNJ-dependent scripts lose the joiner.)
  **Backend boundary** (`backend/src/mintNames.ts`, `publicMintName()` / `publicMintNameOrHost()`):
  `/api/mints/known` (`name`, `nameFull`), `/api/mint/probe` (`info.name`), `/api/mint/submit` and
  `/api/mints/discover` (`name`, `aliasOf[].name`), `/api/stats` `top5ByReliabilityScore`,
  `/api/stats/reliability-movers`, the audit-cz swap counterpart `otherMintName`, and the bot OG HTML
  (`og.ts`). Not affected: `/api/nuts` and the sitemap (URLs only), notification DMs (hostname only).
  `name: null` from the API means "show the hostname" (hidden list, or nothing displayable) and the
  frontend `displayName()` then falls back to it with no duplicate host line.
  **Hidden list:** `backend/src/data/hiddenMintNames.json`, `[{ "url": "https://host", "reason": "short" }]`
  (validated at startup by `loadHiddenMintNames`: invalid entries ignored with a warning, max 200, url
  normalised like `normalizeUrl`). A listed mint shows only its hostname everywhere above; its raw name is
  never sent, not even as a tooltip. Seeded with `https://mint.sortug.com` ("vulgar name; reported by a
  reviewer"). **To add a name:** criteria are slurs, sexual vulgarity or spam; add one entry with a one-line
  reason, commit, deploy the backend (the file is compiled into `dist/data`, so a Docker rebuild is needed).
  **Frontend:** `displayName()` runs the same cleaning on whatever it is given; Submit preview cleans the
  live probe name. Mint Detail rule: a TRACKED mint uses only the known-mint name (`knownMint.name`, null ->
  hostname) for hero, document title/description and the "Name" info row, so the live probe's raw name can
  never override it; a mint with no tracked row would use the live name cleaned client-side (in practice the
  route resolves only tracked mints).
- **`mintFaviconInitials(url)`** — 2-letter monogram fallback for a mint with no icon. Strips a
  leading `www.` and/or `mint.` (case-insensitive, both if stacked — `6987e27`) before taking
  the first two hostname chars, so `mint.example.com` and `example.com` don't both render `MI`.
- **`cardReliabilityLabel(score)`** → `"Reliability <n>"` (word + number, never a bare `NN%`), `"Reliability n/a"`
  for null/undefined. Rendered on the card as `IcShield` + this label, colored by band
  (`--green-bright` ≥ 70 / `--amber` ≥ 40 / `--red` else / `--t3` when null). Same formatting is
  reused by the Best Mint wizard result rows (2026-09-08).
- **`cardLatencyLabel({ latencyMs, lastError })`** → `"<n> ms"` when a sample exists, `"timeout"`
  when the probe timed out with no sample, `"n/a"` otherwise. The card's latency row is **always
  rendered** — never a blank or `"—"`. The uptime chip reads `"<n>% up 24h"`.
- **`cardLightningLabel({ mintMethods, meltMethods })`** (2026-09-08, commit `b796eff`) →
  `'LN' | 'LN in' | 'LN out' | null`. Lightning = a method entry whose `method` is `bolt11` or
  `bolt12` (case-insensitive); `onchain`/`venmo`/`paypal`/etc. ignored. Both sides → `'LN'`,
  mint-only → `'LN in'`, melt-only → `'LN out'`, methods `null`/`[]` on both sides → `null`
  (never inferred from `nutCount`/`nutsLimits`). Reads the existing `mintMethods`/`meltMethods`
  fields on `KnownMint` (from `/api/mints/known` — no backend change). Centralizes the
  `.some(e => method === 'bolt11'|'bolt12')` check that was duplicated in `MintDetail.tsx` /
  `Tools.tsx`. Card chip: lucide `<Zap size={10}>` in `currentColor` (no gold emoji) + label,
  class `card-pill card-ln`, **no `title`/hover text**. ~30 mints have `null` methods
  (mostly offline / older Nutshell) → they render no chip.
- **`isNewMint(discoveredAt)` / `NEW_MINT_MAX_DAYS` (30)** — the card/header **"New"** badge.
  Replaced the Fresh/Established/Veteran/OG age badges on the card (see "Card badges" below).
- **`firstSeenLabel(discoveredAt)`** → `"First seen by MintRadar <Mon YYYY>"` (UTC), or `null`.
  Mint Detail header only. The "by MintRadar" wording (added 2026-09-20) disambiguates this from
  the adjacent "Announced on Nostr" date — this one is `discovered_at` (when MintRadar's own
  probe/discovery first indexed the mint), the other is the mint's own NIP-87 announcement date,
  and the two can differ substantially.
- **`resolveMintDetailUrl(slug, known)`** (2026-09-08, commit `bbf3eab`) — canonicalizes the
  `/mint/:url` route param. See "Mint Detail route param canonicalization" below.
- Also here (own sections / mentions elsewhere): `reliabilityDonutArc`, `auditReliabilityColor`,
  `formatAuditErrorRatio`, `formatTimeAgo`, `normalizeMintUrl`,
  `reliabilityScoreColor`/`reliabilityScoreInfo`/`reliabilityColor`, `uptimeColor`/`latencyColor`,
  `MIN_MEANINGFUL_REVIEWS`.

### MintCard.tsx — history (was dead code, now the real shared component)

An earlier `src/components/mint/MintCard.tsx`/`.css` was deleted (zero imports at the time). For a while Dashboard and Watchlist each had their own separate inline card renderer instead of a shared one.

**This is no longer true as of the "Post-redesign fixes round 2" session (commit f98694a) below.** `src/components/mint/MintCard.tsx` was recreated and is now the real, actively-imported shared card component used by both `src/pages/Dashboard.tsx` and `src/pages/Watchlist.tsx`. Any task targeting "the mint card" or "the watch button" should edit this file — not Dashboard.tsx/Watchlist.tsx directly — unless the change is genuinely page-specific.

### Cards are real links (2026-10-05)

`MintCard` (Dashboard + Watchlist grids) and the Learn module cards (`Learn.tsx`) are no longer a `div` with an `onClick`. Each has a real react-router `<Link>` around the name/title (the link text is the accessible name, so it contains the mint name) and a stretched-link overlay: `.card-link::after` (Dashboard.css) / `.learn-card-link::after` (Learn.css) is `position: absolute; inset: -1px` over the card (the card is `position: relative`). Middle/ctrl/cmd-click, "copy link address" and crawlers without JS work; same target (`/mint/<encodeURIComponent(url)>`, `/learn/<slug>`), no state, scroll reset still done by `AppShell`. Rules: **no interactive element inside the `<a>`**; the star, Compare, the InfoTooltip, the Notify strip and the chips with a `title` (Test mint / Same op) plus `.card-name` (its `title` shows the full name) are `position: relative; z-index: 1` so they stay above the overlay (`.mint-card …` list in Dashboard.css) — a click on a chip or the name's own box does not navigate by itself except the name (it is inside the `<a>`). The global `a:hover` underline is cancelled for these links. Focus: the link is the first tab stop, the ring (2px `--accent`, offset 2px) is drawn on `::after`, i.e. around the whole card. The hover-prefetch `onPointerEnter/Leave` stays on the card `div`. Dashboard **list view**: the name is a real link (`.mint-list-link`); the `<tr>` click handler stays for mouse convenience but ignores clicks that started inside an `<a>` (otherwise a plain link click would navigate twice, and ctrl-click would also navigate the current tab). Stats rows, the Best Mint wizard rows, Watchlist recommendation rows and the NUT explorer rows are still `onClick` rows (not part of this change).

### Star + Compare accessible names (2026-10-02)

The header star (`.card-star` in `MintCard.tsx`, `.md-watch-star-hero` in `MintDetail.tsx`) and the card's Compare icon button carry the mint's displayed name (`displayName()`, so duplicate-name suffixes apply): star `Add <name> to watchlist` / `Remove <name> from watchlist` (Remove only when logged in AND watched; logged-out stars read "Add …"), `title` identical to the `aria-label`, `aria-pressed` = watched; Compare `Compare <name>` for both `aria-label` and `title`. The logged-out star's old `title` hint ("Login with Nostr to add to watchlist") is gone — the click still opens the login modal. Look and hit areas unchanged. Old names were `Watch` / `Unwatch` / `Compare`; e2e tests find the star with `getByRole('button', { name: /^Add .+ to watchlist$/ })`. Test: `e2e/watch-compare-accessible-names.spec.ts` (Dashboard, Watchlist, Mint Detail).

### Card badges — reduced set + header slot (2026-09-08, commits `c02bdac` / `c9fdaf7`)

The `.card-pills` row (lower body of `MintCard.tsx`) no longer carries age or identity badges:

- **Established / Veteran / OG are gone entirely.** The only age signal on a card is now the
  **"New"** badge (`isNewMint()`, `discovered_at` < `NEW_MINT_MAX_DAYS` = 30). `mintAgeBadge()`
  still exists and is still used by `ComparisonModal.tsx`, `Stats.tsx` (its own local copy) and
  the Dashboard **list-view "Age" column** — just not the card or any filter.
- **"New" and "Test mint" both live in the card header slot** (top-right of `.card-name-row`,
  next to the online status dot) via a `.card-hdr-badges` wrapper — classes `.card-hdr-new`,
  `.card-hdr-test-mint`, `.card-hdr-badge`. When a mint is both fresh and a known test mint the
  two render side by side. Neither is in `.card-pills` anymore. (`isTestMint()` detection and
  the Stats "Most Reliable" / Best Mint wizard exclusions are unchanged.)
- **Reliability pill moved out of `.card-pills` (2026-09-10, commit `ed672d7`, "right-hand Reliability
  block").** It's now its own `.card-reliability` column at the right edge of `.card-lower` (stacked
  with the Community Rating `★` below it), not a pill in the row above — `.card-pills` is
  unaffected shape-wise, just missing this entry now. `.card-reliability` still uses `IcShield` +
  the same score/color logic (`--green-bright` ≥70 / `--amber` ≥40 / `--red` else / `IcShield` +
  `"Reliability n/a"` when null); `2054bd8` (same day) fixed the bottom row so the action buttons
  (`Compare`, notify toggles) can no longer overlap this column on narrow cards.
- **Version and NUT-count pills removed from the card entirely** (same `ed672d7` pass) —
  neither `mint.version` nor `mint.nutCount` render on `MintCard.tsx` anymore, on any card view.
  NUT count is still visible in the Dashboard's compact **list view** table (a `"NUTs"` column,
  desktop-only via `col-hide-mobile`) and on **Mint Detail** (NUT compatibility grid, Reliability Score
  breakdown). Version is visible only on **Mint Detail** now (header, version history table, Reliability
  Score breakdown's Version Freshness row) — there is no card or list-view column for it.
  **Version stat badge and breakdown row (2026-10-09):** the red `Outdated` badge next to the version, the Version row's points and tooltip and Compare's `Outdated` badge all come from the one shared rule (`shared/versionRule.ts`): outdated = two or more minor versions behind the newest stable release of the mint's own software; 0–1 behind scores the full 15 points. "Latest" is the mint's `softwareLatest` from `/api/mints/known` (the value the stored score used), so the breakdown row equals the version points inside the score. Compare no longer takes "latest" from the compared mints. See docs/claude/scoring-and-probing.md.
- **Community Rating ★ badge** stays, but its `.card-rating-info` **(i) caveat tooltip was
  removed** 2026-09-08 (the caveat now lives only in the Reviews-tab `.reviews-disclaimer`).
  The `reviewSurge` **⚠** flag (`.card-review-surge-flag`) is unchanged. **"No reviews yet"
  empty state (2026-09-19)** — a mint with `reviewCount === 0` (or a `null` average) used to
  render nothing where the ★ rating pill would go; `MintCard.tsx` now renders a
  `.card-reliability-no-reviews` span ("No reviews yet", 11px `--t3`) in that slot instead, so the
  gap is never silent. e2e: `e2e/mint-card-community-rating.spec.ts`.
- **LN chip** (`.card-ln`) — optional, right after the unit chip. See `cardLightningLabel()` above.
- Mint Detail header equivalent: an inline **Online/Offline** pill next to the name, **First
  seen `<Mon YYYY>`** moved onto the URL row (was colliding with the status pill), and a **`Tor`**
  label (`.md-url-tor`) prefixing any `.onion` URL.
- **"Same operator" badge (2026-09-20)** — a 5th `.card-hdr-badges` entry (`.card-hdr-same-operator`,
  copper `--copper`/`--copper-soft` tonal pair, matching the header slot's badge recipe). Flags
  cards whose `/v1/info` `pubkey` matches another tracked mint's — a copper-toned badge to stay
  visually distinct from the amber Test-mint / gold New badges. `groupMintsByPubkey()` /
  `sameOperatorUrls()` (`src/utils/mintFormatting.ts`) group **every known mint** (not just the
  currently filtered/visible set) by non-null `pubkey`; Dashboard and Watchlist each compute this
  once from their own `useKnownMints()` result and pass the sibling URLs into `MintCard` as
  `sameOperatorUrls`. No backend change — `pubkey` was already on `KnownMint`/`/api/mints/known`
  (see `mintPubkey.ts`, previously used only for the submit-time `aliasOf` hint — see "Discovery
  pipeline" above for that mechanism). Cards are never merged or hidden, only labeled; the badge's
  `title` tooltip lists the sibling hostnames and says "Not merged — tracked as separate mints,"
  mirroring the submit-flow's existing "Same mint pubkey as… not merged" copy.

### Mint Detail route param canonicalization (2026-09-08, commit `bbf3eab`)

`resolveMintDetailUrl(slug, known)` in `mintFormatting.ts`, called by the `MintDetail` default
export **before** rendering `MintDetailContent`. Fixes the "ghost mint" bug where
`/mint/21mint.me` (a bare host pasted by a user) never matched the tracked row
`https://21mint.me` and fell through to a hollow live-probe stub (0 NUTs, ~3% Reliability,
"Discovered NIP-87", offline) — making 21Mint look dead.

- **exact tracked match** → render as-is (`{kind:'ok'}`).
- else canonicalize a bare host → `https://{host}` (path kept, **no invented trailing slash**)
  and resolve **by hostname**. `pickDashboardRow()` picks among same-host rows: a **probed** row
  (`online != null`) always beats a never-probed NIP-87-only stub, then bare-root `https://host`,
  then higher `reliabilityScore`, then shorter URL → `<Navigate replace>` to the canonical encoded URL.
- **nothing tracked on that host** → a short **`<MintNotTracked>`** state (`.md-not-tracked`,
  "Not a tracked mint" + a "Did you mean `<host>`?" link via `closestKnownHostUrl`) — never a
  fabricated full detail.
- Distinct hosts stay distinct (`bitcoin.aleafnd.org` ≠ `btc.aleafnd.org`). `MintDetailContent`
  now only ever receives a URL that is in `known`, so `knownMint` is always non-null there.
- The in-code "Show my latency" SSRF guard stays as defense-in-depth, but an attacker route
  param now hits the not-tracked state first (no probe-driven detail, no latency button).

### Reliability Score breakdown always visible on Overview (2026-09-20)

The desktop `.md-reliability-panel` sidebar (Overview tab, ≥901px) now renders all 5 Reliability Score
components (Uptime 40% · Audit reliability 25% · NUT Support 15% · Version 15% · Contact 5%)
and the "Score = Uptime×40% + …" explanatory line directly under the donut/badge — no click on
a "Details ›" link or the donut itself needed anymore (both removed from the desktop panel).
`ReliabilityBreakdownRow` (`MintDetail.tsx`, a top-level component alongside `AuditSourceInfoIcon`)
renders one row (label + ⓘ tooltip + measured value + score bar); it renders its own `InfoTooltip`
(2026-10-14; it was a `useTapTooltip` hook before), so the same
row data (`reliabilityBreakdownRows`) can be rendered in two places at once (the always-visible panel
list AND the "Reliability Score Breakdown" modal) without two DOM nodes fighting over one shared ref.
The Uptime/NUTs/Latency 3-line mini-summary that used to sit in this panel (`.reliability-info`,
CSS now removed as dead) is gone — those numbers were already duplicated in their own stat
tiles higher on Overview (`.md-sc` Latency/Uptime 24h/NUTs tiles), so nothing was lost.

**The modal itself still exists** — it's the only way to see the breakdown on **mobile** (<901px,
where `.md-reliability-panel` stays `display: none` and the page shows a compact `.md-sc.md-sc-reliability`
tile instead, which still opens the modal via tap, unchanged). Desktop no longer has any UI
that opens the modal, but nothing prevents it from existing/rendering if `showReliabilityBreakdown`
is ever set true from elsewhere.

**Superseded same day (commit `73e6c3e`) — the "Score = Uptime×40% + …" line is no longer always
visible as text.** It moved into an (i) tooltip beside the panel title, and the gauge/badge
layout changed too — see "Mint Detail sidebar rework" below for the full follow-up session.

### Mint Detail Keysets panel (2026-09-09/10, commits `313061c`/`5e64dc7`)

New panel showing the mint's keysets from the existing probe data (`data.keysets` — `id` / `unit`
/ `active`, already fetched by the live `/v1/info`+keysets probe used elsewhere on Mint Detail, no
new API call). Each row: keyset id (with a copy-id control) + unit + an Active/Inactive badge;
empty state when no keysets are known. **Rendered once, shown per breakpoint** (`5e64dc7`, same
data — a layout-only follow-up the next day): **desktop (≥901px)** it sits in the Overview sidebar,
directly under "Units & Methods" (same card chrome), and is hidden on the NUTs tab; **mobile
(<901px)** it stays on the **NUTs tab**, under NUT Limits, and is hidden on Overview. The panel
heading has a visible one-line hint (`.md-panel-hint`, `KEYSETS_HINT`; it was a tooltip until 2026-10-14). Tests:
`e2e/mint-detail-keysets.spec.ts` (desktop/Overview and mobile/NUTs-tab describe blocks).

**Superseded 2026-09-20 (commit `c68d98d`) — desktop placement is now "always visible", not
"Overview tab only".** See "Mint Detail sidebar rework" below: the `activeTab === 'overview'`
gate around the desktop copy was a bug (it made Keysets vanish from the sidebar on every other
tab even though the sidebar itself — Reliability Score, Units & Methods — persists across all tabs).
It's also no longer "directly under Units & Methods" but side by side with it
(`.md-um-keysets-row`). The `e2e/mint-detail-keysets.spec.ts` "renders on Overview and NOT on
the NUTs tab" test still has one pre-existing unrelated failure (a stale `"100 ppk"` fee-display
assertion, not caused by this rework — see that section).

### Mint Detail sidebar rework + Watchlist button row (2026-09-20, commits `d802279`→`24187c5`)

Same-day follow-up session to the "Reliability Score breakdown always visible on Overview" change
above — that change made the `.md-right` sidebar taller than the `.md-left` column and kicked
off several rounds of user-reported layout fixes, in landing order:

- **`.md-body` column ratio, tried three times.** Started as a fixed `1fr 250px` (too narrow once
  all 5 breakdown rows were always-visible → right column taller than left, `d802279`). Widened
  to a 60/40 `fr` split (`minmax(0,3fr) minmax(260px,2fr)`) — but `fr` tracks scale with the full
  body width, so on a 1920px monitor the sidebar ballooned to ~650px for content that never
  needed it ("Trust score je za mňa zbytočne široký", `c68d98d`). Final value is a **bounded,
  non-scaling range**: `grid-template-columns: minmax(0, 1fr) minmax(280px, 380px)` — the right
  column stays 280–380px regardless of viewport width, only shrinking below 380px on a narrower
  desktop. This is the value still live today.
- **Keysets was gated to the Overview tab only** (`activeTab === 'overview'` around
  `.md-keysets-at-overview`) even though the rest of the sidebar (Reliability Score, Units & Methods)
  renders on every tab — switching to Audit made Keysets disappear entirely. Fixed by dropping
  the gate (`c68d98d`); see the superseded note on the Keysets section above.
- **Units & Methods + Keysets sit side by side** (`.md-um-keysets-row`, flex row ≥901px, stacked
  below that) instead of stacked full-width — split asymmetrically **38/62 → 46/54** in
  `.md-um-panel-methods`/`.md-um-panel-keysets` (38% was too narrow once 2-per-line chips
  landed, see below; 46/54 is the current value, `c68d98d`→`79c64fe`).
- **Units & Methods method-row layout flipped from label-beside-chips to label-above-chips**
  (`.method-row` `flex-direction: column`) — beside them, a fixed-width label ate room from an
  already-narrow sidebar column and a mint advertising several methods per direction
  (bolt11/bolt12/onchain/venmo) could fit only one chip per line, growing very tall (`c68d98d`).
- **Chips render 2-per-line once there's more than one method** — `chipsClassName()` in
  `MintDetail.tsx` adds `.method-chips-grid` (a `1fr 1fr` CSS grid, denser font/padding than a
  lone chip) only when a direction has >1 method; a single method (just `bolt11`) is untouched,
  no grid applied (`79c64fe`).
- **Mint & Melt collapse into one row when their method sets are identical** — common (e.g.
  bolt11+bolt12+onchain+venmo on both mint and melt) and, shown as two separate rows, just
  repeated the same chip list twice. `methodsUnified` in the units-map body compares
  `mintChips`/`meltChips` method-name sets (order-independent, via a sorted `join('|')` key);
  when neither NUT-04 nor NUT-05 is disabled and the sets match, renders a single **"Mint &
  Melt"** row instead of separate Mint/Melt rows (`67ac2b9`).
- **All method chips are the same neutral color** (`.method-chip`, no green/copper variant) —
  `.method-chip.mint`/`.method-chip.melt` were removed entirely; the earlier mint=green/melt=copper
  coloring was inconsistent with the "Mint & Melt" unified row's neutral chips, and the user
  flagged the mismatch comparing two real mints side by side. The amber "Disabled" badge is
  unchanged (`1e7c329`).
- **Disabled state (`NUT-04`/`NUT-05` `disabled: true`) is a per-direction flag, not per-chip** —
  it used to render as a *second* `.method-chip-off` badge appended after the (already
  struck-through) method chips, which wrapped onto its own line on the narrower sidebar column
  and made a single disabled method take 2–3 lines (worse with both directions disabled — the
  reported "Cashu test mint" case). The badge (renamed `.method-off-badge`, font-size 10 vs. the
  old chip's 12, `padding: 1px 6px` vs. `3px 7px`) now sits once next to the `MINT`/`MELT` label
  itself (`.method-label` became `display: inline-flex`); the chip list below only ever holds the
  real, struck-through method chips (`5f47de3`).
- **Reliability Score panel: formula moved into a tooltip, gauge enlarged, badge repositioned.** The
  "Score = Uptime×40% + …" line used to always render as a text block under the breakdown rows —
  moved into an (i) tooltip beside the "Reliability Score" panel title instead, reclaiming that
  vertical space. Reused `AuditSourceInfoIcon` (previously hardcoded to the audit.8333.space
  blurb) generalized with an optional `text` prop. **Gotcha found and fixed same commit:** the
  icon was first nested *inside* `.md-panel-title`, so the tooltip text inherited that element's
  `text-transform: uppercase` / `letter-spacing: 0.1em` / `font-family: var(--font-mono)` —
  `.audit-tooltip` (gone since 2026-10-14: every tooltip is an `InfoTooltip` in a portal, see `mobile-and-tooltips.md`) only reset `font-family`, not the other two, so the tooltip visibly looked
  like a different font from every other tooltip in the app. Fixed by making the icon a sibling
  of the title `<span>`, matching the layout the Audit tab heading's own `AuditSourceInfoIcon`
  already uses (`73e6c3e` landed it broken, `1e7c329` fixed the nesting same day after the user
  flagged it). Gauge `.gauge-wrap`/svg: `72px → 96px` (viewBox/geometry unchanged — `reliabilityDonutArc()`'s
  `r=27` math is untouched, this is a pure CSS container-size scale-up). `.reliability-wrap` flipped
  from `flex-direction: column` (badge stacked below the gauge) to `row` (badge beside the gauge,
  vertically centered) (`73e6c3e`).
- **Audit tab "Recent success rate" cell overflow.** `.audit-summary-value` forced
  `white-space: nowrap` on its combined `"N / 100 · N% ok"` text, which overflowed the fixed
  5-column strip cell at normal desktop widths (reported as literally spilling outside the
  bordered box). Allowed this one cell to `flexWrap: wrap` so it drops to a second line instead
  of overflowing (`c68d98d`).
- **NUT Limits panel — one payment method per line.** `renderLimits()` used to join each
  method's min–max range with a comma into one wrapping inline block
  (`"1 - 1,000,000 sat (bolt11), 10,000 - 5,000,000 sat (onchain)"`), which wrapped mid-range on
  narrower cards. Each method group now renders in its own row (`575bb4e`).
- **(Superseded 2026-10-03 — the Down/Up buttons are gone, see "Watchlist notification toggles" in stats-dashboard-watchlist-ui.md.)** **Watchlist card: Compare/Down/Up now fit on one line.** `.card-actions` (shared with
  Dashboard's Compare-only case) is `flex-flow: row wrap` inside `.card-bottom-main`, which on a
  Watchlist card is only ~187px wide (the Reliability column takes the rest) — the 3 buttons' combined
  width ran ~18px over that, wrapping Up onto its own second row on every card. Trimmed
  `.card-compare-btn` (padding `5px 10px → 4px 6px`, font `11px → 10.5px`) and
  `.notify-toggle-btn` (padding `3px 7px → 3px 6px`, font `10px → 9.5px`, icon gap `4px → 3px`),
  and `.card-actions` gap `6px → 4px` — cosmetic sizing only, verified against the existing
  `e2e/watchlist-card-action-row.spec.ts` consistency sweep (700–1390px) which still passes
  (`24187c5`).

All of the above is desktop-sidebar-scoped (≥901px); mobile keeps its own separate compact tile
(Reliability Score) and NUTs-tab placement (Keysets, NUT Limits) untouched. Verified each step with a
throwaway Playwright screenshot spec (mocked `/api/mints/known` + `/api/mint/probe`, deleted
after use — see the session transcript, not committed) rather than eyeballing production; typecheck/
build/lint clean throughout (the same 3 pre-existing `MintDetail.tsx` lint errors —
`formatKeysetFee` unused import, a conditional `useEffect`, a `setState`-in-effect — were present
before this session and are unrelated to it, confirmed via `git stash` diffing).

### Mint Detail Version History — real 3-column table (2026-09-10, commit `9fa6cdd`)

The Version History panel on Mint Detail (distinct from `ComparisonModal`'s own version-history
rows, documented separately under "Compare feature" above) went from loose Date/From/To grid rows
to an actual `<table className="md-vh-table" style="table-layout: fixed">` with **DATE | FROM |
TO** columns. Dates render as `"7 Sep 2026"` (no dotted numeric form); FROM/TO cells are
`font-mono`, single-line, ellipsis on overflow. A first-seen row with no prior version shows `"—"`
in FROM, with TO still column-aligned to every other row. Version-event storage/detection and the
`.md-panel` chrome are unchanged — this was a rendering-layer change only.

### Mint Detail hover-prefetch (2026-08-30)

`useMintHoverPrefetch()` (`src/hooks/useMintHoverPrefetch.ts`) → `prefetchMintDetail()` (`src/core/mint/prefetch.ts`). `MintCard` and Dashboard's compact list row wire `onPointerEnter`/`onPointerLeave` to it. After a **150ms hover-intent delay** (so a fast grid sweep doesn't fire anything) it `queryClient.prefetchQuery`s the exact queryKeys Mint Detail's own `useQuery` calls use — `['mint','probe',url]` (via the shared `mintProbeQueryOptions` exported from `useMintProbe.ts`), `['mint','chart-history',url,'7d']`, `['mint','history-api',url,'24h']`, `['mint','version-history',url]`, `['mint','nostr-reviews',url]`. Navigation then reuses the primed cache with **zero refetch** (verified). Prefetches that lead to a click are net-neutral on request count; only hover-without-click adds load, which the intent delay minimises. Keys MUST stay in sync with MintDetail.tsx or the prefetch silently primes a dead slot.


### Mint Detail — "Get in Touch" block, unverified NIP-05 line (2026-10-01)
The block (`MintDetail.tsx`, `.md-panel` + `.md-contact-grid` / `.md-contact-card`, CSS in `MintDetail.css`) shows when `email || twitter || nostr || operatorNip05` (visibility rule unchanged). **The "Get in Touch" heading + card grid render only when `email || twitter || nostr` exists (2026-10-02)**; with only a NIP-05 value the `.md-panel` holds just the muted line — no heading, no empty grid — and `.md-panel > .md-nip05-line:first-child { margin-top: 0 }` makes it start at the panel padding (the same top spacing the heading has); with at least one card the block is unchanged; with nothing it isn't rendered. Cards: Email, Twitter, Nostr (copy buttons; Nostr value links to njump). The old **"NIP-05 (unverified)" card was removed**: `operatorNip05` (`useMintOperatorNip05` — the `nip05` field of the **announcing account's kind:0 profile**, never verified against a `nostr.json`, no extra requests) is now a plain muted line **below the grid**, `.md-nip05-line`: ⓘ + "Profile NIP-05 · not verified:" + the value (mono, `--text2`, `word-break: break-all`), 11.5px/400. Not a card, not a link, no copy button, no hover state, rendered as React text. Only the ⓘ is interactive: the shared `InfoTooltip` with `label` (focusable, `aria-label` = the tooltip text "Taken from the Nostr profile of the account that announced this mint. MintRadar has not checked it."), the new opt-in prop **`openOnFocus`** (keyboard `:focus-visible` opens, blur closes; Escape handling is in `useTapTooltip`, see mobile-and-tooltips.md; default off so every other `InfoTooltip` is unchanged; `useTapTooltip` now also returns `setOpen`), a 44px invisible `::before` hit area under `(pointer: coarse), (max-width: 700px)`, and the popup anchored to the icon's left edge (`left: 0`) so it can't clip on phones. Tests: `e2e/mint-detail-nip05-line.spec.ts` (uses the now-exported `probePayload` fixture + a signed kind:0 served by a `routeWebSocket` stub).

## Canonical unit order + card metrics alignment (2026-10-02)
- **Unit order:** every place that renders a mint's unit list (MintCard unit chip, Mint Detail "Units & Methods") goes through `sortUnits()` (`src/utils/sortUnits.ts`): sat, usd, eur, then others alphabetically (msat/unknown after eur); case-insensitive de-dupe, null-safe, pure. **Display only** — unit filter (`unitFilter.ts`), `?unit=`, search, sort and stored/API data keep the raw order. Compare modal has no unit list (only the main-unit fee suffix). Not changed on purpose: Filters panel (SAT, USD, EUR). The Best Mint wizard's currency control now uses the same `sortUnits()` order (SAT, USD, EUR, then MSAT — changed 2026-10-02; the old `UNIT_ORDER` constant was removed).
- **Metrics alignment rule:** the RELIABILITY label / score / rating block is bottom-pinned in `.card-lower`. `.card-reliability-toprow` grows with a Test mint / Same op badge (18.6px vs 13.5px label), so the label is `align-self: flex-end` — never centre it in that row, or it rides ~2.6px higher on badge cards. Guarded by `e2e/mint-card-units-and-metrics.spec.ts`.
- **Card height rule (2026-10-02):** a Test mint / Same op badge (`.card-reliability-badge`, 18.6px incl. padding+border) is taller than the 13.5px label row, and used to make Test mint cards ~5px taller (168.03 vs 162.89 at ≤600px; 169.03 vs 163.89 above) — via grid row-stretch whole rows grew. `.card-reliability-badges` now has `height: 0` + `align-content: center`, so the row keeps the label's height and the badge overflows evenly into the padding above / gap below (no overlap with pills or score). Don't give that container a real height. Guarded by the "every card variant has the normal card height" cases (7 widths) in `e2e/mint-card-units-and-metrics.spec.ts`.

## CSS leaking between lazy pages — `.status-dot` and the `rv-*` modal (2026-10-03)

`MintDetail.css` is a lazy chunk whose CSS stays in the document after a visit, so any bare class it shares with another page restyles that page. Found: `.status-dot` (7px in Mint Detail, 9px on Dashboard cards) made every Dashboard dot 7px after a Mint Detail visit — now `.mint-detail .status-dot`. The `rv-*` modal rules exist twice (`MintDetail.css` for Mint Detail's own modals, `components/mint/WatchLoginModal.css` for the card's watch prompt, since Mint Detail does not import the latter): 12 rules identical, and `WatchLoginModal.css` now also carries the `:disabled` and ≤480px rules, so the watch modal looks the same whether or not Mint Detail was loaded. Do not remove the `MintDetail.css` copies unless it imports `WatchLoginModal.css`. `.audit-tooltip` was the same kind of leak and is now fixed (2026-10-03): the Mint Detail copy (`left:50%`, `translateX(-50%)`, `width:180px`) shifted every Stats tooltip left by half its width after a Mint Detail visit, and Stats's `font-weight/text-transform/letter-spacing` resets made Mint Detail's tooltips differ depending on whether Stats had loaded. Mint Detail's rule is now `.mint-detail .audit-tooltip` (all its uses, including the Reliability breakdown modal, are inside that root) and carries the same three resets, so tooltips are normal text (not inherited uppercase) in every navigation order. Known, not fixed: the first Audit-tab tooltip is clipped ~21px at the left edge at 390px.

## Mint Detail first-load weight and render churn (2026-10-03)

- **Lazy parts:** `ComparisonModal` is `React.lazy` in `MintDetail.tsx` too (Dashboard and Watchlist already did it), and the History chart lives in `MintDetailHistoryChart.tsx`, lazy-loaded when the History tab first renders, behind a `<Suspense>` placeholder of the same 140px height. recharts (~347 kB raw / 97 kB gzip) and the Compare chunk are no longer part of a first Mint Detail visit: ~479 kB raw / 132 kB gzip → ~100 / 27 kB. Do not import recharts (or anything from `MintDetailHistoryChart`) statically in `MintDetail.tsx`.
- **No re-animation on the 30 s `useNow` tick:** the History chart is `React.memo` and `histLineData` is keyed on the current hour/day bucket, not on `now`. Before, every tick re-rendered the page, recharts rebuilt its points (inline `margin`/`tick` objects) and replayed the line animation: 187 React commits in 65 s on the History tab, now 2. Keep the chart's props stable (primitives or a memoised array) or the churn comes back.
- The unused `useMintHistory(url)` call (a Dexie live query whose result was never read) was removed from `MintDetailContent`; the hook file stays.

## Audit tab: cashu.info view (rewritten 2026-10-07)
Shown when the mint is covered AND the backend has a stored detail (`covered` and `detail` non-null); otherwise the audit.8333.space panel or the existing "No audit data available" panel is shown, as before. The 8333 view (strip, "Recent swaps" table, tooltips) is untouched.

- **Header:** "AUDIT STATS · via cashu.info" + `AuditSourceInfoIcon` text ("checked N minutes ago" from the stored detail's `fetchedAt`, else the feed's; "not updated recently" after **90 minutes** because the detail job runs every 30), the source switch at the right and the bottom link "Open on cashu.info →".
- **Data:** `useAuditCz()` (`src/hooks/useAuditCz.ts`) makes ONE request to OUR `GET /api/mints/audit-cz?url=…&limit=100&direction=both`, only while the Audit tab is active (`useAuditCz(url, activeTab === 'audit')`; database-only read, never to cashu.info). A visit that never opens the Audit tab makes 0 requests to it; opening the tab makes exactly one, and returning to the Overview and back reuses the cached query. The Reliability breakdown row does not use it. `detail` = the validated subset stored by the 30-minute cron (docs/API.md; every field optional), `swaps` = our stored swaps of both directions, newest first, `stats7d.collectedSince` = oldest stored swap. The old `detail7d` is gone (backend and frontend).
- **Adapter:** `adaptAuditCz()` (`src/utils/auditCz.ts`, pure) returns `tiles`, `checks`, `swaps` (both directions, for the bar), `fromRows` / `toRows` (split by the `direction` field; a swap with this mint on both sides arrives once, as `from`), `notRecent`, `sourceHref`. The component is `src/components/AuditCzCards.tsx` (`AuditCzTiles`, `AuditCzSwapTables`); styles `.audit-cz-*` in `MintDetail.css` (they reuse the `.audit-summary-*` tile classes and the existing surface/border tokens, no new colours).
- **Tiles** (`.audit-cz-tiles`, 2x2 up to 900px, one row above; big number in `var(--accent)` — one constant colour, no thresholds — and an uppercase label via CSS, each with the existing ⓘ `InfoTooltip`): **Payouts** = `asSource.success / asSource.total`; **Receives** = `asDest.success / asDest.total`; **Without a failure caused by this mint** (key `clean`, 2026-10-09; replaced the overall "Success rate" tile and the "Caused by this mint" tile, so the view has FOUR tiles) = the SAME figure the Reliability Score's audit part uses, `(all.total - errorsBlamed) / all.total` with `errorsBlamed` clamped to `all.total`: the big number is a whole percent, capped at 99 while anything is attributed (1 of 200 reads 99%, never 100%), neutral colour like the other tiles. No caption lines: the tile has the same structure as the other three (value, left-aligned label, the ⓘ glued to the last word of the label via `.audit-cz-tile-tail`, so a label that wraps never leaves the icon alone), and the tiles start at the top so the four values share one baseline. The counts live in the ⓘ, one sentence: "{total - blamed} of {total} swaps in the last 7 days" plus, when `all.failed` > 0, ", {failed} failed for other reasons" when nothing is attributed, else ", {blamed} caused by this mint" plus ", {failed - blamed} other failure(s)" when there are other failures (singular at 1). Never an "x / y" in the big number. Hidden when `all.total` is missing, 0, NaN or negative, or when `errorsBlamed` is missing/invalid; under 10 swaps the number still shows (the neutral rule is explained in the Reliability breakdown row). No overall success percentage that mixes in unattributed failures is shown anywhere (the Compare "Audit success" row already used `(total - blamed) / total`). **Avg swap time** = `all.avgMs` as "8.3 s" (under a second "640 ms"). A tile whose source field is missing is hidden. The old "Recent success rate" tile and its code (`auditCzSuccessTile`, the 3-swap minimum, `recentTotal/Errors`, `nMints/nMelts`, `detail7d`) are removed from this view. Tooltips: melts "Swaps in the last 7 days in which this mint paid out a Lightning invoice, counted by cashu.info (successful of all)"; mints "…received ecash from another mint (successful of all)"; avg "Average swap time over the last 7 days as reported by cashu.info." (never says it counts only successful swaps).
- **Outcome bar:** the stored swaps of BOTH directions together (up to 44, newest left), same marks and neutral rule as before.
- **Checks by the auditor card — REMOVED 2026-10-09 on request** (no `AuditCzChecks` render any more; the adapter's `checks` field, `auditCzChecks()` and their tests were deleted 2026-10-14). **Reliability breakdown Audit row (2026-10-09):** a scored row shows only the `x / y` display (blamed / total) and the points, with the progress bar right under it — NO sentence under it (the "{success} of {total} swaps succeeded…" line and the older "{blamed} of {total} swaps … attributed" text are gone; `auditCzBreakdownText()` removed), and the row looks the same whether or not the Audit tab was opened. The neutral states keep their `.rb-row-detail` line ("Not enough audit data yet (fewer than 10 swaps in the last 7 days): neutral", "No cashu.info audit data: neutral", "Audit data older than 7 days: neutral") and the "data N days old" note. The row is built only from `auditCzTotal`, `auditCzBlamed` and `auditCzFetchedAt` of the known mint. The ⓘ reads exactly: "Failures that cashu.info attributes to this mint, out of its swaps in the last 7 days (not the overall success rate). Under 10 swaps or no recent data: neutral 12.5 of 25." The audit detail (`useAuditCz`) loads only with the Audit tab. Compare uses the known-mint fields and keeps its own, shorter tooltip.
- **Swap tables:** two cards "Swaps from this mint" (first column **To**, the destination host) and "Swaps to this mint" (first column **From**, the source host), columns Amount (`N sat`) | Fee | Duration (`N ms`) | State, three rows each with their own "Show all (N)" / "Show fewer", the same row rules as before (limits / balance / pending neutral with "below minimum" / "auditor balance", failure reason below). An empty card shows "No swaps collected yet". Under the tables "Collected by MintRadar since <d MMM>" (UTC) only while the oldest stored swap is younger than 7 days.
- **Failure reason (2026-10-05):** the State cell of every row that is NOT OK carries the swap's `error` text as a `title` (at most 200 characters, cut with "…") and as visually hidden text (`<span className="sr-only">` after the visible text; a title alone is not available on touch or to screen readers; the hidden text is not cut at 200, the endpoint stops at 300). The visible text stays "failed (melt)" / "below minimum" / "auditor balance" / the pending token. Grey rows (limits, balance) start the title with the fixed explanation ("Not counted against the mint: …") followed by ". " and the error text; they keep the explanation alone when there is no error text. No error text → no title and no hidden element; OK rows never get either, whatever the endpoint sends. The text is untrusted: `cleanAuditError()` (`utils/auditCz.ts`) drops control, zero-width and bidi-override characters, turns line breaks/tabs into spaces, collapses whitespace and caps at 300; `adaptAuditCz` sets `AuditSwapRow.reason` (cz rows only, so the 8333 table is untouched); React renders it as text, it is never a class, URL or HTML. `auditCzStateTitle()` builds the title. `.audit-swaps-table-wrap` is `position: relative` so the absolutely positioned `.sr-only` span of a far-right cell is clipped by the scroll box and cannot widen the page (without it the 390px page overflowed to 708px).
- **Source switch:** `.md-audit-seg` in the card header row (right-aligned, wraps under the title when narrow), `role="group"` `aria-label="Audit source"`, `aria-pressed`, options "cashu.info" | "8333.space"; shown only when BOTH sources have data (8333 data exists and cz covers the mint). Same recipe as the Stats "Uptime | Reliability" toggle (`.stats-tab-toggle`/`.stats-tab-btn`, copied under `.md-audit-seg*` because Stats.css can't be loaded here — it has a global `.audit-tooltip`), 44px via an invisible `::before`. **Default:** cashu.info when the 8333 data is missing or stale (`auditFreshness`: auditor >7d or our sync >24h), otherwise audit.8333.space (the panel is then unchanged except for the switch). 8333 only / cz only → no switch. Not covered / request failed → 8333 panel or "No audit data available" exactly as before. **Age line (2026-10-20):** while the 8333 view is on screen (default or picked) and our last sync from audit.8333.space (`auditSyncedAt`) is older than `AUDIT_SYNC_STALE_HOURS` (24 h), one muted line (`.audit-cz-muted`) sits under the heading: "audit.8333.space data is N days old; the service has not responded since 27 Sep 2026" (`audit8333StaleLine()` in `auditFreshness.ts`; whole days, "1 day" for 24 to 47 h, UTC date of the stored sync time, no date in the code). Fresh or unknown sync → no line (an old auditor `updated_at` alone does not show it: the service is answering). The cashu.info view and the Reliability breakdown row (`data N days old` of the cashu.info detail) are unchanged. Tests: `auditFreshness.test.ts`, `mint-detail-audit-cz.spec.ts` ("data age line").
- Never merged into any MintRadar number or the Reliability Score. cashu.info's own score, scoreParts and reviews are never stored, requested by the frontend or shown. cashu.info sends no IP address; the mint host's own public IPv4 is resolved by OUR backend from public DNS (see below).
- Tests: `src/__tests__/auditCzView.test.ts` (tiles, checks, tables, freshness, link validation, neutral kinds, failure reason); `e2e/mint-detail-audit-cz.spec.ts` (cz-only card with the LNpay-shaped detail, request audience `direction=both&limit=100`, neutral rows, tile cases, checks states, the two tables, source switch incl. keyboard + 44px touch, covered:false / stale 8333, loading state, hostile text in swaps AND in detail fields, link validation, failure reason in the State cell, 390px).

## Overview: info cards and the Network card (2026-10-07)
- **Cards, top to bottom:** About (MOTD / description, unchanged), **Mint info**, **Network** (new), **Get in touch** (unchanged). Mint info (Name, Version, Discovered "NIP-87", Server time with the clock-drift label, Public key with the copy button, ToS link, URLs) keeps all its data and logic; only the grid changed: `.md-info-grid.md-info-list` is ONE column of label-left / value-right rows with hairline dividers (`.md-info-row`, `border-bottom: 1px solid var(--border)`), instead of the old two-column grid.
- **Network card** (`src/components/MintNetworkCard.tsx`, formatters in `src/utils/networkInfo.ts`): a `.md-panel.md-network-card` titled "Network", **independent of cashu.info since 2026-10-07**: everything is measured by our backend and arrives with `/api/mints/known` — `ipAddress` (own DNS `resolve4`, `mintAddress.ts`), `netAsn` / `netOrg` / `netCountry` (the `org` and `country` of the ipinfo.io answer that also gives the city, stored by `lookupGeo` in `prober.ts` next to `server_location`; backfilled at boot for mints with `net_country IS NULL`, refreshed daily), `hasOnion` (the mint's own `/v1/info` `urls` lists a `.onion` host, written on every successful probe; the address itself is never stored). `networkRows(knownMint)` returns null when nothing is measured yet (no card). No TLS row (removed 2026-10-07). The Overview does not request the audit detail (only the Audit tab does).
- **Rows** (each hidden when its data is missing): **IP** = "IPv4 only" / "IPv6 only" / "IPv4 and IPv6" (hidden when both are false or either is unknown); **Network** = "AS{asn} {name}" where the name is the `asName` text after the first " - " (else the whole text), cut at the first comma, capped at 48 characters ("AS14061 DigitalOcean"); **Registered in** (was "Country") = English name from `Intl.DisplayNames` (the code when unknown; hidden unless the value is two capital letters) with an ⓘ tooltip "Country where the network block is registered, not necessarily where the server stands."; **Tor** = "Onion address available" / "No onion address" (from the stored `onion` boolean; the onion address itself is never stored); **TLS** = "{issuer}, expires {d MMM yyyy}" (UTC), "{issuer}, expired {d MMM yyyy}" in `var(--amber)` once the date has passed, and " · expires soon" appended in `var(--amber)` when fewer than 14 days remain.
- **IP row = our own IPv4 lookup (2026-10-07):** `backend/src/mintAddress.ts` resolves every tracked mint host (`resolve4`, private ranges dropped, none for .onion / IP-literal hosts; failed lookup keeps the old value) once after boot and every 6 h (`20 */6 * * *`) into `mints.ip_address`, served as `ipAddress` on `/api/mints/known`. Independent of cashu.info, so mints no audit service covers still get a card with just the IP row (no "via cashu.info" tag). IPv6 is deliberately not shown or stored. An offline mint (`knownMint.online === false`) without an address shows the text "Offline" in the IP row (typically a dead domain: DNS fails). A CDN-fronted mint shows the CDN's address. `networkRows(detail, ip, now)` validates the string as dotted IPv4.
- Tests: `src/__tests__/networkInfo.test.ts` (IP wording, AS name cleaning, country names, onion flag, hostile strings); `e2e/mint-detail-network-card.spec.ts` (measured card without any cashu.info data, row order and divider/alignment recipe, caveat tooltip, IP wording, Tor, nothing measured, hostile strings, own-backend-only requests, 390px); `backend/src/__tests__/refreshServerLocations.test.ts` (network facts stored from the same lookup, `parseIpinfoOrg`).
- **Version history columns/dates (2026-10-09):** desktop `<col>` widths Date 190px / From 260px / To rest (`.md-vh-col-*` in `MintDetail.css`, ellipsis for a very long value). The date is `formatDate()` (`src/utils/formatDate.ts`) on every screen size, "29 Sep 2026". At ≤640px the Date col is 88px (11 monospace characters at 12px + padding), From/To share the rest, text 12px, values WRAP instead of truncating (`<wbr>` after each "/" via `versionWithBreaks()`, `overflow-wrap: anywhere` as the last resort), cells are `vertical-align: top` with equal 10px top/bottom padding so the date lines up with the first line.
- **Outage table typography (2026-10-16):** the "Show outage details" rows (Started, Duration, Error) carry `md-vh-ver md-vh-to md-vh-wrap`, so they use exactly the value style of the Version history "To" column (JetBrains Mono 13px / 12px at ≤640px, weight 500, `--text`, same padding and row height); before, they fell back to the 15px body sans and looked like another table. `md-vh-wrap` only lifts the nowrap/ellipsis so a long error wraps instead of being cut. Header cells were already identical. Test: `e2e/mint-detail.spec.ts` ("outage rows share the Version history value typography").

## Latency tile caption (2026-10-14)
The Latency tile has no ⓘ any more (removed 2026-10-14). The line under the value reads `latencyCaption()` (`src/constants/probeLocation.ts`): "server · {PROBE_LOCATION}", the same constant as the Stats tile's "from {PROBE_LOCATION}". The button label (`CLIENT_LATENCY_BUTTON_LABEL`, "Show my latency") comes from the same file; the ⓘ next to the button ("Your latency from this browser ...") stays. The Reliability Score card header has no ⓘ either; it carries one muted line, "Operational health, not solvency." (`.rb-scope-note`). Covered by `src/__tests__/networkHealthIndex.test.ts`, `e2e/tooltip-facts.spec.ts` and `e2e/tooltips-removed-captions.spec.ts`.


## Learn index cards: structure and reading time (2026-10-16)

`Learn.tsx` card, top to bottom: a header row `.learn-card-head` (module icon on the left, `.learn-card-time` "N min read" on the right: `margin-left: auto`, `white-space: nowrap`, 12px `--text3`), the label `.learn-card-number` ("Module N", on its own line directly above the title), `.learn-card-title` (the stretched link, see "Cards are real links"), `.learn-card-summary`, `.learn-card-cta`. The time is plain text in the card (no nested interactive element); the link's accessible name is still just the module title. Module titles, summaries, routes and the grid are unchanged. The module pages do not show the reading time; showing it there too would be a possible later change.

**Reading time rule:** `readingMinutes` per module in `LEARN_MODULES` (`src/constants/learnModules.ts`) = `max(1, ceil(words / 200))`, words = whitespace-separated tokens of the visible text of the rendered module component (headings, paragraphs, lists, table text, diagram labels; without `pre` code blocks, `svg`, `aria-hidden`/`hidden`/`.sr-only` text and the page chrome: back link, previous/next). Standalone punctuation tokens such as "—" count as words (a plain split on whitespace); that makes `safe-habits` borderline (403 words, 400 is the 2-minute limit).

**The number cannot drift:** `src/__tests__/learnReadingTime.test.tsx` renders every module component and fails when a constant differs, with a message that prints the expected value. **To refresh a number** after editing a module's text: run that test, copy the `Set readingMinutes: N` value from the failure message into `learnModules.ts`. A new module needs a component in that test's `MODULE_COMPONENTS` map as well as its registry entry. Layout covered by `e2e/learn-cards.spec.ts` (1440/390/320 px: label between header row and title, time at the top right within 56px and on one line, no overlap, no overflow, one link per card, keyboard and click navigation, one h1).


## W5b: score sources, Limited data, unavailable mints, signed health record (2026-10-20)

- **Source line under every Reliability Score row** (`.rb-row-source`, 12 px muted, wraps; in the Overview panel and the breakdown dialog): "source · window · sample · time", built by `src/utils/scoreSources.ts` from real values only. Uptime: "our probes from {PROBE_LOCATION} · 24 h · N checks (the 24h history's probe count) · last probe {relative}"; Audit: "cashu.info · 7 days · N swaps · synced {relative}", and a neutral row says why instead ("N swaps, fewer than 10 (neutral)", "detail older than 7 days (neutral)", "no data (neutral)"); NUT support, Version, Contact: "declared by the mint in /v1/info" (+ "compared with the newest stable release" for Version) + "fetched {relative}". "Fetched" is the latest probe while the mint is online, else `lastOnlineAt`. The relative time is `formatTimeAgo`; its absolute UTC time is the `title` of that one span (allowed in `tooltipPatterns.test.ts`, and it shows up as `<DATE>` in `tooltip-texts.json`). The score header (panel and dialog) carries "Methodology v{METHODOLOGY_VERSION}" linking to `/methodology`.
- **Audit tab sentence** (`.audit-cz-muted`): which window the score uses and which the view shows ("The Reliability Score uses cashu.info's last 7 days; this view shows audit.8333.space's last ~100 swaps." / cashu.info view: "...uses this same cashu.info window..." / mint not covered by cashu.info: "...the Reliability Score does not use it", no cashu.info mention, which `mint-detail-audit-cz.spec.ts` requires).
- **"Limited data"** (`src/utils/limitedData.ts`, no thresholds of its own: `auditDataState` + `AUDIT_MIN_SAMPLES` + `NEW_MINT_MAX_DAYS`/`NEW_MINT_RELIABILITY_CAP`): shown next to the score badge in the Overview panel and in the breakdown dialog hero (an `InfoTooltip` chip), when the audit part is neutral or the new-mint cap applies; the tooltip lists the reasons ("Audit based on fewer than 10 swaps; tracked for 12 of 30 days, score capped at 75."). **Not** on the phone tile `.md-sc-reliability` (the whole tile is a button; a tooltip button inside would nest controls): phones see it in the dialog the tile opens. **Not on cards:** `MintCard` has no score tooltip or aria-label to extend, so nothing was added there (card heights untouched).
- **Mint that is not online** (`!isOnline`, `unavailableHeadline()` in `src/utils/unavailableMint.ts`): a `.md-unavailable` block at the top of the Overview: "Unavailable since {date} ({N} days)" (from `offlineSince`, else `lastOnlineAt`) or, for under 24 h, "Not responding since {date}" (never "archived"); "Last check {relative}"; "Last error: {text}" (`sanitizeLastError`: no URLs/control characters, 120 characters); the score stays, captioned "Last measured score. Measurements from this mint are not current." (in the sidebar panel from 901 px, repeated in the block on phones, and in the dialog); "What to do with tokens from an unreachable mint" (four sentences incl. whether NUT-09 was listed at the last check and the operator contact when the live probe knew one) + a link to `/learn/understanding-the-risks`. **Not done:** "longest outage in the last 90 days" (the outage history is a 30-day window, 90 days would be a new query).
- **Last known keysets:** `/api/mints/known` carries `offlineSince`, `lastKeysets` ([{id, unit, active, inputFeePpk}]) and `lastKeysetsCheckedAt` for a mint whose latest probe is not online (null / [] for online mints). The Keysets panel shows them, captioned "from the last successful check on {date}", when the live probe has no keysets; otherwise the old "Keyset data not available." stays. These names differ on purpose from the wallet API's `downSince`/`keysets` (the `/known` shape test forbids those names in `/known`).
- **Signed health record** row in Mint info (`.md-hr-row`, `src/utils/healthRecord.ts`): for a mint with a current event (not archived, a stored score, an https host that may appear in an event) two copy buttons, the naddr (kind 30385, `ATTESTATION_PUBKEY_HEX`, the `d` tag, `ATTESTATION_RELAYS_PUBLIC` as hints) and a ready `nak req` command, plus "About signed health records" -> `/for-wallets#signed-health-assertions`; otherwise "No current record" + the same link. No relay connection from the page. `healthIdentifier()` there is a copy of the backend's; `healthRecord.test.ts` imports the backend function and compares them on a URL table. Tests: `e2e/mint-detail-w5b.spec.ts`, `w5bMintDetail.test.ts`, `healthRecord.test.ts`.

## Change log panel, copy buttons, long error in the header (2026-10-20, W4 + Part F)

- **Change log** (`components/mint/MintChangeLog.tsx`, `hooks/useMintChanges.ts`, `utils/mintChangeLog.ts`): an `.md-panel.md-changes` — **since Task U (2026-10-21) on the History tab below Version history, see "Layout tidy-up (Task U)" at the end of this file** (it was at the END of the left column of the Overview; no new tab: the tab list, hash routing and `md-tabs` at 320 px stay as they are). Lazy: `GET /api/mints/changes?url=` is requested only when the panel is mounted AND armed after its first commit (Mint Detail applies a `#history`/`#audit` deep link in an effect after the first render, which briefly shows the Overview; the arming makes that flash request nothing). Newest 10 rows, "Show all (N)" (`audit-swaps-show-all-btn`, the existing pattern) expands to what the route returned (up to 100), "Show fewer" folds back. Row: type in plain words (`CHANGE_LABELS`; unknown type = "Change recorded"), `old → new` (a missing side is "—", the day-summary row `multiple changes` shows only that text), relative time (`formatTimeAgo`) with the absolute UTC time in `title` (`formatDateTimeUtc`), and a muted "seen first <time>" only when the confirmation took clearly longer than one interval (`showFirstSeen`: more than 10 min for `/v1/info` data, 70 min for keyset data). Empty: "No changes recorded yet." and "Tracking since <date>" when the route has `trackingSince`. Failure (or an answer in the wrong shape): `LoadError` with "Change log is not available right now." + Try again, never "no changes". Values wrap (`overflow-wrap: anywhere`), no horizontal scroll at 320 px. While loading a placeholder as tall as the empty state keeps the panel's size (measured within 12 px, layout shift < 0.02, `e2e/mint-detail-change-log.spec.ts`). No tooltip, no `title` explanation. Wording never judges: a change is not a warning. `installApiMocks` answers the route with an empty log.
- **Copy buttons (Part F1):** the labelled copy buttons now follow the pattern of the code blocks on `/for-wallets` (`CodeBlock.tsx`): class `doc-copy-btn` (`DocPage.css`, 32 px, 44 px on a coarse pointer), label "Copy ..." that turns into "Copied" / "Copy failed" for 2 s, `aria-label="Copy: <what>"`, a polite status. On Mint Detail that is the pair in the Signed health record row ("Copy naddr", "Copy nak command"), via `components/mint/CopyTextButton.tsx` (which imports `DocPage.css`; `.md-hr-btn` is gone). NOT changed: the icon-only copy buttons next to a value (public key, URLs, contacts, keyset id, reviewer npub, review link: one consistent small control with an `aria-label`, covered by `copy-buttons.spec.ts`), the QR dialog's "Copy" (the modal language's green outlined button) and every copy control outside Mint Detail.
- **Long lastError in the header (Part F2):** the badge (`.md-error-badge`) stays a single line with an ellipsis. From 641 px it used to keep a `60vw` cap and the action group could not shrink: at 641-768 px Compare ended up off screen, from 769 px the absolutely placed group grew leftwards over the avatar and the name. Now `.md-hdr-center` may shrink, the badge is the only thing that gives way, and from 769 px the group takes at most 56% of the header (`MintDetail.css`, next to `.md-hdr-error`). The full text stays in the badge's DOM and in the unavailable block (capped at 120 characters, unchanged). `long-text-overflow.spec.ts` ("a 600-character lastError is clamped in the header and overlaps nothing") checks 1440/768/390/320 px: the badge is clamped and intersects no leaf element of the header, stays inside the header, no horizontal scroll.

### Mint Detail — contact checks line (2026-10-20, W6a)
Under the contact information (`.md-panel` of "Get in touch") one muted line, `.md-contact-checks` (12 px, `--text3`, `overflow-wrap: anywhere`, wraps at 320 px), built by `src/utils/contactChecks.ts` (`contactChecksLine`, rendered by `components/ContactChecksLine.tsx`) from the probe answer's `contactChecks` (`MintStatus.contactChecks`, `readContactChecks()` drops malformed entries): `Contact checks: email format recognised, domain has mail records · Nostr contact format recognised · checked 5 min ago`. Facts only: format recognised / not recognised per kind (never "valid" / "invalid": `not recognised` states what MintRadar understood, not that the contact is wrong; Part N), `domain has mail records` / `domain has no mail records` for DNS answers, `domain lookup inconclusive` for `null` (never "no records"); several entries of one kind are counted ("recognised for 2 of 3"). The relative time uses `formatTimeAgo`, the absolute UTC time is the `title` (same pattern as the score source lines). No check (`[]` or no field) means no line. The panel also renders when the only thing it holds is this line (e.g. a mint listing only a website), without the "Get in touch" heading, like the NIP-05-only case; values shown are unchanged. Never the words verified/trusted/fake (`contactChecks.test.ts` pins it). e2e: `mint-detail-contact-checks.spec.ts`.

## Fees and limits, deposits and withdrawals (2026-10-21, W6b)

Facts only, no scoring change, no `METHODOLOGY_VERSION` bump, no new request to a mint or to our API (the group reads what the page already has).

- **"Fees and limits" group** (`components/mint/MintFeesLimits.tsx`, pure logic in `utils/feesLimits.ts`): a `.md-panel.md-fees-limits` — **since Task U on the NUTs tab, first card (see the end of this file)**; it used to sit in the left column of the Overview, right after the Network card. Header `.md-fl-head`: the title and an ⓘ `InfoTooltip` at its right end (`about="Fees and limits"`, text `LIMITS_NOTE`: "Limits are declared by the mint. Lightning fee reserves depend on the invoice and are known only when a quote is requested, so MintRadar does not show them."). Body (Task U2: the small uppercase sub-headings are gone): one `.md-info-row` per unit labelled "Input fee · <unit>" (`data-testid="mint-fees"`, `.md-fl-fees`; its last row keeps the row hairline as the divider), then the declared-limit rows (`data-testid="mint-limits"`), then one muted source line (`.md-fl-note`, 12 px): "declared by the mint in /v1/info · fetched 5 min ago" (relative time with the absolute UTC time as `title`, the same pattern and the same `infoFetchedAt` as the W5b source lines: the latest probe while the mint is online, else `lastOnlineAt`). The explanatory sentence is only in the tooltip, never in the card body, and never in a `title`.
- **Fee examples:** the keysets are the ones the Keysets panel already shows (`data.keysets` of the probe, or `lastKeysets` of a mint that is not online; `feeKeysets` in `MintDetail.tsx`). `feeExamplesOf()` (`utils/feeExamples.ts`, **byte-identical copy of `backend/src/shared/feeExamples.ts`**, pinned by `sharedModules.test.ts`) takes per unit the largest `input_fee_ppk` among the ACTIVE keysets (a keyset that states no `input_fee_ppk` uses the NUT-02 default 0, F2 2026-10-21; so does one that states an UNUSABLE value (negative, fractional, above 1,000,000): the stored column is `null` for both and the wallet `keysets[].inputFeePpk` stays `null` for both. A read of `/v1/keysets` of all tracked mints on 2026-10-21 found 71 active keysets, all with a valid number, none absent, none unusable, so the sync was not changed; if an unusable value ever appears, `keysetsSync.ts` would have to store it differently from an absent field, with W4 protected from a null -> 0 change row) (the W4 "effective fee") and computes the fee of spending 1, 16 and 100 proofs by the NUT-02 rule `ceil(sum ppk / 1000)` in integer arithmetic. Row: "Input fee · sat | Spending 1 / 16 / 100 proofs: 1 / 2 / 10 sat"; effective ppk 0 = "No input fee"; no keysets = "Keyset data not available yet"; only inactive keysets = "No active keyset"; several units = one row each, sat first.
- **Limits:** `limitRows()` over `knownMint.mintMethods` / `meltMethods` (the stored NUT-04 / NUT-05 entries): "Deposit (mint) · bolt11 · sat | min 1, max 1,000,000"; a limit that is missing or not a non-negative integer reads "not declared", never a number; a direction with no methods "no methods declared"; a direction the operator disabled "disabled by the mint". Method and unit names must match `[a-z0-9_-]` (untrusted text); numbers use `toLocaleString('en-US')`.
- **Layout:** label left / value right (the `.md-info-row` recipe), the value wraps under the label at 480 px and below, `overflow-wrap: anywhere`, all text 12 px or more. **No layout shift:** while the probe is pending the fee block is a "Checking keysets…" row with `min-height: calc(<units listed> * --md-fl-row-h)` (`reservedFeeLines()`, one line per unit `/api/mints/known` lists), so the keysets arriving later change the group by at most 12 px (measured, layout shift < 0.02 in the spec).
- **Audit tab rows** (`components/AuditDirections.tsx`, `utils/auditDirections.ts`), cashu.info view only, under the four tiles: "Deposits (mint)" = `swaps7d.asDest` (the mint was the destination of a swap), "Withdrawals (melt)" = `swaps7d.asSource`: "62 attempts, 6 failures · 7 days · cashu.info · synced 10 min ago" (absolute UTC time in the `title`), "No data from cashu.info" for a direction without numbers, one muted sentence "The Reliability Score uses the combined number. These rows are the same data split by direction." The sample size is shown as it is (no threshold, no colour). The tiles Payouts / Receives (x / y successes) stay. Not shown in the audit.8333.space view (that source has no direction split: `n_mints` / `n_melts` are lifetime counts, `n_errors` has no direction) and not for a mint cashu.info does not cover (the tab then says what it said before).
- **Where the data comes from:** nothing new is stored. The split is in `audit_cz_detail.detail` since the detail job exists (validated `swaps7d.asSource` / `asDest` `{ total, success, failed, avgMs }`, window 7 days); the Audit tab already receives it, and the wallet API reads it with one more sub-select in the snapshot query (`audit_directions_json`, see `backend-api-and-data.md`).
- Tests: `feeExamples.test.ts` (backend) and `feesLimits.test.ts`, `auditDirections.test.ts` (frontend); `e2e/mint-detail-fees-limits.spec.ts`, `e2e/mint-detail-audit-split.spec.ts`.


### Mint Detail — "Nutzap-related features" group (2026-10-21, W7a)

Facts only, no scoring change, no `METHODOLOGY_VERSION` bump, no verdict, no request of its own.

- **REMOVED in Task U (2026-10-21):** the panel and `MintNutzapFeatures.tsx` are gone, replaced by one muted sentence on the NUTs tab (see the end of this file); `utils/nutzapFeatures.ts` and its unit test were deleted in Task X (nothing imported them). What follows is history. **Component:** `components/mint/MintNutzapFeatures.tsx` + pure rows in `utils/nutzapFeatures.ts`; a `.md-panel.md-nutzap` in the Overview left column, right after "Fees and limits" (only for a tracked mint, like that group). CSS: `.md-nutzap` in `MintDetail.css` (the `.md-info-row` recipe, value wraps under the label at 480 px, all text 12 px or more).
- **Rows:** NUT-07 (Spent check), NUT-10 (Spending conditions), NUT-11 (P2PK locking), NUT-12 (DLEQ proofs), each "supported" or "not declared". "supported" = the number is a key of `nuts` in the mint's `/v1/info` (`data.info`, or the stored `knownMint.nutsLimits` before the probe answers) — **the same rule as the NUT compatibility grid, its modal and its summary count (`utils/nutSupport.ts`, Part G 2026-10-21): an entry that is an object with `supported: false` is NOT supported; `supported: true`, an object without a `supported` key (older mints declare a NUT by presence, with settings), `{}` and any other value stay supported; an absent key is not declared.** This is display-only: the Reliability Score's NUT count on the page (the breakdown row), the backend score (`prober.ts` `nut != null`), `/api/stats` NUT adoption, the wallet API's `nuts` field and the `nuts=` filter (`walletApi.ts` `nutsOf`) still count presence, so a mint with `"7": {"supported": false}` is counted as having NUT-07 there (reported 2026-10-21, not changed; fixing it would change scores and the API). While neither list is known the values read "—" (nothing is claimed either way). No combined "nutzap ready" line, on purpose.
- **Why a group when the grid already lists the NUTs:** the grid shows only ✓ / – per card, with neither the words, nor the source, nor the time. The group says "declared by the mint in /v1/info · fetched <relative> ago" (absolute UTC in the `title`, `limitsSource()` from `utils/feesLimits.ts`, time = `infoFetchedAt` of the page).
- **No tooltip** (so `tooltipExpected.ts` is unchanged). Tests: `e2e/mint-detail-nutzap.spec.ts` (the unit test `nutzapFeatures.test.ts` went with the util).

## Layout tidy-up: Fees and limits, Nutzap sentence, Change log (2026-10-21, Task U)

Frontend only: no scoring, API or data change. Where things are now:

- **NUTs tab** (`MintDetail.tsx`), top to bottom: **Fees and limits** (`MintFeesLimits`, unchanged content: input fee examples, declared limits per method and unit, the muted `/v1/info` sentence and the source/time line; only for a tracked mint) → Keysets (phones only, as before) → NUT compatibility. The old "NUT limits" card (NUT-04 / NUT-05 min–max grid, `groupNutLimits` render) is removed; `utils/nutLimits.ts` and its unit test were deleted in Task X (nothing imported them). The Overview no longer has a Fees and limits group. Keysets stays in the Overview sidebar on desktop.
- **Nutzap-related features panel: removed from the Overview.** Under the NUT compatibility grid one muted sentence (`.md-nut-nutzap-note`, 12 px, `--text3`): "NUT-07, NUT-10, NUT-11 and NUT-12 are the ones nutzaps (NIP-61) rely on." (`NUTZAP_NUTS_NOTE` in `MintDetail.tsx`; no verdict, no "ready"). The wallet API docs example `nuts=11,12` is unchanged.
- **Change log: History tab, below Version history** (`MintChangeLog`, still lazy: the request is made when the History tab is shown; failure text "Change log is not available right now." with Try again, in the card). The web list does NOT show `version_changed` rows (`webChangeRows()` in `utils/mintChangeLog.ts`; Version history already lists software versions; the API and the stored rows keep them). Newest 10 of the rest, "Show all (N)" counts the rest. **No rows to show = no card**: one muted line `.md-changes-line` "No changes to keys, fees or keysets recorded since <date>." (no tracking date: "No changes recorded yet."). While loading, a line-high placeholder (`change-log-loading`, `aria-busy`) keeps the height, so an empty log shifts nothing; a log with rows grows the end of the History tab only.
- Reliability Score card and its row tooltips are untouched.
- Tests re-pinned: `e2e/mint-detail-fees-limits.spec.ts` (NUTs tab, first card, absent from the Overview), `e2e/mint-detail-nutzap.spec.ts` (rewritten: panel absent, the sentence, widths, the NUT card shapes), `e2e/mint-detail-change-log.spec.ts` (History tab, no-card line, version_changed filter, loading placeholder), `src/__tests__/mintChangeLog.test.tsx`.
