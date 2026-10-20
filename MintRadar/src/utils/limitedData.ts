// "Limited data" label of Mint Detail: the reasons the Reliability Score rests on thin evidence. No threshold of its
// own: the audit rule and the new-mint cap are the score's constants (auditScore.ts, reliabilityScore.ts).
import { AUDIT_MIN_SAMPLES, auditDataState } from './auditScore'
import { NEW_MINT_MAX_DAYS, NEW_MINT_RELIABILITY_CAP } from './reliabilityScore'
import { AUDIT_WINDOW_DAYS } from './tooltipTexts'

export interface LimitedDataInput {
  auditBlamed: number | null | undefined
  auditTotal: number | null | undefined
  auditFetchedAt: string | null | undefined
  discoveredAt: string | null | undefined
  now: number
}

/** One short reason per cause; an empty list means the mint has enough data (no label). */
export function limitedDataReasons(i: LimitedDataInput): string[] {
  const reasons: string[] = []
  const state = auditDataState(i.auditBlamed, i.auditTotal, i.auditFetchedAt, i.now)
  if (state === 'too-few') reasons.push(`audit based on fewer than ${AUDIT_MIN_SAMPLES} swaps`)
  else if (state === 'too-old') reasons.push(`audit data older than ${AUDIT_WINDOW_DAYS} days`)
  else if (state === 'no-data') reasons.push('no recent audit data')
  if (i.discoveredAt) {
    const t = new Date(i.discoveredAt).getTime()
    const days = (i.now - t) / 86_400_000
    if (Number.isFinite(t) && days >= 0 && days < NEW_MINT_MAX_DAYS) {
      reasons.push(`tracked for ${Math.floor(days)} of ${NEW_MINT_MAX_DAYS} days, score capped at ${NEW_MINT_RELIABILITY_CAP}`)
    }
  }
  return reasons
}

/** Tooltip text: the reasons joined into sentences. */
export function limitedDataText(reasons: readonly string[]): string {
  const sentence = reasons.map((r, i) => (i === 0 ? r.charAt(0).toUpperCase() + r.slice(1) : r)).join('; ')
  return `${sentence}.`
}
