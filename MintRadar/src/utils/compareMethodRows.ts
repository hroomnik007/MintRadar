// Compare modal, section "Deposits and withdrawals" (redesign 2026-11-28): one row per payment method that any compared
// mint offers ("Lightning", "Lightning (BOLT12)", "On-chain", others by name), each cell saying what the mint declares for
// it. The numbers and words come from limitTable() (feesLimits.ts, the Mint Detail limits table), so the two never
// disagree; this file only groups them by method across the mints. Pure, no React.
import type { KnownMint } from '@/hooks/useKnownMints'
import { limitTable, paymentMethodWord } from '@/utils/feesLimits'
import { disabledSides } from '@/utils/compareMethods'

export interface MethodLine { text: string; muted: boolean }
export interface CompareMethodRow {
  /** "method-bolt11" */
  id: string
  /** "Lightning" */
  label: string
  /** Per mint, the lines of its cell. */
  cells: MethodLine[][]
  /** What "Only differences" compares, per mint. */
  keys: string[]
}

const METHOD_ORDER = ['bolt11', 'bolt12', 'onchain']
const NOT_OFFERED = 'not offered'
const NO_SIDE = '—'

/** "1 to 1,000,000" -> "1 to 1,000,000 sat"; words ("no limits declared", "Disabled by the mint") stay as they are. */
function withUnit(text: string, unit: string): string {
  return /\d/.test(text) ? `${text} ${unit}` : text
}

/** The lines of one mint's cell for one method: one line when deposits and withdrawals say the same, else "in …" / "out …". */
function cellLines(rows: ReturnType<typeof limitTable>, method: string): MethodLine[] {
  const mine = rows.filter(r => r.key.split('|')[0] === method)
  if (mine.length === 0) return [{ text: NOT_OFFERED, muted: true }]
  const multiUnit = mine.length > 1
  const lines: MethodLine[] = []
  for (const r of mine) {
    const unit = r.key.split('|')[1]!
    // An amount carries its unit ("0 to 1,000,000 usd"); a state in words names the unit only when there are several.
    const say = (v: string) => (/\d/.test(v) ? withUnit(v, unit) : `${v.toLowerCase()}${multiUnit ? ` (${unit})` : ''}`)
    if (r.deposit === r.withdrawal) {
      lines.push({ text: say(r.deposit), muted: !/\d/.test(r.deposit) })
      continue
    }
    for (const [side, value] of [['in', r.deposit], ['out', r.withdrawal]] as const) {
      const v = value === NO_SIDE ? NOT_OFFERED : value
      lines.push(/\d/.test(v) ? { text: `${side} ${say(v)}`, muted: false } : { text: `${side}: ${say(v)}`, muted: true })
    }
  }
  return lines
}

export function compareMethodRows(mints: ReadonlyArray<Pick<KnownMint, 'mintMethods' | 'meltMethods' | 'nutsLimits'>>): CompareMethodRow[] {
  const tables = mints.map(m => limitTable(m.mintMethods, m.meltMethods, disabledSides(m)))
  const methods = [...new Set(tables.flatMap(t => t.map(r => r.key.split('|')[0]!)))]
  const rank = (m: string) => { const i = METHOD_ORDER.indexOf(m); return i === -1 ? METHOD_ORDER.length : i }
  methods.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
  return methods.map(method => {
    const cells = tables.map(t => cellLines(t, method))
    return {
      id: `method-${method}`,
      label: paymentMethodWord(method),
      cells,
      keys: cells.map(lines => lines.map(l => l.text).join(' / ')),
    }
  })
}
