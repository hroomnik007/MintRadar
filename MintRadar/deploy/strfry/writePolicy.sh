#!/bin/sh
# strfry writePolicy plugin — MintRadar backup relay whitelist.
#
# Protocol: strfry invokes this script once, keeps it running, and streams one
# JSON object per line on stdin for every incoming EVENT; we must write back
# exactly one JSON response per input line, in order, on stdout.
# https://github.com/hoytech/strfry/blob/master/docs/plugins.md
#
# Policy:
#   - Any pubkey in PRIVILEGED_PUBKEYS may write any event kind.
#   - Everyone else may write ONLY kind 38172 (NIP-87 mint announcement) and
#     kind 38000 (review). Everything else, including kind 1, is rejected.
#   - Those two kinds are open to any key, so they are bounded (2026-10-28 audit): at most
#     MAX_OPEN_EVENT_BYTES per event, OPEN_PER_IP_HOURLY per client IP per hour, and OPEN_GLOBAL_HOURLY in total per
#     hour. The 1 GiB database (strfry.conf `mapsize`) cannot then be filled by a stranger, which would stop every
#     write, including the privileged keys'. Privileged keys are never limited. The client IP is `.sourceInfo`
#     (strfry.conf `realIpHeader = "x-real-ip"`, set by nginx). Counters live in files under /tmp, one per hour.
#
# Note: strfry verifies the event signature before invoking this plugin, so
# `.event.pubkey` here is already cryptographically bound to the event — safe
# to use directly for the privileged-key check.
#
# Privileged pubkeys are read once at startup from privileged-pubkeys.txt
# (shared with backup-own-events.sh — see that file's comment) rather than
# hardcoded here, so the two never drift apart.

PRIVILEGED_PUBKEYS_FILE="$(dirname "$0")/privileged-pubkeys.txt"
PRIVILEGED_PUBKEYS=$(grep -vE '^\s*(#|$)' "$PRIVILEGED_PUBKEYS_FILE")

MAX_OPEN_EVENT_BYTES=16384
OPEN_PER_IP_HOURLY=120
OPEN_GLOBAL_HOURLY=3000
RATE_DIR="${RATE_DIR:-/tmp/mintradar-writepolicy}"
mkdir -p "$RATE_DIR"
cleaned_hour=""

# Count one more open-kind write in the bucket $1 (file name part) for this hour and report whether it is within $2.
within_budget() {
  f="$RATE_DIR/$1.$hour"
  printf x >> "$f"
  [ "$(wc -c < "$f")" -le "$2" ]
}

is_privileged() {
  pk="$1"
  for p in $PRIVILEGED_PUBKEYS; do
    [ "$pk" = "$p" ] && return 0
  done
  return 1
}

# No globbing: the fields below are split unquoted.
set -f

while IFS= read -r line; do
  # One jq call per event: id, pubkey, kind, size of the event JSON in characters, client address. A line that is not
  # valid JSON yields no fields, so the kind is empty and the event is rejected below.
  fields=$(printf '%s\n' "$line" | jq -r '[(.event.id // ""), (.event.pubkey // ""), ((.event.kind // -1) | tostring), ((.event | tojson | length) | tostring), (.sourceInfo // "")] | join(" ")' 2>/dev/null)
  set -- $fields
  id="${1:-}"; pubkey="${2:-}"; kind="${3:--1}"; size="${4:-0}"; ip="${5:-}"

  if is_privileged "$pubkey"; then
    action="accept"
    msg=""
  elif [ "$kind" = "38172" ] || [ "$kind" = "38000" ]; then
    action="accept"
    msg=""
    # File-name safe client IP; an empty or odd value shares the "unknown" bucket.
    ip=$(printf '%s' "$ip" | tr -c 'A-Za-z0-9' '_' | cut -c1-64)
    [ -n "$ip" ] || ip=unknown
    hour=$(( $(date +%s) / 3600 ))
    if [ "$cleaned_hour" != "$hour" ]; then
      # A new hour: drop the counters of earlier hours.
      for f in "$RATE_DIR"/*; do
        [ -e "$f" ] || continue
        case "$f" in *".$hour") ;; *) rm -f "$f" ;; esac
      done
      cleaned_hour="$hour"
    fi
    if [ "$size" -gt "$MAX_OPEN_EVENT_BYTES" ]; then
      action="reject"
      msg="blocked: event too large for a non-privileged pubkey"
    elif ! within_budget "ip_$ip" "$OPEN_PER_IP_HOURLY"; then
      action="reject"
      msg="rate-limit: too many events from this address, try again later"
    elif ! within_budget "all" "$OPEN_GLOBAL_HOURLY"; then
      action="reject"
      msg="rate-limit: the relay is busy, try again later"
    fi
  else
    action="reject"
    msg="blocked: this relay only accepts kind 38172 (mint announcement) and kind 38000 (review) from non-privileged pubkeys"
  fi

  jq -c -n --arg id "$id" --arg action "$action" --arg msg "$msg" \
    '{id: $id, action: $action, msg: $msg}'
done
