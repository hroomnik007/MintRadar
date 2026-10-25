// The dates Mint Detail shows next to the data a change is about: when a keyset became active / inactive, since when an input
// fee holds (and the previous fees), when the public key or the MOTD last changed. Read from /api/mints/changes
// (utils/mintChangeLog.ts); the observation and confirmation rules stay in backend/src/mintChanges.ts. A confirmed change is
// dated by when its new value was first seen (the confirming check follows one interval later); a value seen once only is
// never a date, it is the muted "seen <time>, not confirmed yet" tag. Short local date in the row, local + UTC in the title.
import { formatDate, formatDateTimeUtc } from './formatDate'
import { formatTimeAgo } from './mintFormatting'
import { feeUnitLabel, formatFeeRate } from './feesLimits'
import { MULTIPLE_CHANGES_TEXT, type MintChange, type MintChangesData, type PendingMintChange } from './mintChangeLog'

/** A date for the row ("23 Oct", with the year when it is not the current one) and its full title (local and UTC). */
export interface DateMark {
  iso: string
  label: string
  title: string
}

/** A value seen once, not confirmed: "seen 2h ago, not confirmed yet". */
export interface PendingMark {
  iso: string
  text: string
  title: string
}

export const NOT_CONFIRMED = 'not confirmed yet'

const two = (n: number) => String(n).padStart(2, '0')

/** "23 Oct 2026, 14:05" in the viewer's time zone. */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return `${formatDate(d, { local: true })}, ${two(d.getHours())}:${two(d.getMinutes())}`
}

export function dateMark(iso: string, now: number = Date.now()): DateMark {
  const sameYear = new Date(iso).getFullYear() === new Date(now).getFullYear()
  return {
    iso,
    label: formatDate(iso, { local: true, year: !sameYear }),
    title: `${formatLocalDateTime(iso)} (your time) · ${formatDateTimeUtc(iso)}`,
  }
}

export function pendingMark(p: PendingMintChange, now: number = Date.now(), what?: string): PendingMark {
  return {
    iso: p.firstSeenAt,
    text: `seen ${formatTimeAgo(new Date(p.firstSeenAt), now)}, ${NOT_CONFIRMED}`,
    title: `${what ? `${what} ` : ''}seen once on ${formatLocalDateTime(p.firstSeenAt)} (your time) · ${formatDateTimeUtc(p.firstSeenAt)}; ${NOT_CONFIRMED} by a second check`,
  }
}

const ms = (iso: string): number => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN }
const isMerged = (c: MintChange): boolean => c.newValue === MULTIPLE_CHANGES_TEXT && c.oldValue === null
/** Oldest first; the route answers newest first. */
const chronological = (changes: readonly MintChange[]): MintChange[] =>
  [...changes].sort((a, b) => ms(a.firstSeenAt) - ms(b.firstSeenAt) || ms(a.observedAt) - ms(b.observedAt))
const latest = (changes: readonly MintChange[], type: string): MintChange | null => {
  const of = chronological(changes.filter(c => c.type === type && Number.isFinite(ms(c.firstSeenAt))))
  return of.length > 0 ? of[of.length - 1]! : null
}

// ── Keysets ──

/** "<id> (<unit>, active, 100 ppk)": the keyset text of a change is about this keyset. */
const aboutKeyset = (value: string | null, id: string): boolean => value !== null && value.startsWith(`${id} (`)
const keysetChange = (c: { oldValue: string | null; newValue: string | null }, id: string): boolean => aboutKeyset(c.newValue, id) || aboutKeyset(c.oldValue, id)

export interface KeysetDates {
  /** "Active since 21 Oct", "Active since before 20 Oct", "20 Oct – 23 Oct", "before 20 Oct – 23 Oct", "inactive, first seen inactive 20 Oct". */
  text: string
  title: string
}

/**
 * The dates of one keyset row. Active: since it was first seen active (a confirmed keyset_added / keyset_reactivated, else
 * the keysets check's first_seen_at); "before <tracking start>" when it was already there when tracking started. Inactive:
 * from that start to the confirmed keyset_deactivated; without a known deactivation, when it was first seen (inactive).
 * null when the route has nothing about the keyset.
 */
