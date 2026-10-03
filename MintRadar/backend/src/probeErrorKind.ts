// Coarse, user-facing classification of an on-demand probe failure.
//
// Pure (no I/O, no DB) so it can be unit-tested on its own. The ONLY thing it
// ever outputs is one of the PROBE_ERROR_KINDS strings — never raw error text,
// header values, IPs or response bodies — so it is safe to put in an
// unauthenticated API response.

export const PROBE_ERROR_KINDS = [
  'blocked_by_host',
  'rate_limited_by_host',
  'host_error',
  'timeout',
  'dns',
  'tls',
  'not_cashu',
  'blocked_address',
  'unreachable',
] as const

export type ProbeErrorKind = typeof PROBE_ERROR_KINDS[number]

/** Why safeFetch refused to send a request (SSRF guard / redirect handling). */
export type SafeFetchRejection = 'blocked' | 'dns-error' | 'bad-redirect'

export interface ProbeFailure {
  /** HTTP status of the answer, when the host answered at all. */
  status?: number | null
  /** True when the answer carried a `cf-mitigated` header (any value). */
  cfMitigated?: boolean
  /** Value of the `server` response header, when present. */
  server?: string | null
  /** Value of the `content-type` response header, when present. */
  contentType?: string | null
  /** Output of prober.ts classifyFetchError() for a network-level failure. */
  networkLabel?: string | null
  /** Set when safeFetch refused the request before it was sent. */
  rejected?: SafeFetchRejection | null
}

function isCloudflareHtml(server: string | null | undefined, contentType: string | null | undefined): boolean {
  return (server ?? '').toLowerCase().includes('cloudflare') &&
    (contentType ?? '').toLowerCase().includes('text/html')
}

export function classifyProbeFailure(f: ProbeFailure): ProbeErrorKind {
  if (f.rejected === 'blocked') return 'blocked_address'
  if (f.rejected === 'dns-error') return 'dns'
  if (f.rejected === 'bad-redirect') return 'unreachable'

  const status = f.status ?? null
  if (status !== null) {
    // A Cloudflare challenge/block marks its answer with cf-mitigated, whatever
    // the status code (legacy "under attack" challenges are 503).
    if (f.cfMitigated === true) return 'blocked_by_host'
    if (status === 401 || status === 403) return 'blocked_by_host'
    if (status === 429) return 'rate_limited_by_host'
    // Cloudflare's own 5xx pages are HTML too, but they mean the origin is
    // down, not that we are blocked — so 5xx is decided before the HTML rule.
    if (status >= 500) return 'host_error'
    if (status === 404) return 'not_cashu'
    // Answered 2xx/other with a Cloudflare HTML page instead of JSON: an
    // interstitial in front of the mint, not the mint itself.
    if (isCloudflareHtml(f.server, f.contentType)) return 'blocked_by_host'
    // Host answered, but /v1/info is not a usable Cashu answer (not JSON,
    // no `nuts`, other 4xx).
    return 'not_cashu'
  }

  switch (f.networkLabel) {
    case 'Connection timeout': return 'timeout'
    case 'DNS resolution failed': return 'dns'
    case 'TLS/SSL error': return 'tls'
    default: return 'unreachable'
  }
}

/** Minimal shape of a fetch Response header bag (tests mock Responses without one). */
interface HeaderBag { get?: (name: string) => string | null }

/** Reads only the three header facts the classifier needs; tolerant of mocks. */
export function failureFromResponse(res: { status: number; headers?: HeaderBag | undefined }): ProbeFailure {
  const get = (name: string): string | null => {
    try { return res.headers?.get?.(name) ?? null } catch { return null }
  }
  return {
    status: res.status,
    cfMitigated: get('cf-mitigated') !== null,
    server: get('server'),
    contentType: get('content-type'),
  }
}
