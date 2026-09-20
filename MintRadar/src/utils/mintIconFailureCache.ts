// Remembers which mints' favicons recently failed to load through the
// backend proxy (GET /api/mint/icon?url=), so MintFavicon can skip straight
// to the monogram placeholder on a later mount instead of re-issuing the
// same doomed request (e.g. every time the Dashboard grid remounts a card
// during a search/sort/filter change, or the page is revisited later the
// same day). Backed by localStorage with a TTL so it survives a reload but
// still self-heals once the entry expires — the server-side proxy cache
// (backend/src/mintIcon.ts) also gets shorter-lived, sooner than this.
//
// In-memory during the session (a plain object, loaded from localStorage
// once) plus a best-effort localStorage mirror; failures never throw when
// storage is unavailable (private window, blocked site data, etc.).

const STORAGE_KEY = 'mintradar_icon_failures_v1'
const FAILURE_TTL_MS = 24 * 60 * 60 * 1000 // 24h

type FailureMap = Record<string, number> // mint url -> expiresAt (epoch ms)

let cache: FailureMap | null = null

function loadCache(): FailureMap {
  if (cache) return cache
  cache = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') {
        const now = Date.now()
        for (const [url, expiresAt] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof expiresAt === 'number' && expiresAt > now) cache[url] = expiresAt
        }
      }
    }
  } catch {
    // private window / blocked storage / corrupt JSON — fall back to an
    // empty in-memory-only cache for this session.
  }
  return cache
}

function persist(map: FailureMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // storage full/blocked — the in-memory cache still works for this session.
  }
}

/** Whether this mint's icon proxy request failed within the last FAILURE_TTL_MS. */
export function hasIconFailedRecently(mintUrl: string): boolean {
  const map = loadCache()
  const expiresAt = map[mintUrl]
  if (expiresAt === undefined) return false
  if (expiresAt <= Date.now()) {
    delete map[mintUrl]
    persist(map)
    return false
  }
  return true
}

/** Record that this mint's icon proxy request just failed (img onError). */
export function markIconFailed(mintUrl: string): void {
  const map = loadCache()
  map[mintUrl] = Date.now() + FAILURE_TTL_MS
  persist(map)
}

/** Test hook — clears both the in-memory and localStorage-backed cache. */
export function _resetMintIconFailureCache(): void {
  cache = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
