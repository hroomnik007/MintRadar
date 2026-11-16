import { describe, it, expect, vi, beforeEach } from 'vitest'

// The kind:38000 review event MintRadar publishes. cashu.me filters reviews by #k = 38172 and matches them to a
// mint by the `u` tag, so `k` must be present and `d` / `u[1]` must stay the plain mint URL.
const publish = vi.hoisted(() => vi.fn())
vi.mock('@/core/nostr/pool', () => ({ sharedPool: { publish } }))

import { submitMintReview } from '@/hooks/useSubmitReview'
import { REVIEW_PUBLISH_RELAYS } from '@/core/nostr/relays'

const MINT = 'https://mint.example.com'
let signEvent: ReturnType<typeof vi.fn>

beforeEach(() => {
  publish.mockReset()
  publish.mockImplementation((relays: string[]) => relays.map(() => Promise.resolve('ok')))
  signEvent = vi.fn(async (e: object) => ({ ...e, id: 'x', pubkey: 'p', sig: 's' }))
  ;(window as unknown as { nostr: unknown }).nostr = { signEvent }
})

describe('submitMintReview', () => {
  it('signs a kind 38000 event with the NIP-87 k tag, the cashu-marked u tag and the comment', async () => {
    await submitMintReview(MINT, 4, '  Works well  ')
    expect(signEvent).toHaveBeenCalledTimes(1)
    const ev = signEvent.mock.calls[0]![0] as { kind: number; tags: string[][]; content: string }
    expect(ev.kind).toBe(38000)
    expect(ev.tags).toEqual([
      ['d', MINT],
      ['k', '38172'],
      ['u', MINT, 'cashu'],
      ['rating', '4'],
      ['comment', 'Works well'],
    ])
    expect(ev.content).toBe('[4/5] Works well')
  })

  it('omits the comment tag when there is no comment', async () => {
    await submitMintReview(MINT, 5, '   ')
    const ev = signEvent.mock.calls[0]![0] as { tags: string[][]; content: string }
    expect(ev.tags).toEqual([
      ['d', MINT],
      ['k', '38172'],
      ['u', MINT, 'cashu'],
      ['rating', '5'],
    ])
    expect(ev.content).toBe('[5/5]')
  })

  it('publishes the signed event to the review publish relays', async () => {
    await submitMintReview(MINT, 3, '')
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0]![0]).toEqual(REVIEW_PUBLISH_RELAYS)
    expect(publish.mock.calls[0]![1]).toMatchObject({ kind: 38000, id: 'x', sig: 's' })
  })
})
