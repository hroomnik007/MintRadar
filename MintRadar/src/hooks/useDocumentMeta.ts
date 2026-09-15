import { useEffect } from 'react'

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
export function useDocumentMeta(title: string, description?: string, options?: { noindex?: boolean }): void {
  const noindex = options?.noindex ?? false

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
