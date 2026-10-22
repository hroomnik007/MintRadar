# Post-announcement backlog (written 2026-10-22, task E1)

What is planned after the public announcement. Nothing in the "By feedback only" table is started without a reason from users or wallet teams.

## Week 1 after the announcement

| Item | Detail |
|---|---|
| Wallet teams and gorrdy | Answer their questions; make small doc/API fixes from their feedback |
| Minibits courtesy note | Tell them their Nostr contact value is shown in a shortened "npub..." form |
| Monitoring | PageSpeed, `/health`, the new kind 30385 event, error logs |
| Server clean-up (after one week) | nginx backups `*.bak-*`, `/home/deploy/s1-build/`, `*.pre-s1` files, `pre-s1-data.mdb`, the strfry rollback image tag `alpine320-1.1.3-rollback` |
| About 2026-10-30 | SQL report on the relay delivery counters |

## Weeks 2-3 (small, low risk)

| Item | Detail |
|---|---|
| strfry HEALTHCHECK | Compose change, needs a server apply |
| Stale limits | Unify `KNOWN_MINTS_STALE_LIMIT` and `STATS_STALE_LIMIT` to 5 minutes (done in task E1) |
| DNS retry | One DNS retry on timeout for e-mail contact checks, no storage of contact values (done in task E1) |
| `/mint/<URL ending in .svg/.png/.js>` | Answers 404 because the static-asset regex has precedence over the `/mint/` prefix; fix it |
| Start-up order | `app.listen` before `initDb`, with a test |
| "proofs" wording | Compare "Backup" tooltip (done in task E1) |
| `h7` aggregate | `EXPLAIN (ANALYZE, BUFFERS)` on the production database for the 7-day aggregate before deciding on an index `mint_history(checked_at)` |
| brotli on nginx | About -0.1 s on `/stats`; needs the module and a server apply |
| Inline critical CSS | Render-blocking today; needs a CSP check |

## By feedback only

Do not start without a reason from users or wallet teams.

| Item | Note |
|---|---|
| Methodology v4 | For real, through a shadow phase |
| "Best mint for me" | |
| Nutzap-related items | kind 10019 adoption signal per mint, nutzap checks, Cashu-native donation (deferred by the owner) |
| Watchlist without login | |
| DM notification settings | Decided on 2026-10-02 to drop notification mute until subscribers reach dozens |
| Atomic deploy | |
| Icon resize | Needs a new dependency |
| Deferring vendor-nostr and vendor-db | |
| SSR | |
| JetBrains Mono | |
| OSV scanning | Deferred |
| Real HTTP 404 for unknown paths | Soft 404 stays; the decision record and the triggers are in `docs/claude/deploy-and-infra.md` (next to the nginx soft-404 section) |

## Fixed dates

| Date | What |
|---|---|
| 2026-10-30 | SQL report on relay delivery counters |
| About 2026-11-09 | Monthly audit score analysis |
| Monthly | Docker / NodeSource updates |
| 2027-01-01 | Year label of the 90-day trend |
| 2027-01-26 | Sunset of `/api/v1/mints/recommend` |
| First real mint change | Test the change log, the DM and the feed tag |
