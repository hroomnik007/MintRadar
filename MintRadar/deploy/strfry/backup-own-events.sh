#!/bin/bash
# Own-event backup cron for the MintRadar backup relay (wss://nostr.mintradar.org).
#
# Pulls events authored by MintRadar's privileged pubkeys
# (deploy/strfry/privileged-pubkeys.txt, same file writePolicy.sh reads)
# from the public discovery relays, and pushes them onto our own relay — so
# the own-relay has durable coverage of historical events too, not just new
# ones written after it existed.
#
# Per-author kind lists (BASE_KINDS applies to everyone; EXTRA_KINDS_BY_AUTHOR
# adds more for specific pubkeys — see below). All other privileged authors
# without an entry in EXTRA_KINDS_BY_AUTHOR get BASE_KINDS only.
#
# Narrower than jooray/nostr-scripts/nostr-backup.sh (the reference this was
# modeled on): single-purpose (fixed small author/kind set, one fixed target
# relay) instead of a general N-author multi-relay backup tool, and doesn't
# need that reference's slow-post.py throttling — that exists to avoid
# tripping rate limits on relays *we don't control* when pushing a large
# backlog; our push target is our own strfry instance with no self-imposed
# write rate limit, and our expected volume is small, so one bulk `nak
# event` call per run is fine.
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
# First run: STATE_FILE doesn't exist yet, so SINCE=0 (full history). This
# ONE state file/timestamp covers every author's full (base + extra) kind
# list — see the --backfill-* mode below for how a newly-added kind gets
# its pre-existing history without needing a second timestamp forever.
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
#
# --backfill-author=<pubkey> --backfill-kinds="<space-separated kinds>"
#   One-time, out-of-band mode for widening a single author's kind list
#   after the fact without disturbing the regular incremental state. Pulls
#   ONLY the given kinds for the given author, from SINCE=0, and pushes them
#   — it does NOT read or write STATE_FILE, and does NOT touch any other
#   author's data. Run this once by hand right after adding an entry to
#   EXTRA_KINDS_BY_AUTHOR below, to backfill that author's pre-existing
#   history for the newly-added kinds. Correctness argument for why no
#   ongoing special-casing is then needed: regular incremental runs use one
#   shared SINCE across every author+kind combination in AUTHORS/
#   EXTRA_KINDS_BY_AUTHOR; that timestamp is a valid lower bound for a newly
#   -added kind too (the run's start time doesn't depend on which kinds were
#   being queried), so backfill covers [0, T) for the new kind once, and the
#   very next regular run covers [T, now) for it same as every other kind —
#   no gap, no permanent code path split.

set -uo pipefail

TARGET_RELAY="wss://nostr.mintradar.org"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIVILEGED_PUBKEYS_FILE="$SCRIPT_DIR/privileged-pubkeys.txt"
RELAYS_TS_FILE="/var/www/mintradar-repo/MintRadar/src/core/nostr/relays.ts"
STATE_DIR="/opt/mintradar-strfry/backup-state"
STATE_FILE="$STATE_DIR/last-sync-unix"

BASE_KINDS="38172 38000"

# Extra kinds pulled for specific privileged authors, on top of BASE_KINDS.
# Wildcitizen7 (personal maintainer identity) also uses this relay as a
# personal content-relay backup — investigated 2026-09-25 via live
# `nak req --kind ...` queries against DISCOVERY_RELAYS for this pubkey:
# kind:1 (short notes, the bulk of the activity) and kind:30023 (long-form
# articles, one confirmed instance) are the genuine "personal note" content
# kinds in active use. Also observed but deliberately excluded: kind:0
# (profile metadata), kind:3 (contacts), kind:5 (deletions), kind:7
# (reactions), and assorted replaceable list/app-data kinds (10001-10050,
# 30078, 30443, 31602, 31925, 34237) — social-graph/metadata, not notes.
# The app service pubkey's scope deliberately does NOT change here.
declare -A EXTRA_KINDS_BY_AUTHOR=(
  ["1757995286af8c2bcdcfd13a300e9c40bc4a67e761118c5b365573406c6b37bc"]="1 30023"
)

# --- --backfill-* argument parsing -----------------------------------------
BACKFILL_AUTHOR=""
BACKFILL_KINDS=""
for arg in "$@"; do
  case "$arg" in
    --backfill-author=*) BACKFILL_AUTHOR="${arg#*=}" ;;
    --backfill-kinds=*) BACKFILL_KINDS="${arg#*=}" ;;
    *)
      echo "[backup-own-events] FATAL: unrecognized argument: $arg" >&2
      exit 1
      ;;
  esac
done
if [ -n "$BACKFILL_AUTHOR" ] && [ -z "$BACKFILL_KINDS" ]; then
  echo "[backup-own-events] FATAL: --backfill-author requires --backfill-kinds" >&2
  exit 1
fi
if [ -z "$BACKFILL_AUTHOR" ] && [ -n "$BACKFILL_KINDS" ]; then
  echo "[backup-own-events] FATAL: --backfill-kinds requires --backfill-author" >&2
  exit 1
fi

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

