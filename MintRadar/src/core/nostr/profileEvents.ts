import { verifyEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'

// Which kind:0 profile events from a relay may be used. A relay can ignore the `authors` filter, serve any kind, serve a
// stale copy or forge an event, so an event counts only if it is kind 0, its signature verifies and its author is one of
// the pubkeys that were asked for. Per author the newest (created_at) valid event wins, whatever the arrival order.
// Anything that fails a check is dropped silently. Backend counterpart: pickNewestProfileEvents() in
// backend/src/profilesSync.ts (no shared code between the two packages).
export function pickNewestProfileEvents(
  events: readonly NostrEvent[],
  requested: ReadonlySet<string>,
): Map<string, NostrEvent> {
  const best = new Map<string, NostrEvent>()
  for (const e of events) {
    if (e.kind !== 0 || !requested.has(e.pubkey)) continue
    const current = best.get(e.pubkey)
    if (current && current.created_at >= e.created_at) continue
    let ok: boolean
    try { ok = verifyEvent(e) } catch { ok = false }
    if (ok) best.set(e.pubkey, e)
  }
  return best
}
