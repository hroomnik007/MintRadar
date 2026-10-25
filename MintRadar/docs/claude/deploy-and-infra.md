# MintRadar — Deploy pipeline, nginx/CSP, PWA, dependencies, bundle layout (split from CLAUDE.md)
> Note: references like "see X below" in this file may point into another docs/claude file; the map is the index in CLAUDE.md.
## Deploy Pipeline Notes

- There are four active GitHub Actions workflows, all at the **repo root** in `/.github/workflows/`: `deploy.yml` (Deploy MintRadar: tests, then deploy), `tests.yml` (Unit tests: the same two unit suites on every pull request), `security.yml` (Security: gitleaks) and `nginx-config-drift-check.yml` (Nginx Config Drift Check, informational). Each has a top-level `permissions` block (`contents: read`; `security.yml` also `pull-requests: read`). A dead duplicate previously existed at `MintRadar/.github/workflows/deploy.yml` inside the project subdirectory — GitHub Actions never ran it, but it caused confusion during debugging. It has been deleted. When editing CI/CD config, always confirm you're editing the root-level file.
- **Unit tests on pull requests (2026-10-20):** `.github/workflows/tests.yml` ("Unit tests") runs the same backend and frontend unit-test steps as the `test` job in `deploy.yml` on every `pull_request`, with `permissions: contents: read`, no secrets (so fork and Dependabot PRs work), a per-PR `concurrency` group that cancels older runs and `timeout-minutes: 15`. One job, so a red backend step skips the frontend step. Lint, typecheck and e2e are intentionally NOT in CI (see "Verification policy" in `CLAUDE.md`); `deploy.yml` is unchanged and runs only on push to `main`.
- The root workflows pin `runs-on: ubuntu-24.04` instead of `ubuntu-latest`; update the pin deliberately and watch the first run.
- The deploy sequence runs `sudo rm -rf /var/www/mintradar/dist/assets/*` before copying the new build. This is intentional: `rsync --delete` was silently failing to remove old `root:root`-owned asset files left over from a prior deploy mechanism while still reporting success, causing stale content-hashed files to accumulate alongside new ones.
- The GH Actions workflow SSHes into the VPS, pulls latest code, builds on the server (`npm ci --ignore-scripts && npm run build`, see "Dependency policy"), then copies dist to the nginx root. The `rsync dist/` step documented in the deploy workflow above reflects the original mechanism — the active workflow in `.github/workflows/deploy.yml` is authoritative.
- **GOTCHA — Dependabot PRs:** Never merge multiple Dependabot PRs in rapid succession. Each merge triggers a GH Actions deploy that runs `rm -rf node_modules && npm ci` on the VPS (since 2026-10-14 `npm ci --ignore-scripts`, see "Dependency policy"). Concurrent runs race on the same node_modules directory, corrupting TypeScript's lib files and causing `Cannot find global type 'Boolean'` / `lib.es2022.d.ts not found` errors. Merge one, wait for the run to complete, then merge the next.
  - **Two layers of automated protection now in place (2026-08-15, following the lucide-react/stray-node_modules incident below):** (1) `.github/workflows/deploy.yml` has a workflow-level `concurrency: group: deploy-${{ github.ref }}, cancel-in-progress: false` guard — overlapping pushes to `main` now queue and run sequentially instead of racing on the VPS path (`cancel-in-progress: false` deliberately, since the deploy does `git reset --hard origin/main`+`npm ci` and a cancelled mid-deploy could leave the VPS in a worse state than a queued one). (2) `.github/dependabot.yml` now groups all npm updates per directory into a single PR (`groups: all-dependencies: patterns: ["*"]`) instead of one PR per bump, so a Dependabot run produces one merge/one deploy instead of ~10. The manual "merge one, wait for the run to complete" discipline below is now a backstop, not the only defense — but still follow it for any PRs that arrive outside Dependabot's own grouping (e.g. manually opened PRs, or if grouping is ever reverted).
  - Confirmed working (2026-07-24, commit 9abda76 session): 10/10 open Dependabot PRs (patch/minor bumps + one ESLint 9→10 major) merged sequentially, each followed by `gh run watch` on the deploy workflow before starting the next. Zero failures, zero VPS races.
  - **ESLint major-version bumps:** before writing/changing any `eslint.config.js`, check whether the package actually has its own config file. `MintRadar/backend` has none — its `npm run lint` resolves ESLint's flat config by walking up to `MintRadar/eslint.config.js` (this works because ESM imports inside that config file resolve relative to the config file's own path, not the invoking CWD). Verify this kind of resolution still works after a major bump with `eslint src/ --debug 2>&1 | grep -i "config"` (look for `Using config file ... and base path ...` plus a nonzero linted-file count) *before* assuming a config rewrite is needed.
  - **`npm install`/`npm ci` working directory:** this is a monorepo with THREE `package.json` locations if you're not careful — `MintRadar/` (frontend), `MintRadar/backend/`, and (accidentally, if you run `npm install` from the repo root) a stray root-level one. Always run `pwd` immediately before `npm install`/`npm ci` here. A 2026-07-24 session created a stray root `package.json`/`package-lock.json`/`node_modules` this way mid-Dependabot-batch (caught via `git status` before committing, deleted, redone in the right directory) — the same class of mistake previously happened in the separate Finvu project too.
    - **This stray root `node_modules` can outlive the session that created it and cause real prod failures much later.** On 2026-08-15, a stray `/var/www/mintradar-repo/node_modules` (no `package.json` alongside it — pure orphaned directory, dated back to that 2026-07-24 incident and never cleaned up on the VPS itself, only fixed locally/in git) sat there for three weeks. Two deploys fired ~11s apart (two rapid-succession `main` pushes), racing on `MintRadar/node_modules` during `npm ci`; while `MintRadar/node_modules` was transiently incomplete, Node's module resolution walked up the directory tree and resolved `vite`/`rollup` from that ancient orphaned root `node_modules` (`vite@5.4.21`, no `lucide-react` at all) instead of the correct `MintRadar/node_modules` (`vite@8.1.0`), producing a red herring error — `[vite-plugin-pwa:build] Failed to resolve entry for package "lucide-react". The package may have incorrect main/module/exports specified in its package.json` — that looked exactly like a bad Dependabot version bump but had nothing to do with lucide-react's actual version (unchanged since 2026-07-24) or any PR merged that day. **Diagnostic tell:** the build log's stack trace paths (`file:///var/www/mintradar-repo/node_modules/...` vs `.../MintRadar/node_modules/...`) reveal which `node_modules` actually got used — check this before suspecting a dependency itself. **Fix:** `rm -rf /var/www/mintradar-repo/node_modules` (verify no `package.json` sits next to it first — if one exists, investigate before deleting) in addition to the normal `rm -rf MintRadar/node_modules && npm ci` clean-reinstall. Consider checking for this stray directory as a periodic VPS health check, not just after an incident.
  - **Batch 3 (2026-08-15, first grouped PRs #67/#68 after the grouping fix above):** Dependabot's grouping produced exactly 2 PRs (backend 9 updates, frontend 23 updates) instead of ~30 individual ones — grouping confirmed working. Both PRs bundled `typescript` 6.0.3/5.9.3 → **7.0.2**, the same version that broke `npm ci` earlier that day (still incompatible — `@typescript-eslint/eslint-plugin`'s peer range is `<6.1.0` even at its own latest 8.67.0). Fixed by checking out each PR branch locally, reverting just the `typescript` line in `package.json`, regenerating the lockfile (`npm install typescript@<pinned> --save-dev`), verifying `npm ci`+`tsc --noEmit`+tests+build, then pushing that commit onto the PR branch before merging — grouping means you can't cherry-pick individual bumps out of the GitHub UI, so this local-branch-surgery pattern is the way to exclude one bad bump from an otherwise-good group.
    - The frontend PR (#68) also bundled `immer` 10.2.0→11.1.16 (previously held back, see `immer` entry below) and `@noble/hashes` 1.8.0→2.3.0 — both excluded the same way pending separate verification (done shortly after, see below), plus a genuine mistake caught mid-fix: `npm install <pkg> --save-dev` moved `immer` from `dependencies` into `devDependencies` even though only `typescript` needed `--save-dev` — always install multiple packages with different target sections in separate commands, or fix the section placement manually afterward and verify against `main`'s existing placement.
    - **Follow-up same-day: `immer` 11.1.16 and `@noble/hashes` 2.3.0 verified and applied** (commit `06357dd`). `@noble/hashes` v2's only breaking change is its `exports` map requiring explicit `.js` subpath extensions — fixed the one import site (`src/core/nostr/client.ts`: `'@noble/hashes/utils'` → `'@noble/hashes/utils.js'`), verified `bytesToHex`/`hexToBytes` round-trip at runtime. `immer` v11 needed no source changes; since `watchlist.store.ts` (the one real usage of the `zustand/middleware/immer` integration) has no dedicated unit tests and `vitest.config.ts` has no path-alias resolution (unlike `vite.config.ts` — the two configs are NOT merged, so any `@/...`-importing module can't be tested without a temporary local alias addition to `vitest.config.ts`), a throwaway smoke-test file was written against the store directly (mocking `@/db`) to confirm draft mutations (`push`/`filter`) and state-reference immutability still work, then deleted after confirming — this pattern (temporary vitest.config.ts alias + throwaway test file, both discarded) is worth reusing for verifying any other `@/`-importing module in isolation. Bonus: `vendor-immer` bundle shrank 26.6kB→9.16kB gzip on the v11 upgrade.
  - **Batch 2 (2026-08-01, PRs #32-#41):** 10/10 merged sequentially, same one-at-a-time + `gh run watch` discipline as batch 1. Zero failures.
    - Patch/minor: `@types/supertest`, `@vitest/coverage-v8`, `@tanstack/react-query`, `ws` (frontend only — backend still declares `ws@^8.21.0`; Dependabot hasn't opened a matching backend PR yet), `eslint` (backend, 10.6.0→10.8.0), `tsx`, `@playwright/test`, `nostr-tools` (backend, 2.23.5→2.24.1).
    - Major bumps (extra scrutiny, both verified safe with no source changes needed):
      - `react-router-dom` 6→7 — the app has no loaders/actions/fetchers/`json()`/`defer()`, so v7's main breaking surface (the data APIs) doesn't apply. Side effect: `react-router` no longer lands in the `vendor-react` chunk (+~9 kB gzip in the initial payload) — documented, not addressed; revisit only as part of a dedicated chunking pass.
      - `@noble/secp256k1` 2→3 — the app calls it in exactly one place (`getPublicKey` for nsec login) and never signs with it, so v3's breaking surface (the signing API) doesn't apply. Verified byte-identical output against an independent oracle, confirmed the `privkeyBytes.fill(0)` zeroing guarantee still holds, and manually exercised all three login flows (nsec/NIP-07/NIP-46) in a real browser.
    - `nostr-tools` and `@noble/secp256k1` are completely independent — `nostr-tools` depends on `@noble/curves`, not the standalone `@noble/secp256k1` package, which is physically absent from the backend's dependency tree.
    - PRs #22-31 from batch 1 closed themselves in the meantime (Dependabot detected the bumps were already applied directly to `main` and auto-closed the stale PRs) — no manual cleanup needed; expect the same on future batches.
  - **VPS maintenance (2026-08-07):** `docker builder prune -f` freed 10.81 GB of build cache, taking free disk from 17GB to 28GB — worth running periodically if disk pressure shows up again. A one-off deploy race ("removal of container is already in progress") was caused by two deploys firing back-to-back and colliding on `node_modules` during the backend `tsc` build — not a recurring problem, no fix needed unless it repeats. If it does repeat, consider adding `docker compose down --timeout 10` before `up` in the deploy script (not yet implemented).
  - **Batch 4 (2026-08-29, PRs #71/#72):** Same `typescript` landmine as Batch 3 recurred — the backend PR (#71) bundled `typescript` 6.0.3→**7.0.2** again (still outside `@typescript-eslint/eslint-plugin@8.67.0`'s `<6.1.0` peer range, confirmed live via `npm view @typescript-eslint/eslint-plugin@8.67.0 peerDependencies`). Fixed with the exact Batch 3 pattern: checked out the PR branch, reverted just the `typescript` line to `^6.0.3`, ran `npm install typescript@6.0.3 --save-dev` to regenerate the lockfile (this pulled in a large `package-lock.json` diff — installing TS 7 apparently drags in extra transitive packages that get removed on revert, not a red flag), verified `npm ci` + `tsc --noEmit` + `npm run lint` + `npm test` (285/285) + `npm run build` all clean, then pushed that fix commit onto the PR branch before merging. The frontend PR (#72, 7 patch/minor bumps — immer/lucide-react/nostr-tools/@vitejs/plugin-react/@vitest/coverage-v8/vite/vitest) did NOT touch `typescript` (frontend pins `^5.9.3`, outside this landmine) and merged directly with no fix needed. Both merges followed the one-at-a-time + `gh run watch` discipline; zero deploy failures. **This is now a recurring pattern, not a one-off** — expect Dependabot to keep proposing `typescript` 7.x for the backend until `@typescript-eslint/eslint-plugin` ships support for it; check the peer range with `npm view` before merging any future backend Dependabot PR that touches `typescript`.

## Gitea remote (2026-10-12)

- `origin` (GitHub) is the source of truth; local `main` tracks `origin/main`. Gitea is a push-only copy on a LAN host (`aqua-twitter.local`, may not resolve on VPN).
- Push with one command from one sha: `git push origin main && git push gitea main`.
- **NEVER run `git pull`, `git rebase` or `git merge` from gitea.** Alternating `pull --rebase origin` / `pull --rebase gitea` on 2026-10-10 rewrote hashes and made the two remotes diverge (5 commits with patch-identical twins under different hashes).
- If the push to gitea is rejected or the host is unreachable: report it and STOP (no rebase, merge or force).
- If gitea has diverged, the only accepted fix is the owner-approved `git push --force-with-lease=main:<exact sha measured now> gitea main`, after `git fetch gitea` and `git cherry -v origin/main gitea/main` show only `-` lines (no unique commit on gitea) and the file lists show no file only on gitea. Never a plain `--force`.

## Per-route head tags (`useDocumentMeta`, 2026-10-04)

`src/hooks/useDocumentMeta.ts` is the ONE hook that sets, for the lifetime of a page and on EVERY route (the root and Mint Detail included, since 2026-10-17): `document.title`, `<meta name="description">`, `<link rel="canonical">` and `og:url` = `https://mintradar.org` + `location.pathname` (no query, no hash, no trailing slash; the root keeps its single `https://mintradar.org/`, for the canonical AND `og:url`), `og:title`/`twitter:title` = the title the hook was given, `og:description`/`twitter:description` = the description it was given. Every tag is looked up before it is created (never a duplicate) and restores the value it found on unmount, so a route change never leaks the previous page's tags. `og:image`, `twitter:image`, their dimensions, `og:type` and `twitter:card` are never touched.

- **Not-found states have NO canonical (`notFound: true`, or `useRemoveCanonical()` where no title is set):** the 404 route (`NotFound`), an unknown Learn module, an untracked mint (`MintNotTracked`) and an undecodable mint slug (`MintInvalidUrl`). The hook removes the canonical link (the same node comes back on unmount) and leaves the other sharing tags at index.html's defaults. A page that has no address of its own must not claim one.
- **Not-found states are `noindex, follow` too (2026-10-20):** the same four states set `<meta name="robots" content="noindex, follow">` for their lifetime and take it away on unmount (a navigation to `/about` leaves no robots tag). `NotFound` and `LearnModule` pass `{ notFound: true, noindex: true }`; `MintNotTracked` and `MintInvalidUrl` call `useRemoveCanonical()` + `useNoindex()` (the tag is removed again when the hook created it, otherwise its previous content is put back). **Client-side only:** a crawler that does not run JavaScript still gets status 200 and the static head of `index.html` for an unknown path; a real 404 status is not implemented (see the nginx notes below). Tests: `useDocumentMeta.test.tsx` ("not-found states are noindex, follow"), `e2e/document-meta.spec.ts` (`/learn/99`, an untracked mint, an invalid mint URL and the 404 route are noindex with no canonical; `/about` and a tracked mint have no robots tag; a navigation by link removes it).
- **Mint Detail** passes `canonicalPath: /mint/${encodeURIComponent(url)}` (the resolved tracked URL, the same encoding the site's links use): the hook uses it instead of the pathname for canonical and `og:url` (a bare-host slug is redirected to the canonical URL first). A path that is not a plain absolute path (`//…`, a scheme, whitespace) is ignored and the route path is used. Its social preview for bots still comes from the nginx bot rewrite (below). **Bot HTML (unchanged):** `deploy/nginx.conf` `$is_social_bot` matches Twitterbot, Discordbot, TelegramBot, facebookexternalhit, Slackbot and WhatsApp (NOT Googlebot or bingbot — search crawlers get the SPA shell and render it); those get a per-mint title/description/`og:url` but the same `og-image-reliability.png`. A per-mint image would need an image endpoint (render score/name to a PNG, cache it, point `OG_IMAGE_URL` in `backend/src/og.ts` at it) — not implemented.
- **Site description (2026-10-17, owner decision):** ONE text for `description`, `og:description` and `twitter:description` in `index.html` and the Dashboard: "Find Cashu mints and see how well they run: uptime, latency, supported NUTs and a Reliability Score. Open source, privacy first." (`SITE_DESCRIPTION` in `src/constants/routeMeta.ts`). The old text started "Find trusted Cashu mints." — "trusted" is a verdict word the app's own rules forbid (`tooltipTexts.ts`, `mobile-and-tooltips.md`). `src/__tests__/siteDescription.test.ts` keeps `index.html` equal to the constant, checks that the head defaults, `PAGE_META` and `ROUTE_META` contain none of trusted/safe/secure/guaranteed/recommended and that every description is at most 160 characters (known exception, pinned at 168: the `/for-wallets` description, which lives in the byte-identical `pageMeta.ts` that also feeds the bot HTML). Not changed on purpose: the JSON-LD description in `index.html`, the bot fragment description in `backend/src/og.ts` (`/api/og/mint`) and nginx.
- Tests: `src/__tests__/useDocumentMeta.test.tsx` (tags set, replaced on navigation, no duplicates, canonical removed and restored, trailing-slash rule), `e2e/document-meta.spec.ts` (every route after load, one canonical, navigation by link, not-found states), `e2e/mint-detail-canonical.spec.ts`.
- **Watchlist** keeps `noindex` (the hook's `{ noindex: true }`); `index.html` has no robots meta.
- Routes whose page did not call the hook get title/description from `src/constants/routeMeta.ts` (today only `/nuts`). Every other page passes its text to the hook itself; the About page has its own.
- These tags only exist after the SPA rendered. Social preview bots don't run JS, so for them every route except `/mint/*` still shows the homepage tags (see the next section). **The two static documentation pages are the exception once the nginx rule is applied** ("Bot HTML for /methodology and /for-wallets" below): their title, description and canonical come from one shared constant, `PAGE_META` (`backend/src/shared/pageMeta.ts` and its byte-identical frontend copy `src/utils/pageMeta.ts`), which `Methodology.tsx` and `ForWallets.tsx` pass to this hook and the bot route serves. Every other route (`/about`, `/stats`, …) still shows the homepage card to a social bot.

## Security & Infrastructure Gotchas

### nginx CSP: `wss:` must be explicit in connect-src

**GOTCHA — do not regress this.** `connect-src 'self' https:` does NOT cover `wss://` connections in practice. This was a real production incident: Nostr relay WebSocket connections (`wss://relay.damus.io/`, `wss://nos.lol/`, etc.) were blocked by the browser until `wss:` was added explicitly.

Current correct value: `connect-src 'self' https: wss:;`

### nginx CSP: `script-src 'self'` — no `'unsafe-inline'`

**GOTCHA — do not re-add `'unsafe-inline'` to `script-src`.** Removed 2026-09-08 (security
audit run-2 hardening). The Vite 8 (rolldown) production build emits **only external
content-hashed `<script src>` files** — the app entry plus `vite-plugin-pwa`'s injected
`<script src="/registerSW.js">`. There are no inline `<script>` blocks in `dist/index.html`,
no `eval`/`new Function`/`document.write` in the bundle, and `registerSW.js` is a standalone
file. So `'unsafe-inline'` covered nothing. If a future change needs an inline bootstrap
script (e.g. flipping `vite-plugin-pwa`'s `injectRegister` to `'inline'`, or an inline theme
probe), externalise it or move to a nonce/hash — do **not** bring `'unsafe-inline'` back.
`style-src 'unsafe-inline'` stays (React `style={{}}` + Recharts inject inline styles).
Full CSP value: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https: wss:;` — repeated in all 5 spots (server + 4 locations, per the non-inheritance rule below).

### nginx add_header non-inheritance

**GOTCHA.** When a `location {}` block defines ANY `add_header` directive, it does NOT inherit the parent `server {}` block's `add_header` directives. Security headers (CSP, HSTS, X-Frame-Options, etc.) MUST be repeated verbatim in every `location` block that defines its own `add_header`.

Affected blocks in `deploy/nginx.conf`: `location ~* \.(js|css|png|svg|ico|woff2|webmanifest)$`, `location = /sw.js`, `location = /registerSW.js`, `location = /manifest.webmanifest` and `location = /.well-known/nostr.json` (it carried only its CORS and cache headers until 2026-10-08, so it was served without any security header; see the next sections). `location = /.well-known/security.txt` deliberately has no `add_header` (it uses `expires`), so it inherits everything.

### deploy/nginx.conf is reference/documentation only

The file `deploy/nginx.conf` in the repo documents the intended production config but is NOT automatically deployed. The app is served from `/etc/nginx/sites-available/mintradar.org.conf` on the VPS (since the 2026-09-09 domain migration; `deploy/nginx.conf` mirrors that file). The legacy `mintradar.pedani.eu.conf` is now a redirect-only stub (301 → `https://mintradar.org$request_uri`) and is not drift-checked. The `.conf` suffix is real; `deploy/setup-server.sh` was previously missing it in its own `NGINX_CONF` variable and has been corrected to match, see below. Keep `deploy/nginx.conf` manually in sync with the live `mintradar.org.conf`. After updating `deploy/nginx.conf`, copy the relevant changes to the VPS manually and run `sudo systemctl reload nginx`.

**`deploy/setup-server.sh` cleanup (2026-08-29):** the script had leftover references to an earlier, unrelated project — `DOMAIN="privyzap.pedani.eu"`, `WEB_ROOT="/var/www/privyzap"`, plus matching comments — despite being the MintRadar server-bootstrap script. All steps in the script (mkdir web root, install nginx config, `nginx -t`, reload, certbot) were already generic and correct; only the variable values were wrong. Fixed to `DOMAIN="mintradar.pedani.eu"`, `WEB_ROOT="/var/www/mintradar/dist"` (matches `root` in `deploy/nginx.conf`), and `NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}.conf"` (the missing `.conf` suffix bug above). `grep -ri privyzap` across the repo is now clean except for a historical note in `AUDIT.md` documenting a past, already-fixed `nginx.conf` domain bug — that's a legitimate audit log entry, not a leftover.

### Nginx config drift check (CI, 2026-08-29)

`.github/workflows/nginx-config-drift-check.yml` — a separate, read-only, informational workflow (no `needs:` link to `deploy.yml`, so it can never block or slow down deploys) that runs daily at 06:00 UTC (`cron: '0 6 * * *'`, plus `workflow_dispatch` for manual runs). It SSHes in (reusing the same `HETZNER_HOST`/`HETZNER_USER`/`HETZNER_SSH_KEY` secrets as `deploy.yml`, via `appleboy/ssh-action` with `capture_stdout: true`), `sudo cat`s the live `/etc/nginx/sites-available/mintradar.org.conf` (never writes anything to the server — no `nginx -t`, no reload), diffs it against the checked-out `deploy/nginx.conf`, and writes the result (match or full diff) to the GitHub Actions Job Summary. It always exits 0 — drift is surfaced for a human to notice, never treated as a CI failure. Exists specifically because `deploy/nginx.conf` is manual-deploy-only (see above) and had already drifted silently once before (the `setup-server.sh` privyzap issue was found the same way — a targeted investigation, not this automated check, since the check didn't exist yet at the time).

### Manifest MIME + security.txt charset — APPLIED to the server (2026-10-05)

The repo copy `deploy/nginx.conf` was applied to the live file on 2026-10-05 and is identical to it (the two intended changes were the `webmanifest` MIME type and the `security.txt` charset). **Unknown paths deliberately keep returning the app shell with status 200** (owner decision 2026-10-05): the earlier real-404 attempt (commit `46d695a`: `location /` with `=404` + `error_page`, a route-list regex location, a `/.well-known/` fallback and `scripts/check-route-consistency.mjs`) was removed again before it was ever applied. `location /` is `try_files $uri $uri/ /index.html;` as on the live server. The "Page not found" screen is still rendered in-app by the catch-all `*` route (`src/pages/NotFound.tsx`); its `noindex, follow` robots meta tag is added by JavaScript after the page renders (it is not in the HTML nginx sends); only the HTTP status stays 200.

- **Decision record: soft 404 stays (owner decision 2026-10-05, reconfirmed after task D4 on 2026-10-22).** Reasons: (1) the benefit of a real 404 is hygienic and not backed by evidence of harm — the Lighthouse hits for `llms.txt` and `ai-catalog.json` are already fixed by exact locations; (2) a valid route that is forgotten in a route list would answer with a 404 status and be noticed late. Task D4 showed a safe design that can be used if one of these happens: Search Console reports Soft 404 for real pages, a wallet team or a crawler reports it, or traffic grows and clean indexing matters. The design: a route regex with `~*`, a test that compares it with `App.tsx` and `SITEMAP_STATIC_PATHS`, and a smoke test after the deploy.

- **Manifest MIME:** the live server sends `manifest.webmanifest` as `application/octet-stream` (its `mime.types` has no `webmanifest`). The server block now does `include /etc/nginx/mime.types;` followed by `types { application/manifest+json webmanifest; }`. A `types {}` block in a server REPLACES the inherited map, so the include is what keeps every default type; two `types` blocks in one context add up. If the server's `mime.types` ever gains `webmanifest`, nginx only warns about the duplicate (remove the block then).
- **security.txt charset:** see "security.txt" below.
- **`scripts/check-internal-links.mjs`** (2026-10-05) extracts the literal internal targets in `src/` (`<Link to>`, `<NavLink to>`, `<Navigate to>`, `navigate('...')`, `href="/..."`, `window.location` assignments, `${window.location.origin}/...` share links; tests are skipped) and exits 1 when one matches no route of `App.tsx` (only the `*` catch-all would answer it). Query and hash suffixes are ignored; `/mint/<anything>` and `/learn/<slug>` match through the route params. Targets with a `${...}` segment have their literal part checked (the interpolation counts as one segment) and are listed; fully variable targets (`navigate(someVar)`) are listed as "dynamic, not checked". It runs as the second step of `npm run lint` (`eslint src e2e && node scripts/check-internal-links.mjs`, since 2026-10-05), so a broken link fails lint; you can still run `node scripts/check-internal-links.mjs` on its own after adding or changing any link or route. It found the Watchlist empty-state "Go to Dashboard" button navigating to `/dashboard` (not a route; now `/`).
- **The daily drift check (`nginx-config-drift-check.yml`)** reports no difference since the apply; any later difference means the repo copy and the live file diverged again.
- **Apply steps (reference for future changes; applied on 2026-10-05; owner, as `deploy` on server01):** back up the live file next to itself (`sudo cp -p /etc/nginx/sites-available/mintradar.org.conf /etc/nginx/sites-available/mintradar.org.conf.bak-<UTC timestamp>`; convention: backups of the live file are kept next to it as `mintradar.org.conf.bak-<UTC timestamp>` (`YYYYMMDD-HHMMSS`); a `.bak-…` there is not loaded; the 2026-10-05 apply, about 13:15 UTC, left `/etc/nginx/sites-available/mintradar.org.conf.bak-20261005-131527`), copy `/var/www/mintradar-repo/MintRadar/deploy/nginx.conf` over it, `sudo nginx -t`, then `sudo systemctl reload nginx`. Expected after: every route and unknown path still 200; `manifest.webmanifest` `application/manifest+json`; `/.well-known/security.txt` `text/plain; charset=utf-8` with all security headers. **Rollback:** `sudo cp -p <backup> /etc/nginx/sites-available/mintradar.org.conf && sudo nginx -t && sudo systemctl reload nginx`.

### Single security and cache headers — APPLIED to the server (2026-10-08)

`deploy/nginx.conf` was changed to stop sending duplicate headers and to give `/.well-known/nostr.json` the security headers, and **applied to the live `mintradar.org.conf` on server01 on 2026-10-08** (live file identical to the repo copy afterwards; backup `/etc/nginx/sites-available/mintradar.org.conf.bak-20261008-202828`). Measured in a container (`nginx:stable-alpine`, the repo file unchanged except for self-signed certs mounted at the `/etc/letsencrypt` paths, a second nginx on `127.0.0.1:3002` standing in for the app and sending what `backend/src/index.ts` sends), before → after:

- **Proxied locations** (`/api/`, `/health`, `/sitemap.xml`): the app sets `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` itself (same values as the server level), so each was sent twice. Each of the three locations now has `proxy_hide_header` for exactly those three; the nginx copy stays, so each appears once. NOT hidden: the app's `X-XSS-Protection: 0` (nginx does not set it), its `Cache-Control`, and its stricter `Content-Security-Policy` + `Cross-Origin-Resource-Policy` on `/api/mint/icon` (that response intentionally still carries two CSP headers; the browser applies both, i.e. the intersection, which is never weaker).
- **Hashed assets** (`location ~* \.(js|css|…)$`): `expires 1y;` plus `add_header Cache-Control "public, immutable"` sent two `Cache-Control` headers (`max-age=31536000` and `public, immutable`). Now one: `add_header Cache-Control "public, max-age=31536000, immutable"` (no `always`, as before). The effective policy is the same; the only header that disappears is `Expires` (it came from `expires 1y`; caches that understand `max-age` ignore `Expires` anyway). Use `curl -I` on a hashed asset to see it.
- **`/.well-known/nostr.json`**: its own `add_header` (CORS + `Cache-Control`) dropped the inherited security headers. The six security headers (same names and values as the server level) are repeated there; the CORS and cache headers are unchanged. It is the only location that had this problem (the others that add headers already repeat them; `security.txt` adds none).

Nothing else changed: CSP/HSTS values, location matching, the manifest MIME, the security.txt charset, unknown routes (200 with the app shell), bot rules and the rate limits are as before.

**Apply procedure used (2026-10-08):** back up the live file next to itself with `sudo cp -p` to `mintradar.org.conf.bak-20261008-202828` (UTC `YYYYMMDD-HHMMSS`), `sudo cp` the checkout's `deploy/nginx.conf` over the live file (an existing file keeps its owner and mode: `root:root`, 644; size checked against the repo file), `sudo nginx -t`, `sudo systemctl reload nginx`. Verified live afterwards: `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy` once on `/api/v1/health`, `/api/mints/known` and `/sitemap.xml`; one `Cache-Control` and no `Expires` on a hashed asset; the six security headers on `/.well-known/nostr.json` with its CORS and cache headers unchanged. Note: `/api/mints/known` sends `Cache-Control: max-age=300` only on an app-cache miss (the app's 60 s cache hit sends none), so a missing header there is not an nginx effect. **Rollback:** `sudo cp -p /etc/nginx/sites-available/mintradar.org.conf.bak-20261008-202828 /etc/nginx/sites-available/mintradar.org.conf && sudo nginx -t && sudo systemctl reload nginx`.

### gzip for JSON and text — APPLIED to server01 on 2026-10-13

`deploy/nginx.conf` has a new gzip block in the `mintradar.org` server block (right before `location /api/`): `gzip on; gzip_vary on; gzip_comp_level 5; gzip_min_length 1024; gzip_proxied any;` and `gzip_types` for `application/json`, `application/javascript`, `text/css`, `text/plain`, `text/xml`, `application/xml`, `application/manifest+json`, `image/svg+xml`, `application/xml+rss` (text only: no images or fonts). **It is NOT applied to server01.** Before it, live responses were never compressed even with `Accept-Encoding: gzip`: nginx's default `gzip_types` is only `text/html`, the global `nginx.conf` (http block) is not in the repo, and neither this file nor the live site config set any gzip directive. The file does not set `proxy_set_header Accept-Encoding`, so the client's value reaches the app; the app never compresses, so nginx does it (a response that already has a `Content-Encoding` is left alone).

**Applied to server01 on 2026-10-13** (UTC date of the backup name), together with the bot rule for `/methodology` and `/for-wallets` (next section): backup `/etc/nginx/sites-available/mintradar.org.conf.bak-20261013-164042` (root:root 644, 12111 B, the file of 2026-10-08), then `sudo cp` of `/var/www/mintradar-repo/MintRadar/deploy/nginx.conf` over the live file (root:root 644, 14807 B, equal to the repo file), `sudo nginx -t` ok, `sudo systemctl reload nginx`. **Rollback:** `sudo cp -p /etc/nginx/sites-available/mintradar.org.conf.bak-20261013-164042 /etc/nginx/sites-available/mintradar.org.conf`, `sudo nginx -t`, `sudo systemctl reload nginx`. Live, after the reload: `/api/mints/known` 167 638 B → 22 556 B, the wallet list 21 884 → 2 295 B, the hashed JS 271 994 → 83 547 B, `/sitemap.xml` 12 724 → 1 048 B (all `Content-Encoding: gzip`, chunked, weak ETag, `Vary: Accept-Encoding`); `/api/v1/health`, the manifest, `security.txt`, `nostr.json` and the PNG unchanged; `If-None-Match` (strong and weak) still 304 on both cached API routes. **The debian `nginx.conf` already had `gzip on;` in the `http` block** (everything else there is commented out), so the HTML app shell was already gzipped before this change (weak ETag, no `Vary`); the server-level block only adds the text types, `Vary: Accept-Encoding` (a second `Vary` line next to the app's `Vary: Origin` on `/sitemap.xml` and the bot HTML) and the other options. No double compression, no conflicting `gzip_types`. The drift check should show no difference now.

**Measured in a container** (pod: `nginx:stable-alpine` with the repo file and self-signed certs mounted at the `/etc/letsencrypt` paths, plus an Express stub on `127.0.0.1:3002` sending the strong ETag / `Cache-Control: public, max-age=300` of `/api/mints/known` and the wallet routes and Express's weak ETag + `If-None-Match` handling elsewhere; fixtures: 160 kB known list, 30 kB wallet list, 10 kB sitemap, 357 kB JS, 86 kB CSS, 2.5 kB shell, 30 kB noise PNG). `nginx -t` ok. Request with `Accept-Encoding: gzip`, before → after:

| Path | Before | After |
|---|---|---|
| `/api/mints/known` | 160 104 B, `Content-Length`, no `Content-Encoding`, no `Vary` | `gzip`, chunked, `Vary: Accept-Encoding`, 9 512 B (live data compresses less than the repetitive fixture: ~167 kB → ~21 kB) |
| `/api/v1/wallets/mints` | 30 577 B | `gzip`, 1 305 B (fixture) |
| `/sitemap.xml` | 9 837 B | `gzip`, 494 B |
| hashed JS / CSS | 357 340 / 85 980 B | `gzip`, 43 417 / 13 883 B |
| `/` (app shell), `/sw.js` | 2 480 / 2 240 B | `gzip`, 238 / 94 B |
| `/health` (54 B), `/manifest.webmanifest` (868 B), `/.well-known/security.txt` (95 B) | not compressed | **unchanged** (below `gzip_min_length 1024`; the real manifest is 840 B) |
| PNG | not compressed | **unchanged** (not in `gzip_types`) |

Without `Accept-Encoding: gzip` the body is identical to before; compressible types of at least 1024 B only gain `Vary: Accept-Encoding`. Every other response header (`Cache-Control`, CSP, HSTS, `X-Frame-Options`, CORS, `X-RateLimit-*`, `Content-Type`) is byte-identical; on COMPRESSED responses the only differences are `Content-Length` → `Transfer-Encoding: chunked`, `Content-Encoding: gzip`, `Vary: Accept-Encoding`, the ETag (below) and, for files nginx serves itself (JS, CSS, shell, `sw.js`), `Accept-Ranges` is dropped (ranges of a compressed body are not served).

**ETag and 304.** nginx turns a strong ETag of a body it compresses into a weak one (`ETag: W/"…"`), so the wallet API's strong ETag reaches a gzip-capable client as `W/"<same hash>"`. `If-None-Match` still works through nginx, verified for `/api/mints/known`, the wallet list, a hashed JS file and the app shell: the strong form, the weak form (what a client sends back after seeing the weak one), with and without `Accept-Encoding: gzip` all return `304` (no body, `Cache-Control` kept, the 304 carries the app's own strong ETag); a stale ETag returns `200` with the compressed body. Clients that compare ETags themselves must use weak comparison (RFC 9110: `If-None-Match` always does). The backend's own tests pin that Express answers `W/<etag>` with 304 (`cache-headers.test.ts`).

**Security (BREACH).** Compression of HTTPS responses is a risk only when a response reflects a secret together with attacker-controlled input. Nothing here does: the backend sets no cookies and has no sessions or CSRF tokens (`grep -ri "set-cookie\|cookie\|csrf" backend/src` finds nothing outside tests; the frontend never touches `document.cookie`), and the API only returns public data. Rate limits and the NIP-98 auth (signed per request) do not put a secret in a body.

### OG tags for /mint/:url — bot-only fragment (2026-08-29)

Social crawlers (Twitterbot, Discordbot, TelegramBot, facebookexternalhit, Slackbot, WhatsApp) don't run JS, so they never see the SPA's client-rendered `<title>`/OG meta tags on `/mint/:url` — they'd only ever see the generic homepage preview from `index.html`. Fixed via **User-Agent sniffing at the nginx layer** (chosen over an SSR rewrite or a prerendering service — MVP scope): regular browsers are completely unaffected and still get the normal SPA.

- **Backend:** `backend/src/og.ts` — pure, unit-tested HTML fragment renderer (`renderMintOgHtml()`, `escapeHtml()`, `mintStatusLabel()`) plus `fetchOgMintData()`, a single-mint-scoped version of the `/api/mints/known` aggregate query (same `mint_history` 24h-window join + `computeDegraded()` reuse, just filtered to one `url` instead of pulling the full known-mints payload). Wired up as `GET /api/og/mint?url=` in `index.ts`. **Always returns HTTP 200 with a valid HTML fragment** — unknown mint, missing `url` param, or a DB error all fall back to a generic MintRadar-branded fragment rather than a 404/500, since a crawler getting no body means no link preview at all. `Cache-Control: max-age=60`, matching `KNOWN_MINTS_CACHE_TTL`. Mint `name` is escaped before interpolation (`escapeHtml()`) — it originates from the mint's own untrusted `/v1/info` response.
- **Nginx (`deploy/nginx.conf`):** a `map $http_user_agent $is_social_bot` block (the 6 crawler UAs above) and a `map $request_uri $mint_og_lookup_url` block extract the mint URL path segment. **Deliberately sourced from `$request_uri` (the raw, client-sent request line) and never `$uri`** (nginx's internally-normalized URI variable, which decodes `%XX` escapes before location matching) — the frontend links to mint pages via `/mint/${encodeURIComponent(mint.url)}`, so the path segment is fully percent-encoded (e.g. `https%3A%2F%2Ftestnut.cashu.space`); reading it from `$request_uri` keeps those escapes intact all the way to Express, which decodes them exactly once via its own query-string parser. A `location /mint/ { if ($is_social_bot) { rewrite ^ /api/og/mint?url=$mint_og_lookup_url last; } try_files $uri $uri/ /index.html; }` block does the routing — the `if`+`rewrite ... last` combination is one of the two documented safe uses of `if` inside an nginx `location` (per the "if is evil" wiki page).
- **Verified live in production (2026-08-29)** via `curl -A "Twitterbot" "https://mintradar.pedani.eu/mint/https%3A%2F%2Ftestnut.cashu.space"` — correctly returned `Testnut mint — MintRadar` / `Reliability Score: 80% · Online`, confirming the `%2F`/`%3A` round-trip through `$request_uri` works exactly as designed (this was the one part of the implementation that couldn't be verified locally, no nginx binary available in the dev sandbox). A literal, non-percent-encoded test URL (`/mint/testnut.cashu.space`, i.e. not what the frontend actually generates) correctly falls through to the generic fallback fragment rather than erroring — expected behavior for an unknown-URL lookup, not a bug.
- Tests: `backend/src/__tests__/og.test.ts` (unit tests (counts: "Test suites" in CLAUDE.md) — escaping, status label, title/description formatting, all fallback branches) + `backend/src/__tests__/integration/og-mint.test.ts` (`supertest` against the real Express `app` with a mocked `pg` pool — known mint, unknown mint, DB-throws, missing `url` param, Cache-Control header, XSS-in-name escaping). Same mocking pattern as `integration/mints-known.test.ts`.

### Bot HTML for /methodology and /for-wallets — APPLIED to server01 on 2026-10-13

Same problem as for `/mint/:url` above, for the two documentation pages: a social crawler (Twitterbot, Discordbot, TelegramBot, facebookexternalhit, Slackbot, WhatsApp — the existing `$is_social_bot` map) does not run JS, and the raw `index.html` carries the home page's canonical and `og:*` tags, so a post on X linking to `/methodology` showed the generic home card (the page's own tags are only set by `useDocumentMeta` after the SPA rendered). **Googlebot and bingbot are NOT in the bot map and render the SPA; keep it that way.**

- **Single source of the text — `PAGE_META`** (`backend/src/shared/pageMeta.ts`, byte-identical frontend copy `src/utils/pageMeta.ts`, drift caught by `sharedModules.test.ts`): `title`, `description` and `canonicalPath` per path (`/methodology`, `/for-wallets`), plus `OG_PAGE_SLUGS` (`methodology` → `/methodology`, `for-wallets` → `/for-wallets`), the strict slug allowlist. `Methodology.tsx` and `ForWallets.tsx` pass `PAGE_META[path].title/.description` to `useDocumentMeta`; the bot route builds its HTML from the backend copy. `src/__tests__/pageMeta.test.tsx` renders both pages and asserts document title, description, canonical, `og:url`, `og:title/description` and `twitter:title/description` equal `PAGE_META`, and that the backend copy is the same data. The e2e specs `methodology-page` / `for-wallets-page` compare the head with `PAGE_META` too.
- **Backend route `GET /api/og/page?p=<slug>`** (`index.ts`, renderer `renderPageOgHtml()` in `og.ts`, built on the same `renderHtml()` and `escapeHtml()` as the mint fragment): `200 text/html; charset=utf-8`, `Cache-Control: public, max-age=300`, the same structure as `/api/og/mint` (title, description, `og:*`, `twitter:card summary_large_image`, the one generic `og:image` `https://mintradar.org/og-image-reliability.png`) plus `<link rel="canonical">`, `og:url` = `https://mintradar.org` + the path, and a visible `<a>` to the real page in the body. **Strict allowlist, nothing reflected:** the slug is looked up in a `Map` (so `__proto__`/`constructor` are just unknown keys); a repeated `p`, an array/object, a missing or unknown value → `404 {"error":"Not found"}` (constant body); every word of the output comes from `PAGE_META`, no query value is ever copied. It does not touch the database. Tests: `backend/src/__tests__/integration/og-page.test.ts` (headers, allowlist, 404s, hostile `?p=<script>` and extra parameters never reach the body, the two agreed texts) and `og.test.ts` (rendering from `PAGE_META`, escaping checked with hostile values via a mocked `pageMeta`, the mint fragment unchanged).
- **Nginx (`deploy/nginx.conf`):** four exact locations — `location = /methodology`, `= /methodology/`, `= /for-wallets`, `= /for-wallets/` — each `if ($is_social_bot) { rewrite ^ /api/og/page?p=<fixed slug>? last; }` then `try_files $uri $uri/ /index.html`. The slug is fixed per location (no variable from the request reaches the rewrite) and the trailing `?` of the replacement drops the client's query string, so `/methodology?p=evil` still sends only `p=methodology`. Everyone else, and Googlebot, gets the SPA exactly as through `location /`. The locations set no `add_header`, so the server-level security headers apply as before (the proxied response goes through the same server-level headers as `/api/`). The `/mint/` rule, the gzip block, CSP, HSTS, the `proxy_hide_header` lines and the `nostr.mintradar.org` file are untouched.
- **A new static page that needs a correct preview** must be added in three places in the same change: `PAGE_META` + `OG_PAGE_SLUGS` (both copies), the page's `useDocumentMeta` call (from `PAGE_META`), and its two `location =` blocks (with and without the trailing slash) in `deploy/nginx.conf` — then apply nginx on the server. A page missing from the nginx file simply keeps the home card for bots.
- **Measured in a container** (`nginx:stable-alpine` with the repo file and the file from `HEAD` before the change, self-signed certs at the `/etc/letsencrypt` paths, the real production frontend build as the root, a Node stub on `127.0.0.1:3002` that runs the REAL compiled `renderPageOgHtml()` and a stub for `/api/og/mint`, `/api/mints/known`): `nginx -t` ok; 16 paths × 6 user agents = 96 requests with `Accept-Encoding: gzip`. Exactly 21 responses changed — Twitterbot, TelegramBot and Discordbot for `/methodology`, `/methodology/`, `/methodology//` (nginx merges the slashes), `/methodology?p=evil`, `/for-wallets`, `/for-wallets/`, `/for-wallets?p=methodology&x=<script>` — from the SPA shell (`og:title` "MintRadar - Cashu Mints Directory…", canonical `https://mintradar.org/`) to the bot HTML with the page's own title and canonical. Googlebot, bingbot and a browser UA got the SPA before and after; `/about`, `/`, the Minibits mint page (bot and not), `/api/mints/known`, a hashed JS asset and all other paths were byte-identical in status and headers. In the 21 changed responses the only header differences are `Content-Type` (`text/html` → `text/html; charset=utf-8`), `Cache-Control: public, max-age=300` added, and `Last-Modified` gone (a proxied response instead of a static file; the live app also adds its own weak `ETag`, `X-Powered-By`, `X-XSS-Protection` and `X-RateLimit-*`, as on every `/api/` response and the mint bot HTML); all security headers present once, same values. The stub saw only `/api/og/page?p=methodology` or `?p=for-wallets` — never a client-supplied value.
- **Applied to server01 on 2026-10-13** in the same step as the gzip block (backup `/etc/nginx/sites-available/mintradar.org.conf.bak-20261013-164042`; rollback: `sudo cp -p /etc/nginx/sites-available/mintradar.org.conf.bak-20261013-164042 /etc/nginx/sites-available/mintradar.org.conf`, `sudo nginx -t`, `sudo systemctl reload nginx`). Checked live afterwards: Twitterbot gets the bot HTML with the exact `PAGE_META` title, description and canonical for `/methodology` and `/for-wallets`; Googlebot still gets the SPA shell (same body as `/`); Twitterbot on `/`, `/about` and the Minibits mint page gets what it got before. The backend route was deployed by CI first (`GET /api/og/page?p=` 200 / 404 JSON checked live).

### www.mintradar.org redirects to the apex (Task A2, 2026-10-22) — repo copy only, NOT yet applied to server01

- `www.mintradar.org` answers `301` to `https://mintradar.org$request_uri` on port 80 and 443 (own `server` blocks in `deploy/nginx.conf`; the apex blocks only lost `www.mintradar.org` from their `server_name`, and the port-80 apex block its dead www `if`). This supersedes "the only 443 block for both names" in the next section.
- Why: www used to serve the app, so the browser called `/api/mints/known` with `Origin: https://www.mintradar.org`, which the backend origin allow-list rejects (403 `cors_forbidden`); the decision was to redirect, not to add www to `ALLOWED_ORIGINS`. Apply by hand like every nginx change here (backup, copy, `nginx -t`, reload); check first that the certificate in `ssl_certificate` lists `www.mintradar.org`.

### HTTP/2 for mintradar.org and www — APPLIED to server01 on 2026-10-20

The `mintradar.org` / `www.mintradar.org` HTTPS server block (the only 443 block for both names; the port-80 redirect block is unchanged) has `http2 on;` directly under its two `listen` lines (nginx 1.26.3; the per-server directive needs 1.25.1+). Before, the site was served over HTTP/1.1. **HTTP/2 is on for this block only:** `nostr.mintradar.org` (strfry relay over WebSocket), `mintradar.pedani.eu` and `pedani.eu` stay on HTTP/1.1 on purpose (`api.pedani.eu` and `finvu.pedani.eu` already had `http2 on;`). **Do not add `http2` to the `listen` line:** that parameter belongs to the socket, so it would switch on every server block sharing `443`. The `fail2ban` filter `nginx-scanners` does not depend on the HTTP version in the request line (`HTTP/2.0` in the log matches as before).

Applied with a backup `/etc/nginx/sites-available/mintradar.org.conf.bak-20261020-092445`, one `sed` insert, `sudo nginx -t`, `sudo systemctl reload nginx`; live file and `deploy/nginx.conf` identical afterwards. **Rollback:** `sudo cp -p /etc/nginx/sites-available/mintradar.org.conf.bak-20261020-092445 /etc/nginx/sites-available/mintradar.org.conf`, `sudo nginx -t`, `sudo systemctl reload nginx`.

### Early preload of the mint list (Task P2, 2026-10-21)

`public/early-preload.js` (linked from `index.html` as `<script async src="/early-preload.js">`, built as `/early-preload.js?v=<sha256 prefix>` by `vite-brand-assets.ts`) adds `<link rel="preload" as="fetch" href="/api/mints/known" crossorigin="anonymous">` to `<head>` **on `/` only**. Why a script and not a static `<link>`: the HTML shell is shared by every route, and a preload on a route that never reads the list (About, Methodology, For wallets, Wallets, Learn) downloads 23 KB gzip for nothing and prints "preloaded but not used" in the console. The CSP (`script-src 'self'`, no inline script) is unchanged: the route check lives in an external same-origin file. Vite does not bundle `public/` and merges all `<script type="module">` of the HTML into one entry, so a separate early module is not possible; the file is un-hashed in `public/`, hence the `?v=` rule above (nginx caches `*.js` for a year).

Rules that keep the request single: the preload must match `fetchKnownMints` (`src/hooks/useKnownMints.ts`) exactly: same URL, no headers, same-origin credentials. `crossorigin="anonymous"` is required for `as="fetch"` even on the same origin; without it Chromium does not reuse the response and the request goes out twice (mutation-proved). The preload request carries `Origin: https://mintradar.org` (CORS mode); the backend allow-list accepts that origin (`ALLOWED_ORIGINS`), a foreign Origin still gets the JSON 403. Pinned by `src/__tests__/earlyPreload.test.ts` and `e2e/known-mints-preload.spec.ts` (exactly one `/api/mints/known` request on `/`, none and no preload link on the other routes).

### Brotli and precompressed assets (Stage 2 perf, 2026-10-25) — repo side done, server side NOT applied

**Live today (checked 2026-10-25, GET with `Accept-Encoding: br, gzip`):** no response is brotli; JS/CSS/JSON come back `Content-Encoding: gzip` (on-the-fly, `gzip_comp_level 5`, block above). The live nginx has no brotli module loaded and no `gzip_static`/`brotli_static`.

**Repo side (done):** `vite-precompress.ts` (`precompressPlugin()`, last plugin in `vite.config.ts`, runs at `closeBundle`) writes `<file>.br` (brotli quality 11) and `<file>.gz` (gzip -9) next to every `.js .css .html .svg .json .webmanifest .xml .txt .yaml` file of at least 1024 B in `dist/` (the same threshold as `gzip_min_length`). No new dependency (`node:zlib`). The Workbox `globPatterns` do not match `.br`/`.gz`, so the precache list is unchanged. `deploy.yml` already copies the whole `dist/` to `/var/www/mintradar/dist/`, so the files arrive with the next deploy and are **ignored** by nginx until the server is changed. Test: `src/__tests__/precompress.test.ts`. Measured on the 2026-10-25 build: the initial JS + CSS is 194 KiB as gzip-5 (what nginx sends now), 192 KiB as gzip-9 and 167 KiB as brotli-11 (−14 %).

**`deploy/nginx.conf` was deliberately NOT edited** (it is reference-only, applied by hand, and the daily drift check would flag any edit until it is applied). What the server needs, in this order (owner, by hand):
1. `apt-cache policy libnginx-mod-http-brotli-static` (Debian 12+/Ubuntu 22.04+ package it; elsewhere build `ngx_brotli` for the exact nginx version). Install it; it drops a `load_module` line into `/etc/nginx/modules-enabled/`.
2. In the `mintradar.org` server block, next to the existing gzip block:
   ```nginx
   gzip_static on;    # serve dist/*.gz when present (module built into the distro nginx)
   brotli_static on;  # serve dist/*.br to clients that send Accept-Encoding: br (needs step 1)
   ```
   Keep `gzip on;` for the API and anything without a precompressed copy. Do not add `brotli on;` (on-the-fly brotli) unless the `libnginx-mod-http-brotli-filter` module is also installed; the static files are enough for the app.
3. `sudo nginx -t && sudo systemctl reload nginx`, copy the same lines into `deploy/nginx.conf` in a commit so the drift check stays clean, then check: `curl -sI -H 'Accept-Encoding: br' https://mintradar.org/assets/<index>.js` → `Content-Encoding: br`, `Vary: Accept-Encoding`, and the same `Cache-Control` as before.
**Gotcha once `gzip_static` is on:** `deploy.yml` replaces `dist/assets/` but only overwrites the root files, so a root file that later drops below 1024 B (e.g. `robots.txt`) would leave its old `.gz`/`.br` behind and nginx would serve the stale copy. Today every root file that has a copy is rewritten by every build; if that ever changes, delete root `*.br`/`*.gz` in the deploy before the copy.

### registerSW.js is `defer` (Stage 2 perf, 2026-10-25)

`VitePWA({ injectRegister: 'script-defer' })` makes the build emit `<script id="vite-plugin-pwa:register-sw" src="/registerSW.js" defer>` instead of a parser-blocking script in `<head>`. `public/registerSW.js` is unchanged and still registers on `window.load` (a deferred script runs before `DOMContentLoaded`, so the listener is always attached in time). CSP is unaffected (same file, still `'self'`). The three auto-update rules below still hold.

### Service Worker / PWA auto-update

`vite-plugin-pwa` (`registerType: 'autoUpdate'`) only reliably delivers deploys to users when ALL THREE of the following are correct simultaneously:

1. **`public/registerSW.js` listens for `controllerchange` and calls `window.location.reload()` exactly once** — guarded by `let refreshing = false` to prevent reload loops. This file intentionally overrides the library-generated registration script.
   **Only when a controller already existed (2026-10-03):** `registerSW.js` records `hadController = !!navigator.serviceWorker.controller` before `register()`. The first `controllerchange` of a page that had no controller is the worker's very first install claiming the page (`skipWaiting` + `clientsClaim`), not an update, so it is swallowed (`hadController = true`, no reload). Before this, every first visit reloaded the page ~150–340 ms after the first card appeared, which threw away a click made in that window (the watch-login modal vanished). Every later `controllerchange` (a new version replacing a controlling worker) still reloads once, so deploys still reach open tabs. Do not revert this to an unconditional reload, and keep the `refreshing` guard. Verified with a static server + two builds: first visit = one navigation and controlled afterwards; serving build B then navigating = one reload and B shown; offline reload still shows the app shell.
2. **`register()` uses `updateViaCache: 'none'`** — without it, the browser may HTTP-cache the workbox chunk (`workbox-xxxxx.js`) that `sw.js` imports, causing update detection to silently fail even though `sw.js` itself is fetched fresh via nginx `no-store`.
3. **nginx serves `sw.js`, `registerSW.js`, and `manifest.webmanifest` with `no-store`** — these files must NOT be caught by the long-lived `immutable` caching rule for content-hashed assets. The explicit `location = /sw.js` and `location = /registerSW.js` blocks in `deploy/nginx.conf` take priority over the wildcard `location ~*` block; do not remove them.

`setInterval(() => registration.update(), 3600000)` in `public/registerSW.js` ensures long-open tabs detect new deploys without requiring a navigation event.

**One-time bootstrap issue:** A user with a very old SW (from before the `controllerchange` listener existed) must manually unregister once via DevTools → Application → Service Workers → Unregister. All subsequent deploys auto-update from that point forward.

### Debugging stale-looking deploys

When a deployed change doesn't appear to users, verify in this order before assuming a code bug:

1. Commit is pushed to `origin/main` and the GH Actions run completed successfully
2. `curl` the exact asset filename referenced by the live `index.html` — confirm the response body contains the expected change (don't trust local build state or git log alone)
3. Only then suspect the service worker / browser cache as the culprit

**Color can mask font-weight:** If a computed property looks "correct" in DevTools but still LOOKS wrong visually, inspect all related computed properties. Example: `font-weight:700` on `var(--text2)` (`#8B90A0`, muted gray) looks visually weaker than non-bold `var(--text)` (`#F0F2F7`, near-white) — this led to a false diagnosis of "bold not working" when the real issue was a color override. Always check the full computed style.

**Synthetic (faux) bold:** JetBrains Mono (`var(--font-mono)`) was only self-hosted at weights 400 and 500. Using `font-weight:700` on any mono element triggered browser-synthesized bold, which renders very weakly. `public/fonts/JetBrainsMono-Bold.woff2` was added with a matching `@font-face` at weight 700 to fix this.

### vault.ts removed (dead code)

`src/core/crypto/vault.ts` was deleted. It had zero imports across the codebase and contained a broken nsec bech32 decode (`.slice(5)` instead of `nip19.decode`). The entire `src/core/crypto/` directory no longer exists — do not recreate it.

## Dependency policy (2026-10-14)

- **Pinned Node version: 22.23.4 (2026-10-23, security release of 2026-10-21: Brotli decoder out-of-bounds write CVE-2026-111497, dns.resolve NUL truncation CVE-2026-105482, TLS hostname checks).** Pinned exactly in `backend/Dockerfile` (`node:22.23.4-alpine`), `.nvmrc` and the `setup-node` step of `deploy.yml` and `tests.yml`; `nodeEngine.test.ts` keeps them identical. **Rule: the pin must be bumped on every Node security release** (all four places in one commit, then rebuild the backend image with `--pull`). `engines` stays `>=22`. Untrusted hosts are also refused when they carry a NUL byte before any DNS call (`backend/src/hostnameGuard.ts`).
- **Node 22 is required (2026-10-20):** `engines.node` is `>=22` in both `package.json` files, `.nvmrc` says `22`, the backend Dockerfile is `FROM node:22-alpine`, the deploy workflow uses 22. Node 20 fails the frontend and backend unit suites with `webidl.util.markAsUncloneable is not a function`. The engines field is a warning only (no `engine-strict` in any `.npmrc`, `package.json` or workflow); `src/__tests__/nodeEngine.test.ts` keeps the four places in step.

Result of a read-only dependency audit followed by a cleanup (commits `d3833b8b`..`7f25ffad`): fewer packages, no new tool. `npm audit` was and is 0 in both roots.

**Rules**
- A new dependency needs a written reason in the commit message (what it does, why not the platform or a package already installed, how many call sites). Prefer Node 22 / browser APIs and what is already in the tree (example: `nostr-tools/utils` and `getPublicKey` replaced `@noble/hashes` and `@noble/secp256k1`).
- No packages with install scripts: check `hasInstallScript` in the lockfile entry before adding. The runtime image installs with `--ignore-scripts`; the only scripts left in either lockfile are `fsevents` (macOS, optional) and the backend's dev-only `esbuild`. The server-side deploy installs with `--ignore-scripts` too (see "Server install without install scripts" below).
- Types: `@types/X` only next to a runtime `X` that has none (check the package's `types` field first — `node-cron` 4.x ships its own, which made `@types/node-cron` dead weight). Types live in `devDependencies`, never in `dependencies`.
- Do not hand-edit lockfiles; change them only with `npm install` / `npm uninstall`, run with **npm 11** (`npx --yes npm@11 uninstall <pkg> …`). npm 10.9.x (the one on this machine and the Actions runners) silently drops the `"libc"` fields of the platform-specific optional packages on every lockfile rewrite, so a plain `npm ci` then also downloads the musl (or glibc) variants of `@rolldown/binding-*` and `@img/*` (+37 MB frontend, +21 MB backend dev tree; 2026-10-14). Check `grep -c '"libc"' package-lock.json` before and after a change: the count must not fall except when platform packages themselves are removed.
- **Lockfile guard (2026-10-14):** `scripts/check-lockfile-libc.mjs` runs as the last step of the frontend `npm run lint` and reads both lockfiles. npm 10 drops the `libc` field of platform packages when it rewrites a lockfile; `npm ci` on Linux then installs the musl variants too (node_modules grew by 36 MB before the lockfiles were repaired with npm 11). The check fails for every `*-linux-<cpu>-gnu` / `-musl` package without `libc` and prints how many it checked (6 per lockfile today: the `@rolldown/binding-linux-*` packages). Packages that never publish `libc` (`@rollup/rollup-*`, `lightningcss-*`, `@napi-rs/lzma-*`) are listed in `NO_LIBC_UPSTREAM` in the script; a new package of that kind goes into that list on purpose. The criterion "os linux + cpu" was NOT used: 31 legitimate entries (`@esbuild/linux-*`, the `-gnueabihf` ARM builds, the packages above) have no `libc`. If it fails: **regenerate the lockfiles with npm 11 and run this check** (`npx --yes npm@11 install --package-lock-only`). Tests: `src/__tests__/lockfileLibc.test.ts` (a correct and a stripped fixture, the real lockfiles, the exit codes).
- Re-run the audit every quarter with the scratch method (all in a directory outside the repo, nothing is installed into the project): (1) walk every source, test, e2e, script and config file with the TypeScript compiler API (`ts.createSourceFile`: static/dynamic imports, `require`, `import type`, triple-slash, tsconfig `types`, `vi.mock` strings) and list the importers of each direct dependency; (2) `vite build --outDir <outside repo> --sourcemap` and attribute bytes per `node_modules` package from the `.map` files; (3) in a scratch copy holding only `package.json` + `package-lock.json`, `npm uninstall <pkg> --package-lock-only --ignore-scripts` and diff the lockfile; (4) `npm ci --omit=dev` in such a copy for the runtime tree; (5) `npm audit`, `npm outdated`, `npm ls --all`, `npm dedupe --dry-run`, and an `npm ci --ignore-scripts` run of build, typecheck, lint and the unit suites.

**On-demand tools (not in `package.json`)**
- `sharp` (only `scripts/generate-icons.mjs`): `npm i --no-save sharp@0.35.5 && node scripts/generate-icons.mjs` from `MintRadar/` (see "Brand assets" in `design-palette-and-chrome.md` for the font setup of the OG images). Checked in a scratch copy: favicons and all app icons come out byte-identical.
- Coverage: `@vitest/coverage-v8` is **still declared** in both roots and `npm run test:coverage` still works. The 2026-10-14 attempt to drop it failed on an npm quirk: `vitest` declares it as an optional peer, so `npm uninstall` leaves the package installed and in the lockfile (only flags change). Not forced, lockfiles are not edited by hand. If npm ever removes it cleanly, the on-demand command is `npm i --no-save @vitest/coverage-v8@<installed vitest version>` followed by `npx vitest run --coverage`.

**Server install without install scripts (2026-10-14)** — both deploy steps in `.github/workflows/deploy.yml` run `npm ci --ignore-scripts` (backend in `MintRadar/backend`, frontend in `MintRadar`). Why: the server installs the full dev trees (~600 and ~260 packages) as the deploy user, and without the flag every package's install script would run there with that user's rights; a compromised dependency release would execute on the production host at the next deploy. The flag only removes behaviour (no network access or package is added). Nothing else changes: the build, `docker compose` commands and publishing are untouched. The test job on the GitHub runner still uses plain `npm ci` (kept as is; the same build, typecheck, lint and unit suites also passed with the flag in a clean copy).
- Install scripts that are skipped (all entries with `hasInstallScript` in the two lockfiles, checked 2026-10-14): `fsevents` 2.3.2 and 2.3.3 (frontend dev tree, `vite/node_modules`; backend dev tree) — optional, macOS only, not installed on Linux at all; `esbuild` 0.28.1 (backend dev tree only) — `postinstall: node install.js` only optimises the launcher binary, the platform package `@esbuild/linux-x64` is installed by npm itself and `import('esbuild')` works without the script. The frontend build uses Vite 8 with Rolldown (`@rolldown/binding-linux-x64-gnu`, a plain optional dependency, no script).
- Proof: the production build from `npm ci --ignore-scripts` is byte-identical (72 files, same names and sizes) to the build from a normal `npm ci`.
- The frontend `tsc -b` also type checks `backend/src` (the unit tests under `src/__tests__` import backend modules), so the backend install must run before the frontend build in the deploy script.
- Rule: if a future dependency really needs its install script, add an explicit `npm rebuild <that package>` after the `npm ci --ignore-scripts` line in the deploy script; never remove the flag globally. The Docker runtime stage already uses the same flag (below).

**`backend/Dockerfile`** — `RUN npm ci --omit=dev --omit=optional --ignore-scripts`. `--only=production` is deprecated. `--omit=optional` is there because `nostr-tools` declares `typescript` as an optional peer; `typescript` is also a root devDependency, so npm does not flag it "dev" and `--omit=dev` alone installed it (24 MB, 54 % of the runtime `node_modules`). Measured: image 224 → 192 MB, runtime `node_modules` 44,964 → 17,788 kB, 103 → 97 listed packages, typescript absent. The image is built from a `dist/` compiled on the host (the deploy runs `npm run build` first), there is no build stage. Do not re-add dev tooling to `dependencies`.

**Consequences worth knowing**
- Backend `npm run lint` loads `../eslint.config.js` and therefore the frontend root's `typescript-eslint`; the backend has no `@typescript-eslint/*` packages of its own. A backend lint run needs the frontend root's `node_modules`.
- The backend no longer has a `@typescript-eslint` peer range that blocks `typescript` majors; `.github/dependabot.yml` (`ignore` of semver-major `typescript`) is now the only gate there. The frontend still has the `typescript-eslint` peer range (`<6.1.0`).

**Kept on purpose** (audit 2026-10-14, owner decision — do not "clean up" without a new reason)
- `p-limit` — 2 call sites (`cron.ts`, `prober.ts`); a 12-line limiter would do, kept to avoid churn in the probe path.
- `cors` + `@types/cors` — one call site (`restrictedCors` in `index.ts`); CORS is security-sensitive and covered by tests, so not hand-rolled.
- `dexie-react-hooks` — `useLiveQuery` in 3 files; own hook possible, but dependency/default-value semantics are a risk for ~1 kB.
- `@testing-library/jest-dom` — matchers in several test files plus `src/test/setup.ts`.
- `supertest` — the backend integration test files.
- `qrcode.react` — QR rendering in 2 files; last release 2024-12 but zero dependencies, 15.8 kB, no advisories. Swap for a zero-dependency QR library if it ever breaks.
- `recharts` — 3 files, lazy 236 kB chunk; the only alternative is a hand-made SVG chart set.
- `vite-plugin-pwa` — service worker via workbox; 291 build-time-only transitive packages. The alternative is a hand-written service worker plus precache list.
- `nostr-tools` — protocol core in both roots; single maintainer, so watch its releases (its pinned `@noble/*` copies are why the bundle has duplicate noble versions).
- `immer` — peer of `zustand/middleware/immer` (`watchlist.store.ts`); `recharts` depends on it as well.
- `ipaddr.js` — the SSRF guard in `ssrf.ts` (including NAT64/6to4/Teredo extraction); never hand-roll IP classification.
- `undici` (backend) — `Agent` with DNS pinning for `safeFetch`; Node's bundled copy cannot be imported. Backend `ws` — `DnsPinnedWebSocket` and the nostr-tools polyfill.
- `pg`, `express`, `node-cron` — core; replacements would be far beyond 30 lines.
- `@cashu/cashu-ts` (lazy `/tools` chunk), `dexie`, `react`, `react-dom`, `vite`, `vitest`, `@playwright/test` — core.
- `typescript` — frontend `^5.9`, backend `^6.0`; majors are deliberate (typescript-eslint peer range, Dependabot `ignore`).
- `@vitest/coverage-v8` — see above.
- GitHub Actions and the workflows were not touched.

## Dependency versions (as of 2026-06-29)

_Entries for packages removed on 2026-10-14 (`globals`, `@noble/hashes` and `@noble/secp256k1`, the backend's `@typescript-eslint/*`, `@types/node-cron`, `ws` and `@noble/ciphers` in the frontend, `sharp`) are gone from this list; see "Dependency policy" above._

### Frontend
- eslint: 10.6.0 (upgraded from 9.x)
- eslint-plugin-react-hooks: 7.1.1 (upgraded from 5.2.0 — v7 adds ESLint v10 support)
- lucide-react: 1.22.0
- @types/node: 26.0.1
- immer: 11.1.16 (upgraded 2026-08-15 — was held at v10 pending verification with Zustand, now confirmed compatible, see the "GOTCHA — Dependabot PRs" Batch 3 note above)

### Backend
- undici: 8.5.0 (security fix — 8 CVE patched)
- pg: 8.22.0
- node-cron: 4.5.0
- @types/node: 26.0.1

## Backup cron

Runs every 6h: `0 */6 * * *` → `scripts/backup-db.sh`
- Output: `/var/backups/mintradar/mintradar_YYYYMMDD_HHMMSS.sql.gz` (rotates to 7 days)
- Log: `/var/log/mintradar-backup.log`
- Format: `pg_dump | gzip` — plain SQL, suitable for `zcat | psql` restore (unchanged; not encrypted)
- NOTE: `/var/backups/mintradar/` and `/var/log/mintradar-backup.log` must be owned by `deploy` user (created with `sudo`, `mkdir -p` in script cannot create them itself)
- **Permissions (2026-10-04):** the script sets `umask 077`, runs `install -d -m 700` on the backup directory (that one directory only, never recursive) and `chmod 600` on each dump — directory `700`, files `600`, owner `deploy`. Before this, the directory was 755 and the files 664 (readable by every local user).
- **Atomic write:** the dump goes to `/var/backups/mintradar/.mintradar_<ts>.sql.gz.tmp` and is `mv`'d to `mintradar_<ts>.sql.gz` only after `pg_dump | gzip` succeeded (`pipefail`) and the decompressed size is non-zero. A failed run exits 1 (message on stderr → the cron log), leaves no `.sql.gz`, and an `EXIT` trap removes the temp file. A temp file left by a `SIGKILL` / power loss is deleted by the same script after 1 day (`.tmp` does not match the `*.sql.gz` retention pattern).
- **Retention (unchanged):** `find -name "*.sql.gz" -mtime +7 -delete` runs after a successful backup, so files older than 8 whole days go (about 33 files at 6-hourly). A failed run does not run retention.
- The cron log `/var/log/mintradar-backup.log` is created by the cron redirect, not by the script, so the script's `umask` does not set its mode. It only holds the "Backup completed: <file>" line and error output.
- **ONE-TIME MANUAL STEP on server01 (as `deploy`), after the deploy that installs this script** — the script only protects new files, the existing ones keep their old modes:
  ```
  chmod 700 /var/backups/mintradar && chmod 600 /var/backups/mintradar/*.sql.gz
  ```
  Verify (names and modes only): `ls -ld /var/backups/mintradar && ls -l /var/backups/mintradar`.
- **Relay events backup (not a file backup):** `deploy/strfry/backup-own-events.sh` (cron 04:00, copy under `/opt/mintradar-strfry`) copies public Nostr events onto our own relay and only writes a timestamp to `/opt/mintradar-strfry/backup-state/last-sync-unix`. Check the relay data directory and the state directory on the server the same way (`ls -ld`, `ls -l`) and apply `700` / `600` if they are world-readable.
- **Open items (deliberately not done):** no encryption of the dumps, no off-server copy, no restore script (the only documented restore is the manual `zcat | psql` pipe; it has to run as `deploy` or root now that the files are `600`).

## Finvu backup (2026-10-14)

Finvu (the household finance tracker, a separate project on the same server) had no automatic backup. Since 2026-10-14 its database is dumped on the same pattern as MintRadar's. Nothing about Finvu's containers, compose files, data or configuration was changed; the script lives on the server, **not** in this repository or in the Finvu repository (the text below is a copy for safekeeping).

- **What:** `pg_dump` (no extra options, like `backup-db.sh`) of database `finance_tracker` (user `user`) in the container `finance-tracker-postgres-1` (`postgres:17-alpine`, PostgreSQL 17.10), through `docker exec`, piped to `gzip`. Plain SQL, not encrypted. The live database was 9518 kB (18 tables, 1020 rows) and one dump is about 70 kB compressed (248 kB as SQL; most of the 9.5 MB is system catalogs, the user tables total roughly 1 MB).
- **Where:** `/var/backups/finvu/finvu_<YYYYMMDD>_<HHMMSS>.sql.gz` (UTC). Directory `drwx------ deploy:deploy`, files `600` (same as `/var/backups/mintradar`). Script: `/home/deploy/bin/backup-finvu-db.sh` (`deploy`, `700`).
- **Schedule:** every 6 hours at :30, offset from MintRadar's `0 */6` so the two never overlap. The server and cron run in UTC.
- **Retention:** like MintRadar, files older than `-mtime +7` go, only inside `/var/backups/finvu`, only the exact pattern `finvu_*.sql.gz`, and **never the 4 newest files**, so a long failure cannot wipe all backups. A failed run does not run retention.
- **Safety:** `flock` (no overlapping runs), refuses to run when the container is not running, temp file `finvu_<ts>.sql.gz.tmp` verified (`gzip -t`, at least 1 KB, header contains "PostgreSQL database dump") before the atomic `mv`, then `chmod 600`, then `LAST_OK` is written last. On any error the temp file is removed, one line `finvu-backup FAILED: <reason> (exit N)` goes to stderr and the exit code is non-zero.
- **Log:** `/var/backups/finvu/backup.log` (`600`), the script keeps the last 500 lines itself.

Cron line (deploy user's crontab; the previous crontab is saved as `/home/deploy/backups/crontab.bak-20261014-185223`):

```
30 */6 * * * /home/deploy/bin/backup-finvu-db.sh >> /var/backups/finvu/backup.log 2>&1
```

Script (verbatim, sha256 `4145ca1e91b8e9cb7e0ad6eb55007a330ac9a6be79c6058d653605503dd75054`):

```bash
#!/bin/bash
set -euo pipefail
umask 077
export PATH=/usr/bin:/bin:/usr/local/bin

BACKUP_DIR=/var/backups/finvu
CONTAINER=finance-tracker-postgres-1
KEEP_DAYS=7        # same as MintRadar (find -mtime +7)
KEEP_NEWEST=4      # never delete the 4 newest, even if old
LOG="$BACKUP_DIR/backup.log"
LOCK="$BACKUP_DIR/.lock"
TS=$(date -u +%Y%m%d_%H%M%S)
FINAL="$BACKUP_DIR/finvu_$TS.sql.gz"
TMP="$FINAL.tmp"
MSG="unexpected error"

log() { echo "$(date -u '+%Y-%m-%d %H:%M:%S') UTC $*"; }

# Any error: remove the temp file, one line to stderr, non-zero exit.
trap 'rc=$?; rm -f "$TMP"; if [ "$rc" -ne 0 ]; then echo "finvu-backup FAILED: $MSG (exit $rc)" >&2; fi' EXIT

[ -d "$BACKUP_DIR" ] || { MSG="$BACKUP_DIR does not exist"; exit 1; }

# No two runs at once.
exec 9>"$LOCK"
MSG="another run holds the lock"
flock -n 9 || exit 1

# Keep the last 500 log lines (in place: the cron >> descriptor stays valid).
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 500 ]; then
  tail -n 500 "$LOG" > "$LOG.rot" && cat "$LOG.rot" > "$LOG"; rm -f "$LOG.rot"
fi
chmod 600 "$LOG" 2>/dev/null || true

if ! [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]; then
  MSG="container $CONTAINER is not running"
  exit 1
fi

log "start"
MSG="pg_dump or gzip returned an error"
docker exec "$CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$TMP"

MSG="dump is not a valid gzip stream"
gzip -t "$TMP"
MSG="dump is smaller than 1 KB"
[ "$(stat -c %s "$TMP")" -ge 1024 ]
MSG="dump header is missing 'PostgreSQL database dump'"
HEAD=$(gzip -dc "$TMP" | head -n 5 || true)
grep -q "PostgreSQL database dump" <<<"$HEAD"

MSG="could not move the dump into place"
chmod 600 "$TMP"
mv -f "$TMP" "$FINAL"

MSG="could not write LAST_OK"
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$FINAL")" > "$BACKUP_DIR/LAST_OK.tmp"
chmod 600 "$BACKUP_DIR/LAST_OK.tmp"
mv -f "$BACKUP_DIR/LAST_OK.tmp" "$BACKUP_DIR/LAST_OK"

# Retention: only exact-pattern files in this directory, never the newest 4.
MSG="retention failed"
mapfile -t NEWEST < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'finvu_*.sql.gz' | sort -r | sed -n "1,${KEEP_NEWEST}p")
while IFS= read -r -d '' f; do
  for k in "${NEWEST[@]}"; do [ "$f" = "$k" ] && continue 2; done
  rm -f -- "$f"; log "removed old backup $(basename "$f")"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'finvu_*.sql.gz' -mtime +"$KEEP_DAYS" -print0)
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'finvu_*.sql.gz.tmp' -mtime +1 -delete

log "Backup completed: $(basename "$FINAL") ($(stat -c %s "$FINAL") bytes)"
```

**Check freshness** (names, sizes and times only): `cat /var/backups/finvu/LAST_OK` (UTC timestamp and file name of the last good backup), `ls -l --time-style=long-iso /var/backups/finvu`, `tail -n 5 /var/backups/finvu/backup.log`.

**Restore** (as `deploy`; the dump has to be restored by a role that can create objects owned by `finance_user` and `"user"`, which exist in the live container). Restore into a new database first, check it, and only then swap:

```
F=/var/backups/finvu/finvu_<YYYYMMDD>_<HHMMSS>.sql.gz
docker stop finance-tracker-repo-backend-1        # stop the app: nobody writes during the swap
docker exec finance-tracker-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE finance_tracker_restore"'
zcat "$F" | docker exec -i finance-tracker-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d finance_tracker_restore -v ON_ERROR_STOP=1 -q'
# compare table list and row counts with the old database, then swap:
docker exec finance-tracker-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "ALTER DATABASE finance_tracker RENAME TO finance_tracker_old" -c "ALTER DATABASE finance_tracker_restore RENAME TO finance_tracker"'
docker start finance-tracker-repo-backend-1
```

Drop `finance_tracker_old` only after the app has been checked. Rollback of the swap: rename the two databases back.

**Restore test (2026-10-14, server01):** the newest dump (`finvu_20261014_185226.sql.gz`, 69 928 B) was restored into a throwaway `postgres:17-alpine` container (`--network none`, `--memory 384m`, tmpfs data, no volumes, no ports; roles `"user"` and `finance_user` created first because the dump assigns ownership to them; the first attempt failed on the missing `finance_user`, which is why that role is listed above). Result: restore exit 0 in 0.52 s, peak memory 81.6 MiB. All 18 tables had exactly the same row counts as the live database (1020 rows; a second live count a minute later showed no change in any table), and the indexes (36), sequences (4) and constraints (50) matched. The container was removed in a `trap`; `docker ps -a` and `docker volume ls` were identical before and after. Only table names and counts were compared, no data was printed.

**Off-server copy (not set up yet; pull from a laptop):**

```
rsync -a --ignore-existing server01:/var/backups/finvu/ ~/backups/finvu/
rsync -a --ignore-existing server01:/var/backups/mintradar/ ~/backups/mintradar/
```

**Honest limitation:** the backups sit on the same server and the same disk. They protect against mistakes, bad deploys and corrupted data, **not** against losing the server or the disk. For that, Hetzner snapshots or a regular off-server copy (the `rsync` above, ideally encrypted) are needed. No encryption, no notification on failure (the only signal is `LAST_OK` going stale and `backup.log`).

## Relay (strfry) backup (2026-10-16)

The own relay (container `mintradar-strfry`, compose file `/opt/mintradar-strfry/docker-compose.strfry.yml`, database in the Docker volume `mintradar-strfry_strfry-db`, mounted at `/app/strfry-db`) had no backup. The Postgres backups do not cover it, and `backup-own-events.sh` only copies events from public relays INTO the relay. The relay also holds events that exist on no public relay (for example kinds 7375, 7376 and 30078 of the owner), so it can be the only copy. Since 2026-10-16 it is exported every 6 hours. Nothing about the relay, its compose file, configuration, allow-list, volume or the other cron jobs was changed; the script lives on the server, **not** in the application code (the text below is a copy for safekeeping).

- **Method:** `docker exec mintradar-strfry /app/strfry export | gzip` (read-only, safe while the relay runs). One event per line, JSON, key order starts with `"content"`.
- **Where:** `/var/backups/strfry/strfry_<YYYYMMDD>_<HHMMSS>.jsonl.gz` (UTC). Directory `drwx------ deploy:deploy`, files `600`. Script: `/home/deploy/bin/backup-strfry.sh` (`deploy`, `700`).
- **Schedule:** `50 */6 * * *` UTC (server and cron run in UTC), 20 minutes after the Finvu dump.
- **Retention:** files older than `-mtime +14` go, only inside `/var/backups/strfry`, only the exact pattern `strfry_*.jsonl.gz`, and **never the 8 newest files**. A failed run does not run retention.
- **Safety:** `flock`, refuses to run when the container is not running, temp file `.tmp` verified before the atomic `mv`: `gzip -t`, at least 100 bytes, every line carries a 64-hex `"id"` (the export starts with `{"content"`, not `{"id":"`, so the check counts lines with an id instead of looking at the first characters). `LAST_OK` is written last: `<UTC timestamp> <file name> <event count>`. A `WARNING` line in the log (not a failure) appears if the count is below 80 % of the previous backup's count. On any error the temp files are removed, one line `strfry-backup FAILED: <reason> (exit N)` goes to stderr and the exit code is non-zero.
- **Log:** `/var/backups/strfry/backup.log` (`600`), the script keeps the last 500 lines itself.

Cron line (`crontab -l` of `deploy`):

```
50 */6 * * * /home/deploy/bin/backup-strfry.sh >> /var/backups/strfry/backup.log 2>&1
```

Script `/home/deploy/bin/backup-strfry.sh` (sha256 `45d15b05f1cb9dc03d66ecc9a968a9e1513966fa104f151c103fbcfb5dea8167`):

```bash
#!/bin/bash
set -euo pipefail
umask 077
export PATH=/usr/bin:/bin:/usr/local/bin

BACKUP_DIR=/var/backups/strfry
CONTAINER=mintradar-strfry
KEEP_DAYS=14       # delete strfry_*.jsonl.gz older than this
KEEP_NEWEST=8      # never delete the 8 newest, even if old
MIN_BYTES=100
LOG="$BACKUP_DIR/backup.log"
LOCK="$BACKUP_DIR/.lock"
TS=$(date -u +%Y%m%d_%H%M%S)
FINAL="$BACKUP_DIR/strfry_$TS.jsonl.gz"
TMP="$FINAL.tmp"
ERR="$BACKUP_DIR/.export.err"
MSG="unexpected error"

log() { echo "$(date -u '+%Y-%m-%d %H:%M:%S') UTC $*"; }

# Any error: remove temp files, one line to stderr, non-zero exit.
trap 'rc=$?; rm -f "$TMP" "$ERR"; if [ "$rc" -ne 0 ]; then echo "strfry-backup FAILED: $MSG (exit $rc)" >&2; fi' EXIT

[ -d "$BACKUP_DIR" ] || { MSG="$BACKUP_DIR does not exist"; exit 1; }

# No two runs at once.
exec 9>"$LOCK"
MSG="another run holds the lock"
flock -n 9 || exit 1

# Keep the last 500 log lines (in place: the cron >> descriptor stays valid).
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 500 ]; then
  tail -n 500 "$LOG" > "$LOG.rot" && cat "$LOG.rot" > "$LOG"; rm -f "$LOG.rot"
fi
chmod 600 "$LOG" 2>/dev/null || true

if ! [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]; then
  MSG="container $CONTAINER is not running"
  exit 1
fi

log "start"
MSG="strfry export or gzip returned an error"
docker exec "$CONTAINER" /app/strfry export 2>"$ERR" | gzip > "$TMP" \
  || { MSG="strfry export or gzip returned an error: $(tail -n 1 "$ERR" 2>/dev/null | cut -c1-200)"; exit 1; }

MSG="export is not a valid gzip stream"
gzip -t "$TMP"
MSG="export is smaller than $MIN_BYTES bytes"
[ "$(stat -c %s "$TMP")" -ge "$MIN_BYTES" ]
MSG="could not count events"
COUNT=$(gzip -dc "$TMP" | wc -l)
# strfry export writes one JSON event per line (key order: content first),
# so check that every line carries a 64-hex "id" field.
MSG="export lines are not all events with a 64-hex id"
IDS=$(gzip -dc "$TMP" | grep -c '"id":"[0-9a-f]\{64\}"' || true)
[ "$COUNT" -gt 0 ] && [ "$IDS" -eq "$COUNT" ]

# Compare with the previous backup (3rd field of LAST_OK); warn, do not fail.
if [ -f "$BACKUP_DIR/LAST_OK" ]; then
  PREV=$(awk '{print $3}' "$BACKUP_DIR/LAST_OK" 2>/dev/null || true)
  if [[ "${PREV:-}" =~ ^[0-9]+$ ]] && [ "$PREV" -gt 0 ] && [ $((COUNT * 100)) -lt $((PREV * 80)) ]; then
    log "WARNING: event count $COUNT is below 80% of previous backup ($PREV)"
  fi
fi

MSG="could not move the export into place"
chmod 600 "$TMP"
mv -f "$TMP" "$FINAL"

MSG="could not write LAST_OK"
printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$FINAL")" "$COUNT" > "$BACKUP_DIR/LAST_OK.tmp"
chmod 600 "$BACKUP_DIR/LAST_OK.tmp"
mv -f "$BACKUP_DIR/LAST_OK.tmp" "$BACKUP_DIR/LAST_OK"

# Retention: only exact-pattern files in this directory, never the newest 8.
MSG="retention failed"
mapfile -t NEWEST < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'strfry_*.jsonl.gz' | sort -r | sed -n "1,${KEEP_NEWEST}p")
while IFS= read -r -d '' f; do
  for k in "${NEWEST[@]}"; do [ "$f" = "$k" ] && continue 2; done
  rm -f -- "$f"; log "removed old backup $(basename "$f")"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'strfry_*.jsonl.gz' -mtime +"$KEEP_DAYS" -print0)
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'strfry_*.jsonl.gz.tmp' -mtime +1 -delete

log "Backup completed: $(basename "$FINAL") ($(stat -c %s "$FINAL") bytes, $COUNT events)"
```

**Check freshness** (names, sizes, times and counts only; never print events from this relay, it holds private data): `cat /var/backups/strfry/LAST_OK`, `ls -l --time-style=long-iso /var/backups/strfry`, `tail -n 5 /var/backups/strfry/backup.log`.

**Restore into a NEW relay** (as `deploy`; an existing event is skipped as a duplicate, so importing into a non-empty database is safe). Stop the relay, import into its volume with a one-off container of the same image and the same read-only configuration, start it again:

```
F=/var/backups/strfry/strfry_<YYYYMMDD>_<HHMMSS>.jsonl.gz
docker compose -f /opt/mintradar-strfry/docker-compose.strfry.yml stop strfry
gzip -dc "$F" | docker run --rm -i --network none --memory 256m \
  -v mintradar-strfry_strfry-db:/app/strfry-db \
  -v /opt/mintradar-strfry/strfry.conf:/etc/strfry.conf:ro \
  -v /opt/mintradar-strfry/writePolicy.sh:/app/plugins/writePolicy.sh:ro \
  -v /opt/mintradar-strfry/privileged-pubkeys.txt:/app/plugins/privileged-pubkeys.txt:ro \
  --entrypoint /app/strfry mintradar-strfry-strfry import
docker compose -f /opt/mintradar-strfry/docker-compose.strfry.yml start strfry
```

The last line of the import output must read `Done. Processed N lines. N added, 0 rejected` (N = the count in `LAST_OK`). Then compare the count: `docker exec mintradar-strfry /app/strfry scan '{}' | wc -l`. For a brand-new server first create the volume and the container with the compose file (`up -d --build`) and stop it, then run the same import.

**Restore test (2026-10-16, server01):** the newest backup (`strfry_20261016_180841.jsonl.gz`, 35 511 B, 113 events) was imported (without `--no-verify`) into a throwaway container from the same image as the relay (`--network none`, `--memory 256m`, `--memory-swap 256m`, no ports, no volumes, `/app/strfry-db` on a tmpfs, the three configuration files mounted read-only, entrypoint `sleep 600`). Result: import exit 0 in 0.28 s, `113 added, 0 rejected, 0 dups`. Live relay and restored copy had the same total (113), the same counts for all 20 kinds, and the same sha256 of the sorted list of event ids (`61f41289…2fa03001`); a second live count a minute later was still 113, so no event was written in between. The container was removed in a `trap`; `docker ps -a` and `docker volume ls` were identical before and after. Only counts, kinds and hashes were compared, no event was printed. Note: the test restored into a tmpfs; the variant above that imports into the real volume uses the same `import` command but was not run against the production volume.

**Off-server copy (not set up yet; pull from a laptop):**

```
rsync -a --ignore-existing server01:/var/backups/strfry/ ~/backups/strfry/
```

**Honest limitation:** the backups sit on the same server and the same disk. They protect against mistakes and a damaged database, **not** against losing the server or the disk. No encryption (the files contain private events of the owner in clear text, so keep any copy on an encrypted disk), no notification on failure (the only signal is `LAST_OK` going stale and `backup.log`).

## Relay allow-list and the health-assertion activation checklist (2026-10-14)

`deploy/strfry/privileged-pubkeys.txt` is the ONE list of privileged authors of the own relay (`wss://nostr.mintradar.org`): `writePolicy.sh` (inside the strfry container, bind-mounted read-only, **read once at startup**) lets these keys write any kind, everyone else only kinds 38172 and 38000; `backup-own-events.sh` reads the same file for its author list (every listed author gets the base kinds 38172 and 38000; extra kinds are per author in `EXTRA_KINDS_BY_AUTHOR`, nothing for the health key). Three keys are listed: the maintainer identity, the MintRadar service identity (alerts) and, since 2026-10-14, the **MintRadar Health** attestation key (`2ddd7ce9…941c`). The repository copy is only the source: the file on the server (strfry install directory, `/opt/mintradar-strfry`) changes when the gated server step copies it and restarts the relay container; a deploy of the repository does not do that.

Health assertions are **live since 2026-10-13** (first publication 17:48:27 UTC, 61 mints; details, constants and observed behaviour in `docs/claude/nostr-health-assertions.md`). The allow-list change was applied on server01 the same day: the live list at `/opt/mintradar-strfry/privileged-pubkeys.txt` now equals the repository file (backup `privileged-pubkeys.txt.bak-20261013-174222` next to it), the relay container `mintradar-strfry` was restarted (event counts for kinds 38172, 38000 and 0 were identical before and after), and the backend was recreated with `docker compose up -d backend` so it reads `ATTESTATION_SERVICE_NSEC` from `backend/.env`.

Repeatable checklist (new server, key rotation):
1. Owner: `ATTESTATION_SERVICE_NSEC` into the server's `backend/.env` (never printed; `ls -l` and `grep -c "^ATTESTATION_SERVICE_NSEC="` only).
2. Server task: back up the live list (`sudo cp -p … .bak-<UTC timestamp>`), install the repository `privileged-pubkeys.txt` over it, `sudo docker restart mintradar-strfry` (the list is read once at start), re-measure the event counts.
3. Server task: `docker compose up -d backend` (recreate, so the new `.env` is read; `restart` would not).
4. Read-only: backend log lines starting `[attestations]`, `attestation_state` row count, `nak req -k 30385 -a <hex> wss://nostr.mintradar.org`.
Rollback: restore the backup list and restart the relay; for the backend delete the `ATTESTATION_SERVICE_NSEC=` line with `sed -i` and `docker compose up -d backend` (dormant again). `wss://nostr.mintradar.org` does not advertise NIP-40, so its copies of expired events stay (one replaceable event per mint).

## security.txt (RFC 9116, 2026-10-05)

`public/.well-known/security.txt` is a static file (copied into `dist/` by Vite like `nostr.json`; no backend involved). `Contact` is the repository's GitHub private vulnerability reporting URL (`https://github.com/hroomnik007/MintRadar/security/advisories/new`, same as SECURITY.md; reporting is enabled on the repo), `Preferred-Languages: en`, `Canonical: https://mintradar.org/.well-known/security.txt`. Created 2026-10-05 with `Expires: 2027-10-05T00:00:00.000Z`.

- **YEARLY RENEWAL (before 2027-10-05):** move `Expires` forward to 12 months from the day you edit it (UTC, ISO 8601, e.g. `2028-10-05T00:00:00.000Z`), commit and push (CI deploys it). An expired file is treated by scanners as untrustworthy, so do this a few weeks early. Next reminder: **September 2027**.
- Served as a plain file, never the SPA shell. RFC 9116 asks for `Content-Type: text/plain; charset=utf-8`; `mime.types` alone sends `text/plain` with no charset. **`deploy/nginx.conf` has `location = /.well-known/security.txt { default_type text/plain; charset utf-8; expires 1h; try_files $uri =404; }` — applied to the server on 2026-10-05 (see "Manifest MIME + security.txt charset" above); the live site sends `text/plain; charset=utf-8`.** It deliberately has no `add_header`: any `add_header` in a location drops the server-level security headers (see add_header non-inheritance), whereas `expires` sets `Cache-Control: max-age=3600` (same lifetime as the `nostr.json` block) without affecting inheritance, so CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy and Permissions-Policy all still apply. (The neighbouring `nostr.json` block does use `add_header`, so it carries only its CORS and cache headers, not the security headers; left as is.) Tested 2026-10-05 in an `nginx:stable-alpine` container (nginx 1.30.5): `nginx -t` OK; `/.well-known/security.txt` 200 `text/plain; charset=utf-8` with all six security headers; `manifest.webmanifest` `application/manifest+json`.

## Task D1b: llms.txt, OpenAPI file, no AI catalog (2026-10-22)

- **Files.** `public/llms.txt` (plain Markdown, copied into `dist/` by Vite); the OpenAPI file is built from `docs/openapi/wallets-v1.yaml` by `vite-openapi.ts` (emitted at `dist/docs/openapi/wallets-v1.yaml`, byte-identical; the dev server serves the same bytes). The service worker's `navigateFallbackDenylist` also lists `/^\/docs\//` and `/^\/llms\.txt$/` so a browser with the PWA installed does not get the app shell for them.
- **`deploy/nginx.conf`** (repo copy; the deploy workflow copies the frontend but NOT nginx.conf, so until the owner applies it: `/llms.txt` and the YAML are served by `location /` as plain files with the distro MIME type (`text/plain` without charset, the YAML as `application/octet-stream`) and `/.well-known/ai-catalog.json` still answers with the app shell): the `types {}` block maps `yaml` to `application/yaml`; `location = /docs/openapi/wallets-v1.yaml` and `location = /llms.txt` use `try_files $uri =404`, `expires`, `Access-Control-Allow-Origin *` (public static GET resources) and repeat the six security headers (an `add_header` in a location replaces the inherited ones); `location = /.well-known/ai-catalog.json { return 404; }`. **Why 404 for the catalog:** Lighthouse treats a missing AI catalog as not applicable but fails on an HTML response, which the app-shell fallback would send. Do not publish a catalog until the spec is stable. `location /` and its soft 404 for every other unknown path are unchanged (owner decision of 2026-10-05).
- **Checked in a container** (`nginx:alpine` under podman, temp copy of the file with listen ports 8443/8080 and self-signed certificates at the `/etc/letsencrypt` paths, the real production build as root): `nginx -t` OK; `/llms.txt` 200 `text/plain; charset=utf-8`; the YAML 200 `application/yaml` with `access-control-allow-origin: *`, bytes identical to the source; `/.well-known/ai-catalog.json` 404; `/`, `/mint/abc` and `/this-does-not-exist` 200 `text/html` (soft 404 unchanged). With the ai-catalog block removed the same check returns 200 `text/html`. No test parses `nginx.conf` for behaviour; `src/__tests__/llmsTxt.test.ts` only pins the presence of these blocks.
- **Owner applies nginx by hand** (as `deploy` on server01; the certificate lines are not part of this change, so the live ones stay): `cd $VPS_REPO_PATH && git pull origin main` (after the deploy), then `diff /etc/nginx/sites-available/mintradar.org.conf $VPS_REPO_PATH/MintRadar/deploy/nginx.conf` (expect only the `application/yaml yaml;` line, the comment on the types block and the three new `location =` blocks), `sudo cp -p /etc/nginx/sites-available/mintradar.org.conf /etc/nginx/sites-available/mintradar.org.conf.bak-$(date -u +%Y%m%d-%H%M%S)`, `sudo cp $VPS_REPO_PATH/MintRadar/deploy/nginx.conf /etc/nginx/sites-available/mintradar.org.conf`, `sudo nginx -t`, `sudo systemctl reload nginx`. **Rollback:** `sudo cp -p /etc/nginx/sites-available/mintradar.org.conf.bak-<stamp> /etc/nginx/sites-available/mintradar.org.conf && sudo nginx -t && sudo systemctl reload nginx`. Verify: `curl -sI https://mintradar.org/llms.txt` (200, text/plain), `curl -sI https://mintradar.org/docs/openapi/wallets-v1.yaml` (200, application/yaml, access-control-allow-origin: *), `curl -sI https://mintradar.org/.well-known/ai-catalog.json` (404), `curl -sI https://mintradar.org/this-does-not-exist` (200, unchanged).
- **Tests:** `src/__tests__/openApiAsset.test.ts` (emitted path and bytes, a real build into a temp dir, the dev middleware, the denylist), `src/__tests__/llmsTxt.test.ts` (links, kind and relay from the constants, probe interval, no `http://` or foreign hosts, no path that does not exist), `e2e/openapi-file.spec.ts` (the dev server returns the file, not the shell).

## Task D1d: /docs/ rule, gzip of the YAML, /for-wallets link (2026-10-22)

- **`location ^~ /docs/ { try_files $uri =404; }`** (no `add_header`, so the server-level security headers apply): the dist directory `docs/openapi/` exists, so without it `/docs` and `/docs/openapi` answered with a bare nginx 403 (directory without index). Now `/docs` 301 to `/docs/`, then 404; the exact-match YAML location still wins. Nothing else lives under `/docs/`; the soft 404 of `location /` for every other unknown path is unchanged.
- **`application/yaml` is in `gzip_types`**, so the OpenAPI file is sent compressed (it was served plain: `application/yaml` is not in nginx's default list).
- **/for-wallets** now links `https://mintradar.org/docs/openapi/wallets-v1.yaml` (`DOCS_OPENAPI_URL`) instead of the GitHub blob URL; the text still says the source file is in the GitHub repository. `docs/API.md` links the file relatively and is unchanged. `FOR_WALLETS_PAGE_LASTMOD` was already 2026-10-22.

## Task E3: strfry HEALTHCHECK, /mint/ precedence in nginx (2026-10-22)

- **Relay healthcheck** (`deploy/strfry/docker-compose.strfry.yml`): `wget -q -O /dev/null "--header=Accept: application/nostr+json" http://127.0.0.1:7777/` (busybox wget from the Alpine base image; nothing installed), `interval: 30s`, `timeout: 5s`, `retries: 3`, `start_period: 20s`. Exit 0 only on a 200 (NIP-11 document) from strfry inside the container; a refused connection, a timeout or any non-2xx answer is exit 1. **It only reports health: Docker does not restart a container because it is `unhealthy`, and `restart: unless-stopped` is unchanged.** Read it with `docker ps` (the `STATUS` column shows `(healthy)` / `(unhealthy)` / `(health: starting)`) or `docker inspect --format '{{.State.Health.Status}}' mintradar-strfry` (last results: `--format '{{json .State.Health.Log}}'`). Verified with the same busybox 1.37 `wget` in `alpine:3.24` against a throw-away `nc` server (200 -> 0, 404 / 101 / refused -> 1, the `Accept` header arrives); not run against strfry itself (the pinned image is not built on the development machine).
- **`location ^~ /mint/`**: the static-asset regex location (`\.(js|css|png|svg|ico|woff2|webmanifest)$`) used to win over the plain prefix `location /mint/`, so `/mint/https%3A%2F%2Fexample.com%2Ficon.svg` (a mint URL ending in an asset extension) answered with a bare nginx 404 and social crawlers did not get the OG rewrite either. `^~` makes the prefix win; the body is unchanged (social-bot rewrite, SPA fallback). No file is served from `/mint/` (`dist/` has no such directory), so nothing there needs the asset cache headers. `src/__tests__/llmsTxt.test.ts` pins the `^~`. Checked in `nginx:alpine` under podman (base vs. changed config): only the svg-ending mint URL changed (404 -> 200 shell, Twitterbot 404 -> OG rewrite); `/mint/abc`, `/`, `/stats`, `/learn/nuts`, the hashed asset (immutable cache header), `/this.js` 404, `/llms.txt`, the YAML and ai-catalog 404 are identical.

## Task D3d: backend warm-up after a deploy (2026-10-22)

The backend restarts on every backend deploy and the in-process `/api/mints/known` snapshot is empty then. Since D3d the start-up chain (after `initDb()` and the seed) starts a fire-and-forget warm-up and a 45 s refresh timer, so the first visitor after a restart normally gets the snapshot instead of waiting for the snapshot computation (3.3 to 3.9 s with database JIT, about 0.5 s since task E2b, see `backend-api-and-data.md` "Database JIT is off"); a request that arrives before the warm-up has finished still computes synchronously and shares that computation. Constants, the stale-while-revalidate rule and invalidation: `backend-api-and-data.md` ("Known-mints snapshot: stale-while-revalidate"). Nothing in nginx or the database changed.

## Docker log limits (2026-10-04)

`docker-compose.yml`: the `backend` and `postgres` services use `logging: driver: json-file`, `max-size: "10m"`, `max-file: "3"` (≤ 30 MB per container; same values as the separate strfry relay container, which is NOT in this compose file and was not touched). Before this they had `json-file` with no limits, so the logs grew until the container was recreated.
- Log retention is now bounded by **size, not days**: the oldest rotated chunk is dropped once 3 × 10 MB is reached, so how far back `docker logs` reaches depends on how chatty the container is. (nginx logs are separate: logrotate, 14 daily files.)
- **The next deploy recreates both containers.** A changed `logging` block changes the service config hash, and `deploy.yml` runs `docker compose build --pull backend` then `docker compose up -d`. postgres restarts for a few seconds; its data lives in the named volume `mintradar_pgdata` (project `mintradar` → host volume `mintradar_mintradar_pgdata`), which is untouched. Existing container logs are discarded by the recreation. The postgres image is pinned to `postgres:17-alpine` (major 17), so the recreate does not change the server version.
- **Backend vs. a postgres restart (read from the code, not changed):** the pool has an `'error'` listener since 2026-10-16 (`db.ts`, `attachPoolErrorHandler`; one rate-limited `[db] pool error` log line, see `backend-api-and-data.md`), so a dropped idle connection is handled at the source and is no longer an `uncaughtException` (the process-level handlers in `index.ts` remain only as a last resort), and `pg` opens fresh connections on the next query. Requests that hit the DB during the gap return 500, cron jobs catch and log and run again on their next tick (probe every 5 min). The backend itself is recreated in the same deploy; if `initDb()` cannot reach postgres at start-up it calls `process.exit(1)` and `restart: unless-stopped` starts it again. There is no healthcheck and `depends_on` only orders start-up (does not wait for readiness). So a few seconds of DB downtime during a deploy self-heals; `/api/v1/health` `lastProbeAt` is empty until the first probe after the restart (≤ 5 min).
- A backup cron firing during that gap now fails cleanly (no truncated `.sql.gz`, see Backup cron).

## Code splitting & bundle layout (2026-07-05)

- `/stats` and `/mint/:url` routes are `React.lazy` + `Suspense` in `App.tsx` — the only Recharts consumers. Initial load dropped ~1124 → ~671 kB raw (~130 kB gzip saved); `vendor-charts` (350 kB) loads on first chart-page visit.
- **GOTCHA — `manualChunks` is dead in Vite 8 (rolldown):** the compat layer silently ignores group changes (builds byte-identical output). Chunking lives in `rollupOptions.output.codeSplitting.groups` — first matching group wins, order matters. (It was `advancedChunks` until 2026-10-14; Rolldown 1.2 deprecates that name with the same group schema. The build output with the new key is byte-identical, every file, and the "advancedChunks option is deprecated" warning is gone.)
- **`vendor-immer` group must stay:** immer is shared by the watchlist store (eager, via zustand middleware) and recharts (lazy, via @reduxjs/toolkit — a second nested copy exists). Without its own group it lands inside `vendor-charts` and drags the whole chart bundle back into the initial modulepreload set. If a new eager module ever shares a dep with recharts, give that dep its own group too — verify with: `grep vendor-charts dist/index.html` (must NOT appear in modulepreload).
- **`vite.config.ts` is the only Vite config (2026-10-02):** `tsconfig.node.json` is `noEmit`, so `tsc -b` no longer writes `vite.config.js` / `vite.config.d.ts` next to it (both are untracked + in `.gitignore`). Before this, Vite resolved the emitted `.js` BEFORE the `.ts`, so an edit to the `.ts` was ignored until a build regenerated the `.js`. Edit `vite.config.ts` only; a stray `vite.config.js` would shadow it again.
- **e2e is type-checked and linted locally only (2026-10-05):** `npm run typecheck` = `tsc -b && npm run typecheck:e2e` (`tsconfig.e2e.json`: standalone, NOT referenced from `tsconfig.json`; `include: ["e2e/**/*.ts"]`, same strictness as `tsconfig.app.json`, `types: ["node"]`, incremental buildinfo `tsconfig.e2e.tsbuildinfo` gitignored) and `npm run lint` = `eslint src e2e` (the one shared `eslint.config.js`, no Playwright-specific rules). The deploy runs `npm ci && npm run build` on the server (backend first, then frontend, `.github/workflows/deploy.yml`) and `build` = `tsc -b && vite build`, which never touches `tsconfig.e2e.json` — so a type error in a spec cannot fail the frontend deploy step after the backend is already live. Keep it that way: do not add e2e to the `tsconfig.json` references or to `build`. Backend: `npm run lint` is `eslint src/` (tests included), `npm run build` is `tsc` with the test folders excluded. Known exceptions in e2e: one `@ts-expect-error` in `navbar-avatar-fallback.spec.ts` (a Vite dev-server URL import that tsc cannot resolve).

## Stale-build chunk-load recovery (2026-09-29)

After a deploy the previous build's hashed lazy chunks (`Stats-<hash>.js`, …) are gone (`rm -rf dist/assets/*` in `deploy.yml`, nginx returns 404 for a missing `.js`), so a tab still running the old build fails on `import()` with "Failed to fetch dynamically imported module".
- `src/utils/chunkReload.ts` — `isChunkLoadError()` (message regex) + `claimAutoReload()` (sessionStorage timestamp `mintradar_chunk_reload_at`, max ONE automatic reload per 60s, try/catch → refuses if storage unavailable) + `reloadOnChunkError()`.
- Unknown URLs are NOT handled by `RouteError` any more (2026-10-05): `App.tsx` has a catch-all `*` child route rendering `src/pages/NotFound.tsx` inside the app shell. `RouteError` only shows for real route errors.
- `src/components/RouteError.tsx` is the root route's `errorElement` (App.tsx): friendly message + Reload button, no stack/"Hey developer" text. On a chunk error it auto-reloads once; a second failure inside 60s (or any non-chunk error) just shows the screen. `main.tsx` also handles Vite's `vite:preloadError` the same way.
- Tests: `src/__tests__/chunkReload.test.ts`, `e2e/chunk-load-recovery.spec.ts` (aborts the dev `/src/pages/Stats.tsx` request). Client-side only — deploy-side (keeping old assets, SW) is unchanged.


## Task E4: readiness gate (2026-10-22)

`backend/src/readiness.ts`, wired in `index.ts`. `app.listen` still opens the port first; `initDb()` and the seed run after it (order of listen / initDb / seed / cron / warm-ups unchanged). Until both have finished, database-dependent requests answer **503 `{"error":"starting"}` with `Retry-After: 2`**. **Gated:** every path under `/api/` (the `/api/v1/*` alias is rewritten first, so it is gated too, wallet API and `/api/mints/known` included) and `/sitemap.xml` (reads `mints`). **Not gated:** `/health` and `/api/v1/health` (200 as before, new field `ready`: `false` until open, `true` after), `/api/og/page` and `/api/nip05/verify` (no database), `/api` (pointer JSON), and everything nginx serves as static files. `/api/og/mint` and `/api/mint/icon` read the database and are gated. **Why:** a request that arrives during `initDb()` can run against a database in the middle of DDL and competes with start-up work for the pool (max 5 connections). **Facts found (read, not changed):** the deploy workflow never calls `/health` (it runs `docker compose build/up -d` and then the frontend step; no wait, no URL, no status check), the backend has no compose healthcheck, so nothing requires a 200 before the database is ready. If `initDb()` or the seed fails the existing `.catch` logs `[startup] DB init failed` and calls `process.exit(1)`, `restart: unless-stopped` starts it again; the gate stays closed. In nginx a closed gate reaches the user as a 503 JSON from the app (nginx passes it through; a 502 appears only while the port itself is not yet open). The gate opens once and is never closed again. Under `NODE_ENV=test` it starts open (no start-up block runs), so existing tests are unchanged; `readiness.test.ts` closes it with `setReadyForTests(false)`. Tests: `integration/readiness.test.ts`.
