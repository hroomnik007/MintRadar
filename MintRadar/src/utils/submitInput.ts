import { nip19 } from 'nostr-tools'

// Classifies what the user typed into the Submit-a-mint field. Pure and synchronous: only an `url` or an `npub`
// result may ever lead to a /api/mint/probe request or a relay request; every other class stays in the browser.

// Same limit as MAX_URL_LENGTH in backend/src/index.ts (the packages share no code — keep in sync).
export const MAX_MINT_URL_LENGTH = 500

export type SubmitInputClass =
  | { kind: 'empty' }
  | { kind: 'url'; url: string }
  | { kind: 'npub'; pubkey: string }
  | { kind: 'invalid-npub' }
  | { kind: 'nsec' }
  | { kind: 'hex' }
  | { kind: 'nprofile' }
  | { kind: 'http' }
  | { kind: 'spaces' }
  | { kind: 'too-long' }
  | { kind: 'junk' }

// Port of normalizeUrl() in backend/src/discovery.ts: https scheme, lower-case host, no trailing slash on a bare origin.
// The backend's /api/mint/probe needs the literal lower-case `https://` prefix and /api/mint/submit and /discover
// normalise with this exact function, so the client sends the normalised form.
export function normalizeMintUrl(raw: string): string {
  try {
    const parsed = new URL(raw.trim())
    parsed.protocol = 'https:'
    parsed.hostname = parsed.hostname.toLowerCase()
    let result = parsed.toString()
    if (parsed.pathname === '/') result = result.replace(/\/$/, '')
    return result
  } catch {
    return raw.trim()
  }
}

function decodeNpub(trimmed: string): string | null {
  // bech32 is valid all-lowercase or all-uppercase, never mixed.
  const lower = trimmed.toLowerCase()
  if (trimmed !== lower && trimmed !== trimmed.toUpperCase()) return null
  try {
    const decoded = nip19.decode(lower)
    if (decoded.type !== 'npub') return null
    return decoded.data
  } catch {
    return null
  }
}

export function classifySubmitInput(raw: string): SubmitInputClass {
  const t = raw.trim()
  if (t === '') return { kind: 'empty' }
  // A private key is recognised before anything else (even with stray whitespace) and is never used for anything.
  if (/^nsec1/i.test(t)) return { kind: 'nsec' }
  if (/^https:\/\//i.test(t)) {
    if (/\s/.test(t)) return { kind: 'spaces' }
    if (t.length > MAX_MINT_URL_LENGTH) return { kind: 'too-long' }
    try {
      const parsed = new URL(t)
      if (parsed.protocol !== 'https:' || parsed.hostname === '') return { kind: 'junk' }
    } catch {
      return { kind: 'junk' }
    }
    const url = normalizeMintUrl(t)
    if (url.length > MAX_MINT_URL_LENGTH) return { kind: 'too-long' }
    return { kind: 'url', url }
  }
  if (/^http:\/\//i.test(t)) return { kind: 'http' }
  if (/^npub1/i.test(t)) {
    const pubkey = decodeNpub(t)
    return pubkey !== null ? { kind: 'npub', pubkey } : { kind: 'invalid-npub' }
  }
  if (/^[0-9a-f]{64}$/i.test(t)) return { kind: 'hex' }
  if (/^nostr:/i.test(t) || /^(nprofile|nevent|naddr|note)1/i.test(t)) return { kind: 'nprofile' }
  return { kind: 'junk' }
}

export const SUBMIT_EMPTY_REASON = 'Enter an https:// mint URL or an npub1… key.'

// One specific line per class; null for the classes that are valid input (their own states take over).
export function submitInputReason(c: SubmitInputClass): string | null {
  switch (c.kind) {
    case 'empty':
    case 'junk': return SUBMIT_EMPTY_REASON
    case 'http': return 'The URL must start with https://.'
    case 'hex': return "Hex keys aren't supported. Use the npub (npub1…)."
    case 'nsec': return 'That looks like a private key. Never paste a private key here, it stays in your browser and is not sent anywhere.'
    case 'nprofile': return 'Use the npub (npub1…), not an nprofile.'
    case 'invalid-npub': return "That doesn't look like a valid npub."
    case 'spaces': return 'Remove the spaces from the URL.'
    case 'too-long': return `That URL is too long (up to ${MAX_MINT_URL_LENGTH} characters).`
    case 'url':
    case 'npub': return null
  }
}
