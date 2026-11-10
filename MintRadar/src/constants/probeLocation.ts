// Where MintRadar's probe server measures from (Hetzner Cloud vServer, nbg1-dc3).
// Single source of truth for every user-facing "from <city>" label. If the
// server ever moves, change only this value (see docs/claude/scoring-and-probing.md).
export const PROBE_LOCATION = 'Nuremberg'

// Label of the Mint Detail button that measures latency from the visitor's browser.
export const CLIENT_LATENCY_BUTTON_LABEL = 'Show my latency'

/** Caption under the Latency value on Mint Detail: where the number was measured. */
export function latencyCaption(location: string = PROBE_LOCATION): string {
  return `server · ${location}`
}

/**
 * Said ONCE above a list of cards (Dashboard status strip, Watchlist summary line): where every card's latency was
 * measured. It used to be a "· Nuremberg" suffix on each card, which read as the mint's own location.
 */
export function cardsLatencyNote(location: string = PROBE_LOCATION): string {
  return `latency from ${location}`
}
