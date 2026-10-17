// PAGE_META is the one source of the title, description and canonical of /methodology and /for-wallets: the pages
// set exactly these values in the document head, and the backend bot HTML (GET /api/og/page, nginx sends social
// crawlers there) is built from the backend copy of the same file. A text changed in only one place fails here.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PAGE_META, OG_PAGE_SLUGS } from '@/utils/pageMeta'
import { PAGE_META as bePageMeta, OG_PAGE_SLUGS as beSlugs } from '../../backend/src/shared/pageMeta'
import Methodology from '@/pages/Methodology'
import ForWallets from '@/pages/ForWallets'

const attr = (selector: string, name: string) => document.querySelector(selector)?.getAttribute(name)

// The static tags of index.html that the pages overwrite (the hook changes existing tags and creates the missing
// ones it owns); the home values stand in for them.
beforeEach(() => {
  cleanup()
  document.title = 'Home'
  document.head.innerHTML = `
    <meta name="description" content="home description" />
    <link rel="canonical" href="https://mintradar.org/" />
    <meta property="og:url" content="https://mintradar.org/" />
    <meta property="og:title" content="Home OG" />
    <meta property="og:description" content="Home OG description" />
    <meta name="twitter:title" content="Home TW" />
    <meta name="twitter:description" content="Home TW description" />`
})

describe('PAGE_META', () => {
  it('holds the agreed texts (the link preview of both pages)', () => {
    expect(PAGE_META['/methodology']).toEqual({
      title: 'How the Reliability Score is computed | MintRadar',
      description: 'The exact, versioned description of the MintRadar Reliability Score: five components, weights, data sources, caps and the change log of the formula.',
      canonicalPath: '/methodology',
    })
    expect(PAGE_META['/for-wallets']).toEqual({
      title: 'MintRadar for wallets | Cashu mint health API',
      description: 'Free, stable JSON API for Cashu mint health: score, status, uptime, software and audit. CORS enabled, cached, versioned.',
      canonicalPath: '/for-wallets',
    })
  })

  it('stores every entry under its own canonical path, and the slug list points only at stored paths', () => {
    for (const [path, meta] of Object.entries(PAGE_META)) expect(meta.canonicalPath).toBe(path)
    for (const path of Object.values(OG_PAGE_SLUGS)) expect(Object.keys(PAGE_META)).toContain(path)
    expect(Object.keys(OG_PAGE_SLUGS).sort()).toEqual(['for-wallets', 'methodology'])
  })

  it('is the same data as the backend copy', () => {
    expect(bePageMeta).toEqual(PAGE_META)
    expect(beSlugs).toEqual(OG_PAGE_SLUGS)
  })
})

describe.each([
  ['/methodology', Methodology],
  ['/for-wallets', ForWallets],
] as const)('page %s sets exactly the PAGE_META values', (path, Page) => {
  it('document title, description, canonical, og:* and twitter:* tags', () => {
    const meta = PAGE_META[path]
    const url = `https://mintradar.org${meta.canonicalPath}`
    render(<MemoryRouter initialEntries={[path]}><Page /></MemoryRouter>)
    expect(document.title).toBe(meta.title)
    expect(attr('meta[name="description"]', 'content')).toBe(meta.description)
    expect(attr('link[rel="canonical"]', 'href')).toBe(url)
    expect(attr('meta[property="og:url"]', 'content')).toBe(url)
    expect(attr('meta[property="og:title"]', 'content')).toBe(meta.title)
    expect(attr('meta[property="og:description"]', 'content')).toBe(meta.description)
    expect(attr('meta[name="twitter:title"]', 'content')).toBe(meta.title)
    expect(attr('meta[name="twitter:description"]', 'content')).toBe(meta.description)
  })
})
