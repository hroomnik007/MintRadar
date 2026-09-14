import { nip19 } from 'nostr-tools'

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
