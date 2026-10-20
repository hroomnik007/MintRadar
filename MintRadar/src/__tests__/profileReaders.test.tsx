import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'

// The frontend readers of kind:0 profile events (reviewer profiles and the operator's nip05) accept only a verified
// kind:0 from a requested pubkey and use the newest one per pubkey.

const pool = vi.hoisted(() => ({ querySync: vi.fn() }))
vi.mock('@/core/nostr/pool', () => ({ sharedPool: { querySync: pool.querySync } }))

import { useMintReviews } from '@/hooks/useMintReviews'
import { useMintOperatorNip05 } from '@/hooks/useMintOperatorNip05'

const MINT = 'https://mint.example.com'
const skReviewer = generateSecretKey()
const skOther = generateSecretKey()
const reviewer = getPublicKey(skReviewer)

const review = (): NostrEvent =>
  finalizeEvent({ kind: 38000, created_at: 1000, tags: [['u', MINT], ['rating', '5']], content: 'great' }, skReviewer)
const profile = (sk: Uint8Array, meta: object, createdAt: number): NostrEvent =>
  finalizeEvent({ kind: 0, created_at: createdAt, tags: [], content: JSON.stringify(meta) }, sk)
// Built field by field: a spread copy would carry nostr-tools' internal "already verified" symbol along.
const tampered = (ev: NostrEvent, meta: object): NostrEvent => ({
  id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, sig: ev.sig,
  content: JSON.stringify(meta),
})

// querySync answers the review query with one review and the kind:0 query with `profiles`.
function serve(profiles: NostrEvent[]) {
  pool.querySync.mockImplementation(async (_relays: string[], filter: { kinds?: number[] }) =>
    filter.kinds?.[0] === 38000 ? [review()] : profiles)
}

async function reviewerProfile(profiles: NostrEvent[]) {
  serve(profiles)
  const { result } = renderHook(() => useMintReviews(MINT))
  await waitFor(() => expect(result.current.reviews).toHaveLength(1))
  // the profile query runs after the reviews render; give it its turn
  await waitFor(() => expect(pool.querySync.mock.calls.some(c => (c[1] as { kinds: number[] }).kinds[0] === 0)).toBe(true))
  await new Promise(r => setTimeout(r, 0))
  return result.current.profiles[reviewer]
}

beforeEach(() => { pool.querySync.mockReset() })

describe('useMintReviews profiles', () => {
  it('uses a valid profile', async () => {
    expect((await reviewerProfile([profile(skReviewer, { name: 'alice' }, 100)]))?.name).toBe('alice')
  })

  it('ignores a profile whose content was tampered with', async () => {
    expect(await reviewerProfile([tampered(profile(skReviewer, { name: 'alice' }, 100), { name: 'mallory' })])).toBeUndefined()
  })

  it('ignores a profile signed by a pubkey that was not requested', async () => {
    expect(await reviewerProfile([profile(skOther, { name: 'bob' }, 100)])).toBeUndefined()
  })

  it.each([
    ['older first', false],
    ['newer first', true],
  ])('with two valid events the newer wins (%s)', async (_label, newerFirst) => {
    const older = profile(skReviewer, { name: 'old' }, 100)
    const newer = profile(skReviewer, { name: 'new' }, 200)
    expect((await reviewerProfile(newerFirst ? [newer, older] : [older, newer]))?.name).toBe('new')
  })
})

describe('useMintOperatorNip05', () => {
  const nip = (meta: object) => meta
  async function operatorNip05(events: NostrEvent[]) {
    pool.querySync.mockResolvedValue(events)
    const { result } = renderHook(() => useMintOperatorNip05(reviewer))
    await waitFor(() => expect(pool.querySync).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 0))
    return result.current
  }

  it('uses a valid profile', async () => {
    expect(await operatorNip05([profile(skReviewer, nip({ nip05: 'a@example.com' }), 100)])).toBe('a@example.com')
  })

  it('ignores a tampered profile', async () => {
    const ev = tampered(profile(skReviewer, nip({ nip05: 'a@example.com' }), 100), { nip05: 'evil@example.com' })
    expect(await operatorNip05([ev])).toBeNull()
  })

  it('ignores a profile of another pubkey', async () => {
    expect(await operatorNip05([profile(skOther, nip({ nip05: 'b@example.com' }), 100)])).toBeNull()
  })

  it('the newer of two valid events wins whatever the arrival order', async () => {
    const older = profile(skReviewer, nip({ nip05: 'old@example.com' }), 100)
    const newer = profile(skReviewer, nip({ nip05: 'new@example.com' }), 200)
    expect(await operatorNip05([older, newer])).toBe('new@example.com')
    pool.querySync.mockReset()
    expect(await operatorNip05([newer, older])).toBe('new@example.com')
  })
})
