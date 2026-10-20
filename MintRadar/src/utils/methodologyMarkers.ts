import { METHODOLOGY_CHANGES, type MethodologyChange } from './methodology'
import { formatDate } from './formatDate'

// Where the Reliability Score methodology changed (METHODOLOGY_CHANGES), for the markers on the Reliability Score
// trend chart and the note under the movers. Entry 0 is the initial formula, not a change, so it is never marked.
// Dates are YYYY-MM-DD (UTC) like the chart's categories, so plain string comparison orders them.

const DAY_MS = 86_400_000

const realChanges = (changes: readonly MethodologyChange[]): MethodologyChange[] => changes.slice(1)

/** Changes dated between `from` and `to` (YYYY-MM-DD, both included), oldest first. */
export function methodologyChangesInRange(from: string, to: string, changes: readonly MethodologyChange[] = METHODOLOGY_CHANGES): MethodologyChange[] {
  return realChanges(changes).filter(c => c.date >= from && c.date <= to)
}

/** Changes inside the last `days` days up to `now` (UTC dates). */
export function methodologyChangesInWindow(days: number, now: number = Date.now(), changes: readonly MethodologyChange[] = METHODOLOGY_CHANGES): MethodologyChange[] {
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  return methodologyChangesInRange(iso(now - days * DAY_MS), iso(now), changes)
}

export interface TrendMarker {
  version: number
  /** The change date, YYYY-MM-DD. */
  date: string
  /** The chart point the marker sits on: the first data date on or after the change date. */
  at: string
}

/** Markers for a chart whose category dates are `dates` (ascending): changes inside the shown period only. */
export function trendMarkers(dates: readonly string[], changes: readonly MethodologyChange[] = METHODOLOGY_CHANGES): TrendMarker[] {
  const first = dates[0]
  const last = dates[dates.length - 1]
  if (first === undefined || last === undefined) return []
  return methodologyChangesInRange(first, last, changes).map(c => ({ version: c.version, date: c.date, at: dates.find(d => d >= c.date) ?? last }))
}

const shortDate = (date: string): string => formatDate(date, { year: false })

/** Text alternative of the chart markers; '' when there are none. */
export function trendMarkersSummary(markers: readonly TrendMarker[]): string {
  return markers.map(m => `Methodology changed to v${m.version} on ${shortDate(m.date)}.`).join(' ')
}

/** The muted line under the movers; '' when the window holds no change. */
export function moversMethodologyNote(changes: readonly MethodologyChange[]): string {
  if (changes.length === 0) return ''
  const list = changes.map(c => `${shortDate(c.date)} (v${c.version})`).join(', ')
  return `Includes ${changes.length === 1 ? 'a methodology change' : 'methodology changes'} on ${list}.`
}

export interface MarkerLabelPlace {
  side: 'left' | 'right'
  /** 0 = top line; a label that would touch another one moves down one row. */
  row: number
}

/**
 * Where each marker's version label goes. `xs` are the marker positions in px from the left edge of the plot
 * (ascending), `plotWidth` the plot width. A label sits right of its line (left of it when a line follows closely), or the
 * other side when that one is out of the plot or taken; when both sides touch a neighbour it drops to the next row.
 */
export function placeMarkerLabels(xs: readonly number[], plotWidth: number, labelWidth = 16, gap = 3, maxRows = 3): MarkerLabelPlace[] {
  const placed: Array<{ left: number; right: number; row: number }> = []
  return xs.map((x, i) => {
    // Next to a following line the label goes left, so the labels read in the order of their lines.
    const nextClose = i + 1 < xs.length && xs[i + 1]! - x < labelWidth + 2 * gap
    const sides = nextClose ? (['left', 'right'] as const) : (['right', 'left'] as const)
    for (let row = 0; row < maxRows; row++) {
      for (const side of sides) {
        const left = side === 'right' ? x + gap : x - gap - labelWidth
        const right = left + labelWidth
        const inside = left >= 0 && right <= plotWidth
        const free = placed.every(p => p.row !== row || right + 1 <= p.left || left >= p.right + 1)
        if (inside && free) {
          placed.push({ left, right, row })
          return { side, row }
        }
      }
    }
    placed.push({ left: x + gap, right: x + gap + labelWidth, row: 0 })
    return { side: 'right', row: 0 }
  })
}
