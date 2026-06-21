import { nip19 } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import * as secp from '@noble/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

export interface NostrProfile {
  pubkey: string
  npub: string
  name?: string
  picture?: string
}

const META_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]

async function fetchNostrProfile(pubkey: string): Promise<{ name?: string; picture?: string }> {
  const pool = new SimplePool()
  try {
    const events = await Promise.race([
      pool.querySync(META_RELAYS, { kinds: [0], authors: [pubkey], limit: 1 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ])
    const event = events[0]
    if (!event) return {}
    const meta = JSON.parse(event.content) as { display_name?: string; name?: string; picture?: string }
    const result: { name?: string; picture?: string } = {}
    const nameVal = meta.display_name ?? meta.name
    if (nameVal !== undefined) result.name = nameVal
    if (meta.picture !== undefined) result.picture = meta.picture
    return result
  } catch { return {} }
  finally { pool.destroy() }
}

export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && window.nostr !== undefined
}

export async function loginWithNip07(): Promise<NostrProfile> {
  if (!isNip07Available()) {
    throw new Error('NIP-07 extension not available')
  }
  const pubkey = await window.nostr!.getPublicKey()
  const npub = nip19.npubEncode(pubkey)
  const meta = await fetchNostrProfile(pubkey)
  const profile: NostrProfile = { pubkey, npub }
  if (meta.name !== undefined) profile.name = meta.name
  if (meta.picture !== undefined) profile.picture = meta.picture
  return profile
}

export async function loginWithNsec(input: string): Promise<NostrProfile> {
  let privkeyBytes: Uint8Array
  if (input.startsWith('nsec1')) {
    const decoded = nip19.decode(input)
    if (decoded.type !== 'nsec') throw new Error('Invalid nsec key')
    privkeyBytes = decoded.data as Uint8Array
  } else if (/^[0-9a-f]{64}$/i.test(input)) {
    privkeyBytes = hexToBytes(input)
  } else {
    throw new Error('Enter a valid nsec1... key or 64-char hex private key')
  }
  const pubkeyHex = bytesToHex(secp.getPublicKey(privkeyBytes, true).slice(1))
  privkeyBytes.fill(0)
  const npub = nip19.npubEncode(pubkeyHex)
  const meta = await fetchNostrProfile(pubkeyHex)
  const profile: NostrProfile = { pubkey: pubkeyHex, npub }
  if (meta.name !== undefined) profile.name = meta.name
  if (meta.picture !== undefined) profile.picture = meta.picture
  return profile
}
