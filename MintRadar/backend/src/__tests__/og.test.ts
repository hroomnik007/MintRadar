import { describe, it, expect, vi } from 'vitest'
import { escapeHtml, mintStatusLabel, renderMintOgHtml, renderPageOgHtml, type OgMintData } from '../og.js'
import { PAGE_META, OG_PAGE_SLUGS } from '../shared/pageMeta.js'

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`<script>alert("x")&'y'</script>`))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;y&#39;&lt;/script&gt;')
  })

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Minibits Mint')).toBe('Minibits Mint')
  })
})

describe('mintStatusLabel', () => {
  it('is Degraded when degraded, regardless of online value', () => {
    expect(mintStatusLabel({ online: true, degraded: true })).toBe('Degraded')
  })

  it('is Online when online and not degraded', () => {
    expect(mintStatusLabel({ online: true, degraded: false })).toBe('Online')
  })

  it('is Offline when online is false and not degraded', () => {
    expect(mintStatusLabel({ online: false, degraded: false })).toBe('Offline')
  })

  it('is Offline when online is null (never probed) and not degraded', () => {
    expect(mintStatusLabel({ online: null, degraded: false })).toBe('Offline')
  })
})

describe('renderMintOgHtml', () => {
  const mintUrl = 'https://mint.example.com'
  const baseMint: OgMintData = { name: 'x', reliabilityScore: 50, online: true, degraded: false }

  it('renders name, reliability score and status into title/description for a known mint', () => {
    const mint: OgMintData = { name: 'Example Mint', reliabilityScore: 87, online: true, degraded: false }
    const html = renderMintOgHtml(mint, mintUrl)

    expect(html).toContain('<title>Example Mint — MintRadar</title>')
    expect(html).toContain('property="og:title" content="Example Mint — MintRadar"')
    expect(html).toContain('content="Reliability Score: 87% · Online"')
    expect(html).toContain(`property="og:url" content="https://mintradar.org/mint/${encodeURIComponent(mintUrl)}"`)
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain('property="og:image" content="https://mintradar.org/og-image-reliability.png"')
  })

  it('falls back to the mint URL as the display name when name is null', () => {
    const mint: OgMintData = { name: null, reliabilityScore: 50, online: false, degraded: false }
    const html = renderMintOgHtml(mint, mintUrl)
    expect(html).toContain(`<title>${mintUrl} — MintRadar</title>`)
  })

  it('falls back to the mint URL when name is an empty/whitespace string', () => {
    const mint: OgMintData = { name: '   ', reliabilityScore: 50, online: false, degraded: false }
    const html = renderMintOgHtml(mint, mintUrl)
    expect(html).toContain(`<title>${mintUrl} — MintRadar</title>`)
  })

  it('shows only the hostname for a mint on the hidden-names list (the raw name never reaches the bot HTML)', () => {
    const html = renderMintOgHtml({ ...baseMint, name: 'A Very Rude Name' }, 'https://mint.sortug.com')
    expect(html).toContain('<title>mint.sortug.com \u2014 MintRadar</title>')
    expect(html).not.toContain('Rude')
  })

  it('cleans control characters, bidi marks and emoji spam out of the title', () => {
    const rlo = String.fromCharCode(0x202e), zw = String.fromCharCode(0x200b)
    const html = renderMintOgHtml({ ...baseMint, name: `${rlo}Evil${zw}Mint ${String.fromCodePoint(0x1f525).repeat(8)}` }, 'https://evil.example')
    expect(html).toContain(`<title>EvilMint ${String.fromCodePoint(0x1f525).repeat(3)} \u2014 MintRadar</title>`)
  })

  it('shows N/A when reliabilityScore is null', () => {
    const mint: OgMintData = { name: 'Example Mint', reliabilityScore: null, online: true, degraded: false }
    const html = renderMintOgHtml(mint, mintUrl)
    expect(html).toContain('content="Reliability Score: N/A · Online"')
  })

  it('escapes a malicious mint name instead of injecting it raw', () => {
    const mint: OgMintData = { name: '<img src=x onerror=alert(1)>', reliabilityScore: 10, online: true, degraded: false }
    const html = renderMintOgHtml(mint, mintUrl)
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('renders a generic MintRadar fallback when mint is null (unknown URL)', () => {
    const html = renderMintOgHtml(null, mintUrl)
    expect(html).toContain('<title>MintRadar - Cashu Mint Monitor</title>')
    expect(html).toContain('Real-time Reliability Score, latency &amp; NUT monitoring for Cashu mints.')
    expect(html).toContain(`property="og:url" content="https://mintradar.org/mint/${encodeURIComponent(mintUrl)}"`)
  })

  it('falls back to the site homepage as og:url when no mint URL is given', () => {
    const html = renderMintOgHtml(null, '')
    expect(html).toContain('property="og:url" content="https://mintradar.org"')
  })

  it('always returns a well-formed HTML document (doctype + closing tags)', () => {
    const html = renderMintOgHtml(null, mintUrl)
    expect(html.trim().startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
  })
})

describe('renderPageOgHtml (documentation pages)', () => {
  it('renders every allowlisted slug from PAGE_META: title, description, canonical, og:url and a visible link', () => {
    for (const [slug, path] of Object.entries(OG_PAGE_SLUGS)) {
      const meta = PAGE_META[path]
      const url = `https://mintradar.org${meta.canonicalPath}`
      const html = renderPageOgHtml(slug)!
      expect(html, slug).toContain(`<title>${meta.title}</title>`)
      expect(html).toContain(`<link rel="canonical" href="${url}" />`)
      expect(html).toContain(`<meta name="description" content="${meta.description}" />`)
      expect(html).toContain(`<meta property="og:title" content="${meta.title}" />`)
      expect(html).toContain(`<meta property="og:description" content="${meta.description}" />`)
      expect(html).toContain(`<meta property="og:url" content="${url}" />`)
      expect(html).toContain(`<meta name="twitter:title" content="${meta.title}" />`)
      expect(html).toContain(`<meta name="twitter:description" content="${meta.description}" />`)
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
      expect(html).toContain('<meta property="og:image" content="https://mintradar.org/og-image-reliability.png" />')
      expect(html).toContain(`<body>\n    <p><a href="${url}">${meta.title}</a></p>\n  </body>`)
    }
  })

  it('uses the same generic image as the mint fragment and the home card', () => {
    const image = /property="og:image" content="([^"]+)"/
    expect(image.exec(renderPageOgHtml('methodology')!)?.[1]).toBe(image.exec(renderMintOgHtml(null, ''))?.[1])
  })

  it('returns null for anything that is not an allowlisted slug', () => {
    const odd = ['', 'unknown', 'Methodology', 'methodology ', '/methodology', '../methodology', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '<script>alert(1)</script>']
    for (const slug of odd) expect(renderPageOgHtml(slug), slug).toBeNull()
    for (const slug of [undefined, null, 1, true, {}, ['methodology'], ['methodology', 'for-wallets']]) expect(renderPageOgHtml(slug)).toBeNull()
  })

  it('leaves the mint fragment unchanged: no canonical link, an empty body', () => {
    const html = renderMintOgHtml(null, '')
    expect(html).not.toContain('rel="canonical"')
    expect(html).toContain('<body></body>')
  })

  it('escapes every PAGE_META value it interpolates (checked with hostile values)', async () => {
    vi.resetModules()
    vi.doMock('../shared/pageMeta.js', () => ({
      PAGE_META: { '/x': { title: `<b>"T"&'t'</b>`, description: `<i>"D"&'d'</i>`, canonicalPath: '/x"><script>' } },
      OG_PAGE_SLUGS: { x: '/x' },
    }))
    const og = await import('../og.js')
    const html = og.renderPageOgHtml('x')!
    vi.doUnmock('../shared/pageMeta.js')
    vi.resetModules()
    expect(html).not.toMatch(/<b>|<i>|<script>/)
    expect(html).toContain('<title>&lt;b&gt;&quot;T&quot;&amp;&#39;t&#39;&lt;/b&gt;</title>')
    expect(html).toContain('content="&lt;i&gt;&quot;D&quot;&amp;&#39;d&#39;&lt;/i&gt;"')
    expect(html).toContain('href="https://mintradar.org/x&quot;&gt;&lt;script&gt;"')
  })
})
