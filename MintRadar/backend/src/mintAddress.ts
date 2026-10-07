// Public IPv4 address of every tracked mint's host, resolved by US from public DNS (independent of
// cashu.info, so it covers mints no audit service knows). Display only; never feeds the score.
// IPv6 is deliberately not kept. A failed lookup changes nothing (the last known address stays);
// a host whose A records are all private/reserved clears the address.
import { resolve4 } from 'dns/promises'
import { isIP } from 'net'
import { pool } from './db.js'
import { isBlockedIpString } from './ssrf.js'

/** undefined = lookup failed (keep what we have); null = no usable public IPv4 (onion host, IP literal, only private answers). */
export async function resolveMintIpv4(mintUrl: string): Promise<string | null | undefined> {
  let host: string
  try { host = new URL(mintUrl).hostname.toLowerCase() } catch { return null }
  if (host === '' || host.endsWith('.onion') || host.startsWith('[') || isIP(host) !== 0) return null
  let list: string[]
  try { list = await resolve4(host) } catch (err) {
    // A host that has no A record at all is a definite "no IPv4"; any other error is a failed lookup.
    const code = (err as { code?: string }).code
    return code === 'ENODATA' ? null : undefined
  }
  return list.find(a => isIP(a) === 4 && !isBlockedIpString(a)) ?? null
}

export async function refreshMintAddresses(resolve: (u: string) => Promise<string | null | undefined> = resolveMintIpv4): Promise<{ checked: number; changed: number }> {
  const stats = { checked: 0, changed: 0 }
  try {
    const res = await pool.query('SELECT url, ip_address FROM mints')
    for (const row of res.rows as { url: string; ip_address: string | null }[]) {
      stats.checked++
      const ip = await resolve(row.url)
      if (ip !== undefined && ip !== row.ip_address) {
        await pool.query('UPDATE mints SET ip_address = $1 WHERE url = $2', [ip, row.url])
        stats.changed++
      }
    }
    console.log(`[ip] refresh: ${stats.changed} of ${stats.checked} addresses changed`)
  } catch (err) {
    console.error('[ip] refresh error:', err)
  }
  return stats
}
