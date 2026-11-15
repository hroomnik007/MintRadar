// Latency measured from the visitor's browser: one GET of a mint's /v1/info, timed with performance.now().
// Used by Compare (2026-11-15: its BEST latency tag is based on this, not on the probe server's last check). The Mint
// Detail "Show my latency" button and the wizard measure the same request their own way.

export const BROWSER_LATENCY_TIMEOUT_MS = 5000

/** Milliseconds, or null when the mint did not answer OK in time (or the URL is not a plain https:// mint URL). */
export async function measureMintLatency(url: string, timeoutMs: number = BROWSER_LATENCY_TIMEOUT_MS): Promise<number | null> {
  if (!url.startsWith('https://') || url.length > 500) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0 = performance.now()
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/v1/info', { cache: 'no-store', credentials: 'omit', signal: ctrl.signal })
    return res.ok ? Math.round(performance.now() - t0) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
