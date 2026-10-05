import { isTestMint } from '@/constants/testMints'

// "Not recommended" = a known test mint (curated URL list) OR a mint whose own text says it is
// a demo/test mint (backend /api/mints/known `demoNotice`, see demoNotice.ts). Used only for
// sorting, filtering and labelling — never for the Reliability Score.
export interface NotRecommendedLike {
  url: string
  demoNotice?: boolean | null
}

export function isNotRecommendedMint(mint: NotRecommendedLike): boolean {
  return isTestMint(mint.url) || (mint.demoNotice === true && mint.demoNoticePhrase !== "for demonstration purposes")
}

/** Stable partition: every recommended mint first, then every not-recommended one, each group
 *  keeping its incoming relative order. Apply AFTER sorting (and any direction flip). */
export function partitionNotRecommended<T extends NotRecommendedLike>(mints: readonly T[]): T[] {
  const ok: T[] = []
  const rest: T[] = []
  for (const m of mints) (isNotRecommendedMint(m) ? rest : ok).push(m)
  return [...ok, ...rest]
}
