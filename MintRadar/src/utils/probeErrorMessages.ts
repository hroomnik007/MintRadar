// User-facing sentences for the `errorKind` the backend adds to probe failures
// (backend/src/probeErrorKind.ts — keep this list in sync with PROBE_ERROR_KINDS
// there; the backend is a separate package, so the type is mirrored, not shared).

export type ProbeErrorKind =
  | 'blocked_by_host'
  | 'rate_limited_by_host'
  | 'host_error'
  | 'timeout'
  | 'dns'
  | 'tls'
  | 'not_cashu'
  | 'unreachable'

const MESSAGES: Record<ProbeErrorKind, string> = {
  blocked_by_host: "This mint's host blocks automated checks from our server, so MintRadar can't verify it. If you run this mint, allow MintRadar's probe in your firewall or Cloudflare settings.",
  rate_limited_by_host: "The mint's host is limiting our checks. Try again later.",
  host_error: "The mint's server returned an error. Try again later.",
  timeout: "The mint didn't answer in time. Try again later.",
  dns: "That host name couldn't be found.",
  tls: "The mint's certificate couldn't be verified.",
  not_cashu: "That address doesn't look like a Cashu mint (no valid /v1/info answer).",
  unreachable: "Couldn't connect to the mint.",
}

export function isProbeErrorKind(value: unknown): value is ProbeErrorKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, value)
}

/**
 * Sentence for an errorKind, or null when it is missing/unknown — the caller
 * then keeps its existing text (older backend, or a failure without a kind).
 */
export function probeErrorMessage(kind: unknown): string | null {
  return isProbeErrorKind(kind) ? MESSAGES[kind] : null
}
