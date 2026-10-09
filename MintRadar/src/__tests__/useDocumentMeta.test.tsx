import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'

// Mint Detail's own canonical and og:url (`canonicalPath`, routeTags false): only those two tags change,
// the previous (static, homepage) values come back on unmount, and the path cannot inject anything.

const HOME = 'https://mintradar.org/'
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/mint/x']}>{children}</MemoryRouter>
const canonical = () => document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute('href')
const ogUrl = () => document.querySelector('meta[property="og:url"]')?.getAttribute('content')
const ogTitle = () => document.querySelector('meta[property="og:title"]')?.getAttribute('content')

beforeEach(() => {
  document.head.innerHTML = `
    <title>Home</title>
    <meta name="description" content="home description" />
    <link rel="canonical" href="${HOME}" />
    <meta property="og:url" content="https://mintradar.org" />
    <meta property="og:title" content="Home OG" />`
})

describe('useDocumentMeta canonicalPath', () => {
  it('sets canonical and og:url to the mint URL and nothing else; the homepage values come back on unmount', () => {
    const path = `/mint/${encodeURIComponent('https://mint.minibits.cash/Bitcoin')}`
    const { unmount } = renderHook(() => useDocumentMeta('Minibits', 'desc', { routeTags: false, canonicalPath: path }), { wrapper })
    expect(canonical()).toBe('https://mintradar.org/mint/https%3A%2F%2Fmint.minibits.cash%2FBitcoin')
    expect(ogUrl()).toBe('https://mintradar.org/mint/https%3A%2F%2Fmint.minibits.cash%2FBitcoin')
    expect(ogTitle()).toBe('Home OG') // the existing Open Graph handling of Mint Detail is unchanged
    expect(document.title).toBe('Minibits')
    unmount()
    expect(canonical()).toBe(HOME)
    expect(ogUrl()).toBe('https://mintradar.org')
    expect(document.title).toBe('Home')
  })

  it('a hostile mint URL stays encoded and injects no tag', () => {
    const hostile = 'https://x.example/"><script>alert(1)</script><meta name="robots" content="noindex">'
    const before = document.head.children.length
    renderHook(() => useDocumentMeta('t', undefined, { routeTags: false, canonicalPath: `/mint/${encodeURIComponent(hostile)}` }), { wrapper })
    const href = canonical()!
    expect(href.startsWith('https://mintradar.org/mint/https%3A%2F%2Fx.example%2F%22%3E%3Cscript%3E')).toBe(true)
    expect(href).not.toMatch(/[<>"' ]/)
    expect(document.head.children.length).toBe(before)
    expect(document.head.querySelector('script')).toBeNull()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('ignores a path that is not a plain absolute path', () => {
    for (const bad of ['//evil.example/x', 'https://evil.example/', 'mint/x', '/a b', '']) {
      const { unmount } = renderHook(() => useDocumentMeta('t', undefined, { routeTags: false, canonicalPath: bad }), { wrapper })
      expect(canonical(), bad).toBe(HOME)
      unmount()
    }
  })

  it('does nothing without routeTags false (route tags own the canonical then)', () => {
    renderHook(() => useDocumentMeta('t', undefined, { canonicalPath: '/mint/x' }), { wrapper })
    expect(canonical()).toBe('https://mintradar.org/mint/x') // the route-tag effect, from the pathname
  })
})
