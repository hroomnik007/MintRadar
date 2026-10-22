# MintRadar — Signed mint health assertions (Nostr kind 30385), 2026-10-14

**Status: LIVE since 2026-10-13 (first publication 17:48:27 UTC).** The owner put `ATTESTATION_SERVICE_NSEC` into the server's `backend/.env`, the key was added to the own relay's allow-list (backup `/opt/mintradar-strfry/privileged-pubkeys.txt.bak-20261013-174222`) and the backend was recreated. The first run published **61 events** (every mint with a stored score, not archived: 50 `online`, 11 `degraded` in `attestation_state`); the kind 0 profile went to 10 of 10 relays. Accepted by: `wss://nostr.mintradar.org` 61/61, `wss://nos.lol` 61/61, `wss://relay.primal.net` 61/61, `wss://relay.damus.io` only 5 (3 failures in a row, then skipped for the rest of that run; the log keeps counts only, not the relay's reason). **Internal note (not on the public pages):** relay.damus.io rate limited the first run (5 of 61); it is expected to catch up through the daily refresh. The second tick published nothing. Without the key the code is still dormant (see "The dormant switch"). **Announced publicly since 2026-10-13:** `/for-wallets` has the section "Signed health assertions on Nostr (early version)" (id `signed-health-assertions`, after the API sections, before Suggested UX), `/methodology` a short section "Where the score is published", the root README and `docs/API.md` a pointer; the public pages name three relays (nostr.mintradar.org, nos.lol, relay.primal.net) and never relay.damus.io (owner decision); the shared facts are `backend/src/shared/healthAssertionConstants.ts` (+ identical `src/utils/` copy), see `methodology-and-wallet-pages.md`. The specification for wallet developers is `docs/nostr-health-assertions.md` (status: live, early version), the verification example is `docs/examples/verify-health.mjs` (run against the live relays on 2026-10-13: `https://mint.lnpay.cz` rank 100, `https://mint.minibits.cash/Bitcoin` rank 98, both equal to `/api/v1/wallets/mints/<url>`).

**2026-10-20 (W3a):** a status change is published at the next run (no 6 h wait; per-mint 5 min gap, 30 state-change events per rolling hour, deferred never dropped) and seven additive tags exist (`mint_probes_24h`, `mint_down_since`, five keyset tags). Existing tags, the score formula and `METHODOLOGY_VERSION` are untouched. Details below ("The event", "Constants", "Decision rule and state").

## What it is

The backend signs one **kind 30385** event per tracked mint (NIP-85 "NIP-73 identifier as subject": `d` = the mint URL, `k` = `web`, `rank` = the Reliability Score) and publishes it to five relays (the public pages deliberately list only the three that are known to hold every event, `ATTESTATION_RELAYS_PUBLIC`). A wallet that pins the MintRadar Health public key can verify the signature and read an *operational health* signal without calling mintradar.org. It is not solvency and not advice; the event content says so.

- Identity: the public key `ATTESTATION_PUBKEY_HEX` (`backend/src/healthAssertions.ts`) = npub `npub19hwhe6vr85hd3g9l4tus8nr37etyrusd37q5yycpvwnzt2ntjswqjaru7p`, NIP-05 `health@mintradar.org` (`public/.well-known/nostr.json`, name `health`, relay hint `wss://nostr.mintradar.org`). The private key exists only in the owner's file and, once activated, in the server's `backend/.env` as `ATTESTATION_SERVICE_NSEC`. Separate from `NOTIFICATION_SERVICE_NSEC`, which is never used for assertions.
- Profile (kind 0): name and display name `MintRadar Health`, about `Operational health signals for Cashu mints, computed by MintRadar. Not solvency, not advice. Method: https://mintradar.org/methodology`, website `https://mintradar.org`, nip05 `health@mintradar.org`, picture `https://mintradar.org/icons/icon-512x512.png` (`ATTESTATION_PROFILE_PICTURE_URL`: the site's own 512 px app icon, a static PNG; no banner, no third-party host, no data URI). Published at start and once a day (checked on the 15-minute tick) to the own relay and `META_RELAYS` of `nostrService.ts` (the service-profile relays), through the existing `publishToRelays` helper.

## Files

| File | Role |
|---|---|
| `backend/src/healthAssertions.ts` | Pure: constants, `buildHealthEvent`, `healthIdentifier`, `sanitizeSoftware`, `shouldPublish`, `buildProfileTemplate`, `resolveAttestationKey` |
| `backend/src/healthPublisher.ts` | Impure: `planCycle`, `publishBatch`, `runAttestationCycle`, the 15-minute timer, state table access, `startAttestations` (the dormant switch) |
| `backend/src/db.ts` | `attestation_state` table, `CREATE TABLE IF NOT EXISTS` in the migrations array |
| `backend/src/index.ts` | one call: `startAttestations({ loadSnapshot: loadKnownMints, isAllowlistMode })` after `startCron()` |
| `backend/src/nostrService.ts` | exports `META_RELAYS` and `publishToRelays` (the existing helper and the DNS-pinned WebSocket installation) |
| `deploy/strfry/privileged-pubkeys.txt` | the hex key, so the own relay accepts its events (repository copy only; the server apply is a separate gated step) |

Tests: `healthAssertionConstants.test.ts` (tag list = what the builder emits), `verifyHealthSnippet.test.ts` (the example `docs/examples/verify-health.mjs`, which equals the text on /for-wallets byte for byte, is run against builder events and local stub relays that refuse, close, stall, hang, answer with an HTTP error or CLOSED; plus a child-process run), `healthAssertions.test.ts`, `healthPublisher.test.ts`, `healthRelays.test.ts` (local stub WebSocket relays), `dbAttestationStateMigration.test.ts`, `healthStaticFiles.test.ts` (NIP-05 file, relay list, docs agree on the key), `verifyHealthExample.test.ts`.

## The event (v1, tag names are fixed)

Tags, in this order: `d` (normalised mint URL, fragment dropped), `k` = `web`, `rank` (integer 0 to 100, the stored Reliability Score, rounded and clamped), `mint_status` (`online` | `offline` | `degraded`), `mint_uptime_24h`, `mint_uptime_7d` (integers), `mint_software` (see below), `mint_outdated` (`0` | `1`), `mint_audit_swaps_7d`, `mint_audit_attributed_7d`, `mint_audit_at` (UNIX seconds; these three only when the audit data is at most 168 hours old), `mint_test` (`0` | `1`), `mint_new_capped` (`0` | `1`: the 75 cap for mints younger than 30 days applies), `mint_checked_at` (UNIX seconds of the last probe), then the tags added 2026-10-20 (all omitted when unknown, see below), `methodology` (`METHODOLOGY_VERSION`), `methodology_url` (`https://mintradar.org/methodology`), `expiration` (NIP-40: `created_at` + 172800). Content: `Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar's probes and third-party audit data; it can be wrong or out of date.`

- **Tags added 2026-10-20**, between `mint_checked_at` and `methodology` (they come from the wallet API's own sources: `planCycle` passes `Snapshot.walletExtra` to `toWalletMint`, so the values equal `sample.probes24h`, `downSince`, `keysets` and `keysetsCheckedAt` of `/api/v1/wallets`): `mint_probes_24h` (integer, `mint_history` rows of the last 24 h); `mint_down_since` (UNIX seconds, only while the status is not `online`; the wallet API's `downSince` is the same moment as ISO); `mint_keysets_verified` (active keysets with `id_valid` true), `mint_keysets_legacy` (active keysets with `id_version` legacy), `mint_keysets_id_invalid` (active keysets with `id_valid` false, a confirmed mismatch only), `mint_keyset_final_expiry` (earliest `final_expiry` of the active keysets, UNIX seconds, only if one exists), `mint_keysets_checked_at` (UNIX seconds). **The four keyset tags and `_checked_at` are omitted together when the mint was never checked** (`keysetsCheckedAt` null); the counts are over ACTIVE keysets only so they partition them (the task text said "keysets with legacy format" without "active"; active-only was chosen for consistency, change in `keysetTags()` if the owner meant all). No "low sample" tag by decision (sample size is visible in `mint_audit_swaps_7d` and `mint_probes_24h`). A signed event is about 1.0 to 1.2 kB (strfry `maxEventSize` is 65536). **`mint_last_change` (2026-10-20, mint change log):** UNIX seconds of the newest confirmed change of the mint (`changes[0].observedAt` of the wallet API), present only when at least one exists, emitted by `buildHealthEvent` right after the keyset tags and before `methodology` (input `HealthInput.lastChangeAt`, filled by `inputFromWalletMint` from `WalletMint.changes[0]`). It is NOT a publish reason: `publishReason()`/`shouldPublish()` read only rank, status and methodology, so a new change appears in the next event published for any existing reason (`healthPublisher.test.ts`: "a recorded change never causes a publication"). A full event (all tags, a long host) measured 1213 bytes without and 1247 with it. In `HEALTH_ASSERTION_TAGS` (both byte-identical copies) and the table of `docs/nostr-health-assertions.md`. Describe `mint_*` as measurements and `rank` as the derived score per `methodology`, never as solvency or advice.
- A tag whose value is unknown is **omitted**, never guessed: no uptime yet, `mint_outdated` when the version rule cannot decide (unknown software, missing or unreadable version), `mint_checked_at` without a probe, `mint_software` when it fails the pattern.
- `mint_software` is the only mint-controlled text. It is trimmed and must match `^[A-Za-z0-9._+/ -]{1,64}$`, otherwise the tag is omitted. The pattern is a character class, not a meaning check: a plain-letter string such as an ordinary sentence or a host name up to 64 characters passes. That is the owner's decision (do not reopen); keep it in mind before widening what a wallet shows from this tag.
- **Not in the event:** reviews or review counts, mint names, IP addresses, network data, onion addresses, pubkeys of anyone, contact details, error texts. The builder also returns no event for a mint whose URL host is a `.onion` name or an IP literal.
- **Which mints:** a non-null stored score and not archived. Offline mints are published (`mint_status` `offline`), test mints with `mint_test` `1`. A mint whose score becomes null or that is archived gets no new event; its old one expires after 48 hours.
- **A new alert-like or API field must not be added to the event without updating the spec (`docs/nostr-health-assertions.md`) first.** Tag names are a v1 contract with wallets.
- **2026-10-21 (methodology 4):** every event now carries `methodology` 4. A bump is a `periodic` reason in `publishReason`, NOT a `state-change`, so the 30 an hour state-change cap does not apply to it; the 6 hour minimum since each mint's last event and the 200 per run cap do (`healthPublisher.test.ts`: "a methodology bump republishes every mint …"). The cap was not changed.
- **A methodology bump refreshes all assertions:** `shouldPublish` treats a changed `methodology` as a reason to publish, so every mint gets a new event on the next runs (paced by the 6 hour minimum and the 200 per run cap). Bumping `METHODOLOGY_VERSION` needs nothing else for the assertions.

## Constants

| Constant | Value | Where |
|---|---|---|
| `ATTESTATION_MIN_INTERVAL_MS` | 6 h | per mint, at most one new event (not for a status change, see below) |
| `ATTESTATION_STATE_CHANGE_MIN_GAP_MS` | 5 min | least time between a mint's previous event and a state-change event for it (flapping) |
| `ATTESTATION_STATE_CHANGE_MAX_PER_HOUR` | 30 | state-change events per rolling hour over all mints (in-memory log in `healthPublisher.ts`, a restart can allow one extra cap's worth); arithmetic: 61 eligible mints, periodic refresh about 61/24 = 2.5 events an hour, so 30 is about half the fleet an hour and 30 x 5 relays = 150 relay writes an hour |
| `ATTESTATION_MIN_RANK_DELTA` | 2 | rank change that justifies a new event |
| `ATTESTATION_REFRESH_MS` | 24 h | daily hard refresh, so the 48 h expiration never lapses |
| `ATTESTATION_EXPIRY_S` | 172800 | NIP-40 expiration after `created_at` |
| `ATTESTATION_MAX_EVENTS_PER_RUN` | 200 | never-published mints first, then the oldest; the rest waits for the next run |
| `ATTESTATION_AUDIT_MAX_AGE_MS` | 168 h | audit tags are left out when older |
| `ATTESTATION_RELAYS` | `wss://nostr.mintradar.org`, `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net`, `wss://nostr.mom` | the only connections the assertion publisher opens |
| `ATTESTATION_RELAY_PAUSE_MS` / `_TIMEOUT_MS` / `_MAX_FAILURES` | 200 ms / 5 s / 3 | between events per relay / per event and relay / consecutive failures before a relay is skipped for the rest of the run |
| `ATTESTATION_TICK_MS` + jitter | 15 min + up to 60 s, first tick 90 s after start | own timer, single-flight (a tick that finds the previous run still going is skipped) |

## Decision rule and state

`publishReason(prev, next, now)` (2026-10-20) returns `first`, `periodic`, `state-change` or null. `periodic` is exactly `shouldPublish` below. `state-change`: not periodic, `mint_status` differs from `last_status` and the last event is at least 5 minutes old. Only `state-change` is capped (`planCycle` takes a `stateChangeBudget` = cap minus the state-change events planned in the last hour; the surplus counts as `deferred`, nothing is stored for it so it is still a status change at the next run). State changes go first in a run, then the old order. The cap counts events when they are planned, not when a relay accepted them, so a refusing relay cannot cause unlimited retries. A mint whose last event is already 6 h old uses the periodic path and is not capped.

**Vantage outages:** `runProbeCycle` drops held-back failures without writing `mint_history` or `mints` (see `scoring-and-probing.md`), so the snapshot the publisher reads is the previous one and no state-change event appears (pinned in `healthPublisher.test.ts`, "vantage outage interaction").

`shouldPublish(prev, next, now)`: a never-published mint publishes immediately (the 6 hour interval is ignored for it, so an event no relay accepted is retried on the next tick). Otherwise nothing inside 6 hours since the last event (a status change inside the 6 hours goes through `publishReason`, above); after that a new event when `|rank - last_rank| >= 2`, or the status changed, or the methodology changed, or the last event is 24 hours old.

`attestation_state (mint_url TEXT PRIMARY KEY, last_event_id TEXT, last_created_at BIGINT, last_rank INTEGER, last_status TEXT, last_methodology INTEGER)`: written only after **at least one relay accepted** the event, so it survives restarts (a restart never republishes everything) and an event rejected by every relay leaves no row. The table stays empty while the feature is off. Rows of mints that stopped being eligible are left alone (harmless; the daily rule applies if the mint returns).

One tick = the shared known-mints snapshot (`loadKnownMints()`, the same single database read cached for 60 s that serves `/api/mints/known` and the wallet API, so the values equal what `/api/v1` shows) + one read of `attestation_state`. It never probes a mint and never reads reviews.

Relay failures are normal. Right after the deploy of the allow-list change but before the server apply, `wss://nostr.mintradar.org` rejects the key (`blocked:`): it is skipped after 3 failures per run and the other relays carry the event. Logs hold counts only (`[attestations] run: N eligible, M due (K deferred), A accepted by at least one relay; <relay> ok=.. failed=.. skipped=..`), never event ids or mint URLs.

## The dormant switch (key handling)

`startAttestations()` reads `ATTESTATION_SERVICE_NSEC` once at start:

| State | Result |
|---|---|
| unset, empty or blank | disabled; ONE info line `[attestations] disabled: no signing key is configured`; no timer, no network, no database access |
| set but not a valid nsec | disabled; ONE error line `... the configured signing key is not a valid nsec` |
| valid nsec of another identity (public key differs from `ATTESTATION_PUBKEY_HEX`) | disabled; ONE error line `... does not match the attestation public key`; the secret bytes are zeroed |
| valid and matching | enabled; profile published, timer started |
| allowlist mode (`MINT_ALLOWLIST`) | disabled even with a key; no relay traffic in that mode |

The key is never logged, never part of an error message (the decode error is dropped), never stored in the database and never returned by any endpoint. Tests capture all console output and prove no part of the key or its hex appears.

## Activation (done 2026-10-13) and rollback

The steps below were performed on 2026-10-13 (owner: key; gated server task: the rest). They are kept as the repeatable procedure (new server, key rotation).

1. **(a) Key.** The owner puts `ATTESTATION_SERVICE_NSEC=<nsec>` into the server's `backend/.env` (never in the repository, never in a chat). It must be the private key of the npub above, or the feature stays off with an error line.
2. **(b) Relay allow-list.** Install the repository's `deploy/strfry/privileged-pubkeys.txt` into the strfry install directory on the server (`/opt/mintradar-strfry`, where the compose file bind-mounts it; `ls -l` first to confirm the path and keep the existing lines) and reload the relay so `writePolicy.sh` re-reads the file (it reads the list once at startup): restart the strfry container. Check that the file holds the hex exactly once.
3. **(c) Backend.** Recreate the backend so it reads the new `.env`: `docker compose up -d backend` from `$VPS_REPO_PATH/MintRadar` (a plain `docker compose restart` would not pick up a changed `env_file`).
4. **(d) Read-only checks.**
   - Log: `docker compose logs --since 15m backend | grep '\[attestations\]'` — expect `enabled`, the `published kind:0 profile` line, then a `run:` line about 90 to 150 seconds after start (and one every 15 minutes).
   - Database: `docker compose exec -T postgres psql -U mintradar -d mintradar -c "SELECT count(*), max(last_created_at) FROM attestation_state"`.
   - Relay: `nak req -k 30385 -a 2ddd7ce9833d2ed8a0bfaaf903cc71f65641f20d8f8142130163a625aa6b941c -l 3 wss://nostr.mintradar.org` (and `-k 0` for the profile).
   - NIP-05: `curl -s https://mintradar.org/.well-known/nostr.json` contains `health`.

**Checking the state** — dormant (no key) logs exactly one line per backend start; live logs `enabled: signing key loaded…`, `published kind:0 profile (N succeeded, M failed)` and then a `run:` line per tick. The dormant line: `docker compose logs backend | grep '\[attestations\]'` shows exactly one line per backend start: `[attestations] disabled: no signing key is configured`.

**Live behaviour observed on 2026-10-13:** the log shows `enabled` (the code does not print the public key; a key of another identity would log `disabled … does not match`), the profile line, the first `run:` about 140 seconds after start and a `run: 61 eligible, nothing due` line every 15 minutes while nothing changes. `wss://nostr.mintradar.org` does not advertise NIP-40 (`supported_nips` 1, 9, 11, 42), so it keeps the (replaceable) events after `expiration`; the other relays may delete them.

**Rollback (run only for the part that failed):**
- Relay allow-list: `sudo cp -p /opt/mintradar-strfry/privileged-pubkeys.txt.bak-20261013-174222 /opt/mintradar-strfry/privileged-pubkeys.txt`, then `sudo docker restart mintradar-strfry`, then re-measure the event counts of kinds 38172, 38000 and 0 (before 2026-10-13: 1, 3, 1; kind 0 is 2 since the health profile exists).
- Backend (feature dormant again): `sed -i '/^ATTESTATION_SERVICE_NSEC=/d' backend/.env` in `$VPS_REPO_PATH/MintRadar` on the server, then `docker compose up -d backend`. Existing events simply expire after 48 hours (relays that honour NIP-40). Never print `.env`; `grep -c "^ATTESTATION_SERVICE_NSEC=" backend/.env` shows whether the line exists.

## Security notes

- Key handling and logs: see the table above. Only `ATTESTATION_RELAYS` are used as targets of assertions (no user, mint or database-supplied relay), through the backend's DNS-pinned WebSocket class (SSRF guard at connect time). The profile goes to the own relay and `META_RELAYS` (constants too).
- Bounded: at most 200 events per run (of which at most 30 per hour caused by status changes), 5 relays, 15-minute ticks, 200 ms pause, 5 s timeout, 3-failure skip.
- A stolen key could sign false assertions; wallets pin the key and check `created_at` and `expiration` (spec). Rotating the key means a new pubkey in `ATTESTATION_PUBKEY_HEX`, the NIP-05 file, the relay list and the docs, and telling wallets.
- Backup: `deploy/strfry/backup-own-events.sh` reads the same `privileged-pubkeys.txt`, so the new key automatically gets the base kinds (38172, 38000) only. Its kind 30385 and kind 0 events are not backed up on purpose: they expire or are re-published daily.
