// Compare modal (ComparisonModal.tsx): which cell of a metric row gets the "BEST" tag.
// Only rows with a clear direction take part (Reliability Score, Uptime 24h / 30d: higher is better; Latency: lower is
// better). The cells print the value as it is ("100%", "92", "120ms"), so comparing the numbers is comparing what is read:
// 100% and 100% are equal.
// No tag at all when: fewer than two mints, any value is missing or still loading (null), or the best displayed value is
// shared by two or more mints (a tie among the top is not a winner). There is no overall winner across rows.

export type BestDirection = 'higher' | 'lower'

/** One flag per mint: true only for the single mint whose displayed value is strictly better than every other one. */
export function bestFlags(displayed: readonly (number | null)[], direction: BestDirection): boolean[] {
  const none = displayed.map(() => false)
  if (displayed.length < 2) return none
  if (displayed.some(v => v === null || !Number.isFinite(v))) return none
  const vals = displayed as readonly number[]
  const best = direction === 'higher' ? Math.max(...vals) : Math.min(...vals)
  const winners = vals.filter(v => v === best).length
  if (winners !== 1) return none
  return vals.map(v => v === best)
}
