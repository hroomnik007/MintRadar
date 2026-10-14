// Where MintRadar's probe server measures from (Hetzner Cloud vServer, nbg1-dc3).
// Single source of truth for every user-facing "from <city>" label. If the
// server ever moves, change only this value (see docs/claude/scoring-and-probing.md).
export const PROBE_LOCATION = 'Nuremberg'

// Label of the Mint Detail button that measures latency from the visitor's browser. The Latency
// tooltip names it, so both read this one constant.
export const CLIENT_LATENCY_BUTTON_LABEL = 'Show my latency'

/** Latency tooltip on Mint Detail. */
export function latencyTooltipText(location: string = PROBE_LOCATION, buttonLabel: string = CLIENT_LATENCY_BUTTON_LABEL): string {
  return `Measured from our server in ${location} at the last probe. "${buttonLabel}" measures from your device.`
}
