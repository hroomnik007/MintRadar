import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'

const FALLBACK_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.cashumints.space',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://offchain.pub',
  'wss://nostr-pub.wellorder.net',
]

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

    const queryRelays = relays && relays.length > 0 ? relays : FALLBACK_RELAYS

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
