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
renders one row (label + ⓘ tooltip + measured value + score bar); it owns its own
`useRef`/`useTapTooltip` internally rather than taking one as a prop, specifically so the same
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
heading has a short title-tooltip explaining keysets / Active vs Inactive. Tests:
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
  `.audit-tooltip` only resets `font-family`, not the other two, so the tooltip visibly looked
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
- **Data:** `useAuditCz()` (`src/hooks/useAuditCz.ts`) makes ONE request to OUR `GET /api/mints/audit-cz?url=…&limit=100&direction=both` while the Audit tab is active (never to cashu.info). `detail` = the validated subset stored by the 30-minute cron (docs/API.md; every field optional), `swaps` = our stored swaps of both directions, newest first, `stats7d.collectedSince` = oldest stored swap. The old `detail7d` is gone (backend and frontend).
- **Adapter:** `adaptAuditCz()` (`src/utils/auditCz.ts`, pure) returns `tiles`, `checks`, `swaps` (both directions, for the bar), `fromRows` / `toRows` (split by the `direction` field; a swap with this mint on both sides arrives once, as `from`), `collectedSince`, `notRecent`, `sourceHref`. The component is `src/components/AuditCzCards.tsx` (`AuditCzTiles`, `AuditCzChecks`, `AuditCzSwapTables`); styles `.audit-cz-*` in `MintDetail.css` (they reuse the `.audit-summary-*` tile classes and the existing surface/border tokens, no new colours).
- **Tiles** (`.audit-cz-tiles`, 2x2 up to 900px, one row above; big number in `var(--accent)` — one constant colour, no thresholds — and an uppercase label via CSS, each with the existing ⓘ `InfoTooltip`): **Paid out melts** = `asSource.success / asSource.total`; **Received mints** = `asDest.success / asDest.total`; **Attributed of N failed swaps** = `errorsBlamed` with `all.failed` in the caption (singular "1 failed swap"); **Avg swap time** = `all.avgMs` as "8.3 s" (under a second "640 ms"). A tile whose source field is missing is hidden. The old "Recent success rate" tile and its code (`auditCzSuccessTile`, the 3-swap minimum, `recentTotal/Errors`, `nMints/nMelts`, `detail7d`) are removed from this view. Tooltips: melts "Swaps in the last 7 days in which this mint paid out a Lightning invoice, counted by cashu.info (successful of all)"; mints "…received ecash from another mint (successful of all)"; attributed "Failures that cashu.info attributes to this mint. The other failed swaps were not caused by this mint, for example amounts below its minimum or Lightning routing."; avg "Average swap time over the last 7 days as reported by cashu.info." (never says it counts only successful swaps).
- **Outcome bar:** the stored swaps of BOTH directions together (up to 44, newest left), same marks and neutral rule as before.
- **Checks by the auditor** (`auditCzChecks()`): line 1 from `swaps7d.dleq`: valid > 0 and invalid = 0 → "Proof signatures N valid, 0 invalid — the mint signed them with its published key."; invalid > 0 → "Proof signatures N valid, M invalid — some signatures did not verify against the mint's published key." (no accusation words); `missing` > 0 appends "K without a proof."; all three 0 hides the line. Line 2 from `integrity.proof_state`: checked > 0 and spent = 0 → "Our ecash N proofs still unspent — the mint has not marked them spent."; spent > 0 → "S of the auditor's N proofs were marked spent by the mint."; pending > 0 appends "P pending."; checked = 0 hides it. NO swap-test line. Under the card: "Tests the auditor ran with its own small amounts. They do not prove that the mint can pay out everything it owes." The whole card hides when neither line has data. Only numbers are interpolated (a non-number is treated as missing).
- **Swap tables:** two cards "Swaps from this mint" (first column **To**, the destination host) and "Swaps to this mint" (first column **From**, the source host), columns Amount (`N sat`) | Fee | Duration (`N ms`) | State, three rows each with their own "Show all (N)" / "Show fewer", the same row rules as before (limits / balance / pending neutral with "below minimum" / "auditor balance", failure reason below). An empty card shows "No swaps collected yet". Under the tables "Collected by MintRadar since <d MMM>" (UTC) only while the oldest stored swap is younger than 7 days.
- **Failure reason (2026-10-05):** the State cell of every row that is NOT OK carries the swap's `error` text as a `title` (at most 200 characters, cut with "…") and as visually hidden text (`<span className="sr-only">` after the visible text; a title alone is not available on touch or to screen readers; the hidden text is not cut at 200, the endpoint stops at 300). The visible text stays "failed (melt)" / "below minimum" / "auditor balance" / the pending token. Grey rows (limits, balance) start the title with the fixed explanation ("Not counted against the mint: …") followed by ". " and the error text; they keep the explanation alone when there is no error text. No error text → no title and no hidden element; OK rows never get either, whatever the endpoint sends. The text is untrusted: `cleanAuditError()` (`utils/auditCz.ts`) drops control, zero-width and bidi-override characters, turns line breaks/tabs into spaces, collapses whitespace and caps at 300; `adaptAuditCz` sets `AuditSwapRow.reason` (cz rows only, so the 8333 table is untouched); React renders it as text, it is never a class, URL or HTML. `auditCzStateTitle()` builds the title. `.audit-swaps-table-wrap` is `position: relative` so the absolutely positioned `.sr-only` span of a far-right cell is clipped by the scroll box and cannot widen the page (without it the 390px page overflowed to 708px).
- **Source switch:** `.md-audit-seg` in the card header row (right-aligned, wraps under the title when narrow), `role="group"` `aria-label="Audit source"`, `aria-pressed`, options "cashu.info" | "8333.space"; shown only when BOTH sources have data (8333 data exists and cz covers the mint). Same recipe as the Stats "Uptime | Reliability" toggle (`.stats-tab-toggle`/`.stats-tab-btn`, copied under `.md-audit-seg*` because Stats.css can't be loaded here — it has a global `.audit-tooltip`), 44px via an invisible `::before`. **Default:** cashu.info when the 8333 data is missing or stale (`auditFreshness`: auditor >7d or our sync >24h), otherwise audit.8333.space (the panel is then unchanged except for the switch). 8333 only / cz only → no switch. Not covered / request failed → 8333 panel or "No audit data available" exactly as before.
- Never merged into any MintRadar number or the Reliability Score. cashu.info's own score, scoreParts and reviews are never stored, requested by the frontend or shown. cashu.info sends no IP address; the mint host's own public IPv4 is resolved by OUR backend from public DNS (see below).
- Tests: `src/__tests__/auditCzView.test.ts` (tiles, checks, tables, freshness, link validation, neutral kinds, failure reason); `e2e/mint-detail-audit-cz.spec.ts` (cz-only card with the LNpay-shaped detail, request audience `direction=both&limit=100`, neutral rows, tile cases, checks states, the two tables and the "collected since" line, source switch incl. keyboard + 44px touch, covered:false / stale 8333, loading state, hostile text in swaps AND in detail fields, link validation, failure reason in the State cell, 390px).

## Overview: info cards and the Network card (2026-10-07)
- **Cards, top to bottom:** About (MOTD / description, unchanged), **Mint info**, **Network** (new), **Get in touch** (unchanged). Mint info (Name, Version, Discovered "NIP-87", Server time with the clock-drift label, Public key with the copy button, ToS link, URLs) keeps all its data and logic; only the grid changed: `.md-info-grid.md-info-list` is ONE column of label-left / value-right rows with hairline dividers (`.md-info-row`, `border-bottom: 1px solid var(--border)`), instead of the old two-column grid.
- **Network card** (`src/components/MintNetworkCard.tsx`, formatters in `src/utils/networkInfo.ts`): a `.md-panel.md-network-card` with the title "Network" and the small tag "via cashu.info" (`.md-panel-tag`). It is rendered ONLY when the stored cashu.info detail has a `network` block (`networkRows()` returns null otherwise, also when no detail is stored or the mint is not covered). Data: the same `useAuditCz()` query as the Audit tab (one request to OUR `/api/mints/audit-cz`, shared query key), now enabled while the Overview OR the Audit tab is active; the browser never contacts cashu.info.
- **Rows** (each hidden when its data is missing): **IP** = "IPv4 only" / "IPv6 only" / "IPv4 and IPv6" (hidden when both are false or either is unknown); **Network** = "AS{asn} {name}" where the name is the `asName` text after the first " - " (else the whole text), cut at the first comma, capped at 48 characters ("AS14061 DigitalOcean"); **Registered in** (was "Country") = English name from `Intl.DisplayNames` (the code when unknown; hidden unless the value is two capital letters) with an ⓘ tooltip "Country where the network block is registered, not necessarily where the server stands."; **Tor** = "Onion address available" / "No onion address" (from the stored `onion` boolean; the onion address itself is never stored); **TLS** = "{issuer}, expires {d MMM yyyy}" (UTC), "{issuer}, expired {d MMM yyyy}" in `var(--amber)` once the date has passed, and " · expires soon" appended in `var(--amber)` when fewer than 14 days remain.
- **IP row = our own IPv4 lookup (2026-10-07):** `backend/src/mintAddress.ts` resolves every tracked mint host (`resolve4`, private ranges dropped, none for .onion / IP-literal hosts; failed lookup keeps the old value) once after boot and every 6 h (`20 */6 * * *`) into `mints.ip_address`, served as `ipAddress` on `/api/mints/known`. Independent of cashu.info, so mints no audit service covers still get a card with just the IP row (no "via cashu.info" tag). IPv6 is deliberately not shown or stored. An offline mint (`knownMint.online === false`) without an address shows the text "Offline" in the IP row (typically a dead domain: DNS fails). A CDN-fronted mint shows the CDN's address. `networkRows(detail, ip, now)` validates the string as dotted IPv4.
- Tests: `src/__tests__/networkInfo.test.ts` (IP wording, AS name cleaning, TLS states, country names, hostile strings); `e2e/mint-detail-network-card.spec.ts` (LNpay-like card, row order and divider/alignment recipe, caveat tooltip, IP wording, expired / expiring / plain certificates, Tor, no detail / no network block / not covered, hostile strings, own-backend-only requests, 390px).
