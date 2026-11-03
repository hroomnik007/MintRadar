// Compare modal rows built from facts the modal already has: the five points of the stored Reliability Score, the contact
// KINDS a mint lists (never an address) and the NIP-87 announcement. Pure functions, no request: the stored breakdown and the
// announcement fields come with /api/mints/known, the contact kinds from the probe answer the modal already fetches for the
// Input fee row. Facts only, no judging words.
import type { KnownMint } from '@/hooks/useKnownMints'
import type { BreakdownPart } from '@/utils/mintDetailFacts'
import { auditDataState } from '@/utils/auditScore'
import { UPTIME_POINTS, AUDIT_POINTS, NUT_POINTS, VERSION_POINTS, CONTACT_POINTS } from '@/utils/tooltipTexts'
import { nip87AnnouncementOf } from '@/utils/nip87Announcement'
import { formatDate } from '@/utils/formatDate'
import type { ContactCheckFact } from '@/utils/contactChecks'

export const SCORE_PART_ROWS: ReadonlyArray<{ id: string; part: BreakdownPart; label: string; max: number }> = [
  { id: 'uptime-points', part: 'uptime', label: 'Uptime points', max: UPTIME_POINTS },
  { id: 'audit-points', part: 'audit', label: 'Audit points', max: AUDIT_POINTS },
  { id: 'nut-points', part: 'nuts', label: 'NUT support points', max: NUT_POINTS },
  { id: 'version-points', part: 'version', label: 'Version points', max: VERSION_POINTS },
  { id: 'contact-points', part: 'contact', label: 'Contact points', max: CONTACT_POINTS },
]
export const COMPARE_CONTACT_LABEL = 'Contact methods'
export const COMPARE_NIP87_LABEL = 'NIP-87 announcement'
export const COMPARE_NO_VALUE = '—'
export const COMPARE_NONE_LISTED = 'None listed'
export const COMPARE_NIP87_NOT_SEEN = 'Not seen on our relays'

/**
 * "<points> / <max>" of one score component, from the record stored with the score (the one Mint Detail's breakdown prefers:
 * `scoreBreakdown`, only for a mint that has a stored score). No stored score or no stored record: "—". The audit part says
 * "· neutral" while its data is too thin or too old to score (the word of the Mint Detail row), so the points are not read as measured.
 */
export function scorePointsText(mint: KnownMint, part: BreakdownPart, now: number): string {
  const row = SCORE_PART_ROWS.find(r => r.part === part)!
  const stored = mint.reliabilityScore != null ? (mint.scoreBreakdown ?? null) : null
  if (!stored) return COMPARE_NO_VALUE
  const text = `${stored[part].points} / ${row.max}`
  if (part === 'audit' && auditDataState(mint.auditCzBlamed ?? null, mint.auditCzTotal ?? null, mint.auditCzFetchedAt ?? null, now) !== 'scored') return `${text} · neutral`
  return text
}

const KIND_LABEL: Record<string, string> = { email: 'Email', twitter: 'Twitter', nostr: 'Nostr' }
const KIND_ORDER = ['email', 'twitter', 'nostr']
export const CONTACT_KIND_MAX_CHARS = 24
export const CONTACT_KINDS_MAX = 12
const CONTACT_ENTRIES_MAX = 50

/** A contact kind name from a mint (untrusted): control and bidi characters out, one line, capped. '' when nothing is left. */
export function cleanContactKind(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > CONTACT_KIND_MAX_CHARS ? `${s.slice(0, CONTACT_KIND_MAX_CHARS - 1)}…` : s
}

/**
 * The kinds named by a list of contact entries ("email", "twitter", "nostr", anything else as stated), de-duplicated without
 * regard to case, the known three first in a fixed order, the rest alphabetically. Names only, never the `info` value.
 */
export function contactKindsOf(methods: ReadonlyArray<string | null | undefined> | null | undefined): string[] {
  const seen = new Map<string, string>() // lower-case key -> label
  for (const m of (methods ?? []).slice(0, CONTACT_ENTRIES_MAX)) {
    const clean = cleanContactKind(m)
    if (clean === '') continue
    const key = clean.toLowerCase()
    if (!seen.has(key)) seen.set(key, KIND_LABEL[key] ?? clean)
  }
  const known = KIND_ORDER.filter(k => seen.has(k)).map(k => seen.get(k)!)
  const others = [...seen.entries()].filter(([k]) => !KIND_ORDER.includes(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v)
  return [...known, ...others].slice(0, CONTACT_KINDS_MAX)
}

/** The probe answer fields the contact row reads. */
export interface ContactProbe {
  online: boolean
  info: { contact?: Array<{ method: string }> } | null
  lastContacts?: ReadonlyArray<{ method: string }>
  contactChecks?: ReadonlyArray<Pick<ContactCheckFact, 'kind'>>
}

/**
 * "Email · Twitter · Nostr", or "None listed". Source order: the live /v1/info contact list, else the last published one the
 * probe answer carries for a known mint, else the kinds of the last contact checks. null = not known: a mint that did not
 * answer and has no stored contact data (the row then says "n/a", never "None listed").
 */
export function contactMethodsText(p: ContactProbe): string | null {
  const live = p.info?.contact
  const source = Array.isArray(live) ? live.map(c => c?.method)
    : p.lastContacts && p.lastContacts.length > 0 ? p.lastContacts.map(c => c?.method)
    : p.contactChecks && p.contactChecks.length > 0 ? p.contactChecks.map(c => c?.kind)
    : null
  if (source === null) return p.online ? COMPARE_NONE_LISTED : null
  const kinds = contactKindsOf(source)
  return kinds.length > 0 ? kinds.join(' · ') : COMPARE_NONE_LISTED
}

/** "Seen · event dated 14 Mar 2026" for a stored announcement, "Not seen on our relays" otherwise. No key match, no check time. */
export function nip87RowText(mint: Pick<KnownMint, 'nostrAnnouncedAt' | 'nostrAnnounceD' | 'pubkey' | 'nostrCheckedAt'>): string {
  const f = nip87AnnouncementOf({ announcedAt: mint.nostrAnnouncedAt, announceD: mint.nostrAnnounceD, infoPubkey: mint.pubkey, checkedAt: mint.nostrCheckedAt })
  if (f.announcement !== 'seen') return COMPARE_NIP87_NOT_SEEN
  const date = formatDate(f.eventCreatedAt)
  return date ? `Seen · event dated ${date}` : 'Seen'
}
