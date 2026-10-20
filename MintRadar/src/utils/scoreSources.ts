// The muted line under each Reliability Score breakdown row: "source · window · sample · time". Every value is a
// real one (a constant, a count the page has, a stored timestamp); a part that is not known is left out, never guessed.
import { auditDataState, AUDIT_MIN_SAMPLES } from './auditScore'
import { PROBE_LOCATION } from '@/constants/probeLocation'
import { UPTIME_WINDOW_HOURS, AUDIT_WINDOW_DAYS } from './tooltipTexts'
import { formatTimeAgo } from './mintFormatting'
import { formatDateTimeUtc } from './formatDate'

export interface SourceTime {
  /** "last probe", "synced", "fetched" */
  verb: string
  /** Relative time ("3 min ago"). */
  label: string
  /** Absolute time for the title attribute ("29 Sep 2026, 14:05 UTC"). */
  title: string
}

export interface SourceLine {
  /** source, window and sample, joined by " · " when shown. */
  parts: string[]
  time: SourceTime | null
}

function timeOf(verb: string, iso: string | null | undefined, now: number): SourceTime | null {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  return { verb, label: formatTimeAgo(d, now), title: formatDateTimeUtc(d) }
}

export function uptimeSourceLine(i: { checks: number | null; lastProbeAt: string | null | undefined; now: number }): SourceLine {
  const parts = [`our probes from ${PROBE_LOCATION}`, `${UPTIME_WINDOW_HOURS} h`]
  if (i.checks !== null) parts.push(`${i.checks} ${i.checks === 1 ? 'check' : 'checks'}`)
  return { parts, time: timeOf('last probe', i.lastProbeAt, i.now) }
}

export function auditSourceLine(i: {
  blamed: number | null | undefined
  total: number | null | undefined
  fetchedAt: string | null | undefined
  now: number
}): SourceLine {
  const parts = ['cashu.info', `${AUDIT_WINDOW_DAYS} days`]
  const state = auditDataState(i.blamed, i.total, i.fetchedAt, i.now)
  const swaps = typeof i.total === 'number' ? `${i.total} ${i.total === 1 ? 'swap' : 'swaps'}` : null
  if (state === 'scored' && swaps) parts.push(swaps)
  else if (state === 'too-few' && swaps) parts.push(`${swaps}, fewer than ${AUDIT_MIN_SAMPLES} (neutral)`)
  else if (state === 'too-old') parts.push(`detail older than ${AUDIT_WINDOW_DAYS} days (neutral)`)
  else if (state === 'no-data') parts.push('no data (neutral)')
  return { parts, time: state === 'no-data' ? null : timeOf('synced', i.fetchedAt, i.now) }
}

/** NUT support, Version and Contact: all read from the mint's own /v1/info. */
export function infoSourceLine(i: { fetchedAt: string | null | undefined; now: number; comparedWithLatest?: boolean }): SourceLine {
  const parts = ['declared by the mint in /v1/info']
  if (i.comparedWithLatest) parts.push('compared with the newest stable release')
  return { parts, time: timeOf('fetched', i.fetchedAt, i.now) }
}

/** Plain text of a line (tests, aria). */
export function sourceLineText(l: SourceLine): string {
  return [...l.parts, ...(l.time ? [`${l.time.verb} ${l.time.label}`] : [])].join(' · ')
}
