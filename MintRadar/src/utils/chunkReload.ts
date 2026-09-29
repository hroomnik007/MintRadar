// Recovery from a stale-build tab: after a deploy the hashed lazy chunks of the
// previous build no longer exist, so `import()` of a route chunk rejects.
// A reload fetches the fresh index.html and the current chunk names.

const CHUNK_ERROR_RE =
  /dynamically imported module|Importing a module script failed|Failed to fetch dynamically imported module|ChunkLoadError/i

export const CHUNK_RELOAD_KEY = 'mintradar_chunk_reload_at'
export const CHUNK_RELOAD_WINDOW_MS = 60_000

/** True when `err` looks like a failed dynamic-import / chunk load. */
export function isChunkLoadError(err: unknown): boolean {
  if (err == null) return false
  let text = ''
  if (typeof err === 'string') text = err
  else if (err instanceof Error) text = `${err.name} ${err.message}`
  else if (typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown }
    text = `${typeof e.name === 'string' ? e.name : ''} ${typeof e.message === 'string' ? e.message : ''}`
  }
  return CHUNK_ERROR_RE.test(text)
}

/**
 * Loop guard: returns true (and records `now`) at most once per
 * CHUNK_RELOAD_WINDOW_MS. If sessionStorage is unavailable the guard cannot be
 * enforced, so it refuses — better an error screen than a reload loop.
 */
export function claimAutoReload(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))
    if (Number.isFinite(last) && last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

/** Reloads the page if `err` is a chunk-load failure and the guard allows it. */
export function reloadOnChunkError(err: unknown): boolean {
  if (!isChunkLoadError(err) || !claimAutoReload()) return false
  window.location.reload()
  return true
}
