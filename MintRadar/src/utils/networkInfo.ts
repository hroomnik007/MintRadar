import type { AuditCzDetail } from '@/hooks/useAuditCz'
import { truncateText } from '@/utils/auditCz'

// Formatters of the Overview "Network" card (public network facts about the mint host, from the
// cashu.info detail our backend stores). Pure. Every input is untrusted text or a number and is
// only ever rendered as text. The IPv4 address is resolved by our own backend (the source sends none).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SOON_DAYS = 14
const NETWORK_NAME_MAX = 48

/** The mint host's IPv4 address as sent by our backend; anything that is not a plain dotted IPv4 address is dropped. */
export function ipv4Address(v: string | null | undefined): string | null {
  return typeof v === 'string' && /^(\d{1,3})(\.\d{1,3}){3}$/.test(v) && v.split('.').every(n => Number(n) <= 255) ? v : null
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

/** null when there is nothing to show (the card is not rendered). `ip` is our own DNS result; the rest comes from the cashu.info detail. An offline mint without an address shows "Offline" in the IP row. */
export function networkRows(detail: AuditCzDetail | null | undefined, ip: string | null | undefined, now: number, offline = false): NetworkRows | null {
  const n = detail?.network
  const country = countryName(n?.country)
  const rows: NetworkRows = {
    ip: ipv4Address(ip) ?? (offline ? 'Offline' : null),
    network: networkLabel(n?.asn, n?.asName),
    country: country ? { name: country } : null,
    tor: n ? torLabel(detail?.onion) : null,
    tls: tlsLabel(n?.tlsIssuer, n?.tlsExpiresAt, now),
  }
  return Object.values(rows).some(v => v !== null) ? rows : null
}
