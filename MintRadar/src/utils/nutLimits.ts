// NUT-04 (minting) / NUT-05 (melting) amount limits, grouped for display.
//
// A mint's `nuts.4.methods` / `nuts.5.methods` array carries one entry per
// (payment method × unit) pair, so a mint offering bolt11/bolt12/onchain/paypal
// in both sat and usd declares 8 entries. Rendering that array directly prints
// the same range once per entry with nothing distinguishing them — e.g.
// "1 – 500,000 sat" four times in a row (testnut.cashu.space does exactly this).
//
// Deduplicating on (unit, min, max) alone would be wrong: NUT-04/05 explicitly
// permit different methods to carry different limits (an onchain method may set
// a higher min_amount to cover on-chain fees), so collapsing them would silently
// drop a real difference. This groups on (min, max, unit) AND keeps the list of
// methods that share each range, so identical ranges collapse into one row while
// genuinely different ones stay separate and labelled.

export interface NutLimitMethod {
  method?: string
  unit?: string
  min_amount?: number
  max_amount?: number
}

export interface NutLimitGroup {
  min: number | null
  max: number | null
  unit: string
  /** Method names sharing this exact range, in the order the mint declared them. */
  methods: string[]
}

/**
 * Groups a NUT-04/NUT-05 `methods` array by its (min_amount, max_amount, unit)
 * range. Groups come back in order of first appearance so the output follows the
 * mint's own declared ordering rather than an arbitrary sort.
 */
export function groupNutLimits(methods: NutLimitMethod[] | null | undefined): NutLimitGroup[] {
  if (!methods?.length) return []

  const groups = new Map<string, NutLimitGroup>()

  for (const m of methods) {
    const min = m.min_amount ?? null
    const max = m.max_amount ?? null
    const unit = m.unit ?? ''
    const key = `${min}|${max}|${unit}`

    let group = groups.get(key)
    if (!group) {
      group = { min, max, unit, methods: [] }
      groups.set(key, group)
    }

    // A missing method name carries no information to label with, and the same
    // name twice in one group would just read as a duplicate — skip both.
    const name = m.method
    if (name && !group.methods.includes(name)) group.methods.push(name)
  }

  return [...groups.values()]
}

/** Formats one group's range as "1 – 500,000 sat" (thousands separators, en dash). */
export function formatNutLimitRange(group: NutLimitGroup): string {
  const min = group.min != null ? group.min.toLocaleString() : '—'
  const max = group.max != null ? group.max.toLocaleString() : '—'
  return `${min} – ${max}${group.unit ? ` ${group.unit}` : ''}`
}
