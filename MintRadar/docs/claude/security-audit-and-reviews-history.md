# MintRadar — Security audit history, external reviews, ESLint cleanup (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
### Security audit

Original report in `AUDIT.md` at the repo root (2026-06-20). Covers: telemetry, key
handling, dependencies, XSS, backend API, secrets, Docker, HTTP headers. As of 2026-09-07
`npm audit` is **0 vulnerabilities in both trees** (the Vite 5→8 upgrade shipped and closed
the old 6 dev-server-only frontend findings — the "Frontend has 6 remaining" line in older
notes / AUDIT.md's body is stale, see its UPDATE banner).

#### Prior audit history

- **Run-1 (2026-08-16, `security-audit` skill).** 5 findings, all verified remediated in
  code by run-2: WebSocket connect-time DNS pinning (harness-verified), login-shim
  `__mintradarShim` marker, the `/api/notifications/unsubscribe` log-injection fix (run-2
  L1 found the sibling `/subscribe` endpoint was missed — now fixed too), and the
  `isValidCashuMint` submit/discovery gate (run-2 MEDIUM #2 showed it is bypassable — see
  the daily `revalidateMints()` sweep under Cron jobs).
- **Run-2 (2026-09-07, full 8-agent `security-audit` skill run).** Output in
  `~/security-audit-skill/MintRadar/run-2/` (REPORT.md, FINDINGS-DETAIL.md, findings.json —
  validator PASS). **1 HIGH + 6 MEDIUM + 7 LOW — all remediated + deployed by 2026-09-08.**
  - **HIGH H1** — a malicious mint self-inflated its Reliability Score to 100 (→ #1 "Most
    Reliable" / Best Mint Wizard) via 60 fake `/v1/info` `contact` entries.
    `contactComponent()` now clamps `Math.min(contactCount, 3)` before the ratio — commit
    `e599749`, see "Reliability Score calculation → Contact component" above.
  - **MEDIUM** — M1 `icon_url` favicon deanonymization beacon → SSRF-guarded
    `GET /api/mint/icon` proxy (`b0c3dd8`, see Backend API). M2 "validate once, then
    DNS/redirect-repoint anywhere" confused-deputy → daily `revalidateMints()` +
    `mints.invalid_since` + 7-day reap (`0f53f15`, see Cron jobs). M3 notification fan-out
    amplifier signed by the service key → per-pubkey subscription/relay caps (`aed8159`,
    see `POST /api/notifications/subscribe`); residual sybil-key vector tracked, not closed.
    M4/M5/M6 client-side pubkey-race / hostile-relay trust issues → `5ff2b8d`, see
    "Watchlist sync + relay bootstrap hardening" below.
  - **LOW** — L1 log injection via `relays[]` in `/subscribe` (`sanitizeLogValue()`,
    `ac7c174`). L2 `initBunkerQR` cancelled-QR race → orphaned signer + silent re-login,
    now abort-checked (`0a0cdd0`). L3 NIP-46 `onauth` `window.open` unvalidated →
    `openRemoteSignerAuthUrl()` (https-only, `noopener,noreferrer`) at all 3 onauth sites
    (`ac7c174`). L4 client-side SSRF via a pasted token's `mint` URL →
    `assertProbeableMintUrl()` guard in `cashuToken.ts` (`07a8eac`, see Token Inspector).
    L5 `/api/mint/probe` fetch-oracle → response shrunk for non-known URLs (`ac7c174`, see
    Backend API). L6 "Show my latency" unvalidated route-param fetch → https/length guard +
    `credentials: 'omit'` (`ac7c174`). L7 stale `pendingAutoWatchRef` auto-watch →
    `usePendingAutoWatch(url, isLoggedIn, onAutoWatch)` hook (URL-pinned, timestamped, 60s
    TTL, dropped on route change / Cancel) (`ac7c174`).
  - **Hardening follow-ups** — atomic notification cooldown (`dc4d993`, see
    `notifySubscribers` below); NIP-98 single-use nonce cache (`da7c46d`, see Backend API);
    `script-src` drops `'unsafe-inline'` (`32abfa9`, see the nginx CSP gotcha);
    `discovery.ts` + `versionCatalog.ts` routed through `safeFetch` (`11c30f1`, see
    Discovery pipeline); 4 low-risk items in `3c8867f` (navbar avatar `https://` scheme
    guard; `deploy/nginx.conf` OG map regex `[^/?]+` → `[^/?&#]+`; comment that
    discovery/reviews `SimplePool` is NOT DNS-pinned and only safe because its relay lists
    are hardcoded constants). Community Rating sybil mitigation (disclaimer + `InfoTooltip`
    + `reviewSurge` flag) — see "Reviews Feature" (`a07404b`, `e2b04be`).
  - **User Qs cleared:** NUT-07 checkstate is button-only and leaks no proof secret
    (cashu-ts `NullLogger`, `/v1/checkstate` sends only `hashToCurve(secret)`); a mint
    can't appear "watched" before real auth; nsec never persisted/logged; SQL fully
    parameterized; OG fragment XSS-safe.

#### Watchlist sync + relay bootstrap hardening (2026-09-07, audit M4/M5/M6, commit `5ff2b8d`)

- **M4 — `useWatchlistSync.doSync()`** captured `pubkey` at effect time and never re-checked
  it after `await fetchRemoteWatchlist()`; a logout+login of a different user on the same
  device mid-fetch let user A's remote list be written to Dexie and re-published as user B's
  own kind:10003. Now re-reads `useAuthStore.getState().profile?.pubkey` after every `await`
  and discards the result untouched if it changed; the `isSyncing` guard is only released by
  the run that still owns the active identity.
- **M5 — `fetchRemoteWatchlist()`** took the first relay to answer (`Promise.any`) with no
  `created_at` comparison, so a lagging/stale relay silently rolled the watchlist back and
  Phase 2 re-published the older revision. Now **collects** events across relays within the
  wait window (all-settled, or a short grace after the first event, capped at the existing
  3s) and keeps the highest `created_at`; also drops events whose `pubkey` != the user (a
  relay ignoring the `authors` filter).
- **M6 — `bootstrapUserData()` / `subscribeFirstEvent()`** acted on the first kind:0 /
  kind:10002 a relay returned, checking only `verifyEvent()` (signature self-consistency,
  not ownership). A hostile relay in `META_RELAYS` could set the victim's displayed
  name/avatar and swap in an attacker-controlled NIP-65 relay list, redirecting outbound
  watchlist/DM traffic. Now pins `ev.pubkey === expectedPubkey` before use.
- Tests: `src/__tests__/{watchlistSync,bootstrapUserData,useWatchlistSync}.test.ts` +
  an e2e case in `watchlist-sync-status.spec.ts`.

## Grok external review (2026-07-02)

- An external AI analysis of the project identified that not all official NUTs were tracked — led to the NUT tracking expansion above.
- Other recommendations were either already implemented, or knowingly rejected (see decisions below).
- Rejected: reserve audit verification (no standardized NUT for it), dark/light mode toggle, watchlist share link (conflicts with privacy-first design), historical NUT snapshots, comparison tool for more than 4 mints, search by operator pubkey (no data linkage exists), multi-region probe infrastructure.
- NUT security warning badge (NUT-09/11/12) — verified against live data: currently 0 of 55 online mints are missing these NUTs, so the badge would be dead code. Rejected.
- Multi-unit criterion in Best Mint Wizard — **IMPLEMENTED (2026-08-19)**. The original 2026-07-02 note here said units were "never persisted... requires parsing `/v1/keysets`" — that has been obsolete since the `units`/`mint_methods`/`melt_methods` columns landed. Units are parsed by `parseMintMethods()` in `prober.ts` from the NUT-04/NUT-05 `methods` arrays of `/v1/info` (no `/v1/keysets` call is involved), persisted on every probe cycle, and served by `/api/mints/known` on the `KnownMint` type. The wizard now has a unit dropdown built from the distinct units of online mints, filters candidates to mints advertising that unit, and shows the per-unit NUT-04/05 min/max limits on each recommendation. Reliability Score / latency / nutCount remain whole-mint metrics — the results panel says so explicitly.

## ESLint zero-errors cleanup (2026-07-05)

The codebase is at **0 ESLint errors** (frontend + backend). Keep it that way — `eslint-plugin-react-hooks` v7 enforces compiler-grade rules (`purity`, `set-state-in-effect`, `refs`). Patterns established during the cleanup; reuse them instead of re-introducing effects:

- **`useNow()`** (`src/hooks/useNow.ts`) — ticking clock store via `useSyncExternalStore` (30 s interval, shared across subscribers). Use it for ANY "current time" read during render ("checked Xm ago", age thresholds, chart bucket alignment). Never call `Date.now()` in render/useMemo — the purity rule blocks it. Used by: ComparisonModal, MintDetail (chart slots), Tools (Token Inspector).
- **Keyed/derived state instead of setState-in-effect** — async results are stored keyed by the input they were produced for; `loading` is derived (`key !== currentInput`), never set synchronously in an effect. Applied in:
  - `useMintReviews` — reviews keyed by mint URL (also fixed a stale-data race when switching mints)
  - Dashboard submit form — `probe` keyed by `submitUrl`, `nostrLookup` keyed by trimmed input
  - Watchlist pagination — `extraVisible` keyed by `listKey` (sort + filtered list content); side effect: pagination no longer resets on every 60 s data refetch
- **AppShell login modal** — single `closeLoginModal()` callback resets all modal state and is wired into every close path (overlay, X, Cancel, Escape, successful login incl. QR flow). Do NOT re-add "close on profile change" / "reset on close" effects. In the QR success path `qrCancelRef` is nulled BEFORE close so the live BunkerSigner is not aborted.
- **`useWatchlistSync`** — `userWriteRelaysRef` is written in an effect (declared before Phase 1/2 effects, so it's current within the same commit); Phase 1 reads relays from the ref.
- **`pool.ts`** — `PatchableRelay` is a standalone type, NOT an intersection with `AbstractRelay` (its private `reconnectAttempts` collapses intersections to `never`). GOTCHA: `npm run typecheck` (`tsc --noEmit`) missed this; only `tsc -b` (used by `npm run build`) caught it — build is the authoritative type gate.

