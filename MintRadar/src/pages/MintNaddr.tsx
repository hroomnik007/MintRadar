import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'
import { DISCOVERY_RELAYS, PROFILE_RELAYS, REVIEW_READ_RELAYS, REVIEW_RELAYS } from '@/core/nostr/relays'
import { resolveNaddrRelays } from '@/core/nostr/relayHints'

const FALLBACK_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.cashumints.space',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]

// Relay hints in an naddr come from the link, i.e. from whoever made it: only hints for relays we already
// know are used (see relayHints.ts); the rest is ignored without a request.
const KNOWN_RELAYS = [...REVIEW_RELAYS, ...REVIEW_READ_RELAYS, ...DISCOVERY_RELAYS, ...PROFILE_RELAYS]

// Handles NIP-89 deep links: /mint/nostr/:naddr
// Decodes the naddr, fetches the kind:38172 event, extracts the "u" (mint URL)
// tag, and redirects to /mint/:url. Redirects to Dashboard on any failure.
export default function MintNaddr() {
  const { naddr } = useParams<{ naddr: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!naddr) { navigate('/'); return }

    let decoded: ReturnType<typeof nip19.decode>
    try {
      decoded = nip19.decode(naddr)
    } catch {
      navigate('/')
      return
    }

    if (decoded.type !== 'naddr') { navigate('/'); return }

    const { kind, pubkey, identifier, relays } = decoded.data
    if (kind !== 38172) { navigate('/'); return }

    const queryRelays = resolveNaddrRelays(relays, KNOWN_RELAYS, FALLBACK_RELAYS)

    Promise.race([
      sharedPool.querySync(queryRelays, {
        kinds: [38172],
        authors: [pubkey],
        '#d': [identifier],
        limit: 1,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ])
      .then(events => {
        const event = (events as NostrEvent[])[0]
        if (!event) { navigate('/'); return }
        const mintUrl = event.tags.find(t => t[0] === 'u')?.[1]
        if (!mintUrl?.startsWith('https://')) { navigate('/'); return }
        navigate(`/mint/${encodeURIComponent(mintUrl)}`, { replace: true })
      })
      .catch(() => navigate('/'))
  }, [naddr, navigate])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ fontSize: 13, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
        Resolving mint…
      </div>
    </div>
  )
}
