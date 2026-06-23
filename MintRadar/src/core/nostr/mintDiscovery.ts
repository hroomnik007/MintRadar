import { verifyEvent } from 'nostr-tools'
import { sharedPool } from '@/core/nostr/pool'

export interface NostrMintEvent {
  url: string
  name?: string
  description?: string
  pubkey: string
  createdAt: number
}

const DISCOVERY_RELAYS: string[] = [
  'wss://relay.nostr.band',
  'wss://relay.damus.io',
  'wss://nostr.wine',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://offchain.pub',
]

const MAX_URL_LENGTH = 500
const MAX_TEXT_LENGTH = 100
const TIMEOUT_MS = 12000

function sanitizeText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  return raw.replace(/<[^>]*>/g, '').slice(0, MAX_TEXT_LENGTH) || undefined
}

function extractTag(tags: string[][], name: string): string | undefined {
  return tags.find(t => t[0] === name)?.[1]
}

export async function fetchNostrMints(signal?: AbortSignal): Promise<NostrMintEvent[]> {
  const seen = new Map<string, NostrMintEvent>()
  // Object property avoids TypeScript CFA narrowing `let` variables assigned inside
  // closures to `never` in finally blocks (TypeScript 5.4+ behaviour).
  const cleanup: { sub: ReturnType<typeof sharedPool.subscribeMany> | null } = { sub: null }

  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, TIMEOUT_MS)

      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
      }

      cleanup.sub = sharedPool.subscribeMany(
        DISCOVERY_RELAYS,
        { kinds: [38172], limit: 100 } as import('nostr-tools').Filter,
        {
          onevent(event) {
            if (!verifyEvent(event)) return
            const rawUrl = extractTag(event.tags as string[][], 'u')
            if (!rawUrl) return
            if (!rawUrl.startsWith('https://') || rawUrl.length > MAX_URL_LENGTH) return

            const existing = seen.get(rawUrl)
            if (existing !== undefined && existing.createdAt >= event.created_at) return

            const nameRaw = extractTag(event.tags as string[][], 'name') ?? extractTag(event.tags as string[][], 'd')
            const descRaw = extractTag(event.tags as string[][], 'description')

            const name = sanitizeText(nameRaw)
            const description = sanitizeText(descRaw)
            seen.set(rawUrl, {
              url: rawUrl,
              ...(name !== undefined ? { name } : {}),
              ...(description !== undefined ? { description } : {}),
              pubkey: event.pubkey,
              createdAt: event.created_at,
            })
          },
          oneose() {
            clearTimeout(timer)
            resolve()
          },
        }
      )
    })

    return Array.from(seen.values()).sort((a, b) => b.createdAt - a.createdAt)
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[fetchNostrMints] error:', err)
    }
    return []
  } finally {
    cleanup.sub?.close()
  }
}
