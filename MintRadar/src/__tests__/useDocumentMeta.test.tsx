import { describe, it, expect, beforeEach } from 'vitest'
import { render, renderHook, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useDocumentMeta, useNoindex, useRemoveCanonical } from '@/hooks/useDocumentMeta'

// One hook sets title, description, canonical, og:* and twitter:* for the route after load. Not-found states have
// no canonical. A single-page navigation leaves no stale tag and no duplicate.

const HOME = 'https://mintradar.org/'
const STATIC_DESC = 'static description'
const wrapperAt = (path: string) => ({ children }: { children: ReactNode }) => (
  <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
)
const attr = (sel: string, a: string) => document.querySelector(sel)?.getAttribute(a)
const canonical = () => attr('link[rel="canonical"]', 'href')
const ogUrl = () => attr('meta[property="og:url"]', 'content')
const ogTitle = () => attr('meta[property="og:title"]', 'content')
const ogDesc = () => attr('meta[property="og:description"]', 'content')
const twTitle = () => attr('meta[name="twitter:title"]', 'content')
const twDesc = () => attr('meta[name="twitter:description"]', 'content')
const count = (sel: string) => document.querySelectorAll(sel).length

beforeEach(() => {
  document.head.innerHTML = `
    <title>Home</title>
    <meta name="description" content="${STATIC_DESC}" />
    <link rel="canonical" href="${HOME}" />
    <meta property="og:url" content="https://mintradar.org" />
    <meta property="og:title" content="Home OG" />
    <meta property="og:description" content="Home OG description" />
    <meta name="twitter:title" content="Home TW" />
    <meta name="twitter:description" content="Home TW description" />`
})

describe('useDocumentMeta route tags', () => {
  it('sets canonical, og:url, og:title, og:description, twitter:title and twitter:description from the route, title and description', () => {
    const { unmount } = renderHook(() => useDocumentMeta('About | MintRadar', 'About description'), { wrapper: wrapperAt('/about?x=1#top') })
    expect(canonical()).toBe('https://mintradar.org/about')
    expect(ogUrl()).toBe('https://mintradar.org/about')
    expect(ogTitle()).toBe('About | MintRadar')
    expect(twTitle()).toBe('About | MintRadar')
    expect(ogDesc()).toBe('About description')
    expect(twDesc()).toBe('About description')
    expect(attr('meta[name="description"]', 'content')).toBe('About description')
    expect(document.title).toBe('About | MintRadar')
    unmount()
    expect(canonical()).toBe(HOME)
    expect(ogUrl()).toBe('https://mintradar.org')
    expect(ogTitle()).toBe('Home OG')
    expect(ogDesc()).toBe('Home OG description')
    expect(twTitle()).toBe('Home TW')
    expect(twDesc()).toBe('Home TW description')
    expect(document.title).toBe('Home')
  })

  it('trailing slash rule: none on a path, a single "/" on the root, query and hash dropped', () => {
    for (const [path, expected] of [
      ['/', HOME],
      ['/learn/', 'https://mintradar.org/learn'],
      ['/learn/cashu-basics/', 'https://mintradar.org/learn/cashu-basics'],
      ['/stats?period=30d#chart', 'https://mintradar.org/stats'],
    ] as const) {
      const { unmount } = renderHook(() => useDocumentMeta('t', 'd'), { wrapper: wrapperAt(path) })
      expect(canonical(), path).toBe(expected)
      expect(ogUrl(), path).toBe(expected)
      unmount()
    }
  })

  it('the root gets the same tags as every other route (og:url with the slash, like the canonical)', () => {
    renderHook(() => useDocumentMeta('Root title', 'Root description'), { wrapper: wrapperAt('/') })
    expect(canonical()).toBe(HOME)
    expect(ogUrl()).toBe(HOME)
    expect(ogTitle()).toBe('Root title')
    expect(ogDesc()).toBe('Root description')
  })

  it('creates a missing tag once and removes it again on unmount', () => {
    document.head.innerHTML = '<title>Home</title>'
    const { unmount } = renderHook(() => useDocumentMeta('t', 'd'), { wrapper: wrapperAt('/stats') })
    for (const sel of ['link[rel="canonical"]', 'meta[property="og:url"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]']) {
      expect(count(sel), sel).toBe(1)
    }
    unmount()
    expect(document.head.querySelector('link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"]')).toBeNull()
  })

  it('without a description it leaves og:description and twitter:description at their static values', () => {
    renderHook(() => useDocumentMeta('t', undefined), { wrapper: wrapperAt('/stats') })
    expect(ogDesc()).toBe('Home OG description')
    expect(twDesc()).toBe('Home TW description')
    expect(ogTitle()).toBe('t')
  })

  it('a single-page navigation replaces every tag and never duplicates one', () => {
    function A() { useDocumentMeta('About | MintRadar', 'About description'); return <Link to="/stats">go</Link> }
    function B() { useDocumentMeta('Stats | MintRadar', 'Stats description'); return null }
    const { getByText } = render(
      <MemoryRouter initialEntries={['/about']}>
        <Routes><Route path="/about" element={<A />} /><Route path="/stats" element={<B />} /></Routes>
      </MemoryRouter>,
    )
    expect(canonical()).toBe('https://mintradar.org/about')
    act(() => { getByText('go').click() })
    expect(canonical()).toBe('https://mintradar.org/stats')
    expect(ogUrl()).toBe('https://mintradar.org/stats')
    expect(ogTitle()).toBe('Stats | MintRadar')
    expect(twTitle()).toBe('Stats | MintRadar')
    expect(ogDesc()).toBe('Stats description')
    expect(twDesc()).toBe('Stats description')
    expect(document.title).toBe('Stats | MintRadar')
    for (const sel of ['link[rel="canonical"]', 'meta[property="og:url"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[name="twitter:title"]', 'meta[name="twitter:description"]', 'meta[name="description"]']) {
      expect(count(sel), sel).toBe(1)
    }
  })
})

