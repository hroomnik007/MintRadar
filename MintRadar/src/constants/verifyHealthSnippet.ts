// The code example of the /for-wallets section "Signed health assertions on Nostr": this exact text is shown on the
// page AND evaluated by backend/src/__tests__/verifyHealthSnippet.test.ts against events from the real builder (valid
// event, wrong key, tampered tag, expired, other d, nothing found) and against the URL table of the publisher tests.
// It may import nothing but nostr-tools (the test checks that). The key and the relays are interpolated from the shared
// constants, so they exist in one place only. No template literal inside the snippet (it is itself one).
// Relative imports on purpose: the backend test loads this file without the "@" alias.

import { ATTESTATION_NIP05, ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from '../utils/healthAssertionConstants'

const relayList = ATTESTATION_RELAYS_PUBLIC.map(r => `  '${r}',`).join('\n')

export const VERIFY_HEALTH_INSTALL = 'npm install nostr-tools'

export const VERIFY_HEALTH_SNIPPET = `import { verifyEvent, type Event } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'

// Pin the provider key in your code. Confirm it once through NIP-05 (${ATTESTATION_NIP05}).
export const PINNED_PUBKEY = '${ATTESTATION_PUBKEY_HEX}'
export const RELAYS = [
${relayList}
]

export interface MintHealth {
  score: number // rank: the Reliability Score, 0 to 100
  status: string | undefined // online | offline | degraded
  methodology: number // ranks of different methodology numbers are not comparable
  createdAt: number
  expiresAt: number
  tags: Record<string, string>
}

// The d value for a mint URL: https, lower-case host, no default port, no trailing slash on a bare host, no fragment.
export function normalizeMintUrl(raw: string): string {
  let parsed: URL
  try { parsed = new URL(raw.trim()) } catch { return raw.trim() }
  parsed.protocol = 'https:'
  parsed.hostname = parsed.hostname.toLowerCase()
  parsed.hash = ''
  let result = parsed.toString()
  if (parsed.pathname === '/' && parsed.search === '') result = result.replace(/\\/$/, '')
  return result
}

// One event: null unless it is a current, valid assertion of the pinned key about THIS mint.
export function checkHealthEvent(event: Event, mintUrl: string, nowSec = Math.floor(Date.now() / 1000)): MintHealth | null {
  const tag = (name: string): string | undefined => event.tags.find(t => t[0] === name)?.[1]
  if (!verifyEvent(event)) return null // signature and id
  if (event.pubkey !== PINNED_PUBKEY) return null // only the pinned key counts
  if (event.kind !== 30385) return null
  if (tag('d') !== normalizeMintUrl(mintUrl)) return null // never take the d of an event as another mint's identity
  const expiration = Number(tag('expiration'))
  if (!Number.isInteger(expiration) || expiration <= nowSec) return null // expired or missing: no current signal
  if (event.created_at > nowSec + 300) return null // created in the future
  const score = Number(tag('rank'))
  const methodology = Number(tag('methodology'))
  if (!Number.isInteger(score) || score < 0 || score > 100 || !Number.isInteger(methodology)) return null
  return {
    score, status: tag('mint_status'), methodology, createdAt: event.created_at, expiresAt: expiration,
    tags: Object.fromEntries(event.tags.map(t => [t[0], t[1] ?? ''])),
  }
}

// The newest valid assertion for a mint, or null. null means "unknown", never "bad".
export async function getMintHealth(mintUrl: string): Promise<MintHealth | null> {
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(RELAYS, { kinds: [30385], authors: [PINNED_PUBKEY], '#d': [normalizeMintUrl(mintUrl)] })
    let best: MintHealth | null = null
    for (const event of events) {
      const health = checkHealthEvent(event, mintUrl)
      if (health && (best === null || health.createdAt > best.createdAt)) best = health
    }
    return best
  } finally {
    pool.close(RELAYS)
  }
}

// console.log(await getMintHealth('https://mint.example.com'))
`
