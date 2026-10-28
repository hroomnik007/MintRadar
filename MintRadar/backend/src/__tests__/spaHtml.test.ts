import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { naddrEncode } from 'nostr-tools/nip19'
import { renderSpaHtml, resolveSpaHead, type SpaKnownMint } from '../spaHtml.js'
import { ROUTE_META_BY_PATH, PAGE_META, SITE_DESCRIPTION } from '../shared/pageMeta.js'

// The server-side head of index.html (spaHtml.ts): route matching like React Router, the meta of each page from the
// shared definitions, 404 for what the page shows as not found, and HTML escaping of every injected value.

const TEMPLATE = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8')
const KNOWN: SpaKnownMint[] = [
  { url: 'https://21mint.me', name: '21Mint', online: true, reliabilityScore: 97 },
  { url: 'https://mint.example.com', name: 'Cashu', online: false, reliabilityScore: null },
  { url: 'https://xss.example', name: '<script>alert(1)</script>"$&\'', online: true, reliabilityScore: 50 },
]
const enc = encodeURIComponent

const headOf = (html: string) => ({
  title: html.match(/<title>([^<]*)<\/title>/)?.[1],
  canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null,
  ogUrl: html.match(/<meta property="og:url" content="([^"]*)"/)?.[1],
  ogTitle: html.match(/<meta property="og:title" content="([^"]*)"/)?.[1],
  robots: html.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? null,
})

describe('resolveSpaHead: static pages', () => {
  it.each(Object.keys(ROUTE_META_BY_PATH))('%s uses its ROUTE_META_BY_PATH entry, canonical = the route', key => {
    const meta = ROUTE_META_BY_PATH[key as keyof typeof ROUTE_META_BY_PATH]
    const head = resolveSpaHead(key, KNOWN)
    expect(head.status).toBe(200)
    expect(head.title).toBe(meta.title)
    expect(head.description).toBe(meta.description)
    expect(head.canonical).toBe(`https://mintradar.org${key}`)
    expect(head.noindex).toBe(key === '/watchlist')
  })

  it('matches like the router: case-insensitive, one trailing slash', () => {
    expect(resolveSpaHead('/Stats/', KNOWN)).toMatchObject({ status: 200, canonical: 'https://mintradar.org/stats' })
    expect(resolveSpaHead('/methodology/', KNOWN).title).toBe(PAGE_META['/methodology'].title)
    expect(resolveSpaHead('/stats/x', KNOWN).status).toBe(404)
    expect(resolveSpaHead('/mint/', KNOWN).status).toBe(404)
  })
})

describe('resolveSpaHead: Learn modules', () => {
  it('a module id and its number both name the module (canonical = the id)', () => {
    const byId = resolveSpaHead('/learn/how-to-choose-a-mint', KNOWN)
    expect(byId).toMatchObject({ status: 200, canonical: 'https://mintradar.org/learn/how-to-choose-a-mint' })
    expect(byId.title).toMatch(/ - MintRadar Learn$/)
    expect(resolveSpaHead('/learn/3', KNOWN).canonical).toBe(byId.canonical)
  })
  it('an unknown module is a 404', () => {
    expect(resolveSpaHead('/learn/99', KNOWN)).toMatchObject({ status: 404, canonical: null, noindex: true, title: 'Module not found - MintRadar Learn' })
  })
})

describe('resolveSpaHead: Mint Detail', () => {
  it('a tracked mint: its display name, operational description, canonical = the encoded URL', () => {
    const head = resolveSpaHead(`/mint/${enc('https://21mint.me')}`, KNOWN)
    expect(head.status).toBe(200)
    expect(head.title).toBe('21Mint - Cashu Mint Reliability Score & Uptime | MintRadar')
    expect(head.description).toBe('21Mint (21mint.me) is online with a Reliability Score of 97/100. See live uptime, latency, NUT support and reviews on MintRadar.')
    expect(head.canonical).toBe(`https://mintradar.org/mint/${enc('https://21mint.me')}`)
    expect(head.ogUrl).toBe(head.canonical)
    expect(head.noindex).toBe(false)
  })
  it('a bare host resolves like the page does, canonical = the tracked URL', () => {
    expect(resolveSpaHead('/mint/21mint.me', KNOWN)).toMatchObject({ status: 200, canonical: `https://mintradar.org/mint/${enc('https://21mint.me')}` })
  })
  it('a generic name falls back to the hostname, no score shows a dash', () => {
    const head = resolveSpaHead(`/mint/${enc('https://mint.example.com')}`, KNOWN)
    expect(head.title).toBe('mint.example.com - Cashu Mint Reliability Score & Uptime | MintRadar')
    expect(head.description).toContain('is offline with a Reliability Score of \u2014/100')
  })
  it('an untracked mint is a 404 whose og:url is the opened address, not the home page', () => {
    const path = `/mint/${enc('https://unknown.example')}`
    expect(resolveSpaHead(path, KNOWN)).toMatchObject({
      status: 404, canonical: null, noindex: true, title: 'Mint not found | MintRadar', ogUrl: `https://mintradar.org${path}`,
    })
  })
  it('a slug that does not decode is a 404', () => {
    expect(resolveSpaHead('/mint/%E0%A4%A', KNOWN).status).toBe(404)
    expect(resolveSpaHead('/mint/%2525zz', KNOWN).status).toBe(404)
  })
  it('/mint/nostr/: a kind-38172 naddr is served noindex, anything else is a 404', () => {
    const ok = naddrEncode({ kind: 38172, pubkey: 'ab'.repeat(32), identifier: 'x' })
    const other = naddrEncode({ kind: 30023, pubkey: 'ab'.repeat(32), identifier: 'x' })
    expect(resolveSpaHead(`/mint/nostr/${ok}`, KNOWN)).toMatchObject({ status: 200, noindex: true, canonical: null })
    expect(resolveSpaHead(`/mint/nostr/${other}`, KNOWN)).toMatchObject({ status: 404, noindex: true })
    expect(resolveSpaHead('/mint/nostr/naddr1bad', KNOWN)).toMatchObject({ status: 404, noindex: true })
  })
})

