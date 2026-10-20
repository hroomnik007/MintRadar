import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Sets document.title and the meta description for the lifetime of the calling
// page, restoring the previous values on unmount. The app has no SSR/prerendering,
// so this is what gives each route (Stats, Learn modules, Mint Detail, …) its own
// title/snippet in search results instead of all sharing index.html's static tags.
//
// `noindex: true` additionally sets/creates <meta name="robots" content="noindex, follow">
// for the lifetime of the page — for routes with no public/unique content worth
// indexing (e.g. a logged-in-only Watchlist), so they don't compete with or dilute
// the real content pages in search results. `follow` (not `nofollow`) is deliberate:
// it still lets link equity flow through any links the page renders.
//
// Per-route sharing tags: the hook points <link rel="canonical"> and og:url at https://mintradar.org + the route
// path (no query, no hash, no trailing slash; the root keeps its single "/") and mirrors the title/description
// into og:title/og:description and twitter:title/twitter:description, on EVERY route including the root. Every tag
// is looked up before it is created (never a duplicate) and each route puts back what it found on unmount, so a
// single-page navigation leaves no stale value behind.
//
// `canonicalPath`: the canonical path when it differs from the route path (Mint Detail: the page resolves the slug
// first). The caller passes an already-encoded path (encodeURIComponent for the mint URL); a value that does not
// start with a single "/" is ignored and the route path is used.
//
// `notFound: true` (unknown Learn module, unknown or untracked mint, the 404 route): such a page has no address of
// its own, so the canonical link is REMOVED instead of set (it comes back on unmount) and the sharing tags keep the
// static defaults of index.html. `useRemoveCanonical()` does just that for states that set no title.
// Every not-found state is also `noindex, follow`: pass `noindex` next to `notFound` (the Learn module, the 404
// route) or call `useNoindex()` next to `useRemoveCanonical()` (the Mint Detail states that set no title). The
// robots tag is put back on unmount. This is client-side only: a crawler that does not run JavaScript still gets
// status 200 and the static head for an unknown path (a real 404 is not part of this hook).
const SITE_ORIGIN = 'https://mintradar.org'

// Sets one tag attribute and returns the function that puts the previous state back.
function setTag(selector: string, create: () => HTMLElement, attr: string, value: string): () => void {
  let el = document.querySelector<HTMLElement>(selector)
  const created = el === null
  if (!el) {
    el = create()
    document.head.appendChild(el)
  }
  const prev = el.getAttribute(attr)
  el.setAttribute(attr, value)
  const node = el
  return () => {
    if (created) node.remove()
    else if (prev !== null) node.setAttribute(attr, prev)
  }
}

const metaBy = (key: 'name' | 'property', name: string) => () => {
  const m = document.createElement('meta')
  m.setAttribute(key, name)
  return m
}

const canonicalLink = () => {
  const l = document.createElement('link')
  l.setAttribute('rel', 'canonical')
  return l
}

// Takes the canonical link out of <head> and returns the function that puts the same node back.
function removeCanonical(): () => void {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('link[rel="canonical"]'))
  const parents = nodes.map(n => ({ n, parent: n.parentNode, next: n.nextSibling }))
  for (const n of nodes) n.remove()
  return () => {
    for (const { n, parent, next } of parents) {
      if (parent && !document.querySelector('link[rel="canonical"]')) parent.insertBefore(n, next && next.parentNode === parent ? next : null)
    }
  }
}

export function useRemoveCanonical(): void {
  useEffect(() => removeCanonical(), [])
}

// Sets <meta name="robots" content="noindex, follow"> (creating it when missing) and returns the function that
// puts the previous state back: the tag is removed when this call created it, otherwise its content is restored.
function setNoindex(): () => void {
  let el = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
  const created = el === null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', 'robots')
    document.head.appendChild(el)
  }
  const prev = el.getAttribute('content')
  el.setAttribute('content', 'noindex, follow')
  const node = el
  return () => {
    if (created) node.remove()
    else if (prev !== null) node.setAttribute('content', prev)
  }
}

export function useNoindex(): void {
  useEffect(() => setNoindex(), [])
}

function canonicalUrlFor(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return `${SITE_ORIGIN}${path === '/' ? '/' : path}`
}

export function useDocumentMeta(
  title: string,
  description?: string,
  options?: { noindex?: boolean; notFound?: boolean; canonicalPath?: string },
): void {
  const noindex = options?.noindex ?? false
  const notFound = options?.notFound ?? false
  const canonicalPath = options?.canonicalPath
  const { pathname } = useLocation()
  const canonical = canonicalPath !== undefined && /^\/(?!\/)\S*$/.test(canonicalPath)
    ? `${SITE_ORIGIN}${canonicalPath}`
    : canonicalUrlFor(pathname)

  useEffect(() => {
    if (notFound) return removeCanonical()
    const undo = [
      setTag('link[rel="canonical"]', canonicalLink, 'href', canonical),
      setTag('meta[property="og:url"]', metaBy('property', 'og:url'), 'content', canonical),
      setTag('meta[property="og:title"]', metaBy('property', 'og:title'), 'content', title),
      setTag('meta[name="twitter:title"]', metaBy('name', 'twitter:title'), 'content', title),
    ]
    if (description) {
      undo.push(
        setTag('meta[property="og:description"]', metaBy('property', 'og:description'), 'content', description),
        setTag('meta[name="twitter:description"]', metaBy('name', 'twitter:description'), 'content', description),
      )
    }
    return () => { for (const fn of undo.reverse()) fn() }
  }, [canonical, notFound, title, description])

  useEffect(() => {
    const prevTitle = document.title
    document.title = title

    const descMeta = description ? document.querySelector('meta[name="description"]') : null
    const prevDescription = descMeta?.getAttribute('content') ?? null
    if (descMeta && description) descMeta.setAttribute('content', description)

    let robotsMeta: HTMLMetaElement | null = null
    let createdRobotsMeta = false
    if (noindex) {
      robotsMeta = document.querySelector('meta[name="robots"]')
      if (!robotsMeta) {
        robotsMeta = document.createElement('meta')
        robotsMeta.setAttribute('name', 'robots')
        document.head.appendChild(robotsMeta)
        createdRobotsMeta = true
      }
      robotsMeta.setAttribute('content', 'noindex, follow')
    }

    return () => {
      document.title = prevTitle
      if (descMeta && prevDescription !== null) descMeta.setAttribute('content', prevDescription)
      if (robotsMeta) {
        if (createdRobotsMeta) robotsMeta.remove()
        else robotsMeta.setAttribute('content', 'index, follow')
      }
    }
  }, [title, description, noindex])
}
