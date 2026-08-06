import dns from 'dns'
import { fetch as undiciFetch } from 'undici'
import { pool } from './db.js'
import { checkUrlSafety, safeFetch } from './ssrf.js'
import { auditReliabilityScore } from './shared/auditScore.js'

function isCloudflareIP(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => isNaN(n))) return false
  const a = parts[0]!, b = parts[1]!, c = parts[2]!
  if (a === 172 && b >= 64 && b <= 71) return true          // 172.64.0.0/13
  if (a === 188 && b === 114 && c >= 96 && c <= 111) return true  // 188.114.96.0/20
  if (a === 104 && b >= 16 && b <= 23) return true          // 104.16.0.0/13
  return false
}

async function lookupServerLocation(mintUrl: string): Promise<string | null> {
  try {
    const hostname = new URL(mintUrl).hostname
    console.log(`[geo] looking up: ${hostname}`)
    const { address } = await dns.promises.lookup(hostname)
    console.log(`[geo] ${hostname} resolved to ${address}`)
    const res = await undiciFetch(`https://ipinfo.io/${address}/json`, {
      signal: AbortSignal.timeout(5_000),
    }) as unknown as Response
    if (!res.ok) {
      console.log(`[geo] ipinfo.io returned HTTP ${res.status} for ${hostname}`)
      return null
    }
    const data = await res.json() as Record<string, unknown>
    if (data['bogon'] === true) {
      console.log(`[geo] ${hostname} is bogon — skipping`)
      return null
    }
    const city = typeof data['city'] === 'string' ? data['city'] : null
    const country = typeof data['country'] === 'string' ? data['country'] : null
    if (!city && !country) {
      console.log(`[geo] no city/country in ipinfo response for ${hostname}`)
      return null
    }
    if (city === 'San Francisco' && isCloudflareIP(address)) {
      console.log(`[geo] ${hostname} (${address}) detected as Cloudflare CDN`)
      return 'Cloudflare CDN'
    }
    const location = [city, country].filter(Boolean).join(', ')
    console.log(`[geo] ${hostname} → ${location}`)
    return location
  } catch (err) {
    console.error(`[geo] lookup error for ${mintUrl}:`, err)
    return null
  }
}

export async function backfillServerLocations(): Promise<void> {
  try {
    const res = await pool.query('SELECT url FROM mints WHERE server_location IS NULL')
    const urls = (res.rows as { url: string }[]).map(r => r.url)
    console.log(`[geo] backfill: ${urls.length} mints with NULL server_location`)
    let found = 0
    for (const mintUrl of urls) {
      const location = await lookupServerLocation(mintUrl)
      if (location !== null) {
        await pool.query('UPDATE mints SET server_location = $1 WHERE url = $2', [location, mintUrl])
        found++
      }
      await new Promise<void>(resolve => setTimeout(resolve, 150))
    }
    console.log(`[geo] backfill complete: ${found}/${urls.length} locations populated`)
  } catch (err) {
    console.error('[geo] backfill error:', err)
  }
}

const PROBE_TIMEOUT_MS = 10000
const RETENTION_DAYS = 90

// [major, minor] descending — newest first
const SERVER_NUTSHELL_VERSIONS: [number, number][] = [
  [0, 16], [0, 15], [0, 14], [0, 13], [0, 12], [0, 11],
]

