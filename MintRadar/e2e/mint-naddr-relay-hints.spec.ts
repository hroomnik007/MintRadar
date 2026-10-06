import { test, expect, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { installApiMocks, MOCK_MINTS } from './fixtures/mocks'
import { DISCOVERY_RELAYS, PROFILE_RELAYS, REVIEW_READ_RELAYS, REVIEW_RELAYS } from '../src/core/nostr/relays'

// /mint/nostr/<naddr> (MintNaddr.tsx): the relay hints inside an naddr are written by whoever made the link.
// Only hints for relays the app already knows may be used (src/core/nostr/relayHints.ts, max 3); the page's
// default relays are always asked as well. A crafted link must never make the browser open a socket to a
// relay of the link author's choosing.

// FALLBACK_RELAYS in MintNaddr.tsx (not exported).
const DEFAULT_HOSTS = [
  'relay.damus.io', 'nos.lol', 'relay.cashumints.space', 'relay.primal.net',
  'relay.snort.social', 'offchain.pub', 'nostr-pub.wellorder.net',
]
const hostOf = (url: string): string => new URL(url).host
const KNOWN_HOSTS = new Set([...REVIEW_RELAYS, ...REVIEW_READ_RELAYS, ...DISCOVERY_RELAYS, ...PROFILE_RELAYS].map(hostOf))

const HOSTILE = ['wss://evil.example', 'wss://127.0.0.1:8765', 'ws://localhost:4870', 'wss://10.0.0.5']
const HOSTILE_RE = /evil\.example|127\.0\.0\.1|localhost|^10\.0\.0\.5/

const ALPHA = MOCK_MINTS[0]!.url
const SK = generateSecretKey()
const PUBKEY = getPublicKey(SK)
const D_TAG = 'naddr-hint-mint'
// The stub mint announcement the lookup resolves to; its `u` tag sends the page to the mocked Alpha mint.
const ANNOUNCEMENT = finalizeEvent({
  kind: 38172, created_at: Math.floor(Date.now() / 1000), tags: [['d', D_TAG], ['u', ALPHA]], content: '',
}, SK)

interface Seen { all: string[]; lookup: string[] }

/** Stub every wss:// relay; record each connection attempt and which hosts received the naddr lookup REQ. */
async function recordRelays(page: Page): Promise<Seen> {
  const seen: Seen = { all: [], lookup: [] }
  await page.routeWebSocket(/^wss?:\/\/(?!localhost:5173)/, ws => {
    const host = hostOf(ws.url())
    seen.all.push(host)
    ws.onMessage(message => {
      let parsed: unknown
      try { parsed = JSON.parse(typeof message === 'string' ? message : message.toString()) } catch { return }
      if (!Array.isArray(parsed)) return
      const [verb, subId, filter] = parsed as [string, string, Record<string, unknown> | undefined]
      if (verb === 'EVENT') {
        ws.send(JSON.stringify(['OK', (subId as unknown as { id?: string } | undefined)?.id ?? '', true, '']))
        return
      }
      if (verb !== 'REQ') return
      const kinds = (filter?.['kinds'] as number[] | undefined) ?? []
      const authors = (filter?.['authors'] as string[] | undefined) ?? []
      if (kinds.includes(38172) && authors.includes(PUBKEY)) {
        seen.lookup.push(host)
        ws.send(JSON.stringify(['EVENT', subId, ANNOUNCEMENT]))
      }
      ws.send(JSON.stringify(['EOSE', subId]))
    })
  })
  return seen
}

async function openNaddr(page: Page, relays: string[]): Promise<Seen> {
  const seen = await recordRelays(page)
  await installApiMocks(page)
  const naddr = nip19.naddrEncode({ kind: 38172, pubkey: PUBKEY, identifier: D_TAG, relays })
  await page.goto(`/mint/nostr/${naddr}`)
  // The lookup resolved and the page rendered the mint it points to.
  await expect(page).toHaveURL(new RegExp(`/mint/${encodeURIComponent(ALPHA).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  await expect(page.locator('.md-tabs')).toBeVisible()
  // Let anything still queued open its socket before the records are read.
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  return seen
}

const unique = (hosts: string[]): string[] => [...new Set(hosts)].sort()

test.describe('naddr relay hints', () => {
  test('hostile hints only: none is contacted, only known relays are', async ({ page }) => {
    const seen = await openNaddr(page, HOSTILE)
    expect(seen.all.filter(h => HOSTILE_RE.test(h))).toEqual([])
    expect(unique(seen.all).filter(h => !KNOWN_HOSTS.has(h))).toEqual([])
    expect(unique(seen.lookup)).toEqual(unique(DEFAULT_HOSTS))
  })

  test('a known hint is used, the hostile one next to it never is', async ({ page }) => {
    const seen = await openNaddr(page, ['wss://evil.example', 'wss://relay.azzamo.net'])
    expect(seen.all.filter(h => HOSTILE_RE.test(h))).toEqual([])
    expect(unique(seen.lookup)).toEqual(unique([...DEFAULT_HOSTS, 'relay.azzamo.net']))
    expect(unique(seen.all).filter(h => !KNOWN_HOSTS.has(h))).toEqual([])
  })

  test('more than 3 known hints: only the first 3 plus the defaults are asked', async ({ page }) => {
    const hints = ['relay.azzamo.net', 'nostr.oxtr.dev', 'relay.nostr.net', 'relay.minibits.cash', 'nostr.bitcoiner.social']
    for (const h of hints) {
      expect(DEFAULT_HOSTS).not.toContain(h) // the exact count below depends on it
      expect(KNOWN_HOSTS.has(h)).toBe(true)
    }
    const seen = await openNaddr(page, hints.map(h => `wss://${h}`))
    expect(unique(seen.lookup)).toEqual(unique([...DEFAULT_HOSTS, ...hints.slice(0, 3)]))
    expect(unique(seen.lookup)).toHaveLength(DEFAULT_HOSTS.length + 3)
    expect(seen.lookup).not.toContain('relay.minibits.cash')
    expect(seen.lookup).not.toContain('nostr.bitcoiner.social')
  })

  test('no hints: only the default relays are asked', async ({ page }) => {
    const seen = await openNaddr(page, [])
    expect(unique(seen.lookup)).toEqual(unique(DEFAULT_HOSTS))
    expect(unique(seen.all).filter(h => !KNOWN_HOSTS.has(h))).toEqual([])
  })
})
