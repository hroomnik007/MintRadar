// The nip19 entry alone (bech32 only): this module is reachable from the initial bundle, the full nostr-tools is not.
import * as nip19 from 'nostr-tools/nip19'

const NJUMP = 'https://njump.me/'

export function njumpProfileUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (s.startsWith('npub1') || s.startsWith('nprofile1')) return NJUMP + s
  if (/^[0-9a-f]{64}$/i.test(s)) {
    try { return NJUMP + nip19.npubEncode(s.toLowerCase()) } catch { return null }
  }
  return null
}

export function njumpEventUrl(eventId: string | null | undefined): string | null {
  if (!eventId) return null
  const raw = eventId.trim()
  if (raw.startsWith('nevent1') || raw.startsWith('note1')) return NJUMP + raw
  const s = raw.toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(s)) return null
  try { return NJUMP + nip19.neventEncode({ id: s }) } catch { return NJUMP + s }
}

/** njump.me page of an addressable event, or null when `naddr` is not a valid naddr (the caller then renders no link). */
export function njumpNaddrUrl(naddr: string | null | undefined): string | null {
  if (!naddr) return null
  const raw = naddr.trim()
  if (!raw.startsWith('naddr1')) return null
  try {
    if (nip19.decode(raw).type !== 'naddr') return null
  } catch { return null }
  return NJUMP + raw
}

export function npubFromPubkey(hexOrNpub: string | null | undefined): string | null {
  if (!hexOrNpub) return null
  const s = hexOrNpub.trim()
  if (!s) return null
  if (s.startsWith('npub1')) return s
  if (/^[0-9a-f]{64}$/i.test(s)) {
    try { return nip19.npubEncode(s.toLowerCase()) } catch { return null }
  }
  return null
}

const MINT_ANNOUNCE_KIND = 38172

/** naddr for a mint's own kind:38172 NIP-87 announcement, or null when the
 *  mint has no known pubkey/d-tag yet (not announced, or discovered before
 *  the backend started capturing them — see nostr_announce_pubkey/_d). */
export function mintAnnounceNaddr(
  pubkey: string | null | undefined,
  dTag: string | null | undefined,
): string | null {
  if (!pubkey || !dTag) return null
  const p = pubkey.trim()
  if (!/^[0-9a-f]{64}$/i.test(p)) return null
  try {
    return nip19.naddrEncode({ kind: MINT_ANNOUNCE_KIND, pubkey: p.toLowerCase(), identifier: dTag })
  } catch { return null }
}
