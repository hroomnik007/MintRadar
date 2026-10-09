// The one display format for a calendar date: "29 Sep 2026" (day without a leading zero, a FIXED
// three-letter English month, four-digit year), or "29 Sep" without the year. No Intl and no browser
// locale: en-GB abbreviates September as "Sept", which shifts every September date in a column.

export const DATE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export interface FormatDateOptions {
  /** Append the year ("29 Sep 2026"); default true. */
  year?: boolean
  /** Read the day/month/year in the viewer's time zone instead of UTC; default false (UTC). */
  local?: boolean
}

/** A Date, an ISO string or epoch milliseconds; an unparseable value gives ''. */
export function formatDate(input: string | number | Date | null | undefined, opts: FormatDateOptions = {}): string {
  if (input === null || input === undefined || input === '') return ''
  const d = input instanceof Date ? input : new Date(input)
  if (!Number.isFinite(d.getTime())) return ''
  const local = opts.local === true
  const day = local ? d.getDate() : d.getUTCDate()
  const month = DATE_MONTHS[local ? d.getMonth() : d.getUTCMonth()]
  if (opts.year === false) return `${day} ${month}`
  return `${day} ${month} ${local ? d.getFullYear() : d.getUTCFullYear()}`
}
