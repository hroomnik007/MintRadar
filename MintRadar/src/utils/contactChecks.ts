// The muted "Contact checks" line on Mint Detail: facts about the contact entries a mint lists (kind, whether the value is
// recognised, whether the domain of an e-mail address has mail records in DNS, when it was checked), from the backend's
// contactChecks.ts. Neutral wording only: it states what was measured and never calls a contact verified, trusted, fake or
// "invalid" ("format not recognised" says what MintRadar understood, not that the contact is wrong).
// A value or a domain is never part of the data, so none can appear here.
import { formatTimeAgo } from './mintFormatting'
import { formatDateTimeUtc } from './formatDate'

export interface ContactCheckFact {
  kind: string
  formatValid: boolean
  /** E-mail only. null = not applicable, or the lookup failed or timed out (unknown, never "no records"). */
  domainResolves: boolean | null
  checkedAt: string
}

/** The probe answer's `contactChecks` as facts; entries of the wrong shape are dropped (never shown). */
export function readContactChecks(raw: unknown): ContactCheckFact[] {
  if (!Array.isArray(raw)) return []
  const out: ContactCheckFact[] = []
  for (const e of raw) {
    if (e === null || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    if (typeof r['kind'] !== 'string' || typeof r['formatValid'] !== 'boolean' || typeof r['checkedAt'] !== 'string') continue
    if (r['domainResolves'] !== null && typeof r['domainResolves'] !== 'boolean') continue
    out.push({ kind: r['kind'], formatValid: r['formatValid'], domainResolves: r['domainResolves'], checkedAt: r['checkedAt'] })
  }
  return out
}

const ORDER = ['email', 'nostr', 'twitter', 'x', 'telegram', 'signal', 'url', 'other']

/** What each kind is called in the line; the phrase is "<label> format recognised" or "<label> format not recognised". */
const LABEL: Record<string, string> = {
  email: 'email',
  nostr: 'Nostr contact',
  twitter: 'Twitter',
  x: 'X',
  telegram: 'Telegram',
  signal: 'Signal',
  url: 'website URL',
  other: 'other entry',
}

function formatPhrase(kind: string, valid: number, total: number): string {
  const label = LABEL[kind] ?? LABEL['other']
  if (total === 1) return `${label} format ${valid === 1 ? 'recognised' : 'not recognised'}`
  return `${label} format recognised for ${valid} of ${total}`
}

/** E-mail entries whose format is recognised: what DNS said about their domains. null when no entry has a result worth stating. */
function domainPhrase(emails: readonly ContactCheckFact[]): string | null {
  const ok = emails.filter(c => c.formatValid)
  if (ok.length === 0) return null
  const yes = ok.filter(c => c.domainResolves === true).length
  const no = ok.filter(c => c.domainResolves === false).length
  const unknown = ok.length - yes - no
  if (unknown === ok.length) return 'domain lookup inconclusive'
  if (ok.length === 1) return yes === 1 ? 'domain has mail records' : 'domain has no mail records'
  if (unknown === 0 && no === 0) return 'domains have mail records'
  if (unknown === 0 && yes === 0) return 'domains have no mail records'
  const parts = [`${yes} of ${ok.length} domains have mail records`]
  if (unknown > 0) parts.push(`${unknown} lookup inconclusive`)
  return parts.join(', ')
}

export interface ContactChecksLine {
  /** Segments joined by " · ", without the "Contact checks:" lead and the time. */
  segments: string[]
  /** "checked 3 min ago" parts: the relative label and the absolute UTC time for the title attribute. */
  checked: { label: string; title: string } | null
}

/** null when there is nothing to state (no checks): the page shows no line. */
export function contactChecksLine(checks: readonly ContactCheckFact[] | null | undefined, now: number): ContactChecksLine | null {
  if (!checks || checks.length === 0) return null
  const kinds = [...new Set(checks.map(c => (ORDER.includes(c.kind) ? c.kind : 'other')))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  const segments = kinds.map(kind => {
    const of = checks.filter(c => (ORDER.includes(c.kind) ? c.kind : 'other') === kind)
    const valid = of.filter(c => c.formatValid).length
    const text = formatPhrase(kind, valid, of.length)
    const domain = kind === 'email' ? domainPhrase(of) : null
    return domain ? `${text}, ${domain}` : text
  })
  const times = checks.map(c => Date.parse(c.checkedAt)).filter(Number.isFinite)
  const newest = times.length > 0 ? new Date(Math.max(...times)) : null
  return { segments, checked: newest ? { label: formatTimeAgo(newest, now), title: formatDateTimeUtc(newest) } : null }
}

/** Plain text of the line (tests, aria). */
export function contactChecksText(line: ContactChecksLine): string {
  return `Contact checks: ${line.segments.join(' · ')}${line.checked ? ` · checked ${line.checked.label}` : ''}`
}