export function keysetDates(id: string, active: boolean, data: MintChangesData | null | undefined, now: number = Date.now()): KeysetDates | null {
  if (!data) return null
  // A keyset seen once (not confirmed) has no date yet: only the pending tag (keysetPending) shows.
  if (data.pending?.diff.some(c => c.type === 'keyset_added' && aboutKeyset(c.newValue, id))) return null
  const mine = chronological(data.changes.filter(c => !isMerged(c) && keysetChange(c, id) && Number.isFinite(ms(c.firstSeenAt))))
  const seen = data.keysetsSeen.find(k => k.id === id) ?? null
  const tracking = data.trackingSince !== null && Number.isFinite(ms(data.trackingSince)) ? data.trackingSince : null
  const deactivated = [...mine].reverse().find(c => c.type === 'keyset_deactivated') ?? null
  // The start of the (last) active period: a reactivation before the deactivation, else the addition, else the first sighting.
  const startChange = [...mine].reverse().find(c => (c.type === 'keyset_reactivated' || c.type === 'keyset_added')
    && (deactivated === null || active || ms(c.firstSeenAt) <= ms(deactivated.firstSeenAt))) ?? null
  const startIso = startChange?.firstSeenAt ?? seen?.firstSeenAt ?? null
  // Already there when tracking started: no change dates it, and it was first seen no later than the tracking start.
  const beforeTracking = startChange === null && tracking !== null && (startIso === null || ms(startIso) <= ms(tracking))
  const start = beforeTracking ? dateMark(tracking!, now) : startIso !== null ? dateMark(startIso, now) : null
  const startLabel = start ? `${beforeTracking ? 'before ' : ''}${start.label}` : null
  const startTitle = start ? (beforeTracking ? `Already there when MintRadar started tracking this mint on ${start.title}` : `First seen ${start.title}`) : null

  if (active) {
    if (!startLabel) return null
    return { text: `Active since ${startLabel}`, title: startTitle! }
  }
  if (deactivated !== null) {
    const to = dateMark(deactivated.firstSeenAt, now)
    return {
      text: `${startLabel ?? 'before'} – ${to.label}`.replace(/^before – /, 'until '),
      title: [startTitle, `Inactive since ${to.title}`].filter(Boolean).join('; '),
    }
  }
  if (!seen) return null
  const first = dateMark(seen.firstSeenAt, now)
  return { text: `inactive, first seen inactive ${first.label}`, title: `First seen (already inactive) ${first.title}` }
}

/** A keyset change seen once that waits for its confirmation (added, deactivated, reactivated, ...), or null. */
export function keysetPending(id: string, data: MintChangesData | null | undefined, now: number = Date.now()): PendingMark | null {
  const p = data?.pending?.diff.find(c => c.type.startsWith('keyset_') && keysetChange(c, id))
  if (!p) return null
  const what = p.type === 'keyset_added' ? 'New keyset' : p.type === 'keyset_deactivated' ? 'Deactivation' : p.type === 'keyset_reactivated' ? 'Reactivation' : 'Change'
  return pendingMark(p, now, what)
}

// ── Fees ──

/** "sat: 100 ppk, usd: 0 ppk" -> {sat: 100, usd: 0}; "none" -> {}; anything else (a merged day row) -> null. */
export function parseFeeText(v: string | null): Record<string, number> | null {
  if (v === null || v === 'none') return {}
  const out: Record<string, number> = {}
  for (const part of v.split(',')) {
    const m = /^\s*(.+?):\s*(\d+)\s*ppk\s*$/.exec(part)
    if (!m) return null
    out[m[1]!] = Number(m[2])
  }
  return out
}

/** "100 ppk · 0.1 sat per coin", or "No input fee" for 0. */
export function feeValueText(ppk: number, unit: string): string {
  return ppk === 0 ? 'No input fee' : `${ppk} ppk · ${formatFeeRate(ppk)} ${feeUnitLabel(unit)} per coin`
}

export interface FeeHistoryRow {
  ppk: number
  /** "100 ppk · 0.1 sat per coin · 20 Oct – 23 Oct" */
  text: string
  title: string
}