export function serverVersionFreshnessScore(v: string | null | undefined): number {
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

export function computeServerTrustScore(
  uptimePct: number,
  nutCount: number | null,
  version: string | null,
  contactCount: number,
  auditRecentTotal: number | null,
  auditRecentErrors: number | null
): number {
  const uScore = Math.round(uptimePct * 0.45)
  const nScore = Math.round(Math.min((nutCount ?? 0) / 25, 1) * 30)
  const vScore = Math.round(serverVersionFreshnessScore(version) / 10 * 15)
  const cScore = Math.round((contactCount / 3) * 5)
  const aScore = auditReliabilityScore(auditRecentTotal, auditRecentErrors)
  return Math.min(100, Math.round(uScore + nScore + vScore + cScore + aScore))
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
  const urlSafety = await checkUrlSafety(url)
  if (urlSafety === 'blocked') {
    if (process.env['NODE_ENV'] !== 'production') {
      console.warn('[prober] blocked unsafe URL:', url)
    }
    return
  }
  if (urlSafety === 'dns-error') {
    // DNS failure is not an SSRF attempt — record the mint as offline so
    // uptime history and the degraded flag remain accurate.
    await pool.query(
      `INSERT INTO mint_history (url, online, latency_ms, checked_at) VALUES ($1, false, NULL, NOW())`,
      [url]
    )
    await pool.query(
      `UPDATE mints SET last_error = $1 WHERE url = $2`,
      ['DNS resolution failed', url]
    )
    return
  }

  const start = Date.now()
  let online = false
  let latencyMs: number | null = null
  let lastError: string | null = null
  let capturedErr: unknown = null
  let contactCount = 0

  try {
    let res = await safeFetch(`${url}/v1/info`, {
      timeoutMs: PROBE_TIMEOUT_MS,
      onError: (err) => { capturedErr = err },
    })

    // Retry once on network/DNS failure (res === null) — avoids false-positive offline
    if (res === null) {
      await new Promise<void>(r => setTimeout(r, 1000))
      capturedErr = null
      res = await safeFetch(`${url}/v1/info`, {
        timeoutMs: PROBE_TIMEOUT_MS,
        onError: (err) => { capturedErr = err },
      })
    }

    if (res && res.ok) {
      try {
        const raw = await res.json() as Record<string, unknown>
        const nuts = raw['nuts'] !== null && typeof raw['nuts'] === 'object' ? raw['nuts'] as Record<string, unknown> : null
        if (nuts === null) {
          lastError = 'Invalid Cashu response'
        } else {
          online = true
          latencyMs = Date.now() - start
          const iconUrl = typeof raw['icon_url'] === 'string' && raw['icon_url'].startsWith('https://')
            ? raw['icon_url']
            : null
          const version = typeof raw['version'] === 'string' ? raw['version'] : null
          const tosUrl = typeof raw['tos_url'] === 'string' ? raw['tos_url'] : null
          const descriptionLong = typeof raw['description_long'] === 'string' ? raw['description_long'] : null
          const nutCount = Object.keys(nuts).length
          const nameRaw = typeof raw['name'] === 'string' ? raw['name'].trim().slice(0, 100) : null
          const name = nameRaw && nameRaw.length > 0 ? nameRaw : null

          const contactArr = Array.isArray(raw['contact']) ? raw['contact'] as Array<{ method: string }> : []
          contactCount = contactArr.filter(c => c.method === 'email' || c.method === 'twitter' || c.method === 'nostr').length

          const storedVersionRes = await pool.query('SELECT version FROM mints WHERE url = $1', [url])
          const storedVersion = storedVersionRes.rows[0]?.version as string | null

          await pool.query(
            `UPDATE mints SET
              name             = COALESCE($1, name),
              icon_url         = COALESCE($2, icon_url),
              version          = COALESCE($3, version),
              nut_count        = COALESCE($4, nut_count),
              tos_url          = COALESCE($5, tos_url),
              description_long = COALESCE($6, description_long),
              nuts_limits      = COALESCE($7::jsonb, nuts_limits)
            WHERE url = $8`,
            [name, iconUrl, version, nutCount, tosUrl, descriptionLong, JSON.stringify(nuts), url]
          )

          if (version !== null && version !== storedVersion) {
            await pool.query(
              `INSERT INTO mint_version_history (url, version, first_seen_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (url, version) DO NOTHING`,
              [url, version]
            )
          }

        }
      } catch { lastError = 'Invalid JSON response' }

      // Geo-IP lookup — isolated so errors never affect probe result or lastError
      if (online) {
        try {
          const locRow = await pool.query('SELECT server_location FROM mints WHERE url = $1', [url])
          const currentLoc = locRow.rows[0]?.server_location as string | null | undefined
          if (currentLoc == null) {
            const location = await lookupServerLocation(url)
            if (location !== null) {
              await pool.query('UPDATE mints SET server_location = $1 WHERE url = $2', [location, url])
            }
          }
        } catch (err) {
          console.error('[geo] db error during location update:', err)
        }
      }
    } else if (res && res.status === 429) {
      // Rate-limited — mint is up, just throttling us. Skip this probe cycle
      // entirely rather than recording a false-positive offline.
      return
    } else if (res && [502, 503, 504].includes(res.status)) {
      // Likely a transient server-side blip (restart/deploy) — retry once
      // before concluding the mint is offline.
      await new Promise<void>(r => setTimeout(r, 2000))
      const retryRes = await safeFetch(`${url}/v1/info`, {
        timeoutMs: PROBE_TIMEOUT_MS,
        onError: (err) => { capturedErr = err },
      })
      if (retryRes && retryRes.ok) {
        try {
          const raw = await retryRes.json() as Record<string, unknown>
          const nuts = raw['nuts'] !== null && typeof raw['nuts'] === 'object' ? raw['nuts'] as Record<string, unknown> : null
          if (nuts === null) {
            lastError = 'Invalid Cashu response'
          } else {
            online = true
            latencyMs = Date.now() - start
          }
        } catch { lastError = 'Invalid JSON response' }
      } else if (retryRes && !retryRes.ok) {
        lastError = `HTTP ${retryRes.status}`
      } else {
        lastError = classifyFetchError(capturedErr)
      }
    } else if (res && !res.ok) {
      lastError = `HTTP ${res.status}`
    } else {
      lastError = classifyFetchError(capturedErr)
    }
  } catch {
    lastError = 'Unreachable'
  }

  const histInsert = await pool.query(
    `INSERT INTO mint_history (url, online, latency_ms, checked_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id`,
    [url, online, latencyMs]
  )
  const histId: number | undefined = histInsert.rows[0]?.id as number | undefined

  try {
    const statsRes = await pool.query(
      `SELECT
        m.nut_count, m.version,
        m.audit_recent_total, m.audit_recent_errors,
        COUNT(h.online) AS total,
        COALESCE(SUM(CASE WHEN h.online THEN 1 ELSE 0 END), 0) AS online_count
       FROM mints m
       LEFT JOIN mint_history h
         ON h.url = m.url AND h.checked_at > NOW() - INTERVAL '24 hours'
       WHERE m.url = $1
       GROUP BY m.nut_count, m.version, m.audit_recent_total, m.audit_recent_errors`,
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
        contactCount,
        row.audit_recent_total as number | null,
        row.audit_recent_errors as number | null
      )
      await pool.query(
        `UPDATE mints SET last_trust_score = $1, last_error = $2 WHERE url = $3`,
        [trustScore, lastError, url]
      )
      if (histId !== undefined) {
        await pool.query(
          `UPDATE mint_history SET trust_score = $1 WHERE id = $2`,
          [trustScore, histId]
        )
      }
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
