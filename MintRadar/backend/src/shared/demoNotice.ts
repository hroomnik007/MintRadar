// Demo/test notice detection — "does the mint's OWN text say it is a demo or test mint?"
//
// Source of truth for the backend (prober.ts stores the result in mints.demo_notice and
// /api/mints/known exposes it). The frontend cannot import this file (separate npm
// package, no workspace), so src/utils/demoNotice.ts is a manually-synced copy — keep the
// code identical; src/__tests__/sharedModules.test.ts fails when the two drift.
//
// Deliberately a short, conservative, whole-phrase list. Generic risk wording that real
// production mints use ("no guarantee", "without guarantee", "use at your own risk") is NOT
// here and must never be added: a false positive hides a real mint from recommendations.
export const DEMO_NOTICE_PHRASES: readonly string[] = [
  'demonstration only',
  'demo mint',
  'for demo purposes',
  'for testing purposes',
  'testing purposes only',
  'test mint',
  'play money',
  'not for real funds',
  'not real money',
  'do not deposit',
]

// A mint-supplied text is only scanned up to this many characters (bounded work).
const MAX_SCANNED_CHARS = 4000

const PHRASE_PATTERNS: ReadonlyArray<{ phrase: string; re: RegExp }> = DEMO_NOTICE_PHRASES.map(phrase => ({
  phrase,
  // Whole phrase only (letters/digits on either side disqualify), any run of whitespace
  // between the words, case-insensitive.
  re: new RegExp(`(?<![\\p{L}\\p{N}])${phrase.split(' ').join('\\s+')}(?![\\p{L}\\p{N}])`, 'iu'),
}))

/** Returns the matched list phrase (never mint-supplied text), or null. */
export function detectDemoNotice(texts: ReadonlyArray<string | null | undefined>): string | null {
  const scanned: string[] = []
  for (const t of texts) {
    if (typeof t === 'string' && t.length > 0) scanned.push(t.slice(0, MAX_SCANNED_CHARS))
  }
  if (scanned.length === 0) return null
  for (const { phrase, re } of PHRASE_PATTERNS) {
    if (scanned.some(t => re.test(t))) return phrase
  }
  return null
}