describe('useDocumentMeta notFound', () => {
  it('removes the canonical, leaves the other sharing tags static and puts the canonical back on unmount', () => {
    const { unmount } = renderHook(() => useDocumentMeta('Module not found - MintRadar Learn', undefined, { notFound: true }), { wrapper: wrapperAt('/learn/99') })
    expect(count('link[rel="canonical"]')).toBe(0)
    expect(ogUrl()).toBe('https://mintradar.org')
    expect(ogTitle()).toBe('Home OG')
    expect(document.title).toBe('Module not found - MintRadar Learn')
    unmount()
    expect(canonical()).toBe(HOME)
    expect(count('link[rel="canonical"]')).toBe(1)
  })

  it('a navigation from a found page to a not-found page and back removes and restores the canonical once', () => {
    function A() { useDocumentMeta('About', 'd'); return <Link to="/learn/99">go</Link> }
    function NF() { useDocumentMeta('Module not found', undefined, { notFound: true }); return <Link to="/about">back</Link> }
    const { getByText } = render(
      <MemoryRouter initialEntries={['/about']}>
        <Routes><Route path="/about" element={<A />} /><Route path="/learn/99" element={<NF />} /></Routes>
      </MemoryRouter>,
    )
    expect(canonical()).toBe('https://mintradar.org/about')
    act(() => { getByText('go').click() })
    expect(count('link[rel="canonical"]')).toBe(0)
    act(() => { getByText('back').click() })
    expect(canonical()).toBe('https://mintradar.org/about')
    expect(count('link[rel="canonical"]')).toBe(1)
  })

  it('useRemoveCanonical removes the canonical without touching title or the other tags', () => {
    const { unmount } = renderHook(() => useRemoveCanonical(), { wrapper: wrapperAt('/mint/x') })
    expect(count('link[rel="canonical"]')).toBe(0)
    expect(document.title).toBe('Home')
    expect(ogUrl()).toBe('https://mintradar.org')
    unmount()
    expect(canonical()).toBe(HOME)
  })
})

const robots = () => document.querySelector('meta[name="robots"]')

