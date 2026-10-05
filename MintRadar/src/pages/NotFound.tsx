import { Link } from 'react-router-dom'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import './NotFound.css'

// Catch-all route (src/App.tsx). Separate from RouteError, which stays the screen for real
// chunk-load / render failures. `routeTags: false` keeps canonical and og:url on the static
// defaults instead of pointing them at whatever unknown path was requested.
export default function NotFound() {
  useDocumentMeta('Page not found | MintRadar', undefined, { noindex: true, routeTags: false })

  return (
    <div className="not-found-page">
      <h1 className="not-found-title">Page not found</h1>
      <p className="not-found-text">
        There is no page at this address. It may have moved, or the link may be mistyped.
      </p>
      <p className="not-found-links">
        <Link to="/">Dashboard</Link>
        <Link to="/about">About</Link>
      </p>
    </div>
  )
}
