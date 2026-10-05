import { isTestMint } from '@/constants/testMints'

// "Not recommended" = a known test mint (curated URL list in constants/testMints). Used only for
// sorting, filtering and labelling — never for the Reliability Score.
export interface NotRecommendedLike {
  url: string
}

export function isNotRecommendedMint(mint: NotRecommendedLike): boolean {
  return isTestMint(mint.url)
}

/** Stable partition: every recommended mint first, then every not-recommended one, each group
 *  keeping its incoming relative order. Apply AFTER sorting (and any direction flip). */
export function partitionNotRecommended<T extends NotRecommendedLike>(mints: readonly T[]): T[] {
  const ok: T[] = []
  const rest: T[] = []
  for (const m of mints) (isNotRecommendedMint(m) ? rest : ok).push(m)
  return [...ok, ...rest]
}
