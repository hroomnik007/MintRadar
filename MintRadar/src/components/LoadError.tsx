import './LoadError.css'

// The ONE small component for "this data did not load" (and its quiet sibling, "still loading").
// An API failure is never presented as a mint state (offline / unknown / absent): a page whose mint data
// failed to load shows this instead of values derived from the missing data.
//
// Fixed texts only: callers pass a literal sentence, never an error message from the server or from a
// thrown Error. "Try again" refetches the failed query; nothing else is requested.

export const MINT_LIST_ERROR = 'Could not load the mint list. Please try again.'

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="load-error" role="alert">
      <p className="load-error-text">{message}</p>
      <button type="button" className="load-error-btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

export function LoadingNote() {
  return <div className="load-note" role="status">Loading…</div>
}
