# /about page — privacy notice, rules, and where each claim comes from (2026-10-04)

Page: `src/pages/About.tsx` (+ `About.css`), lazy route `/about` (`routerLazy.tsx`, `App.tsx`), one footer link "About"
(`AppShell.tsx`). Sections `#about`, `#privacy` ("Your data"), `#terms` ("Rules"); English only; the operator is only the
pseudonym wildcitizen7. The page makes no promise to remove reviews or data on request and claims no legal compliance.

## Known gaps

- **Reviewer profiles (2026-10-06):** the server also stores the public profile name, display name and NIP-05 address of review authors (`nostr_profiles` table), fetched from profiles.nostr1.com with relay.nos.social as fallback; this is NOT yet described on the About page; the About page must be updated before this feature is extended (for example a retention statement) or if the owner decides to disclose it.

## Rule: update the page when any of these change

Edit `About.tsx`, bump `LAST_UPDATED`, and fix the matching row below:

- **Provider backups or snapshots.** Hetzner Backups are planned: the page must then say the provider keeps copies of the
  whole server disk, not encrypted, and for how long (today it says the provider makes none).
- **Log fields or retention** (nginx `log_format combined_host`, logrotate, fail2ban).
- **The DB backup script or its retention** (`scripts/backup-db.sh`, cron `0 */6`).
- **The relay write policy** (`deploy/strfry/writePolicy.sh`, `strfry.conf`).
- **Notification storage or retention** (`notification_subscriptions`, `pruneOldNotificationSubscriptions`).
- **Anything that makes a new request from the browser** (`docs/claude/third-party-requests.md`) or new browser storage.
- **The server location** — `PROBE_LOCATION` in `src/constants/probeLocation.ts` (the page uses the constant).
- **Reviewer profiles stored on the server** (`nostr_profiles`, `backend/src/profilesSync.ts`): the server also stores the public profile name, display name and NIP-05 address of review authors (`nostr_profiles` table), fetched from profiles.nostr1.com with relay.nos.social as fallback; this is NOT yet described on the About page; the About page must be updated before this feature is extended (for example a retention statement) or if the owner decides to disclose it.
- Score weights / the 30-day cap / probe cadence (`reliabilityScore.ts`, `auditScore.ts`, `cron.ts`, `prober.ts`).

## Claim → source

