// Manually curated list of known test/dev-only Cashu mints — see the
// "Test mint detection" investigation (2026-09-04). A pure keyword match on
// /v1/info's `description`/`description_long` was rejected as the runtime
// mechanism: the wording isn't consistent across mints, generic risk
// disclaimers on real production mints ("use at your own risk", "still in
// development", "do not use with large amounts" — Minibits, Sovran) would
// false-positive, and one mint's warning text changed to something benign
// between probes (Uncle Ric's) — none of that is a change we want to react
// to automatically for something as consequential as hiding a mint from
// recommendations. The short `description` field (where this class of
// mint's warning actually lives, not `description_long`) also isn't
// persisted to the DB at all today, so a live/DB-driven check isn't
// available to most of the surfaces below anyway.
//
// This list is the source of truth. Update it manually if a new dev/test
// mint shows up (candidates can be found by grepping /v1/info responses for
// phrases like "for testing and development purposes", "do not use this
// mint as a default", "development mint", "fakewallet" — but confirm each
// one isn't a real mint with a mere risk disclaimer before adding it).
export const TEST_MINT_URLS = new Set([
  'https://8333.space:3338',           // "Cashu test mint" — Nutshell's boilerplate test warning
  'https://testnut.cashu.space',       // FakeWallet — invoices always mark as paid
  'https://nofee.testnut.cashu.space', // Testnut's feeless sibling
  'https://rugs.cashu.exchange',       // "DEVELOPMENT MINT... DO NOT deposit real funds!"
  'https://rugs01.cashu.exchange',
  'https://cashu.centurymetadata.org', // "Century Metadata Test Mint" — experimental, testing-only
])

export function isTestMint(url: string): boolean {
  return TEST_MINT_URLS.has(url.replace(/\/+$/, ''))
}
