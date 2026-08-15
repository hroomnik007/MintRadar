import { useQuery } from '@tanstack/react-query'
import { verifyEvent } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'

export const FOLLOW_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.cypherpunk.today',
]

export interface FollowRec {
  url: string
  count: number
  recommenders: string[]
}

export async function fetchFollowRecs(pubkey: string): Promise<{ recs: FollowRec[]; followCount: number }> {
  const followEvents = await Promise.race([
    sharedPool.querySync(FOLLOW_RELAYS, { kinds: [3], authors: [pubkey], limit: 1 }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
  ]).catch(() => [] as NostrEvent[])

  const followEvent = (followEvents as NostrEvent[]).filter(e => verifyEvent(e))[0]
  if (!followEvent) return { recs: [], followCount: 0 }

  const follows = followEvent.tags
    .filter((t: string[]) => t[0] === 'p' && typeof t[1] === 'string' && t[1] !== pubkey)
    .map((t: string[]) => t[1] as string)
    .slice(0, 500)

  if (follows.length === 0) return { recs: [], followCount: 0 }

  const reviewEvents = await Promise.race([
    sharedPool.querySync(FOLLOW_RELAYS, { kinds: [38000], authors: follows, limit: 2000 }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 12000)),
  ]).catch(() => [] as NostrEvent[])

  const urlMap = new Map<string, Set<string>>()
  for (const ev of (reviewEvents as NostrEvent[])) {
    if (!verifyEvent(ev)) continue
    for (const tag of ev.tags as string[][]) {
      if (tag[0] === 'u' && typeof tag[1] === 'string' && tag[1].startsWith('https://')) {
        const url = tag[1].trim()
        if (!urlMap.has(url)) urlMap.set(url, new Set())
        urlMap.get(url)!.add(ev.pubkey)
      }
    }
  }

  const recs: FollowRec[] = [...urlMap.entries()]
    .map(([url, pubkeys]) => ({ url, count: pubkeys.size, recommenders: [...pubkeys].slice(0, 5) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  return { recs, followCount: follows.length }
}

export function useFollowRecommendations(pubkey: string | null) {
  return useQuery({
    queryKey: ['follow-recs', pubkey],
    queryFn: () => fetchFollowRecs(pubkey!),
    enabled: !!pubkey,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