| Claim on the page | Source | Status |
|---|---|---|
| Score = uptime 40, audit 25, NUTs 15, version 15, contact 5; capped at 75 under 30 days | `src/utils/reliabilityScore.ts` (`uptimeComponent`, `nutComponent`, `versionComponent`, `contactComponent`, `NEW_MINT_RELIABILITY_CAP`=75, `NEW_MINT_MAX_DAYS`=30, `computeReliabilityScore`), `auditScore.ts` (0–25) | confirmed; "younger" reworded to "first saw less than 30 days ago" (it is `discovered_at`) |
| Probe every 5 min asks `/v1/info` **and keysets** | `backend/src/cron.ts:54` (`*/5`), `prober.ts` `probeMintToDb` fetches `/v1/info` only | **adjusted**: every 5 min `/v1/info`; once a day (`cron.ts` `15 4 * * *`, `revalidateMints`) also `/v1/keys` (`prober.ts:281`). `/v1/keysets` is only used by the on-demand probe (`index.ts:218`) |
| Latency measured from the server; audit data from third-party services (audit.8333.space and cashu.info, since 2026-10-04; cashu.info is the same service that was audit.cashu.cz, moved 2026-10-07), "when it is out of date we say so" | `docs/claude/third-party-requests.md` (backend → audit.8333.space, backend → cashu.info: feeds every 10 min plus a per-mint detail every 30 min, about 130 requests/h, none triggered by visitors; public technical data about mints, no personal data; mint hosts' public IPv4 is resolved by our own backend); `MintDetail.tsx` `auditStaleNote`, Audit tab heading "(not updated recently)" (`czView.notRecent`) | confirmed |
| Firewalled mints may show offline / fail to be listed | `docs/claude/scoring-and-probing.md`, the 2026-10-03 Cloudflare challenge diagnosis (probe reports "unreachable") | confirmed (observed, not a code path) |
| No mint pays, no ads/affiliates | owner decision | as given |
| Repo URL, MIT | `README.md`, `LICENSE` | confirmed |
| Contact: npub, `wildcitizen7@mintradar.org`, GitHub private vulnerability reporting | `SECURITY.md` lines 7–10 | confirmed |
| No cookies | grep `document.cookie`, `Set-Cookie`, `res.cookie`, cookie libs in `src`, `backend/src`, `deploy/nginx.conf`: none (hits only in tests) | confirmed |
| No analytics/ads/third-party scripts or fonts | CSP `default-src 'self'; script-src 'self'` (`deploy/nginx.conf`), `index.html` has no foreign `src`/`href`, fonts self-hosted (`public/fonts`) | confirmed |
| Log fields | `/etc/nginx/nginx.conf` on the server: `log_format combined_host '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" "$host"'` (not in the repo) | confirmed; `$request` includes the query string, `$host` added to the text |
| Logs kept ~14 days | `/etc/logrotate.d/nginx`: `daily`, `rotate 14` | confirmed |
| fail2ban keeps records 1 day, temporary bans | `/etc/fail2ban/fail2ban.conf` `dbpurgeage = 1d`; jails `bantime = 1h` with increment | confirmed |
| App logs contain a shortened pubkey (8 chars) on notification subscribe/unsubscribe, rejected relay lists and failed sends; capped at 3 × 10 MB, then overwritten | `backend/src/index.ts` (`[notifications/subscribe]`, `[notifications/unsubscribe]`, `validateRelays` log context), `nostrService.ts` (`[notify] send error`, `failed to release claim`) with `.slice(0, 8)`; `docker-compose.yml` backend `json-file` `max-size: 10m`, `max-file: 3` | confirmed; wording widened from "switches off" to "on or off, or when sending fails" (the code logs all of these) |
| Notifications store pubkey, mint, relays, flags, timestamp | `backend/src/db.ts:51` (`notification_subscriptions`: pubkey, mint_url, notify_on_down, notify_on_up, relays, updated_at) | confirmed |
| Deleted: both flags off, mint removed, ~30 days after last update; logout does not cancel | `notificationSubscription.ts` (`setNotifyFlag` both off → unsubscribe, `cancelSubscription`), `removeWatchedMint.ts`, `db.ts:277` (`pruneOldNotificationSubscriptions`, 30 days), `useWatchlistSync.ts:132` (login refresh resets the clock); no unsubscribe on logout | confirmed; "unused" reworded to "after its last update (login refreshes it)" |
| Reviews kept as copies, never deleted automatically | `mint_reviews` columns url, pubkey, event_id, rating, comment, created_at (`db.ts:64`); no `DELETE FROM mint_reviews` anywhere, but `ON DELETE CASCADE` from `mints` | **adjusted** to "not deleted on a schedule" (copies go only if the mint itself is reaped, `prober.ts:219/233/334`) |
| "We do not verify reviewers or what they claim. Reviews written by a mint's own operator (a key listed in its contact that also announced the mint on Nostr) are labelled and not counted." | `backend/src/shared/operatorPubkeys.ts` + `reviewsSync.ts` `aggregateReviews()` (aggregates), `MintDetail.tsx` ("Operator" badge, tile), `docs/claude/reviews-and-nostr.md` "Operator reviews are labelled and not counted"; NIP-05 contacts are not resolved; rule = contact key AND announcement (kind 38172) author must agree (`operatorPubkeys` intersection), threat and the newest-author-only limit in reviews-and-nostr.md | confirmed 2026-10-05 (wording changed with the stricter rule) |
| Rules bullet: "Reviews are the unverified opinions of their authors. We do not endorse them and may stop displaying unlawful or abusive content, including mint names." | the mint-name hidden list: `backend/src/data/hiddenMintNames.json` + `backend/src/mintNames.ts`, `docs/claude/card-and-mint-detail-ui.md` "Mint names: cleaning and the hidden list" | confirmed 2026-10-05 |
| Submitting a mint stores only its address | `mints` table: url, name, discovered_at, is_known (+ probe data); the per-IP rate limiter is in memory | confirmed |
| Hosting: Hetzner Cloud, Nuremberg, disk not encrypted, backup 6 h on the same server, ~8 days, not encrypted, no provider backups | owner + server inspection 2026-10-04 (`lsblk`: plain ext4, no crypt; metadata `nbg1-dc3`; `scripts/backup-db.sh` `find -mtime +7`, cron `0 */6`) | as given / confirmed |
| Browser storage | Dexie `src/db/index.ts` (mints, mintHistory, watchlist, meta); `localStorage`: `mintradar-card-view`, `mintRadar_viewMode`, icon-failure cache; `sessionStorage`: `mintradar_session` (profile, method, nip65Relays — `auth.store.ts` partialize), bunker keys, chunk-reload timestamp; nsec in memory only | **adjusted** from the draft: added IndexedDB cache and localStorage items |
| What the browser contacts | `docs/claude/third-party-requests.md` | confirmed; "6 relays on a mint page" reworded to "a few" (6 review relays + profile relays) |
| Relay: public, MintRadar keys any kind, others 38172/38000, 64 KiB, no retention | `deploy/strfry/writePolicy.sh`, `strfry.conf` (`maxEventSize = 65536`, no retention section) | confirmed |
| Reviewer profiles: the server stores name, display name and NIP-05 of review authors, from profiles.nostr1.com (fallback relay.nos.social) | `backend/src/profilesSync.ts` (`PROFILE_PRIMARY_RELAY`, `PROFILE_FALLBACK_RELAY`), `db.ts` `nostr_profiles` (pubkey, name, display_name, nip05, event_created_at, fetched_at, found); rows of authors that are no longer review authors or mint contact/announcement keys are deleted after 30 days; shown via `authorName`/`authorNip05` of `GET /api/mints/nostr-reviews` | **NOT on the page** (see Known gaps) |

## Not on the page, worth knowing

- The sitemap is generated by the backend (`SITEMAP_STATIC_PATHS`, `backend/src/index.ts`); `/about` was added to it (monthly, 0.5).
  A new static route must be added there too.
