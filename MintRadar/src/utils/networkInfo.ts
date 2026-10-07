import type { KnownMint } from '@/hooks/useKnownMints'
import { truncateText } from '@/utils/auditCz'

// Formatters of the Overview "Network" card (public network facts about the mint host). Everything is
// measured by our own backend: IPv4 from DNS, AS number / organisation / country from the ipinfo.io lookup
// that also gives the city, the onion flag from the mint's own /v1/info. Pure. Every input is untrusted text
// or a number and is only ever rendered as text.

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

export interface NetworkRows {
  ip: string | null
  network: string | null
  country: { name: string } | null
  tor: string | null
}

/** null when there is nothing to show (the card is not rendered). An offline mint without an address shows "Offline" in the IP row. */
export function networkRows(m: Partial<Pick<KnownMint, 'ipAddress' | 'netAsn' | 'netOrg' | 'netCountry' | 'hasOnion' | 'online'>> | null | undefined): NetworkRows | null {
  const country = countryName(m?.netCountry ?? undefined)
  const rows: NetworkRows = {
    ip: ipv4Address(m?.ipAddress) ?? (m?.online === false ? 'Offline' : null),
    network: networkLabel(m?.netAsn ?? undefined, m?.netOrg ?? undefined),
    country: country ? { name: country } : null,
    tor: torLabel(m?.hasOnion ?? undefined),
  }
  return Object.values(rows).some(v => v !== null) ? rows : null
}
