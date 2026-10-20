import { describe, it, expect, vi, beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'

// The follow list (kind:3) is used only from the user's own valid events and the newest one wins, whatever order the
// relays answer in.

const pool = vi.hoisted(() => ({ querySync: vi.fn() }))
vi.mock('@/core/nostr/pool', () => ({ sharedPool: { querySync: pool.querySync } }))

import { fetchFollowRecs } from '@/hooks/useFollowRecommendations'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const skOther = generateSecretKey()
const friend = (n: number) => n.toString(16).padStart(64, '0')

const list = (follows: string[], createdAt: number, secret = sk): NostrEvent =>
  finalizeEvent({ kind: 3, created_at: createdAt, tags: follows.map(f => ['p', f]), content: '' }, secret)
// Built field by field: a spread copy would carry nostr-tools' internal "already verified" marker along.
const tampered = (ev: NostrEvent, follows: string[]): NostrEvent => ({
  id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, sig: ev.sig, content: ev.content,
  tags: follows.map(f => ['p', f]),
})

async function followCount(events: NostrEvent[]): Promise<number> {
  pool.querySync.mockImplementation(async (_relays: string[], filter: { kinds?: number[] }) =>
    filter.kinds?.[0] === 3 ? events : [])
  return (await fetchFollowRecs(pk)).followCount
}

beforeEach(() => { pool.querySync.mockReset() })

describe('fetchFollowRecs follow list', () => {
  it('uses a valid list', async () => {
    expect(await followCount([list([friend(1), friend(2)], 100)])).toBe(2)
  })

  it.each([
    ['older first', false],
    ['newer first', true],
  ])('the newer of two valid lists wins (%s)', async (_label, newerFirst) => {
    const older = list([friend(1)], 100)
    const newer = list([friend(1), friend(2), friend(3)], 200)
    expect(await followCount(newerFirst ? [newer, older] : [older, newer])).toBe(3)
  })

  it('ignores a list whose tags were changed after signing', async () => {
    const forged = tampered(list([friend(1)], 300), [friend(1), friend(2), friend(3), friend(4)])
    expect(await followCount([forged, list([friend(1), friend(2)], 100)])).toBe(2)
    expect(await followCount([forged])).toBe(0)
  })

  it('ignores a validly signed list of another author', async () => {
    expect(await followCount([list([friend(1), friend(2), friend(3)], 300, skOther)])).toBe(0)
  })

  it('ignores a validly signed event of another kind', async () => {
    const note = finalizeEvent({ kind: 1, created_at: 300, tags: [['p', friend(1)]], content: '' }, sk)
    expect(await followCount([note])).toBe(0)
  })
})