describe('not-found states are noindex, follow', () => {
  it('notFound + noindex sets the robots tag, removes the canonical and takes both away/back on unmount', () => {
    const { unmount } = renderHook(() => useDocumentMeta('Module not found', undefined, { notFound: true, noindex: true }), { wrapper: wrapperAt('/learn/99') })
    expect(robots()?.getAttribute('content')).toBe('noindex, follow')
    expect(count('meta[name="robots"]')).toBe(1)
    expect(count('link[rel="canonical"]')).toBe(0)
    unmount()
    expect(robots()).toBeNull()
    expect(canonical()).toBe(HOME)
  })

  it('a found page (no notFound, no noindex) has no robots tag', () => {
    renderHook(() => useDocumentMeta('About', 'd', { notFound: false, noindex: false }), { wrapper: wrapperAt('/about') })
    expect(robots()).toBeNull()
  })

  it('useNoindex creates the tag once, leaves title and canonical alone and removes the tag it created on unmount', () => {
    const { unmount } = renderHook(() => useNoindex(), { wrapper: wrapperAt('/mint/x') })
    expect(robots()?.getAttribute('content')).toBe('noindex, follow')
    expect(count('meta[name="robots"]')).toBe(1)
    expect(document.title).toBe('Home')
    expect(canonical()).toBe(HOME)
    unmount()
    expect(robots()).toBeNull()
  })

  it('useNoindex puts a robots tag that already existed back to its previous content', () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="robots" content="index, follow" />')
    const { unmount } = renderHook(() => useNoindex(), { wrapper: wrapperAt('/mint/x') })
    expect(robots()?.getAttribute('content')).toBe('noindex, follow')
    unmount()
    expect(robots()?.getAttribute('content')).toBe('index, follow')
    expect(count('meta[name="robots"]')).toBe(1)
  })

  it('a navigation from a not-found page to a found page removes the noindex', () => {
    function NF() { useDocumentMeta('Module not found', undefined, { notFound: true, noindex: true }); return <Link to="/about">back</Link> }
    function A() { useDocumentMeta('About', 'd'); return <span>about</span> }
    const { getByText } = render(
      <MemoryRouter initialEntries={['/learn/99']}>
        <Routes><Route path="/learn/99" element={<NF />} /><Route path="/about" element={<A />} /></Routes>
      </MemoryRouter>,
    )
    expect(robots()?.getAttribute('content')).toBe('noindex, follow')
    act(() => { getByText('back').click() })
    expect(robots()).toBeNull()
    expect(canonical()).toBe('https://mintradar.org/about')
  })
})

describe('useDocumentMeta canonicalPath (Mint Detail)', () => {
  it('uses the given path for canonical and og:url, and the title and description for the rest', () => {
    const path = `/mint/${encodeURIComponent('https://mint.minibits.cash/Bitcoin')}`
    const { unmount } = renderHook(() => useDocumentMeta('Minibits', 'desc', { canonicalPath: path }), { wrapper: wrapperAt('/mint/x') })
    expect(canonical()).toBe('https://mintradar.org/mint/https%3A%2F%2Fmint.minibits.cash%2FBitcoin')
    expect(ogUrl()).toBe('https://mintradar.org/mint/https%3A%2F%2Fmint.minibits.cash%2FBitcoin')
    expect(ogTitle()).toBe('Minibits')
    expect(twDesc()).toBe('desc')
    unmount()
    expect(canonical()).toBe(HOME)
    expect(ogUrl()).toBe('https://mintradar.org')
    expect(document.title).toBe('Home')
  })

  it('a hostile mint URL stays encoded and injects no tag', () => {
    const hostile = 'https://x.example/"><script>alert(1)</script><meta name="robots" content="noindex">'
    const before = document.head.children.length
    renderHook(() => useDocumentMeta('t', undefined, { canonicalPath: `/mint/${encodeURIComponent(hostile)}` }), { wrapper: wrapperAt('/mint/x') })
    const href = canonical()!
    expect(href.startsWith('https://mintradar.org/mint/https%3A%2F%2Fx.example%2F%22%3E%3Cscript%3E')).toBe(true)
    expect(href).not.toMatch(/[<>"' ]/)
    expect(document.head.children.length).toBe(before)
    expect(document.head.querySelector('script')).toBeNull()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('ignores a path that is not a plain absolute path and uses the route path instead', () => {
    for (const bad of ['//evil.example/x', 'https://evil.example/', 'mint/x', '/a b', '']) {
      const { unmount } = renderHook(() => useDocumentMeta('t', undefined, { canonicalPath: bad }), { wrapper: wrapperAt('/mint/x') })
      expect(canonical(), bad).toBe('https://mintradar.org/mint/x')
      unmount()
    }
  })
})
