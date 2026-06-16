import { SimplePool } from 'nostr-tools/pool'
import type { NostrEvent } from 'nostr-tools'

export const WATCHLIST_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
]

const WATCHLIST_KIND = 10003

export async function fetchRemoteWatchlist(pubkey: string): Promise<string[]> {
  if (!window.nostr?.nip44) return []
  const pool = new SimplePool()
  try {
    // Query each relay independently — take the first one that returns an event
    const relayQueries = WATCHLIST_RELAYS.map(relay =>
      pool.querySync([relay], { kinds: [WATCHLIST_KIND], authors: [pubkey], limit: 1 })
        .then(events => {
          if (!events[0]?.content) throw new Error('no event')
          return events[0]
        })
    )
    const event = await Promise.race([
      Promise.any(relayQueries),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ])
    const decrypted = await window.nostr.nip44.decrypt(pubkey, event.content)
    const parsed: unknown = JSON.parse(decrypted)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((u): u is string => typeof u === 'string')
  } catch (err) {
    console.warn('[watchlistSync] fetch failed:', err)
    return []
  } finally {
    pool.destroy()
  }
}

export async function publishWatchlist(pubkey: string, mints: string[]): Promise<void> {
  if (!window.nostr?.nip44) return
  const pool = new SimplePool()
  try {
    const encrypted = await window.nostr.nip44.encrypt(pubkey, JSON.stringify(mints))
    const event = {
      kind: WATCHLIST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [] as string[][],
      content: encrypted,
    }
    const signed = await window.nostr.signEvent(event) as NostrEvent
    await Promise.any(
      WATCHLIST_RELAYS.map(relay => pool.publish([relay], signed))
    ).catch((err: unknown) => {
      console.warn('[watchlistSync] all relays rejected publish:', err)
    })
  } catch (err) {
    console.warn('[watchlistSync] publish failed:', err)
  } finally {
    pool.destroy()
  }
}
