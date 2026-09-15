import { useEffect } from 'react'

// Sets document.title and the meta description for the lifetime of the calling
// page, restoring the previous values on unmount. The app has no SSR/prerendering,
// so this is what gives each route (Stats, Learn modules, Mint Detail, …) its own
// title/snippet in search results instead of all sharing index.html's static tags.
export function useDocumentMeta(title: string, description?: string): void {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title

    const meta = description ? document.querySelector('meta[name="description"]') : null
    const prevDescription = meta?.getAttribute('content') ?? null
    if (meta && description) meta.setAttribute('content', description)

    return () => {
      document.title = prevTitle
      if (meta && prevDescription !== null) meta.setAttribute('content', prevDescription)
    }
  }, [title, description])
}
