import type { NostrEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'
import { REVIEW_PUBLISH_RELAYS } from '@/core/nostr/relays'

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
  const publishPromises = sharedPool.publish(REVIEW_PUBLISH_RELAYS, signed)
  publishPromises.forEach(p => p.catch(() => {}))
  await Promise.any(publishPromises)
}
