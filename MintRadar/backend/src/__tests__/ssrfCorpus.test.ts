import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

// The legitimate corpus: every relay the backend or the frontend is configured with, a sample of mint hosts (e2e
// fixtures + well-known operators) and the typical shapes of real hosts must stay ALLOWED by the guard. If a rule is
// ever tightened too far, this is the test that says which real host it would cut off. DNS is stubbed.
vi.mock('dns/promises', () => ({ lookup: vi.fn() }))

import { lookup } from 'dns/promises'
import { checkUrlSafety, checkWsUrlSafety, isWellFormedMintUrl, isAllowedRelayPort } from '../ssrf.js'
import { DISCOVERY_RELAYS } from '../discovery.js'
import { REVIEW_SYNC_RELAYS } from '../reviewsSync.js'
import { ATTESTATION_RELAYS } from '../healthAssertions.js'
import { META_RELAYS } from '../nostrService.js'
import { ATTESTATION_PROFILE_RELAYS } from '../healthPublisher.js'
import { ATTESTATION_RELAYS_PUBLIC } from '../shared/healthAssertionConstants.js'

const vLookup = vi.mocked(lookup)
beforeEach(() => {
  vLookup.mockReset()
  vLookup.mockResolvedValue([{ address: '104.26.9.58', family: 4 }, { address: '2606:4700:20::681a:83a', family: 6 }] as never)
})

const wssIn = (rel: string): string[] => [...new Set(readFileSync(new URL(rel, import.meta.url), 'utf8').match(/wss?:\/\/[a-z0-9.-]+(?::\d+)?/gi) ?? [])]
// Frontend relay lists (src/core/nostr/*.ts): read as text, the backend does not import frontend code.
const FRONTEND_RELAYS = [...new Set([...wssIn('../../../src/core/nostr/relays.ts'), ...wssIn('../../../src/core/nostr/watchlistSync.ts')])]

const GROUPS: Record<string, readonly string[]> = {
  'review sync relays': REVIEW_SYNC_RELAYS,
  'discovery relays': DISCOVERY_RELAYS,
  'notification / meta relays': META_RELAYS,
  'attestation relays': ATTESTATION_RELAYS,
  'attestation profile relays': ATTESTATION_PROFILE_RELAYS,
  'attestation relays (public constant)': ATTESTATION_RELAYS_PUBLIC,
  'frontend relay lists': FRONTEND_RELAYS,
}

describe('relay corpus', () => {
  it('the groups are not empty (the corpus really contains relays)', () => {
    for (const [name, list] of Object.entries(GROUPS)) expect(list.length, name).toBeGreaterThan(0)
    expect(FRONTEND_RELAYS.length).toBeGreaterThan(8)
  })
  for (const [name, list] of Object.entries(GROUPS)) {
    it.each([...new Set(list)])(`${name}: %s is allowed (port rule + address rules)`, async (url) => {
      expect(isAllowedRelayPort(url), 'port rule').toBe(true)
      expect(await checkWsUrlSafety(url)).toBe('safe')
    })
  }
})

describe('mint corpus', () => {
  const E2E_FIXTURE_MINTS = ['https://alpha.mint.example', 'https://bravo.mint.example', 'https://charlie.mint.example', 'https://delta.mint.example', 'https://echo.mint.example']
  const KNOWN_OPERATORS = [
    'https://mint.minibits.cash/Bitcoin', 'https://mint.coinos.io', 'https://stablenut.umint.cash', 'https://mint.lnvoltz.com', 'https://mint.colbitcoin.com',
    'https://mint.mikelcalvo.net', 'https://rugs.cashu.exchange', 'https://rugs01.cashu.exchange', 'https://mint.lnwallet.app', 'https://21mint.me',
    'https://cashu.cz', 'https://mint.chorus.community', 'https://testnut.cashu.space', 'https://mint.example.com:3338', 'https://my_mint.example.com',
    'https://xn--bcher-kva.example', 'https://abcdefghijklmnop.onion', 'https://mint.example.com.',
  ]
  it.each([...E2E_FIXTURE_MINTS, ...KNOWN_OPERATORS])('%s is allowed (syntax + address rules)', async (url) => {
    expect(isWellFormedMintUrl(url)).toBe(true)
    if (!url.includes('.onion')) expect(await checkUrlSafety(url)).toBe('safe')
  })

  it('a Cloudflare-fronted host answering with several anycast addresses (v4 + v6) is allowed', async () => {
    vLookup.mockResolvedValue([
      { address: '104.26.8.58', family: 4 }, { address: '104.26.9.58', family: 4 }, { address: '172.67.70.12', family: 4 },
      { address: '2606:4700:20::681a:83a', family: 6 }, { address: '2606:4700:20::681a:93a', family: 6 }, { address: '2606:4700:20::ac43:460c', family: 6 },
    ] as never)
    expect(await checkUrlSafety('https://mint.behind-cloudflare.example')).toBe('safe')
    expect(await checkWsUrlSafety('wss://relay.behind-cloudflare.example')).toBe('safe')
  })

  it('an IPv6-only public host is allowed', async () => {
    vLookup.mockResolvedValue([{ address: '2a00:1450:4001:81b::200e', family: 6 }] as never)
    expect(await checkUrlSafety('https://v6only.example.org')).toBe('safe')
    expect(await checkWsUrlSafety('wss://v6only.example.org')).toBe('safe')
  })

  it('public addresses that sit next to a blocked range are allowed', async () => {
    for (const ip of ['172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.255.0.1', '192.167.255.255', '198.20.0.1', '223.255.255.255', '9.255.255.255', '11.0.0.1', '126.255.255.255', '128.0.0.1']) {
      vLookup.mockResolvedValue([{ address: ip, family: 4 }] as never)
      expect(await checkUrlSafety('https://edge.example.org'), ip).toBe('safe')
    }
  })
})
