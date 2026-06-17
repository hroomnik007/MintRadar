import { pool } from './db.js'
import { isSafeUrl, safeFetch } from './ssrf.js'

async function lookupServerLocation(mintUrl: string): Promise<string | null> {
  try {
    const hostname = new URL(mintUrl).hostname
    const res = await fetch(`https://ipinfo.io/${encodeURIComponent(hostname)}/json`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const data = await res.json() as Record<string, unknown>
    if (data['bogon'] === true) return null
    const city = typeof data['city'] === 'string' ? data['city'] : null
    const country = typeof data['country'] === 'string' ? data['country'] : null
    if (!city && !country) return null
    return [city, country].filter(Boolean).join(', ')
  } catch {
    return null
  }
}

const PROBE_TIMEOUT_MS = 10000
const RETENTION_DAYS = 30

// [major, minor] descending — newest first
const SERVER_NUTSHELL_VERSIONS: [number, number][] = [
  [0, 16], [0, 15], [0, 14], [0, 13], [0, 12], [0, 11],
]

function serverVersionFreshnessScore(v: string | null | undefined): number {
  if (!v) return 0
  const m = v.match(/(\d+)\.(\d+)/)
  if (!m || !m[1] || !m[2]) return 3
  const major = parseInt(m[1], 10)
  const minor = parseInt(m[2], 10)
  const idx = SERVER_NUTSHELL_VERSIONS.findIndex(
    ([mj, mn]) => major > mj || (major === mj && minor >= mn)
  )
  if (idx === -1) return 0
  return Math.max(0, 10 - idx * 2)
}

function computeServerTrustScore(
  uptimePct: number,
  nutCount: number | null,
  version: string | null,
  auditNMints: number | null,
  auditNMelts: number | null,
  auditNErrors: number | null
): number {
  const uScore = Math.round(uptimePct * 0.45)
  const nScore = Math.round(Math.min((nutCount ?? 0) / 14, 1) * 30)
  const vScore = Math.round(serverVersionFreshnessScore(version) / 10 * 15)
  const total = (auditNMints ?? 0) + (auditNMelts ?? 0) + (auditNErrors ?? 0)
  const errRate = total === 0 ? 0 : (auditNErrors ?? 0) / total
  const aScore = auditNMints === null
    ? 2.5
    : errRate === 0 ? 5
    : errRate < 0.01 ? 4
    : errRate < 0.05 ? 3
    : errRate < 0.15 ? 2
    : 1
  return Math.min(100, Math.round(uScore + nScore + vScore + aScore))
}

function classifyFetchError(err: unknown): string {
  if (!(err instanceof Error)) return 'Unreachable'
  const code = (err as { code?: string }).code
  const name = err.name
  const msg = err.message.toLowerCase()
  if (
    name === 'AbortError' || name === 'TimeoutError' ||
    code === 'UND_ERR_CONNECT_TIMEOUT'
  ) return 'Connection timeout'
  if (code === 'ECONNREFUSED') return 'Connection refused'
  if (
    code === 'ENOTFOUND' || code === 'EAI_AGAIN' ||
    msg.includes('getaddrinfo')
  ) return 'DNS resolution failed'
  if (
    code?.startsWith('ERR_TLS') ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    msg.includes('certificate') ||
    msg.includes('ssl')
  ) return 'TLS/SSL error'
  return 'Unreachable'
}

export async function probeMintToDb(url: string): Promise<void> {
  if (!(await isSafeUrl(url))) {
    if (process.env['NODE_ENV'] !== 'production') {
      console.warn('[prober] blocked unsafe URL:', url)
    }
    return
  }

  const start = Date.now()
  let online = false
  let latencyMs: number | null = null
  let lastError: string | null = null
  let capturedErr: unknown = null

  try {
    const res = await safeFetch(`${url}/v1/info`, {
      timeoutMs: PROBE_TIMEOUT_MS,
      onError: (err) => { capturedErr = err },
    })

    if (res && res.ok) {
      try {
        const raw = await res.json() as Record<string, unknown>
        const nuts = raw['nuts'] !== null && typeof raw['nuts'] === 'object' ? raw['nuts'] as Record<string, unknown> : null
        if (nuts === null) {
          lastError = 'Invalid Cashu response'
        } else {
          online = true
          latencyMs = Date.now() - start
          const iconUrl = typeof raw['icon_url'] === 'string' ? raw['icon_url'] : null
          const version = typeof raw['version'] === 'string' ? raw['version'] : null
          const tosUrl = typeof raw['tos_url'] === 'string' ? raw['tos_url'] : null
          const descriptionLong = typeof raw['description_long'] === 'string' ? raw['description_long'] : null
          const nutCount = Object.keys(nuts).length

          const storedVersionRes = await pool.query('SELECT version FROM mints WHERE url = $1', [url])
          const storedVersion = storedVersionRes.rows[0]?.version as string | null

          await pool.query(
            `UPDATE mints SET
              icon_url         = COALESCE($1, icon_url),
              version          = COALESCE($2, version),
              nut_count        = COALESCE($3, nut_count),
              tos_url          = COALESCE($4, tos_url),
              description_long = COALESCE($5, description_long),
              nuts_limits      = COALESCE($6::jsonb, nuts_limits)
            WHERE url = $7`,
            [iconUrl, version, nutCount, tosUrl, descriptionLong, JSON.stringify(nuts), url]
          )

          if (version !== null && version !== storedVersion) {
            await pool.query(
              `INSERT INTO mint_version_history (url, version, first_seen_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (url, version) DO NOTHING`,
              [url, version]
            )
          }

          const locRow = await pool.query('SELECT server_location FROM mints WHERE url = $1', [url])
          const currentLoc = locRow.rows[0]?.server_location as string | null | undefined
          if (currentLoc == null) {
            const location = await lookupServerLocation(url)
            if (location !== null) {
              await pool.query('UPDATE mints SET server_location = $1 WHERE url = $2', [location, url])
            }
          }
        }
      } catch { lastError = 'Invalid JSON response' }
    } else if (res && !res.ok) {
      lastError = `HTTP ${res.status}`
    } else {
      lastError = classifyFetchError(capturedErr)
    }
  } catch {
    lastError = 'Unreachable'
  }

  await pool.query(
    `INSERT INTO mint_history (url, online, latency_ms, checked_at)
     VALUES ($1, $2, $3, NOW())`,
    [url, online, latencyMs]
  )

  try {
    const statsRes = await pool.query(
      `SELECT
        m.nut_count, m.version,
        m.audit_n_mints, m.audit_n_melts, m.audit_n_errors,
        COUNT(h.online) AS total,
        COALESCE(SUM(CASE WHEN h.online THEN 1 ELSE 0 END), 0) AS online_count
       FROM mints m
       LEFT JOIN mint_history h
         ON h.url = m.url AND h.checked_at > NOW() - INTERVAL '24 hours'
       WHERE m.url = $1
       GROUP BY m.nut_count, m.version, m.audit_n_mints, m.audit_n_melts, m.audit_n_errors`,
      [url]
    )
    const row = statsRes.rows[0]
    if (row) {
      const total = Number(row.total)
      const onlineCount = Number(row.online_count)
      const uptimePct = total === 0
        ? (online ? 100 : 0)
        : Math.round((onlineCount / total) * 100)
      const trustScore = computeServerTrustScore(
        uptimePct,
        row.nut_count as number | null,
        row.version as string | null,
        row.audit_n_mints as number | null,
        row.audit_n_melts as number | null,
        row.audit_n_errors as number | null
      )
      await pool.query(
        `UPDATE mints SET last_trust_score = $1, last_error = $2 WHERE url = $3`,
        [trustScore, lastError, url]
      )
    }
  } catch { /* ignore trust score errors */ }
}

export async function pruneOldHistory(): Promise<void> {
  await pool.query(
    `DELETE FROM mint_history
     WHERE checked_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
  )
}

export async function getKnownMints(): Promise<string[]> {
  const res = await pool.query('SELECT url FROM mints')
  return res.rows.map(r => r.url as string)
}

export async function upsertMint(url: string, name?: string, isKnown = false): Promise<void> {
  await pool.query(
    `INSERT INTO mints (url, name, is_known)
     VALUES ($1, $2, $3)
     ON CONFLICT (url) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, mints.name),
       is_known = mints.is_known OR EXCLUDED.is_known`,
    [url, name ?? null, isKnown]
  )
}
