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

is_privileged() {
  pk="$1"
  for p in $PRIVILEGED_PUBKEYS; do
    [ "$pk" = "$p" ] && return 0
  done
  return 1
}

while IFS= read -r line; do
  id=$(printf '%s\n' "$line" | jq -r '.event.id // ""' 2>/dev/null)
  pubkey=$(printf '%s\n' "$line" | jq -r '.event.pubkey // ""' 2>/dev/null)
  kind=$(printf '%s\n' "$line" | jq -r '.event.kind // -1' 2>/dev/null)

  if is_privileged "$pubkey"; then
    action="accept"
    msg=""
  elif [ "$kind" = "38172" ] || [ "$kind" = "38000" ]; then
    action="accept"
    msg=""
  else
    action="reject"
    msg="blocked: this relay only accepts kind 38172 (mint announcement) and kind 38000 (review) from non-privileged pubkeys"
  fi

  jq -c -n --arg id "$id" --arg action "$action" --arg msg "$msg" \
    '{id: $id, action: $action, msg: $msg}'
done
