import type { AuditCzDetail } from '@/hooks/useAuditCz'
import { truncateText } from '@/utils/auditCz'

// Formatters of the Overview "Network" card (public network facts about the mint host, from the
// cashu.info detail our backend stores). Pure. Every input is untrusted text or a number and is
// only ever rendered as text. There is no address anywhere: the source sends none and we store none.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SOON_DAYS = 14
const NETWORK_NAME_MAX = 48

/** "IPv4 only", "IPv6 only" or "IPv4 and IPv6"; null (row hidden) when both are false or either is unknown. */
export function ipLabel(ipv4: boolean | undefined, ipv6: boolean | undefined): string | null {
  if (typeof ipv4 !== 'boolean' || typeof ipv6 !== 'boolean') return null
  if (ipv4 && ipv6) return 'IPv4 and IPv6'
  if (ipv4) return 'IPv4 only'
  if (ipv6) return 'IPv6 only'
  return null
}

/** "AS14061 DigitalOcean": the name is what follows the first " - " (else the whole text), cut at the first comma, capped at 48 characters. */
export function networkLabel(asn: number | undefined, asName: string | undefined): string | null {
  let name = typeof asName === 'string' ? asName : ''
  const dash = name.indexOf(' - ')
  if (dash >= 0) name = name.slice(dash + 3)
  const comma = name.indexOf(',')
  if (comma >= 0) name = name.slice(0, comma)
  name = truncateText(name.replace(/\s+/g, ' ').trim(), NETWORK_NAME_MAX)
  const as = typeof asn === 'number' && Number.isFinite(asn) ? `AS${asn}` : ''
  const out = [as, name].filter(Boolean).join(' ')
  return out === '' ? null : out
}

/** English country name from the two-letter code; the code itself when the name is unknown. null without a usable code. */
export function countryName(code: string | undefined): string | null {
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) return null
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code)
    return name && name !== 'Unknown Region' ? name : code
  } catch {
    return code
  }
}

export function torLabel(onion: boolean | undefined): string | null {
  return onion === true ? 'Onion address available' : onion === false ? 'No onion address' : null
}

export interface TlsLabel {
  text: string
  state: 'ok' | 'soon' | 'expired'
  /** Appended in the warning colour when fewer than 14 days remain. */
  suffix: string | null
}

const dayLabel = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "{issuer}, expires 27 Dec 2026"; "…, expired 27 Dec 2026" once the date has passed; "expires soon" appended under 14 days. */
export function tlsLabel(issuer: string | undefined, expiresAt: string | undefined, now: number): TlsLabel | null {
  const t = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : NaN
  const hasDate = Number.isFinite(t)
  if (!issuer && !hasDate) return null
  if (!hasDate) return { text: issuer as string, state: 'ok', suffix: null }
  const expired = t < now
  const soon = !expired && t - now < SOON_DAYS * 86_400_000
  const when = `${expired ? 'expired' : 'expires'} ${dayLabel(t)}`
  return {
    text: issuer ? `${issuer}, ${when}` : `${when.charAt(0).toUpperCase()}${when.slice(1)}`,
    state: expired ? 'expired' : soon ? 'soon' : 'ok',
    suffix: soon ? 'expires soon' : null,
  }
}

export interface NetworkRows {
  ip: string | null
  network: string | null
  country: { name: string } | null
  tor: string | null
  tls: TlsLabel | null
}

/** null when the detail has no network block (the card is not rendered). */
export function networkRows(detail: AuditCzDetail | null | undefined, now: number): NetworkRows | null {
  const n = detail?.network
  if (!n) return null
  const country = countryName(n.country)
  const rows: NetworkRows = {
    ip: ipLabel(n.ipv4, n.ipv6),
    network: networkLabel(n.asn, n.asName),
    country: country ? { name: country } : null,
    tor: torLabel(detail?.onion),
    tls: tlsLabel(n.tlsIssuer, n.tlsExpiresAt, now),
  }
  return Object.values(rows).some(v => v !== null) ? rows : null
}
