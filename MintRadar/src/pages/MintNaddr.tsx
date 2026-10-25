import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { LoadError } from '@/components/LoadError'
import './MintDetail.css'
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

// Why a link did not resolve. Fixed texts only (never a relay or decode error message).
type NaddrFailure = 'invalid' | 'not-found' | 'unreachable'
export const NADDR_INVALID_TEXT = 'This link is not a valid MintRadar mint link.'
export const NADDR_NOT_FOUND_TEXT = 'No mint announcement was found for this link. The mint may have withdrawn it, or it points to a URL MintRadar does not open.'
export const NADDR_UNREACHABLE_TEXT = 'Could not reach the Nostr relays to resolve this link. Please try again.'

// Handles NIP-89 deep links: /mint/nostr/:naddr
// Decodes the naddr, fetches the kind:38172 event, extracts the "u" (mint URL)
// tag, and redirects to /mint/:url. On failure (2026-10-25) it shows a short error with a way on ("Browse mints",
// "Add a mint") instead of silently dropping the visitor on the Dashboard. A relay timeout is a LoadError with a retry.
type NaddrTarget = { kind: number; pubkey: string; identifier: string; relays?: string[] | undefined }

// Synchronous: a link that does not decode to a kind-38172 naddr is invalid without any relay request.
function decodeTarget(naddr: string | undefined): NaddrTarget | null {
  if (!naddr) return null
  try {
    const decoded = nip19.decode(naddr)
    if (decoded.type !== 'naddr' || decoded.data.kind !== 38172) return null
    return decoded.data
  } catch {
    return null
  }
}

export default function MintNaddr() {
  const { naddr } = useParams<{ naddr: string }>()
  const navigate = useNavigate()
  const [attempt, setAttempt] = useState(0)
  const target = useMemo(() => decodeTarget(naddr), [naddr])
  // The relay outcome belongs to one (link, attempt): a new link or a retry starts as "resolving" again.
  const lookupKey = `${naddr ?? ''}|${attempt}`
  const [outcome, setOutcome] = useState<{ key: string; failure: NaddrFailure } | null>(null)
  const failure: NaddrFailure | null = target === null ? 'invalid' : outcome?.key === lookupKey ? outcome.failure : null

  useEffect(() => {
    if (target === null) return
    const { pubkey, identifier, relays } = target
    const queryRelays = resolveNaddrRelays(relays, KNOWN_RELAYS, FALLBACK_RELAYS)
    let cancelled = false

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
        if (cancelled) return
        const event = (events as NostrEvent[])[0]
        if (!event) { setOutcome({ key: lookupKey, failure: 'not-found' }); return }
        const mintUrl = event.tags.find(t => t[0] === 'u')?.[1]
        if (!mintUrl?.startsWith('https://')) { setOutcome({ key: lookupKey, failure: 'not-found' }); return }
        navigate(`/mint/${encodeURIComponent(mintUrl)}`, { replace: true })
      })
      .catch(() => { if (!cancelled) setOutcome({ key: lookupKey, failure: 'unreachable' }) })
    return () => { cancelled = true }
  }, [target, lookupKey, navigate])

  if (failure === 'unreachable') {
    return (
      <div className="mint-detail">
        <h1 className="sr-only">Mint link</h1>
        <LoadError message={NADDR_UNREACHABLE_TEXT} onRetry={() => setAttempt(a => a + 1)} />
      </div>
    )
  }

  if (failure) {
    return (
      <div className="mint-detail">
        <div className="md-not-tracked" data-testid="naddr-error">
          <h1 className="md-not-tracked-title">Mint link not found</h1>
          <p className="md-not-tracked-body">{failure === 'invalid' ? NADDR_INVALID_TEXT : NADDR_NOT_FOUND_TEXT}</p>
          <p className="md-not-tracked-suggest md-naddr-actions">
            <button type="button" className="md-not-tracked-link" onClick={() => navigate('/')}>Browse tracked mints →</button>
            <button type="button" className="md-not-tracked-link" onClick={() => navigate('/', { state: { openAddMint: true } })}>Add a mint</button>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', flexDirection: 'column', gap: 12,
    }}>
      <h1 style={{ fontSize: 13, fontWeight: 400, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
        Resolving mint…
      </h1>
    </div>
  )
}
