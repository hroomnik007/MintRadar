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

export async function fetchRemoteWatchlist(pubkey: string, userWriteRelays?: string[] | null): Promise<string[]> {
  const pk = pubkey.slice(0, 8)
  const method = detectLoginMethod()

  if (!window.nostr?.nip44) {
    console.warn(`[watchlist-sync] no nip44 support on signer, skipping remote fetch (pubkey=${pk}, method=${method})`)
    return []
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
      return []
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(decrypted)
    } catch (parseErr) {
      console.warn(`[watchlist-sync] decryption failed for event ${event.id} (pubkey=${pk}, method=${method}) — malformed JSON payload`, parseErr)
      return []
    }

    if (!Array.isArray(parsed)) {
      console.warn(`[watchlist-sync] remote list genuinely empty (kind:10003 not found or empty content) (pubkey=${pk}, method=${method})`)
      return []
    }
    const urls = parsed.filter((u): u is string => typeof u === 'string')
    if (urls.length === 0) {
      console.warn(`[watchlist-sync] remote list genuinely empty (kind:10003 not found or empty content) (pubkey=${pk}, method=${method})`)
    }
    return urls
  } catch (err) {
    if (err instanceof Error && err.message === 'timeout') {
      console.warn(`[watchlist-sync] relay timeout after 3s, ${responded}/${total} relays responded (pubkey=${pk}, method=${method})`)
    } else {
      console.warn(`[watchlist-sync] remote list genuinely empty (kind:10003 not found or empty content) — no relay returned a valid event (pubkey=${pk}, method=${method}, ${responded}/${total} relays responded)`, err)
    }
    return []
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
