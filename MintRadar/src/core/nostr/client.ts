import { nip19, generateSecretKey, getPublicKey as nostrGetPublicKey, verifyEvent } from 'nostr-tools'
import { BunkerSigner, parseBunkerInput, createNostrConnectURI, toBunkerURL } from 'nostr-tools/nip46'
import type { EventTemplate } from 'nostr-tools'
import * as secp from '@noble/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { sharedPool } from '@/core/nostr/pool'
import { useAuthStore } from '@/stores/auth.store'

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

export async function fetchNostrProfile(pubkey: string, extraRelays?: string[]): Promise<{ name?: string; picture?: string }> {
  const relays = extraRelays && extraRelays.length > 0
    ? [...new Set([...META_RELAYS, ...extraRelays])]
    : META_RELAYS
  try {
    const events = await Promise.race([
      sharedPool.querySync(relays, { kinds: [0], authors: [pubkey], limit: 1 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ])
    const event = events[0]
    if (!event || !verifyEvent(event)) return {}
    const meta = JSON.parse(event.content) as { display_name?: string; name?: string; picture?: string }
    const result: { name?: string; picture?: string } = {}
    const nameVal = meta.display_name ?? meta.name
    if (nameVal !== undefined) result.name = nameVal
    if (meta.picture !== undefined) result.picture = meta.picture
    return result
  } catch { return {} }
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

// ── NIP-46 bunker session ──────────────────────────────────────

// Ephemeral client key for the NIP-46 session — NOT the user's identity key.
// Lives only in sessionStorage; cleared on logout or tab close.
let activeBunkerSigner: BunkerSigner | null = null
// Saved NIP-07 extension reference so it can be restored on logout
let originalNostr: Window['nostr'] | undefined = undefined

const BUNKER_URI_KEY = 'bunkerURI'
const BUNKER_SECRET_KEY = 'bunkerClientSecretKey'
const BUNKER_PUBKEY_KEY = 'bunkerPubkey'

const NIP46_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

function installBunkerShim(signer: BunkerSigner, pubkeyHex: string): void {
  if (typeof window === 'undefined') return
  if (window.nostr !== undefined) {
    originalNostr = window.nostr
  }
  activeBunkerSigner = signer
  window.nostr = {
    getPublicKey: async () => pubkeyHex,
    signEvent: (event: object) =>
      signer.signEvent(event as EventTemplate) as Promise<object>,
    nip44: {
      encrypt: (pubkey: string, plaintext: string) => signer.nip44Encrypt(pubkey, plaintext),
      decrypt: (pubkey: string, ciphertext: string) => signer.nip44Decrypt(pubkey, ciphertext),
    },
    nip04: {
      encrypt: async () => { throw new Error('NIP-04 not supported by remote signer') },
      decrypt: async () => { throw new Error('NIP-04 not supported by remote signer') },
    },
  }
}

export function removeBunkerShim(): void {
  if (activeBunkerSigner === null) return
  if (typeof window !== 'undefined') {
    if (originalNostr !== undefined) {
      window.nostr = originalNostr
      originalNostr = undefined
    } else {
      delete window.nostr
    }
  }
  activeBunkerSigner.close().catch(() => {})
  activeBunkerSigner = null
  sessionStorage.removeItem(BUNKER_URI_KEY)
  sessionStorage.removeItem(BUNKER_SECRET_KEY)
  sessionStorage.removeItem(BUNKER_PUBKEY_KEY)
}

export async function loginWithBunker(bunkerInput: string): Promise<NostrProfile> {
  const clientSecretKey = generateSecretKey()
  const bp = await parseBunkerInput(bunkerInput)
  if (!bp) throw new Error('Invalid bunker URI or NIP-05 identifier')
  const signer = BunkerSigner.fromBunker(clientSecretKey, bp, {
    onauth: (url) => window.open(url, '_blank'),
  })
  await Promise.race([
    signer.connect(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Connection timeout — bunker relay did not respond within 30 seconds')), 30000)),
  ])
  const pubkeyHex = await signer.getPublicKey()
  installBunkerShim(signer, pubkeyHex)
  // Store canonical bunker:// URL so restore never needs a network lookup
  sessionStorage.setItem(BUNKER_URI_KEY, toBunkerURL(bp))
  sessionStorage.setItem(BUNKER_SECRET_KEY, bytesToHex(clientSecretKey))
  sessionStorage.setItem(BUNKER_PUBKEY_KEY, pubkeyHex)
  const npub = nip19.npubEncode(pubkeyHex)
  const meta = await fetchNostrProfile(pubkeyHex)
  const profile: NostrProfile = { pubkey: pubkeyHex, npub }
  if (meta.name !== undefined) profile.name = meta.name
  if (meta.picture !== undefined) profile.picture = meta.picture
  return profile
}

// Initiates a nostrconnect:// QR flow (mobile Amber pairing).
// Returns the URI to display as QR and a promise that resolves when Amber scans.
export function initBunkerQR(): {
  uri: string
  loginPromise: Promise<NostrProfile>
  cancel: () => void
} {
  const clientSecretKey = generateSecretKey()
  const clientPubkey = nostrGetPublicKey(clientSecretKey)
  const secret = bytesToHex(generateSecretKey()).slice(0, 16)
  const uri = createNostrConnectURI({
    clientPubkey,
    relays: NIP46_RELAYS,
    secret,
    name: 'MintRadar',
  })
  const abortCtrl = new AbortController()
  const loginPromise = BunkerSigner.fromURI(
    clientSecretKey,
    uri,
    { onauth: (url) => window.open(url, '_blank') },
    abortCtrl.signal
  ).then(async signer => {
    const pubkeyHex = await signer.getPublicKey()
    installBunkerShim(signer, pubkeyHex)
    // Derive canonical bunker:// from signer.bp so restore doesn't reuse a one-time URI
    sessionStorage.setItem(BUNKER_URI_KEY, toBunkerURL(signer.bp))
    sessionStorage.setItem(BUNKER_SECRET_KEY, bytesToHex(clientSecretKey))
    sessionStorage.setItem(BUNKER_PUBKEY_KEY, pubkeyHex)
    const npub = nip19.npubEncode(pubkeyHex)
    const meta = await fetchNostrProfile(pubkeyHex)
    const profile: NostrProfile = { pubkey: pubkeyHex, npub }
    if (meta.name !== undefined) profile.name = meta.name
    if (meta.picture !== undefined) profile.picture = meta.picture
    return profile
  })
  return { uri, loginPromise, cancel: () => abortCtrl.abort() }
}

// Restores a bunker session after a page refresh.
// Installs the window.nostr shim synchronously with the stored pubkey,
// then re-establishes the relay subscription in the background.
export async function restoreBunkerSession(): Promise<void> {
  const storedUri = sessionStorage.getItem(BUNKER_URI_KEY)
  const secretHex = sessionStorage.getItem(BUNKER_SECRET_KEY)
  const storedPubkey = sessionStorage.getItem(BUNKER_PUBKEY_KEY)
  if (!storedUri || !secretHex || !storedPubkey) return
  try {
    const clientSecretKey = hexToBytes(secretHex)
    const bp = await parseBunkerInput(storedUri)
    if (!bp) throw new Error('Invalid stored bunker URI')
    const signer = BunkerSigner.fromBunker(clientSecretKey, bp, {
      onauth: (url) => window.open(url, '_blank'),
    })
    // Optimistic restore: shim installed before connect() resolves to allow
    // synchronous window.nostr access on page refresh. If connect() fails,
    // M-1 fix ensures auth store is cleared and user is logged out cleanly.
    installBunkerShim(signer, storedPubkey)
    // Reconnect relay subscription in background; clear session and log out if it fails
    void signer.connect().catch(() => {
      removeBunkerShim()
      useAuthStore.getState().logout()
    })
  } catch {
    sessionStorage.removeItem(BUNKER_URI_KEY)
    sessionStorage.removeItem(BUNKER_SECRET_KEY)
    sessionStorage.removeItem(BUNKER_PUBKEY_KEY)
  }
}
