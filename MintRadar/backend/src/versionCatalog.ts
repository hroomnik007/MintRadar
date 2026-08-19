// Keeps the software_versions DB cache (see db.ts) up to date with each tracked
// mint implementation's latest upstream release, so versionFreshnessScore
// (shared/trustScore.ts) can score freshness against the real current version
// instead of a hand-maintained static list.
import { pool } from './db.js'
import { parseMajorMinorPatch } from './shared/trustScore.js'

interface UpstreamRepo {
  software: string
  apiUrl: string
}

// Plain fetch (no SSRF wrapper) — same pattern as discovery.ts's audit.8333.space
// calls, since these URLs are hardcoded, not user-supplied.
const UPSTREAM_REPOS: UpstreamRepo[] = [
  { software: 'nutshell', apiUrl: 'https://api.github.com/repos/cashubtc/nutshell/releases/latest' },
  { software: 'cdk', apiUrl: 'https://api.github.com/repos/cashubtc/cdk/releases/latest' },
]

// Fetches each tracked software's latest GitHub release and writes it to
// software_versions. Never throws — a failure for one repo (network error,
// unparseable tag_name) is logged and the DB cache simply keeps its last known
// value; the other repo is still attempted.
export async function fetchLatestUpstreamVersions(): Promise<void> {
  for (const repo of UPSTREAM_REPOS) {
    try {
      const res = await fetch(repo.apiUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) {
        console.error(`[versionCatalog] GitHub API returned HTTP ${res.status} for ${repo.software}`)
        continue
      }
      const data = await res.json() as Record<string, unknown>
      // /releases/latest already excludes prereleases/drafts — verify anyway.
      if (data['prerelease'] === true || data['draft'] === true) {
        console.error(`[versionCatalog] ${repo.software} latest release is prerelease/draft, skipping`)
        continue
      }
      const tagName = data['tag_name']
      if (typeof tagName !== 'string' || !tagName || !parseMajorMinorPatch(tagName)) {
        console.error(`[versionCatalog] ${repo.software} release has an unparseable tag_name:`, tagName)
        continue
      }
      await pool.query(
        `INSERT INTO software_versions (software, latest_version, fetched_at, source_url)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (software) DO UPDATE
           SET latest_version = EXCLUDED.latest_version,
               fetched_at = EXCLUDED.fetched_at,
               source_url = EXCLUDED.source_url`,
        [repo.software, tagName, repo.apiUrl]
      )
      console.log(`[versionCatalog] updated ${repo.software} latest version -> ${tagName}`)
    } catch (err) {
      console.error(`[versionCatalog] failed to fetch latest version for ${repo.software}:`, err)
    }
  }
}

// Reads the software_versions cache into the { major, minor } map that
// versionFreshnessScore/computeServerTrustScore expect. Never throws — a DB
// hiccup here just means the caller falls back to the static ladders.
export async function getLatestVersionsMap(): Promise<Record<string, { major: number; minor: number }>> {
  const map: Record<string, { major: number; minor: number }> = {}
  try {
    const res = await pool.query<{ software: string; latest_version: string | null }>(
      'SELECT software, latest_version FROM software_versions'
    )
    for (const row of res.rows) {
      if (!row.latest_version) continue
      const parsed = parseMajorMinorPatch(row.latest_version)
      if (parsed) map[row.software] = { major: parsed.major, minor: parsed.minor }
    }
  } catch (err) {
    console.error('[versionCatalog] failed to read software_versions cache:', err)
  }
  return map
}