mapfile -t ALL_AUTHORS < <(grep -vE '^\s*(#|$)' "$PRIVILEGED_PUBKEYS_FILE")
if [ "${#ALL_AUTHORS[@]}" -eq 0 ]; then
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

# Pulls $2-authors × SOURCE_RELAYS for the given kinds/since, dedupes, pushes
# to TARGET_RELAY. Echoes nothing; sets PULL_OK_COUNT/PULL_ATTEMPT_COUNT/
# PUSHED_COUNT globals and returns 1 on a fatal condition (caller decides
# whether/how to persist state).
run_pull_and_push() {
  local since="$1"
  shift
  local kinds="$1"
  shift
  local -a authors=("$@")
  local -a kind_flags=()
  local k
  for k in $kinds; do
    kind_flags+=(--kind "$k")
  done

  local work_file push_log
  work_file=$(mktemp)
  push_log=$(mktemp)
  # shellcheck disable=SC2064 (intentional early expansion — file paths are fixed at this point)
  trap "rm -f '$work_file' '$push_log'" RETURN

  PULL_OK_COUNT=0
  PULL_ATTEMPT_COUNT=0
  PUSHED_COUNT=0

  local author relay out
  for author in "${authors[@]}"; do
    for relay in "${SOURCE_RELAYS[@]}"; do
      PULL_ATTEMPT_COUNT=$((PULL_ATTEMPT_COUNT + 1))
      if out=$(nak req --author "$author" "${kind_flags[@]}" --since "$since" "$relay" 2>/dev/null); then
        PULL_OK_COUNT=$((PULL_OK_COUNT + 1))
        # nak prints one JSON event per line to stdout; a relay with nothing
        # new prints no lines, which is a legitimate steady-state result.
        if [ -n "$out" ]; then
          printf '%s\n' "$out" >> "$work_file"
        fi
      else
        echo "[backup-own-events] WARN: pull failed for author ${author:0:8}… (kinds: $kinds) from $relay (continuing)" >&2
      fi
    done
  done

  if [ "$PULL_OK_COUNT" -eq 0 ]; then
    echo "[backup-own-events] FATAL: all $PULL_ATTEMPT_COUNT pull attempts failed" >&2
    return 1
  fi
  echo "[backup-own-events] pulled from $PULL_OK_COUNT/$PULL_ATTEMPT_COUNT relay×author combinations (kinds: $kinds)"

  if [ ! -s "$work_file" ]; then
    echo "[backup-own-events] no new events found (kinds: $kinds) — nothing to push"
    return 0
  fi

  local dedup_file
  dedup_file=$(mktemp)
  trap "rm -f '$work_file' '$push_log' '$dedup_file'" RETURN
  jq -c -s 'unique_by(.id) | .[]' "$work_file" > "$dedup_file"
  PUSHED_COUNT=$(wc -l < "$dedup_file" | tr -d ' ')
  echo "[backup-own-events] pushing $PUSHED_COUNT unique event(s) to $TARGET_RELAY (kinds: $kinds)"

  if ! nak event "$TARGET_RELAY" < "$dedup_file" >"$push_log" 2>&1; then
    echo "[backup-own-events] FATAL: push to $TARGET_RELAY failed" >&2
    cat "$push_log" >&2
    return 1
  fi
  echo "[backup-own-events] push completed ($PUSHED_COUNT event(s), kinds: $kinds)"
  return 0
}

# --- One-time backfill mode -------------------------------------------------
if [ -n "$BACKFILL_AUTHOR" ]; then
  echo "[backup-own-events] $(date -Is) BACKFILL MODE — author=${BACKFILL_AUTHOR:0:8}…, kinds=$BACKFILL_KINDS, since=0 (STATE_FILE untouched)"
  if ! run_pull_and_push 0 "$BACKFILL_KINDS" "$BACKFILL_AUTHOR"; then
    echo "[backup-own-events] BACKFILL FAILED" >&2
    exit 1
  fi
  echo "[backup-own-events] $(date -Is) BACKFILL done — $PUSHED_COUNT event(s) pushed, STATE_FILE unchanged"
  exit 0
fi

# --- Regular incremental run -------------------------------------------------
if [ -f "$STATE_FILE" ]; then
  SINCE=$(cat "$STATE_FILE")
else
  SINCE=0
fi
RUN_START=$(date +%s)

echo "[backup-own-events] $(date -Is) starting — since=$SINCE, ${#ALL_AUTHORS[@]} author(s), ${#SOURCE_RELAYS[@]} source relay(s)"

overall_ok=1
for author in "${ALL_AUTHORS[@]}"; do
  kinds="$BASE_KINDS"
  if [ -n "${EXTRA_KINDS_BY_AUTHOR[$author]+x}" ]; then
    kinds="$kinds ${EXTRA_KINDS_BY_AUTHOR[$author]}"
  fi
  if ! run_pull_and_push "$SINCE" "$kinds" "$author"; then
    overall_ok=0
  fi
done

if [ "$overall_ok" -ne 1 ]; then
  echo "[backup-own-events] FATAL: at least one author failed — not advancing state, will retry same window next run" >&2
  exit 1
fi

echo "$RUN_START" > "$STATE_FILE"
echo "[backup-own-events] $(date -Is) done — state advanced to $RUN_START"
