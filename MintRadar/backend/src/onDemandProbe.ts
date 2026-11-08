// The on-demand mint probe behind GET /api/mint/probe and POST /api/mint/submit (split out of index.ts on 2026-11-08).
// Display only: it never writes mint_history, scores or last_error.
import { safeFetch, readJsonLimited, RESPONSE_CAPS } from './ssrf.js'
import { parseMintMethods, classifyFetchError, type MintMethodEntry } from './prober.js'
import { classifyProbeFailure, failureFromResponse, isAbortLike, type ProbeErrorKind, type ProbeFailure, type SafeFetchRejection } from './probeErrorKind.js'
import { IS_DEV } from './serverConfig.js'
export interface MintInfo {
  name: string
  version?: string
  description?: string
  description_long?: string
  tos_url?: string
  nuts: Record<string, unknown>
  pubkey?: string
}

export interface MintKeyset {
  id: string
  unit: string
  active: boolean
}

export interface MintStatus {
  url: string
  online: boolean
  latencyMs: number | null
  info: MintInfo | null
  keysets: MintKeyset[] | null
  checkedAt: string
  error?: string
  // Coarse failure category (see probeErrorKind.ts) — additive to `error`.
  errorKind?: ProbeErrorKind
  units: string[] | null
  mintMethods: MintMethodEntry[] | null
  meltMethods: MintMethodEntry[] | null
}

// ── Mint probe ─────────────────────────────────────────────────

// On-demand single-mint probe (GET /api/mint/probe) — matches the cron
// prober's PROBE_TIMEOUT_MS (prober.ts) so a hanging mint fails at the same
// ceiling everywhere, and stays comfortably under the frontend's own
// AbortSignal.timeout(15000) around this endpoint (src/core/mint/api.ts).
export const ON_DEMAND_PROBE_TIMEOUT_MS = 10_000

// One overall deadline for the whole on-demand probe — both requests plus any
// retry share it (each request's timeout is derived from the time left), so the
// worst case is ~12 s instead of 10 + 1 + 10 = 21 s, still under the frontend's
// 15 s abort. A retry is only started if at least ON_DEMAND_MIN_RETRY_MS would
// remain for it after the wait.
export const ON_DEMAND_PROBE_DEADLINE_MS = 12_000
export const ON_DEMAND_NETWORK_RETRY_DELAY_MS = 1_000
export const ON_DEMAND_5XX_RETRY_DELAY_MS = 2_000
export const ON_DEMAND_MIN_RETRY_MS = 1_500

// Known-down mints (Stage 2 perf, 2026-10-25). Mint Detail of an offline mint used to wait ~2.4 s (a refused /
// failed connect, the 1 s retry wait and the retry) or up to the 12 s deadline (a host that never answers) for a
// result the cron prober already knew. A mint whose LAST cron probe (mint_history) was offline is probed with a
// shorter deadline and no retry: the retry exists so a transient blip does not disagree with the cron's
// last-known status (see probeMintWithin), and here the cron says offline too. A mint that is back up still
// answers within the shorter deadline (the probe is display-only: it never writes mint_history or the score).
export const KNOWN_DOWN_PROBE_DEADLINE_MS = 4_000
// An OFFLINE on-demand result for a known mint is reused for this long (every visitor of a down mint's page,
// a reload, Compare), so they get it at once instead of re-probing a dead host. Online results are never cached.
// Shorter than the frontend's 2 min staleTime for the probe query (src/hooks/useMintProbe.ts).
export const OFFLINE_PROBE_CACHE_MS = 60_000
export const OFFLINE_PROBE_CACHE_MAX = 1_000
export const offlineProbeCache = new Map<string, { status: MintStatus; expiresAt: number }>()
// One probe per known mint at a time: concurrent requests for the same url share it.
export const knownProbeInFlight = new Map<string, Promise<MintStatus>>()

// On-demand probe of a KNOWN mint, with the offline cache, in-flight sharing and the known-down fast path.
export async function probeKnownMint(url: string, knownDown: boolean): Promise<MintStatus> {
  const now = Date.now()
  const cached = offlineProbeCache.get(url)
  if (cached && cached.expiresAt > now) return cached.status
  if (cached) offlineProbeCache.delete(url)
  const pending = knownProbeInFlight.get(url)
  if (pending) return pending
  const run = probeMint(url, knownDown ? { deadlineMs: KNOWN_DOWN_PROBE_DEADLINE_MS, retry: false } : {})
    .then(status => {
      if (!status.online) {
        if (offlineProbeCache.size >= OFFLINE_PROBE_CACHE_MAX) {
          const oldest = offlineProbeCache.keys().next().value
          if (oldest !== undefined) offlineProbeCache.delete(oldest)
        }
        offlineProbeCache.set(url, { status, expiresAt: Date.now() + OFFLINE_PROBE_CACHE_MS })
      } else {
        offlineProbeCache.delete(url)
      }
      return status
    })
    .finally(() => { knownProbeInFlight.delete(url) })
  knownProbeInFlight.set(url, run)
  return run
}

// safeFetch for /v1/info that also remembers WHY a null came back (network
// error object or guard rejection), so probeMint can classify the failure.
export function fetchInfoTraced(target: string, timeoutMs: number): {
  res: ReturnType<typeof safeFetch>
  trace: { err: unknown; rejected: SafeFetchRejection | null }
} {
  const trace: { err: unknown; rejected: SafeFetchRejection | null } = { err: null, rejected: null }
  const res = safeFetch(target, {
    timeoutMs,
    onError: (err) => { trace.err = err },
    onRejected: (reason) => { trace.rejected = reason },
  })
  return { res, trace }
}

