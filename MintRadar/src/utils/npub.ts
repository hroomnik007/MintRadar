// One short form for Nostr identities everywhere (account menu, review cards, review form) and the avatar letter rule.
// Before the 2026-11-15 audit there were two formats ("npub1abcdefgh…xyz789" and "npub1dx2xv...uc2f") and the account
// chip fell back to 8 hex characters of the pubkey.

/** npub1abcdefg…xyz789: head and tail of an npub; short input is returned as is. */
export function shortNpub(npub: string): string {
  if (npub.length <= 20) return npub
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`
}

// First character by grapheme (not by UTF-16 unit / byte), uppercased. null = no usable name (empty, or an npub):
// the avatar then shows a User icon instead of a letter (every npub would otherwise get "N").
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
export function avatarInitial(name: string | null | undefined): string | null {
  const t = name?.trim() ?? ''
  if (t === '' || /^npub1[0-9a-z]{20,}$/i.test(t)) return null
  const first = graphemes ? graphemes.segment(t)[Symbol.iterator]().next().value?.segment : Array.from(t)[0]
  return first ? first.toLocaleUpperCase() : null
}