describe('resolveSpaHead: unknown routes', () => {
  it('404, noindex, no canonical, og:url = the opened address', () => {
    expect(resolveSpaHead('/no-such-page', KNOWN)).toMatchObject({
      status: 404, title: 'Page not found | MintRadar', description: SITE_DESCRIPTION, canonical: null,
      ogUrl: 'https://mintradar.org/no-such-page', noindex: true,
    })
  })
})

describe('renderSpaHtml', () => {
  it('rewrites title, description, canonical, og and twitter tags; keeps og:image and the JSON-LD', () => {
    const html = renderSpaHtml(TEMPLATE, resolveSpaHead('/stats', KNOWN))
    expect(headOf(html)).toEqual({
      title: ROUTE_META_BY_PATH['/stats'].title, canonical: 'https://mintradar.org/stats', ogUrl: 'https://mintradar.org/stats',
      ogTitle: ROUTE_META_BY_PATH['/stats'].title, robots: null,
    })
    expect(html).toContain(`<meta name="twitter:description" content="${ROUTE_META_BY_PATH['/stats'].description}"`)
    expect(html).toContain('<meta property="og:image" content="https://mintradar.org/og-image-reliability.png"')
    expect(html).toContain('application/ld+json')
    expect(html).toContain('<div id="root"></div>')
  })
  it('not found: robots noindex, no canonical link', () => {
    const html = renderSpaHtml(TEMPLATE, resolveSpaHead('/nope', KNOWN))
    expect(headOf(html)).toMatchObject({ canonical: null, robots: 'noindex, follow', ogUrl: 'https://mintradar.org/nope' })
    expect(html).not.toContain('rel="canonical"')
  })
  it('escapes a hostile mint name everywhere ($ patterns included) and an odd path in og:url', () => {
    const html = renderSpaHtml(TEMPLATE, resolveSpaHead(`/mint/${enc('https://xss.example')}`, KNOWN))
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;$&amp;&#39; - Cashu Mint')
    const odd = renderSpaHtml(TEMPLATE, resolveSpaHead('/x"><script>', KNOWN))
    expect(odd).not.toContain('"><script>')
    expect(headOf(odd).ogUrl).toBe('https://mintradar.org/x%22%3E%3Cscript%3E')
  })
})

// Guard against the classic real-404 failure (deploy-and-infra.md decision record): a route added to src/App.tsx but
// not to the server routing would answer 404 to crawlers. Every path in App.tsx must resolve to 200 here.
describe('resolveSpaHead: every route of src/App.tsx is served with 200', () => {
  const appTsx = readFileSync(resolve(__dirname, '../../../src/App.tsx'), 'utf8')
  const paths = [...appTsx.matchAll(/\{\s*path:\s*'([^']+)'/g)].map(m => m[1]).filter(p => p !== '*')
  const sample: Record<string, string> = {
    ':moduleId': 'cashu-basics',
    ':url': enc('https://21mint.me'),
    ':naddr': naddrEncode({ kind: 38172, pubkey: 'a'.repeat(64), identifier: 'x' }),
  }

  it('finds the routes in App.tsx', () => {
    expect(paths).toEqual(expect.arrayContaining(['stats', 'learn/:moduleId', 'mint/:url', 'mint/nostr/:naddr']))
    expect(paths.length).toBeGreaterThanOrEqual(11)
  })

  it.each(paths)('/%s', p => {
    const concrete = '/' + p.split('/').map(s => sample[s] ?? s).join('/')
    expect(resolveSpaHead(concrete, KNOWN).status).toBe(200)
  })

  it('the index route (/) is 200', () => {
    expect(resolveSpaHead('/', KNOWN).status).toBe(200)
  })

  it('/nuts (the removed NUT Explorer) is an unknown path: 404 like any other', () => {
    expect(paths).not.toContain('nuts')
    expect(resolveSpaHead('/nuts', KNOWN).status).toBe(404)
    expect(resolveSpaHead('/nuts', KNOWN).status).toBe(resolveSpaHead('/this/does/not/exist', KNOWN).status)
  })
})
