#!/bin/sh
# strfry writePolicy plugin — MintRadar backup relay whitelist.
#
# Protocol: strfry invokes this script once, keeps it running, and streams one
# JSON object per line on stdin for every incoming EVENT; we must write back
# exactly one JSON response per input line, in order, on stdout.
# https://github.com/hoytech/strfry/blob/master/docs/plugins.md
#
# Policy:
#   - PRIVILEGED_PUBKEY may write any event kind.
#   - Everyone else may write ONLY kind 38172 (NIP-87 mint announcement) and
#     kind 38000 (review). Everything else, including kind 1, is rejected.
#
# Note: strfry verifies the event signature before invoking this plugin, so
# `.event.pubkey` here is already cryptographically bound to the event — safe
# to use directly for the privileged-key check.

PRIVILEGED_PUBKEY="1757995286af8c2bcdcfd13a300e9c40bc4a67e761118c5b365573406c6b37bc"

while IFS= read -r line; do
  id=$(printf '%s\n' "$line" | jq -r '.event.id // ""' 2>/dev/null)
  pubkey=$(printf '%s\n' "$line" | jq -r '.event.pubkey // ""' 2>/dev/null)
  kind=$(printf '%s\n' "$line" | jq -r '.event.kind // -1' 2>/dev/null)

  if [ "$pubkey" = "$PRIVILEGED_PUBKEY" ]; then
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
