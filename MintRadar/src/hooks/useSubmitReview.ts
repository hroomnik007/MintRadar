import type { NostrEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'

const REVIEW_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.cashumints.space',
  'wss://purplepag.es',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]

export async function submitMintReview(
  mintUrl: string,
  rating: number,
  comment: string
): Promise<void> {
  if (!window.nostr) throw new Error('Nostr extension not found')

  const event = {
    kind: 38000,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', mintUrl],
      ['u', mintUrl],
      ['rating', rating.toString()],
      ...(comment.trim() ? [['comment', comment.trim()]] : []),
    ],
    content: comment.trim(),
  }

  const signed = await window.nostr.signEvent(event) as NostrEvent
  await Promise.any(sharedPool.publish(REVIEW_RELAYS, signed))
}
