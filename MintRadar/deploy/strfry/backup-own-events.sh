#!/bin/bash
# Own-event backup cron for the MintRadar backup relay (wss://nostr.mintradar.org).
#
# Pulls kind 38172 (mint announcement) / kind 38000 (review) events authored
# by MintRadar's privileged pubkeys (deploy/strfry/privileged-pubkeys.txt,
# same file writePolicy.sh reads) from the public discovery relays, and
# pushes them onto our own relay — so the own-relay has durable coverage of
# historical events too, not just new ones written after it existed.
#
# Narrower than jooray/nostr-scripts/nostr-backup.sh (the reference this was
# modeled on): single-purpose (2 fixed authors, 2 fixed kinds, one fixed
# target relay) instead of a general N-author multi-relay backup tool, and
# doesn't need that reference's slow-post.py throttling — that exists to
# avoid tripping rate limits on relays *we don't control* when pushing a
# large backlog; our push target is our own strfry instance with no
# self-imposed write rate limit, and our expected volume (whitelist-only,
# 2 kinds, 2 authors) is tiny, so one bulk `nak event` call is fine.
#
# Source relays: read live from the frontend's DISCOVERY_RELAYS
# (src/core/nostr/relays.ts) in the CI-deployed repo checkout, not a second
# hardcoded copy — see MintRadar/CLAUDE.md's existing "keep these two arrays
# in sync manually" note for why a second copy would be a real drift risk.
#
# State: last successful run's start time, persisted in STATE_FILE (outside
# the git checkout — /var/www/mintradar-repo gets `git reset --hard` on every
# deploy, see .github/workflows/deploy.yml, which would otherwise nuke an
# in-repo state file the moment someone added `git clean` to that flow).
# First run: STATE_FILE doesn't exist yet, so SINCE=0 (full history).
#
# Idempotent: re-pushing an event strfry already has is a no-op OK from the
# relay (LMDB is keyed by event id) — no client-side pre-check needed.
#
# Exit behavior: a single source relay being briefly down is tolerated (best
# effort across the whole relay list, matching how the rest of the app races
# multiple relays); STATE_FILE only advances if the run had at least one
# successful pull AND (no new events, or the push to our own relay
# succeeded) — so a genuine failure retries the same window next run instead
# of silently losing it.

set -uo pipefail

TARGET_RELAY="wss://nostr.mintradar.org"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIVILEGED_PUBKEYS_FILE="$SCRIPT_DIR/privileged-pubkeys.txt"
RELAYS_TS_FILE="/var/www/mintradar-repo/MintRadar/src/core/nostr/relays.ts"
STATE_DIR="/opt/mintradar-strfry/backup-state"
STATE_FILE="$STATE_DIR/last-sync-unix"

mkdir -p "$STATE_DIR"

if [ ! -f "$PRIVILEGED_PUBKEYS_FILE" ]; then
  echo "[backup-own-events] FATAL: $PRIVILEGED_PUBKEYS_FILE not found" >&2
  exit 1
fi
if [ ! -f "$RELAYS_TS_FILE" ]; then
  echo "[backup-own-events] FATAL: $RELAYS_TS_FILE not found (repo not deployed at expected path?)" >&2
  exit 1
fi
if ! command -v nak >/dev/null 2>&1; then
  echo "[backup-own-events] FATAL: nak not found on PATH" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "[backup-own-events] FATAL: jq not found on PATH" >&2
  exit 1
fi

mapfile -t AUTHORS < <(grep -vE '^\s*(#|$)' "$PRIVILEGED_PUBKEYS_FILE")
if [ "${#AUTHORS[@]}" -eq 0 ]; then
  echo "[backup-own-events] FATAL: no privileged pubkeys found in $PRIVILEGED_PUBKEYS_FILE" >&2
  exit 1
fi

# Extract DISCOVERY_RELAYS' wss:// entries straight from the live TS source
# (the array is one relay literal per line, closing `]` alone on its own
# line — see relays.ts) instead of maintaining a second hardcoded list here.
mapfile -t SOURCE_RELAYS < <(
  awk '/^export const DISCOVERY_RELAYS/,/^\]/' "$RELAYS_TS_FILE" | grep -oE "wss://[^'\"]+"
)
if [ "${#SOURCE_RELAYS[@]}" -eq 0 ]; then
  echo "[backup-own-events] FATAL: extracted zero relays from $RELAYS_TS_FILE — DISCOVERY_RELAYS format changed?" >&2
  exit 1
fi

if [ -f "$STATE_FILE" ]; then
  SINCE=$(cat "$STATE_FILE")
else
  SINCE=0
fi

RUN_START=$(date +%s)
WORK_FILE=$(mktemp)
trap 'rm -f "$WORK_FILE"' EXIT

echo "[backup-own-events] $(date -Is) starting — since=$SINCE, ${#AUTHORS[@]} author(s), ${#SOURCE_RELAYS[@]} source relay(s)"

pull_ok_count=0
pull_attempt_count=0
for author in "${AUTHORS[@]}"; do
  for relay in "${SOURCE_RELAYS[@]}"; do
    pull_attempt_count=$((pull_attempt_count + 1))
    if out=$(nak req --author "$author" --kind 38172 --kind 38000 --since "$SINCE" "$relay" 2>/dev/null); then
      pull_ok_count=$((pull_ok_count + 1))
      # nak prints one JSON event per line to stdout; a relay with nothing
      # new prints no lines, which is a legitimate steady-state result.
      if [ -n "$out" ]; then
        printf '%s\n' "$out" >> "$WORK_FILE"
      fi
    else
      echo "[backup-own-events] WARN: pull failed for author ${author:0:8}… from $relay (continuing)" >&2
    fi
  done
done

if [ "$pull_ok_count" -eq 0 ]; then
  echo "[backup-own-events] FATAL: all $pull_attempt_count pull attempts failed — not advancing state, will retry same window next run" >&2
  exit 1
fi
echo "[backup-own-events] pulled from $pull_ok_count/$pull_attempt_count relay×author combinations"

if [ ! -s "$WORK_FILE" ]; then
  echo "[backup-own-events] no new events found — nothing to push"
else
  DEDUP_FILE=$(mktemp)
  PUSH_LOG=$(mktemp)
  trap 'rm -f "$WORK_FILE" "$DEDUP_FILE" "$PUSH_LOG"' EXIT
  jq -c -s 'unique_by(.id) | .[]' "$WORK_FILE" > "$DEDUP_FILE"
  event_count=$(wc -l < "$DEDUP_FILE" | tr -d ' ')
  echo "[backup-own-events] pushing $event_count unique event(s) to $TARGET_RELAY"

  if ! nak event "$TARGET_RELAY" < "$DEDUP_FILE" >"$PUSH_LOG" 2>&1; then
    echo "[backup-own-events] FATAL: push to $TARGET_RELAY failed — not advancing state, will retry same window next run" >&2
    cat "$PUSH_LOG" >&2
    exit 1
  fi
  echo "[backup-own-events] push completed ($event_count event(s))"
fi

echo "$RUN_START" > "$STATE_FILE"
echo "[backup-own-events] $(date -Is) done — state advanced to $RUN_START"
