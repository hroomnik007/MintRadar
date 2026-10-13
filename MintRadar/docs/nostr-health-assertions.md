# Mint Health Assertions on Nostr (early version)

`early version` `optional`

**Status: live since 2026-10-13 (first publication 17:48 UTC), early version.** MintRadar publishes these events now. The `mint_*` tags are MintRadar's own tags (see below), and the format may change before it is frozen. Changes are announced in this document and on [mintradar.org/for-wallets](https://mintradar.org/for-wallets#signed-health-assertions), and every event carries the `methodology` integer.

## Abstract

A provider publishes one signed, addressable event per Cashu mint with a small set of *operational health* facts about that mint: whether it answered its recent probes, its uptime, whether its software is behind, and a 0 to 100 rank. A wallet that pins the provider's public key can verify the signature and read the signal without calling the provider's website. The signal is **not** solvency, not a statement about custody or the mint operator's honesty, and **not a recommendation to deposit funds**. It is computed from the provider's probes and third-party audit data and can be wrong or out of date.

This is an application of kind `30385` of [NIP-85](https://github.com/nostr-protocol/nips/blob/master/85.md) (external identifier as subject, NIP-73 `web` identifiers). NIP-85 defines the `rank` tag for this kind (integer, normalised 0 to 100) and leaves other result tags to be "agreed upon by providers and clients"; the `mint_*` tags below are that agreement for mint health. The `expiration` tag is [NIP-40](https://github.com/nostr-protocol/nips/blob/master/40.md).

## Event format

```json
{
  "id": "<64 hex, sha256 of the serialised event>",
  "pubkey": "2ddd7ce9833d2ed8a0bfaaf903cc71f65641f20d8f8142130163a625aa6b941c",
  "created_at": 1792152000,
  "kind": 30385,
  "tags": [
    ["d", "https://mint.example.com"],
    ["k", "web"],
    ["rank", "87"],
    ["mint_status", "online"],
    ["mint_uptime_24h", "100"],
    ["mint_uptime_7d", "99"],
    ["mint_software", "Nutshell/0.17.5"],
    ["mint_outdated", "0"],
    ["mint_audit_swaps_7d", "120"],
    ["mint_audit_attributed_7d", "1"],
    ["mint_audit_at", "1792148400"],
    ["mint_test", "0"],
    ["mint_new_capped", "0"],
    ["mint_checked_at", "1792151880"],
    ["methodology", "3"],
    ["methodology_url", "https://mintradar.org/methodology"],
    ["expiration", "1792324800"]
  ],
  "content": "Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar's probes and third-party audit data; it can be wrong or out of date.",
  "sig": "<128 hex, schnorr signature>"
}
```

`id` and `sig` are placeholders. The values are an example, not a real mint.

## Tags

| Tag | Value | Meaning |
|---|---|---|
| `d` | the mint URL, normalised | https, lower-case host, no default port, no trailing slash on a bare host, **no fragment** (NIP-73: URL, normalised, no fragment) |
| `k` | `web` | NIP-73 type of the `d` value |
| `rank` | integer 0 to 100 | the provider's Reliability Score for the mint (the method is at `methodology_url`) |
| `mint_status` | `online` \| `offline` \| `degraded` | state at the last probe; `degraded` = offline for longer (no successful probe in the last 24 hours) |
| `mint_uptime_24h`, `mint_uptime_7d` | integer 0 to 100 | percentage of successful probes in the window; omitted when unknown |
| `mint_software` | text, `^[A-Za-z0-9._+/ -]{1,64}$` | the version string the mint reports about itself (mint-controlled; omitted when it does not match). Display it as plain text only |
| `mint_outdated` | `0` \| `1` | the software is two or more minor versions behind the newest stable release of its family; omitted when the provider cannot decide |
| `mint_audit_swaps_7d`, `mint_audit_attributed_7d`, `mint_audit_at` | integer, integer, UNIX seconds | swaps and failures attributed to the mint in a 7 day third-party audit window, and when that data was fetched. Present only if the audit data is at most 168 hours old |
| `mint_test` | `0` \| `1` | `1` for a known test mint |
| `mint_new_capped` | `0` \| `1` | `1` while the provider's cap for mints younger than 30 days limits the rank to 75 |
| `mint_checked_at` | UNIX seconds | time of the last probe |
| `methodology` | integer | version of the provider's scoring method; ranks of different versions are not comparable |
| `methodology_url` | URL | where that method is described |
| `expiration` | UNIX seconds | NIP-40: `created_at` + 172800 (48 hours) |

`content` is the fixed sentence in the example. Reviews, review counts, mint names, IP addresses, network data, onion addresses, public keys of other people, contact details and error texts are never part of the event. Unknown tag names must be ignored by clients.

## Update rules

Per mint the provider publishes at most one new event per 6 hours, and only if the rank changed by at least 2 points, or `mint_status` changed, or `methodology` changed, or the previous event is 24 hours old (so the 48 hour expiration never lapses). A mint without a score, or an archived mint, gets no new event; its last event expires after 48 hours. An offline mint is published with `mint_status` `offline`. Events go to `wss://nostr.mintradar.org`, `wss://relay.damus.io`, `wss://nos.lol` and `wss://relay.primal.net`.

## Pinning the provider

Pin the public key, not the website:

- hex: `2ddd7ce9833d2ed8a0bfaaf903cc71f65641f20d8f8142130163a625aa6b941c`
- npub: `npub19hwhe6vr85hd3g9l4tus8nr37etyrusd37q5yycpvwnzt2ntjswqjaru7p`
- NIP-05: `health@mintradar.org` (`https://mintradar.org/.well-known/nostr.json?name=health`)

Compare the three once when you integrate, store the hex in your app and accept events only from that key. A change of key will be announced in this document and in the NIP-05 file; treat an unannounced change as a warning.

## Verification steps

For each mint, query the relays with `{ "kinds": [30385], "authors": ["<pinned hex>"], "#d": ["<normalised mint URL>"], "limit": 5 }` and, per event:

1. The signature and the id are valid (`verifyEvent` in nostr-tools).
2. `pubkey` equals the pinned key.
3. `kind` is 30385, `k` is `web`, and `d` equals *your own* normalisation of the mint URL you are asking about (never trust the `d` of an event as the identity of a different mint).
4. `expiration` is present and in the future; ignore the event otherwise. Do not treat an expired or missing event as "bad": it means *no current signal*.
5. `created_at` is not in the future (allow a few minutes of clock skew).
6. Of the events that pass, use the one with the newest `created_at` (the event is addressable; relays may still return older versions).
7. Look at `methodology`: ranks are comparable only within one version. Read `methodology_url` before mixing versions.

A runnable example with the normalisation function is in `docs/examples/verify-health.mjs` (nostr-tools only; the same code is shown on [mintradar.org/for-wallets](https://mintradar.org/for-wallets#signed-health-assertions)). It reads each relay on its own with a plain WebSocket, skips a relay that is unreachable and prints which relays answered. Runs in browsers and in Node 22 or newer; on older Node pass the ws package's WebSocket class as the webSocket option.

## Security considerations

- **Stolen or misused key.** Whoever holds the key can sign false assertions. The 48 hour expiration limits how long a bad event lives; the provider will announce a new key here and in the NIP-05 file. Wallets that pin the key must update it by a release or a signed configuration, not by trusting a relay.
- **Replay.** An old valid event can be re-sent by anyone. Check `expiration` and prefer the newest `created_at`; an event older than 48 hours is not current.
- **Impersonation.** Anyone can publish a kind 30385 event for any `d`. Only the pinned `pubkey` counts. Do not accept a key from the event itself or from a relay hint.
- **Stale data.** The signal is as old as `mint_checked_at`, and a mint that goes down between two events keeps its old `online` status for up to 6 hours (less when its status changed). Show the age, and fall back to your own checks for anything that must be current.
- **Mint-controlled text.** Only `mint_software` comes from the mint. It is restricted to a short character set but it is still text chosen by the mint operator: render it as plain text, never as a link or markup.
- **Not solvency.** The event says nothing about reserves, custody, the operator's honesty or whether a deposit can be withdrawn. A high `rank` is not a reason to deposit more than you can afford to lose.

## Disclaimer

Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar's probes and third-party audit data; it can be wrong or out of date.
