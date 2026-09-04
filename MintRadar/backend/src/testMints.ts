// Manually-synced mirror of the frontend's src/constants/testMints.ts (no
// shared workspace between the two npm packages — see the frontend file for
// the full "why not a keyword heuristic" rationale). Used to exclude known
// dev/test-only mints from server-computed "best of" lists (currently just
// /api/stats' top5ByTrustScore) — they stay fully visible everywhere else
// (still returned by /api/mints/known, still probed/tracked normally).
export const TEST_MINT_URLS = new Set([
  'https://8333.space:3338',
  'https://testnut.cashu.space',
  'https://nofee.testnut.cashu.space',
  'https://rugs.cashu.exchange',
  'https://rugs01.cashu.exchange',
  'https://cashu.centurymetadata.org',
])

export function isTestMint(url: string): boolean {
  return TEST_MINT_URLS.has(url.replace(/\/+$/, ''))
}