export interface FeeDates {
  /** Set when a fee change of the unit was confirmed: "since <date>". */
  since: DateMark | null
  /** Set when no change of the unit was recorded since tracking started: "unchanged since <date>". */
  unchangedSince: DateMark | null
  /** The previous values, newest first. */
  history: FeeHistoryRow[]
  pending: PendingMark | null
}

/** The fee dates of one unit of the Fees and limits card; null when the route has nothing for the mint. */
export function feeDates(unit: string, data: MintChangesData | null | undefined, now: number = Date.now()): FeeDates | null {
  if (!data) return null
  const transitions: { at: string; oldPpk: number | undefined }[] = []
  let mergedAt: string | null = null
  for (const c of chronological(data.changes.filter(c => c.type === 'input_fee_changed' && Number.isFinite(ms(c.firstSeenAt))))) {
    if (isMerged(c)) { mergedAt = c.firstSeenAt; continue }
    const o = parseFeeText(c.oldValue), n = parseFeeText(c.newValue)
    if (o === null || n === null || o[unit] === n[unit]) continue
    transitions.push({ at: c.firstSeenAt, oldPpk: o[unit] })
  }
  const lastAt = transitions.length > 0 ? transitions[transitions.length - 1]!.at : null
  // A day with more than 20 fee changes is one row without values: it may have changed the unit, so it dates "since" when newer.
  const sinceIso = mergedAt !== null && (lastAt === null || ms(mergedAt) > ms(lastAt)) ? mergedAt : lastAt
  const tracking = data.trackingSince !== null && Number.isFinite(ms(data.trackingSince)) ? data.trackingSince : null
  const history: FeeHistoryRow[] = []
  transitions.forEach((t, i) => {
    if (t.oldPpk === undefined) return
    const to = dateMark(t.at, now)
    const fromIso = i > 0 ? transitions[i - 1]!.at : tracking
    const from = fromIso !== null ? dateMark(fromIso, now) : null
    const range = from ? `${i === 0 ? 'before ' : ''}${from.label} – ${to.label}` : `until ${to.label}`
    history.unshift({
      ppk: t.oldPpk,
      text: `${feeValueText(t.oldPpk, unit)} · ${range}`,
      title: `${from ? `${i === 0 ? 'Already the fee when tracking started, ' : 'From '}${from.title}` : ''}${from ? '; ' : ''}until ${to.title}`,
    })
  })
  const p = data.pending?.diff.find(c => {
    if (c.type !== 'input_fee_changed') return false
    const o = parseFeeText(c.oldValue), n = parseFeeText(c.newValue)
    return o !== null && n !== null && o[unit] !== n[unit]
  })
  const newPpk = p ? parseFeeText(p.newValue)?.[unit] : undefined
  return {
    since: sinceIso !== null ? dateMark(sinceIso, now) : null,
    unchangedSince: sinceIso === null && tracking !== null ? dateMark(tracking, now) : null,
    history,
    pending: p ? pendingMark(p, now, newPpk !== undefined ? `New fee ${feeValueText(newPpk, unit)}` : 'Fee change') : null,
  }
}

// ── Mint info ──

export interface InfoDates {
  /** The last confirmed change of the field, or null (none recorded). */
  changed: DateMark | null
  pending: PendingMark | null
}

const INFO_TYPES = { pubkey: 'pubkey_changed', motd: 'motd_changed', name: 'name_changed', description: 'description_changed' } as const
export type InfoField = keyof typeof INFO_TYPES

/** The last confirmed change of a /v1/info field (pubkey, motd, name, description) and a value of it seen once. */
export function infoDates(field: InfoField, data: MintChangesData | null | undefined, now: number = Date.now()): InfoDates {
  if (!data) return { changed: null, pending: null }
  const type = INFO_TYPES[field]
  const c = latest(data.changes, type)
  const p = data.pending?.diff.find(d => d.type === type) ?? null
  return { changed: c ? dateMark(c.firstSeenAt, now) : null, pending: p ? pendingMark(p, now, 'A new value') : null }
}

/** The title of a name / description value: the date lives only there (no new row). undefined when nothing is recorded. */
export function infoTitle(d: InfoDates): string | undefined {
  const parts = [d.changed ? `Last changed ${d.changed.title}` : null, d.pending ? d.pending.title : null].filter(Boolean)
  return parts.length > 0 ? parts.join('; ') : undefined
}
