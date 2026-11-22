// public/early-preload.js starts the Dashboard's mint list request at HTML parse time, on "/" only. It is a plain script
// (the CSP has no inline script and Vite does not bundle public/), so the tests run its source against a fake location.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { addBrandHashesToHtml, brandHash } from '../../vite-brand-assets'
import { addMintDetailPreloadAttr, mintDetailModuleUrls } from '../../vite-route-preload'

const ROOT = process.cwd()
const SCRIPT = fs.readFileSync(path.join(ROOT, 'public/early-preload.js'), 'utf8')
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const SRC_CSS = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8')

function runAt(pathname: string, modules?: string): HTMLLinkElement[] {
  const script = document.createElement('script')
  if (modules !== undefined) script.setAttribute('data-mint-detail-modules', modules)
  new Function('location', 'document', SCRIPT)({ pathname }, new Proxy(document, {
    get: (doc, key) => {
      if (key === 'currentScript') return script
      const v = Reflect.get(doc, key, doc) as unknown
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(doc) : v
    },
  }))
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')]
}
const modulePreloads = () => [...document.head.querySelectorAll('link[rel="modulepreload"]')].map(l => l.getAttribute('href'))

describe('early preload of the known-mints request', () => {
  beforeEach(() => { document.head.innerHTML = '' })

  it('adds exactly one preload for /api/mints/known on "/", as a same-origin fetch', () => {
    const links = runAt('/')
    expect(links).toHaveLength(1)
    const link = links[0] as HTMLLinkElement
    expect(link.getAttribute('as')).toBe('fetch')
    expect(link.getAttribute('href')).toBe('/api/mints/known')
    // as="fetch" is reused by fetch() only with a matching credentials mode: crossorigin=anonymous is "same-origin".
    expect(link.getAttribute('crossorigin')).toBe('anonymous')
  })

  it.each(['/mint/https%3A%2F%2Fx.example', '/mint/https%3A%2F%2Fx.example/', '/mint/x.example'])(
    'also preloads on the mint detail route %s (MintDetail reads the same list)', route => {
      const links = runAt(route)
      expect(links).toHaveLength(1)
      expect(links[0]?.getAttribute('href')).toBe('/api/mints/known')
    })

  it.each(['/stats', '/about', '/methodology', '/for-wallets', '/wallets', '/learn', '/mint/nostr/naddr1abc', '/mint/a/b', '/mint/', '/nope'])(
    'adds nothing on %s (the preload would be unused there)', route => {
      expect(runAt(route)).toHaveLength(0)
    })

  it('requests the URL fetchKnownMints requests, with no options', () => {
    const hook = fs.readFileSync(path.join(ROOT, 'src/hooks/useKnownMints.ts'), 'utf8')
    expect(hook).toContain("fetch('/api/mints/known')")
    expect(SCRIPT).toContain("setAttribute('href', '/api/mints/known')")
  })

  it('index.html loads it as a plain async script, and carries no static preload for every route but the body font', () => {
    expect(INDEX).toContain('<script async src="/early-preload.js"></script>')
    // P2 (2026-11-22): the Latin body font is used on every route, so its preload is never unused.
    const preloads = INDEX.match(/<link[^>]*rel="preload"[^>]*>/g) ?? []
    expect(preloads).toEqual(['<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/MintRadarSans-2.0.27-latin.woff2" />'])
    expect(SRC_CSS).toContain("src: url('/fonts/MintRadarSans-2.0.27-latin.woff2') format('woff2')")
    expect(INDEX).not.toMatch(/<script[^>]*type="module"[^>]*early-preload/)
  })

  it('a build links it with ?v=<hash of the file>, so a changed script is never served from the year-long cache', () => {
    expect(addBrandHashesToHtml(INDEX)).toContain(`<script async src="/early-preload.js?v=${brandHash('/early-preload.js')}"></script>`)
  })

  // P1 (2026-11-22)
  it('on /mint/:url modulepreloads the MintDetail chunks the build wrote into the script tag', () => {
    runAt('/mint/x.example', '/assets/MintDetail-abc.js /assets/vendor-charts-def.js')
    expect(modulePreloads()).toEqual(['/assets/MintDetail-abc.js', '/assets/vendor-charts-def.js'])
  })

  it('no modulepreload on "/" or without the attribute (dev), and nothing that is not an /assets/ script', () => {
    runAt('/', '/assets/MintDetail-abc.js')
    expect(modulePreloads()).toEqual([])
    document.head.innerHTML = ''
    runAt('/mint/x.example')
    expect(modulePreloads()).toEqual([])
    document.head.innerHTML = ''
    runAt('/mint/x.example', 'https://evil.example/x.js /assets/a"b.js /assets/ok.js')
    expect(modulePreloads()).toEqual(['/assets/ok.js'])
  })

  it('the build picks the MintDetail chunk and its imports the entry does not load already', () => {
    const chunk = (fileName: string, imports: string[], isEntry = false, facadeModuleId: string | null = null) =>
      ({ type: 'chunk' as const, fileName, imports, isEntry, facadeModuleId })
    const bundle = {
      'assets/index-1.js': chunk('assets/index-1.js', ['assets/vendor-react-2.js'], true, '/r/src/main.tsx'),
      'assets/vendor-react-2.js': chunk('assets/vendor-react-2.js', []),
      'assets/MintDetail-3.js': chunk('assets/MintDetail-3.js', ['assets/vendor-react-2.js', 'assets/vendor-charts-4.js'], false, '/r/src/pages/MintDetail.tsx'),
      'assets/vendor-charts-4.js': chunk('assets/vendor-charts-4.js', []),
    }
    const urls = mintDetailModuleUrls(bundle)
    expect(urls).toEqual(['/assets/MintDetail-3.js', '/assets/vendor-charts-4.js'])
    expect(addMintDetailPreloadAttr('<script async src="/early-preload.js?v=1234abcd"></script>', urls))
      .toBe('<script async src="/early-preload.js?v=1234abcd" data-mint-detail-modules="/assets/MintDetail-3.js /assets/vendor-charts-4.js"></script>')
  })
})
