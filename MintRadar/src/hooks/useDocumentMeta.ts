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
// Per-route sharing tags (2026-10-04): unless `routeTags: false`, the hook also points
// <link rel="canonical"> and og:url at https://mintradar.org + the route path (no query, no hash, no
// trailing slash) and mirrors the title/description into og:title/og:description and
// twitter:title/twitter:description. The root route sets nothing of that: index.html's static values ARE
// the root's, and every other route restores what it found (the static defaults) on unmount.
// Mint Detail opts out (`routeTags: false`) and keeps the static tags it always had.
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

function canonicalUrlFor(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return `${SITE_ORIGIN}${path === '/' ? '/' : path}`
}

export function useDocumentMeta(
  title: string,
  description?: string,
  options?: { noindex?: boolean; routeTags?: boolean },
): void {
  const noindex = options?.noindex ?? false
  const routeTags = options?.routeTags ?? true
  const { pathname } = useLocation()
  const canonical = canonicalUrlFor(pathname)
  const isRoot = canonical === `${SITE_ORIGIN}/`

  useEffect(() => {
    if (!routeTags || isRoot) return
    const undo = [
      setTag('link[rel="canonical"]', () => { const l = document.createElement('link'); l.setAttribute('rel', 'canonical'); return l }, 'href', canonical),
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
  }, [canonical, isRoot, routeTags, title, description])

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
