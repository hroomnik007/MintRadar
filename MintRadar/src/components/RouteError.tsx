import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'
import { reloadOnChunkError } from '@/utils/chunkReload'
import './RouteError.css'

export default function RouteError() {
  const error = useRouteError()

  useEffect(() => {
    reloadOnChunkError(error)
  }, [error])

  return (
    <div className="route-error" role="alert">
      <div className="route-error-card">
        <h1 className="route-error-title">This page couldn&rsquo;t load.</h1>
        <p className="route-error-text">The app was probably updated.</p>
        <button type="button" className="route-error-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  )
}
