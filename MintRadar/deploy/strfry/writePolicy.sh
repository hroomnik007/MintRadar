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
#     MAX_OPEN_EVENT_BYTES per event and OPEN_PER_IP_HOURLY per client per hour (an IPv6 client is its /64), plus a
#     total per hour in two tiers: a source that already sent more than OPEN_LIGHT_SOURCE_EVENTS this hour stops at
#     OPEN_GLOBAL_HOURLY in total, everyone stops at OPEN_GLOBAL_HARD_HOURLY. So one heavy source cannot use up the
#     room of occasional writers, and the 1 GiB database (strfry.conf `mapsize`) cannot be filled by a stranger,
#     which would stop every write, the privileged keys' too. Privileged keys are never limited. The client IP is
#     `.sourceInfo` (strfry.conf `realIpHeader = "x-real-ip"`, set by nginx). Counters: files under /tmp, one per hour.
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

MAX_OPEN_EVENT_BYTES="${MAX_OPEN_EVENT_BYTES:-16384}"
OPEN_PER_IP_HOURLY="${OPEN_PER_IP_HOURLY:-120}"
OPEN_LIGHT_SOURCE_EVENTS="${OPEN_LIGHT_SOURCE_EVENTS:-10}"
OPEN_GLOBAL_HOURLY="${OPEN_GLOBAL_HOURLY:-3000}"
OPEN_GLOBAL_HARD_HOURLY="${OPEN_GLOBAL_HARD_HOURLY:-6000}"
RATE_DIR="${RATE_DIR:-/tmp/mintradar-writepolicy}"
mkdir -p "$RATE_DIR"
cleaned_hour=""

# Count one more open-kind write in the bucket $1 (file name part) for this hour and print the new count.
count_event() {
  f="$RATE_DIR/$1.$hour"
  printf x >> "$f"
  wc -c < "$f"
}

# The count of bucket $1 for this hour without adding to it (0 when there is none yet).
peek_count() {
  f="$RATE_DIR/$1.$hour"
  if [ -f "$f" ]; then wc -c < "$f"; else echo 0; fi
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
    # An IPv6 client is its /64 (the first four groups; one customer can rotate the rest at will). File-name safe;
    # an empty or odd value shares the "unknown" bucket.
    case "$ip" in *:*) ip=$(printf '%s' "$ip" | cut -d: -f1-4) ;; esac
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
    else
      ip_n=$(count_event "ip_$ip")
      if [ "$ip_n" -gt "$OPEN_PER_IP_HOURLY" ]; then
        action="reject"
        msg="rate-limit: too many events from this address, try again later"
      else
        # The total counts accepted events only: a source whose events are refused must not be able to use up the
        # room of the others by sending more.
        all_n=$(( $(peek_count "all") + 1 ))
        if [ "$all_n" -gt "$OPEN_GLOBAL_HARD_HOURLY" ] || { [ "$all_n" -gt "$OPEN_GLOBAL_HOURLY" ] && [ "$ip_n" -gt "$OPEN_LIGHT_SOURCE_EVENTS" ]; }; then
          action="reject"
          msg="rate-limit: the relay is busy, try again later"
        else
          count_event "all" > /dev/null
        fi
      fi
    fi
  else
    action="reject"
    msg="blocked: this relay only accepts kind 38172 (mint announcement) and kind 38000 (review) from non-privileged pubkeys"
  fi

  jq -c -n --arg id "$id" --arg action "$action" --arg msg "$msg" \
    '{id: $id, action: $action, msg: $msg}'
done
