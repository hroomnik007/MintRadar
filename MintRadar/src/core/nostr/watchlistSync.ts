import type { NostrEvent } from 'nostr-tools'
import { verifyEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'
import { detectLoginMethod } from '@/core/nostr/client'

export const WATCHLIST_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.band',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.mom',
  'wss://nostr.oxtr.dev',
  'wss://relay.mostr.pub',
  'wss://relay.noswhere.com',
  'wss://pyramid.fiatjaf.com',
  'wss://nostr.lopp.social',
  'wss://nostr.cypherpunk.today',
]

const WATCHLIST_KIND = 10003

export interface RemoteWatchlistResult {
  urls: string[]
  /**
   * true when the fetch could not be completed (relay timeout, decrypt/parse
   * failure, or every relay rejecting for a reason other than "no matching
   * event") — as opposed to a genuinely empty remote list. Lets the caller
   * show an error fallback instead of silently treating "couldn't sync" the
   * same as "user has nothing watched".
   */
  failed: boolean
}

const NO_EVENT_ERROR = 'no event'

export async function fetchRemoteWatchlist(pubkey: string, userWriteRelays?: string[] | null): Promise<RemoteWatchlistResult> {
  const pk = pubkey.slice(0, 8)
  const method = detectLoginMethod()

  if (!window.nostr?.nip44) {
    console.warn(`[watchlist-sync] no nip44 support on signer, skipping remote fetch (pubkey=${pk}, method=${method})`)
    return { urls: [], failed: false }
  }

  const relays = userWriteRelays && userWriteRelays.length > 0
    ? [...new Set([...WATCHLIST_RELAYS, ...userWriteRelays])]
    : WATCHLIST_RELAYS

  let responded = 0
  const total = relays.length

  try {
    // Query each relay independently — take the first one that returns an event
    const relayQueries = relays.map(relay =>
      sharedPool.querySync([relay], { kinds: [WATCHLIST_KIND], authors: [pubkey], limit: 1 })
        .then(events => {
          const validEvents = events.filter(e => verifyEvent(e))
          if (!validEvents[0]?.content) throw new Error('no event')
          return validEvents[0]
        })
        .finally(() => { responded++ })
    )
    const event = await Promise.race([
      Promise.any(relayQueries),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ])

    let decrypted: string
    try {
      decrypted = await window.nostr.nip44.decrypt(pubkey, event.content)
    } catch (decryptErr) {
      console.warn(`[watchlist-sync] decryption failed for event ${event.id} (pubkey=${pk}, method=${method})`, decryptErr)
      return { urls: [], failed: true }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(decrypted)
    } catch (parseErr) {
      console.warn(`[watchlist-sync] decryption failed for event ${event.id} (pubkey=${pk}, method=${method}) — malformed JSON payload`, parseErr)
      return { urls: [], failed: true }
    }

    if (!Array.isArray(parsed)) {
      console.warn(`[watchlist-sync] remote list genuinely empty (kind:10003 not found or empty content) (pubkey=${pk}, method=${method})`)
      return { urls: [], failed: false }
    }
    const urls = parsed.filter((u): u is string => typeof u === 'string')
    if (urls.length === 0) {
      console.warn(`[watchlist-sync] remote list genuinely empty (kind:10003 not found or empty content) (pubkey=${pk}, method=${method})`)
    }
    return { urls, failed: false }
  } catch (err) {
    if (err instanceof Error && err.message === 'timeout') {
      console.warn(`[watchlist-sync] relay timeout after 3s, ${responded}/${total} relays responded (pubkey=${pk}, method=${method})`)
      return { urls: [], failed: true }
    }
    // Promise.any rejected before the timeout — every relay query settled.
    // If every rejection is our own deliberate "no event" (relay reached,
    // just nothing matching), the remote list is genuinely empty rather than
    // unreachable. Any other rejection reason (connection/protocol error)
    // means at least one relay could not actually be queried — surface that
    // as a failure instead of silently treating it as "nothing to sync".
    const reasons = err instanceof AggregateError ? err.errors : [err]
    const allGenuinelyEmpty = reasons.every(r => r instanceof Error && r.message === NO_EVENT_ERROR)
    if (allGenuinelyEmpty) {
      console.warn(`[watchlist-sync] remote list genuinely empty (kind:10003 not found or empty content) — no relay returned a valid event (pubkey=${pk}, method=${method}, ${responded}/${total} relays responded)`)
      return { urls: [], failed: false }
    }
    console.warn(`[watchlist-sync] relay fetch failed (pubkey=${pk}, method=${method}, ${responded}/${total} relays responded)`, err)
    return { urls: [], failed: true }
  }
}

export async function publishWatchlist(pubkey: string, mints: string[], userWriteRelays?: string[] | null): Promise<void> {
  if (!window.nostr?.nip44) return
  const relays = userWriteRelays && userWriteRelays.length > 0
    ? [...new Set([...WATCHLIST_RELAYS, ...userWriteRelays])]
    : WATCHLIST_RELAYS
  try {
    const encrypted = await window.nostr.nip44.encrypt(pubkey, JSON.stringify(mints))
    const event = {
      kind: WATCHLIST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [] as string[][],
      content: encrypted,
    }
    const signed = await window.nostr.signEvent(event) as NostrEvent
    const publishPromises = sharedPool.publish(relays, signed)
    publishPromises.forEach(p => p.catch(() => {}))
    await Promise.any(publishPromises).catch((err: unknown) => {
      console.warn('[watchlistSync] all relays rejected publish:', err)
    })
  } catch (err) {
    console.warn('[watchlistSync] publish failed:', err)
  }
}
