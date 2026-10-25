// public/early-preload.js starts the Dashboard's mint list request at HTML parse time, on "/" only. It is a plain script
// (the CSP has no inline script and Vite does not bundle public/), so the tests run its source against a fake location.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { addBrandHashesToHtml, brandHash } from '../../vite-brand-assets'

const ROOT = process.cwd()
const SCRIPT = fs.readFileSync(path.join(ROOT, 'public/early-preload.js'), 'utf8')
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')

function runAt(pathname: string): HTMLLinkElement[] {
  new Function('location', SCRIPT)({ pathname })
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')]
}

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

  it('index.html loads it as a plain async script, and carries no static preload for every route', () => {
    expect(INDEX).toContain('<script async src="/early-preload.js"></script>')
    expect(INDEX).not.toMatch(/rel="preload"/)
    expect(INDEX).not.toMatch(/<script[^>]*type="module"[^>]*early-preload/)
  })

  it('a build links it with ?v=<hash of the file>, so a changed script is never served from the year-long cache', () => {
    expect(addBrandHashesToHtml(INDEX)).toContain(`<script async src="/early-preload.js?v=${brandHash('/early-preload.js')}"></script>`)
  })
})
