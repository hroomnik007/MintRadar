import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// A startup restore of an older remote-signer session whose connect() is still pending must not
// tear down (or log out) a NEWER login that happened meanwhile.
const logout = vi.hoisted(() => vi.fn())
vi.mock('nostr-tools/nip46', () => ({
  BunkerSigner: { fromURI: vi.fn(), fromBunker: vi.fn() },
  parseBunkerInput: vi.fn(async () => ({ pubkey: 'b'.repeat(64), relays: ['wss://r.example'], secret: null })),
  createNostrConnectURI: vi.fn(() => 'nostrconnect://abc?relay=wss://r.example&secret=s'),
  toBunkerURL: vi.fn(() => 'bunker://new?relay=wss://r.example'),
}))
vi.mock('nostr-tools/pool', () => ({ SimplePool: class { destroy = vi.fn() } }))
vi.mock('@/core/nostr/pool', () => ({ sharedPool: { subscribeMany: vi.fn(), querySync: vi.fn() } }))
vi.mock('@/stores/auth.store', () => ({ useAuthStore: { getState: () => ({ logout }) } }))

import { initBunkerQR, restoreBunkerSession } from '@/core/nostr/client'
import { BunkerSigner } from 'nostr-tools/nip46'

const OLD_PK = 'a'.repeat(64)
const NEW_PK = 'c'.repeat(64)

function storeOldSession() {
  sessionStorage.setItem('bunkerURI', 'bunker://old?relay=wss://r.example')
  sessionStorage.setItem('bunkerClientSecretKey', '11'.repeat(32))
  sessionStorage.setItem('bunkerPubkey', OLD_PK)
}

function oldSignerWithPendingConnect() {
  let settle!: { resolve: () => void; reject: (e: Error) => void }
  const signer = {
    connect: vi.fn(() => new Promise<void>((resolve, reject) => { settle = { resolve, reject } })),
    close: vi.fn(async () => { settle.reject(new Error('nostr-tools/nip46: signer was closed')) }),
    getPublicKey: vi.fn(),
  }
  return { signer, settle: () => settle }
}

async function freshQrLogin() {
  const newSigner = { getPublicKey: vi.fn(async () => NEW_PK), close: vi.fn(async () => {}), bp: {} }
  ;(BunkerSigner.fromURI as Mock).mockResolvedValue(newSigner)
  await initBunkerQR().loginPromise
  await new Promise(r => setTimeout(r, 0))
  return newSigner
}

beforeEach(() => {
  sessionStorage.clear()
  logout.mockReset()
  delete (window as { nostr?: unknown }).nostr
})

describe('restoreBunkerSession vs a fresh login', () => {
  it('the old connect() rejecting because the fresh login closed it leaves the NEW session alone', async () => {
    storeOldSession()
    const { signer } = oldSignerWithPendingConnect()
    ;(BunkerSigner.fromBunker as Mock).mockReturnValue(signer)
    await restoreBunkerSession()
    const newSigner = await freshQrLogin()
    expect(signer.close).toHaveBeenCalled() // old one torn down by the new login
    expect(logout).not.toHaveBeenCalled()
    expect(newSigner.close).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(NEW_PK)
    expect(await (window as unknown as { nostr: { getPublicKey(): Promise<string> } }).nostr.getPublicKey()).toBe(NEW_PK)
  })

  it('a late old connect() success after the fresh login has no side effects', async () => {
    storeOldSession()
    const { signer, settle } = oldSignerWithPendingConnect()
    signer.close = vi.fn(async () => {}) // close without rejecting; connect resolves later
    ;(BunkerSigner.fromBunker as Mock).mockReturnValue(signer)
    await restoreBunkerSession()
    await freshQrLogin()
    settle().resolve()
    await new Promise(r => setTimeout(r, 0))
    expect(logout).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('bunkerPubkey')).toBe(NEW_PK)
  })

  it('the restored signer failing on its own (still the live one) still logs out cleanly', async () => {
    storeOldSession()
    const { signer, settle } = oldSignerWithPendingConnect()
    ;(BunkerSigner.fromBunker as Mock).mockReturnValue(signer)
    await restoreBunkerSession()
    settle().reject(new Error('relay down'))
    await new Promise(r => setTimeout(r, 0))
    expect(logout).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('bunkerPubkey')).toBeNull()
    expect((window as { nostr?: unknown }).nostr).toBeUndefined()
  })
})