export interface ProbeOptions {
  /** Overall deadline (default ON_DEMAND_PROBE_DEADLINE_MS). */
  deadlineMs?: number
  /** Retry once on a network failure / transient 5xx (default true). */
  retry?: boolean
}

export async function probeMintWithin(url: string, start: number, opts: ProbeOptions = {}): Promise<MintStatus> {
  const deadlineAt = start + (opts.deadlineMs ?? ON_DEMAND_PROBE_DEADLINE_MS)
  const remainingMs = (): number => deadlineAt - Date.now()
  // Each request gets the usual per-request ceiling, but never more than what
  // is left of the overall deadline.
  const budgetMs = (): number => Math.max(1, Math.min(ON_DEMAND_PROBE_TIMEOUT_MS, remainingMs()))

  // safeFetch validates the URL and every redirect hop against isSafeUrl()
  // and pins DNS at connect time (SSRF + rebinding protection).
  const firstInfo = fetchInfoTraced(`${url}/v1/info`, budgetMs())
  const [infoResFirst, keysetsRes] = await Promise.all([
    firstInfo.res,
    safeFetch(`${url}/v1/keysets`, { timeoutMs: budgetMs() }),
  ])

  // Retry once on network/DNS failure (res === null) — mirrors probeMintToDb's
  // retry in prober.ts, so a transient blip doesn't disagree with the cron's
  // last-known status shown on the Dashboard card (see mint.macadamia.cash report).
  // Also retry once after 2 s on 502/503/504 (a restart/deploy blip), like the
  // cron — but not on a Cloudflare challenge, which a retry can't clear.
  // Either retry only starts if the deadline leaves it a usable window.
  let infoRes = infoResFirst
  let infoTrace = firstInfo.trace
  const firstStatus = infoResFirst?.status
  const isTransient5xx = firstStatus === 502 || firstStatus === 503 || firstStatus === 504
  if (opts.retry !== false && (infoResFirst === null || (isTransient5xx && infoResFirst.headers?.get?.('cf-mitigated') == null))) {
    const delayMs = infoResFirst === null ? ON_DEMAND_NETWORK_RETRY_DELAY_MS : ON_DEMAND_5XX_RETRY_DELAY_MS
    if (remainingMs() >= delayMs + ON_DEMAND_MIN_RETRY_MS) {
      await new Promise<void>(r => setTimeout(r, delayMs))
      const retry = fetchInfoTraced(`${url}/v1/info`, budgetMs())
      const retryRes = await retry.res
      // A 5xx that is followed by a network failure keeps the host's own 5xx
      // answer (more informative than "connection failed" on the retry).
      if (retryRes !== null || infoResFirst === null) {
        infoRes = retryRes
        infoTrace = retry.trace
      }
    }
  }

  const latencyMs = Date.now() - start

  let info: MintInfo | null = null
  let online = false
  // What went wrong, as inputs for the (pure) classifier — never echoed raw.
  let failure: ProbeFailure | null = null

  if (infoRes && infoRes.ok) {
    try {
      const raw: unknown = await readJsonLimited(infoRes, RESPONSE_CAPS.mintInfo)
      if (typeof raw === 'object' && raw !== null && 'nuts' in raw) {
        info = raw as MintInfo
        online = true
      } else {
        failure = failureFromResponse(infoRes)
      }
    } catch (err) {
      /* invalid JSON — treat as offline; a deadline abort mid-body is a timeout */
      failure = isAbortLike(err) ? { networkLabel: 'Connection timeout' } : failureFromResponse(infoRes)
    }
  } else {
    if (IS_DEV) console.error('[probeMint] info fetch failed or blocked:', url)
    failure = infoRes
      ? failureFromResponse(infoRes)
      : {
          rejected: infoTrace.rejected,
          networkLabel: infoTrace.err !== null ? classifyFetchError(infoTrace.err) : null,
        }
  }

  let keysets: MintKeyset[] | null = null

  if (keysetsRes && keysetsRes.ok) {
    try {
      const raw: unknown = await readJsonLimited(keysetsRes, RESPONSE_CAPS.mintKeysets)
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'keysets' in raw &&
        Array.isArray((raw as { keysets: unknown }).keysets)
      ) {
        keysets = (raw as { keysets: MintKeyset[] }).keysets
      }
    } catch { /* invalid JSON — skip keysets */ }
  }

  const { units, mintMethods, meltMethods } = parseMintMethods(info?.nuts ?? null)

  const status: MintStatus = {
    url,
    online,
    latencyMs: online ? latencyMs : null,
    info,
    keysets,
    checkedAt: new Date().toISOString(),
    units,
    mintMethods,
    meltMethods,
  }

  if (!online) {
    status.error = 'Mint unreachable'
    status.errorKind = classifyProbeFailure(failure ?? {})
  }

  return status
}

// Hard cap: safeFetch's own deadline cannot cover its DNS pre-check or a stalled
// body read in every case, so the whole probe is also raced against the
// deadline. The losing inner promise just finishes in the background.
export async function probeMint(url: string, opts: ProbeOptions = {}): Promise<MintStatus> {
  const start = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<MintStatus>(resolve => {
    timer = setTimeout(() => resolve({
      url,
      online: false,
      latencyMs: null,
      info: null,
      keysets: null,
      checkedAt: new Date().toISOString(),
      error: 'Mint unreachable',
      errorKind: 'timeout',
      units: null,
      mintMethods: null,
      meltMethods: null,
    }), opts.deadlineMs ?? ON_DEMAND_PROBE_DEADLINE_MS)
  })
  try {
    return await Promise.race([probeMintWithin(url, start, opts), capped])
  } finally {
    clearTimeout(timer)
  }
}
